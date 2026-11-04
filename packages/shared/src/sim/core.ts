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
