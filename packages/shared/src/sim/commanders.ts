// Front commanders (design-command §2.5). An army is a group of corps on a stretch of front (a list of own regions) under a
// commander. Every few seconds he looks at the hostile borders of his front with the same numbers the player sees
// (borderBalance on his power's fog-of-war view) and:
//  - shifts his corps along the front, from safe or quiet posts and the reserve to the borders that need them;
//  - files requests for what he cannot do himself: more men, trenches and wire, a patrol, permission to attack, permission to
//    fall back, and permission to send corps he no longer needs back to the player (a treaty with the power across, or a
//    border that is safe). Nothing leaves the front and no attack starts without an answer, unless the player gave a standing
//    approval or a budget for that kind.
// Corps the player orders by hand (`man`) stay in the army but the commander leaves them alone. Runs inside the simulation, so
// every client and the server agree.
import { AIR_RANGE, COST, TICK_SECONDS, groundUnits } from '../data/units';
import { commanderName, commanderTraits, type TraitKey } from '../data/commanders';
import { isCoast, zoneOfKey } from '../world/zones';
import { emit, frontsOf, hops, rnd, world, worksAt } from './core';
import { atWar } from './navy';
import { allied } from './diplomacy';
import { borderBalance, WORK_MULT, type Balance } from './balance';
import { MAX_SPIES, activeSpies, fogView } from './fog';
import { income } from './economy';
import { capCheck, fortCost, fortify, patrol, recon, recruit, setOrder, spy } from './commands';
import { techOn } from './tech';
import { unitCost } from './rules';
import { moraleCap } from './battle';
import { CORPS_CAP, addToGroup, coastThreat, column, corpsById, corpsIn, corpsSize, findCorps, landRoute, routeColumn, tagOf, takeCorps, takeDepot } from './posts';
import { STANDING_KINDS, type Corps, type GameState, type Hq, type HqNote, type Mandate, type RegionState, type Req, type ReqKind } from './types';

/** Seconds between a commander's looks at his front; open requests per army; days a denied request rests. */
export const THINK = 3, MAX_REQ = 3, DENY_WEEKS = 3;
/** Ratio of our strength to theirs from which a border counts as safe (its spare corps may go), and the default for attacks. */
export const SAFE_RATIO = 2.5, ATTACK_RATIO = 1.5, FALLBACK_RATIO = .5;
/** Most of a week's income a commander may be given to spend himself. */
export const BUDGET_MAX = .3;
/** Days after which a report counts as old for watching a border, and how fresh it must be before a commander proposes an attack. */
export const REPORT_OLD = 21, REPORT_FRESH = 7;
/** Fewest battalions a commander proposes to attack with. */
export const MIN_ATTACK = 3;

const has = (h: Hq, t: TraitKey) => h.cmd.tr.includes(t);
/** Strength ratio over the enemy from which this commander proposes an attack (his traits shift it). */
export const attackRatio = (h: Hq) => has(h, 'off') ? 1.2 : has(h, 'care') ? 1.3 : has(h, 'meth') ? 1.8 : ATTACK_RATIO;
const reserveKeep = (h: Hq) => has(h, 'meth') ? 2 : has(h, 'care') ? 0 : 1;
export const hqOf = (g: GameState, id: number) => (g.hq ?? []).find(h => h.id === id);
export const requestsOf = (g: GameState, f: number) => (g.requests ?? []).filter(q => q.owner === f);

// ---------------------------------------------------------------- forming and ending armies

/** A new army of power `f` holding `front`, with a commander drawn from the game's random stream. */
export function newHq(g: GameState, f: number, front: number[]): Hq {
  const F = g.factions[f]; F.nArmy = (F.nArmy ?? 0) + 1;
  const h: Hq = {
    id: g.nextId++, owner: f, n: F.nArmy,
    cmd: { name: commanderName(f, rnd(g), rnd(g)), tr: commanderTraits(f, () => rnd(g)), xp: 0 },
    front: [...new Set(front)], mandate: 1, budget: 0, spent: 0, wk: -1, standing: [], deny: {}, next: g.time + 1,
    rep: (g.reports ?? []).reduce((m, r) => Math.max(m, r.id), 0), notes: [],
  };
  (g.hq ??= []).push(h);
  return h;
}

