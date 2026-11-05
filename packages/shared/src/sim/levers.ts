// Battle levers: the handful of decisions a commander makes per front while the battle fights itself.
// Barrage level, over the top, stance, reinforcing a front from a neighbouring region, and withdrawing.
import { SHELLS, groundUnits, isDef } from '../data/units';
import { MARCH_MIN, MARCH_SPEED, emit, mkArmy, world } from './core';
import { forceIn, goOverTheTop } from './battle';
import { formArmy } from './commands';
import { stanceIn } from './rules';
import type { Barrage, Battle, GameState, Stance } from './types';

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
  const a = formArmy(g, fid, from, b.region, frac); if (typeof a === 'string') return a;
  a.front = b.id; g.armies.push(a);
  emit(g, { k: 'march', faction: fid, from, to: b.region, units: groundUnits(a.units) });
  return null;
}

/** Pull your troops out of a front: attackers fall back over the border they came from, defenders to a neighbouring own region. */
export function withdraw(g: GameState, fid: number, bid: number): string | null {
  const b = live(g, bid); if (!b || !fights(b, fid)) return NOT_HERE;
  if (stanceIn(b, fid) === 3) return 'Your troops hold at all costs. Change their stance before ordering a retreat.';
  const f = forceIn(b, fid, false, g); if (groundUnits(f.u) <= 0) return 'None of your troops are left on this front.';
  const W = world(), adj = W.regions[b.region].adj.filter(j => g.regions[j].owner === fid && j !== b.region);
  if (!adj.length) return 'There is no region of yours next to this front to fall back to.';
  const score = (j: number) => (j === b.from ? 4 : 0) + (g.regions[j].cut ? 0 : 2) + (g.regions[j].battle < 0 ? 1 : 0);
  const dest = adj.sort((x, y) => score(y) - score(x))[0];
  for (const x of b.agents) if (x.f === fid && !x.dead && !x.out && !isDef(x.type) && x.type !== 'plane') x.out = true;
  const a = mkArmy(g, fid, b.region, dest, MARCH_SPEED, MARCH_MIN);
  a.units = f.u; a.men = f.m; a.mor = Math.max(0, f.mor - 10); a.tired = true; a.stance = stanceIn(b, fid);
  g.armies.push(a);
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
