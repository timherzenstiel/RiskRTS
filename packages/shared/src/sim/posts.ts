// Deployment inside a region and phased offensives.
//
// A region's troops stand in corps (`RegionState.cs`, at most CORPS_CAP battalions each, any number per post: the centre, a
// border, a coast) and in its depot (whatever is in no corps). Each corps has its own men, morale and experience; the region's
// `units`/`men` stay the totals, so economy, supply and fog keep reading them. Troops move between posts and regions as columns
// (`Army` with `post`; a whole corps carries its identity in `ct`), and every move takes the distance along the path
// (centre → border → across → border → centre) divided by the marching speed.
//
// An offensive runs in phases: troops called up from the main army form up (FORM), march to the border facing the target,
// assemble there (ASSEMBLE), and then the corps holds, takes the enemy's first line, or invades. The battle stages that follow
// (first line → consolidation → depth) live in battle.ts.
import { FORMATION, GROUND_TYPES, TICK_SECONDS, UNIT_TYPES, emptyUnits, groundUnits, type Units, type UnitType } from '../data/units';
import { wrapDx } from '../world/build';
import { sectorPoint } from '../world/sectors';
import { coastKey, isCoast, zoneAt, zoneOfKey } from '../world/zones';
import { emit, frontsOf, menTotal, world } from './core';
import { allied, atPeace } from './diplomacy';
import { marchFactor, weatherMarch } from './rails';
import { PACES, type Army, type Corps, type CorpsTag, type GameState, type Order, type RegionState, type Stance } from './types';

/** Marching speed of ground columns in world units per second (Normal pace). About 20 s from the centre to a border. */
export const POST_SPEED = .3;
/** Shortest column, and the shortest crossing from a border into the enemy's line. */
export const MOVE_MIN = 2, CROSS_MIN = 6;
/** Forming up an offensive: base seconds plus per formation, capped; halved with barracks or in the capital. */
export const FORM_BASE = 20, FORM_PER = 2, FORM_MAX = 60;
/** Seconds to assemble at the jump-off line, and to consolidate a captured first line before the depth. */
export const ASSEMBLE = 30, CONSOLIDATE = 30;
/** A corps holding its border this long counts one trench level deeper there. */
export const DIG_IN = 2 * TICK_SECONDS;
/** Seconds an unprepared attack's guns fire unregistered (less suppression). */
export const UNREG = 30;
/** Share of a region's formations the main army keeps when the region deploys itself. */
export const MAIN_SHARE = .3;

/** Time factor of the pace (Fast 0.6, Normal 1, Long 1.5). */
export const moveK = (g: GameState) => (PACES[g.cfg?.pace ?? 1] ?? PACES[1]).move;

// ---------------------------------------------------------------- positions

/** Map position of a post: -1 the region centre (main army), else the border with that neighbour. */
export function postPt(region: number, post: number): { x: number; z: number } {
  const W = world(), r = W.regions[region];
  if (post < 0 || !(r.sectors.includes(post) || r.adj.includes(post))) return { x: r.cx, z: r.cz };
  const p = sectorPoint(W, region, post); return { x: p.x, z: p.z };
}
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(wrapDx(a.x, b.x), b.z - a.z);

/** Length of a march from a post of one region to a post of the same or a neighbouring region. */
export function legDist(from: number, fromPost: number, to: number, toPost: number): number {
  if (from === to) return dist(postPt(from, fromPost), postPt(from, toPost));
  return dist(postPt(from, fromPost), postPt(from, to)) + dist(postPt(from, to), postPt(to, from)) + dist(postPt(to, from), postPt(to, toPost));
}

// ---------------------------------------------------------------- groups

/** Most battalions one corps holds; larger concentrations are several corps at one post. */
export const CORPS_CAP = 20;
/** Most experience stars, and the damage each adds. */
export const XP_MAX = 3, XP_DMG = .05;

const full = (k: keyof Units) => FORMATION[k].men;

export const corpsIn = (r: RegionState): Corps[] => r.cs ?? [];
export const corpsAtPost = (r: RegionState, post: number): Corps[] => corpsIn(r).filter(c => c.p === post);
export const corpsById = (r: RegionState, id: number): Corps | undefined => corpsIn(r).find(c => c.id === id);
/** Borders and coasts that have a corps, in a fixed order. */
export const corpsPosts = (r: RegionState): number[] => [...new Set(corpsIn(r).filter(c => c.p >= 0).map(c => c.p))].sort((a, b) => a - b);
/** Find a corps of a power anywhere on the map. */
export function findCorps(g: GameState, f: number, id: number): { r: RegionState; c: Corps } | null {
  for (const r of g.regions) if (r.owner === f && r.cs) { const c = r.cs.find(x => x.id === id); if (c) return { r, c }; }
  return null;
}

