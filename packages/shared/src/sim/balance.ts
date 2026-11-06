// Border balance: what a power has on one of its borders against what it knows is across it. Read from a fog-of-war view,
// so the player's chips, the border card and (later) the AI's threat estimate all see the same numbers.
import { DT, fullMen, groundUnits, unitPower } from '../data/units';
import { isCoast, zoneOfKey, zoneAt } from '../world/zones';
import { menTotal, world, worksAt } from './core';
import { atPeace } from './diplomacy';
import { atWar } from './navy';
import { corpsAtPost, corpsIn, legDist, mainOf, moveK, POST_SPEED } from './posts';
import type { Corps } from './types';
import type { GameState, RegionState } from './types';

/** How well the viewer knows the far side: 0 nothing, 1 an estimate from across the border, 2 an old report, 3 in full view. */
export type Know = 0 | 1 | 2 | 3;
/** Danger level of a border: -1 unknown, 0 safe, 1 even, 2 weaker, 3 in danger (much weaker, or the enemy is massing). */
export type Danger = -1 | 0 | 1 | 2 | 3;

export interface Side {
  /** Battalions of the corps on this border (for the far side a range: [lo, hi], equal when known). */
  btl: [number, number];
  /** Battalions of the main army that would join (own: half of it when it is close enough; far side: half its estimate). */
  reserve: [number, number];
  /** Battalions marching towards this border that the viewer can see. */
  incoming: number;
  /** Fighting power of the troops (unitPower × strength), as a range. */
  power: [number, number];
  /** Field works and fixed defences on this border. */
  trench: number; sand: number; wire: number; defs: number;
  /** Power the fixed defences add. */
  defPower: number;
}

export interface Balance {
  region: number; sector: number;
  /** Neighbouring region across a land border (-1 on a coast) and the power that holds it (-1: none known). */
  nb: number; foe: number;
  own: Side; their: Side;
  know: Know;
  /** Day of the report the far side comes from (know 2). */
  day?: number;
  /** An enemy corps across this border has been seen assembling for an attack. */
  massing: boolean;
  /** Own defensive strength (troops × works + defences) over the attacking strength across, from the middle of the estimate. */
  ratio: number | null;
  danger: Danger;
}

const ZERO = (): Side => ({ btl: [0, 0], reserve: [0, 0], incoming: 0, power: [0, 0], trench: 0, sand: 0, wire: 0, defs: 0, defPower: 0 });
/** Men per battalion-equivalent when only an estimate in men is known. */
const MEN_PER_BTL = 100;
/** Main-army troops count towards a border when they can get there within this many seconds. */
export const RESERVE_REACH = 30;
/** Defensive value of field works: each trench level, sandbag row and wire belt multiplies the defenders' power. */
export const WORK_MULT = { trench: .25, sand: .08, wire: .1 } as const;

/** Strength of a region's formations (men present over full strength). */
function strength(r: RegionState): number {
  const full = fullMen(r.units); return full > 0 ? Math.max(.2, Math.min(1, menTotal(r.men) / full)) : 1;
}
/** Fighting power of one corps at its own strength (a fog view without its men counts it at full strength). */
function corpsPower(c: Corps): number {
  const full = fullMen(c.u), men = menTotal(c.m);
  return unitPower(c.u) * (full > 0 && men > 0 ? Math.max(.2, Math.min(1, men / full)) : 1);
}

/** Works and defences of region `r` on sector `s`, as the view knows them. */
function worksSide(side: Side, r: RegionState, s: number) {
  const w = worksAt(r, s); side.trench = w.tr; side.sand = w.sand; side.wire = w.wire;
  for (const d of r.defs) if (d.s === s && d.f === r.owner) { side.defs++; side.defPower += DT[d.k].power * Math.max(.2, d.hp / DT[d.k].hp); }
}
const worksMult = (s: Side) => 1 + WORK_MULT.trench * s.trench + WORK_MULT.sand * s.sand + WORK_MULT.wire * s.wire;

/**
 * Balance on border `sector` (a neighbouring region id, or a coast key) of region `rid`, seen by the region's owner in `g`.
 * `g` should be that owner's fog-of-war view; with the full state it simply knows everything.
 */
