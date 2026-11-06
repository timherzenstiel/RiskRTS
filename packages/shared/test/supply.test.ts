// Phase 5 of the command overhaul: supply capacity and load, why a region is cut off, recruits training for a week and
// emergency levies, replacements from the pool, wounded back to the pool after two weeks, the war economy lever.
import { describe, it, expect } from 'vitest';
import {
  CAP, DRAW, FORMATION, OVER, REPL, TICK_SECONDS, UNIT_TYPES, WOUNDED, applyCommand, applySnapshot, buildWorld, capTerms, capacity, createGame,
  createMirror, cutBreak, emptyUnits, income, initMirrorCapitals, ledger, load, loadRatio, makeSnapshot, replWanted, run,
  shellIncome, shotCost, step, supplyTick, unitCost, updateSupplyLines, weatherAt, woundedIn, type GameState,
} from '../src';
import { openFront, setCs } from './helpers';

const W = buildWorld();
const id = (n: string) => W.byName[n].id;
const fill = (g: GameState) => { for (const r of g.regions) for (const k of UNIT_TYPES) r.men[k] = r.units[k] * FORMATION[k].men; };
/** France (0) against Germany (1); everything else belongs to power 2 and is empty; no depots, no harbours. */
function setup() {
  const g = createGame({ seed: 4, humans: [0, 1, 2, 3, 4, 5, 6], settings: { attackCap: 0, pace: 0 } });
  for (const r of g.regions) { r.units = emptyUnits(); r.men = emptyUnits(); r.cs = undefined; r.defs = []; r.works = {}; r.owner = 2; r.home = 2; r.factory = false; r.capitalOf = -1; r.barracks = false; r.port = false; r.train = undefined; }
  const A = id('France'), B = id('Germany');
  g.regions[A].owner = 0; g.regions[A].home = 0; g.regions[B].owner = 1; g.regions[B].home = 1;
  g.factions.forEach(f => { f.supply = 100; f.mission = null; f.shells = 300; f.men = 5000; f.wq = []; f.wounded = 0; });
  g.fleets = []; g.day = 200; // early summer: no mud, no winter
  updateSupplyLines(g);
  return { g, A, B };
}