/** Battalions of every corps at a post. */
export function postUnits(r: RegionState, post: number): Units {
  const u = emptyUnits(); for (const c of corpsIn(r)) if (c.p === post) for (const k of GROUND_TYPES) u[k] += c.u[k]; return u;
}
/** Men of every corps at a post. */
export const postMen = (r: RegionState, post: number) => corpsIn(r).reduce((s, c) => s + (c.p === post ? menTotal(c.m) : 0), 0);

/** The depot: the region's battalions and men in no corps (aircraft always stay here). */
export function depotOf(r: RegionState): { u: Units; m: Units } {
  const u = { ...r.units }, m = { ...r.men };
  for (const c of corpsIn(r)) for (const k of GROUND_TYPES) { u[k] -= c.u[k]; m[k] -= c.m[k]; }
  for (const k of UNIT_TYPES) { u[k] = Math.max(0, u[k]); m[k] = u[k] > 0 ? Math.max(0, m[k]) : 0; }
  return { u, m };
}
/** Formations at the region centre: the depot and the reserve corps standing there. */
export function mainOf(r: RegionState): Units {
  const u = depotOf(r).u; for (const c of corpsIn(r)) if (c.p < 0) for (const k of GROUND_TYPES) u[k] += c.u[k]; return u;
}
/** Formations of a group: -1 the region centre, else every corps at that border. */
export const groupUnits = (r: RegionState, post: number): Units => post < 0 ? mainOf(r) : postUnits(r, post);
/** Men a set of formations of a region brings (depot strength for the share not in a known corps). */
export function groupMen(r: RegionState, u: Units): number {
  let m = 0; for (const k of UNIT_TYPES) if (r.units[k] > 0) m += r.men[k] * Math.min(1, u[k] / r.units[k]); return m;
}
/** Ground battalions of a corps. */
export const corpsSize = (c: { u: Units }) => groundUnits(c.u);
/** What a corps keeps while it is away from its region. */
export const tagOf = (c: Corps): CorpsTag => ({ id: c.id, n: c.n, p: c.p, xp: c.xp || undefined, man: c.man || undefined, st: c.st, army: c.army, nr: c.nr || undefined });

/** Number of the region's army (the depot's name), raised on first use. */
export function armyNo(g: GameState, r: RegionState): number {
  if (r.an === undefined && r.owner >= 0) { const f = g.factions[r.owner]; f.nArmy = (f.nArmy ?? 0) + 1; r.an = f.nArmy; }
  return r.an ?? -1;
}
const nextCorpsNo = (g: GameState, f: number) => { const F = g.factions[f]; F.nCorps = (F.nCorps ?? 0) + 1; return F.nCorps; };
/** Raise an empty corps at a post (with the identity of `tag` when it is free in this region, else a new id and number). */
export function raiseCorps(g: GameState, r: RegionState, post: number, tag?: Partial<CorpsTag>): Corps {
  let id = tag?.id, n = tag?.n;
  if (id === undefined || id < 0 || corpsById(r, id)) id = g.nextId++;
  if (n === undefined || n < 1 || corpsIn(r).some(c => c.n === n)) n = nextCorpsNo(g, r.owner);
  const c: Corps = { id, n, p: post, u: emptyUnits(), m: emptyUnits(), mor: r.mor, since: g.time };
  if (tag?.xp) c.xp = tag.xp; if (tag?.man) c.man = true; if (tag?.st !== undefined) c.st = tag.st; if (tag?.army !== undefined) c.army = tag.army; if (tag?.nr) c.nr = true;
  (r.cs ??= []).push(c);
  return c;
}
/** The first corps at a border, raised if there is none (tests and migration). */
export function corpsAt(g: GameState, r: RegionState, post: number, n?: number): Corps {
  return corpsAtPost(r, post)[0] ?? raiseCorps(g, r, post, n !== undefined ? { n } : undefined);
}
/** A corps left behind by part of it that keeps the identity: it gets a new id and number. */
export function renumber(g: GameState, r: RegionState, c: Corps) { c.id = g.nextId++; c.n = nextCorpsNo(g, r.owner); c.xp = undefined; c.ord = 0; c.now = false; c.since = g.time; }
const dropCorps = (r: RegionState, c: Corps) => { if (!r.cs) return; r.cs = r.cs.filter(x => x !== c); if (!r.cs.length) r.cs = undefined; };
/** Hand a corps back to the depot (its troops stay in the region). */
export function dissolve(r: RegionState, c: Corps) {
  const d = depotOf(r), before = groundUnits(d.u), add = corpsSize(c);
  if (add) r.mor = (r.mor * before + c.mor * add) / (before + add);
  dropCorps(r, c);
}

/**
 * Keep corps consistent with the region: a corps never holds more formations or men than the region has (battles, wear and
 * losses take from the totals), aircraft stay in the depot, corps on lost borders fall back to the centre, empty corps are
 * dropped, and corps nobody ordered fold into the depot when they stand idle at the centre (Auto arranges those troops).
 */
