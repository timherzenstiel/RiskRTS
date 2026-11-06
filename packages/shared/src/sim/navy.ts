// The navy: ports, ships and fleets. Ships are not Units: they live in GameState.ships, docked in a port or sailing with a
// fleet. Every crossing of the sea goes by ship: transports carry troops between own coasts (an ordinary move with a sea leg
// uses them on its own), landing flotillas put the first wave ashore in an amphibious assault, battleship squadrons and
// carriers win sea control, which decides interception and supply over the water. Naval battles live in naval.ts.
import { CARGO_SLOTS, CARRIER_FROM, EMBARK, INTERCEPT, LAND_TANKS_FROM, OFFSHORE, PORT, REPAIR, SHIP, START_FLEETS, START_PORTS, UNLOAD, XLIGHTER_FROM, type ShipKind } from '../data/sea';
import { GROUND_TYPES, TICK_SECONDS, UNIT_TYPES, emptyUnits, groundUnits, type Units } from '../data/units';
import { nationOf } from '../data/nations';
import { FACTIONS } from '../data/factions';
import { dateOf } from '../data/calendar';
import { wrapDx } from '../world/build';
import { coastKey, isCoast, pathAt, seaPath, seaPlan, tilePos as tileXZ, zoneAt, zoneOfKey, type SeaNode, type SeaPlan, type ZoneLink } from '../world/zones';
import { emit, frontsOf, rnd, world } from './core';
import { allied, atPeace } from './diplomacy';
import { hasDoc } from './tech';
import { POST_SPEED, addToGroup, armyNo, column, corpsById, groupUnits, legDist, moveK, tagOf, takeCorps, takeGroup, type Taken } from './posts';
import { joinBattle, startBattle } from './battle';
import { joinSeaBattle, seaBattleCheck } from './naval';
import type { Fleet, GameState, Order, RegionState, Ship, Stance } from './types';

// ---------------------------------------------------------------- ports and straits

export const coastal = (id: number) => world().regions[id].zones.length > 0;
/** A finished port. */
export const portReady = (g: GameState, r: RegionState) => !!r.port && (r.portAt ?? 0) <= g.time;
/** At war: not the same power, not allied, no treaty keeping the peace. */
export const atWar = (g: GameState, a: number, b: number) => a >= 0 && b >= 0 && a !== b && !allied(g, a, b) && !atPeace(g, a, b);
const friendly = (g: GameState, a: number, b: number) => a === b || (a >= 0 && b >= 0 && allied(g, a, b));

/** Can ships of power `f` pass this link? A strait is closed to everyone at war with its holder, and to both sides while it is contested. */
export function linkOpen(g: GameState, f: number, L: ZoneLink): boolean {
  if (g.day < L.from) return false;
  if (L.strait < 0) return true;
  const r = g.regions[L.strait];
  if (r.contested >= 0 && (r.owner === f || r.contested === f || atWar(g, f, r.owner) || atWar(g, f, r.contested))) return false;
  return !atWar(g, f, r.owner);
}

/** Water tiles off a region's coasts (optionally one zone). */
export const coastNodes = (r: number, zone?: number): SeaNode[] => { const R = world().regions[r]; return R.zones.filter(z => zone === undefined || z === zone).map(z => ({ z, t: R.coast[z].water })); };
/** Station point of a zone. */
export const zoneNode = (z: number): SeaNode => ({ z, t: world().zones[z].tile });

/** A route for power `f` between sea points through open links. */
export function planRoute(g: GameState, f: number, from: SeaNode[], to: SeaNode[]): (SeaPlan & { path: number[]; zs: number[]; len: number }) | null {
  if (!from.length || !to.length) return null;
  const W = world(), plan = seaPlan(W, from, to, L => linkOpen(g, f, L));
  return plan ? { ...plan, ...seaPath(W, plan) } : null;
}

/** Winter storms in a zone (North Sea, North Atlantic, North Pacific, November to February). */
export const stormNow = (g: GameState, z: number) => { const m = dateOf(g.day).m; return !!world().zones[z]?.storm && (m >= 11 || m <= 2); };

// ---------------------------------------------------------------- ships

export const shipsOf = (g: GameState, f: number) => g.ships.filter(s => s.owner === f);
/** Ships lying ready in a port region. */
export const docked = (g: GameState, region: number, f?: number, kind?: ShipKind) => g.ships.filter(s => s.port === region && s.fleet < 0 && (f === undefined || s.owner === f) && (kind === undefined || s.kind === kind) && (s.ready ?? 0) <= g.time);
export const shipMax = (s: { kind: ShipKind; owner: number }) => SHIP[s.kind].hp * (s.kind !== 'trans' && s.kind !== 'land' && nationOf(s.owner).flags.navy && s.owner === 0 ? 1.25 : 1);
export const fleetShips = (g: GameState, fl: Fleet) => fl.ships.map(id => g.ships.find(s => s.id === id)).filter((s): s is Ship => !!s);
export const fleetOf = (g: GameState, id: number | undefined) => id === undefined ? undefined : g.fleets.find(f => f.id === id);

/** Cost of a ship for a power: the US navy builds battleships cheaper, carriers cost more for those who come late to them. */
export function shipCost(f: number, kind: ShipKind): number {
  let c: number = SHIP[kind].cost;
  if (kind === 'bb' && f === 6) c = Math.round(c * .85);
  if (kind === 'carrier' && f !== 0) c = Math.round(c * CARRIER_FROM.premium);
  return c;
}
export const carrierDay = (f: number) => f === 0 ? CARRIER_FROM.gb : CARRIER_FROM.others;

export function newShip(g: GameState, owner: number, kind: ShipKind, port: number, ready?: number): Ship {
  const s: Ship = { id: g.nextId++, owner, kind, hp: 0, home: port, port, fleet: -1 };
  s.hp = shipMax(s); if (kind === 'carrier') s.planes = 0; if (ready !== undefined) s.ready = ready;
  g.ships.push(s); return s;
}

/** Lay down a ship in a port. Ready after its build time in convoys. */
export function buildShip(g: GameState, fid: number, r: RegionState, kind: ShipKind): string | null {
  const W = world(), f = g.factions[fid], name = W.regions[r.id].name;
  if (!SHIP[kind]) return 'Invalid order.';
  if (r.owner !== fid) return 'Ships are built in your own ports.';
  if (!r.port) return `${name} has no port. Build one first.`;
  if (!portReady(g, r)) return `The port of ${name} is still being built.`;
  if (r.contested >= 0) return `Enemy holdouts still fight in ${name}. Storm them first.`;
  if (r.cut) return `${name} is cut off from supply.`;
  if (SHIP[kind].factory && !r.factory) return `A ${SHIP[kind].one} needs a shipyard: a factory in the port region.`;
  if (kind === 'carrier' && g.day < carrierDay(fid)) return `Aircraft carriers are not available yet: they arrive in ${fid === 0 ? 'Jul 1917' : 'Jul 1918'}.`;
  const c = shipCost(fid, kind);
  if (f.supply < c) return `Not enough supply: a ${SHIP[kind].one} costs ${c}.`;
  f.supply -= c;
  newShip(g, fid, kind, r.id, g.time + SHIP[kind].convoys * TICK_SECONDS);
  return null;
}

