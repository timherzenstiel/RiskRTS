// Small helpers shared by the simulation modules.
import { buildWorld } from '../world/build';
import type { Battle, GameEvent, GameState, RegionState } from './types';
import { totalUnits } from '../data/units';

export const TICK_DT = .05;

export function rnd(g: GameState): number {
  g.rng = (g.rng + 0x6D2B79F5) >>> 0; let t = g.rng; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const emit = (g: GameState, e: GameEvent) => { g.events.push(e); if (g.events.length > 400) g.events.splice(0, 200); };
export const world = () => buildWorld();
export const battleOf = (g: GameState, r: RegionState): Battle | null => r.battle < 0 ? null : (g.battles.find(b => b.id === r.battle) ?? null);
export const regionsOf = (g: GameState, fid: number) => g.regions.filter(r => r.owner === fid);
export const countRegions = (g: GameState, fid: number) => { let n = 0; for (const r of g.regions) if (r.owner === fid) n++; return n; };
export const garrison = (r: RegionState) => totalUnits(r.units);
/** Owned and not contested: the region counts for income, continents and missions. */
export const controls = (r: RegionState, fid: number) => r.owner === fid && r.contested < 0;

/** Number of borders between two regions (sea lanes count), or Infinity beyond `max`. */
export function hops(a: number, b: number, max = 2): number {
  if (a === b) return 0;
  const W = world(); let frontier = [a]; const seen = new Set([a]);
  for (let d = 1; d <= max; d++) {
    const next: number[] = [];
    for (const i of frontier) for (const j of W.regions[i].adj) { if (j === b) return d; if (!seen.has(j)) { seen.add(j); next.push(j); } }
    frontier = next;
  }
  return Infinity;
}

/** The neighbour of `to` an attack from `from` comes through: `from` itself if adjacent, else a shared neighbour. */
export function approachSector(from: number, to: number): number {
  const W = world(), adj = W.regions[to].adj;
  if (adj.includes(from)) return from;
  for (const n of adj) if (W.regions[n].adj.includes(from)) return n;
  return -1;
}

/** Regions a power is currently attacking (armies on the way to a foreign region, or battles it fights as the attacker). */
export function offensives(g: GameState, fid: number): Set<number> {
  const s = new Set<number>();
  for (const a of g.armies) if (a.owner === fid && !a.ret && g.regions[a.to].owner !== fid) s.add(a.to);
  for (const b of g.battles) {
    if (b.ended || b.def === fid) continue;
    const inIt = b.agents.length ? b.agents.some(x => x.f === fid && !x.dead && !x.out) : (b.counts ?? []).some(([f, al]) => f === fid && al > 0);
    if (inIt) s.add(b.region);
  }
  return s;
}

/** Re-derive the contested flag from the defences left in a region. */
export function updateContested(r: RegionState) {
  const h = r.defs.find(d => d.f !== r.owner);
  r.contested = h ? h.f : -1;
}
