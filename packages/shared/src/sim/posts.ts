// Deployment inside a region and phased offensives.
//
// Every region has a main army in the middle and at most one corps per border. A corps is a share of the region's formations
// (`RegionState.fr`); the main army is whatever is not in a corps, so economy, supply and fog keep reading `units` as the
// region's total. Troops move between posts and regions as columns (`Army` with `post`), and every move takes the distance
// along the path (centre → border → across → border → centre) divided by the marching speed.
//
// An offensive runs in phases: troops called up from the main army form up (FORM), march to the border facing the target,
// assemble there (ASSEMBLE), and then the corps holds, takes the enemy's first line, or invades. The battle stages that follow
// (first line → consolidation → depth) live in battle.ts.
import { GROUND_TYPES, TICK_SECONDS, UNIT_TYPES, emptyUnits, groundUnits, totalUnits, type Units, type UnitType } from '../data/units';
import { wrapDx } from '../world/build';
import { sectorPoint } from '../world/sectors';
import { coastKey, isCoast, zoneAt, zoneOfKey } from '../world/zones';
import { emit, frontsOf, menTotal, takeForce, world } from './core';
import { allied, atPeace } from './diplomacy';
import { marchFactor, weatherMarch } from './rails';
import { PACES, type Army, type Corps, type GameState, type Order, type RegionState, type Stance } from './types';

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

export const corpsOf = (r: RegionState) => r.fr ?? {};
/** Borders that have a corps, in a fixed order. */
export const corpsPosts = (r: RegionState) => Object.keys(r.fr ?? {}).map(Number);

/** Formations of the main army: the region's units not standing in a corps. */
export function mainOf(r: RegionState): Units {
  const u = { ...r.units };
  for (const c of Object.values(r.fr ?? {})) for (const k of GROUND_TYPES) u[k] = Math.max(0, u[k] - c.u[k]);
  return u;
}
/** Formations of a group: -1 the main army, else the corps of that border (empty if there is none). */
export const groupUnits = (r: RegionState, post: number): Units => post < 0 ? mainOf(r) : r.fr?.[post]?.u ?? emptyUnits();
/** Men of a group (formations of a region share its strength evenly). */
export function groupMen(r: RegionState, u: Units): number {
  let m = 0; for (const k of UNIT_TYPES) if (r.units[k] > 0) m += r.men[k] * Math.min(1, u[k] / r.units[k]); return m;
}

/** Number of the region's main army, raised on first use. */
export function armyNo(g: GameState, r: RegionState): number {
  if (r.an === undefined && r.owner >= 0) { const f = g.factions[r.owner]; f.nArmy = (f.nArmy ?? 0) + 1; r.an = f.nArmy; }
  return r.an ?? -1;
}
/** The corps on a border, raised (with the power's next number) if there is none. */
export function corpsAt(g: GameState, r: RegionState, post: number, n?: number): Corps {
  const fr = (r.fr ??= {});
  let c = fr[post];
  if (!c) { const f = g.factions[r.owner]; if (n === undefined || n < 1) { f.nCorps = (f.nCorps ?? 0) + 1; n = f.nCorps; } c = fr[post] = { u: emptyUnits(), n, since: g.time }; }
  return c;
}

/**
 * Keep corps consistent with the region: a corps never holds more formations than the region has (battles, wear and losses
 * take from the total), aircraft stay with the main army, empty corps and corps of lost borders are dissolved.
 */
export function fixPosts(g: GameState, r: RegionState) {
  if (r.owner < 0) { r.fr = undefined; r.an = undefined; return; }
  if (groundUnits(mainOf(r)) > 0) armyNo(g, r);
  const fr = r.fr; if (!fr) return;
  const secs = world().regions[r.id].sectors, keys = corpsPosts(r);
  for (const s of keys) { fr[s].u.plane = 0; if (!secs.includes(s)) delete fr[s]; }
  for (const k of GROUND_TYPES) {
    let over = -r.units[k]; for (const s of keys) if (fr[s]) over += fr[s].u[k];
    while (over > 0) {
      let big = -1; for (const s of keys) if (fr[s] && (big < 0 || fr[s].u[k] > fr[big].u[k])) big = s;
      if (big < 0 || fr[big].u[k] <= 0) break;
      const n = Math.min(over, fr[big].u[k]); fr[big].u[k] -= n; over -= n;
    }
  }
  for (const s of keys) if (fr[s] && totalUnits(fr[s].u) <= 0) delete fr[s];
  if (!Object.keys(fr).length) r.fr = undefined;
}