/** Order a port. */
export function buildPort(g: GameState, fid: number, r: RegionState): string | null {
  const W = world(), f = g.factions[fid];
  if (!coastal(r.id)) return `${W.regions[r.id].name} has no coast.`;
  if (r.port) return 'Already built.';
  if (f.supply < PORT.cost) return `Not enough supply: a port costs ${PORT.cost}.`;
  f.supply -= PORT.cost; r.port = true; r.portAt = g.time + PORT.convoys * TICK_SECONDS;
  return null;
}

// ---------------------------------------------------------------- fleets

const shipSpeed = (g: GameState, ships: Ship[]) => Math.min(...ships.map(s => SHIP[s.kind].speed)) / moveK(g);
/** Where a fleet is on the map. */
export const fleetPos = (fl: Fleet) => pathAt(fl.path, fl.d);
/** Zone a fleet is in now. */
export const fleetZone = (fl: Fleet) => zoneAt(fl.zs, fl.d);

function newFleet(g: GameState, owner: number, ships: Ship[], o: Partial<Fleet>): Fleet {
  const fl: Fleet = {
    id: g.nextId++, owner, ships: ships.map(s => s.id), task: 'move', state: 'sail', cargo: emptyUnits(), men: emptyUnits(), mor: 75,
    path: [], zs: [], len: 0, d: 0, v: shipSpeed(g, ships), t: 0, from: -1, to: -1, zone: -1, ...o,
  };
  for (const s of ships) { s.port = -1; s.fleet = fl.id; }
  g.fleets.push(fl); return fl;
}
function setRoute(fl: Fleet, r: { path: number[]; zs: number[]; len: number }) { fl.path = r.path; fl.zs = r.zs; fl.len = r.len; fl.d = 0; fl.seen = []; }
/** Seconds to sail a route (storms in the way add 30%). */
export function sailTime(g: GameState, len: number, v: number, zs: number[]) {
  let k = 1; for (let i = 1; i < zs.length; i += 2) if (stormNow(g, zs[i])) { k = 1.3; break; }
  return len / v * k;
}

/** Ships of a kind a power can call on, nearest first to a point at sea (sailing distance from their port). */
function freeShips(g: GameState, f: number, kind: ShipKind, near: SeaNode[]): { s: Ship; d: number }[] {
  const ports = new Map<number, number>();
  const out: { s: Ship; d: number }[] = [];
  for (const s of g.ships) {
    if (s.owner !== f || s.kind !== kind || s.fleet >= 0 || s.port < 0 || (s.ready ?? 0) > g.time) continue;
    let d = ports.get(s.port);
    if (d === undefined) { const r = planRoute(g, f, coastNodes(s.port), near); d = r ? r.len : Infinity; ports.set(s.port, d); }
    if (d < Infinity) out.push({ s, d });
  }
  return out.sort((a, b) => a.d - b.d || a.s.id - b.s.id);
}

/** Slots a set of formations takes aboard. */
export const slotsOf = (u: Units) => u.inf * CARGO_SLOTS.inf + u.mg * CARGO_SLOTS.mg + u.art * CARGO_SLOTS.art + u.tank * CARGO_SLOTS.tank;
/** Formations of `u` that fit in `slots` (guns and tanks are left behind first). */
function fit(u: Units, slots: number): Partial<Units> {
  const n: Partial<Units> = {}; let left = slots;
  for (const k of ['inf', 'mg', 'tank', 'art'] as const) { const per = CARGO_SLOTS[k]; const take = Math.min(u[k], Math.floor(left / per)); n[k] = take; left -= take * per; }
  return n;
}

/** Ships gather at a coast: they sail from their ports, the farthest sets the time. Returns the approach route of the farthest. */
function muster(g: GameState, f: number, picked: { s: Ship; d: number }[], at: SeaNode) {
  const far = picked.reduce((a, b) => (b.d > a.d ? b : a), picked[0]);
  const r = planRoute(g, f, coastNodes(far.s.port), [at]);
  if (r) return r;
  const p = tileXZ(at.t);
  return { path: [p.x, p.z, p.x + .01, p.z], zs: [0, at.z], len: 0 };
}

const embarkTime = (g: GameState, r: RegionState) => (portReady(g, r) && r.owner >= 0 ? EMBARK.port : EMBARK.anchor) * moveK(g);
const shareOf = (src: Units, frac: number): Partial<Units> => {
  frac = Math.max(.05, Math.min(1, frac)); const n: Partial<Units> = {}; let sent = 0;
  for (const k of GROUND_TYPES) { n[k] = Math.round(src[k] * frac); sent += n[k]!; }
  if (sent <= 0) for (const k of GROUND_TYPES) if (src[k] > 0) { n[k] = 1; break; }
  return n;
};

export interface ShipOpts { /** Leave guns and tanks behind instead of refusing when a port is missing (the AI). */ quay?: 'drop'; gn?: number; gk?: number; st?: Stance; /** Ship this one corps (`frac` then applies to it). */ cid?: number }

/**
 * Ship a share of a group (`post` -1 the main army, else a corps) of an own coastal region over the sea to post `toPost` of
 * another own coastal region. The nearest free transports come to the coast, the troops march down and embark, the convoy sails
 * zone by zone, and the troops land and march to their post. One formation always stays behind.
 */
