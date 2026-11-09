// Wars as stories (design-play §5): every pair of powers that comes to blows has a war with a beginning, a score, an aim per
// side and, if one side gets far enough ahead, peace terms both can take or refuse. Peace is never forced. The week's big
// events go into the news, which each power's paper (its own wars) and the wire service (other wars, fog rules) report.
import { UNIT_TYPES, type Units } from '../data/units';
import { emit, hooks, world } from './core';
import { stream } from './generals';
import { allied, enemiesOf, sign } from './diplomacy';
import { evacuate } from './battle';
import { missionWants } from './missions';
import { updateSupplyLines } from './economy';
import type { AimKind, GameEvent, GameState, NewsItem, PeaceOffer, War, WarAim } from './types';

export const WAR = {
  /** Weeks each kind of aim runs. */
  weeks: { take: 16, hold: 12, win: 20 } as Record<AimKind, number>,
  /** Seconds a side has to pick its aim, or to answer peace terms (two weeks). */
  choose: 40, answer: 40,
  /** War score: points per region taken, for the men balance at its most lopsided, per aim reached. */
  region: 15, men: 40, menMin: 3000, aim: 15, aimMax: 2,
  /** A "win" aim asks for this much more war score than the side has when it is set (at least `offerAt`). */
  winStep: 25,
  /** Score at which peace terms come up, at which the loser also cedes a region; the war's minimum age and the gap between offers (days). */
  offerAt: 40, cedeAt: 60, minDays: 56, gap: 56,
  /** Payouts and penalties. */
  takeProd: 25, holdWW: 10, winProd: 15, winWW: 5, missWW: 3, refuseLoser: 6, refuseWinner: 3,
  /** Ended wars kept on record, weeks of news kept, items per week. */
  keep: 12, newsWeeks: 3, newsMax: 40,
  /** A battle at least this long (seconds, three weeks) is a siege. */
  siege: 60,
};

/** A number in 0..1 for a war's choices, from its own stream: wars leave the game's random stream alone. */
const rnd = (g: GameState, w: War) => stream(g.seed ^ 0x77a5, w.id * 1000 + (w.rs = (w.rs ?? 0) + 1))();
const side = (w: War, f: number) => (w.a === f ? 0 : w.b === f ? 1 : -1);
const other = (w: War, i: number) => (i === 0 ? w.b : w.a);
/** Men in a report's losses (kept as men per arm). */
const menOf = (u: Units) => { let n = 0; for (const k of UNIT_TYPES) n += u[k] ?? 0; return n; };

/** The war running between two powers. */
export const warBetween = (g: GameState, a: number, b: number) => (g.wars ?? []).find(w => !w.end && ((w.a === a && w.b === b) || (w.a === b && w.b === a)));
/** Wars a power is fighting. */
export const warsOf = (g: GameState, f: number) => (g.wars ?? []).filter(w => !w.end && (w.a === f || w.b === f));

/** War score of a side, −100..100, without (`noAim`) or with the aims reached. */
export function warScore(w: War, f: number, noAim = false): number {
  const i = side(w, f); if (i < 0) return 0;
  const j = 1 - i, tot = w.lost[0] + w.lost[1];
  let s = WAR.region * (w.taken[i] - w.taken[j]) + WAR.men * (w.lost[j] - w.lost[i]) / Math.max(WAR.menMin, tot);
  if (!noAim) s += WAR.aim * (Math.min(WAR.aimMax, w.won?.[i] ?? 0) - Math.min(WAR.aimMax, w.won?.[j] ?? 0));
  return Math.round(Math.max(-100, Math.min(100, s)));
}

export function addNews(g: GameState, n: NewsItem) {
  const wk = (g.newsWk ??= []); if (wk.length < WAR.newsMax) wk.push(n);
}

// ---------------------------------------------------------------- beginning and end

function startWar(g: GameState, a: number, b: number): War {
  const w: War = { id: g.nextId++, a, b, day0: g.day, battles: 0, taken: [0, 0], lost: [0, 0], aims: [null, null], opts: [null, null], won: [0, 0] };
  (g.wars ??= []).push(w);
  emit(g, { k: 'war', war: w.id, a, b, what: 'begins' });
  addNews(g, { k: 'war', a, b });
  offerAims(g, w, 0); offerAims(g, w, 1);
  return w;
}

function endWar(g: GameState, w: War, how: NonNullable<War['end']>['how'], win?: number, region?: number, pay?: number) {
  w.end = { day: g.day, how, win, region, pay }; w.offer = undefined; w.opts = [null, null]; w.due = undefined;
  const ended = (g.wars ?? []).filter(x => x.end);
  if (ended.length > WAR.keep) { const drop = new Set(ended.slice(0, ended.length - WAR.keep)); g.wars = g.wars!.filter(x => !drop.has(x)); }
}