export function fixPosts(g: GameState, r: RegionState) {
  if (r.owner < 0) { r.cs = undefined; r.an = undefined; return; }
  if (groundUnits(depotOf(r).u) > 0) armyNo(g, r);
  const cs = r.cs; if (!cs) return;
  const secs = world().regions[r.id].sectors;
  for (const c of cs) { c.u.plane = 0; c.m.plane = 0; if (c.p >= 0 && !secs.includes(c.p)) { c.p = -1; c.ord = 0; c.now = false; } }
  for (const k of GROUND_TYPES) {
    let over = -r.units[k]; for (const c of cs) over += c.u[k];
    while (over > 0) {
      let big: Corps | null = null; for (const c of cs) if (!big || c.u[k] > big.u[k]) big = c;
      if (!big || big.u[k] <= 0) break;
      const n = Math.min(over, big.u[k]); big.m[k] -= Math.round(big.m[k] * n / big.u[k]); big.u[k] -= n; over -= n;
    }
    let sm = 0;
    for (const c of cs) { c.m[k] = c.u[k] > 0 ? Math.max(0, Math.min(c.m[k], c.u[k] * full(k))) : 0; sm += c.m[k]; }
    if (sm > r.men[k] + .5) { const q = Math.max(0, r.men[k]) / sm; for (const c of cs) c.m[k] = Math.floor(c.m[k] * q); }
  }
  for (const c of [...cs]) if (corpsSize(c) <= 0) dropCorps(r, c);
  for (const c of [...corpsIn(r)]) if (c.p < 0 && !c.man && c.army === undefined && (c.ord ?? 0) === 0) dissolve(r, c);
}

/** Men coming back to a region (returning wounded) fill the gaps of its corps and its depot in proportion. */
export function refill(r: RegionState, k: keyof Units, add: number) {
  if (add <= 0) return;
  r.men[k] += add;
  const d = depotOf(r), gaps = corpsIn(r).map(c => Math.max(0, c.u[k] * full(k) - c.m[k]));
  const dg = Math.max(0, d.u[k] * full(k) - (d.m[k] - add)), tot = dg + gaps.reduce((a, b) => a + b, 0);
  if (tot <= 0) return;
  corpsIn(r).forEach((c, i) => { c.m[k] += Math.floor(add * gaps[i] / tot); });
}

/** Take formations out of one corps (all of them without `n`). They leave the region's totals with their men. */
export function takeCorps(r: RegionState, c: Corps, n?: Partial<Units>): { u: Units; m: Units } {
  const out = { u: emptyUnits(), m: emptyUnits() };
  for (const k of GROUND_TYPES) {
    const q = Math.max(0, Math.min(c.u[k], n ? n[k] ?? 0 : c.u[k])); if (!q) continue;
    const men = Math.round(c.m[k] * q / c.u[k]);
    c.u[k] -= q; c.m[k] -= men; r.units[k] = Math.max(0, r.units[k] - q); r.men[k] = Math.max(0, r.men[k] - men);
    if (!c.u[k]) c.m[k] = 0;
    out.u[k] = q; out.m[k] = men;
  }
  if (corpsSize(c) <= 0) dropCorps(r, c);
  return out;
}
/** Take formations out of the depot. */
export function takeDepot(r: RegionState, n: Partial<Units>): { u: Units; m: Units } {
  const d = depotOf(r), out = { u: emptyUnits(), m: emptyUnits() };
  for (const k of GROUND_TYPES) {
    const q = Math.max(0, Math.min(d.u[k], n[k] ?? 0)); if (!q) continue;
    const men = Math.round(d.m[k] * q / d.u[k]);
    r.units[k] -= q; r.men[k] = Math.max(0, r.men[k] - men); out.u[k] = q; out.m[k] = men;
  }
  return out;
}

export interface Taken { u: Units; m: Units; mor: number; tag?: CorpsTag; n?: number; st?: Stance }
/**
 * Take formations out of a group (`post` -1 the centre: depot first, then reserve corps; else the corps at that border, largest
 * first): a share `frac` of each type, or exact counts `n`. Ground troops only. When one whole corps leaves, `tag` keeps its identity.
 */
