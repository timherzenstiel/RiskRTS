// Player commands. Every mutation a player can cause goes through applyCommand, which validates it.
// The same function runs on the host (or a future dedicated server) for humans and AI alike.
import {
  AIR_RANGE, COST, DT, FORMATION, GROUND_TYPES, MAX_SAND, MAX_TRENCH, MAX_WIRE, SLOT_USE, TRENCH_COST, UNIT_TYPES, UT, emptyUnits, groundUnits, isDef, isWork,
  type FortKind, type UnitType,
} from '../data/units';
import { HW, wrapDx } from '../world/build';
import { MARCH_MIN, MARCH_SPEED, addForce, approachSector, emit, frontsOf, hops, mkArmy, offensives, rnd, slotsMax, slotsUsed, takeForce, world, worksAt, worksFor } from './core';
import { joinBattle, launch, startAssault, startBattle, transferAgents } from './battle';
import { charge, mobilise, produce, reinforce, setBarrage, setStance, withdraw } from './levers';
import { buildCostOf, unitCost, unitName } from './rules';
import { nationOf } from '../data/nations';
import { mountainRegion } from '../data/terrain';
import { buildRail, cutRails, hasRail, marchFactor, railOpen, weatherMarch } from './rails';
import { activeSpies } from './fog';
import { chooseDoctrine, hasDoc, rush, techOn } from './tech';
import { answer, cancel, offer, treatyCheck } from './diplomacy';
import { decoy, decoyArrives, raid } from './levers';
import { PHRASES } from './types';
import { techDayFor, type TechKey } from '../data/tech';
import { monthStr } from '../data/calendar';
import { bombedNow } from './economy';
import { recordIntel, MAX_SPIES } from './fog';
import type { Army, Battle, BuildKind, Command, GameState, RegionState } from './types';

/** The front of a region the owner's fresh troops should go to: the one facing `from` if there is one, else the most hard-pressed. */
export function frontFor(g: GameState, r: RegionState, f: number, from = -2): Battle | null {
  const fr = frontsOf(g, r.id).filter(b => b.def === f || b.sides.includes(f));
  if (!fr.length) return null;
  const facing = fr.find(b => b.from === from); if (facing) return facing;
  let best = fr[0], bs = Infinity;
  for (const b of fr) {
    let mine = 0, foe = 0;
    for (const a of b.agents) if (!a.dead && !a.out) { const p = isDef(a.type) ? DT[a.type].power : UT[a.type as UnitType].power; if (a.f === f) mine += p; else foe += p; }
    const s = mine / (foe + .5); if (s < bs) { bs = s; best = b; }
  }
  return best;
}

export function addUnits(g: GameState, r: RegionState, type: UnitType, n: number) {
  const b = frontFor(g, r, r.owner);
  if (b && b.def === r.owner) { const u = emptyUnits(); u[type] = n; joinBattle(g, b, r.owner, u, null, true, r.id, undefined, r.mor); }
  else addForce(r.units, r.men, type, n);
}

const contestedMsg = (r: RegionState) => `Enemy holdouts still fight in ${world().regions[r.id].name}. Storm them first.`;
const cutMsg = (r: RegionState) => `${world().regions[r.id].name} is cut off from supply. Reopen a route through your own regions to your capital, a factory or your home territory first.`;

/** "Tanks arrive in Sep 1916." */
export const locked = (g: GameState, fid: number, k: TechKey, what: string) => `${what} are not available yet: they arrive in ${monthStr(techDayFor(fid, k, g.factions[fid]?.rushed))}. A rush brings them six months forward.`;