export function shipTroops(g: GameState, fid: number, from: number, post: number, to: number, toPost: number, frac: number, o: ShipOpts = {}): string | null {
  const W = world(), A = g.regions[from], B = g.regions[to];
  if (!A || !B) return 'Unknown region.';
  const an = W.regions[from].name, bn = W.regions[to].name;
  if (A.owner !== fid) return 'Select one of your own regions first.';
  if (B.owner !== fid) return `${bn} is not yours. Ship troops to your own coasts; attack over the sea with an assault.`;
  if (!coastal(from)) return `${an} has no coast.`;
  if (!coastal(to)) return `${bn} has no coast.`;
  if (from === to) return 'The troops are already there.';
  if (toPost >= 0 && !W.regions[to].sectors.includes(toPost)) toPost = -1;
  if (A.battle >= 0 && frontsOf(g, from).some(b => !b.goal)) return `${an} is under attack. Its troops cannot leave.`;
  const one = o.cid !== undefined ? corpsById(A, o.cid) : undefined; if (o.cid !== undefined && !one) return 'That corps is not in this region.';
  if (one) post = one.p;
  const src = one ? one.u : groupUnits(A, post); if (groundUnits(src) < 1) return post < 0 ? `The main army of ${an} has no ground troops.` : 'There is no corps on that border.';
  const tot = groundUnits(A.units); if (tot < 2) return `${an} needs at least 2 ground formations to ship any. One always stays behind.`;
  const route = planRoute(g, fid, coastNodes(from), coastNodes(to));
  if (!route) return `No sea route open to ${bn}: the straits on the way are closed.`;
  const z0 = route.legs[0].z, z1 = route.legs[route.legs.length - 1].z;
  const n = shareOf(src, frac); let sent = 0; for (const k of GROUND_TYPES) sent += n[k] ?? 0;
  if (sent >= tot) for (const k of GROUND_TYPES) if ((n[k] ?? 0) > 0) { n[k]!--; break; }
  // guns and tanks need a quay at both ends
  if (!(portReady(g, A) && portReady(g, B)) && ((n.art ?? 0) > 0 || (n.tank ?? 0) > 0)) {
    if (o.quay !== 'drop' && !(n.inf || n.mg)) return `Batteries and tanks embark and land only at a port. ${portReady(g, A) ? bn : an} has none.`;
    if (o.quay !== 'drop') return `Batteries and tanks embark and land only at a port, and ${portReady(g, A) ? bn : an} has none. Send infantry and MGs, or build a port.`;
    n.art = 0; n.tank = 0;
  }
  const want: Units = { ...emptyUnits(), ...n } as Units;
  if (groundUnits(want) < 1) return 'No troops to ship.';
  const at = { z: z0, t: W.regions[from].coast[z0].water };
  const pool = freeShips(g, fid, 'trans', [at]);
  if (!pool.length) return 'No transports free. Build one in a port, or wait for one to come home.';
  const need = Math.ceil(slotsOf(want) / SHIP.trans.cap), picked = pool.slice(0, need);
  const cargo = fit(want, picked.length * SHIP.trans.cap);
  let out: Taken;
  if (one) { const c1 = one, tag = tagOf(c1), mor = c1.mor, st = c1.st, whole = GROUND_TYPES.every(k => (cargo[k] ?? 0) >= c1.u[k]), t = takeCorps(A, c1, cargo); out = { ...t, mor, st, n: tag.n, tag: whole ? { ...tag, man: true } : undefined }; }
  else out = takeGroup(A, post, 0, cargo);
  if (groundUnits(out.u) < 1) return 'No troops to ship.';
  const appr = muster(g, fid, picked, at);
  const ships = picked.map(p => p.s);
  const fl = newFleet(g, fid, ships, { task: 'move', state: 'muster', cargo: out.u, men: out.m, mor: out.mor, from, to, toPost, zone: z1, st: out.st ?? A.stance, gn: o.gn ?? out.n ?? armyNo(g, A), gk: o.gk ?? (out.n !== undefined ? 1 : 0) });
  if (out.tag) fl.ct = out.tag;
  setRoute(fl, appr);
  const march = legDist(from, post, from, coastKey(z0)) / POST_SPEED * moveK(g);
  fl.t = Math.max(march, sailTime(g, appr.len, fl.v, appr.zs));
  A.deploy = 1; B.deploy = 1;
  emit(g, { k: 'shipped', faction: fid, from, to, units: groundUnits(out.u) });
  return null;
}

/** Zone to assault a region over: the one asked for, the sea lane's zone from `from`, else the target coast nearest to `from`. */
export function assaultZone(from: number, to: number, zone?: number): number {
  const W = world(), T = W.regions[to];
  if (zone !== undefined && T.zones.includes(zone)) return zone;
  const lz = W.laneZone.get(to + '|' + from); if (lz !== undefined && lz >= 0 && T.zones.includes(lz)) return lz;
  const F = W.regions[from]; let best = T.zones[0] ?? -1, bd = 1e9;
  for (const z of T.zones) { const c = T.coast[z], s = F.zones.includes(z) ? 0 : 400, d = wrapDx(F.cx, c.x) ** 2 + (F.cz - c.z) ** 2 + s; if (d < bd) { bd = d; best = z; } }
  return best;
}

/** Formations that may ride the landing craft in the first wave. */
export function firstWaveOf(g: GameState, u: Units, flotillas: number): Partial<Units> {
  let left = flotillas * SHIP.land.cap; const n: Partial<Units> = {};
  if (g.day >= LAND_TANKS_FROM) { n.tank = Math.min(u.tank, Math.floor(left / CARGO_SLOTS.tank)); left -= n.tank * CARGO_SLOTS.tank; }
  n.inf = Math.min(u.inf, Math.ceil(left * .75)); left -= n.inf;
  n.mg = Math.min(u.mg, left); left -= n.mg;
  if (left > 0) { const more = Math.min(u.inf - n.inf, left); n.inf += more; }
  return n;
}

/**
 * Amphibious assault: a share of the main army of an own coastal region attacks an enemy coast from the sea. Landing flotillas
 * carry the first wave (infantry and MGs; tanks from 1918), transports the rest, which lands once the beach is taken. Battleships
 * in the port sail with it when `escort` is set (they bombard the beach). The fleet assembles offshore for a while, in view.
 */
