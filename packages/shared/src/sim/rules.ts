// One place for every rule modifier the battle and economy code asks about: unit stats per power, national traits, stance and
// suppression effects. Later systems (weather, terrain, doctrines) plug in here so the battle code needs no special cases.
import { AS, COST, isDef, type AgentType, type UnitStats, type UnitType } from '../data/units';
import { nationOf, nationalUnit } from '../data/nations';
import type { Agent, Battle, GameState, Stance } from './types';

const statCache = new Map<string, UnitStats>();
/** Stats of a unit or defence type as fielded by a power on the current day (national variants included). */
export function statsOf(g: GameState, f: number, t: AgentType): UnitStats {
  if (isDef(t)) return AS(t);
  const nat = nationalUnit(f, t, g.day), key = f + t + (nat ? 1 : 0);
  let s = statCache.get(key); if (s) return s;
  const b = AS(t), m = nat ? nationOf(f).mult : {};
  s = { ...b, hp: b.hp * (m.hp ?? 1), dmg: b.dmg * (m.dmg ?? 1), rof: b.rof * (m.rof ?? 1), speed: b.speed * (m.speed ?? 1) };
  statCache.set(key, s); return s;
}

/** Name of a unit type as a power fields it today. */
export function unitName(g: GameState, f: number, t: UnitType): string { return nationalUnit(f, t, g.day) ? nationOf(f).unitName : AS(t).name; }

/** National damage modifiers of a shot from side `sf` (unit type `st`) at target `t`. */
export function dealtMod(g: GameState, b: Battle, sf: number, st: AgentType, t: Agent): number {
  if (st !== 'art' && st !== 'inf') return 1;
  const N = nationOf(sf); if (!nationalUnit(sf, st, g.day)) return 1;
  let m = 1;
  if (st === 'art') {
    if (N.flags.skoda && isDef(t.type)) m *= 1.8;
    if (N.flags.canon && (t.type === 'bunk' || (t.trench && t.f === b.def && b.tr >= 3))) m *= .8;
  } else if (sf !== b.def) {
    if (N.flags.storm) m *= 1.15;
    if (N.flags.fortInf) m *= .85;
  }
  return m;
}
/** National damage taken modifier (fortress infantry in a trench). */
export function takenMod(g: GameState, b: Battle, t: Agent): number {
  return t.type === 'inf' && t.trench && t.f === b.def && nationOf(t.f).flags.fortInf && nationalUnit(t.f, 'inf', g.day) ? .8 : 1;
}
/** Speed factor of attackers crawling through barbed wire (storm battalions cross most of it unhindered). */
export function wireSlow(g: GameState, f: number, t: AgentType): number {
  return t === 'inf' && nationOf(f).flags.storm && nationalUnit(f, 'inf', g.day) ? 1 - .5 * .4 : .5;
}
/** Suppression a shell from side `f` causes, relative to the base. */
export const suppMod = (_g: GameState, f: number) => nationOf(f).flags.krupp ? 1.1 : 1;
/** Morale loss multiplier when holding at all costs. */
export const holdMorale = (f: number) => nationOf(f).hold;

/** Supply cost of a unit for a power. */
export const unitCost = (_g: GameState, f: number, t: UnitType) => t === 'tank' ? Math.round(COST.tank * nationOf(f).tankCost) : COST[t];
/** Supply cost of a building for a power. */
export const buildCostOf = (f: number, kind: 'factory' | 'barracks' | 'airfield') => COST[kind] + (kind === 'factory' ? nationOf(f).factoryCost : 0);

/** Stance of a side in a battle. */
export const stanceIn = (b: Battle, f: number): Stance => b.st?.[f] ?? 0;

/** Damage dealt multiplier for the shooter's stance, and taken multiplier for the target's stance. */
export const STANCE_DEALT = [1, 1.15, 1, 1] as const;
export const STANCE_TAKEN = [1, 1.25, .7, 1] as const;

/** Fire-rate slowdown of a suppressed side (multiplies the reload time): up to −60 % fire at full suppression. */
export const suppSlow = (s: number) => 1 / Math.max(.4, 1 - .6 * Math.min(100, s) / 100);
/** Suppression above which MG companies and MG nests stop firing. */
export const SUPP_SILENCE = 70;
