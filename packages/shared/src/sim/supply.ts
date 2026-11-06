// Logistics and manpower (command overhaul §3.3, §4): supply capacity and load, why a region is cut off, recruits in training,
// replacements from the manpower pool, wounded coming back to the pool, and the war economy lever.
import { FORMATION, GROUND_TYPES, SHELLS, TICK_SECONDS, UNIT_TYPES, UT, emptyUnits, isDef, type UnitType, type Units } from '../data/units';
import { nationOf } from '../data/nations';
import { weatherAt } from '../data/terrain';
import { emit, world } from './core';
import { addToGroup, corpsIn, depotOf, fixPosts, refill, takeDepot } from './posts';
import { hasRail, linkQuality } from './rails';
import { seaLinks } from './navy';
import { allied } from './diplomacy';
import type { Corps, FactionState, GameState, RegionState } from './types';

// ---------------------------------------------------------------- capacity

/** Supply points a battalion draws per week. */
export const DRAW: Record<UnitType, number> = { inf: 1, mg: 1, art: 2, tank: 2, plane: 1 };
/** Capacity by supply route (rail, road, cut off), per depot in the region, and per own rail link into it from the second. */
export const CAP = { rail: 24, road: 10, depot: 12, link: 4 } as const;
/** Load above capacity: over (no replacements, dearer shells, morale falls) and far over (men fall sick and hungry). */
export const OVER = { morale: 2, far: 1.5, farWear: .03, shells: 1.5 } as const;

export interface CapTerm { k: 'route' | 'depot' | 'link' | 'weather'; v: number; n?: number; w?: number }

/** Depots in a region: its capital, a factory, a harbour. */
export const depots = (r: RegionState) => (r.capitalOf === r.owner && r.owner >= 0 ? 1 : 0) + (r.factory ? 1 : 0) + (r.port ? 1 : 0);

/** Capacity of an own region in supply points per week, with its terms (route, depots, rail links, weather). */
export function capTerms(g: GameState, r: RegionState): { cap: number; terms: CapTerm[] } {
  const terms: CapTerm[] = [];
  if (r.owner < 0 || r.cut) return { cap: 0, terms: [{ k: 'route', v: 0 }] };
  const q = r.supplyQ ?? 2;
  terms.push({ k: 'route', v: q >= 2 ? CAP.rail : CAP.road });
  const d = depots(r); if (d) terms.push({ k: 'depot', v: d * CAP.depot, n: d });
  const W = world(), links = W.regions[r.id].adj.filter(j => { const o = g.regions[j].owner; return (o === r.owner || allied(g, r.owner, o)) && hasRail(g, r.id, j); }).length;
  if (links > 1) terms.push({ k: 'link', v: (links - 1) * CAP.link, n: links });
  const base = terms.reduce((s, t) => s + t.v, 0);
  const w = weatherAt(r.id, g.day), N = nationOf(r.owner);
  const cut = w === 1 ? .2 : w === 2 ? (N.flags.siberian ? .15 : .3) : w === 3 ? .15 : 0;
  if (cut) terms.push({ k: 'weather', v: -Math.round(base * cut), w });
  return { cap: Math.max(0, terms.reduce((s, t) => s + t.v, 0)), terms };
}
export const capacity = (g: GameState, r: RegionState) => capTerms(g, r).cap;

/** Draw of some battalions. */
export const drawOf = (u: Partial<Units>) => UNIT_TYPES.reduce((s, k) => s + (u[k] ?? 0) * DRAW[k], 0);

/** Load of a region: every battalion of its owner in it, those fighting in its battles and those attacking out of it. */
export function load(g: GameState, r: RegionState): number {
  let v = drawOf(r.units);
  for (const b of g.battles) {
    if (b.ended || (b.region !== r.id && !(b.from === r.id && b.attacker === r.owner))) continue;
    for (const a of b.agents) if (a.f === r.owner && !a.dead && !a.out && !isDef(a.type)) v += DRAW[a.type as UnitType] ?? 0;
    // a mirror without streamed agents only has the head counts
    if (!b.agents.length) for (const [f, alive] of b.counts ?? []) if (f === r.owner) v += alive;
  }
  return v;
}