describe('supply capacity', () => {
  it('rail, road and cut off; depots and rail links add to it; mud takes some away', () => {
    const { g, A } = setup(), r = g.regions[A];
    r.supplyQ = 2; expect(capTerms(g, r).terms[0]).toEqual({ k: 'route', v: CAP.rail });
    r.supplyQ = 1; expect(capacity(g, r)).toBe(CAP.road);
    r.factory = true; r.capitalOf = 0; expect(capacity(g, r)).toBe(CAP.road + 2 * CAP.depot);
    r.cut = true; expect(capacity(g, r)).toBe(0);
    r.cut = false; r.factory = false; r.capitalOf = -1;
    // autumn in Europe: mud
    const d0 = g.day; g.day = 0; while (weatherAt(A, g.day) !== 1) g.day += 7; const mud = capTerms(g, r).terms.find(t => t.k === 'weather');
    expect(mud?.w).toBe(1); expect(mud!.v).toBe(-Math.round(CAP.road * .2)); g.day = d0;
  });

  it('load is the draw of every battalion; over capacity, morale falls and no replacements come', () => {
    const { g, A, B } = setup(), r = g.regions[A]; r.deploy = 1;
    r.units.inf = 20; r.units.art = 4; fill(g);
    expect(load(g, r)).toBe(20 * DRAW.inf + 4 * DRAW.art);
    expect(loadRatio(g, r)).toBeCloseTo(28 / CAP.rail);
    const [c] = setCs(g, A, [[B, { inf: 20, art: 4 }, { mor: 60 }]]); c.m.inf -= 200; r.men.inf -= 200;
    const men0 = c.m.inf; supplyTick(g);
    expect(c.mor).toBe(60 - OVER.morale); expect(c.m.inf).toBe(men0);
    expect(replWanted(g, 0)).toBe(0);
  });

  it('far over capacity, the men fall sick; under it, morale recovers', () => {
    const { g, A, B } = setup(), r = g.regions[A]; r.deploy = 1;
    r.units.inf = 40; fill(g); const [c] = setCs(g, A, [[B, { inf: 20 }, { mor: 60 }], [B, { inf: 20 }, { mor: 60 }]]);
    supplyTick(g); expect(c.m.inf).toBe(Math.floor(20 * FORMATION.inf.men * (1 - OVER.farWear)));
    r.units.inf = 4; r.men.inf = 400; setCs(g, A, [[B, { inf: 4 }, { mor: 60 }]]); supplyTick(g);
    expect(r.cs![0].mor).toBe(66);
  });

  it('a side drawing shells through a region over capacity pays half again per shot', () => {
    const { g, A, B } = setup(), r = g.regions[A];
    r.units.inf = 30; fill(g);
    const b = openFront(g, 0, A, B, .5);
    const atk = shotCost(b, 0, g); r.units.inf = 1; r.men.inf = 100; r.cs = undefined;
    for (const a of b.agents) if (a.f === 0) a.dead = true;
    expect(atk).toBeCloseTo(shotCost(b, 0, g) * OVER.shells);
  });

  it('names the region where a cut-off pocket was broken', () => {
    const { g, A, B } = setup();
    // France holds Germany's neighbour Poland; Germany cuts it off
    const P = id('Poland'); g.regions[P].owner = 0; g.regions[P].home = 1;
    for (const j of W.regions[P].adj) if (j !== B && g.regions[j].owner !== 0) g.regions[j].owner = 1;
    updateSupplyLines(g);
    expect(g.regions[P].cut).toBe(true);
    expect(W.regions[P].adj).toContain(cutBreak(g, g.regions[P]));
    expect(cutBreak(g, g.regions[A])).toBe(-1);
  });
});

describe('manpower flow', () => {
  it('recruits train for a week; with barracks they are ready at the next convoy', () => {
    const { g, A } = setup(), r = g.regions[A];
    g.supplyT = 5;
    expect(applyCommand(g, 0, { t: 'recruit', region: A, unit: 'inf' })).toBeNull();
    expect(r.units.inf).toBe(0); expect(r.train![0].at).toBeCloseTo(g.time + TICK_SECONDS);
    r.barracks = true;
    expect(applyCommand(g, 0, { t: 'recruit', region: A, unit: 'mg' })).toBeNull();
    expect(r.train![1].at).toBeCloseTo(g.time + TICK_SECONDS - 5);
    r.barracks = false; // no volunteers at the convoy
    expect(g.factions[0].wk?.[2]).toBe(FORMATION.inf.men + FORMATION.mg.men);
    run(g, TICK_SECONDS - 4.9); expect(r.units.mg).toBe(1); expect(r.units.inf).toBe(0);
    run(g, 5.1); expect(r.units.inf).toBe(1); expect(r.train).toBeUndefined();
  });

  it('emergency levies: at once and at double cost, only in a region under attack', () => {
    const { g, A, B } = setup(), r = g.regions[A];
    expect(applyCommand(g, 0, { t: 'recruit', region: A, unit: 'inf', now: true })).toMatch(/under attack/);
    g.regions[B].units.inf = 12; r.units.inf = 4; fill(g);
    openFront(g, 1, B, A);
    const s = g.factions[0].supply;
    expect(applyCommand(g, 0, { t: 'recruit', region: A, unit: 'inf', now: true })).toBeNull();
    expect(s - g.factions[0].supply).toBe(2 * unitCost(g, 0, 'inf')); expect(r.train).toBeUndefined();
  });

  it('a region lost while recruits train loses them', () => {
    const { g, A } = setup(), r = g.regions[A];
    applyCommand(g, 0, { t: 'recruit', region: A, unit: 'inf' });
    r.owner = 1; run(g, TICK_SECONDS + .1);
    expect(r.train).toBeUndefined(); expect(r.units.inf).toBe(0);
  });

  it('replacements: front-line corps first, at most 15 % of full strength a week, not with refill off', () => {
    const { g, A, B } = setup(), r = g.regions[A]; r.deploy = 1;
    r.units.inf = 12; fill(g);
    const [front, res, off] = setCs(g, A, [[B, { inf: 4 }], [-1, { inf: 4 }, { man: true }], [B, { inf: 4 }, { nr: true }]]);
    for (const c of [front, res, off]) c.m.inf = 100;
    r.men.inf = 12 * FORMATION.inf.men - 3 * 300;
    g.factions[0].men = 100;
    supplyTick(g);
    const max = Math.ceil(4 * FORMATION.inf.men * REPL.share), pool = 100 + (g.factions[0].led?.[0] ?? 0);
    expect(front.m.inf).toBe(100 + Math.min(max, pool));
    expect(res.m.inf).toBe(100 + Math.min(max, pool - Math.min(max, pool)));
    expect(off.m.inf).toBe(100);
    expect(g.factions[0].led?.[3]).toBeGreaterThan(0);
  });

  it('wounded come back to the pool two weeks after the battle, not straight to the corps', () => {
    const { g } = setup(), F = g.factions[0];
    woundedIn(g, F, 1000);
    expect(F.wounded).toBe(1000 * WOUNDED.share); expect(F.wq![0][1]).toBe(g.day + WOUNDED.days);
    const men0 = F.men; supplyTick(g);
    expect(F.led?.[1]).toBe(0);
    supplyTick(g);
    expect(F.led?.[1]).toBe(Math.floor(1000 * WOUNDED.share)); expect(F.wounded).toBe(0);
    expect(F.men).toBeGreaterThan(men0);
    expect(ledger(g, 0).last?.length).toBe(4);
  });
});

