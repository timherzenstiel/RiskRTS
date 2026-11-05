// Rails, supply quality, sea lanes and blockade, weather and mountain borders.
import { describe, it, expect } from 'vitest';
import {
  FORMATION, RAIL_BUILD, RAIL_LINKS, UNIT_TYPES, applyCommand, applySnapshot, buildWorld, createGame, createMirror, dayOf, emptyUnits, fortCost, frontsOf, hasRail,
  initMirrorCapitals, isMountain, makeSnapshot, railOpen, run, step, updateSupplyLines, weatherAt, COST, type GameState,
} from '../src';

const W = buildWorld();
const id = (n: string) => W.byName[n].id;
function fill(g: GameState) { for (const r of g.regions) for (const k of UNIT_TYPES) r.men[k] = r.units[k] * FORMATION[k].men; }
/** Everything belongs to power 2 except what a test hands out. */
function blank(seed = 3) {
  const g = createGame({ seed, humans: [0, 1, 2, 3, 4, 5], settings: { attackCap: 0, pace: 1 } });
  for (const r of g.regions) { r.units = emptyUnits(); r.men = emptyUnits(); r.defs = []; r.works = {}; r.owner = 2; r.home = 2; r.factory = false; r.capitalOf = -1; }
  g.factions.forEach(f => { f.mission = null; f.supply = 100; f.shells = 200; });
  return g;
}

describe('rail network', () => {
  it('every rail link joins two land neighbours (or a train ferry)', () => {
    for (const [a, b] of RAIL_LINKS) { expect(W.byName[a], a).toBeTruthy(); expect(W.regions[id(a)].adj).toContain(id(b)); }
    const g = blank(); expect(hasRail(g, id('Germany'), id('Austria-Hungary'))).toBe(true); expect(hasRail(g, id('Anatolia'), id('Mesopotamia'))).toBe(false);
  });
  it('marches between own regions by rail are three times as fast (Germany four in Europe)', () => {
    const t = (f: number, a: string, b: string) => {
      const g = blank(); g.day = dayOf(1915, 5); g.regions[id(a)].owner = f; g.regions[id(b)].owner = f; g.regions[id(a)].units.inf = 4; fill(g);
      applyCommand(g, f, { t: 'march', from: id(a), to: id(b), frac: .5 }); return g.armies[0];
    };
    const fr = t(1, 'France', 'Iberia'), de = t(3, 'France', 'Iberia');
    expect(fr.rail).toBe(true);
    const g = blank(); g.day = dayOf(1915, 5); g.regions[id('France')].owner = 1; g.regions[id('Iberia')].owner = 0; g.regions[id('France')].units.inf = 4; fill(g);
    applyCommand(g, 1, { t: 'march', from: id('France'), to: id('Iberia'), frac: .5 }); const foot = g.armies[0];
    expect(foot.rail).toBeFalsy(); expect(fr.dur).toBeLessThan(foot.dur / 2.5); expect(de.dur).toBeLessThan(fr.dur);
  });
  it('supply over rails is full, over land only thin, and the region falls back when the line is cut', () => {
    const g = blank(); const D = id('Germany'), A = id('Austria-Hungary'), I = id('Italy');
    for (const n of [D, A, I]) g.regions[n].owner = 1; g.regions[D].capitalOf = 1; g.regions[D].home = 1;
    updateSupplyLines(g);
    expect(g.regions[A].supplyQ).toBe(2); expect(g.regions[I].supplyQ).toBe(2);
    g.railCut[`${Math.min(D, I)}|${Math.max(D, I)}`] = g.day + 14; g.railCut[`${Math.min(A, I)}|${Math.max(A, I)}`] = g.day + 14;
    updateSupplyLines(g); expect(g.regions[I].supplyQ).toBe(1); expect(g.regions[I].cut).toBe(false);
  });
  it('a power can lay a new line in three convoys', () => {
    const g = blank(); const P = id('Persia'), M = id('Mesopotamia'); g.regions[P].owner = 0; g.regions[M].owner = 0;
    expect(applyCommand(g, 0, { t: 'rail', region: P, to: M })).toBeNull(); expect(g.factions[0].supply).toBe(100 - RAIL_BUILD.cost);
    expect(hasRail(g, P, M)).toBe(false); run(g, 20 * 3 + .1); expect(hasRail(g, P, M)).toBe(true);
    expect(applyCommand(g, 0, { t: 'rail', region: P, to: M })).toMatch(/already/);
  });
  it('spies and bombers cut rail links for a while', () => {
    const g = blank(); const D = id('Germany'), P = id('Poland'), F = id('France');
    g.regions[F].owner = 0; g.regions[F].capitalOf = 0; g.regions[D].owner = 1; g.regions[P].owner = 1; fill(g);
    g.spies.push({ id: 999, f: 0, region: D, eta: 0 });
    expect(applyCommand(g, 0, { t: 'sabotage', region: D, to: P })).toBeNull();
    expect(railOpen(g, D, P)).toBe(false); expect(g.spies[0].hot).toBeGreaterThan(g.day);
    g.regions[F].units.plane = 3; g.regions[F].airfield = true; fill(g);
    expect(applyCommand(g, 0, { t: 'air', from: F, to: D, frac: 1, rail: true })).toMatch(/not available/); g.day = dayOf(1917, 6);
    expect(applyCommand(g, 0, { t: 'air', from: F, to: D, frac: 1, rail: true })).toBeNull();
    run(g, 8); expect(railOpen(g, D, id('Austria-Hungary'))).toBe(false);
    run(g, 20 * 4); expect(railOpen(g, D, P)).toBe(true);
  });
});