// ---------------------------------------------------------------- aims

/** Three aims for side `i`: a region of theirs next to ours, holding every border, forcing them to the table. */
export function drawAims(g: GameState, w: War, i: number): WarAim[] {
  const W = world(), me = i === 0 ? w.a : w.b, foe = other(w, i), F = g.factions[me], out: WarAim[] = [];
  let best = -1, bs = -Infinity;
  for (const r of g.regions) {
    if (r.owner !== foe || r.capitalOf >= 0) continue;
    const ours = W.regions[r.id].land.filter(n => g.regions[n].owner === me).length; if (!ours) continue;
    const s = ours + (missionWants(g, F, r.id) ? 3 : 0) + (r.home === me ? 2 : 0) + rnd(g, w);
    if (s > bs) { bs = s; best = r.id; }
  }
  const until = (k: AimKind) => g.day + WAR.weeks[k] * 7;
  if (best >= 0) out.push({ k: 'take', region: best, until: until('take') });
  out.push({ k: 'hold', base: w.taken[1 - i], until: until('hold') });
  const need = Math.max(WAR.offerAt, warScore(w, me, true) + WAR.winStep);
  if (need <= 90) out.push({ k: 'win', need, until: until('win') });
  return out;
}

function offerAims(g: GameState, w: War, i: number) {
  const opts = drawAims(g, w, i), f = g.factions[i === 0 ? w.a : w.b];
  if (f.ai) { setAim(g, w, i, opts[aiAim(g, w, i, opts)]); return; }
  w.opts[i] = opts; w.due = g.time + WAR.choose;
}

/** A computer power: the region its orders want, else holding when the enemy is the bigger power, else the upper hand. */
function aiAim(g: GameState, w: War, i: number, opts: WarAim[]): number {
  const me = i === 0 ? w.a : w.b, foe = other(w, i), n = (f: number) => g.regions.filter(r => r.owner === f).length;
  const take = opts.findIndex(o => o.k === 'take');
  if (take >= 0 && (missionWants(g, g.factions[me], opts[take].region!) || rnd(g, w) < .5)) return take;
  const k = opts.findIndex(o => o.k === (n(foe) > n(me) * 1.2 ? 'hold' : 'win'));
  return k >= 0 ? k : 0;
}

function setAim(g: GameState, w: War, i: number, aim: WarAim) {
  w.aims[i] = { ...aim, base: aim.k === 'hold' ? w.taken[1 - i] : undefined };
  w.opts[i] = null; if (!w.opts[0] && !w.opts[1]) w.due = undefined;
  emit(g, { k: 'war', war: w.id, a: w.a, b: w.b, what: 'aimSet', by: i === 0 ? w.a : w.b, region: aim.region });
}

/** The player picks one of the aims offered. */
export function chooseAim(g: GameState, fid: number, war: number, k: number): string | null {
  const w = (g.wars ?? []).find(x => x.id === war && !x.end), i = w ? side(w, fid) : -1;
  if (!w || i < 0) return 'That war is over.';
  const o = w.opts[i]; if (!o) return 'Your aim in this war is already set.';
  if (!(k >= 0 && k < o.length)) return 'Invalid order.';
  setAim(g, w, i, o[Math.floor(k)]); return null;
}

/** Settle side i's aim: payout or penalty, and new aims to choose from. */
function settle(g: GameState, w: War, i: number, ok: boolean) {
  const aim = w.aims[i]; if (!aim || aim.res) return;
  aim.res = ok ? 1 : -1;
  const me = i === 0 ? w.a : w.b, f = g.factions[me];
  if (ok) {
    (w.won ??= [0, 0])[i]++;
    if (aim.k === 'take') f.supply += WAR.takeProd;
    else if (aim.k === 'hold') f.ww = Math.max(0, f.ww - WAR.holdWW);
    else { f.supply += WAR.winProd; f.ww = Math.max(0, f.ww - WAR.winWW); }
  } else f.ww = Math.min(100, f.ww + WAR.missWW);
  emit(g, { k: 'war', war: w.id, a: w.a, b: w.b, what: 'aim', by: me, ok, region: aim.region });
  addNews(g, { k: 'aim', a: me, b: other(w, i), ok, region: aim.region });
  offerAims(g, w, i);
}