export function takeGroup(r: RegionState, post: number, frac: number, n?: Partial<Units>): Taken {
  const src = groupUnits(r, post), want = emptyUnits(); let any = 0;
  for (const k of GROUND_TYPES) { want[k] = Math.max(0, Math.min(src[k], n ? n[k] ?? 0 : Math.round(src[k] * Math.max(0, Math.min(1, frac))))); any += want[k]; }
  if (!any && !n && frac > 0) for (const k of GROUND_TYPES) if (src[k] > 0) { want[k] = 1; break; }
  const out: Taken = { u: emptyUnits(), m: emptyUnits(), mor: r.mor };
  let morW = 0, morN = 0;
  const pour = (t: { u: Units; m: Units }, mor: number) => { for (const k of GROUND_TYPES) { out.u[k] += t.u[k]; out.m[k] += t.m[k]; want[k] -= t.u[k]; } const q = groundUnits(t.u); morW += mor * q; morN += q; };
  let depotN = 0;
  if (post < 0) { const d = takeDepot(r, want); depotN = groundUnits(d.u); pour(d, r.mor); }
  const list = corpsAtPost(r, post).sort((a, b) => corpsSize(b) - corpsSize(a));
  let sources = 0, wholeTag: CorpsTag | undefined;
  for (const c of list) {
    if (!GROUND_TYPES.some(k => want[k] > 0 && c.u[k] > 0)) continue;
    const whole = GROUND_TYPES.every(k => want[k] >= c.u[k]), tag = tagOf(c);
    if (out.n === undefined) { out.n = c.n; out.st = c.st; }
    pour(takeCorps(r, c, whole ? undefined : want), c.mor); sources++;
    if (whole) wholeTag = tag;
  }
  // one whole corps and nothing else: it keeps its identity on the way
  if (sources === 1 && !depotN && wholeTag) out.tag = wholeTag;
  if (morN) out.mor = morW / morN;
  return out;
}

/**
 * Put formations into a group of a region (they join its totals). At the centre they join the depot unless they are a corps the
 * player commands; at a border they fill a corps there (the corps of `tag`, else an Auto corps with room), raising new corps of at
 * most CORPS_CAP battalions as needed. Returns the corps that took troops.
 */
export function addToGroup(g: GameState, r: RegionState, post: number, u: Units, m: Units, mor: number, tag?: CorpsTag | number): Corps[] {
  const t: CorpsTag | undefined = typeof tag === 'number' ? (tag >= 1 ? { id: -1, n: tag } : undefined) : tag;
  for (const k of UNIT_TYPES) { r.units[k] += u[k]; r.men[k] += m[k]; }
  const add = groundUnits(u);
  if (!add) return [];
  if (post < 0 && !t?.man && t?.army === undefined) {
    const before = groundUnits(depotOf(r).u) - add;
    r.mor = before > 0 ? (r.mor * before + mor * add) / (before + add) : mor;
    return [];
  }
  let c = t && t.id >= 0 ? corpsById(r, t.id) : undefined;
  if (c && c.p !== post) c = undefined;
  if (!c && !t?.man) c = corpsAtPost(r, post).find(x => !x.man && x.army === t?.army && corpsSize(x) < CORPS_CAP && (t && t.army === undefined ? x.n === t.n || !t.n : true) && (x.ord ?? 0) === 0);
  if (!c) c = raiseCorps(g, r, post, t);
  const touched: Corps[] = [];
  const left = { ...u }, men = { ...m };
  while (GROUND_TYPES.some(k => left[k] > 0)) {
    const room = CORPS_CAP - corpsSize(c); let moved = 0;
    if (room > 0) {
      const before = corpsSize(c);
      for (const k of GROUND_TYPES) {
        const q = Math.min(left[k], room - moved); if (q <= 0) continue;
        const qm = left[k] ? Math.round(men[k] * q / left[k]) : 0;
        c.u[k] += q; c.m[k] += qm; left[k] -= q; men[k] -= qm; moved += q;
      }
      if (moved) { c.mor = before > 0 ? (c.mor * before + mor * moved) / (before + moved) : mor; touched.push(c); }
    }
    if (GROUND_TYPES.some(k => left[k] > 0)) c = raiseCorps(g, r, post, t ? { man: t.man, st: t.st, army: t.army } : undefined);
  }
  return touched;
}

/** Seconds troops called up from the main army need to form up for an offensive. */
export function formTime(g: GameState, r: RegionState, u: Units): number {
  const t = Math.min(FORM_MAX, FORM_BASE + FORM_PER * groundUnits(u)) * (r.barracks || r.capitalOf === r.owner ? .5 : 1);
  return t * moveK(g);
}

// ---------------------------------------------------------------- columns

export interface ColumnOpts { wait?: number; ord?: Order; now?: boolean; path?: number[]; fin?: number; front?: number; stance?: Stance; legs?: number; tired?: boolean; gn?: number; gk?: number; ct?: CorpsTag }

