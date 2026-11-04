// Player commands. Every mutation a player can cause goes through applyCommand, which validates it.
// The same function runs on the host (or a future dedicated server) for humans and AI alike.
import { COST, MAX_TRENCH, TRENCH_COST, UNIT_TYPES, UT, emptyUnits, totalUnits, type UnitType } from '../data/units';
import { HW, wrapDx } from '../world/build';
import { world, emit } from './core';
import { joinBattle, startBattle } from './battle';
import type { Army, Command, GameState, RegionState } from './types';

export function addUnits(g: GameState, r: RegionState, type: UnitType, n: number) {
  const b = r.battle >= 0 ? g.battles.find(x => x.id === r.battle) : null;
  if (b && !b.ended) { const u = emptyUnits(); u[type] = n; joinBattle(g, b, r.owner, u, null, true); }
  else r.units[type] += n;
}

export function recruit(g: GameState, fid: number, r: RegionState, type: UnitType): string | null {
  const f = g.factions[fid], c = COST[type];
  if (r.owner !== fid) return 'You can only recruit in your own regions.';
  if (type === 'tank' && !r.factory) return 'Tanks need a factory in this region.';
  if (f.supply < c) return `Not enough supply: ${UT[type].name} costs ${c}.`;
  f.supply -= c; addUnits(g, r, type, 1); return null;
}

export function build(g: GameState, fid: number, r: RegionState, kind: 'trench' | 'factory' | 'barracks'): string | null {
  const f = g.factions[fid];
  if (r.owner !== fid) return 'You can only build in your own regions.';
  let c: number;
  if (kind === 'trench') { if (r.trench >= MAX_TRENCH) return 'Trenches are already at full depth.'; c = TRENCH_COST[r.trench]; }
  else { if (r[kind]) return 'Already built.'; c = COST[kind]; }
  if (f.supply < c) return `Not enough supply: this costs ${c}.`;
  f.supply -= c;
  if (kind === 'trench') r.trench++; else r[kind] = true;
  return null;
}

export function sendArmy(g: GameState, fid: number, fromId: number, toId: number, frac: number): string | null {
  const W = world(), A = g.regions[fromId], B = g.regions[toId], WA = W.regions[fromId], WB = W.regions[toId];
  if (!A || !B) return 'Unknown region.';
  if (A.owner !== fid) return 'Select one of your own regions first.';
  if (A.battle >= 0) return `${WA.name} is under attack. Its troops cannot leave.`;
  if (!WA.adj.includes(toId)) return `${WB.name} does not border ${WA.name}.`;
  const tot = totalUnits(A.units); if (tot < 2) return `${WA.name} needs at least 2 units to march. One always stays behind.`;
  frac = Math.max(.05, Math.min(1, frac));
  const u = emptyUnits(); let sent = 0;
  for (const k of UNIT_TYPES) { u[k] = Math.round(A.units[k] * frac); sent += u[k]; }
  if (sent >= tot) { for (const k of UNIT_TYPES) if (u[k] > 0) { u[k]--; sent--; break; } }
  if (sent <= 0) { for (const k of UNIT_TYPES) if (A.units[k] > 0) { u[k] = 1; sent = 1; break; } }
  for (const k of UNIT_TYPES) A.units[k] -= u[k];
  const dx = wrapDx(WA.cx, WB.cx), dz = WB.cz - WA.cz, dist = Math.hypot(dx, dz);
  const a: Army = { id: g.nextId++, owner: fid, units: u, from: fromId, to: toId, t: 0, dur: Math.max(2.5, dist / 2.4), sea: W.seaLane.has(fromId + '|' + toId), ax: WA.cx, az: WA.cz, dx, dz };
  g.armies.push(a);
  emit(g, { k: 'march', faction: fid, from: fromId, to: toId, units: totalUnits(u) });
  return null;
}

export const armyPos = (a: Army): [number, number] => { let x = a.ax + a.dx * a.t; if (x < -HW) x += 2 * HW; if (x > HW) x -= 2 * HW; return [x, a.az + a.dz * a.t]; };

export function arrive(g: GameState, a: Army) {
  const t = g.regions[a.to], len = Math.hypot(a.dx, a.dz) || 1, dir = { x: -a.dx / len, z: -a.dz / len };
  const b = t.battle >= 0 ? g.battles.find(x => x.id === t.battle) : null;
  if (b && !b.ended) joinBattle(g, b, a.owner, a.units, dir, a.owner === t.owner);
  else if (t.owner === a.owner) { for (const k of UNIT_TYPES) t.units[k] += a.units[k]; }
  else { const nb = startBattle(g, t, dir, a.owner); joinBattle(g, nb, a.owner, a.units, dir, false); }
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
    case 'build': { const r = g.regions[c.region]; if (!r) return 'Invalid order.'; return build(g, fid, r, c.kind); }
    case 'march': return sendArmy(g, fid, c.from, c.to, c.frac);
    default: return 'Unknown command.';
  }
}