/** Load ÷ capacity (Infinity when cut off with troops in it, 0 when empty). */
export function loadRatio(g: GameState, r: RegionState): number {
  const l = load(g, r), c = capacity(g, r);
  return l <= 0 ? 0 : c <= 0 ? Infinity : l / c;
}
export const overCap = (g: GameState, r: RegionState) => loadRatio(g, r) > 1;

/**
 * Why an own region is cut off: the hostile region next to the cut-off pocket that most likely broke the route – one that was
 * someone else's home (taken in this war) before one that always was theirs. -1 when it is not cut off or nothing is found.
 */
export function cutBreak(g: GameState, r: RegionState): number {
  if (!r.cut || r.owner < 0) return -1;
  const W = world(), o = r.owner, pocket = new Set([r.id]), q = [r.id], edge = new Set<number>();
  for (let h = 0; h < q.length; h++) for (const j of W.regions[q[h]].adj) {
    const n = g.regions[j];
    if (n.owner === o && n.cut) { if (!pocket.has(j)) { pocket.add(j); q.push(j); } }
    else if (n.owner !== o && n.owner >= 0 && !allied(g, o, n.owner)) edge.add(j);
  }
  const score = (j: number) => { const n = g.regions[j]; return (n.home === o ? 4 : n.home !== n.owner ? 2 : 0) + (n.battle >= 0 ? 1 : 0); };
  return [...edge].sort((a, b) => score(b) - score(a) || a - b)[0] ?? -1;
}

/** One leg of a supply route: from region `a` to `b`, by rail (2) or road (1), over land or a sea lane. */
export interface RouteLeg { a: number; b: number; q: number; sea: boolean }

/** Is a region a supply source for its owner: its capital, a factory region, or home territory (not contested)? */
export const isSource = (r: RegionState) => r.owner >= 0 && r.contested < 0 && (r.capitalOf === r.owner || r.factory || r.home === r.owner);

/**
 * The route that supplies an own region: the cheapest chain of own (or allied) regions back to a source, rail legs preferred
 * (a road leg costs three rail legs). Empty for a source itself; null when the region is cut off.
 */
export function supplyRoute(g: GameState, r: RegionState): RouteLeg[] | null {
  const o = r.owner; if (o < 0 || r.cut) return null;
  if (isSource(r)) return [];
  const W = world(), N = g.regions.length, dist = new Float64Array(N).fill(Infinity), prev: (RouteLeg | null)[] = new Array(N).fill(null);
  const sea = new Map<number, [number, number][]>();
  for (const [a, b, ql] of seaLinks(g, o)) { (sea.get(a) ?? sea.set(a, []).get(a)!).push([b, ql]); (sea.get(b) ?? sea.set(b, []).get(b)!).push([a, ql]); }
  const ok = (j: number) => { const oj = g.regions[j].owner; return oj === o || allied(g, o, oj); };
  dist[r.id] = 0; const open = new Set([r.id]);
  while (open.size) {
    let i = -1, best = Infinity; for (const k of open) if (dist[k] < best) { best = dist[k]; i = k; }
    open.delete(i);
    const R = g.regions[i]; if (i !== r.id && R.owner === o && isSource(R)) {
      const legs: RouteLeg[] = []; for (let k = i; k !== r.id; k = prev[k]!.a) legs.push(prev[k]!);
      // from the region to the source
      return legs.reverse();
    }
    const step = (j: number, q: number, isSea: boolean) => {
      if (q < 1 || !ok(j)) return; const d = best + (q >= 2 ? 1 : 3);
      if (d < dist[j]) { dist[j] = d; prev[j] = { a: i, b: j, q, sea: isSea }; open.add(j); }
    };
    for (const j of W.regions[i].adj) if (!W.seaLane.has(i + '|' + j)) step(j, linkQuality(g, o, i, j), false); else step(j, linkQuality(g, o, i, j), true);
    for (const [j, ql] of sea.get(i) ?? []) step(j, ql, true);
  }
  return null;
}