describe('sea lanes and blockade', () => {
  it('sea lanes are thin unless both ends are hubs; the Royal Navy keeps its own full and thins enemy lanes nearby', () => {
    const g = blank(); const S = id('Scandinavia'), D = id('Germany'), B = id('Britain');
    g.regions[D].owner = 3; g.regions[D].capitalOf = 3; g.regions[S].owner = 3; g.regions[B].owner = 0; g.regions[B].capitalOf = 0;
    g.regions[id('Iceland')].owner = 0; g.regions[id('France')].owner = 0;
    updateSupplyLines(g);
    expect(g.regions[S].supplyQ).toBe(0); // Germany is blockaded, and Britain sits next to the lane
    expect(g.regions[id('Iceland')].supplyQ).toBe(2); expect(g.regions[id('France')].supplyQ).toBe(2);
  });
});

describe('weather and terrain', () => {
  it('mud in the European autumn, winter in the east, heat in the desert summer', () => {
    expect(weatherAt(id('France'), dayOf(1914, 10, 15))).toBe(1);
    expect(weatherAt(id('Poland'), dayOf(1915, 1, 15))).toBe(2);
    expect(weatherAt(id('Arabia'), dayOf(1915, 7, 15))).toBe(3);
    expect(weatherAt(id('France'), dayOf(1915, 6, 15))).toBe(0);
  });
  it('marches through mud and snow are slower, less so for Russians in winter', () => {
    const t = (f: number, day: number) => {
      const g = blank(); g.day = day; g.regions[id('Poland')].owner = f; g.regions[id('Ukraine')].owner = 9 % 6 === f ? 1 : 4; g.regions[id('Poland')].units.inf = 4; fill(g);
      applyCommand(g, f, { t: 'march', from: id('Poland'), to: id('Ukraine'), frac: .5 }); return g.armies[0].dur;
    };
    const summer = t(3, dayOf(1915, 6)), winter = t(3, dayOf(1916, 1, 10)), ru = t(2, dayOf(1916, 1, 10));
    expect(winter).toBeCloseTo(summer * 1.4); expect(ru).toBeCloseTo(summer * 1.2);
  });
  it('mountain borders favour the defender, and Austria-Hungary digs in cheaper there', () => {
    expect(isMountain(id('Italy'), id('Austria-Hungary'))).toBe(true); expect(isMountain(id('France'), id('Germany'))).toBe(false);
    const fight = (from: string, seed: number) => {
      const g = blank(seed); const T = id('Austria-Hungary'), A = id(from); g.day = dayOf(1915, 6);
      g.regions[A].owner = 1; g.regions[T].owner = 3; g.regions[A].units = { ...emptyUnits(), inf: 10 }; g.regions[T].units = { ...emptyUnits(), inf: 5 }; fill(g); updateSupplyLines(g);
      applyCommand(g, 1, { t: 'march', from: A, to: T, frac: 1 }); for (let i = 0; i < 20 * 30 && !frontsOf(g, T).length; i++) step(g, .05);
      const b = frontsOf(g, T)[0]; run(g, 25); return b.lost[3] ?? 0;
    };
    const sum = (from: string) => [11, 12, 13].reduce((s, k) => s + fight(from, k), 0);
    expect(sum('Italy')).toBeLessThan(sum('Germany') * .92);
    const g = blank(); const r = g.regions[id('Austria-Hungary')]; r.owner = 4; expect(fortCost(r, 'pill', -1)).toBeLessThan(COST.pill);
  });
  it('snapshots carry supply quality and the rail state', () => {
    const g = createGame({ seed: 5, humans: [0] }); const k = Object.keys(g.railCut); void k; g.railCut['1|2'] = 99; g.railNew.push([3, 4, 50]);
    const m = createMirror(); initMirrorCapitals(m); applySnapshot(m, makeSnapshot(g, 0));
    const own = g.regions.find(r => r.owner === 0)!; expect(m.regions[own.id].supplyQ).toBe(own.supplyQ);
    expect(m.railCut['1|2']).toBe(99); expect(m.railNew.length).toBe(1);
  });
});
