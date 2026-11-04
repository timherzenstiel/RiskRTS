import { emptyUnits, type GameState, type RegionState, type Units } from '@riskrts/shared';

/** Units actually in the region; during a streamed battle, the survivors of the defending side. */
export function garrisonOf(g: GameState, r: RegionState): Units {
  const b = r.battle >= 0 ? g.battles.find(x => x.id === r.battle) : undefined;
  if (b && b.agents.length) { const u = emptyUnits(); for (const a of b.agents) if (!a.dead && a.f === r.owner) u[a.type]++; return u; }
  return r.units;
}