/** Every corps of an army, wherever it stands. */
export function armyCorps(g: GameState, h: Hq): { r: RegionState; c: Corps }[] {
  const out: { r: RegionState; c: Corps }[] = [];
  for (const r of g.regions) if (r.owner === h.owner && r.cs) for (const c of r.cs) if (c.army === h.id) out.push({ r, c });
  return out;
}

/** A corps leaving an army goes to the player's own orders; a computer power's goes back to its region's Auto. */
export const handBack = (g: GameState, f: number) => g.factions[f]?.ai ? undefined : true;

/** Disband an army: its corps go to the player, its requests lapse. */
export function disbandHq(g: GameState, h: Hq) {
  const man = handBack(g, h.owner);
  for (const { c } of armyCorps(g, h)) { c.army = undefined; c.man = man; }
  for (const a of g.armies) if (a.ct?.army === h.id) { a.ct.army = undefined; a.ct.man = man; }
  g.hq = (g.hq ?? []).filter(x => x !== h);
  g.requests = (g.requests ?? []).filter(q => q.army !== h.id);
}

function note(h: Hq, g: GameState, n: Omit<HqNote, 't' | 'day'>) { h.notes.unshift({ t: g.time, day: g.day, ...n }); if (h.notes.length > 6) h.notes.length = 6; }

// ---------------------------------------------------------------- moving corps

/** The commander marches a corps of his to a post (within its region or through own land); it stays in the army. */
export function cmdMove(g: GameState, r: RegionState, c: Corps, to: number, toPost: number): boolean {
  if (r.id === to && c.p === toPost) return false;
  if (r.id !== to && (corpsSize(c) >= groundUnits(r.units) || frontsOf(g, r.id).some(b => !b.goal))) return false;
  const route = r.id === to ? [] : landRoute(g, r.owner, r.id, to);
  if (!route) return false;
  const tag = tagOf(c), mor = c.mor, st = c.st ?? r.stance, from = c.p, f = r.owner, out = takeCorps(r, c);
  if (r.id === to) column(g, f, r.id, from, r.id, toPost, out.u, out.m, mor, { stance: st, ct: tag });
  else routeColumn(g, f, r.id, from, route, toPost, out.u, out.m, mor, { stance: st, ct: tag });
  return true;
}

/** Corps of the player free to be sent to a request for men: under the player's own orders, in no army, idle, nearest first. */
export function transferCandidate(g: GameState, f: number, q: Req): { r: RegionState; c: Corps; legs: number } | null {
  let best: { r: RegionState; c: Corps; legs: number } | null = null;
  for (const r of g.regions) {
    if (r.owner !== f || !r.cs) continue;
    for (const c of r.cs) {
      if (!c.man || c.army !== undefined || (c.ord ?? 0) >= 1) continue;
      if (r.id !== q.region && corpsSize(c) >= groundUnits(r.units)) continue;
      const route = r.id === q.region ? [] : landRoute(g, f, r.id, q.region); if (!route) continue;
      const legs = route.length;
      if (!best || legs < best.legs || (legs === best.legs && corpsSize(c) > corpsSize(best.c))) best = { r, c, legs };
    }
  }
  return best;
}

// ---------------------------------------------------------------- looking at the front

/** An own airfield that reaches `target`: front regions first, then the nearest. -1 if none. */
export function airfieldFor(g: GameState, f: number, target: number, front: number[] = []): number {
  let best = -1, bd = Infinity;
  for (const r of g.regions) {
    if (r.owner !== f || !r.airfield || r.contested >= 0) continue;
    const d = hops(r.id, target, AIR_RANGE); if (d > AIR_RANGE) continue;
    const s = d - (front.includes(r.id) ? 1 : 0);
    if (s < bd) { bd = s; best = r.id; }
  }
  return best;
}

interface Border { r: RegionState; s: number; bal: Balance; want: number; have: number; theirs: number }
const worksMult = (b: Balance) => 1 + WORK_MULT.trench * b.own.trench + WORK_MULT.sand * b.own.sand + WORK_MULT.wire * b.own.wire;

