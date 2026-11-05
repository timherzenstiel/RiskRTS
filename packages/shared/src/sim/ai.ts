// Computer-controlled powers. Uses exactly the same commands as human players, and (below Marshal) sees the map through the
// same fog of war: it judges enemy regions by the estimate across its borders and by its own reconnaissance reports.
import { COST, DT, MAX_TRENCH, SHELLS, TRENCH_COST, UT, groundUnits, isDef, unitPower, type FortKind, type UnitType } from '../data/units';
import { forcePower, frontsOf, hops, offensives, rnd, worksAt, world } from './core';
import { assault, build, fortify, patrol, recon, recruit, sabotage, sendAir, sendArmy, shift, spy } from './commands';
import { buildRail, hasRail, railOpen } from './rails';
import { activeSpies } from './fog';
import { charge, mobilise, produce, reinforce, setBarrage, setStance, withdraw } from './levers';
import { nationOf } from '../data/nations';
import { unitCost } from './rules';
import { paceOf } from './battle';
import { fogView, guessedUnits } from './fog';
import { missionWants } from './missions';
import type { Battle, FactionState, GameState, RegionState } from './types';

type R = RegionState & { _th?: number };
const pw = (k: keyof typeof UT) => UT[k].power;
/** Our own garrison, weighted by strength and morale. */
const ownPower = (t: RegionState) => forcePower(t.units, t.men, pw) * (.6 + .4 * t.mor / 100);
const enemyNb = (V: GameState, t: RegionState, fid: number) => world().regions[t.id].adj.map(i => V.regions[i]).filter(n => n.owner !== fid);
const defPow = (t: RegionState, from = -2) => t.defs.reduce((s, d) => s + (d.f === t.owner && (from === -2 || d.s === from || d.s < 0) ? DT[d.k].power : 0), 0);
/** What an attack over `from` should expect in a region (as far as the view tells). */
const defPower = (t: RegionState, from = -2) => t.battle >= 0 ? 99 : unitPower(guessedUnits(t)) * (1 + .3 * (from >= 0 ? worksAt(t, from).tr : 0)) + defPow(t, from) + .5;
const theirPower = (t: RegionState) => unitPower(guessedUnits(t));