// ---------------------------------------------------------------- training

/** Recruits in training: they arrive in the region's depot when ready (a commander's go to the border that asked for them). */
export interface Trainee { f: number; k: UnitType; at: number; p?: number; army?: number }
/** Seconds a battalion trains (one week), and the cost factor of emergency levies raised at once in a region under attack. */
export const TRAIN = TICK_SECONDS, LEVY_COST = 2;

/** Put a recruit into training: one week, or at the next convoy with barracks. */
export function train(g: GameState, r: RegionState, k: UnitType, o: { p?: number; army?: number } = {}) {
  const left = TICK_SECONDS - g.supplyT, at = g.time + (r.barracks ? Math.min(TRAIN, left) : TRAIN);
  (r.train ??= []).push({ f: r.owner, k, at, ...o });
}

/** Battalions in training in a region (all, or those for one post). */
export function inTraining(r: RegionState, post?: number): Units {
  const u = emptyUnits(); for (const t of r.train ?? []) if (post === undefined || t.p === post) u[t.k]++; return u;
}

/** Trained battalions join the region; a region lost meanwhile loses its recruits. */
export function stepTraining(g: GameState, add: (r: RegionState, k: UnitType) => void) {
  for (const r of g.regions) {
    if (!r.train?.length) continue;
    const keep: Trainee[] = []; let ready = 0;
    for (const t of r.train) {
      if (t.f !== r.owner) continue;
      if (t.at > g.time) { keep.push(t); continue; }
      add(r, t.k); if (t.p === undefined && t.k !== 'plane') ready++;
      // for a commander: onto the border that asked, in his army (unless the region is fighting – then they stay with the depot)
      if (t.p !== undefined && r.battle < 0 && depotOf(r).u[t.k] > 0) { const out = takeDepot(r, { [t.k]: 1 }); addToGroup(g, r, t.p, out.u, out.m, r.mor, { id: -1, n: 0, army: t.army }); }
    }
    r.train = keep.length ? keep : undefined;
    if (ready) emit(g, { k: 'trained', faction: r.owner, region: r.id, n: ready });
  }
}

// ---------------------------------------------------------------- replacements and wounded

/** Replacements per week: at most this share of a formation's full strength. Wounded: share of the losses that come back, after days. */
export const REPL = { share: .15 } as const;
export const WOUNDED = { share: .35, days: 14 } as const;

/** Men missing in a corps (or depot), per type. */
const gaps = (u: Units, m: Units): Units => { const o = emptyUnits(); for (const k of GROUND_TYPES) o[k] = Math.max(0, u[k] * FORMATION[k].men - m[k]); return o; };
const capOf = (u: Units, k: UnitType) => Math.ceil(u[k] * FORMATION[k].men * REPL.share);

/** Can a region take replacements: own, supplied, not over capacity, not in a battle, not on strike. */
export const replOk = (g: GameState, r: RegionState) => r.owner >= 0 && !r.cut && r.battle < 0 && !overCap(g, r);

/** What replacements a region's formations would take this week: [corps, men] pairs (`c` null for the depot), front line first. */
export function replNeeds(g: GameState, r: RegionState): { c: Corps | null; k: UnitType; n: number }[] {
  if (!replOk(g, r)) return [];
  const out: { c: Corps | null; k: UnitType; n: number }[] = [];
  const cs = corpsIn(r).filter(c => !c.nr).sort((a, b) => (b.p >= 0 ? 1 : 0) - (a.p >= 0 ? 1 : 0));
  for (const c of cs) { const gp = gaps(c.u, c.m); for (const k of GROUND_TYPES) if (gp[k] > 0) out.push({ c, k, n: Math.min(gp[k], capOf(c.u, k)) }); }
  const d = depotOf(r), gd = gaps(d.u, d.m);
  for (const k of GROUND_TYPES) if (gd[k] > 0) out.push({ c: null, k, n: Math.min(gd[k], capOf(d.u, k)) });
  return out;
}

