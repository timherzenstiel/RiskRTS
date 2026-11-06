// Supply income, convoys, supply lines, reinforcement of battered formations and war weariness.
import { corpsIn, deployOnConvoy, fixPosts } from './posts';
import { OVER, econSplit, loadRatio, replacements, train, woundedBack } from './supply';
import { CONT, CONT_KEYS } from '../data/regions';
import { nationOf } from '../data/nations';
import { DT, FORMATION, SHELLS, TICK_SECONDS, UNIT_TYPES } from '../data/units';
import { consolidate, controls, emit, rnd, updateContested, world } from './core';
import { moraleCap } from './battle';
import { spiesOnConvoy } from './fog';
import { linkQuality, railsOnConvoy } from './rails';
import { calendarTick, hasDoc } from './tech';
import { allied, diploConvoy } from './diplomacy';
import { weatherAt } from '../data/terrain';
import { ownsCont, checkElim, checkMissions } from './missions';
import { navyConvoy, seaLinks } from './navy';
import type { GameState } from './types';

export const DIFFICULTIES = [
  { name: 'Recruit', ai: 1.7, inc: .8, desc: 'Slow, cautious rivals' },
  { name: 'Officer', ai: 1, inc: 1, desc: 'A fair fight' },
  { name: 'Marshal', ai: .7, inc: 1.25, desc: 'Fast, well supplied rivals who see through the fog' },
] as const;

/** Base supply from land: diminishing returns, so the largest power does not snowball (1 land: 4, 9: 7, 25: 10, 54: 13). */
export const landIncome = (n: number) => n ? 2 + Math.round(1.5 * Math.sqrt(n)) : 0;
/** Share of income lost at full war weariness. */
export const WW_INCOME = .3;
/** War weariness above which barracks stop sending volunteers. */
export const WW_NO_VOLUNTEERS = 60;
/** Strength a cut-off garrison loses per convoy, and morale. */
export const CUT_WEAR = .08, CUT_MORALE = 10;
/** War weariness that fades per convoy (none under general mobilisation). */
export const WW_FADE = 1.5;

/** A bombed factory produces nothing until it is repaired. */
export const bombedNow = (g: GameState, r: GameState['regions'][number]) => (r.bombed ?? -1) > g.day;
/** Regions that pay: held, not contested, supplied and not on strike. */
const paying = (g: GameState, fid: number) => g.regions.filter(r => controls(r, fid) && !r.cut && !r.strike);

/** Production per week. Contested, cut-off and striking regions pay nothing; war weariness eats into the rest. */
export function income(g: GameState, fid: number): number {
  const mine = paying(g, fid), W = world();
  let v = Math.max(3, landIncome(mine.length));
  for (const k of CONT_KEYS) if (ownsCont(g, fid, k)) v += CONT[k].bonus;
  // factories: what the war economy lever does not send to the shell works
  v += 2 * econSplit(g.factions[fid]).prod * mine.filter(r => r.factory && !bombedNow(g, r)).length;
  if (hasDoc(g, fid, 'total')) v *= 1.3;
  if (nationOf(fid).flags.empire) v += mine.filter(r => W.regions[r.id].cont !== 'EU').length;
  const ww = g.factions[fid]?.ww ?? 0;
  return Math.max(1, Math.round(v * (1 - WW_INCOME * ww / 100)));
}

/** Shells per week: a base output, the share of every supplied factory the war economy lever gives them, and the capital. */
export function shellIncome(g: GameState, fid: number): number {
  const N = nationOf(fid), k = econSplit(g.factions[fid]).shells; let v = SHELLS.base;
  for (const r of paying(g, fid)) { if (r.factory && !bombedNow(g, r)) v += N.factoryShells * k; if (r.capitalOf === fid) v += SHELLS.capital; }
  const m = N.shells * (N.shellsUntil && g.day < N.shellsUntil[0] ? N.shellsUntil[1] : 1);
  return Math.max(1, Math.round(v * m));
}

/** Manpower: men per home region still held per convoy, the war-weariness cost of each mobilisation level, the starting pool. */
export const MANPOWER = { growth: 20, mobGrowth: .5, mobWW: .5, startMult: 3, strikeAfter: 5, riseAbove: 15, riseChance: .15 } as const;

/** Men a power's manpower pool grows by each convoy: a new age class from every home region it still holds. */
export function poolGrowth(g: GameState, fid: number): number {
  const N = nationOf(fid), f = g.factions[fid]; let n = 0;
  for (const r of g.regions) if (r.home === fid && controls(r, fid) && !r.strike) n++;
  let v = n * MANPOWER.growth * N.growth * (1 + MANPOWER.mobGrowth * (f?.mob ?? 0)) * (hasDoc(g, fid, 'mass') ? 1.5 : 1);
  if (N.growthUntil && g.day < N.growthUntil[0]) v *= N.growthUntil[1];
  return Math.round(v);
}