export function landing(g: GameState, fid: number, from: number, to: number, frac: number, goal: Order = 2, zone?: number, escort = true): string | null {
  const W = world(), A = g.regions[from], B = g.regions[to];
  if (!A || !B) return 'Unknown region.';
  const an = W.regions[from].name, bn = W.regions[to].name;
  if (A.owner !== fid) return 'Select one of your own regions first.';
  if (friendly(g, fid, B.owner)) return `${bn} is not an enemy region.`;
  if (!coastal(from)) return `${an} has no coast.`;
  if (!coastal(to)) return `${bn} has no coast to land on.`;
  if (A.battle >= 0 && frontsOf(g, from).some(b => !b.goal)) return `${an} is under attack. Its troops cannot leave.`;
  const z = assaultZone(from, to, zone); if (z < 0) return `${bn} has no coast to land on.`;
  const route = planRoute(g, fid, coastNodes(from), coastNodes(to, z));
  if (!route) return `No sea route open to the coast of ${bn}: the straits on the way are closed.`;
  const main = groupUnits(A, -1), tot = groundUnits(A.units);
  if (groundUnits(main) < 1) return `The main army of ${an} is empty. Move troops back to the centre first.`;
  if (tot < 2) return `${an} needs at least 2 ground formations for an assault. One always stays behind.`;
  const z0 = route.legs[0].z, at = { z: z0, t: W.regions[from].coast[z0].water };
  const crafts = freeShips(g, fid, 'land', [at]);
  if (!crafts.length) return 'No landing flotillas free. Build one in a port: they carry the first wave ashore.';
  const n = shareOf(main, frac);
  let sent = 0; for (const k of GROUND_TYPES) sent += n[k] ?? 0;
  if (sent >= tot) for (const k of GROUND_TYPES) if ((n[k] ?? 0) > 0) { n[k]!--; break; }
  const want: Units = { ...emptyUnits(), ...n } as Units;
  if (!portReady(g, A)) { want.art = 0; want.tank = g.day >= LAND_TANKS_FROM ? want.tank : 0; }
  // the first wave fills the landing craft it needs; transports take the rest
  const wave = firstWaveOf(g, want, crafts.length);
  const waveSlots = (wave.inf ?? 0) + (wave.mg ?? 0) + (wave.tank ?? 0) * CARGO_SLOTS.tank;
  if (waveSlots < 1) return 'The first wave lands from boats: it needs infantry or MGs (tanks from 1918).';
  const lc = crafts.slice(0, Math.max(1, Math.ceil(waveSlots / SHIP.land.cap)));
  const rest = { ...want }; for (const k of GROUND_TYPES) rest[k] -= wave[k] ?? 0;
  const trans = slotsOf(rest) > 0 ? freeShips(g, fid, 'trans', [at]) : [];
  const tp = trans.slice(0, Math.ceil(slotsOf(rest) / SHIP.trans.cap));
  const restFit = fit(rest, tp.length * SHIP.trans.cap);
  const cargo: Partial<Units> = {}; for (const k of GROUND_TYPES) cargo[k] = (wave[k] ?? 0) + (restFit[k] ?? 0);
  const out = takeGroup(A, -1, 0, cargo); if (groundUnits(out.u) < 1) return 'No troops for the assault.';
  const war = escort ? docked(g, from, fid, 'bb').filter(s => s.hp > shipMax(s) * .4).map(s => ({ s, d: 0 })) : [];
  const picked = [...lc, ...tp, ...war];
  const appr = muster(g, fid, picked, at);
  const fl = newFleet(g, fid, picked.map(p => p.s), { task: 'assault', state: 'muster', cargo: out.u, men: out.m, mor: A.mor, from, to, zone: z, goal: goal === 1 ? 1 : 2, st: A.stance, gn: armyNo(g, A), gk: 0 });
  setRoute(fl, appr);
  fl.t = Math.max(legDist(from, -1, from, coastKey(z0)) / POST_SPEED * moveK(g), sailTime(g, appr.len, fl.v, appr.zs));
  emit(g, { k: 'march', faction: fid, from, to, units: groundUnits(out.u) });
  return null;
}

/** Station warships in a zone: those docked in a port region (of a kind), or a fleet at sea. */
export function station(g: GameState, fid: number, zone: number, region?: number, fleet?: number, kind?: 'bb' | 'carrier'): string | null {
  const W = world(); if (!W.zones[zone]) return 'Pick a sea zone.';
  let fl: Fleet | undefined;
  if (fleet !== undefined) {
    fl = fleetOf(g, fleet); if (!fl || fl.owner !== fid) return 'That fleet is not yours.';
    if (fl.sea !== undefined) return 'The fleet is fighting. Break off first.';
    if (fl.task !== 'station' && fl.task !== 'return') return 'That fleet is on a voyage. Station warships from a port or a fleet at sea.';
    if (fleetShips(g, fl).some(s => s.kind === 'trans' || s.kind === 'land')) return 'Transports do not hold a zone.';
    const p = fleetPos(fl), z = fleetZone(fl);
    const r = planRoute(g, fid, [{ z, t: nearestWater(p.x, p.z, z) }], [zoneNode(zone)]);
    if (!r) return `No sea route open to the ${W.zones[zone].name}.`;
    setRoute(fl, r); fl.task = 'station'; fl.state = 'sail'; fl.zone = zone; fl.v = shipSpeed(g, fleetShips(g, fl));
    return null;
  }
  const R = region !== undefined ? g.regions[region] : undefined;
  if (!R || R.owner !== fid) return 'Select one of your own ports.';
  const ws = docked(g, R.id, fid).filter(s => (kind ? s.kind === kind : s.kind === 'bb' || s.kind === 'carrier') && s.hp > shipMax(s) * .4);
  if (!ws.length) return `No ${kind === 'carrier' ? 'carriers' : 'battleships'} ready in ${W.regions[R.id].name} (damaged ships stay for repairs).`;
  const r = planRoute(g, fid, coastNodes(R.id), [zoneNode(zone)]);
  if (!r) return `No sea route open to the ${W.zones[zone].name}.`;
  fl = newFleet(g, fid, ws, { task: 'station', state: 'sail', from: R.id, to: -1, zone });
  setRoute(fl, r);
  return null;
}

/** Send a fleet back to port (the nearest own port with a route, its home if it can). */
export function dock(g: GameState, fid: number, fleet: number): string | null {
  const fl = fleetOf(g, fleet); if (!fl || fl.owner !== fid) return 'That fleet is not yours.';
  if (fl.sea !== undefined) return 'The fleet is fighting. Break off first.';
  if (fl.task === 'move' || fl.task === 'assault') return 'The convoy is on its way. Its ships come home once it has landed.';
  return goHome(g, fl) ? null : 'No own port can be reached.';
}

/** Nearest water tile of a zone to a point. */
function nearestWater(x: number, z: number, zone: number): number {
  const W = world(); let best = W.zones[zone].tile, bd = 1e9;
  for (const r of W.zones[zone].coast) { const c = W.regions[r].coast[zone], d = wrapDx(x, c.wx) ** 2 + (z - c.wz) ** 2; if (d < bd) { bd = d; best = c.water; } }
  const s = W.zones[zone]; const d = wrapDx(x, s.x) ** 2 + (z - s.z) ** 2; if (d < bd) best = s.tile;
  return best;
}
/** Where a fleet is as a point at sea. */
export function fleetNode(fl: Fleet): SeaNode { const p = fleetPos(fl), z = fleetZone(fl); return { z, t: nearestWater(p.x, p.z, z) }; }

/** Send a fleet (and any cargo it still carries) to an own port: its home port if it can, else the nearest. */
export function goHome(g: GameState, fl: Fleet): boolean {
  const ships = fleetShips(g, fl); if (!ships.length) { dissolve(g, fl); return false; }
  const home = ships[0].home, at = fleetNode(fl);
  const ok = (r: RegionState) => r.owner === fl.owner && portReady(g, r) && coastal(r.id);
  let dest = ok(g.regions[home]) ? home : -1;
  let route = dest >= 0 ? planRoute(g, fl.owner, [at], coastNodes(dest)) : null;
  if (!route) {
    let bl = Infinity;
    for (const r of g.regions) { if (!ok(r)) continue; const rr = planRoute(g, fl.owner, [at], coastNodes(r.id)); if (rr && rr.len < bl) { bl = rr.len; route = rr; dest = r.id; } }
  }
  if (!route || dest < 0) return false;
  setRoute(fl, route); fl.task = 'return'; fl.state = 'sail'; fl.to = dest; fl.v = shipSpeed(g, ships); fl.battle = undefined;
  return true;
}

