// Computer-controlled powers. Uses exactly the same commands as human players.
import { COST, MAX_TRENCH, TRENCH_COST, UT, totalUnits, unitPower, type UnitType } from '../data/units';
import { rnd, world } from './core';
import { build, recruit, sendArmy } from './commands';
import { missionWants } from './missions';
import type { FactionState, GameState, RegionState } from './types';

type R = RegionState & { _th?: number };
const enemyNb = (g: GameState, t: RegionState, fid: number) => world().regions[t.id].adj.map(i => g.regions[i]).filter(n => n.owner !== fid);
const defPower = (t: RegionState) => t.battle >= 0 ? 99 : unitPower(t.units) * (1 + .3 * t.trench) + .5;

export function aiThink(g: GameState, f: FactionState) {
  const mine = g.regions.filter(t => t.owner === f.id) as R[]; if (!mine.length) return;
  for (const t of mine) { let e = 0; for (const n of enemyNb(g, t, f.id)) e += unitPower(n.units); t._th = e * .6 - unitPower(t.units) * (1 + .3 * t.trench) + (t.battle >= 0 ? 8 : 0); }
  const border = mine.filter(t => enemyNb(g, t, f.id).length);
  let guard = 50;
  while (f.supply >= 1 && guard-- > 0 && border.length) {
    const facs = mine.filter(t => t.factory).length, bars = mine.filter(t => t.barracks).length;
    if (f.supply >= COST.factory + 2 && facs < 1 + Math.floor(mine.length / 5) && rnd(g) < .4) { const c = mine.filter(t => !t.factory).sort((a, b) => a._th! - b._th!)[0]; if (c && !build(g, f.id, c, 'factory')) continue; }
    if (f.supply >= COST.barracks + 1 && bars < Math.floor(mine.length / 6) && rnd(g) < .25) { const c = mine.filter(t => !t.barracks).sort((a, b) => a._th! - b._th!)[0]; if (c && !build(g, f.id, c, 'barracks')) continue; }
    let tgt: R | null = null, bs = -1e9;
    for (const t of border) { const s = t._th! + rnd(g) * 3 + (t.capitalOf === f.id ? 4 : 0) + (enemyNb(g, t, f.id).some(n => missionWants(g, f, n.id)) ? 2 : 0); if (s > bs) { bs = s; tgt = t; } }
    if (!tgt) break;
    if (tgt._th! > 4 && tgt.trench < MAX_TRENCH && f.supply >= TRENCH_COST[tgt.trench] && rnd(g) < .22) { build(g, f.id, tgt, 'trench'); continue; }
    const r = rnd(g); let type: UnitType = 'inf';
    if (tgt.factory && f.supply >= 5 && r < .22) type = 'tank'; else if (f.supply >= 3 && r < .45) type = 'art'; else if (f.supply >= 2 && r < .65) type = 'mg';
    if (recruit(g, f.id, tgt, type)) break;
    tgt._th! -= UT[type].power;
  }
  let attacks = 0;
  for (const t of mine.filter(t => t.battle < 0).sort((a, b) => unitPower(b.units) - unitPower(a.units))) {
    if (attacks >= 2) break; if (totalUnits(t.units) < 3) continue;
    const avail = unitPower(t.units) * .85; let best: RegionState | null = null, bs = -1e9;
    for (const n of enemyNb(g, t, f.id)) {
      if (g.armies.some(a => a.owner === f.id && a.to === n.id)) continue;
      const margin = avail - defPower(n) * 1.3 - 1.5; if (margin <= 0) continue;
      const s = margin + (missionWants(g, f, n.id) ? 6 : 0) + (n.capitalOf >= 0 ? 3 : 0) - defPower(n) * .2 + rnd(g) * 2;
      if (s > bs) { bs = s; best = n; }
    }
    if (best && !sendArmy(g, f.id, t.id, best.id, .85)) attacks++;
  }
  // shift reserves from the interior towards the front
  const dist: Record<number, number> = {}; const q: R[] = [];
  for (const t of border) { dist[t.id] = 0; q.push(t); }
  for (let h = 0; h < q.length; h++) { const t = q[h]; for (const j of world().regions[t.id].adj) { const n = g.regions[j] as R; if (n.owner === f.id && dist[j] === undefined) { dist[j] = dist[t.id] + 1; q.push(n); } } }
  for (const t of mine) {
    if (t.battle >= 0 || !dist[t.id] || totalUnits(t.units) < 2) continue;
    const n = world().regions[t.id].adj.map(j => g.regions[j]).filter(n => n.owner === f.id && dist[n.id] < dist[t.id])[0];
    if (n) sendArmy(g, f.id, t.id, n.id, 1);
  }
}
