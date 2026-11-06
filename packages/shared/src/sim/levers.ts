// Battle levers: the handful of decisions a commander makes per front while the battle fights itself.
// Barrage level, over the top, stance, reinforcing a front from a neighbouring region, and withdrawing.
import { isCoast } from '../world/zones';
import { reembark } from './navy';
import { COST, FORMATION, SHELLS, groundUnits, isDef } from '../data/units';
import { recordIntel } from './fog';
import { setStopAttack, treatyCheck } from './diplomacy';
import { marchFactor } from './rails';
import { MARCH_MIN, MARCH_SPEED, emit, mkArmy, rnd, world } from './core';
import { POST_SPEED, column, legDist, moveK } from './posts';
import { weatherMarch } from './rails';
import { forceIn, forceParts, goOverTheTop, LULL_FROM } from './battle';
import { formArmy } from './commands';
import { stanceIn, statsOf } from './rules';
import type { Army, Barrage, Battle, GameState, Stance } from './types';

const live = (g: GameState, id: number): Battle | undefined => g.battles.find(b => b.id === id && !b.ended);
const fights = (b: Battle, f: number) => b.def === f || b.sides.includes(f);
const NOT_HERE = 'You do not fight in that battle.';

/** Barrage level of your guns in one battle: 0 hold fire, 1 light, 2 heavy. */
export function setBarrage(g: GameState, fid: number, bid: number, level: Barrage): string | null {
  const b = live(g, bid); if (!b || !fights(b, fid)) return NOT_HERE;
  if (level !== 0 && level !== 1 && level !== 2) return 'Invalid order.';
  b.bar[fid] = level; return null;
}

/** Send the attackers over the top now instead of waiting for the guns. */
export function charge(g: GameState, fid: number, bid: number): string | null {
  const b = live(g, bid); if (!b || !fights(b, fid)) return NOT_HERE;
  if (b.def === fid) return 'Only the attackers go over the top. Defenders hold the trench.';
  if (b.go) return 'The attack is already under way.';
  if (!b.agents.some(a => a.f === fid && !a.dead && !a.out && !isDef(a.type) && a.type !== 'art' && a.type !== 'plane')) return 'No infantry or tanks of yours wait at the start line.';
  goOverTheTop(g, b, fid); return null;
}

/** Stance of a region's garrison (and its fronts), or of your side in one battle. */
export function setStance(g: GameState, fid: number, region: number, s: Stance, battle?: number): string | null {
  if (s !== 0 && s !== 1 && s !== 2 && s !== 3) return 'Invalid order.';
  if (battle !== undefined && battle >= 0) {
    const b = live(g, battle); if (!b || !fights(b, fid)) return NOT_HERE;
    b.st[fid] = s; return null;
  }
  const r = g.regions[region]; if (!r) return 'Unknown region.';
  if (r.owner !== fid) return 'You can only set the stance of your own garrisons.';
  r.stance = s;
  for (const b of g.battles) if (!b.ended && b.region === region && b.def === fid) b.st[fid] = s;
  return null;
}

/** Send part of a neighbouring region's troops straight into one front. */
export function reinforce(g: GameState, fid: number, from: number, bid: number, frac: number): string | null {
  const b = live(g, bid); if (!b) return 'That battle is over.';
  const own = g.regions[b.region].owner === fid;
  if (!own && !b.sides.includes(fid)) return NOT_HERE;
  if (!own) { const t = treatyCheck(g, fid, b.region); if (t) return t; }
  const a = formArmy(g, fid, from, b.region, frac, own ? (world().regions[b.region].land.includes(from) ? from : -1) : from); if (typeof a === 'string') return a;
  a.front = b.id;
  emit(g, { k: 'march', faction: fid, from, to: b.region, units: groundUnits(a.units) });
  return null;
}

/** Pull your troops out of a front: attackers fall back over the border they came from, defenders to a neighbouring own region. */
export function withdraw(g: GameState, fid: number, bid: number): string | null {
  const b = live(g, bid); if (!b || !fights(b, fid)) return NOT_HERE;
  if (stanceIn(b, fid) === 3) return 'Your troops hold at all costs. Change their stance before ordering a retreat.';
  return pullOut(g, b, fid);
}
setStopAttack((g, bid, f) => { const b = live(g, bid); if (b) pullOut(g, b, f); });

function pullOut(g: GameState, b: Battle, fid: number): string | null {
  const f = forceIn(b, fid, false, g); if (groundUnits(f.u) <= 0) return 'None of your troops are left on this front.';
  const out = () => { for (const x of b.agents) if (x.f === fid && !x.dead && !x.out && !isDef(x.type) && x.type !== 'plane') x.out = true; };
  const mor = Math.max(0, f.mor - 10), st = stanceIn(b, fid);
  // defenders of a phased front fall back to the main army in the middle of the region (the fight goes on in the depth)
  if (fid === b.def && b.goal && (b.stage ?? 0) === 0 && g.regions[b.region].owner === fid && b.from >= 0) {
    const parts = forceParts(b, fid, g);
    out(); for (const [key, p] of parts) column(g, fid, b.region, b.from, b.region, -1, p.u, p.m, mor, { tired: true, stance: st, gn: b.cn, gk: 1, ct: key >= 0 ? b.ct?.[key] : undefined });
    emit(g, { k: 'withdraw', faction: fid, region: b.region, to: b.region });
    return null;
  }
  // off a beach: back into the boats, if they are still there
  if (fid !== b.def && isCoast(b.from)) {
    if (!reembark(g, b, fid, f.u, f.m, mor)) return 'The boats have gone. The troops on the beach fight on or surrender.';
    out(); emit(g, { k: 'withdraw', faction: fid, region: b.region, to: b.src ?? b.region });
    return null;
  }
  const W = world(), adj = W.regions[b.region].land.filter(j => g.regions[j].owner === fid && j !== b.region);
  if (!adj.length) return 'There is no region of yours next to this front to fall back to.';
  const score = (j: number) => (j === b.from ? 4 : 0) + (g.regions[j].cut ? 0 : 2) + (g.regions[j].battle < 0 ? 1 : 0);
  const dest = adj.sort((x, y) => score(y) - score(x))[0];
  const parts = forceParts(b, fid, g);
  out(); for (const [key, p] of parts) column(g, fid, b.region, fid === b.def ? -1 : b.from, dest, -1, p.u, p.m, mor, { tired: true, stance: st, ct: key >= 0 ? b.ct?.[key] : undefined });
  emit(g, { k: 'withdraw', faction: fid, region: b.region, to: dest });
  return null;
}

