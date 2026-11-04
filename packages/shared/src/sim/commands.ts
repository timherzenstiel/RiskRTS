// Player commands. Every mutation a player can cause goes through applyCommand, which validates it.
// The same function runs on the host (or a future dedicated server) for humans and AI alike.
import {
  AIR_RANGE, COST, DT, GROUND_TYPES, MAX_DEF_INTERIOR, MAX_DEF_SECTOR, MAX_TRENCH, TRENCH_COST, UNIT_TYPES, UT, emptyUnits, groundUnits, type DefKind, type UnitType,
} from '../data/units';
import { HW, wrapDx } from '../world/build';
import { approachSector, emit, hops, offensives, world } from './core';
import { joinBattle, launch, startAssault, startBattle } from './battle';
import type { Army, BuildKind, Command, GameState, RegionState } from './types';

export function addUnits(g: GameState, r: RegionState, type: UnitType, n: number) {
  const b = r.battle >= 0 ? g.battles.find(x => x.id === r.battle) : null;
  if (b && !b.ended && b.def === r.owner) { const u = emptyUnits(); u[type] = n; joinBattle(g, b, r.owner, u, null, true); }
  else r.units[type] += n;
}

const contestedMsg = (r: RegionState) => `Enemy holdouts still fight in ${world().regions[r.id].name}. Storm them first.`;

export function recruit(g: GameState, fid: number, r: RegionState, type: UnitType): string | null {
  const f = g.factions[fid], c = COST[type];
  if (r.owner !== fid) return 'You can only recruit in your own regions.';
  if (r.contested >= 0) return contestedMsg(r);
  if (type === 'tank' && !r.factory) return 'Tanks need a factory in this region.';
  if (type === 'plane' && !r.airfield) return 'Aircraft need an airfield in this region.';
  if (f.supply < c) return `Not enough supply: ${UT[type].name} costs ${c}.`;
  f.supply -= c; addUnits(g, r, type, 1); return null;
}

export function build(g: GameState, fid: number, r: RegionState, kind: BuildKind): string | null {
  const f = g.factions[fid];
  if (r.owner !== fid) return 'You can only build in your own regions.';
  if (r.contested >= 0) return contestedMsg(r);
  let c: number;
  if (kind === 'trench') { if (r.trench >= MAX_TRENCH) return 'Trenches are already at full depth.'; c = TRENCH_COST[r.trench]; }
  else { if (r[kind]) return 'Already built.'; c = COST[kind]; }
  if (f.supply < c) return `Not enough supply: this costs ${c}.`;
  f.supply -= c;
  if (kind === 'trench') r.trench++; else r[kind] = true;
  return null;
}

/** Place a fixed defence on a border sector (`sector` = neighbouring region id) or in the interior (-1). */
export function fortify(g: GameState, fid: number, r: RegionState, kind: DefKind, sector: number): string | null {
  const f = g.factions[fid], W = world();
  if (r.owner !== fid) return 'You can only fortify your own regions.';
  if (r.contested >= 0) return contestedMsg(r);
  if (!DT[kind]) return 'Invalid order.';
  if (sector !== -1 && !W.regions[r.id].adj.includes(sector)) return 'That border does not belong to this region.';
  const here = r.defs.filter(d => d.s === sector).length;
  if (sector < 0 ? here >= MAX_DEF_INTERIOR : here >= MAX_DEF_SECTOR) return sector < 0 ? `The interior holds at most ${MAX_DEF_INTERIOR} defences.` : `At most ${MAX_DEF_SECTOR} defences per border.`;
  const c = COST[kind];
  if (f.supply < c) return `Not enough supply: ${DT[kind].name} costs ${c}.`;
  f.supply -= c;
  r.defs.push({ id: g.nextId++, k: kind, s: sector, hp: DT[kind].hp, f: fid });
  return null;
}

function capCheck(g: GameState, fid: number, to: number): string | null {
  const cap = g.cfg?.attackCap ?? 0; if (!cap || g.regions[to].owner === fid) return null;
  const now = offensives(g, fid); if (now.has(to) || now.size < cap) return null;
  return `You already run ${now.size} attack${now.size === 1 ? '' : 's'} at once (limit ${cap}). Wait for one to finish.`;
}