/** Some ships of a fleet sail on as a fleet of their own (same position and route). */
export function splitFleet(g: GameState, fl: Fleet, ships: Ship[]): Fleet {
  const ids = new Set(ships.map(s => s.id)); fl.ships = fl.ships.filter(id => !ids.has(id));
  const nf = newFleet(g, fl.owner, ships, { task: 'return', state: 'sail', from: fl.from, to: ships[0].home, zone: fl.zone, path: [...fl.path], zs: [...fl.zs], len: fl.len, d: fl.d, seen: [...(fl.seen ?? [])] });
  if (fl.ships.length) fl.v = shipSpeed(g, fleetShips(g, fl));
  return nf;
}

/** Battleships bombarding a battle on a coast: in the assault fleet of that beach, or stationed in the zone (first line only). */
export function bombarding(g: GameState, b: { id: number; from: number; attacker: number; stage?: number }): Ship[] {
  if (!isCoast(b.from) || (b.stage ?? 0) >= 2 || !g.ships) return [];
  const z = zoneOfKey(b.from), out: Ship[] = [];
  for (const fl of g.fleets) {
    if (fl.sea !== undefined || !friendly(g, fl.owner, b.attacker)) continue;
    if (!(fl.battle === b.id && (fl.state === 'beach' || fl.state === 'unload')) && !(fl.state === 'stationed' && fleetZone(fl) === z)) continue;
    for (const s of fleetShips(g, fl)) if (s.kind === 'bb') out.push(s);
  }
  return out;
}

function dissolve(g: GameState, fl: Fleet) { const i = g.fleets.indexOf(fl); if (i >= 0) g.fleets.splice(i, 1); }
function sinkShip(g: GameState, s: Ship) {
  const i = g.ships.indexOf(s); if (i >= 0) g.ships.splice(i, 1);
  const fl = fleetOf(g, s.fleet); if (fl) fl.ships = fl.ships.filter(id => id !== s.id);
}
export { sinkShip };

/** Ships of a fleet that carry troops (transports and landing craft). */
const carriers = (ships: Ship[]) => ships.filter(s => s.kind === 'trans' || s.kind === 'land');

/** Lose the share of the troops aboard that went down with `lost` of the fleet's carrying ships. Returns men lost. */
export function loseCargo(fl: Fleet, lost: number, of: number): number {
  if (lost <= 0 || of <= 0) return 0;
  const share = Math.min(1, lost / of); let men = 0;
  for (const k of UNIT_TYPES) { const n = Math.round(fl.cargo[k] * share), m = Math.round(fl.men[k] * share); fl.cargo[k] -= n; fl.men[k] -= m; men += m; if (fl.cargo[k] <= 0) { fl.cargo[k] = 0; fl.men[k] = 0; } }
  return men;
}

/** Troops leave a fleet: they land at a coast of an own region and march to their post (or join a front burning there). */
function landTroops(g: GameState, fl: Fleet, region: number, post: number) {
  if (groundUnits(fl.cargo) < 1) return;
  const coast = coastKey(fl.zone >= 0 && world().regions[region].zones.includes(fl.zone) ? fl.zone : world().regions[region].zones[0]);
  const front = frontsOf(g, region).find(b => b.def === fl.owner && b.from === (post >= 0 ? post : coast));
  column(g, fl.owner, region, coast, region, post, fl.cargo, fl.men, fl.mor, { stance: fl.st, gn: fl.gn, gk: fl.gk, front: front?.id, ct: fl.ct });
  fl.cargo = emptyUnits(); fl.men = emptyUnits();
}

// ---------------------------------------------------------------- sea control

export interface SeaControl { /** Strength per power per zone at sea (battleships, carriers' squadrons). */ at: number[][]; /** Docked battleships: deny only. */ deny: number[][]; /** U-boats (against transports). */ sub: number[][]; ctrl: number[] }
const ctrlCache = new WeakMap<GameState, { t: number; c: SeaControl }>();

/** Who holds each sea zone. Cached per game moment. */
export function seaControl(g: GameState): SeaControl {
  const hit = ctrlCache.get(g); if (hit && hit.t === g.time) return hit.c;
  const W = world(), Z = W.zones.length, F = g.factions.length;
  const mk = () => Array.from({ length: F }, () => new Array(Z).fill(0));
  const at = mk(), deny = mk(), sub = mk();
  for (const s of g.ships ?? []) {
    if ((s.ready ?? 0) > g.time) continue;
    const share = s.hp / shipMax(s);
    if (s.fleet >= 0) {
      const fl = fleetOf(g, s.fleet); if (!fl || !fl.zs.length) continue;
      const z = fleetZone(fl); if (z < 0) continue;
      if (s.kind === 'bb') at[s.owner][z] += SHIP.bb.sea * share;
      if (s.kind === 'carrier') at[s.owner][z] += s.planes ?? 0;
    } else if (s.kind === 'bb' && s.port >= 0) for (const z of W.regions[s.port].zones) deny[s.owner][z] += share;
  }
  for (const f of g.factions) {
    if (!f.alive || !hasDoc(g, f.id, 'blockade')) continue;
    for (const r of g.regions) if (r.owner === f.id) for (const z of W.regions[r.id].zones) sub[f.id][z] = 1;
  }
  const ctrl = new Array(Z).fill(-1);
  for (let z = 0; z < Z; z++) {
    for (let f = 0; f < F; f++) {
      if (at[f][z] <= 0) continue;
      let ok = true; for (let e = 0; e < F; e++) if (e !== f && atWar(g, f, e) && at[e][z] + deny[e][z] >= at[f][z] + deny[f][z]) { ok = false; break; }
      if (ok) { ctrl[z] = f; break; }
    }
  }
  const c = { at, deny, sub, ctrl };
  ctrlCache.set(g, { t: g.time, c }); return c;
}
/** An enemy of power `f` controls zone `z`. */
export const enemySea = (g: GameState, f: number, z: number) => { const c = seaControl(g).ctrl[z]; return c >= 0 && atWar(g, f, c); };
export const ownSea = (g: GameState, f: number, z: number) => { const c = seaControl(g).ctrl[z]; return c >= 0 && friendly(g, f, c); };

/**
 * Supply over the sea between two port regions of power `o` (or a sea lane): 2 full when the power holds every zone on the way,
 * 1 thin when no enemy holds any, 0 when an enemy does. Royal Navy: own lanes are always full unless an enemy holds the zone.
 */