/** Is border `s` of own region `r` one the commander must hold: a land border with a power at war with us, or a threatened coast? */
function hostile(g: GameState, f: number, s: number): boolean {
  if (isCoast(s)) return coastThreat(g, f, zoneOfKey(s)) > 0;
  const o = g.regions[s].owner; return o >= 0 && o !== f && atWar(g, f, o);
}

/** Battalions of the army marching to a post, on any leg of the way. */
function armyIncoming(g: GameState, h: Hq): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of g.armies) {
    if (a.owner !== h.owner || a.ct?.army !== h.id) continue;
    const to = a.path?.length ? a.path[a.path.length - 1] : a.to, post = a.path?.length ? a.fin ?? -1 : a.post ?? -1;
    // the last leg is already counted by the balance (columns heading for that post)
    if (!a.path?.length && !a.inner) continue;
    const k = to + '|' + post; m.set(k, (m.get(k) ?? 0) + groundUnits(a.units));
  }
  return m;
}

function borders(g: GameState, V: GameState, h: Hq): Border[] {
  const W = world(), out: Border[] = [], inc = armyIncoming(g, h);
  for (const id of h.front) {
    const r = g.regions[id];
    for (const s of W.regions[id].sectors) {
      if (!hostile(g, h.owner, s)) continue;
      const bal = borderBalance(V, id, s);
      const theirs = (bal.their.btl[0] + bal.their.btl[1] + bal.their.reserve[0] + bal.their.reserve[1]) / 2 + bal.their.incoming;
      let want = bal.know === 0 ? 3 : Math.ceil(theirs * 1.1 * (has(h, 'def') ? 1.2 : 1) / worksMult(bal));
      if (bal.massing) want = Math.ceil(want * 1.5);
      if (h.mandate === 2 && s === h.target) want = Math.max(want, Math.ceil(theirs * 2) + 2);
      want = Math.max(1, want);
      // recruits in training for this border count as on their way
      const have = bal.own.btl[0] + bal.own.incoming + (inc.get(id + '|' + s) ?? 0) + (r.train ?? []).filter(t => t.p === s && t.army === h.id).length;
      out.push({ r, s, bal, want, have, theirs });
    }
  }
  return out;
}

