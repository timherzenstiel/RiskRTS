// National character and manpower: national units, traits, the manpower pool, mobilisation, strikes and risings.
import { describe, it, expect } from 'vitest';
import {
  COST, DT, FORMATION, NATIONS, UNIT_TYPES, UT, applyCommand, applySnapshot, buildWorld, createGame, createMirror, dayOf, emptyUnits, fortCost, income,
  initMirrorCapitals, makeSnapshot, moraleCap, poolGrowth, run, shellIncome, statsOf, unitName, updateSupplyLines, type GameState,
} from '../src';

const W = buildWorld();
const id = (n: string) => W.byName[n].id;
const GB = 0, FR = 1, RU = 2, DE = 3, AH = 4, OT = 5;
function fill(g: GameState) { for (const r of g.regions) for (const k of UNIT_TYPES) r.men[k] = r.units[k] * FORMATION[k].men; }

describe('national units', () => {
  const g = createGame({ seed: 1, humans: [0, 1, 2, 3, 4, 5] });
  it('each power has a national variant with its own name and stats', () => {
    expect(NATIONS.length).toBe(6);
    expect(statsOf(g, FR, 'art').rof).toBeLessThan(UT.art.rof);          // Canon de 75 fires faster
    expect(statsOf(g, AH, 'art').rof).toBeGreaterThan(UT.art.rof);       // Škoda fires slower
    expect(statsOf(g, GB, 'tank').hp).toBeCloseTo(UT.tank.hp * 1.2);     // Mark IV
    expect(statsOf(g, DE, 'art').rof).toBe(UT.art.rof);
    expect(unitName(g, FR, 'art')).toMatch(/75/); expect(unitName(g, DE, 'art')).toBe(UT.art.name);
  });
  it('storm battalions only take the field in 1917', () => {
    const h = createGame({ seed: 1, humans: [0] });
    expect(statsOf(h, DE, 'inf').speed).toBe(UT.inf.speed); expect(unitName(h, DE, 'inf')).toBe(UT.inf.name);
    h.day = dayOf(1917, 2);
    expect(statsOf(h, DE, 'inf').speed).toBeCloseTo(UT.inf.speed * 1.25); expect(unitName(h, DE, 'inf')).toMatch(/Storm/);
  });
});

describe('national traits', () => {
  it('Britain starts small, the Ottomans dug in, Russia with a vast pool', () => {
    const g = createGame({ seed: 4, humans: [] });
    expect(g.regions.find(r => r.capitalOf === GB)!.units.inf).toBe(5);
    expect(g.regions.find(r => r.capitalOf === FR)!.units.inf).toBe(6);
    const ot = g.regions.filter(r => r.owner === OT && r.capitalOf < 0);
    for (const r of ot) for (const n of W.regions[r.id].adj) if (!W.seaLane.has(r.id + '|' + n)) expect(r.works[n]?.tr ?? 0).toBeGreaterThanOrEqual(2);
    const perMan = (f: number) => { let m = 0; for (const r of g.regions) if (r.owner === f) for (const k of UNIT_TYPES) m += r.men[k]; return g.factions[f].men / m; };
    expect(perMan(RU)).toBeCloseTo(perMan(FR) * 1.6, 1);
  });
  it('morale ceilings, fortress belt, weak industry, empire income, Krupp and the shell crisis', () => {
    const g = createGame({ seed: 4, humans: [] });
    expect(moraleCap(g, RU)).toBe(90); expect(moraleCap(g, AH)).toBe(90); expect(moraleCap(g, DE)).toBe(100);
    const fr = g.regions.find(r => r.owner === FR && r.home === FR)!;
    expect(fortCost(fr, 'bunk', -1)).toBeLessThan(COST.bunk); expect(fortCost(fr, 'pill', -1)).toBe(COST.pill);
    const ot = g.regions.find(r => r.owner === OT && !r.factory)!; g.factions[OT].supply = COST.factory + 1;
    expect(applyCommand(g, OT, { t: 'build', region: ot.id, kind: 'factory' })).toMatch(/Not enough/);
    const gbOut = g.regions.filter(r => r.owner === GB && !r.cut && W.regions[r.id].cont !== 'EU').length;
    const before = income(g, GB); for (const r of g.regions) if (r.owner === GB && W.regions[r.id].cont !== 'EU') r.strike = true;
    expect(before - income(g, GB)).toBeGreaterThanOrEqual(gbOut);
    for (const f of [RU, DE]) for (const r of g.regions) if (r.owner === f) r.factory = false;
    expect(shellIncome(g, DE)).toBeGreaterThan(shellIncome(g, RU));
    g.day = dayOf(1916, 2); expect(shellIncome(g, RU)).toBeGreaterThanOrEqual(3);
  });
});

