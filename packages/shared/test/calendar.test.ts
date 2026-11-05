// The war calendar: unlocks by date, national tank dates, rushes, yearly doctrines and their effects.
import { describe, it, expect } from 'vitest';
import {
  DOCTRINE_TIME, FORMATION, RUSH, TRENCH_COST, UNIT_TYPES, UT, applyCommand, applySnapshot, buildWorld, createGame, createMirror, dayOf, doctrinesOf, emptyUnits,
  fortCost, income, initMirrorCapitals, makeSnapshot, poolGrowth, run, statsOf, techOn, unitCost, updateSupplyLines, type GameState,
} from '../src';

const W = buildWorld(); const id = (n: string) => W.byName[n].id;
const GB = 0, FR = 1, RU = 2, DE = 3;
function fill(g: GameState) { for (const r of g.regions) for (const k of UNIT_TYPES) r.men[k] = r.units[k] * FORMATION[k].men; }

describe('unlocks', () => {
  it('the opening is infantry, MGs and guns; aircraft come in spring 1915, tanks by nation', () => {
    const g = createGame({ seed: 2, humans: [0, 1, 2, 3, 4, 5] }); const cap = g.regions.find(r => r.capitalOf === GB)!;
    g.factions[GB].supply = 99;
    expect(applyCommand(g, GB, { t: 'build', region: cap.id, kind: 'airfield' })).toMatch(/Mar 1915/);
    expect(applyCommand(g, GB, { t: 'fortify', region: cap.id, kind: 'bunk', sector: -1 })).toMatch(/1916/);
    expect(applyCommand(g, GB, { t: 'recruit', region: cap.id, unit: 'tank' })).toMatch(/Sep 1916/);
    g.day = dayOf(1915, 3, 2);
    expect(applyCommand(g, GB, { t: 'build', region: cap.id, kind: 'airfield' })).toBeNull();
    g.day = dayOf(1916, 9, 2);
    expect(techOn(g, GB, 'tank')).toBe(true); expect(techOn(g, FR, 'tank')).toBe(false); expect(techOn(g, DE, 'tank')).toBe(false);
    g.day = dayOf(1917, 4, 2); expect(techOn(g, FR, 'tank')).toBe(true); expect(techOn(g, DE, 'tank')).toBe(false);
    g.day = dayOf(1918, 3, 2); expect(techOn(g, DE, 'tank')).toBe(true);
    expect(statsOf(g, FR, 'tank').hp).toBeCloseTo(UT.tank.hp * 1.3); // better tanks from 1917
  });
  it('a rush brings one unlock forward by six months, once a year', () => {
    const g = createGame({ seed: 2, humans: [0] }); g.factions[0].supply = 100; g.day = dayOf(1914, 10);
    expect(applyCommand(g, 0, { t: 'rush', tech: 'air' })).toBeNull();
    expect(g.factions[0].supply).toBe(100 - RUSH.cost); expect(techOn(g, 0, 'air')).toBe(true);
    expect(applyCommand(g, 0, { t: 'rush', tech: 'trench2' })).toMatch(/already rushed/);
    g.day = dayOf(1915, 1, 10); expect(applyCommand(g, 0, { t: 'rush', tech: 'tank' })).toBeNull();
    g.day = dayOf(1916, 3, 10); expect(techOn(g, 0, 'tank')).toBe(true);
  });
});

describe('doctrines', () => {
  it('every war year each power picks one of three; the War Office picks for the idle', () => {
    const g = createGame({ seed: 3, humans: [0] }); g.factions.forEach(f => { f.mission = null; });
    g.day = dayOf(1914, 12, 28); run(g, 20.1);
    expect(g.factions[0].docOffer).toBe(1915);
    expect(g.factions[3].doctrines?.length).toBe(1); // computers choose at once
    expect(applyCommand(g, 0, { t: 'doctrine', doc: 'tankcorps' })).toMatch(/not on offer/);
    expect(applyCommand(g, 0, { t: 'doctrine', doc: 'mass' })).toBeNull(); expect(g.factions[0].doctrines).toEqual(['mass']);
    g.day = dayOf(1915, 12, 28); run(g, 20); expect(g.factions[0].docOffer).toBe(1916);
    run(g, DOCTRINE_TIME + 1); expect(g.factions[0].docOffer).toBeUndefined();
    expect(doctrinesOf(1916).map(d => d.key)).toContain(g.factions[0].doctrines![1]);
  });
  it('doctrines change the rules', () => {
    const g = createGame({ seed: 3, humans: [0, 1, 2, 3, 4, 5] }); g.day = dayOf(1918, 6);
    const base = { pool: poolGrowth(g, RU), tank: unitCost(g, GB, 'tank'), inc: income(g, FR), inf: statsOf(g, RU, 'inf').speed };
    g.factions[RU].doctrines = ['mass', 'infiltration']; g.factions[GB].doctrines = ['tankcorps']; g.factions[FR].doctrines = ['total'];
    expect(poolGrowth(g, RU)).toBeCloseTo(base.pool * 1.5, -1); expect(unitCost(g, GB, 'tank')).toBeLessThan(base.tank);
    expect(income(g, FR)).toBeGreaterThan(base.inc); expect(statsOf(g, RU, 'inf').speed).toBeCloseTo(base.inf * 1.15);
    const r = g.regions.find(x => x.owner === DE)!; const n = W.regions[r.id].adj.find(j => !W.seaLane.has(r.id + '|' + j))!; r.works[n] = { tr: 0, sand: 0, wire: 0 };
    const t0 = fortCost(r, 'trench', n, g)!; g.factions[DE].doctrines = ['depth']; expect(fortCost(r, 'trench', n, g)!).toBeLessThan(t0); expect(t0).toBe(TRENCH_COST[0]);
  });
  it('elastic defence pulls breaking defenders back once', () => {
    const g = createGame({ seed: 8, humans: [0, 1, 2, 3, 4, 5], settings: { attackCap: 0, pace: 1 } }); g.day = dayOf(1918, 6);
    for (const r of g.regions) { r.units = emptyUnits(); r.men = emptyUnits(); r.defs = []; r.works = {}; r.owner = 2; r.home = 2; r.capitalOf = -1; r.factory = false; }
    g.factions.forEach(f => { f.mission = null; }); g.factions[1].doctrines = ['elastic'];
    const A = id('France'), B = id('Germany'); g.regions[A].owner = 0; g.regions[B].owner = 1;
    g.regions[A].units = { ...emptyUnits(), inf: 16 }; g.regions[B].units = { ...emptyUnits(), inf: 5 }; fill(g); updateSupplyLines(g);
    applyCommand(g, 0, { t: 'march', from: A, to: B, frac: 1 }); let fell = false;
    for (let i = 0; i < 20 * 200; i++) { run(g, .05); if (g.events.some(e => e.k === 'fallback')) fell = true; g.events.length = 0; if (g.battles.every(b => b.ended) && g.battles.length) break; }
    expect(fell).toBe(true);
  });
  it('snapshots carry doctrines and the open choice', () => {
    const g = createGame({ seed: 5, humans: [0] }); g.factions[0].doctrines = ['mass']; g.factions[0].docOffer = 1916; g.factions[0].docDue = 99; g.factions[3].doctrines = ['artillery'];
    const m = createMirror(); initMirrorCapitals(m); applySnapshot(m, makeSnapshot(g, 0));
    expect(m.factions[0].docOffer).toBe(1916); expect(m.factions[3].doctrines).toEqual(['artillery']);
  });
});