/** One look at the front: shift corps, file requests, carry out what is approved in advance. */
export function think(g: GameState, h: Hq, V: GameState) {
  const f = h.owner, W = world();
  // the front follows the army: regions lost drop out, regions its corps stand in (taken in an offensive) join
  const list0 = armyCorps(g, h);
  h.front = [...new Set([...h.front, ...list0.map(x => x.r.id)])].filter(id => g.regions[id].owner === f);
  if (!h.front.length) { for (const { c } of list0) note(h, g, { k: 'release', n: c.n, region: -1, post: -1, why: 'lost' }); disbandHq(g, h); return; }
  const wk = Math.floor(g.time / TICK_SECONDS); if (h.wk !== wk) { h.wk = wk; h.spent = 0; }
  // experience: battles won on his front
  for (const rep of g.reports ?? []) if (rep.id > h.rep) { if (rep.winner === f && (h.front.includes(rep.region) || rep.sides.some(s => s.f === f) && h.front.includes(rep.from))) h.cmd.xp = Math.min(3, h.cmd.xp + .34); h.rep = Math.max(h.rep, rep.id); }
  if (has(h, 'insp')) for (const { c } of list0) c.mor = Math.min(moraleCap(g, f), c.mor + .45);

  const bs = borders(g, V, h), byKey = new Map(bs.map(b => [b.r.id + '|' + b.s, b]));
  const free = (c: Corps) => !c.man && (c.ord ?? 0) === 0;
  const fighting = (r: RegionState, p: number) => p >= 0 && frontsOf(g, r.id).some(b => b.from === p);
  type Spare = { r: RegionState; c: Corps; why: 'peace' | 'safe' | 'quiet' | 'reserve' };
  const spare: Spare[] = [];
  for (const { r, c } of armyCorps(g, h)) {
    if (!free(c) || !h.front.includes(r.id) || fighting(r, c.p)) continue;
    if (c.p < 0) { spare.push({ r, c, why: 'reserve' }); continue; }
    if (byKey.has(r.id + '|' + c.p)) continue;
    // a post that is no longer hostile: a treaty with the power across, or the neighbour is ours, or the coast is calm
    const o = isCoast(c.p) ? -1 : g.regions[c.p].owner;
    spare.push({ r, c, why: o >= 0 && o !== f && !allied(g, f, o) ? 'peace' : 'quiet' });
  }
  // spare corps on hostile borders that are safe by a wide margin (smallest first, the line keeps what it wants)
  const safe = has(h, 'caut') ? SAFE_RATIO + 1 : SAFE_RATIO;
  for (const b of bs) {
    if (b.bal.know === 0 || b.bal.massing || fighting(b.r, b.s)) continue;
    if (!(b.bal.ratio === null ? false : b.bal.ratio >= safe || (b.theirs <= 0 && b.bal.know >= 1))) continue;
    const here = corpsIn(b.r).filter(c => c.p === b.s && c.army === h.id && free(c)).sort((a, z) => corpsSize(a) - corpsSize(z));
    for (const c of here) if (b.have - corpsSize(c) >= b.want) { spare.push({ r: b.r, c, why: 'safe' }); b.have -= corpsSize(c); }
  }
  // borders short of men get spare corps, worst first: same region first, then the nearest region of the front
  const short = bs.filter(b => b.have < b.want && !fighting(b.r, b.s)).sort((a, z) => (z.bal.massing ? 4 : z.bal.danger) - (a.bal.massing ? 4 : a.bal.danger) || (z.want - z.have) - (a.want - a.have));
  for (const b of short) {
    while (b.have < b.want && spare.length) {
      let bi = -1, bd = 1e9;
      spare.forEach((x, i) => { const d = x.r.id === b.r.id ? 0 : (landRoute(g, f, x.r.id, b.r.id)?.length ?? 1e6); if (d < bd) { bd = d; bi = i; } });
      if (bi < 0 || bd >= 1e6) break;
      const x = spare[bi]; spare.splice(bi, 1);
      if (cmdMove(g, x.r, x.c, b.r.id, b.s)) { b.have += corpsSize(x.c); note(h, g, { k: 'move', n: x.c.n, region: b.r.id, post: b.s, why: 'need' }); }
    }
  }
  // what is left: the reserve keeps its corps; spare corps on the line go back to the reserve until it is full, the rest the
  // commander offers back to the player (with permission)
  // corps of the army already marching to a centre of the front count as reserve
  const toCentre = g.armies.filter(a => a.owner === f && a.ct?.army === h.id && (a.path?.length ? a.fin ?? -1 : a.post ?? -1) < 0).length;
  let reserve = spare.filter(x => x.why === 'reserve').length + toCentre;
  const keep = reserveKeep(h), offer: Spare[] = [];
  for (const x of spare) {
    if (x.why === 'reserve') { if (reserve > keep) { offer.push({ ...x, why: 'safe' }); reserve--; } continue; }
    if (x.why !== 'peace' && reserve < keep) { if (cmdMove(g, x.r, x.c, x.r.id, -1)) reserve++; continue; }
    offer.push(x);
  }

  // ---------------------------------------------------------------- requests
  const asks: Omit<Req, 'id' | 'owner' | 'army' | 'at'>[] = [];
  /** Our latest report on a region is at most `days` old (or we see it in full). */
  const fresh = (nb: number, days: number) => { const o = V.regions[nb]; return (o.vis ?? 3) >= 3 || (o.seen !== undefined && g.day - o.seen <= days); };
  /** Ask to scout an enemy region across border `b`: a flight from an airfield in reach (it sees more), else a cavalry patrol. */
  const scout = (b: Border, urg: 0 | 1, purpose: 'watch' | 'attack' | 'target') => {
    const key = `recon|${b.s}`; if (asks.some(a => a.key === key)) return;
    const air = techOn(g, f, 'air') ? airfieldFor(g, f, b.s, h.front) : -1;
    asks.push(air >= 0
      ? { kind: 'recon', by: 'recon', from: air, for: purpose, key, urg, region: b.r.id, sector: b.s, cost: COST.recon, ...bal(b) }
      : { kind: 'recon', by: 'patrol', from: b.r.id, for: purpose, key, urg, region: b.r.id, sector: b.s, cost: COST.patrol, ...bal(b) });
  };
  const bal = (b: Border) => ({ own: b.bal.own.btl[0] + b.bal.own.reserve[0], their: [b.bal.their.btl[0] + b.bal.their.reserve[0] + b.bal.their.incoming, b.bal.their.btl[1] + b.bal.their.reserve[1] + b.bal.their.incoming] as [number, number], ratio: b.bal.ratio, massing: b.bal.massing });
  for (const b of bs) {
    const fight = fighting(b.r, b.s), mineHere = corpsIn(b.r).filter(c => c.p === b.s && c.army === h.id && !c.man);
    // more men where the line is short and in danger
    if (b.have < b.want && (b.bal.danger >= 2 || b.bal.massing)) {
      const n = Math.min(CORPS_CAP, b.want - b.have);
      asks.push({ kind: 'men', key: `men|${b.r.id}|${b.s}`, urg: b.bal.massing || b.bal.danger === 3 ? 2 : 1, region: b.r.id, sector: b.s, n, cost: unitCost(g, f, 'inf'), ...bal(b) });
    }
    // works on borders that are not safe
    if (!fight && b.bal.danger >= (has(h, 'def') ? 0 : 1) && !isCoast(b.s)) {
      const w = worksAt(b.r, b.s);
      const kind = w.tr < 1 || (w.tr < 2 && techOn(g, f, 'trench2')) ? 'trench' : w.wire < 1 ? 'wire' : null;
      const cost = kind ? fortCost(b.r, kind, b.s, g) : null;
      if (kind && cost !== null) asks.push({ kind: 'fort', key: `fort|${b.r.id}|${b.s}`, urg: 0, region: b.r.id, sector: b.s, fort: kind, cost, ...bal(b) });
    }
    // reconnaissance: where the border is not safe and our report is missing or old (an Intelligence officer wants every border
    // looked at each week)
    if (!isCoast(b.s) && !fresh(b.s, has(h, 'intel') ? REPORT_FRESH : REPORT_OLD) && (has(h, 'intel') || b.bal.danger >= 1 || b.bal.massing)) scout(b, 0, 'watch');
    // permission to attack: a local first-line attack under Active defence, the offensive on the target under Offensive
    const idle = mineHere.filter(c => (c.ord ?? 0) === 0);
    const aim = h.mandate === 2 ? (b.s === h.target ? 2 : 0) : h.mandate === 1 ? 1 : 0;
    const going = idle.reduce((n, c) => n + corpsSize(c), 0);
    const could = aim && !isCoast(b.s) && !fight && going >= Math.max(MIN_ATTACK, Math.ceil(b.theirs * 1.5)) && b.bal.know >= 1 && b.bal.ratio !== null && b.bal.ratio >= attackRatio(h) && b.have >= b.want && !frontsOf(g, b.s).length && !capCheck(g, f, b.s);
    // he proposes an attack only on a fresh report; first he asks for one
    if (could && !fresh(b.s, REPORT_FRESH)) scout(b, 1, 'attack');
    if (could && fresh(b.s, REPORT_FRESH))
      asks.push({ kind: 'attack', key: `atk|${b.r.id}|${b.s}`, urg: 1, region: b.r.id, sector: b.s, corps: idle.map(c => c.id), goal: aim === 2 ? 2 : 1, ...bal(b) });
    // permission to fall back from a border that cannot be held
    if (!has(h, 'care') && !fight && b.bal.danger === 3 && b.bal.ratio !== null && b.bal.ratio < (has(h, 'caut') ? .7 : FALLBACK_RATIO) && mineHere.length && !spare.length)
      asks.push({ kind: 'fallback', key: `fb|${b.r.id}|${b.s}`, urg: 2, region: b.r.id, sector: b.s, corps: mineHere.map(c => c.id), ...bal(b) });
  }
  // an Offensive wants eyes on the target all the time: a spy there if one can be sent, else flights or patrols
  if (h.mandate === 2 && h.target !== undefined && g.regions[h.target].owner !== f) {
    const T = h.target, edge = bs.find(b => b.s === T);
    const spying = activeSpies(g, f).some(s => s.region === T) || g.spies.some(s => s.f === f && s.region === T);
    const cap = g.regions.find(r => r.capitalOf === f);
    if (!spying && g.spies.filter(s => s.f === f).length < MAX_SPIES && cap && cap.owner === f)
      asks.push({ kind: 'recon', by: 'spy', for: 'target', key: `spy|${T}`, urg: 0, region: edge?.r.id ?? h.front[0], sector: T, cost: COST.spy, ...(edge ? bal(edge) : {}) });
    else if (!spying && edge && !fresh(T, REPORT_FRESH)) scout(edge, 0, 'target');
  }
  // permission to send corps back: those across from a power we have a treaty with, and those the front does not need
  for (const why of ['peace', 'safe'] as const) {
    const xs = offer.filter(x => (x.why === 'peace') === (why === 'peace'));
    if (!xs.length) continue;
    asks.push({ kind: 'release', key: `rel|${why}|${xs.map(x => x.c.id).sort((a, z) => a - z).join(',')}`, urg: 0, region: xs[0].r.id, sector: xs[0].c.p, corps: xs.map(x => x.c.id), why });
  }
  file(g, h, asks);
  autoAnswer(g, h);
}