/**
 * Take formations out of a group (`post` -1 the main army, else a corps): a share `frac` of each type, or exact counts `n`.
 * Ground troops only. The formations leave the region's totals with their share of its men.
 */
export function takeGroup(r: RegionState, post: number, frac: number, n?: Partial<Units>): { u: Units; m: Units } {
  const src = groupUnits(r, post), out = { u: emptyUnits(), m: emptyUnits() };
  const want = emptyUnits(); let any = 0;
  for (const k of GROUND_TYPES) { want[k] = Math.max(0, Math.min(src[k], n ? n[k] ?? 0 : Math.round(src[k] * Math.max(0, Math.min(1, frac))))); any += want[k]; }
  if (!any && !n && frac > 0) for (const k of GROUND_TYPES) if (src[k] > 0) { want[k] = 1; break; }
  for (const k of GROUND_TYPES) {
    if (!want[k]) continue;
    out.m[k] = takeForce(r.units, r.men, k, want[k]); out.u[k] = want[k];
    if (post >= 0 && r.fr?.[post]) r.fr[post].u[k] -= want[k];
  }
  return out;
}

/** Put formations into a group of a region (they join its totals; a corps is raised if needed). */
export function addToGroup(g: GameState, r: RegionState, post: number, u: Units, m: Units, mor: number, n?: number): Corps | null {
  const before = groundUnits(r.units), add = groundUnits(u);
  for (const k of UNIT_TYPES) { r.units[k] += u[k]; r.men[k] += m[k]; }
  if (add) r.mor = (r.mor * before + mor * add) / (before + add);
  if (post < 0) return null;
  const c = corpsAt(g, r, post, n);
  for (const k of GROUND_TYPES) c.u[k] += u[k];
  return c;
}

/** Seconds troops called up from the main army need to form up for an offensive. */
export function formTime(g: GameState, r: RegionState, u: Units): number {
  const t = Math.min(FORM_MAX, FORM_BASE + FORM_PER * groundUnits(u)) * (r.barracks || r.capitalOf === r.owner ? .5 : 1);
  return t * moveK(g);
}

// ---------------------------------------------------------------- columns

export interface ColumnOpts { wait?: number; ord?: Order; now?: boolean; path?: number[]; fin?: number; front?: number; stance?: Stance; legs?: number; tired?: boolean; gn?: number; gk?: number }

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
    column(g, a.owner, a.to, a.post!, nx, rest.length ? rest[0] : a.fin ?? -1, a.units, a.men, a.mor, { ord: a.ord, now: a.now, path: rest, fin: a.fin, stance: a.stance, legs: (a.legs ?? 1) + 1, gn: a.gn, gk: a.gk });
    return true;
  }
  if (friendly && t.owner !== a.owner) {
    // an allied region has no post for our troops: they march on to a region of ours next to it
    const home = world().regions[t.id].land.find(j => g.regions[j].owner === a.owner);
    if (home !== undefined) column(g, a.owner, t.id, a.post ?? -1, home, -1, a.units, a.men, a.mor, { stance: a.stance });
    return true;
  }
  if (t.owner === a.owner) {
    // a front of this region burns on the border they march to: they join it
    const post = a.post ?? -1;
    const fb = post >= 0 ? frontsOf(g, t.id).find(b => b.from === post && b.def === a.owner) : undefined;
    if (fb && join(fb.id)) return true;
    const c = addToGroup(g, t, post, a.units, a.men, a.mor, a.gk === 1 ? a.gn : undefined);
    t.arrT = g.time; t.legs = a.legs ?? 1;
    if (c) {
      if (a.stance !== undefined) c.st = a.stance;
      if (a.ord !== undefined) { c.ord = a.ord; c.now = a.now || c.now; }
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
    if (back !== undefined) column(g, a.owner, t.id, a.post ?? -1, back, -1, a.units, a.men, a.mor, { tired: true, stance: a.stance });
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
    if (!r.fr || r.owner < 0) continue;
    for (const s of corpsPosts(r)) {
      const c = r.fr?.[s]; if (!c || (c.ord ?? 0) < 1) continue;
      const tgt = g.regions[s], f = r.owner;
      if (tgt.owner === f || (tgt.owner >= 0 && (allied(g, f, tgt.owner) || atPeace(g, f, tgt.owner)))) { c.ord = 0; c.now = false; c.since = g.time; continue; }
      if (!c.now && g.time < (c.ready ?? 0)) continue;
      // a foothold of ours on this front: an invasion order carries the attack into the depth
      const fb = frontsOf(g, s).find(b => b.from === r.id && b.attacker === f);
      if (fb) {
        if (c.ord === 2 && fb.stage === 3) { fb.stage = 1; fb.stT = fb.age; fb.goal = 2; emit(g, { k: 'advance', faction: f, region: s }); }
        // the corps' troops follow into the battle
      } else if (canAttack(g, f, s)) continue;
      launchCorps(g, r, s, c, fb?.id);
    }
  }
}

