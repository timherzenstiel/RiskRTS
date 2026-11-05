// Supply income, convoys, supply lines, reinforcement of battered formations and war weariness.
import { CONT, CONT_KEYS } from '../data/regions';
import { DT, FORMATION, TICK_SECONDS, UNIT_TYPES } from '../data/units';
import { consolidate, controls, emit, updateContested, world } from './core';
import { addUnits } from './commands';
import { moraleCap } from './battle';
import { spiesOnConvoy } from './fog';
import { ownsCont, checkMissions } from './missions';
import type { GameState } from './types';

export const DIFFICULTIES = [
  { name: 'Recruit', ai: 1.7, inc: .8, desc: 'Slow, cautious rivals' },
  { name: 'Officer', ai: 1, inc: 1, desc: 'A fair fight' },
  { name: 'Marshal', ai: .7, inc: 1.25, desc: 'Fast, well supplied rivals who see through the fog' },
] as const;

/** Base supply from land: diminishing returns, so the largest power does not snowball (1 land: 4, 9: 7, 25: 10, 54: 13). */
export const landIncome = (n: number) => n ? 2 + Math.round(1.5 * Math.sqrt(n)) : 0;
/** Share of income lost at full war weariness. */
export const WW_INCOME = .3;
/** War weariness above which barracks stop sending volunteers. */
export const WW_NO_VOLUNTEERS = 60;
/** Strength a cut-off garrison loses per convoy, and morale. */
export const CUT_WEAR = .08, CUT_MORALE = 10;

/** Supply per convoy. Contested and cut-off regions pay nothing; war weariness eats into the rest. */
export function income(g: GameState, fid: number): number {
  const mine = g.regions.filter(r => controls(r, fid) && !r.cut);
  let v = Math.max(3, landIncome(mine.length));
  for (const k of CONT_KEYS) if (ownsCont(g, fid, k)) v += CONT[k].bonus;
  v += 2 * mine.filter(r => r.factory).length;
  const ww = g.factions[fid]?.ww ?? 0;
  return Math.max(1, Math.round(v * (1 - WW_INCOME * ww / 100)));
}

/**
 * Supply lines: a region is supplied when an unbroken chain of the power's own regions (land borders or sea lanes between
 * two of its own regions) leads back to its capital, a factory region or its home territory. Recomputes `cut` for every region.
 */
export function updateSupplyLines(g: GameState, announce = false) {
  const W = world(), seen = new Uint8Array(g.regions.length), q: number[] = [];
  for (const r of g.regions) if (r.owner >= 0 && r.contested < 0 && (r.capitalOf === r.owner || r.factory || r.home === r.owner)) { seen[r.id] = 1; q.push(r.id); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], o = g.regions[i].owner;
    for (const j of W.regions[i].adj) if (!seen[j] && g.regions[j].owner === o) { seen[j] = 1; q.push(j); }
  }
  for (const r of g.regions) {
    const cut = r.owner >= 0 && !seen[r.id];
    if (cut && !r.cut && announce) emit(g, { k: 'cut', faction: r.owner, region: r.id });
    r.cut = cut;
  }
}

/** Share of a holdout's strength lost per convoy. */
export const HOLDOUT_WEAR = .065;

/** A convoy reaches every power at the same moment. */
export function supplyTick(g: GameState) {
  g.day += 7;
  updateSupplyLines(g, true);
  const d = DIFFICULTIES[g.diff] ?? DIFFICULTIES[1];
  for (const f of g.factions) { if (!f.alive) continue; const inc = income(g, f.id); f.supply += f.ai ? Math.round(inc * d.inc) : inc; }
  for (const r of g.regions) if (r.barracks && r.contested < 0 && !r.cut && g.factions[r.owner].alive && g.factions[r.owner].ww < WW_NO_VOLUNTEERS) addUnits(g, r, 'inf', 1);
  for (const r of g.regions) {
    if (r.owner < 0 || r.battle >= 0) continue;
    if (r.cut) {
      // encircled: no food, no ammunition, no replacements
      for (const k of UNIT_TYPES) r.men[k] = Math.floor(r.men[k] * (1 - CUT_WEAR));
      consolidate(r.units, r.men);
      r.mor = Math.max(0, r.mor - CUT_MORALE);
    } else r.mor = Math.min(moraleCap(g, r.owner), r.mor + 6);
  }
  reinforce(g);
  for (const f of g.factions) f.ww = Math.max(0, f.ww - 1.5);
  // cut-off holdouts run short of ammunition and food: they wear down over about five minutes
  for (const r of g.regions) {
    if (r.contested < 0 || r.battle >= 0) continue;
    for (const d of r.defs) if (d.f !== r.owner) d.hp -= DT[d.k].hp * HOLDOUT_WEAR;
    r.defs = r.defs.filter(d => d.hp > 0); updateContested(r);
    if (r.contested < 0) emit(g, { k: 'cleared', region: r.id, faction: r.owner });
  }
  spiesOnConvoy(g);
  emit(g, { k: 'supply' });
  checkMissions(g);
}

/** Wounded men return: each convoy the pool tops up under-strength formations in supplied regions; some never come back. */
function reinforce(g: GameState) {
  for (const f of g.factions) {
    if (!f.alive || f.wounded < 1) { f.wounded = 0; continue; }
    const gaps: [number, keyof typeof FORMATION, number][] = []; let need = 0;
    for (const r of g.regions) {
      if (r.owner !== f.id || r.cut || r.battle >= 0) continue;
      for (const k of UNIT_TYPES) { const gap = r.units[k] * FORMATION[k].men - r.men[k]; if (gap > 0) { gaps.push([r.id, k, gap]); need += gap; } }
    }
    const give = Math.min(f.wounded * .5, need);
    if (give > 0) for (const [i, k, gap] of gaps) g.regions[i].men[k] += Math.floor(gap / need * give);
    f.wounded = Math.max(0, (f.wounded - give) * .85);
  }
}
export const convoyIn = (g: GameState) => Math.ceil(TICK_SECONDS - g.supplyT);