export function sendArmy(g: GameState, fid: number, fromId: number, toId: number, frac: number): string | null {
  const W = world(), A = g.regions[fromId], B = g.regions[toId], WA = W.regions[fromId], WB = W.regions[toId];
  if (!A || !B) return 'Unknown region.';
  if (A.owner !== fid) return 'Select one of your own regions first.';
  if (A.battle >= 0) return `${WA.name} is under attack. Its troops cannot leave.`;
  if (!WA.adj.includes(toId)) return `${WB.name} does not border ${WA.name}. Infantry and tanks can only attack across a direct border; aircraft reach two borders.`;
  const tot = groundUnits(A.units); if (tot < 2) return `${WA.name} needs at least 2 ground units to march. One always stays behind.`;
  const cap = capCheck(g, fid, toId); if (cap) return cap;
  frac = Math.max(.05, Math.min(1, frac));
  const u = emptyUnits(); let sent = 0;
  for (const k of GROUND_TYPES) { u[k] = Math.round(A.units[k] * frac); sent += u[k]; }
  if (sent >= tot) { for (const k of GROUND_TYPES) if (u[k] > 0) { u[k]--; sent--; break; } }
  if (sent <= 0) { for (const k of GROUND_TYPES) if (A.units[k] > 0) { u[k] = 1; sent = 1; break; } }
  for (const k of GROUND_TYPES) A.units[k] -= u[k];
  const dx = wrapDx(WA.cx, WB.cx), dz = WB.cz - WA.cz, dist = Math.hypot(dx, dz);
  const a: Army = { id: g.nextId++, owner: fid, units: u, from: fromId, to: toId, t: 0, dur: Math.max(2.5, dist / 2.4), sea: W.seaLane.has(fromId + '|' + toId), ax: WA.cx, az: WA.cz, dx, dz };
  g.armies.push(a);
  emit(g, { k: 'march', faction: fid, from: fromId, to: toId, units: sent });
  return null;
}

/** Fly aircraft to a region up to AIR_RANGE borders away: strike an enemy, support a battle, or rebase. */
export function sendAir(g: GameState, fid: number, fromId: number, toId: number, frac: number): string | null {
  const W = world(), A = g.regions[fromId], B = g.regions[toId];
  if (!A || !B || fromId === toId) return 'Pick another region as the target.';
  if (A.owner !== fid) return 'Select one of your own regions first.';
  if (A.units.plane < 1) return `No aircraft are based in ${W.regions[fromId].name}.`;
  if (hops(fromId, toId, AIR_RANGE) > AIR_RANGE) return `${W.regions[toId].name} is out of range. Aircraft reach regions up to ${AIR_RANGE} borders away.`;
  const cap = capCheck(g, fid, toId); if (cap) return cap;
  const n = Math.max(1, Math.min(A.units.plane, Math.round(A.units.plane * Math.max(.05, Math.min(1, frac)))));
  A.units.plane -= n;
  launch(g, fid, fromId, toId, { ...emptyUnits(), plane: n }, false);
  emit(g, { k: 'air', faction: fid, from: fromId, to: toId, units: n });
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

export const armyPos = (a: Army): [number, number] => { let x = a.ax + a.dx * a.t; if (x < -HW) x += 2 * HW; if (x > HW) x -= 2 * HW; return [x, a.az + a.dz * a.t]; };

export function arrive(g: GameState, a: Army) {
  const t = g.regions[a.to], len = Math.hypot(a.dx, a.dz) || 1, dir = { x: -a.dx / len, z: -a.dz / len };
  const b = t.battle >= 0 ? g.battles.find(x => x.id === t.battle) : null;
  if (a.ret) {
    // returning aircraft land at home, or join its defence; a lost home means a lost squadron
    if (t.owner !== a.owner) return;
    if (b && !b.ended) joinBattle(g, b, a.owner, a.units, dir, b.def === a.owner, a.to); else t.units.plane += a.units.plane;
    return;
  }
  if (b && !b.ended) joinBattle(g, b, a.owner, a.units, dir, b.def === a.owner, a.air ? a.from : a.to);
  else if (t.owner === a.owner) { for (const k of UNIT_TYPES) t.units[k] += a.units[k]; }
  else {
    const nb = startBattle(g, t, dir, a.owner, a.air ? approachSector(a.from, a.to) : a.from);
    joinBattle(g, nb, a.owner, a.units, dir, false, a.air ? a.from : a.to);
  }
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
    case 'build': { const r = g.regions[c.region]; if (!r || !['trench', 'factory', 'barracks', 'airfield'].includes(c.kind)) return 'Invalid order.'; return build(g, fid, r, c.kind); }
    case 'fortify': { const r = g.regions[c.region]; if (!r) return 'Invalid order.'; return fortify(g, fid, r, c.kind, c.sector); }
    case 'march': return sendArmy(g, fid, c.from, c.to, c.frac);
    case 'air': return sendAir(g, fid, c.from, c.to, c.frac);
    case 'assault': { const r = g.regions[c.region]; if (!r) return 'Invalid order.'; return assault(g, fid, r); }
    default: return 'Unknown command.';
  }
}