export function recruit(g: GameState, fid: number, r: RegionState, type: UnitType): string | null {
  const f = g.factions[fid], c = unitCost(g, fid, type), men = FORMATION[type].men;
  if (r.owner !== fid) return 'You can only recruit in your own regions.';
  if (r.contested >= 0) return contestedMsg(r);
  if (r.cut) return cutMsg(r);
  if (r.strike) return `The workers of ${world().regions[r.id].name} are on strike. No recruits until the unrest eases.`;
  if ((f.men ?? 0) < men) return `The manpower pool is empty: a ${FORMATION[type].one} needs ${men} men and ${Math.floor(f.men ?? 0)} are left. Mobilise, or wait for the next age class.`;
  if (type === 'tank' && !techOn(g, fid, 'tank')) return locked(g, fid, 'tank', 'Tanks');
  if (type === 'plane' && !techOn(g, fid, 'air')) return locked(g, fid, 'air', 'Aircraft');
  if (type === 'tank' && !r.factory) return 'Tanks need a factory in this region.';
  if (type === 'tank' && bombedNow(g, r)) return 'The factory here was bombed. No tanks until it is repaired.';
  if (type === 'plane' && !r.airfield) return 'Aircraft need an airfield in this region.';
  if (f.supply < c) return `Not enough supply: a ${unitName(g, fid, type).toLowerCase()} costs ${c}.`;
  f.supply -= c; f.men -= men; addUnits(g, r, type, 1); return null;
}

export function build(g: GameState, fid: number, r: RegionState, kind: BuildKind): string | null {
  const f = g.factions[fid];
  if (r.owner !== fid) return 'You can only build in your own regions.';
  if (r.contested >= 0) return contestedMsg(r);
  if (r[kind]) return 'Already built.';
  if (kind === 'airfield' && !techOn(g, fid, 'air')) return locked(g, fid, 'air', 'Airfields');
  const c = buildCostOf(fid, kind);
  if (f.supply < c) return `Not enough supply: this costs ${c}.`;
  f.supply -= c; r[kind] = true;
  return null;
}

/** Cost of the next step of a field work or defence on a sector, or null if it is at its limit. */
export function fortCost(r: RegionState, kind: FortKind, sector: number, g?: GameState): number | null {
  const w = worksAt(r, sector);
  if (kind === 'trench' && w.tr >= MAX_TRENCH) return null;
  if (kind === 'sand' && w.sand >= MAX_SAND) return null;
  if (kind === 'wire' && w.wire >= MAX_WIRE) return null;
  // France's fortress belt: concrete is cheaper at home
  // defence in depth: trenches are cheaper
  const base = kind === 'trench' ? Math.round(TRENCH_COST[w.tr] * (g && hasDoc(g, r.owner, 'depth') ? .7 : 1)) : COST[kind];
  if ((kind === 'bunk' || kind === 'fort') && r.home === r.owner && nationOf(r.owner).flags.fortress) return Math.ceil(base * .75);
  // Austria-Hungary's mountain war: fortifications are cheaper in mountain regions
  if (nationOf(r.owner).flags.mountain && mountainRegion(r.id)) return Math.max(1, Math.round(base * .8));
  return base;
}

/** Place a defence or field work on a border sector (`sector` = neighbouring region id), or a defence in the interior (-1). */
export function fortify(g: GameState, fid: number, r: RegionState, kind: FortKind, sector: number): string | null {
  const f = g.factions[fid], W = world();
  if (r.owner !== fid) return 'You can only fortify your own regions.';
  if (r.contested >= 0) return contestedMsg(r);
  if (!(kind in DT) && !isWork(kind)) return 'Invalid order.';
  if (sector !== -1 && !W.regions[r.id].adj.includes(sector)) return 'That border does not belong to this region.';
  if (isWork(kind) && sector < 0) return 'Trenches, sandbags and wire are dug on a border. Pick one.';
  if (kind === 'trench' && worksAt(r, sector).tr >= 1 && !techOn(g, fid, 'trench2')) return locked(g, fid, 'trench2', 'Deeper trenches');
  if (kind === 'trench' && worksAt(r, sector).tr >= 2 && !techOn(g, fid, 'trench3')) return locked(g, fid, 'trench3', 'Trench III systems');
  if (kind === 'bunk' && !techOn(g, fid, 'trench3')) return locked(g, fid, 'trench3', 'Bunkers');
  if (kind === 'flak' && !techOn(g, fid, 'air')) return locked(g, fid, 'air', 'Anti-air guns');
  const c = fortCost(r, kind, sector, g);
  if (c === null) return kind === 'trench' ? 'The trench on this border is already at full depth.' : kind === 'sand' ? 'This border already has every sandbag row it can hold.' : 'This border already has every wire belt it can hold.';
  if (kind !== 'trench') {
    const use = SLOT_USE[kind], max = slotsMax(r.id, sector), now = slotsUsed(r, sector);
    if (now + use > max) return `No room: this ${sector < 0 ? 'interior' : 'border'} has ${max} building slots and ${now} are in use${use > 1 ? ' (a bunker needs two)' : ''}.`;
  }
  if (f.supply < c) return `Not enough supply: this costs ${c}.`;
  f.supply -= c;
  if (kind === 'trench') worksFor(r, sector).tr++;
  else if (kind === 'sand') worksFor(r, sector).sand++;
  else if (kind === 'wire') worksFor(r, sector).wire++;
  else r.defs.push({ id: g.nextId++, k: kind, s: sector, hp: DT[kind].hp, f: fid });
  return null;
}

