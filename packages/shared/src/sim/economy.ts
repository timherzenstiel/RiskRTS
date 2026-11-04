// Supply income and convoys.
import { CONT, CONT_KEYS } from '../data/regions';
import { TICK_SECONDS } from '../data/units';
import { controls, emit, updateContested } from './core';
import { DT } from '../data/units';
import { addUnits } from './commands';
import { ownsCont, checkMissions } from './missions';
import type { GameState } from './types';

export const DIFFICULTIES = [
  { name: 'Recruit', ai: 1.7, inc: .8, desc: 'Slow, cautious rivals' },
  { name: 'Officer', ai: 1, inc: 1, desc: 'A fair fight' },
  { name: 'Marshal', ai: .7, inc: 1.25, desc: 'Fast, well supplied rivals' },
] as const;

/** Base supply from land: diminishing returns, so the largest power does not snowball (1 land: 4, 9: 7, 25: 10, 54: 13). */
export const landIncome = (n: number) => n ? 2 + Math.round(1.5 * Math.sqrt(n)) : 0;

/** Supply per convoy. Contested regions (holdouts still fighting) pay nothing. */
export function income(g: GameState, fid: number): number {
  const mine = g.regions.filter(r => controls(r, fid));
  let v = Math.max(3, landIncome(mine.length));
  for (const k of CONT_KEYS) if (ownsCont(g, fid, k)) v += CONT[k].bonus;
  v += 2 * mine.filter(r => r.factory).length;
  return v;
}

/** Share of a holdout's strength lost per convoy. */
export const HOLDOUT_WEAR = .065;

/** A convoy reaches every power at the same moment. */
export function supplyTick(g: GameState) {
  g.day += 7;
  const d = DIFFICULTIES[g.diff] ?? DIFFICULTIES[1];
  for (const f of g.factions) { if (!f.alive) continue; const inc = income(g, f.id); f.supply += f.ai ? Math.round(inc * d.inc) : inc; }
  for (const r of g.regions) if (r.barracks && r.contested < 0 && g.factions[r.owner].alive) addUnits(g, r, 'inf', 1);
  // cut-off holdouts run short of ammunition and food: they wear down over about five minutes
  for (const r of g.regions) {
    if (r.contested < 0 || r.battle >= 0) continue;
    for (const d of r.defs) if (d.f !== r.owner) d.hp -= DT[d.k].hp * HOLDOUT_WEAR;
    r.defs = r.defs.filter(d => d.hp > 0); updateContested(r);
    if (r.contested < 0) emit(g, { k: 'cleared', region: r.id, faction: r.owner });
  }
  emit(g, { k: 'supply' });
  checkMissions(g);
}
export const convoyIn = (g: GameState) => Math.ceil(TICK_SECONDS - g.supplyT);