/** Merge a look's requests into the open ones: same key keeps its id; requests whose reason is gone lapse. */
function file(g: GameState, h: Hq, asks: Omit<Req, 'id' | 'owner' | 'army' | 'at'>[]) {
  const all = (g.requests ??= []), mine = all.filter(q => q.army === h.id), byKey = new Map(mine.map(q => [q.key, q]));
  const next: Req[] = [];
  for (const a of asks.filter(a => (h.deny[a.key] ?? -1) < g.time).sort((x, y) => y.urg - x.urg)) {
    if (next.length >= MAX_REQ) break;
    if (a.kind === 'release' && next.some(q => q.kind === 'release')) continue;
    const old = byKey.get(a.key) ?? (a.kind === 'release' ? mine.find(q => q.kind === 'release' && q.why === a.why) : undefined);
    const q: Req = { ...(old ?? {}), ...a, id: old?.id ?? g.nextId++, owner: h.owner, army: h.id, at: old && !(a.urg === 2 && old.urg < 2) ? old.at : g.time } as Req;
    next.push(q);
    // a new request (or one that has become critical) goes out over the radio
    if (!old || (q.urg === 2 && old.urg < 2)) emit(g, { k: 'request', faction: h.owner, army: h.id, kind: q.kind, region: q.region, sector: q.sector, urg: q.urg, req: q.id });
  }
  g.requests = [...all.filter(q => q.army !== h.id), ...next];
  for (const k of Object.keys(h.deny)) if (h.deny[k] < g.time) delete h.deny[k];
}

