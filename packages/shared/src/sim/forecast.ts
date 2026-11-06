// Forecasts for the interface (design-play §4): what a lever would do before it is pulled, and where the nation is heading.
// Everything is computed with the simulation's own functions; a lever is tried by setting it, reading, and setting it back.
import { BARRAGE, UT } from '../data/units';
import { nationOf } from '../data/nations';
import { MANPOWER, WW_FADE, income, poolGrowth, shellIncome } from './economy';
import { barrageBurn, replWanted, woundedDue } from './supply';
import { hasDoc } from './tech';
import { paceOf, shotCost } from './battle';
import type { Barrage, Battle, GameState } from './types';

/** Try a faction setting (`mob`, `econ`) and read what follows, then put it back. */
function trying<T>(g: GameState, f: number, key: 'mob' | 'econ', v: number, read: () => T): T {
  const F = g.factions[f], old = F[key]; F[key] = v;
  try { return read(); } finally { if (old === undefined) delete F[key]; else F[key] = old; }
}

/** War weariness per week from conscription and doctrine, less what fades in quiet times (casualties come on top). */
export function wwTrend(g: GameState, f: number, mob = g.factions[f]?.mob ?? 0): number {
  const F = g.factions[f]; if (!F) return 0;
  const up = MANPOWER.mobWW * mob + (hasDoc(g, f, 'total') ? 1 : 0), fade = WW_FADE * (1 - mob / 2);
  return up - (F.ww + up > 0 ? fade : 0);
}

/** Weeks until weariness reaches the nation's unrest threshold at `perWeek` (0: there already, Infinity: not heading there). */
export function unrestIn(g: GameState, f: number, perWeek: number): number {
  const F = g.factions[f], thr = nationOf(f).unrest; if (!F) return Infinity;
  if (F.ww >= thr) return 0;
  return perWeek > 0 ? (thr - F.ww) / perWeek : Infinity;
}

/** The manpower pool next week: age class and wounded back in, replacements out (recruiting comes on top). */
export function poolNet(g: GameState, f: number): { growth: number; back: number; repl: number; net: number } {
  const F = g.factions[f]; if (!F) return { growth: 0, back: 0, repl: 0, net: 0 };
  const growth = poolGrowth(g, f), back = Math.floor(woundedDue(F, g.day + 7)), repl = replWanted(g, f);
  return { growth, back, repl, net: growth + back - repl };
}

/** Weeks the pool lasts at the current drain (Infinity while it grows). */
export function poolWeeks(g: GameState, f: number): number {
  const n = poolNet(g, f).net, men = g.factions[f]?.men ?? 0;
  return n >= 0 ? Infinity : men / -n;
}

export interface MobOption { level: number; men: number; ww: number; unrest: number }
/** Each conscription level: men per week, weariness per week, weeks to unrest (design-play §4.2). */
export function mobOptions(g: GameState, f: number): MobOption[] {
  return [0, 1, 2].map(level => trying(g, f, 'mob', level, () => {
    const ww = wwTrend(g, f, level);
    return { level, men: poolGrowth(g, f), ww, unrest: unrestIn(g, f, ww) };
  }));
}

export interface EconOption { level: number; prod: number; shells: number; weeks: number }
/** Each war economy setting: Production and shells per week, and how many weeks of light barrage the stock then holds after a
 *  week (Infinity without guns). */
export function econOptions(g: GameState, f: number): EconOption[] {
  const burn = barrageBurn(g, f), stock = g.factions[f]?.shells ?? 0;
  return [0, 1, 2].map(level => trying(g, f, 'econ', level, () => {
    const prod = income(g, f), shells = shellIncome(g, f);
    return { level, prod, shells, weeks: burn > 0 ? (stock + shells) / burn : Infinity };
  }));
}

/** Shells a power's guns in one battle burn per minute at each barrage level. */
export function barrageRate(g: GameState, b: Battle, f: number): Record<Barrage, number> {
  let guns = 0; for (const a of b.agents) if (a.f === f && a.type === 'art' && !a.dead && !a.out) guns++;
  const perGun = 60 / (UT.art.rof * paceOf(g).rof) * shotCost(b, f, g);
  return { 0: 0, 1: guns * perGun, 2: guns * perGun * BARRAGE.heavy };
}