/** A column of ground troops on the move from a post of `from` to a post of `to` (the same region, or a neighbour). */
export function column(g: GameState, f: number, from: number, src: number, to: number, toPost: number, u: Units, m: Units, mor: number, o: ColumnOpts = {}): Army {
  const W = world(), inner = from === to, p0 = postPt(from, src), p1 = postPt(to, toPost);
  let k = moveK(g), rail = false;
  if (inner) k *= weatherMarch(g, f, to);
  else { const mf = marchFactor(g, f, from, to); k *= mf.k; rail = mf.rail; }
  const dur = Math.max(inner ? MOVE_MIN : CROSS_MIN * moveK(g), legDist(from, src, to, toPost) / POST_SPEED * k);
  const a: Army = {
    id: g.nextId++, owner: f, units: u, men: m, mor, from, to, t: 0, dur, sea: !inner && W.seaLane.has(from + '|' + to),
    ax: p0.x, az: p0.z, dx: wrapDx(p0.x, p1.x), dz: p1.z - p0.z, src, post: toPost,
  };
  if (inner) a.inner = true;
  if (rail) a.rail = true;
  if (o.wait) a.wait = o.wait;
  if (o.ord !== undefined) a.ord = o.ord;
  if (o.now) a.now = true;
  if (o.path?.length) { a.path = o.path; a.fin = o.fin; }
  if (o.front !== undefined) a.front = o.front;
  if (o.stance !== undefined) a.stance = o.stance;
  if (o.legs !== undefined) a.legs = o.legs;
  if (o.tired) a.tired = true;
  a.gn = o.gn; a.gk = o.gk;
  if (o.ct) { a.ct = o.ct; a.gn = o.ct.n; a.gk = 1; }
  g.armies.push(a);
  return a;
}

/** Route over land through the power's own (and allied) regions from `from` to `to`: the regions after `from`, or null. Sea lanes need ships. */
export function landRoute(g: GameState, f: number, from: number, to: number): number[] | null {
  if (from === to) return [];
  const W = world(), prev = new Map<number, number>([[from, -1]]), q = [from];
  const ok = (j: number) => { const o = g.regions[j].owner; return o === f || (o >= 0 && allied(g, f, o)); };
  while (q.length) {
    const c = q.shift()!;
    for (const n of W.regions[c].land) {
      if (prev.has(n) || !ok(n)) continue;
      prev.set(n, c); if (n === to) { const path = [n]; let p = c; while (p !== from) { path.unshift(p); p = prev.get(p)!; } return path; }
      q.push(n);
    }
  }
  return null;
}

/** Seconds a column of power `f` needs from a post of `from` to a post of `to` through own land (null: no route). */
export function marchEta(g: GameState, f: number, from: number, fromPost: number, to: number, toPost: number): number | null {
  if (from === to) return Math.max(MOVE_MIN, legDist(from, fromPost, to, toPost) / POST_SPEED * moveK(g) * weatherMarch(g, f, to));
  const route = landRoute(g, f, from, to); if (!route) return null;
  const path = [from, ...route]; let t = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1], pa = i === 0 ? fromPost : path[i - 1], pb = i + 2 < path.length ? path[i + 2] : toPost;
    t += Math.max(CROSS_MIN * moveK(g), legDist(a, pa, b, pb) / POST_SPEED * moveK(g) * marchFactor(g, f, a, b).k);
  }
  return t;
}

/** First leg of a route: the post to aim for in the next region (its border towards the region after it, or the final post). */
const legPost = (path: number[], i: number, fin: number) => i + 1 < path.length ? path[i + 1] : fin;

/** Send troops along a route of regions (all own or allied), ending at post `fin` of the last one. */
export function routeColumn(g: GameState, f: number, from: number, src: number, route: number[], fin: number, u: Units, m: Units, mor: number, o: ColumnOpts = {}): Army {
  return column(g, f, from, src, route[0], legPost(route, 0, fin), u, m, mor, { ...o, path: route.slice(1), fin });
}

/**
 * A column of ground troops has arrived (`a.post` set). Returns true when it was handled here; false when it marches into an
 * enemy region and the caller opens or joins the battle there.
 */