export function aiThink(g: GameState, f: FactionState) {
  const V = g.diff >= 2 ? g : fogView(g, f.id);
  const mine = g.regions.filter(t => t.owner === f.id) as R[]; if (!mine.length) return;
  for (const t of mine) {
    let e = 0; for (const n of enemyNb(V, t, f.id)) e += theirPower(n);
    const tr = Math.max(0, ...world().regions[t.id].adj.map(n => worksAt(t, n).tr));
    t._th = e * .6 - ownPower(t) * (1 + .3 * tr) - defPow(t) + (t.battle >= 0 ? 8 : 0);
  }
  const border = mine.filter(t => enemyNb(V, t, f.id).length && t.contested < 0 && !t.cut);
  // reconnaissance before spending: an estimate is not a report
  if (V !== g && border.length && f.supply >= 2) {
    const stale = (n: RegionState) => (n.vis ?? 3) < 3 && (n.seen === undefined || g.day - n.seen > 14);
    const t = border[Math.floor(rnd(g) * border.length)], n = enemyNb(V, t, f.id).filter(stale).sort((a, b) => theirPower(b) - theirPower(a))[0];
    const base = mine.find(x => x.airfield && x.contested < 0);
    if (n && rnd(g) < .35) patrol(g, f.id, t.id, n.id);
    else if (base && f.supply >= COST.recon + 2 && rnd(g) < .12) { const far = V.regions.find(r => r.owner !== f.id && stale(r) && hops(base.id, r.id) === 2 && missionWants(g, f, r.id)); if (far) recon(g, f.id, base.id, far.id); }
    if (f.supply >= COST.spy + 3 && rnd(g) < .05) {
      const cand = V.regions.filter(r => r.owner !== f.id && (r.vis ?? 3) < 3 && missionWants(g, f, r.id)).sort((a, b) => (b.capitalOf >= 0 ? 1 : 0) - (a.capitalOf >= 0 ? 1 : 0))[0];
      if (cand) spy(g, f.id, cand.id);
    }
  }
  levers(g, f, mine);
  manpower(g, f);
  railways(g, f, mine);
  const P = nationOf(f.id).ai, W = world();
  const cap = g.cfg?.attackCap ?? 0;
  let guard = 50;
  while (f.supply >= 1 && guard-- > 0 && border.length) {
    const facs = mine.filter(t => t.factory).length, bars = mine.filter(t => t.barracks).length, airs = mine.filter(t => t.airfield).length;
    const ok = mine.filter(t => t.contested < 0);
    if (f.supply >= COST.factory + 2 && facs < 1 + Math.floor(mine.length / 5) && rnd(g) < .4) { const c = ok.filter(t => !t.factory).sort((a, b) => a._th! - b._th!)[0]; if (c && !build(g, f.id, c, 'factory')) continue; }
    if (f.supply >= COST.barracks + 1 && bars < Math.floor(mine.length / 6) && rnd(g) < .25) { const c = ok.filter(t => !t.barracks).sort((a, b) => a._th! - b._th!)[0]; if (c && !build(g, f.id, c, 'barracks')) continue; }
    if (f.supply >= COST.airfield + 3 && airs < Math.min(2, Math.floor(mine.length / 7)) && rnd(g) < .2) { const c = ok.filter(t => !t.airfield).sort((a, b) => a._th! - b._th!)[0]; if (c && !build(g, f.id, c, 'airfield')) continue; }
    let tgt: R | null = null, bs = -1e9;
    for (const t of border) { const s = t._th! + rnd(g) * 3 + (t.capitalOf === f.id ? 4 : 0) + (enemyNb(V, t, f.id).some(n => missionWants(g, f, n.id)) ? 2 : 0); if (s > bs) { bs = s; tgt = t; } }
    if (!tgt) break;
    // dig in on the border facing the strongest neighbour: trench first, then wire, sandbags, MG nests, bunkers, guns
    if (tgt._th! > 3 && rnd(g) < .3 * P.dig) {
      const worst = enemyNb(V, tgt, f.id).sort((a, b) => theirPower(b) - theirPower(a))[0];
      if (worst) {
        const w = worksAt(tgt, worst.id), r = rnd(g);
        const order: FortKind[] = w.tr < 2 && f.supply >= TRENCH_COST[w.tr] ? ['trench'] : r < .2 ? ['wire', 'sand'] : r < .4 ? ['sand', 'wire'] : r < .6 && f.supply >= COST.bunk + 2 ? ['bunk', 'pill'] : r < .8 ? ['pill', 'fort'] : w.tr < MAX_TRENCH ? ['trench', 'fort'] : ['fort', 'pill'];
        let done = false; for (const k of order) if (!fortify(g, f.id, tgt, k, worst.id)) { done = true; break; }
        if (done) continue;
      }
    }
    if (rnd(g) < .06 && f.supply >= COST.flak && !tgt.defs.some(d => d.k === 'flak') && V.regions.some(r => r.owner !== f.id && r.airfield && hops(r.id, tgt!.id) <= 2)) { if (!fortify(g, f.id, tgt, 'flak', -1)) continue; }
    const air = mine.find(t => t.airfield && t.contested < 0 && !t.cut && t.units.plane < 4);
    if (air && f.supply >= COST.plane + 1 && rnd(g) < .18) { if (!recruit(g, f.id, air, 'plane')) continue; }
    // the mix of new units follows the national character: guns for France and Germany, masses of infantry for Russia
    const wt = { tank: tgt.factory && f.supply >= unitCost(g, f.id, 'tank') ? .22 : 0, art: f.supply >= 3 ? .23 * P.guns : 0, mg: f.supply >= 2 ? .2 : 0, inf: .35 * P.mass };
    let r = rnd(g) * (wt.tank + wt.art + wt.mg + wt.inf), type: UnitType = 'inf';
    for (const k of ['tank', 'art', 'mg'] as const) { if (r < wt[k]) { type = k; break; } r -= wt[k]; }
    if (recruit(g, f.id, tgt, type)) {
      // out of men or supply for that type: try one that needs fewer men; with the pool empty, the supply goes into works and shells
      const alt = (['tank', 'art', 'mg'] as UnitType[]).find(k => k !== type && !recruit(g, f.id, tgt!, k));
      if (alt) { tgt._th! -= UT[alt].power; continue; }
      if ((f.men ?? 0) >= 100 || f.supply < 3) break;
      const worst = enemyNb(V, tgt, f.id).sort((a, b) => theirPower(b) - theirPower(a))[0];
      if (worst && (['trench', 'wire', 'sand', 'pill', 'bunk', 'fort'] as FortKind[]).some(k => !fortify(g, f.id, tgt!, k, worst.id))) { tgt._th! -= 1; continue; }
      if (f.supply >= 8) produce(g, f.id, 'shells', Math.floor(f.supply / 2));
      break;
    }
    tgt._th! -= UT[type].power;
  }
  // storm holdouts in our own contested regions when strong enough
  for (const t of mine) {
    if (t.contested < 0 || t.battle >= 0) continue;
    const hold = t.defs.filter(d => d.f !== f.id).reduce((s, d) => s + DT[d.k].power * d.hp / DT[d.k].hp, 0);
    if (ownPower(t) > hold * 1.15 + 1) assault(g, f.id, t);
  }
  // fronts under pressure draw reserves from quieter fronts of the same region
  for (const t of mine) {
    const fr = frontsOf(g, t.id).filter(b => b.def === f.id); if (fr.length < 2 || rnd(g) > .3) continue;
    let worst = fr[0], ws = Infinity;
    for (const b of fr) { let me = 0, foe = 0; for (const a of b.agents) if (!a.dead && !a.out) { if (a.f === f.id) me++; else foe++; } const s = me / (foe + 1); if (s < ws) { ws = s; worst = b; } }
    if (ws < .7) shift(g, f.id, t, worst.id);
  }
  let attacks = offensives(g, f.id).size;
  const room = () => !cap || attacks < cap;
  for (const t of mine.filter(t => t.battle < 0).sort((a, b) => ownPower(b) - ownPower(a))) {
    if (attacks >= 2 + (cap ? 0 : 1) || !room()) break; if (groundUnits(t.units) < 3) continue;
    const avail = forcePower({ ...t.units, plane: 0 }, t.men, pw) * (.6 + .4 * t.mor / 100) * .85; let best: RegionState | null = null, bs = -1e9;
    for (const n of enemyNb(V, t, f.id)) {
      if (g.armies.some(a => a.owner === f.id && a.to === n.id)) continue;
      const dp = defPower(n, t.id), margin = avail - dp * 1.3 * P.aggr - 1.5; if (margin <= 0) continue;
      const sea = W.seaLane.has(t.id + '|' + n.id) || W.regions[n.id].seaAdj.length > 0;
      const s = margin + (missionWants(g, f, n.id) ? 6 : 0) + (n.capitalOf >= 0 ? 3 : 0) - dp * .2 + rnd(g) * 2 + (sea ? 2 * (P.navy - 1) : 0);
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
    if (best < 0 && room() && rnd(g) < .5) for (const r of V.regions) {
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

/** Strength of each side on a front: [ours, theirs] in unit power, weighted by the hit points left. */
function sidePower(b: Battle, fid: number): [number, number] {
  let me = 0, foe = 0;
  for (const a of b.agents) {
    if (a.dead || a.out) continue;
    const p = (isDef(a.type) ? DT[a.type].power : UT[a.type as UnitType].power) * Math.max(.2, a.hp / (isDef(a.type) ? DT[a.type].hp : UT[a.type as UnitType].hp));
    if (a.f === fid) me += p; else foe += p;
  }
  return [me, foe];
}

/** Shells to keep in stock: 30 plus 10 per battery and gun emplacement. */
export const shellTarget = (g: GameState, fid: number) => {
  let guns = 0; for (const r of g.regions) if (r.owner === fid) guns += r.units.art + r.defs.filter(d => d.k === 'fort' && d.f === fid).length;
  return 30 + 10 * guns;
};

/** Battle levers: shells, barrage, when to go over the top, reinforcing, withdrawing, stance of the capital. */
function levers(g: GameState, f: FactionState, mine: RegionState[]) {
  const fid = f.id, target = shellTarget(g, fid), P = paceOf(g);
  if (f.shells < target && f.supply >= 6 && rnd(g) < .5) produce(g, fid, 'shells', Math.min(Math.ceil((target - f.shells) / SHELLS.perSupply), Math.floor(f.supply / 3)));
  const capital = mine.find(r => r.capitalOf === fid);
  if (capital && capital.stance !== 3) setStance(g, fid, capital.id, 3);
  for (const b of g.battles) {
    if (b.ended || !(b.def === fid || b.sides.includes(fid))) continue;
    const att = b.def !== fid, [me, foe] = sidePower(b, fid);
    // heavy barrage against dug-in defenders while shells last; light otherwise
    const dug = att ? (b.tr > 0 || b.wire > 0 || b.agents.some(a => !a.dead && !a.out && a.f === b.def && isDef(a.type))) : !b.go;
    const want = f.shells > target * .5 && dug ? 2 : f.shells > 4 ? 1 : (att ? 1 : 0);
    if ((b.bar[fid] ?? 1) !== want) setBarrage(g, fid, b.id, want as 0 | 1 | 2);
    if (att && !b.go) {
      const supp = b.supp[b.def] ?? 0, cut = b.wire0 > 0 ? b.wire / b.wire0 : 0;
      const pat = nationOf(fid).ai.patience;
      if (supp > 55 * pat || (cut < .4 && supp > 35 * pat) || b.age > P.go * .8 || me > foe * 3) charge(g, fid, b.id);
    }
    // a hopeless attack is called off; a front that is losing gets fresh troops from next door
    if (att && b.go && me < foe * .35 && (b.mor[fid] ?? 70) < 30 && rnd(g) < .3 * nationOf(fid).ai.retreat) { withdraw(g, fid, b.id); continue; }
    if (me < foe * 1.1 && rnd(g) < .25) {
      const from = world().regions[b.region].adj.map(i => g.regions[i]).filter(r => r.owner === fid && r.battle < 0 && groundUnits(r.units) >= 3).sort((x, y) => groundUnits(y.units) - groundUnits(x.units))[0];
      if (from) reinforce(g, fid, from.id, b.id, .6);
    }
  }
}

/** Mobilise when the manpower pool runs low, stand down when it is full or the nation is close to unrest. */
function manpower(g: GameState, f: FactionState) {
  const thr = nationOf(f.id).unrest, pool = f.men ?? 0; let want = f.mob ?? 0;
  if (f.ww > thr - 12) want = 0;
  else if (pool < 400 && f.ww < thr - 35) want = 2;
  else if (pool < 1200 && f.ww < thr - 25) want = Math.max(want, 1);
  else if (pool > 4000) want = Math.max(0, want - 1);
  if (want !== (f.mob ?? 0)) mobilise(g, f.id, want);
}

/** Rails: lay lines to regions on thin supply, let spies blow up enemy lines, and now and then bomb a rail hub. */
function railways(g: GameState, f: FactionState, mine: RegionState[]) {
  const W = world();
  if (f.supply >= 14 && rnd(g) < .08) {
    for (const r of mine) {
      if (r.supplyQ !== 1 || r.contested >= 0) continue;
      const n = W.regions[r.id].adj.find(j => g.regions[j].owner === f.id && g.regions[j].supplyQ === 2 && !W.seaLane.has(r.id + '|' + j) && !hasRail(g, r.id, j));
      if (n !== undefined && !buildRail(g, f.id, r.id, n)) break;
    }
  }
  for (const s of activeSpies(g, f.id)) {
    if (rnd(g) > .12) continue;
    const n = W.regions[s.region].adj.find(j => railOpen(g, s.region, j) && g.regions[j].owner === g.regions[s.region].owner);
    if (n !== undefined) sabotage(g, f.id, s.region, n);
  }
  if (rnd(g) < .04) {
    const base = mine.find(t => t.units.plane >= 3 && t.battle < 0);
    if (base) {
      const tgt = W.regions[base.id].adj.flatMap(j => [j, ...W.regions[j].adj]).map(j => g.regions[j])
        .find(r => r.owner !== f.id && W.regions[r.id].adj.filter(n => railOpen(g, r.id, n)).length >= 2 && !r.defs.some(d => d.k === 'flak'));
      if (tgt) sendAir(g, f.id, base.id, tgt.id, .5, true);
    }
  }
}