export function borderBalance(g: GameState, rid: number, sector: number): Balance {
  const r = g.regions[rid], me = r.owner;
  const own = ZERO(), their = ZERO();
  // our side: the corps on the border, half the main army if it can reach the border in time, our works
  for (const c of corpsAtPost(r, sector)) {
    const n = groundUnits(c.u), p = corpsPower(c); own.btl = [own.btl[0] + n, own.btl[1] + n]; own.power = [own.power[0] + p, own.power[1] + p];
  }
  const main = mainOf(r), mainN = groundUnits(main);
  if (mainN > 0 && legDist(rid, -1, rid, sector) / POST_SPEED * moveK(g) <= RESERVE_REACH) {
    const h = Math.floor(mainN / 2), p = unitPower(main) * strength(r) / 2; own.reserve = [h, h]; own.power = [own.power[0] + p, own.power[1] + p];
  }
  worksSide(own, r, sector);
  for (const a of g.armies) if (a.owner === me && !a.air && a.to === rid && a.post === sector) own.incoming += groundUnits(a.units);

  let know: Know = 0, day: number | undefined, foe = -1, massing = false, nb = -1;
  if (isCoast(sector)) {
    // a coast: enemy fleets with troops aboard in that zone are what threatens it
    const z = zoneOfKey(sector);
    for (const fl of g.fleets ?? []) {
      if (fl.owner === me || atPeace(g, me, fl.owner) || !fl.zs.length || zoneAt(fl.zs, fl.d) !== z) continue;
      const n = groundUnits(fl.cargo); if (!n) continue;
      know = Math.max(know, 1) as Know; foe = fl.owner; their.incoming += n;
      if (fl.task === 'assault' && fl.to === rid) massing = true;
    }
    if (know) { their.btl = [0, 0]; their.power = [their.incoming * 1.1 * .8, their.incoming * 1.1 * 1.2]; }
  } else {
    nb = sector; const o = g.regions[nb]; foe = o.owner;
    know = ((o.vis ?? 3) >= 3 ? 3 : (o.vis ?? 3) === 2 ? 2 : (o.vis ?? 3) === 1 ? 1 : 0) as Know;
    if (know === 2) day = o.seen;
    const ocs = corpsAtPost(o, rid);
    for (const oc of ocs) {
      if (oc.est) {
        const lo = oc.est[0] / MEN_PER_BTL, hi = oc.est[1] / MEN_PER_BTL;
        their.btl = [their.btl[0] + Math.round(lo), their.btl[1] + Math.round(hi)]; their.power = [their.power[0] + lo * 1.1, their.power[1] + hi * 1.1];
      } else if (know >= 2 || groundUnits(oc.u) > 0) {
        const n = groundUnits(oc.u), p = corpsPower(oc); their.btl = [their.btl[0] + n, their.btl[1] + n]; their.power = [their.power[0] + p, their.power[1] + p];
      }
      if ((oc.ord ?? 0) >= 1) massing = true;
    }
    // their main army could join an attack too: half of what is left of the region once the corps are taken out
    if (know >= 2) {
      const m = mainOf(o), n = Math.floor(groundUnits(m) / 2), p = unitPower(m) * strength(o) / 2;
      their.reserve = [n, n]; their.power = [their.power[0] + p, their.power[1] + p];
    } else if (know === 1 && o.est) {
      let cLo = 0, cHi = 0; for (const x of corpsIn(o)) if (x.est) { cLo += x.est[0]; cHi += x.est[1]; }
      const lo = Math.max(0, o.est[0] - cHi) / MEN_PER_BTL / 2, hi = Math.max(0, o.est[1] - cLo) / MEN_PER_BTL / 2;
      their.reserve = [Math.round(lo), Math.round(hi)]; their.power = [their.power[0] + lo * 1.1, their.power[1] + hi * 1.1];
    }
    if (know >= 1) worksSide(their, o, rid);
    for (const a of g.armies) if (a.owner === foe && !a.air && ((a.to === nb && a.post === rid) || (a.from === nb && a.to === rid))) their.incoming += groundUnits(a.units);
    if (their.incoming) { const p = their.incoming * 1.1; their.power = [their.power[0] + p, their.power[1] + p]; }
  }

  const ownDef = own.power[0] * worksMult(own) + own.defPower;
  const atk = (their.power[0] + their.power[1]) / 2;
  const ratio = know === 0 ? null : atk <= .01 ? (ownDef > 0 ? 9 : 1) : ownDef / atk;
  let danger: Danger = ratio === null ? -1 : ratio >= 1.5 ? 0 : ratio >= .8 ? 1 : ratio >= .5 ? 2 : 3;
  if (massing && danger !== -1 && danger < 3 && (ratio ?? 0) < 1.5) danger = 3;
  else if (massing && danger === -1) danger = 3;
  return { region: rid, sector, nb, foe, own, their, know, day, massing, ratio, danger };
}

/** Every border of the viewer's regions that faces a power at war with it (land), or a coast an enemy fleet with troops is in. */
export function hostileBorders(g: GameState, me: number): Balance[] {
  const W = world(), out: Balance[] = [];
  for (const r of g.regions) {
    if (r.owner !== me) continue;
    for (const s of W.regions[r.id].sectors) {
      if (isCoast(s)) { const b = borderBalance(g, r.id, s); if (b.know > 0) out.push(b); continue; }
      if (atWar(g, me, g.regions[s].owner)) out.push(borderBalance(g, r.id, s));
    }
  }
  return out;
}
