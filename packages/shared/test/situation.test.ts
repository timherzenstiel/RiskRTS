// Border balance (what a power has on a border against what it knows is across) and the breakdowns of national numbers.
import { describe, it, expect } from 'vitest';
import { setCs } from './helpers';
import {
  FORMATION, UNIT_TYPES, borderBalance, buildWorld, createGame, dayOf, emptyUnits, fogView, hostileBorders, income, incomeTerms, poolGrowth, poolTerms,
  shellIncome, shellTerms, updateSupplyLines, type GameState,
} from '../src';

const W = buildWorld();
const id = (n: string) => W.byName[n].id;
function setup() {
  const g = createGame({ seed: 5, humans: [0, 1, 2, 3, 4, 5, 6], settings: { attackCap: 0, pace: 1 } });
  for (const r of g.regions) { r.units = emptyUnits(); r.men = emptyUnits(); r.cs = undefined; r.defs = []; r.works = {}; r.owner = 2; r.home = 2; r.cs = undefined; r.deploy = 1; }
  const A = id('France'), B = id('Germany');
  g.regions[A].owner = 0; g.regions[A].home = 0; g.regions[B].owner = 1; g.regions[B].home = 1;
  g.armies = []; g.fleets = []; g.treaties = [];
  g.day = dayOf(1916, 6);
  updateSupplyLines(g);
  return { g, A, B };
}
const fill = (g: GameState) => { for (const r of g.regions) for (const k of UNIT_TYPES) r.men[k] = r.units[k] * FORMATION[k].men; };

describe('border balance', () => {
  it('counts the corps on the border and the works, and estimates the corps across', () => {
    const { g, A, B } = setup();
    g.regions[A].units.inf = 12; setCs(g, A, [[B, { inf: 10 }, { n: 1 }]]);
    g.regions[A].works[B] = { tr: 2, sand: 0, wire: 1 };
    g.regions[B].units.inf = 8; setCs(g, B, [[A, { inf: 8 }, { n: 1 }]]);
    fill(g);
    const v = fogView(g, 0), b = borderBalance(v, A, B);
    expect(b.own.btl).toEqual([10, 10]);
    expect(b.own.trench).toBe(2);
    expect(b.know).toBe(1);
    // an estimate is a range around the 8 battalions across
    expect(b.their.btl[0]).toBeLessThanOrEqual(8); expect(b.their.btl[1]).toBeGreaterThanOrEqual(8);
    expect(b.ratio).not.toBeNull(); expect(b.danger).toBe(0);
  });

  it('flags danger when the enemy is much stronger or assembling an attack', () => {
    const { g, A, B } = setup();
    g.regions[A].units.inf = 2; setCs(g, A, [[B, { inf: 2 }, { n: 1 }]]);
    g.regions[B].units.inf = 20; setCs(g, B, [[A, { inf: 20 }, { n: 1 }]]);
    fill(g);
    expect(borderBalance(fogView(g, 0), A, B).danger).toBe(3);
    g.regions[A].units.inf = 30; setCs(g, A, [[B, { inf: 30 }, { n: 1 }]]); Object.assign(g.regions[B].cs![0], { ord: 2, ready: g.time + 10 }); fill(g);
    const b = borderBalance(fogView(g, 0), A, B);
    expect(b.massing).toBe(true);
  });

  it('knows nothing of a region it cannot see', () => {
    const { g, A } = setup();
    const far = id('Japan'), v = fogView(g, 0);
    expect(borderBalance(v, A, W.regions[A].land[0]).know).toBeGreaterThanOrEqual(1);
    expect(v.regions[far].vis).toBe(0);
  });

  it('lists only borders with powers at war', () => {
    const { g, A, B } = setup();
    const n = hostileBorders(fogView(g, 0), 0).filter(b => b.nb === B).length;
    expect(n).toBe(1);
    g.treaties = [{ a: 0, b: 1, kind: 'nap' }];
    expect(hostileBorders(fogView(g, 0), 0).some(b => b.nb === B)).toBe(false);
  });
});

describe('breakdowns', () => {
  it('add up to the totals', () => {
    const g = createGame({ seed: 9, humans: [0, 1, 2, 3, 4, 5, 6] });
    for (const f of g.factions) {
      f.ww = 37; f.mob = 1;
      const sum = (t: { v: number }[]) => Math.round(t.reduce((s, x) => s + x.v, 0) * 10) / 10;
      expect(sum(incomeTerms(g, f.id))).toBeCloseTo(income(g, f.id), 1);
      expect(sum(shellTerms(g, f.id))).toBeCloseTo(shellIncome(g, f.id), 1);
      expect(sum(poolTerms(g, f.id))).toBeCloseTo(poolGrowth(g, f.id), 1);
    }
  });
});