export function seaQuality(g: GameState, o: number, zones: number[], hubs: boolean): number {
  const N = nationOf(o);
  if (zones.some(z => enemySea(g, o, z))) return 0;
  let q = hubs && zones.every(z => ownSea(g, o, z)) ? 2 : 1;
  if (N.flags.navy && o === 0 && g.factions[o]?.alive) q = 2;
  if (N.flags.blockaded || N.flags.poorRails) q = Math.min(q, 1);
  return q;
}

/** Sea supply links of a power between its ports that no land route joins: [a, b, quality]. Cached per convoy day. */
const linkCache = new WeakMap<GameState, { k: string; l: [number, number, number][][] }>();
export function seaLinks(g: GameState, o: number): [number, number, number][] {
  const key = g.day + ':' + g.time.toFixed(0);
  let c = linkCache.get(g); if (!c || c.k !== key) { c = { k: key, l: [] }; linkCache.set(g, c); }
  if (c.l[o]) return c.l[o];
  const ports = g.regions.filter(r => r.owner === o && portReady(g, r) && r.contested < 0);
  const out: [number, number, number][] = [];
  for (let i = 0; i < ports.length; i++) for (let j = i + 1; j < ports.length; j++) {
    const r = planRoute(g, o, coastNodes(ports[i].id), coastNodes(ports[j].id)); if (!r) continue;
    const zones: number[] = []; for (let k = 1; k < r.zs.length; k += 2) zones.push(r.zs[k]);
    const q = seaQuality(g, o, zones, true); if (q > 0) out.push([ports[i].id, ports[j].id, Math.min(q, 1 + (ports[i].factory || ports[i].capitalOf === o ? 1 : 0) * (ports[j].factory || ports[j].capitalOf === o ? 1 : 0))]);
  }
  c.l[o] = out; return out;
}

/** Is an attacker's beachhead on zone `z` supplied (from region `src`)? */
export const beachSupplied = (g: GameState, f: number, z: number, src: number) => { const s = g.regions[src]; return !!s && s.owner === f && !s.cut && !enemySea(g, f, z); };

// ---------------------------------------------------------------- the voyage

/** Interception when a fleet with troops enters a zone: U-boats of enemies at war roll against its escort. */
function intercept(g: GameState, fl: Fleet, z: number) {
  const ships = fleetShips(g, fl), carry = carriers(ships); if (!carry.length) return;
  const c = seaControl(g);
  let S = 0; for (const e of g.factions) if (atWar(g, fl.owner, e.id)) S = Math.max(S, c.sub[e.id][z]);
  if (S <= 0) return;
  // escort: the power's own strength in the zone (warships sailing with the convoy count there too)
  const E = c.at[fl.owner][z];
  const p = Math.min(INTERCEPT.max, INTERCEPT.per * (S - E)); if (p <= 0) return;
  let lost = 0; const of = carry.length;
  for (const s of carry) if (rnd(g) < p) { sinkShip(g, s); lost++; }
  if (lost) {
    const men = loseCargo(fl, lost, of);
    emit(g, { k: 'convoyLost', faction: fl.owner, zone: z, ships: lost, men, by: 'uboat' });
    if (!fleetShips(g, fl).length) dissolve(g, fl);
  }
}

/** Advance every fleet (called each step). */
export function stepNavy(g: GameState, dt: number) {
  if (!g.ships) return;
  // ships launched, ports finished, ships in ports that fell scuttled by their crews
  for (let i = g.ships.length - 1; i >= 0; i--) {
    const s = g.ships[i];
    if (s.ready !== undefined && s.ready <= g.time) { delete s.ready; emit(g, { k: 'shipBuilt', faction: s.owner, region: s.port, kind: s.kind }); }
    if (s.fleet < 0 && s.port >= 0) {
      const r = g.regions[s.port];
      if (r.owner !== s.owner) { g.ships.splice(i, 1); emit(g, { k: 'scuttled', faction: s.owner, region: s.port, n: 1 }); }
    }
  }
  for (const r of g.regions) if (r.port && r.portAt !== undefined && r.portAt <= g.time) { delete r.portAt; if (r.owner >= 0) emit(g, { k: 'portBuilt', faction: r.owner, region: r.id }); }
  for (let i = g.fleets.length - 1; i >= 0; i--) {
    const fl = g.fleets[i]; if (!g.fleets.includes(fl)) continue;
    if (!fleetShips(g, fl).length) { failCargo(g, fl); dissolve(g, fl); continue; }
    if (fl.sea !== undefined) continue;
    stepFleet(g, fl, dt);
  }
  seaBattleCheck(g);
}

/** Troops still aboard a fleet that is lost or cannot land anywhere. */
function failCargo(g: GameState, fl: Fleet) { const men = loseCargo(fl, 1, 1); if (men > 0) emit(g, { k: 'convoyLost', faction: fl.owner, zone: fleetZone(fl), ships: 0, men, by: 'navy' }); }

function stepFleet(g: GameState, fl: Fleet, dt: number) {
  const W = world();
  switch (fl.state) {
    case 'muster': {
      fl.d = Math.min(fl.len, fl.d + fl.v * dt); fl.t -= dt;
      if (fl.t <= 0 && fl.d >= fl.len) { fl.state = 'embark'; fl.t = embarkTime(g, g.regions[fl.from]); }
      return;
    }
    case 'embark': {
      fl.t -= dt; if (fl.t > 0) return;
      const dest = fl.task === 'assault' ? coastNodes(fl.to, fl.zone) : coastNodes(fl.to);
      const r = planRoute(g, fl.owner, [fleetNode(fl)], dest);
      if (!r) { abortVoyage(g, fl); return; }
      setRoute(fl, r); fl.state = 'sail'; if (fl.task === 'move') fl.zone = r.legs[r.legs.length - 1].z;
      return;
    }
    case 'sail': {
      const k = stormNow(g, fleetZone(fl)) ? 1 / 1.3 : 1;
      fl.d = Math.min(fl.len, fl.d + fl.v * k * dt);
      const z = fleetZone(fl);
      if (z >= 0 && !(fl.seen ??= []).includes(z)) {
        fl.seen.push(z);
        if (joinSeaBattle(g, fl, z)) return;
        intercept(g, fl, z); if (!g.fleets.includes(fl)) return;
      }
      if (fl.d >= fl.len) arriveFleet(g, fl);
      return;
    }
    case 'land': {
      fl.t -= dt; if (fl.t > 0) return;
      const B = g.regions[fl.to];
      if (B.owner === fl.owner) { landTroops(g, fl, fl.to, fl.toPost ?? -1); goHome(g, fl) || dockAt(g, fl, fl.to); return; }
      abortVoyage(g, fl); return;
    }
    case 'offshore': {
      if (stormNow(g, fl.zone)) { fl.storm = true; return; }
      fl.storm = false; fl.t -= dt; if (fl.t > 0) return;
      startLanding(g, fl); return;
    }
    case 'beach': case 'unload': { stepBeach(g, fl, dt); return; }
    case 'stationed': {
      // a squadron worn down below 40% goes home for repairs
      if (fleetShips(g, fl).some(s => s.kind === 'bb' || s.kind === 'carrier') && fleetShips(g, fl).every(s => s.hp < shipMax(s) * .4)) goHome(g, fl);
      return;
    }
  }
}

