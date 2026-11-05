// One place for every rule modifier the battle and economy code asks about: unit stats per power, stance and suppression
// effects. Later systems (nations, weather, terrain, doctrines) plug in here so the battle code needs no special cases.
import { AS, type AgentType, type UnitStats } from '../data/units';
import type { Battle, GameState, Stance } from './types';

/** Stats of a unit or defence type as fielded by a power. */
export function statsOf(_g: GameState, _f: number, t: AgentType): UnitStats { return AS(t); }

/** Stance of a side in a battle. */
export const stanceIn = (b: Battle, f: number): Stance => b.st?.[f] ?? 0;

/** Damage dealt multiplier for the shooter's stance, and taken multiplier for the target's stance. */
export const STANCE_DEALT = [1, 1.15, 1, 1] as const;
export const STANCE_TAKEN = [1, 1.25, .7, 1] as const;
/** Extra morale loss when holding at all costs. */
export const HOLD_MORALE = 1.5;

/** Fire-rate slowdown of a suppressed side (multiplies the reload time): up to −60 % fire at full suppression. */
export const suppSlow = (s: number) => 1 / Math.max(.4, 1 - .6 * Math.min(100, s) / 100);
/** Suppression above which MG companies and MG nests stop firing. */
export const SUPP_SILENCE = 70;
