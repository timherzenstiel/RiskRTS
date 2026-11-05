// One place for every rule modifier the battle and economy code asks about: unit stats per power, national traits, stance and
// suppression effects. Later systems (weather, terrain, doctrines) plug in here so the battle code needs no special cases.
import { AS, COST, isDef, type AgentType, type UnitStats, type UnitType } from '../data/units';
import { nationOf, nationalUnit } from '../data/nations';
import { isMountain, weatherAt } from '../data/terrain';
import { hasDoc, techOn } from './tech';
import type { Agent, Battle, GameState, Stance } from './types';

const statCache = new Map<string, UnitStats>();
/** Stats of a unit or defence type as fielded by a power on the current day (national variants included). */
export function statsOf(g: GameState, f: number, t: AgentType): UnitStats {
  if (isDef(t)) return AS(t);
  const nat = nationalUnit(f, t, g.day);
  // technologies and doctrines that change a unit's stats
  const tk2 = t === 'tank' && techOn(g, f, 'tank2'), air2 = t === 'plane' && techOn(g, f, 'air2'), airD = t === 'plane' && hasDoc(g, f, 'air'), inf = t === 'inf' && hasDoc(g, f, 'infiltration');
  const key = f + t + (nat ? 1 : 0) + (tk2 ? 2 : 0) + (air2 ? 4 : 0) + (airD ? 8 : 0) + (inf ? 16 : 0);
  let s = statCache.get(key); if (s) return s;
  const b = AS(t), m = nat ? nationOf(f).mult : {};
  const hp = (tk2 ? 1.3 : 1) * (air2 ? 1.2 : 1) * (airD ? 1.3 : 1), dmg = (air2 ? 1.2 : 1) * (airD ? 1.3 : 1);
  s = { ...b, hp: b.hp * (m.hp ?? 1) * hp, dmg: b.dmg * (m.dmg ?? 1) * dmg, rof: b.rof * (m.rof ?? 1), speed: b.speed * (m.speed ?? 1) * (inf ? 1.15 : 1) };
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
  if (t !== 'inf') return .5;
  if (nationOf(f).flags.storm && nationalUnit(f, 'inf', g.day)) return 1 - .5 * .4;
  return hasDoc(g, f, 'infiltration') ? 1 - .5 * .7 : .5;
}
/** Shells per gun shot relative to the base (artillery dominance saves a quarter). */
export const shellMod = (g: GameState, f: number) => hasDoc(g, f, 'artillery') ? .75 : 1;
/** Extra trench depth counted in battle for the defenders (defence in depth: a second line). */
export const depthBonus = (g: GameState, f: number) => hasDoc(g, f, 'depth') ? 1 : 0;
/** Combined arms: a side with tanks and infantry on one front hits harder (from 1918; more with the doctrine). */
export function combinedMod(g: GameState, f: number, hasBoth: boolean) {
  if (!hasBoth) return 1;
  return hasDoc(g, f, 'combined') ? 1.25 : techOn(g, f, 'combined') ? 1.1 : 1;
}
/** War weariness from losses (peace offensive takes 30% off). */
export const wwLossMod = (g: GameState, f: number) => nationOf(f).wwLoss * (hasDoc(g, f, 'peace') ? .7 : 1);
/** Suppression a shell from side `f` causes, relative to the base. */
export const suppMod = (_g: GameState, f: number) => nationOf(f).flags.krupp ? 1.1 : 1;
/** Morale loss multiplier when holding at all costs. */
export const holdMorale = (f: number) => nationOf(f).hold;

/** Supply cost of a unit for a power. */
export const unitCost = (g: GameState, f: number, t: UnitType) => t === 'tank' ? Math.round(COST.tank * nationOf(f).tankCost * (hasDoc(g, f, 'tankcorps') ? .7 : 1)) : COST[t];
/** Supply cost of a building for a power. */
export const buildCostOf = (f: number, kind: 'factory' | 'barracks' | 'airfield') => COST[kind] + (kind === 'factory' ? nationOf(f).factoryCost : 0);

/** Ground conditions of a front: mud (weather), winter, and whether the attack comes over a mountain border. */
export interface Field { mud: boolean; winter: boolean; mtn: boolean }
export function fieldOf(g: GameState, b: Battle): Field {
  const w = weatherAt(b.region, g.day);
  return { mud: w === 1, winter: w === 2, mtn: isMountain(b.region, b.from) };
}
/** Speed factor of attackers crossing no-man's-land: mud and mountains slow them, tanks struggle in the mountains. */
export function crossSpeed(fl: Field, t: AgentType) { return (fl.mud ? 1 / 1.3 : 1) * (fl.mtn ? (t === 'tank' ? .5 : 1 / 1.3) : 1); }
/** Terrain and weather damage modifiers: defenders of a mountain border (more so for Austria-Hungary), tanks in the mountains, Siberians in winter. */
export function fieldMod(g: GameState, b: Battle, fl: Field, sf: number, st: AgentType, t: Agent): number {
  let m = 1;
  if (fl.mtn) { if (t.f === b.def) m *= nationOf(t.f).flags.mountain ? .8 * .7 : .8; if (st === 'tank') m *= .5; }
  if (fl.winter && st === 'inf' && nationOf(sf).flags.siberian) m *= 1.2;
  return m;
}
/** Shell splash in the mud is smaller (shells bury themselves). */
export const splashMod = (fl: Field) => fl.mud ? .8 : 1;

/** Stance of a side in a battle. */
export const stanceIn = (b: Battle, f: number): Stance => b.st?.[f] ?? 0;

/** Damage dealt multiplier for the shooter's stance, and taken multiplier for the target's stance. */
export const STANCE_DEALT = [1, 1.15, 1, 1] as const;
export const STANCE_TAKEN = [1, 1.25, .7, 1] as const;

/** Fire-rate slowdown of a suppressed side (multiplies the reload time): up to −60 % fire at full suppression. */
export const suppSlow = (s: number) => 1 / Math.max(.4, 1 - .6 * Math.min(100, s) / 100);
/** Suppression above which MG companies and MG nests stop firing. */
export const SUPP_SILENCE = 70;
