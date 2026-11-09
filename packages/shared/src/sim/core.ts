// Small helpers shared by the simulation modules.
import { buildWorld, wrapDx } from '../world/build';
import { coastKey, isCoast } from '../world/zones';
import type { Army, Battle, GameEvent, GameState, RegionState, Works } from './types';
import { FORMATION, SLOTS_INTERIOR, SLOTS_LAND, SLOTS_SEA, SLOT_USE, UNIT_TYPES, emptyUnits, totalUnits, type Units } from '../data/units';

export const TICK_DT = .05;

export function rnd(g: GameState): number {
  g.rng = (g.rng + 0x6D2B79F5) >>> 0; let t = g.rng; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** Listeners the sim modules register for events as they happen (wars keep their score from battles and treaties). */
export const hooks: { events: ((g: GameState, e: GameEvent) => void)[] } = { events: [] };
export const emit = (g: GameState, e: GameEvent) => { g.events.push(e); if (g.events.length > 400) g.events.splice(0, 200); for (const h of hooks.events) h(g, e); };
export const world = () => buildWorld();
export const battleOf = (g: GameState, r: RegionState): Battle | null => r.battle < 0 ? null : (g.battles.find(b => b.id === r.battle) ?? null);
export const regionsOf = (g: GameState, fid: number) => g.regions.filter(r => r.owner === fid);
export const countRegions = (g: GameState, fid: number) => { let n = 0; for (const r of g.regions) if (r.owner === fid) n++; return n; };
export const garrison = (r: RegionState) => totalUnits(r.units);
/** Owned and not contested: the region counts for income, continents and missions. */
export const controls = (r: RegionState, fid: number) => r.owner === fid && r.contested < 0;

/** Number of borders between two regions (sea lanes count), or Infinity beyond `max`. */
export function hops(a: number, b: number, max = 2): number {
  if (a === b) return 0;
  const W = world(); let frontier = [a]; const seen = new Set([a]);
  for (let d = 1; d <= max; d++) {
    const next: number[] = [];
    for (const i of frontier) for (const j of W.regions[i].adj) { if (j === b) return d; if (!seen.has(j)) { seen.add(j); next.push(j); } }
    frontier = next;
  }
  return Infinity;
}

/**
 * The sector of `to` an attack from `from` comes through: `from` itself over a land border, the coast a sea lane runs to,
 * else a land neighbour of `to` next to `from` (aircraft), else the coast of `to` nearest to `from`.
 */
export function approachSector(from: number, to: number): number {
  const W = world(), T = W.regions[to];
  if (T.land.includes(from)) return from;
  const lz = W.laneZone.get(to + '|' + from); if (lz !== undefined && lz >= 0 && T.zones.includes(lz)) return coastKey(lz);
  for (const n of T.land) if (W.regions[n].adj.includes(from)) return n;
  const F = W.regions[from]; let best = -1, bd = 1e9;
  for (const z of T.zones) { const c = T.coast[z], d = wrapDx(F.cx, c.x) ** 2 + (F.cz - c.z) ** 2; if (d < bd) { bd = d; best = coastKey(z); } }
  return best;
}
/** Is `s` a sector of the region (a land border or a coast)? */
export const isSector = (region: number, s: number) => world().regions[region].sectors.includes(s);
/** A region id usable as a supply source behind a front: the land neighbour an attack comes over, or the region behind a coast battle. */
export const sectorRegion = (b: { from: number; src?: number }) => isCoast(b.from) ? (b.src ?? -1) : b.from;

/** Regions a power is currently attacking (armies on the way to a foreign region, or battles it fights as the attacker). */
export function offensives(g: GameState, fid: number): Set<number> {
  const s = new Set<number>();
  for (const a of g.armies) {
    if (a.owner !== fid || a.ret || a.decoy) continue;
    // a column forming up or marching to a border to attack counts against the region beyond it
    if (a.inner) { if ((a.ord ?? 0) >= 1 && a.post !== undefined && a.post >= 0 && g.regions[a.post].owner !== fid) s.add(a.post); }
    else if (g.regions[a.to].owner !== fid) s.add(a.to);
  }
  for (const r of g.regions) if (r.owner === fid && r.cs) for (const c of r.cs) if ((c.ord ?? 0) >= 1 && c.p >= 0 && c.p < 1000 && g.regions[c.p].owner !== fid) s.add(c.p);
  for (const b of g.battles) {
    if (b.ended || b.def === fid) continue;
    const inIt = b.agents.length ? b.agents.some(x => x.f === fid && !x.dead && !x.out) : (b.counts ?? []).some(([f, al]) => f === fid && al > 0);
    if (inIt) s.add(b.region);
  }
  return s;
}

/** Re-derive the contested flag from the defences left in a region. */
export function updateContested(r: RegionState) {
  const h = r.defs.find(d => d.f !== r.owner);
  r.contested = h ? h.f : -1;
}

/** A fresh, empty region record. */
export const newRegion = (id: number): RegionState => ({
  id, owner: -1, units: emptyUnits(), men: emptyUnits(), factory: false, barracks: false, airfield: false, defs: [], works: {}, mor: 80, home: -1, cut: false, contested: -1, capitalOf: -1, battle: -1, stance: 0,
});

const NONE: Works = { tr: 0, sand: 0, wire: 0 };
/** Field works on a border sector (read only). */
export const worksAt = (r: RegionState, s: number): Works => r.works[s] ?? NONE;
/** Field works on a border sector, created on demand for writing. */
export const worksFor = (r: RegionState, s: number): Works => (r.works[s] ??= { tr: 0, sand: 0, wire: 0 });
/** Deepest trench on any border of the region. */
export const maxTrench = (r: RegionState) => Object.values(r.works).reduce((m, w) => Math.max(m, w.tr), 0);
/** Building slots a border sector offers (sea lanes have less room, the interior has no field works). */
export function slotsMax(region: number, s: number) { return s < 0 ? SLOTS_INTERIOR : isCoast(s) || world().seaLane.has(region + '|' + s) ? SLOTS_SEA : SLOTS_LAND; }
/** Slots in use on a sector by the owner's defences, sandbags and wire. */
export function slotsUsed(r: RegionState, s: number) {
  let n = 0; for (const d of r.defs) if (d.s === s && d.f === r.owner) n += SLOT_USE[d.k];
  const w = worksAt(r, s); return n + w.sand + w.wire;
}

/** Strength of a unit type in a region or army, 0..1 (1 = every formation at full strength). */
export function strengthOf(units: Units, men: Units, k: keyof Units) { const full = units[k] * FORMATION[k].men; return full > 0 ? Math.max(0, Math.min(1, men[k] / full)) : 1; }
/** Men present. */
export const menTotal = (men: Units) => UNIT_TYPES.reduce((s, k) => s + men[k], 0);
/** Full-strength men for `n` new formations of a type. */
export const freshMen = (k: keyof Units, n: number) => n * FORMATION[k].men;
/** Add formations (and their men) to a units/men pair. */
export function addForce(u: Units, m: Units, k: keyof Units, n: number, men = freshMen(k, n)) { u[k] += n; m[k] += men; }
/** Take `n` formations of a type out of a units/men pair; they leave with their share of the men. */
export function takeForce(u: Units, m: Units, k: keyof Units, n: number): number {
  if (n <= 0 || u[k] <= 0) return 0; n = Math.min(n, u[k]);
  const men = Math.round(m[k] * n / u[k]); u[k] -= n; m[k] -= men; if (u[k] === 0) m[k] = 0; return men;
}
/**
 * Battered formations are merged: when a type's formations average under half strength, they are consolidated so each is
 * at least half full. Returns the number of formations dissolved.
 */
export function consolidate(u: Units, m: Units): number {
  let gone = 0;
  for (const k of UNIT_TYPES) {
    if (u[k] <= 0) { m[k] = 0; continue; }
    const full = FORMATION[k].men; m[k] = Math.max(0, Math.min(m[k], u[k] * full));
    if (m[k] < u[k] * full * .5) { const n = Math.max(m[k] >= full * .15 ? 1 : 0, Math.ceil(m[k] / full)); gone += u[k] - n; u[k] = n; if (!n) m[k] = 0; }
  }
  return gone;
}
/** Combat value of a garrison, weighted by strength. */
export function forcePower(u: Units, m: Units, power: (k: keyof Units) => number) { let p = 0; for (const k of UNIT_TYPES) p += u[k] * power(k) * (.3 + .7 * strengthOf(u, m, k)); return p; }

/** A new army record travelling from one region to another (not yet added to the game). */
export function mkArmy(g: GameState, fid: number, fromId: number, toId: number, speed: number, min: number): Army {
  const W = world(), WA = W.regions[fromId], WB = W.regions[toId];
  const dx = wrapDx(WA.cx, WB.cx), dz = WB.cz - WA.cz, dist = Math.hypot(dx, dz);
  return { id: g.nextId++, owner: fid, units: emptyUnits(), men: emptyUnits(), mor: 75, from: fromId, to: toId, t: 0, dur: Math.max(min, dist / speed), sea: W.seaLane.has(fromId + '|' + toId), ax: WA.cx, az: WA.cz, dx, dz };
}
/** Marching speed of ground troops (world units per second) and the shortest march. */
export const MARCH_SPEED = 2.4, MARCH_MIN = 2.5;

/** Battles still raging in a region (one per front). */
export const frontsOf = (g: GameState, region: number) => g.battles.filter(b => b.region === region && !b.ended);