function capCheck(g: GameState, fid: number, to: number): string | null {
  const cap = g.cfg?.attackCap ?? 0; if (!cap || g.regions[to].owner === fid) return null;
  const now = offensives(g, fid); if (now.has(to) || now.size < cap) return null;
  return `You already run ${now.size} attack${now.size === 1 ? '' : 's'} at once (limit ${cap}). Wait for one to finish.`;
}

/** Seconds after arriving within which marching on counts as a forced march, and after a battle within which troops are tired. */
export const FORCED_MARCH = 45, BATTLE_REST = 60, FATIGUE_MORALE = 15;

/**
 * Form a marching army of a share of a region's ground troops (one formation always stays behind). Checks ownership, battle,
 * border and size; the caller adds it to the game. Returns the army or an error text.
 */
export function formArmy(g: GameState, fid: number, fromId: number, toId: number, frac: number): Army | string {
  const W = world(), A = g.regions[fromId], B = g.regions[toId], WA = W.regions[fromId], WB = W.regions[toId];
  if (!A || !B) return 'Unknown region.';
  if (A.owner !== fid) return 'Select one of your own regions first.';
  if (A.battle >= 0) return `${WA.name} is under attack. Its troops cannot leave.`;
  if (!WA.adj.includes(toId)) return `${WB.name} does not border ${WA.name}. Infantry and tanks can only attack across a direct border; aircraft reach two borders.`;
  const tot = groundUnits(A.units); if (tot < 2) return `${WA.name} needs at least 2 ground formations to march. One always stays behind.`;
  frac = Math.max(.05, Math.min(1, frac));
  const n: Record<string, number> = {}; let sent = 0;
  for (const k of GROUND_TYPES) { n[k] = Math.round(A.units[k] * frac); sent += n[k]; }
  if (sent >= tot) { for (const k of GROUND_TYPES) if (n[k] > 0) { n[k]--; sent--; break; } }
  if (sent <= 0) { for (const k of GROUND_TYPES) if (A.units[k] > 0) { n[k] = 1; sent = 1; break; } }
  const a = mkArmy(g, fid, fromId, toId, MARCH_SPEED, MARCH_MIN); a.mor = A.mor; a.stance = A.stance ?? 0;
  const mf = marchFactor(g, fid, fromId, toId); a.dur *= mf.k; if (mf.rail) a.rail = true;
  for (const k of GROUND_TYPES) { const men = takeForce(A.units, A.men, k, n[k]); a.units[k] += n[k]; a.men[k] += men; }
  // fatigue: marching on right after arriving, or straight out of a battle
  a.legs = (A.arrT !== undefined && g.time - A.arrT < FORCED_MARCH ? (A.legs ?? 1) : 0) + 1;
  if (A.foughtT !== undefined && g.time - A.foughtT < BATTLE_REST) a.tired = true;
  return a;
}

export function sendArmy(g: GameState, fid: number, fromId: number, toId: number, frac: number, brk?: boolean): string | null {
  const B = g.regions[toId];
  if (B) { const cap = capCheck(g, fid, toId); if (cap) return cap; }
  if (B && g.regions[fromId]?.owner === fid) { const t = treatyCheck(g, fid, toId, brk); if (t) return t; }
  const a = formArmy(g, fid, fromId, toId, frac); if (typeof a === 'string') return a;
  g.armies.push(a);
  emit(g, { k: 'march', faction: fid, from: fromId, to: toId, units: groundUnits(a.units) });
  return null;
}