/** Standing approvals, then the front budget (men, works, patrols), carry requests out without asking. */
function autoAnswer(g: GameState, h: Hq) {
  const F = g.factions[h.owner], cap = income(g, h.owner) * Math.max(0, Math.min(BUDGET_MAX, h.budget));
  for (const q of requestsOf(g, h.owner).filter(q => q.army === h.id)) {
    if (q.kind === 'attack') continue;
    const cost = q.kind === 'men' ? (q.cost ?? 0) * (q.n ?? 1) : q.cost ?? 0;
    const standing = h.standing.includes(q.kind), budget = (q.kind === 'men' || q.kind === 'fort' || q.kind === 'recon') && h.spent + cost <= cap;
    if (!(standing || budget) || F.supply < cost) continue;
    if (!reply(g, h.owner, q.id, 'yes') && budget && !standing) h.spent += cost;
  }
}

// ---------------------------------------------------------------- answers

/** Answer a request. `n`: how many of the battalions asked for (men). Returns an error text, or null. */
export function reply(g: GameState, f: number, id: number, opt: 'yes' | 'recruit' | 'transfer' | 'deny', n?: number): string | null {
  const q = (g.requests ?? []).find(x => x.id === id && x.owner === f); if (!q) return 'That request is no longer open.';
  const h = hqOf(g, q.army); if (!h) return 'That army no longer exists.';
  const r = g.regions[q.region], drop = () => { g.requests = (g.requests ?? []).filter(x => x !== q); };
  if (opt === 'deny') { h.deny[q.key] = g.time + DENY_WEEKS * TICK_SECONDS; drop(); return null; }
  if (r.owner !== f) { drop(); return 'That region is no longer ours.'; }
  switch (q.kind) {
    case 'men': {
      if (opt === 'transfer') {
        const t = transferCandidate(g, f, q); if (!t) return 'None of your corps is free to send: form one from a depot, or take one out of another army.';
        t.c.army = h.id; t.c.man = undefined;
        if (!cmdMove(g, t.r, t.c, q.region, q.sector)) { t.c.army = undefined; t.c.man = true; return 'That corps cannot get there.'; }
        break;
      }
      const want = Math.max(1, Math.min(q.n ?? 1, Math.floor(n ?? q.n ?? 1)));
      let got = 0, err: string | null = null;
      // the recruits train for a week, then form up on the border that asked for them, in the army
      for (let i = 0; i < want; i++) { err = recruit(g, f, r, 'inf', false, { p: q.sector, army: h.id }); if (err) break; got++; }
      if (!got) return err;
      if (got < want) { q.n = (q.n ?? want) - got; return err; }
      break;
    }
    case 'fort': { const e = fortify(g, f, r, q.fort ?? 'trench', q.sector); if (e) return e; break; }
    case 'recon': {
      const e = q.by === 'spy' ? spy(g, f, q.sector) : q.by === 'recon' ? recon(g, f, q.from ?? q.region, q.sector) : patrol(g, f, q.from ?? q.region, q.sector);
      if (e) return e;
      // the scouts remember who sent them (an Intelligence officer's are caught less often)
      if (q.by !== 'spy') { const a = g.armies[g.armies.length - 1]; if (a?.scout) a.hq = h.id; }
      break;
    }
    case 'attack': {
      let ok = 0, err: string | null = null;
      for (const cid of q.corps ?? []) { const c = corpsById(r, cid); if (!c || c.p !== q.sector) continue; const e = setOrder(g, f, q.region, q.sector, q.goal ?? 1, false, undefined, cid); if (e) err ??= e; else ok++; }
      if (!ok) { drop(); return err ?? 'Those corps are no longer on that border.'; }
      break;
    }
    case 'fallback': for (const cid of q.corps ?? []) { const c = corpsById(r, cid); if (c) cmdMove(g, r, c, r.id, -1); } break;
    case 'release': {
      for (const cid of q.corps ?? []) {
        const x = findCorps(g, f, cid); if (!x || x.c.army !== h.id) continue;
        x.c.army = undefined; x.c.man = handBack(g, f); x.c.ord = 0;
        if (x.c.p >= 0) cmdMove(g, x.r, x.c, x.r.id, -1);
        note(h, g, { k: 'release', n: x.c.n, region: x.r.id, post: x.c.p, why: q.why ?? 'safe' });
        emit(g, { k: 'release', faction: f, army: h.id, n: x.c.n, region: x.r.id, why: q.why ?? 'safe' });
      }
      break;
    }
  }
  drop();
  return null;
}