/** Hops from the capital (or the first held home region) over own and foreign land: how remote a region is. */
function remoteness(g: GameState, fid: number): Map<number, number> {
  const W = world(), d = new Map<number, number>();
  const start = g.regions.find(r => r.capitalOf === fid && r.owner === fid) ?? g.regions.find(r => r.owner === fid && r.home === fid);
  if (!start) return d;
  const q = [start.id]; d.set(start.id, 0);
  for (let h = 0; h < q.length; h++) for (const j of W.regions[q[h]].adj) if (!d.has(j)) { d.set(j, d.get(q[h])! + 1); q.push(j); }
  return d;
}

/**
 * Unrest: a power above its war-weariness threshold for several convoys sees strikes in its most remote home regions; far above it,
 * a striking region may rise and go over to the strongest neighbouring rival. Strikes end one by one when the weariness eases.
 */
function unrest(g: GameState, fid: number) {
  const f = g.factions[fid], thr = nationOf(fid).unrest;
  f.unrestT = f.ww >= thr ? (f.unrestT ?? 0) + 1 : Math.max(0, (f.unrestT ?? 0) - 1);
  const strikes = g.regions.filter(r => r.owner === fid && r.strike);
  if (f.ww < thr - 5 && strikes.length) { strikes[0].strike = false; emit(g, { k: 'strike', faction: fid, region: strikes[0].id, end: true }); return; }
  if (f.unrestT >= MANPOWER.strikeAfter && f.unrestT % MANPOWER.strikeAfter === 0) {
    const d = remoteness(g, fid);
    const c = g.regions.filter(r => r.owner === fid && r.home === fid && !r.strike && r.capitalOf !== fid && r.battle < 0).sort((a, b) => (d.get(b.id) ?? 0) - (d.get(a.id) ?? 0))[0];
    if (c) { c.strike = true; emit(g, { k: 'strike', faction: fid, region: c.id }); }
  }
  if (f.ww >= thr + MANPOWER.riseAbove) for (const r of strikes) if (r.battle < 0 && rnd(g) < MANPOWER.riseChance) rise(g, r);
}

/** A striking region rises: its garrison mutinies and it goes over to the strongest neighbouring rival. */
function rise(g: GameState, r: GameState['regions'][number]) {
  const W = world(), prev = r.owner, pw = new Map<number, number>();
  for (const j of W.regions[r.id].adj) { const n = g.regions[j]; if (n.owner !== prev && n.owner >= 0) pw.set(n.owner, (pw.get(n.owner) ?? 0) + 1 + n.units.inf + n.units.mg * 2 + n.units.art * 2); }
  const to = [...pw].sort((a, b) => b[1] - a[1])[0]?.[0]; if (to === undefined) return;
  for (const k of UNIT_TYPES) { r.units[k] = 0; r.men[k] = 0; }
  r.owner = to; r.strike = false; r.mor = 50; r.defs = []; r.contested = -1; r.stance = 0; r.cs = undefined; r.an = undefined;
  emit(g, { k: 'rising', faction: prev, region: r.id, to });
  updateSupplyLines(g); checkElim(g, prev, to); checkMissions(g);
}

/**
 * Supply lines: a region is supplied when an unbroken chain of the power's own regions (land borders or sea lanes between
 * two of its own regions) leads back to its capital, a factory region or its home territory. Recomputes `cut` for every region.
 */
export function updateSupplyLines(g: GameState, announce = false) {
  const W = world(), N = g.regions.length;
  const isSrc = (r: GameState['regions'][number]) => r.owner >= 0 && r.contested < 0 && (r.capitalOf === r.owner || r.factory || r.home === r.owner);
  // per power, two passes: over links of full quality (rails, hub-to-hub sea lanes) for full supply, then over any link for
  // thin supply. Supply lines may run through allied regions.
  const full = new Uint8Array(N), thin = new Uint8Array(N);
  const reach = (o: number, min: number, out: Uint8Array) => {
    const seen = new Uint8Array(N), q: number[] = [];
    for (const r of g.regions) if (r.owner === o && isSrc(r)) { seen[r.id] = 1; q.push(r.id); }
    // between the power's ports, over the sea (thin, full when it holds every zone on the way)
    const sea = new Map<number, [number, number][]>();
    for (const [a, b, ql] of seaLinks(g, o)) { (sea.get(a) ?? sea.set(a, []).get(a)!).push([b, ql]); (sea.get(b) ?? sea.set(b, []).get(b)!).push([a, ql]); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      for (const j of W.regions[i].adj) { const oj = g.regions[j].owner; if (!seen[j] && (oj === o || allied(g, o, oj)) && linkQuality(g, o, i, j) >= min) { seen[j] = 1; q.push(j); } }
      for (const [j, ql] of sea.get(i) ?? []) if (!seen[j] && ql >= min) { seen[j] = 1; q.push(j); }
    }
    for (let i = 0; i < N; i++) if (seen[i] && g.regions[i].owner === o) out[i] = 1;
  };
  for (const f of g.factions) { reach(f.id, 2, full); reach(f.id, 1, thin); }
  for (const r of g.regions) {
    r.supplyQ = r.owner < 0 ? 0 : full[r.id] ? 2 : thin[r.id] ? 1 : 0;
    const cut = r.owner >= 0 && !thin[r.id];
    if (cut && !r.cut && announce) emit(g, { k: 'cut', faction: r.owner, region: r.id });
    r.cut = cut;
  }
}