function launchCorps(g: GameState, r: RegionState, s: number, c: Corps, front?: number) {
  const f = r.owner, early = c.now && g.time < (c.ready ?? 0), ord = c.ord!;
  // one formation always stays behind in the region
  const tot = groundUnits(r.units), mine = groundUnits(c.u);
  if (mine <= 0) { c.ord = 0; return; }
  const n: Partial<Units> = { ...c.u };
  if (mine >= tot) { for (const k of GROUND_TYPES) if ((n[k] ?? 0) > 0) { n[k]!--; break; } }
  if (!GROUND_TYPES.some(k => (n[k] ?? 0) > 0)) { c.ord = 0; return; }
  const out = takeGroup(r, s, 0, n);
  // fatigue: troops that only just arrived march on as a forced march; straight out of a battle they are tired
  const legs = (r.arrT !== undefined && g.time - r.arrT < 45 ? (r.legs ?? 1) : 0) + 1, worn = r.foughtT !== undefined && g.time - r.foughtT < 60;
  column(g, f, r.id, s, s, r.id, out.u, out.m, r.mor, { ord, now: early, tired: early || worn, stance: c.st ?? r.stance, front, gn: c.n, gk: 1, legs });
  c.ord = 0; c.now = false; c.since = g.time;
  emit(g, { k: 'march', faction: f, from: r.id, to: s, units: groundUnits(out.u) });
}

// ---------------------------------------------------------------- deploying itself

/** Strength a border faces: the men across it, more when an enemy corps there is ordered to attack. A coast: enemy ports and ships on the zone. */
function threat(g: GameState, r: RegionState, n: number): number {
  if (isCoast(n)) return coastThreat(g, r.owner, zoneOfKey(n));
  const o = g.regions[n], c = o.fr?.[r.id];
  return 1 + menTotal(o.men) / 400 + (c && (c.ord ?? 0) >= 1 ? 2 + groundUnits(c.u) / 2 : 0);
}
/** How much a coast on zone `z` is threatened from the sea: enemy ports on the zone, enemy ships in it, an assault fleet offshore. */
export function coastThreat(g: GameState, me: number, z: number): number {
  const W = world(); let t = 0;
  for (const id of W.zones[z]?.coast ?? []) { const o = g.regions[id]; if (o.port && o.owner >= 0 && o.owner !== me && !allied(g, me, o.owner) && !atPeace(g, me, o.owner)) t += .35; }
  for (const fl of g.fleets ?? []) if (fl.owner !== me && !allied(g, me, fl.owner) && fl.zs.length && zoneAt(fl.zs, fl.d) === z) t += fl.task === 'assault' ? 2 + groundUnits(fl.cargo) / 4 : .5;
  return t;
}