function checkAims(g: GameState, w: War, weekly: boolean) {
  for (const i of [0, 1]) {
    const aim = w.aims[i]; if (!aim || aim.res) continue;
    const me = i === 0 ? w.a : w.b, late = weekly && g.day >= aim.until;
    if (aim.k === 'take') { if (g.regions[aim.region!].owner === me && g.regions[aim.region!].contested < 0) settle(g, w, i, true); else if (late) settle(g, w, i, false); }
    else if (aim.k === 'hold') { if (w.taken[1 - i] > (aim.base ?? 0)) settle(g, w, i, false); else if (late) settle(g, w, i, true); }
    else if (warScore(w, me, true) >= (aim.need ?? WAR.offerAt)) settle(g, w, i, true); else if (late) settle(g, w, i, false);
  }
}

// ---------------------------------------------------------------- peace

/** Terms for the side ahead: Production by how far ahead, a region next to the winner's when far ahead. */
export function peaceTerms(g: GameState, w: War, win: number): Omit<PeaceOffer, 'id' | 'exp' | 'yes'> {
  const lose = win === w.a ? w.b : w.a, s = warScore(w, win), W = world();
  let region: number | undefined;
  if (s >= WAR.cedeAt) {
    let bs = -Infinity;
    for (const r of g.regions) {
      if (r.owner !== lose || r.capitalOf >= 0 || r.battle >= 0 || r.contested >= 0) continue;
      const ours = W.regions[r.id].land.filter(n => g.regions[n].owner === win).length; if (!ours) continue;
      const v = ours + (missionWants(g, g.factions[win], r.id) ? 3 : 0) + (r.home === win ? 3 : 0) - (r.home === lose ? 1 : 0);
      if (v > bs) { bs = v; region = r.id; }
    }
  }
  const pay = Math.round(10 + (s - WAR.offerAt) / 2 + (region === undefined && s >= WAR.cedeAt ? 15 : 0));
  return { win, region, pay };
}

/** Would a computer power sign? The winner when the war costs it or it fights elsewhere; the loser when it is beaten or worn out. */
function aiSigns(g: GameState, w: War, f: number): boolean {
  const F = g.factions[f], foe = f === w.a ? w.b : w.a, m = F.mission;
  if (m?.type === 'destroy' && m.target === foe) return false;
  const s = warScore(w, f), others = [...enemiesOf(g, f).keys()].filter(x => x !== foe).length;
  if (s > 0) return F.ww >= 25 || others > 0 || s >= 70 || rnd(g, w) < .4;
  return s <= -60 || F.ww >= 45 || (others > 0 && rnd(g, w) < .6) || rnd(g, w) < .3;
}

function proposePeace(g: GameState, w: War) {
  const s = warScore(w, w.a); if (Math.abs(s) < WAR.offerAt) return;
  const win = s > 0 ? w.a : w.b;
  w.offer = { id: g.nextId++, ...peaceTerms(g, w, win), exp: g.time + WAR.answer, yes: [] }; w.last = g.day;
  emit(g, { k: 'war', war: w.id, a: w.a, b: w.b, what: 'offer', win, region: w.offer.region, pay: w.offer.pay });
  for (const f of [w.a, w.b]) if (g.factions[f].ai && w.offer) answerPeace(g, f, w.id, aiSigns(g, w, f));
}

/** Answer the peace terms on the table. Refusing costs war weariness, more for the side that is losing. */
export function answerPeace(g: GameState, fid: number, war: number, yes: boolean): string | null {
  const w = (g.wars ?? []).find(x => x.id === war && !x.end);
  if (!w || side(w, fid) < 0) return 'That war is over.';
  const o = w.offer; if (!o) return 'There are no peace terms on the table.';
  if (o.yes.includes(fid)) return null;
  if (!yes) {
    const F = g.factions[fid]; F.ww = Math.min(100, F.ww + (o.win === fid ? WAR.refuseWinner : WAR.refuseLoser));
    w.offer = undefined; emit(g, { k: 'war', war: w.id, a: w.a, b: w.b, what: 'refused', by: fid });
    return null;
  }
  o.yes.push(fid);
  if (o.yes.includes(w.a) && o.yes.includes(w.b)) conclude(g, w, o);
  return null;
}