/** A voyage that cannot go on: the troops go back to their port of departure (or the nearest own port). */
function abortVoyage(g: GameState, fl: Fleet) {
  const back = g.regions[fl.from];
  if (back.owner === fl.owner && coastal(back.id)) {
    const r = planRoute(g, fl.owner, [fleetNode(fl)], coastNodes(back.id));
    if (r) { setRoute(fl, r); fl.task = 'move'; fl.state = 'sail'; fl.to = back.id; fl.toPost = -1; fl.zone = r.legs[r.legs.length - 1].z; return; }
  }
  if (groundUnits(fl.cargo) > 0) {
    // any own coast will do
    let best: ReturnType<typeof planRoute> = null, to = -1;
    for (const r of g.regions) { if (r.owner !== fl.owner || !coastal(r.id)) continue; const rr = planRoute(g, fl.owner, [fleetNode(fl)], coastNodes(r.id)); if (rr && (!best || rr.len < best.len)) { best = rr; to = r.id; } }
    if (best) { setRoute(fl, best); fl.task = 'move'; fl.state = 'sail'; fl.to = to; fl.toPost = -1; fl.zone = best.legs[best.legs.length - 1].z; return; }
    failCargo(g, fl);
  }
  if (!goHome(g, fl)) { for (const s of fleetShips(g, fl)) sinkShip(g, s); dissolve(g, fl); }
}

function dockAt(g: GameState, fl: Fleet, region: number) {
  for (const s of fleetShips(g, fl)) { s.fleet = -1; s.port = region; s.home = region; }
  dissolve(g, fl);
}

function arriveFleet(g: GameState, fl: Fleet) {
  const B = g.regions[fl.to];
  switch (fl.task) {
    case 'move':
      if (B.owner !== fl.owner) { abortVoyage(g, fl); return; }
      fl.state = 'land'; fl.t = embarkTime(g, B); return;
    case 'assault':
      if (friendly(g, fl.owner, B.owner) || !atWar(g, fl.owner, B.owner)) {
        if (B.owner === fl.owner) { fl.state = 'land'; fl.t = embarkTime(g, B); } else abortVoyage(g, fl);
        return;
      }
      fl.state = 'offshore'; fl.t = OFFSHORE * moveK(g);
      emit(g, { k: 'offshore', faction: fl.owner, region: B.id, zone: fl.zone, owner: B.owner, est: Math.max(1, Math.round(groundUnits(fl.cargo) / 5) * 5) });
      return;
    case 'return': {
      if (B.owner === fl.owner && portReady(g, B)) {
        if (groundUnits(fl.cargo) > 0) { addToGroup(g, B, -1, fl.cargo, fl.men, fl.mor, fl.ct); fl.cargo = emptyUnits(); fl.men = emptyUnits(); }
        dockAt(g, fl, B.id); return;
      }
      if (!goHome(g, fl)) { failCargo(g, fl); for (const s of fleetShips(g, fl)) sinkShip(g, s); dissolve(g, fl); }
      return;
    }
    case 'station': fl.state = 'stationed'; return;
  }
}

// ---------------------------------------------------------------- the landing

/** The first wave goes ashore: a battle on the coast sector, the landing craft's troops against its defenders. */
function startLanding(g: GameState, fl: Fleet) {
  const W = world(), B = g.regions[fl.to], R = W.regions[fl.to], ships = fleetShips(g, fl);
  if (!atWar(g, fl.owner, B.owner)) { abortVoyage(g, fl); return; }
  const lc = ships.filter(s => s.kind === 'land').length;
  const wave = firstWaveOf(g, fl.cargo, lc);
  if (groundUnits({ ...emptyUnits(), ...wave } as Units) < 1) { abortVoyage(g, fl); return; }
  const u = emptyUnits(), m = emptyUnits();
  for (const k of GROUND_TYPES) { const n = wave[k] ?? 0; if (!n) continue; const men = Math.round(fl.men[k] * n / fl.cargo[k]); u[k] = n; m[k] = men; fl.cargo[k] -= n; fl.men[k] -= men; }
  const sector = coastKey(fl.zone), c = R.coast[fl.zone];
  let dx = wrapDx(c.x, c.wx), dz = c.wz - c.z; const L = Math.hypot(dx, dz);
  if (L < 1e-6) { const zc = W.zones[fl.zone]; dx = wrapDx(c.x, zc.x); dz = zc.z - c.z; }
  const l2 = Math.hypot(dx, dz) || 1, dir = { x: dx / l2, z: dz / l2 };
  let b = frontsOf(g, B.id).find(x => x.from === sector && x.attacker === fl.owner);
  if (!b) { b = startBattle(g, B, dir, fl.owner, sector, fl.goal ?? 2); b.src = fl.from; b.amph = fl.id; }
  joinBattle(g, b, fl.owner, u, dir, false, B.id, m, fl.mor, fl.st, fl.ct);
  fl.state = 'beach'; fl.battle = b.id; fl.t = 0;
  emit(g, { k: 'landing', faction: fl.owner, region: B.id, zone: fl.zone, ok: true, owner: B.owner });
}