describe('manpower', () => {
  it('recruiting draws men from the pool; an empty pool stops it', () => {
    const g = createGame({ seed: 5, humans: [0] }); const r = g.regions.find(x => x.capitalOf === 0)!;
    const m0 = g.factions[0].men; g.factions[0].supply = 50;
    expect(applyCommand(g, 0, { t: 'recruit', region: r.id, unit: 'inf', n: 2 })).toBeNull();
    expect(g.factions[0].men).toBe(m0 - 200);
    g.factions[0].men = 50;
    expect(applyCommand(g, 0, { t: 'recruit', region: r.id, unit: 'inf' })).toMatch(/manpower/);
    g.day = dayOf(1918, 6);
    expect(applyCommand(g, 0, { t: 'recruit', region: r.id, unit: 'tank' })).toBeNull(); // a tank platoon is only 25 men
    expect(g.factions[0].men).toBe(25);
  });
  it('the pool grows with every home region held, faster when mobilised; mobilisation keeps weariness from fading', () => {
    const g = createGame({ seed: 5, humans: [0, 1, 2, 3, 4, 5] });
    const base = poolGrowth(g, FR); expect(base).toBe(Math.round(g.regions.filter(r => r.home === FR && r.owner === FR).length * 20 * NATIONS[FR].growth));
    expect(applyCommand(g, FR, { t: 'mobilise', level: 2 })).toBeNull();
    expect(poolGrowth(g, FR)).toBe(Math.round(base * 2));
    expect(poolGrowth(g, GB)).toBeLessThan(g.regions.filter(r => r.home === GB && r.owner === GB).length * 20); // volunteers until 1916
    g.factions[FR].ww = 20; g.factions[DE].ww = 20; run(g, 20.1);
    expect(g.factions[FR].ww).toBeGreaterThan(20); expect(g.factions[DE].ww).toBeLessThan(20);
  });
  it('long war weariness above the threshold brings strikes, then risings', () => {
    const g = createGame({ seed: 6, humans: [0, 1, 2, 3, 4, 5] });
    g.factions.forEach(f => { f.mission = null; });
    g.factions[RU].ww = 85; g.factions[RU].mob = 2;
    run(g, 20 * 5 + .1);
    const strikes = g.regions.filter(r => r.owner === RU && r.strike);
    expect(strikes.length).toBe(1);
    expect(applyCommand(g, RU, { t: 'recruit', region: strikes[0].id, unit: 'inf' })).toMatch(/strike/);
    g.factions[RU].ww = 99; const owned = g.regions.filter(r => r.owner === RU).length;
    run(g, 20 * 30);
    expect(g.regions.filter(r => r.owner === RU).length).toBeLessThan(owned);
    g.factions[RU].ww = 10; g.factions[RU].mob = 0; run(g, 20 * 12);
    expect(g.regions.filter(r => r.owner === RU && r.strike).length).toBe(0);
  });
  it('snapshots carry the pool, mobilisation and strikes', () => {
    const g = createGame({ seed: 5, humans: [0] }); g.factions[0].mob = 1; const r = g.regions.find(x => x.owner === 0 && x.capitalOf < 0)!; r.strike = true;
    const m = createMirror(); initMirrorCapitals(m); applySnapshot(m, makeSnapshot(g, 0));
    expect(m.factions[0].men).toBe(g.factions[0].men); expect(m.factions[0].mob).toBe(1); expect(m.regions[r.id].strike).toBe(true);
  });
});

describe('national damage', () => {
  it('Škoda howitzers break defences faster than other guns', () => {
    const hit = (f: number) => {
      const g = createGame({ seed: 9, humans: [0, 1, 2, 3, 4, 5], settings: { attackCap: 0, pace: 1 } });
      for (const r of g.regions) { r.units = emptyUnits(); r.men = emptyUnits(); r.defs = []; r.works = {}; r.owner = 2; r.home = 2; r.capitalOf = -1; }
      const A = id('Austria-Hungary'), B = id('Italy'); g.regions[A].owner = f; g.regions[B].owner = 1;
      g.regions[A].units = { ...emptyUnits(), inf: 3, art: 3 }; g.regions[B].defs = [{ id: 900, k: 'bunk', s: A, hp: DT.bunk.hp, f: 1 }]; g.regions[B].units.inf = 1; fill(g);
      g.factions.forEach(x => { x.mission = null; x.shells = 300; }); updateSupplyLines(g);
      applyCommand(g, f, { t: 'march', from: A, to: B, frac: 1 }); run(g, 50);
      const b = g.battles.find(x => x.region === B)!; const bunk = b.agents.find(a => a.type === 'bunk')!;
      return DT.bunk.hp - Math.max(0, bunk.hp);
    };
    expect(hit(AH)).toBeGreaterThan(hit(DE) * 1.3);
  });
});