/** How fast a cut-off garrison wears down in the weather: winter twice as fast, heat half again (halved for those used to it). */
export function cutWear(g: GameState, r: GameState['regions'][number]) {
  const w = weatherAt(r.id, g.day), N = nationOf(r.owner);
  if (w === 2) return N.flags.siberian ? 1.5 : 2;
  if (w === 3) return N.flags.desert ? 1.25 : 1.5;
  return 1;
}

/** Share of a holdout's strength lost per convoy. */
export const HOLDOUT_WEAR = .065;

/** A convoy reaches every power at the same moment. */
export function supplyTick(g: GameState) {
  const prevDay = g.day; g.day += 7;
  railsOnConvoy(g);
  calendarTick(g, prevDay);
  diploConvoy(g);
  updateSupplyLines(g, true);
  const d = DIFFICULTIES[g.diff] ?? DIFFICULTIES[1];
  const age: number[] = [], back: number[] = [];
  for (const f of g.factions) {
    if (!f.alive) continue; const inc = income(g, f.id); f.supply += f.ai ? Math.round(inc * d.inc) : inc; f.shells = (f.shells ?? 0) + shellIncome(g, f.id);
    age[f.id] = poolGrowth(g, f.id); f.men = (f.men ?? 0) + age[f.id]; back[f.id] = woundedBack(g, f);
    f.ww = Math.min(100, f.ww + MANPOWER.mobWW * (f.mob ?? 0) + (hasDoc(g, f.id, 'total') ? 1 : 0));
  }
  // barracks volunteers: one battalion a week, through training like any recruit
  for (const r of g.regions) {
    const f = g.factions[r.owner];
    if (r.barracks && r.contested < 0 && !r.cut && !r.strike && f.alive && f.ww < WW_NO_VOLUNTEERS && f.men >= FORMATION.inf.men) { f.men -= FORMATION.inf.men; f.wk = f.wk ?? [0, 0, 0, 0]; f.wk[2] += FORMATION.inf.men; train(g, r, 'inf'); }
  }
  for (const f of g.factions) if (f.alive) unrest(g, f.id);
  for (const r of g.regions) {
    if (r.owner < 0 || r.battle >= 0) continue;
    if (r.cut) {
      // encircled: no food, no ammunition, no replacements
      const wear = CUT_WEAR * cutWear(g, r);
      for (const k of UNIT_TYPES) r.men[k] = Math.floor(r.men[k] * (1 - wear));
      for (const c of corpsIn(r)) { for (const k of UNIT_TYPES) c.m[k] = Math.floor(c.m[k] * (1 - wear)); c.mor = Math.max(0, c.mor - CUT_MORALE); }
      consolidate(r.units, r.men);
      r.mor = Math.max(0, r.mor - CUT_MORALE);
    } else {
      // over its supply capacity a region's troops go short: morale falls; far over, men fall sick and hungry
      const lr = loadRatio(g, r), over = lr > 1, cap = moraleCap(g, r.owner);
      const dm = (m: number) => over ? Math.max(0, m - OVER.morale) : Math.min(cap, m + 6);
      r.mor = dm(r.mor);
      for (const c of corpsIn(r)) c.mor = dm(c.mor);
      if (lr > OVER.far) {
        for (const k of UNIT_TYPES) r.men[k] = Math.floor(r.men[k] * (1 - OVER.farWear));
        for (const c of corpsIn(r)) for (const k of UNIT_TYPES) c.m[k] = Math.floor(c.m[k] * (1 - OVER.farWear));
        consolidate(r.units, r.men);
      }
    }
    fixPosts(g, r);
  }
  // replacements from the pool, and the ledger of the week
  for (const f of g.factions) {
    if (!f.alive) continue;
    const repl = replacements(g, f), wk = f.wk ?? [0, 0, 0, 0];
    f.led = [age[f.id] ?? 0, back[f.id] ?? 0, wk[2], repl]; f.wk = [0, 0, 0, 0];
  }
  // war weariness fades in quiet times, but not while the nation stays mobilised
  for (const f of g.factions) f.ww = Math.max(0, f.ww - WW_FADE * (1 - (f.mob ?? 0) / 2));
  // cut-off holdouts run short of ammunition and food: they wear down over about five minutes
  for (const r of g.regions) {
    if (r.contested < 0 || r.battle >= 0) continue;
    for (const d of r.defs) if (d.f !== r.owner) d.hp -= DT[d.k].hp * HOLDOUT_WEAR;
    r.defs = r.defs.filter(d => d.hp > 0); updateContested(r);
    if (r.contested < 0) emit(g, { k: 'cleared', region: r.id, faction: r.owner });
  }
  spiesOnConvoy(g);
  navyConvoy(g);
  deployOnConvoy(g);
  emit(g, { k: 'supply' });
  checkMissions(g);
}

export const convoyIn = (g: GameState) => Math.ceil(TICK_SECONDS - g.supplyT);
