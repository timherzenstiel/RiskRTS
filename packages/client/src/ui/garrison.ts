import { emptyUnits, isDef, type GameState, type RegionState, type Units, type UnitType } from '@riskrts/shared';

/** Units actually in the region; during a streamed battle, the survivors of the defending side. */
export function garrisonOf(g: GameState, r: RegionState): Units {
  const b = r.battle >= 0 ? g.battles.find(x => x.id === r.battle) : undefined;
  if (b && b.agents.length) { const u = emptyUnits(); for (const a of b.agents) if (!a.dead && !a.out && a.f === r.owner && !isDef(a.type)) u[a.type as UnitType]++; return u; }
  return r.units;
}