/** Fly aircraft to a region up to AIR_RANGE borders away: strike an enemy, support a battle, or rebase. */
export function sendAir(g: GameState, fid: number, fromId: number, toId: number, frac: number, rail = false, factory = false, brk?: boolean): string | null {
  const W = world(), A = g.regions[fromId], B = g.regions[toId];
  if (!A || !B || fromId === toId) return 'Pick another region as the target.';
  if (A.owner !== fid) return 'Select one of your own regions first.';
  if (A.units.plane < 1) return `No squadrons are based in ${W.regions[fromId].name}.`;
  if (hops(fromId, toId, AIR_RANGE) > AIR_RANGE) return `${W.regions[toId].name} is out of range. Aircraft reach regions up to ${AIR_RANGE} borders away.`;
  if (rail && !techOn(g, fid, 'railAir')) return locked(g, fid, 'railAir', 'Rail strikes');
  if (factory) {
    if (!techOn(g, fid, 'bomb')) return locked(g, fid, 'bomb', 'Bombing raids on factories');
    if (B.owner === fid) return 'Bomb the factories of enemy regions.';
    if (!B.factory) return `There is no factory in ${W.regions[toId].name} that we know of.`;
  }
  if (rail) {
    if (B.owner === fid) return 'Bomb the railways of enemy regions.';
    if (!W.regions[toId].adj.some(n => railOpen(g, toId, n))) return `No working railway runs through ${W.regions[toId].name}.`;
  }
  const cap = capCheck(g, fid, toId); if (cap) return cap;
  const tc = treatyCheck(g, fid, toId, brk); if (tc) return tc;
  const n = Math.max(1, Math.min(A.units.plane, Math.round(A.units.plane * Math.max(.05, Math.min(1, frac)))));
  const men = takeForce(A.units, A.men, 'plane', n);
  const fl = launch(g, fid, fromId, toId, { ...emptyUnits(), plane: n }, false, { ...emptyUnits(), plane: men }); if (rail) fl.strike = 'rail'; else if (factory) fl.strike = 'factory';
  emit(g, { k: 'air', faction: fid, from: fromId, to: toId, units: n });
  return null;
}

/** A cavalry patrol rides over one border and reports the troops there and the defences of that border. */
export function patrol(g: GameState, fid: number, fromId: number, toId: number): string | null {
  const W = world(), A = g.regions[fromId], B = g.regions[toId], f = g.factions[fid];
  if (!A || !B) return 'Unknown region.';
  if (A.owner !== fid) return 'Patrols ride out from your own regions.';
  if (B.owner === fid) return 'That region is already yours.';
  if (!W.regions[fromId].adj.includes(toId)) return `A patrol only reaches across one border. ${W.regions[toId].name} does not border ${W.regions[fromId].name}.`;
  if (f.supply < COST.patrol) return `Not enough supply: a patrol costs ${COST.patrol}.`;
  f.supply -= COST.patrol;
  const a = mkArmy(g, fid, fromId, toId, 4.5, 1.5); a.scout = 'patrol'; a.dur *= weatherMarch(g, fid, toId); g.armies.push(a);
  return null;
}

/** A reconnaissance flight photographs a region up to AIR_RANGE borders away: troops, buildings and every border's defences. */
export function recon(g: GameState, fid: number, fromId: number, toId: number): string | null {
  const W = world(), A = g.regions[fromId], B = g.regions[toId], f = g.factions[fid];
  if (!A || !B || fromId === toId) return 'Pick another region as the target.';
  if (A.owner !== fid) return 'Reconnaissance flights take off from your own airfields.';
  if (!techOn(g, fid, 'air')) return locked(g, fid, 'air', 'Reconnaissance flights');
  if (!A.airfield) return `Reconnaissance flights need an airfield in ${W.regions[fromId].name}.`;
  if (B.owner === fid) return 'That region is already yours.';
  if (hops(fromId, toId, AIR_RANGE) > AIR_RANGE) return `${W.regions[toId].name} is out of range. Aircraft reach regions up to ${AIR_RANGE} borders away.`;
  if (f.supply < COST.recon) return `Not enough supply: a reconnaissance flight costs ${COST.recon}.`;
  f.supply -= COST.recon;
  const a = launch(g, fid, fromId, toId, emptyUnits(), false); a.scout = 'recon';
  return null;
}

