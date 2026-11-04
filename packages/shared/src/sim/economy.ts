// Supply income and convoys.
import { CONT, CONT_KEYS } from '../data/regions';
import { TICK_SECONDS } from '../data/units';
import { emit } from './core';
import { addUnits } from './commands';
import { ownsCont, checkMissions } from './missions';
import type { GameState } from './types';

export const DIFFICULTIES = [
  { name: 'Recruit', ai: 1.7, inc: .8, desc: 'Slow, cautious rivals' },
  { name: 'Officer', ai: 1, inc: 1, desc: 'A fair fight' },
  { name: 'Marshal', ai: .7, inc: 1.25, desc: 'Fast, well supplied rivals' },
] as const;

export function income(g: GameState, fid: number): number {
  const mine = g.regions.filter(r => r.owner === fid);
  let v = Math.max(3, Math.floor(mine.length / 3));
  for (const k of CONT_KEYS) if (ownsCont(g, fid, k)) v += CONT[k].bonus;
  v += 2 * mine.filter(r => r.factory).length;
  return v;
}

/** A convoy reaches every power at the same moment. */
export function supplyTick(g: GameState) {
  g.day += 7;
  const d = DIFFICULTIES[g.diff] ?? DIFFICULTIES[1];
  for (const f of g.factions) { if (!f.alive) continue; const inc = income(g, f.id); f.supply += f.ai ? Math.round(inc * d.inc) : inc; }
  for (const r of g.regions) if (r.barracks && g.factions[r.owner].alive) addUnits(g, r, 'inf', 1);
  emit(g, { k: 'supply' });
  checkMissions(g);
}
export const convoyIn = (g: GameState) => Math.ceil(TICK_SECONDS - g.supplyT);