/** Turn supply into shells. */
export function produce(g: GameState, fid: number, kind: 'shells', n: number): string | null {
  if (kind !== 'shells') return 'Invalid order.';
  const f = g.factions[fid]; n = Math.max(1, Math.min(50, Math.floor(n || 0)));
  if (f.supply < n) return `Not enough supply: ${n * SHELLS.perSupply} shells cost ${n}.`;
  f.supply -= n; f.shells += n * SHELLS.perSupply; return null;
}

/** Mobilisation level: 0 peacetime classes, 1 partial, 2 general mobilisation. */
export function mobilise(g: GameState, fid: number, level: number): string | null {
  if (level !== 0 && level !== 1 && level !== 2) return 'Invalid order.';
  g.factions[fid].mob = level; return null;
}

/** Days a fake concentration fools rivals (unless they scout it), and battalions a decoy pretends to be. */
export const DECOY = { days: 35, min: 5, spread: 10 } as const;

/** March a decoy army: no troops, but rivals watching either region see an army on the way. */
export function decoy(g: GameState, fid: number, from: number, to: number): string | null {
  const W = world(), A = g.regions[from], B = g.regions[to], f = g.factions[fid];
  if (!A || !B) return 'Unknown region.';
  if (A.owner !== fid) return 'Decoys march out of your own regions.';
  if (!W.regions[from].adj.includes(to)) return `${W.regions[to].name} does not border ${W.regions[from].name}.`;
  if (f.supply < COST.decoy) return `Not enough supply: a decoy costs ${COST.decoy}.`;
  f.supply -= COST.decoy;
  const a = mkArmy(g, fid, from, to, MARCH_SPEED, MARCH_MIN); a.dur = legDist(from, -1, to, -1) / POST_SPEED * moveK(g); a.decoy = true; a.fake = DECOY.min + Math.floor(rnd(g) * DECOY.spread);
  // look like a real march: the garrison's morale and stance, a first leg
  a.mor = A.mor; a.stance = A.stance ?? 0; a.legs = 1;
  const mf = marchFactor(g, fid, from, to); a.dur *= mf.k; if (mf.rail) a.rail = true; g.armies.push(a);
  return null;
}

/** A decoy arrives: in an own region it becomes a fake concentration that inflates rivals' estimates; elsewhere it melts away. */
export function decoyArrives(g: GameState, a: Army) {
  const t = g.regions[a.to];
  if (t.owner === a.owner) t.fake = { men: (a.fake ?? 8) * FORMATION.inf.men, day: g.day, until: g.day + DECOY.days };
}

/** Seconds between two trench raids of one side on the same front. */
export const RAID_COOLDOWN = 30;

/** A trench raid from a front gone quiet: a battalion risks 10–40% losses to bring back a report and shake the enemy. */
export function raid(g: GameState, fid: number, bid: number): string | null {
  const b = live(g, bid); if (!b || !fights(b, fid)) return NOT_HERE;
  if (b.age - (b.lastJoin ?? 0) < LULL_FROM) return 'Raids go out from fronts that have settled into trench warfare. This one is still in full swing.';
  if ((b.raidT?.[fid] ?? -1e9) > b.age - RAID_COOLDOWN) return 'The last raid has only just come back. Give the men a moment.';
  const pick = b.agents.filter(a => a.f === fid && a.type === 'inf' && !a.dead && !a.out);
  if (!pick.length) return 'No infantry of yours on this front to send.';
  const a = pick[Math.floor(rnd(g) * pick.length)], s = statsOf(g, fid, 'inf'), k = .1 + rnd(g) * .3;
  const before = a.hp; a.hp = Math.max(.01 * s.hp, a.hp - s.hp * k);
  const lost = (before - a.hp) / s.hp * (a.men ?? FORMATION.inf.men);
  b.lost[fid] = (b.lost[fid] ?? 0) + lost; ((b.lostT ??= {})[fid] ??= { inf: 0, mg: 0, art: 0, tank: 0, plane: 0 }).inf += lost;
  (b.raidT ??= {})[fid] = b.age;
  const nests = b.agents.filter(x => x.f !== fid && !x.dead && (x.type === 'pill' || x.type === 'bunk')).length;
  const ok = rnd(g) < Math.max(.3, .8 - .12 * nests);
  const target = fid === b.def ? (b.from >= 0 && b.from < g.regions.length ? b.from : -1) : b.region; // a beach front comes from a sea zone (>= 1000)
  if (ok) {
    for (const f of b.sides) if (f !== fid) b.mor[f] = Math.max(0, (b.mor[f] ?? 70) - 5);
    if (target >= 0 && g.regions[target].owner !== fid) recordIntel(g, fid, target);
  }
  emit(g, { k: 'raid', faction: fid, region: b.region, ok, target });
  return null;
}
