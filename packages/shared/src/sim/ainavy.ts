// The computer's navy: build transports, landing craft, battleships and carriers by national taste; keep the battle fleet in
// port as a fleet in being and sortie when clearly stronger (Britain holds the North Sea); ship reserves to threatened coasts
// that cannot be reached over land; now and then a landing on a weakly held enemy coast.
import { SHIP } from '../data/sea';
import { nationOf } from '../data/nations';
import { groundUnits, unitPower } from '../data/units';
import { rnd, world } from './core';
import { atPeace } from './diplomacy';
import { mainOf, landRoute } from './posts';
import { guessedUnits } from './fog';
import { atWar, buildPort, buildShip, carrierDay, coastal, docked, fleetShips, fleetZone, landing, portReady, seaControl, shipCost, shipMax, shipTroops, station, dock } from './navy';
import { carrierAir, carrierHops, embarkAir } from './carrier';
import { missionWants } from './missions';
import type { FactionState, GameState, RegionState } from './types';

type R = RegionState & { _th?: number };

export function navyAi(g: GameState, f: FactionState, mine: R[], V: GameState, attacks: () => number, cap: number) {
  if (!g.ships) return;
  const W = world(), P = nationOf(f.id).ai, fid = f.id;
  const ports = mine.filter(r => portReady(g, r) && r.contested < 0 && !r.cut);
  const capital = mine.find(r => r.capitalOf === fid);
  const ships = g.ships.filter(s => s.owner === fid), n = (k: string) => ships.filter(s => s.kind === k).length;
  const far = mine.filter(r => coastal(r.id) && capital && !landRoute(g, fid, r.id, capital.id));
  // ---- shipbuilding
  if (ports.length) {
    const home = ports.slice().sort((a, b) => (b.capitalOf === fid ? 1 : 0) - (a.capitalOf === fid ? 1 : 0) || (b.factory ? 1 : 0) - (a.factory ? 1 : 0))[0];
    const yard = ports.find(r => r.factory);
    const wantT = Math.min(8, Math.round((2 + far.length * .7) * (.6 + P.navy * .3)));
    if (n('trans') < wantT && f.supply >= SHIP.trans.cost + 4 && rnd(g) < .25) buildShip(g, fid, home, 'trans');
    if (n('land') < Math.round(1 + P.navy) && f.supply >= SHIP.land.cost + 4 && rnd(g) < .15) buildShip(g, fid, home, 'land');
    if (yard && n('bb') < Math.round(2 + P.navy * 2) && f.supply >= shipCost(fid, 'bb') + 10 && rnd(g) < .025 * P.navy) buildShip(g, fid, yard, 'bb');
    if (yard && g.day >= carrierDay(fid) && P.navy >= 1.4 && n('carrier') < 1 && f.supply >= shipCost(fid, 'carrier') + 8 && rnd(g) < .06) buildShip(g, fid, yard, 'carrier');
  }
  // a port for a far coast that has none
  if (f.supply >= 12 && rnd(g) < .02) { const r = far.find(x => !x.port && x.contested < 0); if (r) buildPort(g, fid, r); }
  // ---- battle fleets: a fleet in being at home; sortie when clearly stronger in a zone
  const c = seaControl(g);
  const enemyIn = (z: number) => { let e = 0; for (const o of g.factions) if (atWar(g, fid, o.id)) e = Math.max(e, c.at[o.id][z] + c.deny[o.id][z]); return e; };
  for (const r of ports) {
    const bbs = docked(g, r.id, fid, 'bb').filter(s => s.hp > shipMax(s) * .7); if (!bbs.length) continue;
    const mineHere = bbs.reduce((s, x) => s + SHIP.bb.sea * x.hp / shipMax(x), 0);
    let best = -1, bs = 0;
    for (const z of W.regions[r.id].zones) {
      const e = enemyIn(z), own = c.at[fid][z] + mineHere;
      const enemyCoast = W.zones[z].coast.some(x => atWar(g, fid, g.regions[x].owner));
      if (!enemyCoast) continue;
      const need = fid === 0 ? 1 : 1.3;
      if (own >= e * need && own > 0) { const s = own - e + (z === W.regions[r.id].zones[0] ? 1 : 0) + rnd(g); if (s > bs) { bs = s; best = z; } }
    }
    if (best >= 0 && rnd(g) < .3 * Math.max(.5, P.navy)) station(g, fid, best, r.id, undefined, 'bb');
  }
  for (const fl of g.fleets) {
    if (fl.owner !== fid || fl.task !== 'station' || fl.sea !== undefined) continue;
    const z = fleetZone(fl); if (z < 0) continue;
    const mineS = c.at[fid][z], e = enemyIn(z);
    if (e > mineS * 1.25 && rnd(g) < .5) dock(g, fid, fl.id);
  }
  // ---- carriers: squadrons aboard, then out with the fleet; strikes on coasts in reach
  for (const s of ships) {
    if (s.kind !== 'carrier' || (s.ready ?? 0) > g.time) continue;
    if (s.fleet < 0 && s.port >= 0) {
      const r = g.regions[s.port];
      if ((s.planes ?? 0) < SHIP.carrier.cap && r.units.plane > 1) embarkAir(g, fid, r.id, s.id, Math.min(SHIP.carrier.cap - (s.planes ?? 0), r.units.plane - 1));
      if ((s.planes ?? 0) >= 2 && rnd(g) < .2) { const z = W.regions[r.id].zones.find(z => W.zones[z].coast.some(x => atWar(g, fid, g.regions[x].owner))); if (z !== undefined) station(g, fid, z, r.id, undefined, 'carrier'); }
    } else if (s.fleet >= 0 && (s.planes ?? 0) >= 2 && rnd(g) < .15 && (!cap || attacks() < cap)) {
      const fl = g.fleets.find(x => x.id === s.fleet); if (!fl || fl.state !== 'stationed') continue;
      const z = fleetZone(fl);
      const tgt = V.regions.filter(r => r.owner !== fid && r.owner >= 0 && atWar(g, fid, r.owner) && carrierHops(z, r.id) <= 2 && !r.defs.some(d => d.k === 'flak')).sort((a, b) => unitPower(guessedUnits(a)) - unitPower(guessedUnits(b)))[0];
      if (tgt) carrierAir(g, fid, s.id, tgt.id);
    }
  }
  // ---- reserves by sea to threatened coasts that land routes cannot reach in time
  if (rnd(g) < .25) {
    const need = mine.filter(r => coastal(r.id) && (r._th ?? 0) > 4 && r.battle < 0).sort((a, b) => (b._th ?? 0) - (a._th ?? 0))[0];
    if (need) {
      const near = mine.filter(r => r.id !== need.id && landRoute(g, fid, r.id, need.id) && groundUnits(mainOf(r)) >= 3).length;
      const src = mine.filter(r => r.id !== need.id && coastal(r.id) && r.battle < 0 && (r._th ?? 0) < -4 && groundUnits(mainOf(r)) >= 5 && !landRoute(g, fid, r.id, need.id)).sort((a, b) => (a._th ?? 0) - (b._th ?? 0))[0];
      if (src && !near) shipTroops(g, fid, src.id, -1, need.id, -1, .45, { quay: 'drop' });
    }
  }
  // ---- now and then a landing on a weakly held enemy coast (more often for sea powers)
  if ((!cap || attacks() < cap) && rnd(g) < .05 * P.navy && g.ships.some(s => s.owner === fid && s.kind === 'land' && s.fleet < 0 && (s.ready ?? 0) <= g.time)) {
    const bases = mine.filter(r => coastal(r.id) && r.battle < 0 && groundUnits(mainOf(r)) >= 8 && (r._th ?? 0) < 0);
    let best: [number, number, number] | null = null, bs = -1e9;
    for (const a of bases) for (const z of W.regions[a.id].zones) for (const t of W.zones[z].coast) {
      const T = V.regions[t]; if (T.owner === fid || T.owner < 0 || !atWar(g, fid, T.owner) || atPeace(g, fid, T.owner) || T.battle >= 0) continue;
      const dp = unitPower(guessedUnits(T)) + 1, av = unitPower(mainOf(a)) * .5;
      const s = av - dp * 1.8 + (missionWants(g, f, t) ? 5 : 0) + (T.capitalOf >= 0 ? 2 : 0) + rnd(g) * 2 - (c.ctrl[z] >= 0 && atWar(g, fid, c.ctrl[z]) ? 8 : 0);
      if (s > bs) { bs = s; best = [a.id, t, z]; }
    }
    if (best && bs > 2) landing(g, fid, best[0], best[1], .6, rnd(g) < P.line ? 1 : 2, best[2]);
  }
  void fleetShips;
}