/** Send a spy from the capital into any foreign region. Once there, it reports everything until it is caught. */
export function spy(g: GameState, fid: number, toId: number): string | null {
  const W = world(), B = g.regions[toId], f = g.factions[fid];
  if (!B) return 'Unknown region.';
  if (B.owner === fid) return 'Spies work in foreign regions.';
  const cap = g.regions.find(r => r.capitalOf === fid);
  if (!cap || cap.owner !== fid) return 'Spies are trained in your capital, and it has fallen.';
  if (g.spies.filter(s => s.f === fid).length >= MAX_SPIES) return `You already have ${MAX_SPIES} spies in the field.`;
  if (g.spies.some(s => s.f === fid && s.region === toId)) return `A spy of yours already works in ${W.regions[toId].name}.`;
  if (f.supply < COST.spy) return `Not enough supply: a spy costs ${COST.spy}.`;
  f.supply -= COST.spy;
  const A = W.regions[cap.id], T = W.regions[toId], dist = Math.hypot(wrapDx(A.cx, T.cx), T.cz - A.cz);
  g.spies.push({ id: g.nextId++, f: fid, region: toId, eta: g.time + 6 + dist / 4 });
  return null;
}

export function assault(g: GameState, fid: number, r: RegionState): string | null {
  if (r.owner !== fid) return 'You can only storm holdouts in your own regions.';
  if (r.contested < 0) return 'There are no holdouts here.';
  if (r.battle >= 0) return 'A battle is already being fought here.';
  if (groundUnits(r.units) < 1) return 'You need ground troops in the region to storm the holdouts.';
  const cap = g.cfg?.attackCap ?? 0, now = offensives(g, fid);
  if (cap && now.size >= cap) return `You already run ${now.size} attacks at once (limit ${cap}).`;
  startAssault(g, r); // the whole garrison, aircraft included, storms the holdouts
  return null;
}

/** Shift reserves: about a third of the defenders on every other front of the region move to the front of battle `bid`. */
export function shift(g: GameState, fid: number, r: RegionState, bid: number): string | null {
  if (r.owner !== fid) return 'You can only move troops between fronts of your own regions.';
  const b = g.battles.find(x => x.id === bid && x.region === r.id && !x.ended);
  if (!b || b.def !== fid) return 'There is no front of yours to reinforce there.';
  const others = frontsOf(g, r.id).filter(o => o !== b && o.def === fid);
  if (!others.length) return `${world().regions[r.id].name} is attacked on one front only. Every defender is already there.`;
  let moved = 0; for (const o of others) moved += transferAgents(g, o, b, fid, .35);
  if (!moved) return 'The other fronts have no troops to spare.';
  return null;
}

export const armyPos = (a: Army): [number, number] => { let x = a.ax + a.dx * a.t; if (x < -HW) x += 2 * HW; if (x > HW) x -= 2 * HW; return [x, a.az + a.dz * a.t]; };

/** A patrol or reconnaissance flight reaches its target: it may be caught, otherwise it files its report. */
function scoutArrives(g: GameState, a: Army) {
  const t = g.regions[a.to];
  if (t.owner === a.owner) return;
  if (a.scout === 'patrol') {
    const nest = t.defs.filter(d => d.f === t.owner && d.s === a.from && (d.k === 'pill' || d.k === 'bunk')).length;
    const p = Math.min(.8, .05 + .12 * nest + .1 * worksAt(t, a.from).wire);
    if (rnd(g) < p) { emit(g, { k: 'scoutLost', faction: a.owner, region: t.id, by: 'patrol' }); return; }
    recordIntel(g, a.owner, t.id, a.from);
  } else {
    const flak = t.defs.filter(d => d.f === t.owner && d.k === 'flak').length;
    const p = Math.min(.85, .05 + .2 * flak);
    if (!hasDoc(g, a.owner, 'air') && rnd(g) < p) { emit(g, { k: 'scoutLost', faction: a.owner, region: t.id, by: 'recon' }); return; }
    recordIntel(g, a.owner, t.id);
  }
  emit(g, { k: 'intel', faction: a.owner, region: t.id, by: a.scout! });
}