/** Men the replacements of a power would take next week (all of them if the pool allowed). */
export const replWanted = (g: GameState, fid: number) => g.regions.filter(r => r.owner === fid).reduce((s, r) => s + replNeeds(g, r).reduce((a, x) => a + x.n, 0), 0);

/** Weekly replacements: under-strength corps (front line first, then reserves, then depots) take men from the pool. */
export function replacements(g: GameState, f: FactionState): number {
  const needs = g.regions.filter(r => r.owner === f.id).flatMap(r => replNeeds(g, r).map(x => ({ ...x, r }))).sort((a, b) => (b.c && b.c.p >= 0 ? 1 : 0) - (a.c && a.c.p >= 0 ? 1 : 0));
  let given = 0;
  for (const x of needs) {
    const n = Math.min(x.n, Math.floor(f.men ?? 0)); if (n <= 0) break;
    f.men -= n; given += n; x.r.men[x.k] += n;
    if (x.c) x.c.m[x.k] += n;
  }
  for (const r of new Set(needs.map(x => x.r))) fixPosts(g, r);
  return given;
}

/** Casualties: a share comes back to the pool after two weeks. */
export function woundedIn(g: GameState, f: FactionState, lost: number) {
  const n = lost * WOUNDED.share; if (n <= 0) return;
  const due = g.day + WOUNDED.days, q = (f.wq ??= []), last = q[q.length - 1];
  if (last && last[1] === due) last[0] += n; else q.push([n, due]);
  f.wounded = q.reduce((s, [m]) => s + m, 0);
}
/** Wounded due back by a day (without taking them). */
export const woundedDue = (f: FactionState, day: number) => (f.wq ?? []).reduce((s, [m, d]) => s + (d <= day ? m : 0), 0);
/** The wounded due by today go back to the pool. */
export function woundedBack(g: GameState, f: FactionState): number {
  const q = f.wq ?? [], back = woundedDue(f, g.day);
  f.wq = q.filter(([, d]) => d > g.day); f.men = (f.men ?? 0) + Math.floor(back);
  f.wounded = f.wq.reduce((s, [m]) => s + m, 0);
  return Math.floor(back);
}

// ---------------------------------------------------------------- war economy

/** War economy lever: the share of factory output that goes to shells (Civil, Balanced, Munitions first). */
export const ECON = [{ name: 'Civil', shells: .25 }, { name: 'Balanced', shells: .5 }, { name: 'Munitions first', shells: .75 }] as const;
export const econOf = (f: FactionState | undefined) => Math.max(0, Math.min(2, f?.econ ?? 1));
/** Factory output to Production and to shells, relative to Balanced (Civil 1.5 / 0.5, Balanced 1 / 1, Munitions first 0.5 / 1.5). */
export const econSplit = (f: FactionState | undefined) => { const s = ECON[econOf(f)].shells; return { prod: (1 - s) / .5, shells: s / .5 }; };

/** Shells a power's batteries burn in a week of light barrage (every battery firing). */
export function barrageBurn(g: GameState, fid: number): number {
  let art = 0; for (const r of g.regions) if (r.owner === fid) art += r.units.art;
  for (const b of g.battles) if (!b.ended) for (const a of b.agents) if (a.f === fid && a.type === 'art' && !a.dead && !a.out) art++;
  return art * TICK_SECONDS / UT.art.rof * SHELLS.shot;
}
/** Weeks of light barrage the stock lasts (Infinity without guns). */
export const barrageWeeks = (g: GameState, fid: number) => { const b = barrageBurn(g, fid); return b > 0 ? (g.factions[fid]?.shells ?? 0) / b : Infinity; };

/** The manpower ledger of the week that is running: men raised into training. Rolled into `FactionState.led` at each convoy. */
export function countRecruit(f: FactionState, men: number) { f.wk = f.wk ?? [0, 0, 0, 0]; f.wk[2] += men; }