// ---------------------------------------------------------------- player commands

export function formArmyHq(g: GameState, f: number, ids: number[]): string | null {
  const found = [...new Set(ids)].map(id => findCorps(g, f, id)).filter((x): x is NonNullable<typeof x> => !!x);
  if (!found.length) return 'Select the corps for the new army first.';
  const h = newHq(g, f, found.map(x => x.r.id));
  for (const { c } of found) { c.army = h.id; c.man = undefined; }
  return null;
}

export function assignArmy(g: GameState, f: number, army: number, ids: number[], on: boolean): string | null {
  const h = hqOf(g, army); if (!h || h.owner !== f) return 'That army is not yours.';
  let n = 0;
  for (const id of ids) {
    const x = findCorps(g, f, id); if (!x) continue;
    if (on) { x.c.army = h.id; x.c.man = undefined; if (!h.front.includes(x.r.id)) h.front.push(x.r.id); }
    else if (x.c.army === h.id) { x.c.army = undefined; x.c.man = true; }
    n++;
  }
  return n ? null : 'Those corps are on the move or in battle. Try again once they stand at a post.';
}

export function setArmy(g: GameState, f: number, army: number, o: { mandate?: Mandate; target?: number; budget?: number; front?: number[]; standing?: ReqKind[] }): string | null {
  const h = hqOf(g, army); if (!h || h.owner !== f) return 'That army is not yours.';
  const W = world();
  if (o.front !== undefined) {
    const fr = [...new Set(o.front)].filter(id => g.regions[id]?.owner === f);
    if (!fr.length) return 'An army needs at least one region of ours to hold.';
    h.front = fr;
  }
  if (o.mandate !== undefined) { if (![0, 1, 2].includes(o.mandate)) return 'Invalid order.'; h.mandate = o.mandate; if (o.mandate !== 2 && o.target === undefined) h.target = undefined; }
  if (o.target !== undefined) {
    if (o.target < 0) h.target = undefined;
    else {
      const T = g.regions[o.target]; if (!T) return 'Unknown region.';
      if (T.owner === f || (T.owner >= 0 && allied(g, f, T.owner))) return `${W.regions[o.target].name} is not an enemy region.`;
      if (!h.front.some(id => W.regions[id].land.includes(o.target!))) return `${W.regions[o.target].name} does not border the army's front.`;
      h.target = o.target; h.mandate = 2;
    }
  }
  if (o.budget !== undefined) h.budget = Math.max(0, Math.min(BUDGET_MAX, o.budget));
  if (o.standing !== undefined) h.standing = [...new Set(o.standing)].filter(k => STANDING_KINDS.includes(k));
  g.requests = (g.requests ?? []).filter(q => q.army !== h.id || q.kind !== 'attack' || h.mandate !== 0);
  h.next = Math.min(h.next, g.time + .5);
  return null;
}