/**
 * A region that deploys itself keeps about a third of its formations with the main army and spreads the rest over the
 * borders it shares with foreign powers, by the threat across each. Corps with an attack order are left alone. With
 * `instant` the troops are placed at once (start of the war), otherwise they march.
 */
export function autoDeploy(g: GameState, r: RegionState, instant = false) {
  if (r.owner < 0 || r.deploy === 1 || r.contested >= 0 || r.battle >= 0) return;
  const W = world(), me = r.owner;
  // land borders with foreign powers, and coasts that face a threat from the sea
  const foes = [...W.regions[r.id].land.filter(n => { const o = g.regions[n].owner; return o !== me && !(o >= 0 && allied(g, me, o)); }), ...W.regions[r.id].zones.map(coastKey).filter(k => coastThreat(g, me, zoneOfKey(k)) > 0)];
  // corps on quiet borders come back to the main army
  for (const s of corpsPosts(r)) {
    const c = r.fr![s]; if ((c.ord ?? 0) >= 1 || foes.includes(s)) continue;
    if (instant) delete r.fr![s];
    else { const out = takeGroup(r, s, 1); if (groundUnits(out.u)) column(g, me, r.id, s, r.id, -1, out.u, out.m, r.mor, { gn: armyNo(g, r), gk: 0 }); }
  }
  fixPosts(g, r);
  if (!foes.length) return;
  const avail = { ...r.units }; for (const c of Object.values(r.fr ?? {})) if ((c.ord ?? 0) >= 1) for (const k of GROUND_TYPES) avail[k] -= c.u[k];
  const w = foes.map(n => threat(g, r, n)), sw = w.reduce((a, b) => a + b, 0);
  const target = foes.map(() => emptyUnits());
  for (const k of GROUND_TYPES) {
    const share = Math.max(0, avail[k]) * (1 - MAIN_SHARE);
    foes.forEach((_, i) => { target[i][k] = Math.floor(share * w[i] / sw); });
  }
  // a region with a few battalions still mans its most threatened border
  if (target.every(t => groundUnits(t) === 0) && avail.inf >= 2) { let bi = 0; w.forEach((x, i) => { if (x > w[bi]) bi = i; }); target[bi].inf = 1; }
  foes.forEach((s, i) => {
    const c = r.fr?.[s]; if (c && (c.ord ?? 0) >= 1) return;
    const cur = c?.u ?? emptyUnits(), main = mainOf(r);
    const add: Partial<Units> = {}, back: Partial<Units> = {}; let na = 0, nb = 0;
    for (const k of GROUND_TYPES) {
      const d = target[i][k] - cur[k];
      if (d > 0 && main[k] > 0) { add[k] = Math.min(d, main[k]); na += add[k]!; }
      else if (d < -1) { back[k] = -d - 1; nb += back[k]!; }
    }
    if (instant) {
      if (na) { const cc = corpsAt(g, r, s); cc.ord = 0; cc.since = -DIG_IN; for (const k of GROUND_TYPES) cc.u[k] += add[k] ?? 0; }
      return;
    }
    if (na) { const out = takeGroup(r, -1, 0, add); column(g, me, r.id, -1, r.id, s, out.u, out.m, r.mor, { ord: 0, gn: armyNo(g, r), gk: 0 }); }
    if (nb && c) { const out = takeGroup(r, s, 0, back); column(g, me, r.id, s, r.id, -1, out.u, out.m, r.mor, { gn: c.n, gk: 1 }); }
  });
  fixPosts(g, r);
}

/** Every convoy, regions that deploy themselves re-balance their idle troops. */
export function deployOnConvoy(g: GameState) { for (const r of g.regions) autoDeploy(g, r); }

/** Columns of a power heading for (or forming up against) region `to`. */
export const columnsAgainst = (g: GameState, f: number, to: number) => g.armies.filter(a => a.owner === f && a.post !== undefined && ((a.inner && a.post === to && (a.ord ?? 0) >= 1) || (!a.inner && a.to === to)));

export type { UnitType };