describe('war economy', () => {
  it('the lever shifts factory output between Production and shells; Balanced is the old split', () => {
    const { g, A } = setup(); g.regions[A].factory = true;
    const inc = income(g, 0), sh = shellIncome(g, 0);
    expect(applyCommand(g, 0, { t: 'econ', level: 2 })).toBeNull();
    expect(income(g, 0)).toBeLessThan(inc); expect(shellIncome(g, 0)).toBeGreaterThan(sh);
    applyCommand(g, 0, { t: 'econ', level: 0 });
    expect(income(g, 0)).toBeGreaterThan(inc); expect(shellIncome(g, 0)).toBeLessThan(sh);
    expect(applyCommand(g, 0, { t: 'econ', level: 3 })).toBe('Invalid order.');
  });
});

describe('snapshots', () => {
  it('carry the recipient’s recruits in training, wounded, ledger, lever and refill flags', () => {
    const { g, A, B } = setup();
    g.regions[A].units.inf = 4; fill(g); setCs(g, A, [[B, { inf: 4 }, { nr: true }]]);
    applyCommand(g, 0, { t: 'recruit', region: A, unit: 'inf' }); applyCommand(g, 0, { t: 'econ', level: 2 });
    woundedIn(g, g.factions[0], 500); g.factions[0].led = [1, 2, 3, 4];
    const m = createMirror(); initMirrorCapitals(m); applySnapshot(m, makeSnapshot(g, 0));
    expect(m.regions[A].train?.length).toBe(1); expect(m.factions[0].econ).toBe(2); expect(m.factions[0].led).toEqual([1, 2, 3, 4]);
    expect(m.factions[0].wq?.[0][0]).toBe(Math.round(500 * WOUNDED.share)); expect(m.regions[A].cs?.[0].nr).toBe(true);
    // the other side learns nothing of it
    const m1 = createMirror(); initMirrorCapitals(m1); applySnapshot(m1, makeSnapshot(g, 1));
    expect(m1.regions[A].train).toBeUndefined();
    void step;
  });
});