/** While the beach is fought over: coast guns sink landing craft; once the first line falls, the second wave lands. */
function stepBeach(g: GameState, fl: Fleet, dt: number) {
  const b = g.battles.find(x => x.id === fl.battle);
  const B = g.regions[fl.to];
  if (!b || b.ended) {
    if (B.owner === fl.owner) { if (groundUnits(fl.cargo) > 0) { addToGroup(g, B, -1, fl.cargo, fl.men, fl.mor, fl.ct); fl.cargo = emptyUnits(); fl.men = emptyUnits(); } }
    else {
      // repulsed: a quarter of the landing craft is lost to the coast guns, the rest carry home whatever did not land
      const lc = fleetShips(g, fl).filter(s => s.kind === 'land'); for (let k = 0; k < Math.ceil(lc.length / 4); k++) sinkShip(g, lc[k]);
      emit(g, { k: 'landing', faction: fl.owner, region: B.id, zone: fl.zone, ok: false, owner: B.owner });
    }
    goHome(g, fl) || (failCargo(g, fl), dissolve(g, fl));
    return;
  }
  if ((b.stage ?? 0) === 0) {
    // the coast guns of that sector fire at the boats running in
    let guns = 0; for (const a of b.agents) if (!a.dead && !a.out && a.f === b.def && (a.type === 'fort' || a.type === 'pill' || a.type === 'bunk')) guns += a.type === 'fort' ? 1 : .4;
    const lc = fleetShips(g, fl).filter(s => s.kind === 'land');
    if (guns && lc.length && rnd(g) < dt * .5) { const s = lc[Math.floor(rnd(g) * lc.length)]; s.hp -= guns * (g.day >= XLIGHTER_FROM ? .5 : 1) * 2; if (s.hp <= 0) sinkShip(g, s); }
    return;
  }
  if (fl.state === 'beach') { fl.state = 'unload'; fl.t = UNLOAD * moveK(g); return; }
  fl.t -= dt; if (fl.t > 0) return;
  if (groundUnits(fl.cargo) > 0) {
    const dir = { x: b.ax, z: b.az };
    joinBattle(g, b, fl.owner, fl.cargo, dir, false, B.id, fl.men, fl.mor, fl.st, fl.ct);
    fl.cargo = emptyUnits(); fl.men = emptyUnits();
  }
  // the battleships stay to bombard while the beach is fought over; the rest sail home
  const war = fleetShips(g, fl).filter(s => s.kind === 'bb');
  if (war.length && (b.stage ?? 0) < 2) {
    const rest = fleetShips(g, fl).filter(s => s.kind !== 'bb');
    if (rest.length) { const home = splitFleet(g, fl, rest); goHome(g, home); fl.v = shipSpeed(g, war); }
    return;
  }
  goHome(g, fl);
}

/** Attackers pulled out of a beach battle re-embark if their landing craft are still there. Returns true when handled. */
export function reembark(g: GameState, b: { amph?: number; region: number; from: number }, fid: number, u: Units, m: Units, mor: number): boolean {
  const fl = fleetOf(g, b.amph); if (!fl || fl.owner !== fid) return false;
  if (!fleetShips(g, fl).some(s => s.kind === 'land' || s.kind === 'trans')) return false;
  for (const k of UNIT_TYPES) { fl.cargo[k] += u[k]; fl.men[k] += m[k]; }
  fl.mor = mor; fl.battle = undefined; goHome(g, fl);
  return true;
}

// ---------------------------------------------------------------- convoy bookkeeping

/** Each convoy: repairs in port, U-boats and mines wear down battleships stationed in enemy waters. */
export function navyConvoy(g: GameState) {
  const c = seaControl(g);
  for (const s of g.ships) {
    const max = shipMax(s);
    if (s.fleet < 0 && s.port >= 0 && s.hp < max) { const r = g.regions[s.port]; s.hp = Math.min(max, s.hp + (r.factory ? REPAIR.factory : REPAIR.base)); }
    if (s.kind === 'bb' && s.fleet >= 0) {
      const fl = fleetOf(g, s.fleet); if (!fl || fl.state !== 'stationed') continue;
      const z = fleetZone(fl); if (g.factions.some(e => atWar(g, s.owner, e.id) && c.sub[e.id][z] > 0)) s.hp = Math.max(1, s.hp - 2);
    }
  }
}

// ---------------------------------------------------------------- start of the war

/** Ports of 1914 and the fleets each power starts with. */
export function startNavy(g: GameState, scale = 1) {
  const W = world();
  g.ships ??= []; g.fleets ??= []; g.seaBattles ??= [];
  for (const name of START_PORTS) { const r = g.regions[W.byName[name].id]; if (coastal(r.id)) r.port = true; }
  START_FLEETS.forEach((S, f) => {
    if (f >= g.factions.length || !g.factions[f].alive) return;
    const cap = g.regions.find(r => r.capitalOf === f);
    const base = cap && cap.owner === f && portReady(g, cap) ? cap : g.regions.find(r => r.owner === f && portReady(g, r));
    if (!base) return;
    const left = { trans: Math.round(S.trans * scale), land: Math.round(S.land * scale), bb: Math.round(S.bb * scale) };
    for (const a of S.at ?? []) {
      const r = g.regions[W.byName[a.region].id]; if (r.owner !== f || !portReady(g, r)) continue;
      for (const k of ['trans', 'land', 'bb'] as const) { const n = Math.min(left[k], Math.round((a[k] ?? 0) * scale)); for (let i = 0; i < n; i++) newShip(g, f, k, r.id); left[k] -= n; }
    }
    for (const k of ['trans', 'land', 'bb'] as const) for (let i = 0; i < left[k]; i++) newShip(g, f, k, base.id);
  });
}

/** Version 5 saves: ports, start fleets (fewer for powers that lost their home ports), and lane sectors become coast sectors. */
export function migrateNavy(g: GameState) {
  const W = world();
  const lost = g.factions.map(f => { const cap = g.regions.find(r => r.capitalOf === f.id); return !cap || cap.owner !== f.id; });
  g.ships = []; g.fleets = []; g.seaBattles = [];
  startNavy(g, 1);
  for (const f of g.factions) if (lost[f.id]) g.ships = g.ships.filter(s => s.owner !== f.id || rnd(g) < .5);
  for (const r of g.regions) {
    const R = W.regions[r.id];
    for (const n of R.seaAdj) {
      const z = W.laneZone.get(r.id + '|' + n); if (z === undefined || z < 0) continue; const k = coastKey(z);
      const w = r.works[n]; if (w) { const t = (r.works[k] ??= { tr: 0, sand: 0, wire: 0 }); t.tr = Math.max(t.tr, w.tr); t.sand = Math.max(t.sand, w.sand); t.wire = Math.max(t.wire, w.wire); delete r.works[n]; }
      for (const d of r.defs) if (d.s === n) d.s = k;
      // corps of the old format (see game.ts to7): one per border, keyed by neighbour
      const fr = (r as unknown as { fr?: Record<number, { u: Units; ord?: number; now?: boolean }> }).fr;
      const c = fr?.[n]; if (c && fr) { const t = fr[k]; if (t) for (const u of GROUND_TYPES) t.u[u] += c.u[u]; else fr[k] = { ...c, ord: 0, now: false }; delete fr[n]; }
    }
  }
}

export const fleetLabel = (g: GameState, fl: Fleet) => {
  const ships = fleetShips(g, fl), n = (k: ShipKind) => ships.filter(s => s.kind === k).length;
  const parts: string[] = [];
  for (const k of ['bb', 'carrier', 'land', 'trans'] as const) { const c = n(k); if (c) parts.push(`${c} ${c === 1 ? SHIP[k].one : SHIP[k].many}`); }
  return parts.join(', ');
};
export const factionShort = (f: number) => FACTIONS[f]?.short ?? '?';
export { isCoast, zoneOfKey };
