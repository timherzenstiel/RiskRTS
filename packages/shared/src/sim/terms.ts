// Breakdowns of the national numbers (supply income, shell output, manpower growth) as labelled terms that add up to the total
// the economy code computes, so the UI can show *why* a number is what it is.
import { CONT, CONT_KEYS } from '../data/regions';
import { nationOf } from '../data/nations';
import { SHELLS } from '../data/units';
import { controls } from './core';
import { MANPOWER, WW_INCOME, bombedNow, income, landIncome, poolGrowth, shellIncome } from './economy';
import { ownsCont } from './missions';
import { hasDoc } from './tech';
import { world } from './core';
import type { GameState } from './types';

/** One line of a breakdown: a label, its value, and an optional note. */
export interface Term { label: string; v: number; note?: string }

const paying = (g: GameState, f: number) => g.regions.filter(r => controls(r, f) && !r.cut && !r.strike);

/** Close the breakdown: whatever rounding and multipliers leave over goes into the last (multiplier) term. */
function close(terms: Term[], total: number, label: string, note?: string): Term[] {
  const sum = terms.reduce((s, t) => s + t.v, 0), rest = Math.round((total - sum) * 10) / 10;
  if (Math.abs(rest) >= .05) terms.push({ label, v: rest, note });
  return terms;
}

/** Supply per convoy, term by term. The terms add up to `income(g, f)`. */
export function incomeTerms(g: GameState, f: number): Term[] {
  const mine = paying(g, f), W = world(), t: Term[] = [];
  const held = g.regions.filter(r => controls(r, f)).length;
  t.push({ label: `Land · ${mine.length} paying region${mine.length === 1 ? '' : 's'}`, v: Math.max(3, landIncome(mine.length)), note: held > mine.length ? `${held - mine.length} cut off, contested or on strike pay nothing` : undefined });
  for (const k of CONT_KEYS) if (ownsCont(g, f, k)) t.push({ label: `All of ${CONT[k].name}`, v: CONT[k].bonus });
  const fac = mine.filter(r => r.factory && !bombedNow(g, r)).length;
  if (fac) t.push({ label: `Factories · ${fac}`, v: 2 * fac });
  if (hasDoc(g, f, 'total')) { const base = t.reduce((s, x) => s + x.v, 0); t.push({ label: 'Total war doctrine · +30 %', v: Math.round(base * .3 * 10) / 10 }); }
  if (nationOf(f).flags.empire) { const n = mine.filter(r => W.regions[r.id].cont !== 'EU').length; if (n) t.push({ label: `Empire · ${n} region${n === 1 ? '' : 's'} outside Europe`, v: n }); }
  const ww = g.factions[f]?.ww ?? 0;
  return close(t, income(g, f), `War weariness ${Math.round(ww)} % · −${Math.round(WW_INCOME * ww)} %`, ww > 0 ? 'Casualties wear the nation down; it fades in quiet times' : undefined);
}

/** Shells per convoy, term by term. The terms add up to `shellIncome(g, f)`. */
export function shellTerms(g: GameState, f: number): Term[] {
  const N = nationOf(f), mine = paying(g, f), t: Term[] = [{ label: 'Base output', v: SHELLS.base }];
  const fac = mine.filter(r => r.factory && !bombedNow(g, r)).length, cap = mine.filter(r => r.capitalOf === f).length;
  if (fac) t.push({ label: `Factories · ${fac} × ${N.factoryShells}`, v: fac * N.factoryShells });
  if (cap) t.push({ label: 'Capital', v: cap * SHELLS.capital });
  return close(t, shellIncome(g, f), 'National output', N.shellsUntil && g.day < N.shellsUntil[0] ? 'Shell crisis until the date in the calendar' : undefined);
}

/** Manpower growth per convoy, term by term. The terms add up to `poolGrowth(g, f)`. */
export function poolTerms(g: GameState, f: number): Term[] {
  let n = 0; for (const r of g.regions) if (r.home === f && controls(r, f) && !r.strike) n++;
  const t: Term[] = [{ label: `Age class · ${n} home region${n === 1 ? '' : 's'} × ${MANPOWER.growth}`, v: n * MANPOWER.growth }];
  const mob = g.factions[f]?.mob ?? 0;
  return close(t, poolGrowth(g, f), mob ? `Conscription and national modifiers` : 'National modifiers', mob ? `Conscription level ${mob}: +${mob * 50} % age class` : undefined);
}