/** A rail strike reaches its target: anti-air guns may down squadrons; the survivors wreck the region's rail links and fly home. */
function railStrike(g: GameState, a: Army) {
  const t = g.regions[a.to], flak = t.defs.filter(d => d.f === t.owner && d.k === 'flak').length;
  let n = a.units.plane; for (let i = 0; i < a.units.plane; i++) if (rnd(g) < Math.min(.7, .05 + .15 * flak)) n--;
  if (n < a.units.plane) emit(g, { k: 'scoutLost', faction: a.owner, region: t.id, by: 'recon' });
  if (n > 0 && t.owner !== a.owner) {
    if (a.strike === 'factory') { if (t.factory) { t.bombed = g.day + 21; emit(g, { k: 'bombed', faction: a.owner, region: t.id, owner: t.owner }); } }
    else cutRails(g, a.owner, t.id, null, 'air');
  }
  const home = g.regions[a.from].owner === a.owner ? a.from : world().regions[a.to].adj.find(j => g.regions[j].owner === a.owner);
  if (n > 0 && home !== undefined) launch(g, a.owner, a.to, home, { ...emptyUnits(), plane: n }, true, { ...emptyUnits(), plane: Math.round(a.men.plane * n / Math.max(1, a.units.plane)) });
}

/** A working spy cuts one rail link of the region it works in, and is twice as likely to be caught for a while. */
export function sabotage(g: GameState, fid: number, region: number, to: number): string | null {
  const s = activeSpies(g, fid).find(x => x.region === region), W = world();
  if (!s) return `None of your agents works in ${W.regions[region]?.name ?? 'that region'}.`;
  if (!W.regions[region].adj.includes(to) || !hasRail(g, region, to)) return 'No railway runs there.';
  if (!railOpen(g, region, to)) return 'That line is already cut.';
  cutRails(g, fid, region, to, 'spy'); s.hot = g.day + 21;
  return null;
}

export function arrive(g: GameState, a: Army) {
  if (a.scout) { scoutArrives(g, a); return; }
  if (a.strike) { railStrike(g, a); return; }
  if (a.decoy) { decoyArrives(g, a); return; }
  const t = g.regions[a.to], len = Math.hypot(a.dx, a.dz) || 1, dir = { x: -a.dx / len, z: -a.dz / len };
  // fatigue: more than two borders in a row, or straight out of a battle, costs morale when the troops have to fight
  if (!a.air && ((a.legs ?? 1) > 2 || a.tired) && (frontsOf(g, t.id).length || t.owner !== a.owner)) a.mor = Math.max(5, a.mor - FATIGUE_MORALE);
  // reinforcements sent to one front join it directly while it still burns
  if (a.front !== undefined) {
    const fb = g.battles.find(b => b.id === a.front && !b.ended && b.region === a.to);
    if (fb && (fb.def === a.owner ? t.owner === a.owner : fb.sides.includes(a.owner))) { joinBattle(g, fb, a.owner, a.units, dir, fb.def === a.owner, a.to, a.men, a.mor, a.stance); return; }
  }
  const sector = a.air ? approachSector(a.from, a.to) : a.from;
  if (a.ret) {
    // returning aircraft land at home, or join its defence; a lost home means a lost squadron
    if (t.owner !== a.owner) return;
    const b = frontFor(g, t, a.owner);
    if (b) joinBattle(g, b, a.owner, a.units, dir, b.def === a.owner, a.to, a.men); else { t.units.plane += a.units.plane; t.men.plane += a.men.plane; }
    return;
  }
  const fronts = frontsOf(g, t.id);
  if (t.owner === a.owner) {
    const b = frontFor(g, t, a.owner, sector);
    if (b) joinBattle(g, b, a.owner, a.units, dir, b.def === a.owner, a.air ? a.from : a.to, a.men, a.mor);
    else {
      const before = groundUnits(t.units), add = groundUnits(a.units);
      for (const k of UNIT_TYPES) { t.units[k] += a.units[k]; t.men[k] += a.men[k]; }
      if (add) { t.mor = (t.mor * before + a.mor * add) / (before + add); t.arrT = g.time; t.legs = a.legs ?? 1; }
    }
    return;
  }
  // attacking: join the front over the same border, aircraft support any front, otherwise open a new front
  const same = fronts.find(b => b.from === sector) ?? (a.air ? fronts.find(b => b.sides.includes(a.owner)) ?? fronts[0] : undefined);
  if (same) { joinBattle(g, same, a.owner, a.units, dir, same.def === a.owner, a.air ? a.from : a.to, a.men, a.mor, a.air ? undefined : a.stance); return; }
  const nb = startBattle(g, t, dir, a.owner, sector);
  joinBattle(g, nb, a.owner, a.units, dir, false, a.air ? a.from : a.to, a.men, a.mor, a.air ? undefined : a.stance);
}