function conclude(g: GameState, w: War, o: PeaceOffer) {
  const lose = o.win === w.a ? w.b : w.a, L = g.factions[lose], pay = Math.min(Math.floor(L.supply), o.pay);
  L.supply -= pay; g.factions[o.win].supply += pay;
  const r = o.region !== undefined ? g.regions[o.region] : undefined, cede = r && r.owner === lose && r.battle < 0 && r.contested < 0;
  if (cede) {
    evacuate(g, r, lose);
    r.owner = o.win; r.strike = false; r.mor = 50; r.defs = []; r.contested = -1; r.stance = 0; r.cs = undefined; r.an = undefined; r.deploy = undefined; r.fake = undefined; r.train = undefined;
    updateSupplyLines(g);
  }
  endWar(g, w, 'peace', o.win, cede ? r.id : undefined, pay);
  sign(g, w.a, w.b, 'nap');
  emit(g, { k: 'war', war: w.id, a: w.a, b: w.b, what: 'peace', win: o.win, region: cede ? r.id : undefined, pay });
  addNews(g, { k: 'peace', a: o.win, b: lose, region: cede ? r.id : undefined, n: pay });
}

// ---------------------------------------------------------------- weekly step and events

/** Once a week: aims chosen for players who left it, aims settled, terms lapsed or offered, the week's news filed. */
export function warsWeek(g: GameState) {
  for (const w of [...(g.wars ?? [])]) {
    if (w.end) continue;
    if (w.offer && g.time >= w.offer.exp) { w.offer = undefined; emit(g, { k: 'war', war: w.id, a: w.a, b: w.b, what: 'refused', by: -1 }); }
    checkAims(g, w, true);
    if (w.end) continue;
    if (!w.offer && g.day - w.day0 >= WAR.minDays && (w.last === undefined || g.day - w.last >= WAR.gap)) proposePeace(g, w);
  }
  (g.news ??= []).push({ day: g.day, items: g.newsWk ?? [] }); g.newsWk = [];
  if (g.news.length > WAR.newsWeeks) g.news.splice(0, g.news.length - WAR.newsWeeks);
}

/** Every step: an aim nobody picked in time is picked by the War Office. */
export function warsStep(g: GameState) {
  for (const w of g.wars ?? []) if (!w.end && w.due !== undefined && g.time >= w.due) for (const i of [0, 1]) { const o = w.opts[i]; if (o) setAim(g, w, i, o[0]); }
}

function onEvent(g: GameState, e: GameEvent) {
  switch (e.k) {
    case 'battleStart': {
      const a = e.attacker, b = e.defender; if (a < 0 || b < 0 || a === b || allied(g, a, b)) return;
      (warBetween(g, a, b) ?? startWar(g, a, b)).battles++;
      return;
    }
    case 'report': {
      const r = (g.reports ?? []).find(x => x.id === e.id); if (!r) return;
      // each side's losses go to its wars with the other sides, shared out when it fought several at once
      for (const s of r.sides) {
        const ws = r.sides.filter(o => o.f !== s.f).map(o => warBetween(g, s.f, o.f)).filter((w): w is War => !!w);
        const men = menOf(s.lost); for (const w of ws) w.lost[side(w, s.f)] += men / ws.length;
      }
      return;
    }
    case 'battleEnd': {
      const r = (g.reports ?? [])[(g.reports?.length ?? 0) - 1], rep = r && r.region === e.region && r.day === g.day ? r : undefined;
      if (e.winner !== null && e.prev >= 0 && e.winner !== e.prev) {
        const w = warBetween(g, e.winner, e.prev);
        if (w) { w.taken[side(w, e.winner)]++; checkAims(g, w, false); }
        addNews(g, { k: 'took', a: e.winner, b: e.prev, region: e.region, n: rep && rep.dur >= WAR.siege ? Math.round(rep.dur / 20) : 0 });
      } else if (e.winner !== null && e.winner === e.prev && rep && rep.attacker !== e.prev) addNews(g, { k: 'held', a: e.prev, b: rep.attacker, region: e.region });
      return;
    }
    case 'treaty': if (e.what === 'signed') { const w = warBetween(g, e.a, e.b); if (w) { endWar(g, w, 'treaty'); emit(g, { k: 'war', war: w.id, a: w.a, b: w.b, what: 'ended' }); addNews(g, { k: 'peace', a: e.a, b: e.b }); } } return;
    case 'eliminated': for (const w of warsOf(g, e.faction)) endWar(g, w, 'gone', other(w, side(w, e.faction))); addNews(g, { k: 'elim', a: e.faction }); return;
    case 'general': if (e.kind === 'relieved' || e.kind === 'star') addNews(g, { k: e.kind, a: e.faction, name: e.name }); return;
    case 'strike': if (!e.end) addNews(g, { k: 'strike', a: e.faction, region: e.region }); return;
    case 'rising': addNews(g, { k: 'rising', a: e.faction, b: e.to, region: e.region }); return;
    case 'op': if (e.what === 'ended') addNews(g, { k: 'op', a: e.faction, name: e.name, ok: e.ok, region: e.region }); return;
  }
}
hooks.event = onEvent;
