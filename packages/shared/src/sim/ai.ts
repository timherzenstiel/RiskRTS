// Computer-controlled powers. Uses exactly the same commands as human players.
import { COST, DT, MAX_DEF_SECTOR, MAX_TRENCH, TRENCH_COST, UT, groundUnits, unitPower, type DefKind, type UnitType } from '../data/units';
import { hops, offensives, rnd, world } from './core';
import { assault, build, fortify, recruit, sendAir, sendArmy } from './commands';
import { missionWants } from './missions';
import type { FactionState, GameState, RegionState } from './types';

type R = RegionState & { _th?: number };
const enemyNb = (g: GameState, t: RegionState, fid: number) => world().regions[t.id].adj.map(i => g.regions[i]).filter(n => n.owner !== fid);
const defPow = (t: RegionState, from = -2) => t.defs.reduce((s, d) => s + (d.f === t.owner && (from === -2 || d.s === from || d.s < 0) ? DT[d.k].power : 0), 0);
const defPower = (t: RegionState, from = -2) => t.battle >= 0 ? 99 : unitPower(t.units) * (1 + .3 * t.trench) + defPow(t, from) + .5;

export function aiThink(g: GameState, f: FactionState) {
  const mine = g.regions.filter(t => t.owner === f.id) as R[]; if (!mine.length) return;
  for (const t of mine) { let e = 0; for (const n of enemyNb(g, t, f.id)) e += unitPower(n.units); t._th = e * .6 - unitPower(t.units) * (1 + .3 * t.trench) - defPow(t) + (t.battle >= 0 ? 8 : 0); }
  const border = mine.filter(t => enemyNb(g, t, f.id).length && t.contested < 0);
  const cap = g.cfg?.attackCap ?? 0;
  let guard = 50;
  while (f.supply >= 1 && guard-- > 0 && border.length) {
    const facs = mine.filter(t => t.factory).length, bars = mine.filter(t => t.barracks).length, airs = mine.filter(t => t.airfield).length;
    const ok = mine.filter(t => t.contested < 0);
    if (f.supply >= COST.factory + 2 && facs < 1 + Math.floor(mine.length / 5) && rnd(g) < .4) { const c = ok.filter(t => !t.factory).sort((a, b) => a._th! - b._th!)[0]; if (c && !build(g, f.id, c, 'factory')) continue; }
    if (f.supply >= COST.barracks + 1 && bars < Math.floor(mine.length / 6) && rnd(g) < .25) { const c = ok.filter(t => !t.barracks).sort((a, b) => a._th! - b._th!)[0]; if (c && !build(g, f.id, c, 'barracks')) continue; }
    if (f.supply >= COST.airfield + 3 && airs < Math.min(2, Math.floor(mine.length / 7)) && rnd(g) < .2) { const c = ok.filter(t => !t.airfield).sort((a, b) => a._th! - b._th!)[0]; if (c && !build(g, f.id, c, 'airfield')) continue; }
    let tgt: R | null = null, bs = -1e9;
    for (const t of border) { const s = t._th! + rnd(g) * 3 + (t.capitalOf === f.id ? 4 : 0) + (enemyNb(g, t, f.id).some(n => missionWants(g, f, n.id)) ? 2 : 0); if (s > bs) { bs = s; tgt = t; } }
    if (!tgt) break;
    if (tgt._th! > 4 && tgt.trench < MAX_TRENCH && f.supply >= TRENCH_COST[tgt.trench] && rnd(g) < .18) { build(g, f.id, tgt, 'trench'); continue; }
    // fortify the border facing the strongest neighbour
    if (tgt._th! > 3 && rnd(g) < .2) {
      const worst = enemyNb(g, tgt, f.id).sort((a, b) => unitPower(b.units) - unitPower(a.units))[0];
      if (worst && tgt.defs.filter(d => d.s === worst.id).length < MAX_DEF_SECTOR) {
        const k: DefKind = f.supply >= COST.fort + 2 && rnd(g) < .35 ? 'fort' : 'pill';
        if (f.supply >= COST[k] && !fortify(g, f.id, tgt, k, worst.id)) continue;
      }
    }
    if (rnd(g) < .06 && f.supply >= COST.flak && !tgt.defs.some(d => d.k === 'flak') && g.regions.some(r => r.owner !== f.id && r.airfield && hops(r.id, tgt!.id) <= 2)) { if (!fortify(g, f.id, tgt, 'flak', -1)) continue; }
    const air = mine.find(t => t.airfield && t.contested < 0 && t.units.plane < 4);
    if (air && f.supply >= COST.plane + 1 && rnd(g) < .18) { if (!recruit(g, f.id, air, 'plane')) continue; }
    const r = rnd(g); let type: UnitType = 'inf';
    if (tgt.factory && f.supply >= 5 && r < .22) type = 'tank'; else if (f.supply >= 3 && r < .45) type = 'art'; else if (f.supply >= 2 && r < .65) type = 'mg';
    if (recruit(g, f.id, tgt, type)) break;
    tgt._th! -= UT[type].power;
  }
  // storm holdouts in our own contested regions when strong enough
  for (const t of mine) {
    if (t.contested < 0 || t.battle >= 0) continue;
    const hold = t.defs.filter(d => d.f !== f.id).reduce((s, d) => s + DT[d.k].power * d.hp / DT[d.k].hp, 0);
    if (unitPower(t.units) > hold * 1.15 + 1) assault(g, f.id, t);
  }
  let attacks = offensives(g, f.id).size;
  const room = () => !cap || attacks < cap;
  for (const t of mine.filter(t => t.battle < 0).sort((a, b) => unitPower(b.units) - unitPower(a.units))) {
    if (attacks >= 2 + (cap ? 0 : 1) || !room()) break; if (groundUnits(t.units) < 3) continue;
    const avail = unitPower({ ...t.units, plane: 0 }) * .85; let best: RegionState | null = null, bs = -1e9;
    for (const n of enemyNb(g, t, f.id)) {
      if (g.armies.some(a => a.owner === f.id && a.to === n.id)) continue;
      const dp = defPower(n, t.id), margin = avail - dp * 1.3 - 1.5; if (margin <= 0) continue;
      const s = margin + (missionWants(g, f, n.id) ? 6 : 0) + (n.capitalOf >= 0 ? 3 : 0) - dp * .2 + rnd(g) * 2;
      if (s > bs) { bs = s; best = n; }
    }
    if (best && !sendArmy(g, f.id, t.id, best.id, .85)) attacks++;
  }
  // aircraft: support our running attacks first, otherwise raid the weakest enemy region in range
  for (const t of mine) {
    if (t.units.plane < 2 || t.battle >= 0) continue;
    let best = -1, bs = -1e9;
    for (const b of g.battles) {
      if (b.ended || !b.sides.includes(f.id) || hops(t.id, b.region) > 2) continue;
      const s = 10 + rnd(g) * 3; if (s > bs) { bs = s; best = b.region; }
    }
    if (best < 0 && room() && rnd(g) < .5) for (const r of g.regions) {
      if (r.owner === f.id || r.battle >= 0 || hops(t.id, r.id) > 2) continue;
      const s = -defPower(r) - (r.defs.some(d => d.k === 'flak') ? 6 : 0) + (missionWants(g, f, r.id) ? 3 : 0) + rnd(g) * 2;
      if (s > bs) { bs = s; best = r.id; }
    }
    if (best >= 0 && !sendAir(g, f.id, t.id, best, 1) && g.regions[best].owner !== f.id) attacks++;
  }
  // shift reserves from the interior towards the front
  const dist: Record<number, number> = {}; const q: R[] = [];
  for (const t of mine) if (t.contested >= 0 || border.includes(t)) { dist[t.id] = 0; q.push(t); }
  for (let h = 0; h < q.length; h++) { const t = q[h]; for (const j of world().regions[t.id].adj) { const n = g.regions[j] as R; if (n.owner === f.id && dist[j] === undefined) { dist[j] = dist[t.id] + 1; q.push(n); } } }
  for (const t of mine) {
    if (t.battle >= 0 || !dist[t.id] || groundUnits(t.units) < 2) continue;
    const n = world().regions[t.id].adj.map(j => g.regions[j]).filter(n => n.owner === f.id && dist[n.id] < dist[t.id])[0];
    if (n) sendArmy(g, f.id, t.id, n.id, 1);
  }
}