/** Validate and apply a player command. Returns an error message, or null on success. */
export function applyCommand(g: GameState, fid: number, c: Command): string | null {
  if (g.over) return 'The war is over.';
  const f = g.factions[fid]; if (!f || !f.alive) return 'Your power has been destroyed.';
  switch (c.t) {
    case 'recruit': {
      const r = g.regions[c.region]; if (!r || !UT[c.unit]) return 'Invalid order.';
      const n = Math.max(1, Math.min(10, Math.floor(c.n ?? 1)));
      for (let i = 0; i < n; i++) { const e = recruit(g, fid, r, c.unit); if (e) return i ? null : e; }
      return null;
    }
    case 'build': { const r = g.regions[c.region]; if (!r || !['factory', 'barracks', 'airfield'].includes(c.kind)) return 'Invalid order.'; return build(g, fid, r, c.kind); }
    case 'fortify': { const r = g.regions[c.region]; if (!r) return 'Invalid order.'; return fortify(g, fid, r, c.kind, c.sector); }
    case 'march': return sendArmy(g, fid, c.from, c.to, c.frac, c.brk);
    case 'air': return sendAir(g, fid, c.from, c.to, c.frac, !!c.rail, !!c.factory, c.brk);
    case 'decoy': return decoy(g, fid, c.from, c.to);
    case 'raid': return raid(g, fid, c.battle);
    case 'offer': return offer(g, fid, c.to, c.kind);
    case 'answer': return answer(g, fid, c.id, c.yes);
    case 'cancel': return cancel(g, fid, c.to);
    case 'say': { if (!(c.p >= 0 && c.p < PHRASES.length) || !(c.to === -1 || (c.to >= 0 && c.to < g.factions.length && c.to !== fid))) return 'Invalid order.'; emit(g, { k: 'say', from: fid, to: c.to, p: c.p }); return null; }
    case 'rush': return rush(g, fid, c.tech);
    case 'doctrine': return chooseDoctrine(g, fid, c.doc);
    case 'rail': return buildRail(g, fid, c.region, c.to);
    case 'sabotage': return sabotage(g, fid, c.region, c.to);
    case 'patrol': return patrol(g, fid, c.from, c.to);
    case 'recon': return recon(g, fid, c.from, c.to);
    case 'spy': return spy(g, fid, c.to);
    case 'shift': { const r = g.regions[c.region]; if (!r) return 'Invalid order.'; return shift(g, fid, r, c.battle); }
    case 'assault': { const r = g.regions[c.region]; if (!r) return 'Invalid order.'; return assault(g, fid, r); }
    case 'barrage': return setBarrage(g, fid, c.battle, c.level);
    case 'charge': return charge(g, fid, c.battle);
    case 'stance': return setStance(g, fid, c.region, c.s, c.battle);
    case 'reinforce': return reinforce(g, fid, c.from, c.battle, c.frac);
    case 'withdraw': return withdraw(g, fid, c.battle);
    case 'produce': return produce(g, fid, c.kind, c.n);
    case 'mobilise': return mobilise(g, fid, c.level);
    default: return 'Unknown command.';
  }
}
