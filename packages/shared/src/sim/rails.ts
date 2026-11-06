// Rails: the 1914 network, links cut by air strikes or sabotage, new lines under construction. Rails speed up marches between
// your own regions and decide supply quality: rail to a source is full supply, land or sea only is thin, no route is cut off.
import { RAIL_BUILD, RAIL_CUT, RAIL_FERRIES, RAIL_LINKS } from '../data/rails';
import { nationOf } from '../data/nations';
import { weatherAt } from '../data/terrain';
import { buildWorld } from '../world/build';
import { emit } from './core';
import { seaQuality } from './navy';
import type { GameState } from './types';

export const railKey = (a: number, b: number) => a < b ? a + '|' + b : b + '|' + a;
let base: Set<string> | null = null, ferries: Set<string> | null = null;
function baseRails() {
  if (base) return base;
  const W = buildWorld(); base = new Set(RAIL_LINKS.map(([a, b]) => railKey(W.byName[a].id, W.byName[b].id)));
  ferries = new Set(RAIL_FERRIES.map(([a, b]) => railKey(W.byName[a].id, W.byName[b].id)));
  return base;
}
/** Is there a railway between two regions (built and finished)? */
export function hasRail(g: GameState, a: number, b: number): boolean {
  const k = railKey(a, b); if (baseRails().has(k)) return true;
  for (const [x, y, ready] of g.railNew ?? []) if (railKey(x, y) === k && g.day >= ready) return true;
  return false;
}
/** A railway that is not cut. */
export const railOpen = (g: GameState, a: number, b: number) => hasRail(g, a, b) && !((g.railCut?.[railKey(a, b)] ?? -1) > g.day);
/** Every rail link of a region: [neighbour, open]. */
export function railsOf(g: GameState, r: number): [number, boolean][] {
  return buildWorld().regions[r].adj.filter(n => hasRail(g, r, n)).map(n => [n, railOpen(g, r, n)]);
}
/** All rail links on the map (finished ones), as [a, b] pairs. */
export function allRails(g: GameState): [number, number][] {
  const out: [number, number][] = [];
  for (const k of baseRails()) { const [a, b] = k.split('|').map(Number); out.push([a, b]); }
  for (const [a, b, ready] of g.railNew ?? []) if (g.day >= ready) out.push([a, b]);
  return out;
}
const isFerry = (a: number, b: number) => { baseRails(); return ferries!.has(railKey(a, b)); };

/** Rail speed-up for a power's marches (Germany's interior lines in Europe are faster still). */
export function railSpeed(f: number, a: number, b: number) {
  const W = buildWorld();
  return nationOf(f).flags.interior && W.regions[a].cont === 'EU' && W.regions[b].cont === 'EU' ? 4 : 3;
}

/** Weather slows marches into a region: mud +30%, winter +40% (Russian troops suffer half as much). */
export function weatherMarch(g: GameState, f: number, to: number) {
  const w = weatherAt(to, g.day);
  if (w === 1) return 1.3;
  if (w === 2) return nationOf(f).flags.siberian ? 1.2 : 1.4;
  return 1;
}

/** Time multiplier of a march: by rail between two of the power's own regions, and the weather where it goes. */
export function marchFactor(g: GameState, f: number, from: number, to: number): { k: number; rail: boolean } {
  const rail = g.regions[from].owner === f && g.regions[to].owner === f && railOpen(g, from, to) && (!buildWorld().seaLane.has(from + '|' + to) || isFerry(from, to));
  return { k: (rail ? 1 / railSpeed(f, from, to) : 1) * weatherMarch(g, f, to), rail };
}

/** Quality of a link between two regions of power `o` for supply: 2 full, 1 thin, 0 none. */
export function linkQuality(g: GameState, o: number, a: number, b: number): number {
  const W = buildWorld();
  if (!W.seaLane.has(a + '|' + b)) return railOpen(g, a, b) ? 2 : 1;
  if (isFerry(a, b) && railOpen(g, a, b)) return 2;
  // over the water: who holds the zone the lane runs through (an enemy there cuts it; the own navy there makes it full)
  const ra = g.regions[a], rb = g.regions[b], z = W.laneZone.get(a + '|' + b) ?? -1;
  const hub = (r: typeof ra) => r.factory || r.capitalOf === r.owner || !!r.port;
  return seaQuality(g, o, z >= 0 ? [z] : [], hub(ra) && hub(rb));
}

/** Lay a railway between two neighbouring regions of your own. */
export function buildRail(g: GameState, fid: number, a: number, b: number): string | null {
  const W = buildWorld(), A = g.regions[a], B = g.regions[b], f = g.factions[fid];
  if (!A || !B) return 'Unknown region.';
  if (A.owner !== fid || B.owner !== fid) return 'Railways are laid between two neighbouring regions of your own.';
  if (!W.regions[a].adj.includes(b) || W.seaLane.has(a + '|' + b)) return `${W.regions[b].name} has no land border with ${W.regions[a].name}.`;
  if (A.contested >= 0 || B.contested >= 0) return 'Enemy holdouts block the line. Storm them first.';
  if (hasRail(g, a, b)) return 'A railway already runs there.';
  if ((g.railNew ??= []).some(([x, y]) => railKey(x, y) === railKey(a, b))) return 'The line is already being laid.';
  if (f.supply < RAIL_BUILD.cost) return `Not enough supply: a railway costs ${RAIL_BUILD.cost}.`;
  f.supply -= RAIL_BUILD.cost; g.railNew.push([a, b, g.day + RAIL_BUILD.days]);
  return null;
}

/** Cut every rail link of a region (air strike) or one link (sabotage) until a day. */
export function cutRails(g: GameState, by: number, region: number, to: number | null, how: 'air' | 'spy') {
  const until = g.day + RAIL_CUT[how];
  for (const n of to === null ? buildWorld().regions[region].adj : [to]) if (hasRail(g, region, n)) { const k = railKey(region, n); g.railCut[k] = Math.max(g.railCut[k] ?? 0, until); }
  emit(g, { k: 'railCut', faction: by, region, by: how, owner: g.regions[region].owner });
}

/** Convoy bookkeeping: forget expired cuts and announce finished lines. */
export function railsOnConvoy(g: GameState) {
  for (const k of Object.keys(g.railCut ?? {})) if (g.railCut[k] <= g.day) delete g.railCut[k];
  for (const [a, b, ready] of g.railNew ?? []) if (ready > g.day - 7 && ready <= g.day) emit(g, { k: 'railBuilt', faction: g.regions[a].owner, a, b });
}