/** Relieve a commander: a new one takes over (no experience), his corps lose some morale. */
export function relieve(g: GameState, f: number, army: number): string | null {
  const h = hqOf(g, army); if (!h || h.owner !== f) return 'That army is not yours.';
  h.cmd = { name: commanderName(f, rnd(g), rnd(g)), tr: commanderTraits(f, () => rnd(g)), xp: 0 };
  for (const { c } of armyCorps(g, h)) c.mor = Math.max(0, c.mor - 5);
  g.requests = (g.requests ?? []).filter(q => q.army !== h.id); h.deny = {};
  return null;
}

export function disband(g: GameState, f: number, army: number): string | null {
  const h = hqOf(g, army); if (!h || h.owner !== f) return 'That army is not yours.';
  disbandHq(g, h); return null;
}

/** Weeks a request waits for an answer before it lapses (critical ones one week), and the morale its corps lose then. */
export const EXPIRE = { weeks: 2, critical: 1, mor: 5 } as const;
/** Game time at which a request lapses unanswered. */
export const reqExpiry = (q: Req) => q.at + (q.urg === 2 ? EXPIRE.critical : EXPIRE.weeks) * TICK_SECONDS;

/** Requests nobody answered in time lapse (design-play §2): men, works, patrols and falling back cost the corps concerned
 *  morale; an attack or a corps to send back simply lapses. The commander does not ask again for a while. */
function expire(g: GameState) {
  for (const q of [...(g.requests ?? [])]) {
    if (g.time < reqExpiry(q)) continue;
    const h = hqOf(g, q.army); g.requests = (g.requests ?? []).filter(x => x !== q);
    if (!h) continue;
    h.deny[q.key] = g.time + DENY_WEEKS * TICK_SECONDS;
    const cost = q.kind === 'attack' || q.kind === 'release' ? 0 : EXPIRE.mor, hit: number[] = [];
    if (cost) for (const { r, c } of armyCorps(g, h)) {
      if (q.corps?.length ? !q.corps.includes(c.id) : r.id !== q.region || (q.sector >= 0 && c.p !== q.sector)) continue;
      c.mor = Math.max(0, c.mor - cost); hit.push(c.id);
    }
    emit(g, { k: 'reqExpired', faction: q.owner, army: h.id, kind: q.kind, region: q.region, sector: q.sector, mor: hit.length ? cost : 0, corps: hit });
  }
}

/** Every commander whose turn it is takes a look at his front. Called every step. */
export function stepCommanders(g: GameState) {
  if (g.requests?.length) expire(g);
  if (!g.hq?.length) return;
  const views = new Map<number, GameState>();
  for (const h of [...g.hq]) {
    if (g.time < h.next) continue;
    h.next = g.time + THINK;
    if (!g.factions[h.owner]?.alive) { disbandHq(g, h); continue; }
    let V = views.get(h.owner); if (!V) { V = fogView(g, h.owner); views.set(h.owner, V); }
    think(g, h, V);
  }
}

