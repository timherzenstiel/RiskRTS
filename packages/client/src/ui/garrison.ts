import { emptyUnits, isDef, AS, FORMATION, type GameState, type RegionState, type Units, type UnitType } from '@riskrts/shared';

/** Formations actually in the region; during streamed battles, the defending side's survivors on every front. */
export function garrisonOf(g: GameState, r: RegionState): Units { return forceOf(g, r).u; }

/** Formations and men of a region's garrison, battles included. */
export function forceOf(g: GameState, r: RegionState): { u: Units; m: Units } {
  const fr = g.battles.filter(b => b.region === r.id && !b.ended && b.agents.length);
  if (!fr.length) return { u: r.units, m: r.men };
  const u = { ...r.units }, m = { ...r.men };
  for (const b of fr) for (const a of b.agents) if (!a.dead && !a.out && a.f === r.owner && !isDef(a.type)) {
    const k = a.type as UnitType; u[k]++;
    // network mirrors carry no hit points (hp is a placeholder 1): count them at full strength
    m[k] += a.men === undefined ? FORMATION[k].men : Math.round(Math.max(0, a.hp) / AS(k).hp * a.men);
  }
  return { u, m };
}
export const noUnits = emptyUnits;
