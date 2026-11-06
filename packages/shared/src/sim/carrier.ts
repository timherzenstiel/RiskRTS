// Aircraft carriers: a floating airfield. Squadrons of a port region go aboard a docked carrier; from its zone they fly every
// air mission a land airfield can (strike, battle support, rail and factory raids) against regions on that zone's coasts (one
// border away) and their neighbours (two). They come back to the carrier, or land ashore if it is gone. Aboard, each
// squadron adds 1 to the power's sea control there; in a naval battle they fly against the enemy ships.
import { AIR_RANGE, FORMATION, emptyUnits } from '../data/units';
import { SHIP } from '../data/sea';
import { HW, wrapDx } from '../world/build';
import { emit, takeForce, world } from './core';
import { capCheck, locked } from './commands';
import { treatyCheck } from './diplomacy';
import { techOn } from './tech';
import { fleetOf, fleetPos, fleetZone } from './navy';
import type { Army, GameState, Ship } from './types';

/** Where a carrier is and which zone it works from. */
export function carrierAt(g: GameState, s: Ship): { x: number; z: number; zone: number } | null {
  const W = world();
  if (s.fleet >= 0) { const fl = fleetOf(g, s.fleet); if (!fl || fl.sea !== undefined) return null; const p = fleetPos(fl); return { x: p.x, z: p.z, zone: fleetZone(fl) }; }
  if (s.port >= 0) { const R = W.regions[s.port], z = R.zones[0]; if (z === undefined) return null; const c = R.coast[z]; return { x: c.wx, z: c.wz, zone: z }; }
  return null;
}

/** Borders from a carrier's zone to a region: 1 on its coast, 2 next to it, Infinity beyond. */
export function carrierHops(zone: number, to: number): number {
  const W = world(), T = W.regions[to];
  if (T.zones.includes(zone)) return 1;
  if (T.adj.some(n => W.regions[n].zones.includes(zone))) return 2;
  return Infinity;
}

/** Take squadrons of a port region aboard a docked carrier there (n > 0), or fly them off to the region (n < 0). */
export function embarkAir(g: GameState, fid: number, region: number, ship: number, n: number): string | null {
  const r = g.regions[region], s = g.ships.find(x => x.id === ship);
  if (!r || !s || s.owner !== fid || s.kind !== 'carrier') return 'That carrier is not yours.';
  if (s.port !== region || s.fleet >= 0) return `The carrier must lie in the port of ${world().regions[region].name}.`;
  if (r.owner !== fid) return 'Select one of your own ports.';
  n = Math.trunc(n); if (!n) return 'Invalid order.';
  if (n > 0) {
    const room = SHIP.carrier.cap - (s.planes ?? 0); if (room <= 0) return `The carrier is full: it takes ${SHIP.carrier.cap} squadrons.`;
    const k = Math.min(n, room, r.units.plane); if (k < 1) return `No squadrons are based in ${world().regions[region].name}.`;
    takeForce(r.units, r.men, 'plane', k); s.planes = (s.planes ?? 0) + k;
  } else {
    const k = Math.min(-n, s.planes ?? 0); if (k < 1) return 'No squadrons aboard.';
    s.planes = (s.planes ?? 0) - k; r.units.plane += k; r.men.plane += k * FORMATION.plane.men;
  }
  return null;
}

/** An air mission from a carrier against a region in reach of its zone. */
export function carrierAir(g: GameState, fid: number, ship: number, to: number, rail = false, factory = false, brk?: boolean): string | null {
  const W = world(), s = g.ships.find(x => x.id === ship), B = g.regions[to];
  if (!s || s.owner !== fid || s.kind !== 'carrier') return 'That carrier is not yours.';
  if (!B) return 'Unknown region.';
  if ((s.planes ?? 0) < 1) return 'No squadrons aboard. Take some on in port.';
  const at = carrierAt(g, s); if (!at) return 'The carrier is fighting at sea.';
  const hops = carrierHops(at.zone, to);
  if (hops > AIR_RANGE) return `${W.regions[to].name} is out of reach: carrier aircraft reach the coasts of the ${W.zones[at.zone].name} and the regions next to them.`;
  if (rail && !techOn(g, fid, 'railAir')) return locked(g, fid, 'railAir', 'Rail strikes');
  if (factory && !techOn(g, fid, 'bomb')) return locked(g, fid, 'bomb', 'Bombing raids on factories');
  if ((rail || factory) && B.owner === fid) return 'Bomb the regions of your enemies.';
  const cap = capCheck(g, fid, to); if (cap) return cap;
  const tc = treatyCheck(g, fid, to, brk); if (tc) return tc;
  const n = s.planes ?? 0; s.planes = 0;
  // the flight takes off from the carrier; it counts as coming over the coast of the target nearest the carrier
  const T = W.regions[to], from = T.zones.includes(at.zone) ? to : T.adj.find(j => W.regions[j].zones.includes(at.zone)) ?? to;
  const dx = wrapDx(at.x, T.cx), dz = T.cz - at.z, dist = Math.hypot(dx, dz);
  const a: Army = { id: g.nextId++, owner: fid, units: { ...emptyUnits(), plane: n }, men: { ...emptyUnits(), plane: n * FORMATION.plane.men }, mor: 75, from: from === to ? (T.adj.find(j => W.regions[j].zones.includes(at.zone)) ?? to) : from, to, t: 0, dur: Math.max(1.5, dist / 7), sea: false, air: true, ax: at.x, az: at.z, dx, dz, cv: s.id };
  if (rail) a.strike = 'rail'; else if (factory) a.strike = 'factory';
  g.armies.push(a);
  emit(g, { k: 'air', faction: fid, from: a.from, to, units: n });
  return null;
}

/** Aircraft fly back to their carrier (to the coast region nearest it); with the carrier gone they land at `fallback`. */
export function flyToCarrier(g: GameState, f: number, from: number, cv: number, n: number, fallback: number): boolean {
  const s = g.ships.find(x => x.id === cv && x.owner === f); if (!s) return false;
  const at = carrierAt(g, s); if (!at) return false;
  const W = world(), A = W.regions[from];
  const near = W.zones[at.zone].coast.slice().sort((a, b) => (wrapDx(at.x, W.regions[a].cx) ** 2 + (at.z - W.regions[a].cz) ** 2) - (wrapDx(at.x, W.regions[b].cx) ** 2 + (at.z - W.regions[b].cz) ** 2))[0] ?? fallback;
  let dx = wrapDx(A.cx, at.x); const dz = at.z - A.cz; if (Math.abs(dx) > HW) dx = 0;
  g.armies.push({ id: g.nextId++, owner: f, units: { ...emptyUnits(), plane: n }, men: { ...emptyUnits(), plane: n * FORMATION.plane.men }, mor: 75, from, to: near, t: 0, dur: Math.max(1.5, Math.hypot(dx, dz) / 7), sea: false, air: true, ret: true, ax: A.cx, az: A.cz, dx, dz, cv });
  return true;
}

/** A returning flight reaches its carrier: the squadrons land aboard (as many as fit). Returns those that did not. */
export function landOnCarrier(g: GameState, a: Army): number {
  const s = g.ships.find(x => x.id === a.cv && x.owner === a.owner); if (!s) return a.units.plane;
  const k = Math.min(a.units.plane, SHIP.carrier.cap - (s.planes ?? 0)); s.planes = (s.planes ?? 0) + k;
  return a.units.plane - k;
}