export function columnArrives(g: GameState, a: Army, join: (b: number) => boolean): boolean {
  const t = g.regions[a.to];
  if (a.front !== undefined && join(a.front)) return true;
  const friendly = t.owner === a.owner || (t.owner >= 0 && allied(g, a.owner, t.owner));
  if (friendly && a.path?.length) {
    // on through the next region of the route
    const nx = a.path[0], rest = a.path.slice(1);
    column(g, a.owner, a.to, a.post!, nx, rest.length ? rest[0] : a.fin ?? -1, a.units, a.men, a.mor, { ord: a.ord, now: a.now, path: rest, fin: a.fin, stance: a.stance, legs: (a.legs ?? 1) + 1, gn: a.gn, gk: a.gk, ct: a.ct });
    return true;
  }
  if (friendly && t.owner !== a.owner) {
    // an allied region has no post for our troops: they march on to a region of ours next to it
    const home = world().regions[t.id].land.find(j => g.regions[j].owner === a.owner);
    if (home !== undefined) column(g, a.owner, t.id, a.post ?? -1, home, -1, a.units, a.men, a.mor, { stance: a.stance, ct: a.ct });
    return true;
  }
  if (t.owner === a.owner) {
    // a front of this region burns on the border they march to: they join it
    const post = a.post ?? -1;
    const fb = post >= 0 ? frontsOf(g, t.id).find(b => b.from === post && b.def === a.owner) : undefined;
    if (fb && join(fb.id)) return true;
    const got = addToGroup(g, t, post, a.units, a.men, a.mor, a.ct ?? (a.gk === 1 ? a.gn : undefined));
    t.arrT = g.time; t.legs = a.legs ?? 1;
    for (const c of got) {
      if (a.stance !== undefined) c.st = a.stance;
      if (a.ord !== undefined && post >= 0) { c.ord = a.ord; c.now = a.now || c.now; }
      if ((c.ord ?? 0) >= 1) {
        // the troops across the border see them gather
        if ((c.ready ?? 0) <= g.time) emit(g, { k: 'massing', faction: a.owner, region: t.id, to: post, owner: g.regions[post].owner });
        c.ready = Math.max(c.ready ?? 0, g.time + ASSEMBLE * moveK(g));
      } else { c.ord = 0; c.since ??= g.time; }
    }
    return true;
  }
  if (a.inner) {
    // the region fell while the column moved inside it: the troops fall back to a neighbouring own region, or are lost
    const W = world(), back = W.regions[t.id].land.find(j => g.regions[j].owner === a.owner);
    if (back !== undefined) column(g, a.owner, t.id, a.post ?? -1, back, -1, a.units, a.men, a.mor, { tired: true, stance: a.stance, ct: a.ct });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- attacks

/** Seconds until a corps with an attack order is assembled (0 if it is). */
export const assembleLeft = (g: GameState, c: Corps) => Math.max(0, (c.ready ?? 0) - g.time);

/** Hooks set by commands.ts (attack limits and starting the column) to avoid an import cycle. */
let canAttack: (g: GameState, f: number, to: number) => string | null = () => null;
export function setAttackCheck(fn: typeof canAttack) { canAttack = fn; }

/** Corps with an attack order go over the border once assembled (or at once when ordered to). Called every step. */
export function stepPosts(g: GameState) {
  for (const r of g.regions) {
    fixPosts(g, r);
    if (!r.cs || r.owner < 0) continue;
    for (const c of [...r.cs]) {
      if ((c.ord ?? 0) < 1 || c.p < 0 || isCoast(c.p)) continue;
      const s = c.p, tgt = g.regions[s], f = r.owner;
      if (tgt.owner === f || (tgt.owner >= 0 && (allied(g, f, tgt.owner) || atPeace(g, f, tgt.owner)))) { c.ord = 0; c.now = false; c.since = g.time; continue; }
      if (!c.now && g.time < (c.ready ?? 0)) continue;
      // a foothold of ours on this front: an invasion order carries the attack into the depth
      const fb = frontsOf(g, s).find(b => b.from === r.id && b.attacker === f);
      if (fb) {
        if (c.ord === 2 && fb.stage === 3) { fb.stage = 1; fb.stT = fb.age; fb.goal = 2; emit(g, { k: 'advance', faction: f, region: s }); }
        // the corps' troops follow into the battle
      } else if (canAttack(g, f, s)) continue;
      launchCorps(g, r, c, fb?.id);
    }
  }
}

function launchCorps(g: GameState, r: RegionState, c: Corps, front?: number) {
  const f = r.owner, s = c.p, early = c.now && g.time < (c.ready ?? 0), ord = c.ord!;
  // one formation always stays behind in the region
  const tot = groundUnits(r.units), mine = corpsSize(c);
  if (mine <= 0) { c.ord = 0; return; }
  const n: Partial<Units> = { ...c.u };
  const keepOne = mine >= tot;
  if (keepOne) { for (const k of GROUND_TYPES) if ((n[k] ?? 0) > 0) { n[k]!--; break; } }
  if (!GROUND_TYPES.some(k => (n[k] ?? 0) > 0)) { c.ord = 0; return; }
  const tag = tagOf(c), mor = c.mor, st = c.st ?? r.stance;
  const out = takeCorps(r, c, keepOne ? n : undefined);
  // the one formation left behind holds the border under a new number
  if (keepOne && corpsSize(c) > 0) renumber(g, r, c);
  // fatigue: troops that only just arrived march on as a forced march; straight out of a battle they are tired
  const legs = (r.arrT !== undefined && g.time - r.arrT < 45 ? (r.legs ?? 1) : 0) + 1, worn = r.foughtT !== undefined && g.time - r.foughtT < 60;
  column(g, f, r.id, s, s, r.id, out.u, out.m, mor, { ord, now: early, tired: early || worn, stance: st, front, legs, ct: tag });
  emit(g, { k: 'march', faction: f, from: r.id, to: s, units: groundUnits(out.u) });
}

// ---------------------------------------------------------------- deploying itself

/** Strength a border faces: the men across it, more when an enemy corps there is ordered to attack. A coast: enemy ports and ships on the zone. */
function threat(g: GameState, r: RegionState, n: number): number {
  if (isCoast(n)) return fleetThreat(g, r.owner, zoneOfKey(n));
  const o = g.regions[n]; let att = 0;
  for (const c of corpsAtPost(o, r.id)) if ((c.ord ?? 0) >= 1) att += 2 + corpsSize(c) / 2;
  return 1 + menTotal(o.men) / 400 + att;
}
/** How much a coast on zone `z` is threatened from the sea: enemy ports on the zone, enemy ships in it, an assault fleet offshore. */
export function coastThreat(g: GameState, me: number, z: number): number {
  const W = world(); let t = 0;
  for (const id of W.zones[z]?.coast ?? []) { const o = g.regions[id]; if (o.port && o.owner >= 0 && o.owner !== me && !allied(g, me, o.owner) && !atPeace(g, me, o.owner)) t += .35; }
  return t + fleetThreat(g, me, z);
}
/** The part of a coast's threat that is at sea right now: enemy ships in the zone, an assault fleet offshore. Only this draws troops to a coast. */
export function fleetThreat(g: GameState, me: number, z: number): number {
  let t = 0;
  for (const fl of g.fleets ?? []) if (fl.owner !== me && !allied(g, me, fl.owner) && fl.zs.length && zoneAt(fl.zs, fl.d) === z) t += fl.task === 'assault' ? 2 + groundUnits(fl.cargo) / 4 : .5;
  return t;
}

/** Share of the troops a region sends out that its coasts may take while no landing is on its way. */
export const COAST_SHARE = .15;
/** Threat from which a coast counts as about to be landed on (an assault fleet offshore). */
const LANDING = 2;

/**
 * How a region on Auto spreads its formations: for each post in `foes` (land borders and coasts) the units to stand there.
 * Whole formations are handed out, so nothing is lost to rounding: about (1 − MAIN_SHARE) of them go out, split by the threat
 * `w` with the largest remainders, every land border gets one before any gets a second (as far as they reach), and coasts take
 * at most COAST_SHARE unless a landing is coming. Each manned post gets infantry first; guns, MGs and tanks go to the most
 * threatened posts. A region keeps one formation at the centre.
 */
export function deployTargets(avail: Units, foes: number[], w: number[]): Units[] {
  const target = foes.map(() => emptyUnits());
  const total = GROUND_TYPES.reduce((n, k) => n + Math.max(0, avail[k]), 0);
  if (total < 2 || !foes.length) return target;
  const land = foes.map((s, i) => isCoast(s) ? -1 : i).filter(i => i >= 0);
  let out = Math.round(total * (1 - MAIN_SHARE));
  if (total >= land.length + 2) out = Math.max(out, land.length);
  out = Math.min(out, total - 1);
  if (out <= 0) return target;
  // coasts without a landing on its way share a small part of what goes out
  const ww = [...w], coastW = foes.reduce((a, s, i) => a + (isCoast(s) ? w[i] : 0), 0), landW = land.reduce((a, i) => a + w[i], 0);
  if (land.length && coastW > 0 && !foes.some((s, i) => isCoast(s) && w[i] >= LANDING)) {
    const max = landW * COAST_SHARE / (1 - COAST_SHARE);
    if (coastW > max) foes.forEach((s, i) => { if (isCoast(s)) ww[i] = w[i] * max / coastW; });
  }
  const sw = ww.reduce((a, b) => a + b, 0); if (sw <= 0) return target;
  // whole formations per post, largest remainders first
  const n = ww.map(x => Math.floor(out * x / sw)); let left = out - n.reduce((a, b) => a + b, 0);
  const byRest = foes.map((_, i) => i).sort((a, b) => (out * ww[b] / sw - n[b]) - (out * ww[a] / sw - n[a]) || ww[b] - ww[a] || a - b);
  for (let j = 0; left > 0; j = (j + 1) % byRest.length, left--) n[byRest[j]]++;
  // no land border stays empty while another post holds two or more
  for (const i of [...land].sort((a, b) => ww[b] - ww[a] || a - b)) {
    if (n[i] > 0) continue;
    let from = -1; n.forEach((x, j) => { if (x >= 2 && (from < 0 || x > n[from] || (x === n[from] && ww[j] < ww[from]))) from = j; });
    if (from < 0) break;
    n[from]--; n[i]++;
  }
  // which types go out: each type in proportion, largest remainders first
  const go = emptyUnits(); let g0 = 0;
  for (const k of GROUND_TYPES) { go[k] = Math.floor(Math.max(0, avail[k]) * out / total); g0 += go[k]; }
  const tr = [...GROUND_TYPES].sort((a, b) => (avail[b] * out / total - go[b]) - (avail[a] * out / total - go[a]));
  for (let j = 0; g0 < out; j = (j + 1) % tr.length) { const k = tr[j]; if (go[k] < avail[k]) { go[k]++; g0++; } }
  // infantry mans every post first, then the heavy weapons and the rest go to the most threatened posts
  const order = foes.map((_, i) => i).filter(i => n[i] > 0).sort((a, b) => ww[b] - ww[a] || a - b), room = [...n];
  for (const i of order) if (go.inf > 0) { target[i].inf++; go.inf--; room[i]--; }
  for (const k of ['art', 'mg', 'tank', 'inf'] as const) for (let turn = 0; go[k] > 0 && turn < out + 1; turn++) for (const i of order) { if (go[k] <= 0) break; if (room[i] > 0) { target[i][k]++; go[k]--; room[i]--; } }
  return target;
}

/**
 * A region on Auto keeps about a third of its formations in the depot at the centre and spreads the rest over the borders it
 * shares with foreign powers, by the threat across each, in corps of at most CORPS_CAP battalions. It only moves the depot and
 * the corps it raised itself: corps the player commands (`man`) and corps with an attack order are left alone, and count towards
 * the strength of their border. With `instant` the troops are placed at once (start of the war), otherwise they march.
 */
export function autoDeploy(g: GameState, r: RegionState, instant = false) {
  if (r.owner < 0 || r.deploy === 1 || r.contested >= 0 || r.battle >= 0) return;
  const W = world(), me = r.owner;
  // land borders with foreign powers, and coasts that face a threat from the sea
  const foes = [...W.regions[r.id].land.filter(n => { const o = g.regions[n].owner; return o !== me && !(o >= 0 && allied(g, me, o)); }), ...W.regions[r.id].zones.map(coastKey).filter(k => fleetThreat(g, me, zoneOfKey(k)) > 0)];
  const auto = (c: Corps) => !c.man && c.army === undefined && (c.ord ?? 0) === 0;
  // Auto corps on quiet borders come back to the depot
  for (const c of [...corpsIn(r)]) {
    if (!auto(c) || c.p < 0 || foes.includes(c.p)) continue;
    if (instant) dissolve(r, c);
    else { const p = c.p, n = c.n, out = takeCorps(r, c); if (groundUnits(out.u)) column(g, me, r.id, p, r.id, -1, out.u, out.m, c.mor, { gn: n, gk: 1 }); }
  }
  fixPosts(g, r);
  if (!foes.length) return;
  // what Auto may arrange: the depot and its own corps on the threatened borders
  const avail = depotOf(r).u;
  for (const c of corpsIn(r)) if (auto(c) && c.p >= 0) for (const k of GROUND_TYPES) avail[k] += c.u[k];
  const target = deployTargets(avail, foes, foes.map(n => threat(g, r, n)));
  foes.forEach((s, i) => {
    const mine = corpsAtPost(r, s).filter(auto), cur = emptyUnits(), fixed = emptyUnits();
    for (const c of corpsAtPost(r, s)) for (const k of GROUND_TYPES) (auto(c) ? cur : fixed)[k] += c.u[k];
    const dep = depotOf(r).u;
    const add: Partial<Units> = {}, back: Partial<Units> = {}; let na = 0, nb = 0;
    for (const k of GROUND_TYPES) {
      const d = Math.max(0, target[i][k] - fixed[k]) - cur[k];
      if (d > 0 && dep[k] > 0) { add[k] = Math.min(d, dep[k]); na += add[k]!; }
      else if (d < -1) { back[k] = -d - 1; nb += back[k]!; }
    }
    if (na) {
      const out = takeDepot(r, add);
      if (instant) { for (const c of addToGroup(g, r, s, out.u, out.m, r.mor)) { c.ord = 0; c.since = -DIG_IN; } }
      else column(g, me, r.id, -1, r.id, s, out.u, out.m, r.mor, { ord: 0, gn: armyNo(g, r), gk: 0 });
    }
    if (nb && !instant) {
      for (const c of mine.sort((a, b) => corpsSize(b) - corpsSize(a))) {
        const take: Partial<Units> = {}; let q = 0;
        for (const k of GROUND_TYPES) { take[k] = Math.min(back[k] ?? 0, c.u[k]); back[k] = (back[k] ?? 0) - take[k]!; q += take[k]!; }
        if (!q) continue;
        const n = c.n, mor = c.mor, out = takeCorps(r, c, take);
        column(g, me, r.id, s, r.id, -1, out.u, out.m, mor, { gn: n, gk: 1 });
      }
    }
  });
  fixPosts(g, r);
}

/** Every convoy, regions that deploy themselves re-balance their idle troops. */
export function deployOnConvoy(g: GameState) { for (const r of g.regions) autoDeploy(g, r); }

/** Columns of a power heading for (or forming up against) region `to`. */
export const columnsAgainst = (g: GameState, f: number, to: number) => g.armies.filter(a => a.owner === f && a.post !== undefined && ((a.inner && a.post === to && (a.ord ?? 0) >= 1) || (!a.inner && a.to === to)));

export type { UnitType };
