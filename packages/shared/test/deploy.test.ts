// Deployment and phased offensives: main army and corps, distance-based marches, forming up, assembly, first line, depth,
// footholds, names, fog per post, snapshots and saves.
import { describe, it, expect } from 'vitest';
import {
  ASSEMBLE, DIG_IN, FORMATION, POST_SPEED, UNIT_TYPES, applyCommand, applySnapshot, armyName, buildWorld, corpsName, createGame, createMirror, emptyUnits,
  fogView, frontsOf, groundUnits, initMirrorCapitals, legDist, mainOf, makeSnapshot, migrateState, run, step, updateSupplyLines, type GameState,
} from '../src';
import { man, openFront } from './helpers';

const W = buildWorld();
const id = (n: string) => W.byName[n].id;
function fill(g: GameState) { for (const r of g.regions) for (const k of UNIT_TYPES) r.men[k] = r.units[k] * FORMATION[k].men; }
/** France (0) against Germany (1); every other region belongs to power 2 and is empty. */
function setup(pace = 1) {
  const g = createGame({ seed: 3, humans: [0, 1, 2, 3, 4, 5], settings: { attackCap: 0, pace } });
  for (const r of g.regions) { r.units = emptyUnits(); r.men = emptyUnits(); r.defs = []; r.works = {}; r.owner = 2; r.home = 2; r.factory = false; r.capitalOf = -1; r.fr = undefined; r.barracks = false; }
  const A = id('France'), B = id('Germany');
  g.regions[A].owner = 0; g.regions[A].home = 0; g.regions[B].owner = 1; g.regions[B].home = 1;
  g.factions.forEach(f => { f.supply = 100; f.mission = null; f.shells = 200; });
  updateSupplyLines(g);
  return { g, A, B };
}

describe('deployment', () => {
  it('the war starts with a main army in the middle and corps on the borders facing foreign powers', () => {
    const g = createGame({ seed: 5, humans: [0] });
    let corps = 0;
    for (const r of g.regions) {
      for (const [s, c] of Object.entries(r.fr ?? {})) {
        corps++;
        expect(W.regions[r.id].adj).toContain(+s);
        expect(g.regions[+s].owner).not.toBe(r.owner);
        expect(c.n).toBeGreaterThan(0);
      }
      if (groundUnits(r.units) >= 4) expect(groundUnits(mainOf(r))).toBeGreaterThan(0);
    }
    expect(corps).toBeGreaterThan(30);
    const cap = g.regions[W.byName['Germany'].id];
    expect(cap.an).toBeGreaterThan(0); expect(Object.keys(cap.fr ?? {}).length).toBeGreaterThan(0);
  });
  it('troops move between posts and regions in a time that follows the distance', () => {
    const { g, A } = setup(); const C = id('Iberia'); g.regions[C].owner = 0; g.regions[A].units.inf = 8; fill(g);
    g.railCut[`${Math.min(A, C)}|${Math.max(A, C)}`] = g.day + 99;
    const far = W.regions[A].adj.reduce((x, y) => legDist(A, -1, A, y) > legDist(A, -1, A, x) ? y : x);
    expect(applyCommand(g, 0, { t: 'move', region: A, post: -1, to: A, toPost: far, frac: .5 })).toBeNull();
    const inner = g.armies[0];
    expect(inner.inner).toBe(true); expect(inner.dur).toBeCloseTo(Math.max(2, legDist(A, -1, A, far) / POST_SPEED), 1);
    expect(applyCommand(g, 0, { t: 'march', from: A, to: C, frac: .5 })).toBeNull();
    const out = g.armies[1]; expect(out.dur).toBeCloseTo(legDist(A, -1, C, -1) / POST_SPEED, 1);
    expect(out.dur).toBeGreaterThan(20); // a neighbour is tens of seconds away, not three
    run(g, out.dur + 1);
    expect(g.regions[C].units.inf).toBeGreaterThan(0);
    expect(g.regions[A].fr?.[far]?.u.inf).toBeGreaterThan(0);
    expect(g.regions[A].deploy).toBe(1);
  });
  it('a march through own land follows a route of regions', () => {
    const { g, A } = setup(); const C = id('Iberia'), D = id('Italy');
    for (const r of [C, D]) g.regions[r].owner = 0;
    const route = W.regions[C].adj.includes(D) ? null : [A];
    g.regions[C].units.inf = 6; fill(g);
    expect(applyCommand(g, 0, { t: 'move', region: C, post: -1, to: D, toPost: -1, frac: .5 })).toBeNull();
    expect(g.armies[0].path?.length ?? 0).toBe(route ? 1 : 0);
    run(g, 400);
    expect(g.regions[D].units.inf).toBeGreaterThan(0);
  });
  it('a region that deploys itself mans the threatened border and keeps a reserve', () => {
    const { g, A, B } = setup(); g.regions[B].units = { ...emptyUnits(), inf: 10, art: 2 }; fill(g);
    g.regions[A].units = { ...emptyUnits(), inf: 20 }; fill(g);
    run(g, 20.1 + 60);
    const c = g.regions[B].fr?.[A];
    expect(c?.u.inf).toBeGreaterThanOrEqual(3);
    for (const [s, o] of Object.entries(g.regions[B].fr ?? {})) if (+s !== A) expect(o.u.inf).toBeLessThan(c!.u.inf);
    expect(mainOf(g.regions[B]).inf).toBeGreaterThan(1);
  });
});

describe('phased offensives', () => {
  it('a quick order forms up, marches to the border, assembles and only then attacks', () => {
    const { g, A, B } = setup(); g.regions[A].units = { ...emptyUnits(), inf: 10, art: 2 }; g.regions[B].units = { ...emptyUnits(), inf: 3 }; fill(g); man(g, B, A);
    expect(applyCommand(g, 0, { t: 'march', from: A, to: B, frac: .8 })).toBeNull();
    const col = g.armies[0];
    expect(col.inner).toBe(true); expect(col.wait).toBeGreaterThanOrEqual(20); expect(col.ord).toBe(2);
    const forming = col.wait!;
    run(g, forming - 1); expect(col.t).toBe(0); // still forming up
    run(g, col.dur + 2);
    const c = g.regions[A].fr?.[B]!;
    expect(c.ord).toBe(2); expect(c.ready! - g.time).toBeGreaterThan(ASSEMBLE - col.dur - 4);
    expect(frontsOf(g, B).length).toBe(0);
    expect(g.events.some(e => e.k === 'massing' && e.owner === 1)).toBe(true);
    for (let i = 0; i < 20 * 80 && !frontsOf(g, B).length; i++) step(g, .05);
    const b = frontsOf(g, B)[0];
    expect(b).toBeTruthy(); expect(b.goal).toBe(2); expect(b.stage).toBe(0);
    expect(g.time).toBeGreaterThan(forming + ASSEMBLE);
  });
  it('the corps of a border holds the first line; the main army waits in the depth until it falls', () => {
    const { g, A, B } = setup();
    g.regions[A].units = { ...emptyUnits(), inf: 24, art: 3 }; g.regions[B].units = { ...emptyUnits(), inf: 5 }; fill(g);
    g.regions[B].deploy = 1; g.regions[B].fr = { [A]: { u: { ...emptyUnits(), inf: 2 }, n: 4, ord: 0 } };
    const b = openFront(g, 0, A, B, 1, 2, true);
    expect(b.agents.filter(a => a.f === 1 && a.type === 'inf').length).toBe(2);
    expect(mainOf(g.regions[B]).inf).toBe(3);
    const stages: number[] = [];
    for (let i = 0; i < 20 * 600 && !b.ended; i++) { step(g, .05); if (stages[stages.length - 1] !== b.stage) stages.push(b.stage!); }
    expect(stages.slice(0, 3)).toEqual([0, 1, 2]);
    expect(g.events.some(e => e.k === 'firstLine') || stages.includes(1)).toBe(true);
    expect(g.regions[B].owner).toBe(0);
  });
  it('taking the first line leaves a foothold; an invasion order carries it into the depth', () => {
    const { g, A, B } = setup();
    g.regions[A].units = { ...emptyUnits(), inf: 20, art: 2 }; g.regions[B].units = { ...emptyUnits(), inf: 5 }; g.regions[B].works[A] = { tr: 2, sand: 1, wire: 1 }; fill(g);
    g.regions[B].deploy = 1; g.regions[B].fr = { [A]: { u: { ...emptyUnits(), inf: 2 }, n: 4, ord: 0 } };
    const b = openFront(g, 0, A, B, 1, 1, true);
    for (let i = 0; i < 20 * 400 && b.stage !== 3 && !b.ended; i++) step(g, .05);
    expect(b.stage).toBe(3); expect(b.ended).toBe(false);
    expect(g.regions[B].owner).toBe(1);
    expect(g.regions[B].works[A].wire).toBe(0); expect(g.regions[B].works[A].sand).toBe(0); expect(g.regions[B].works[A].tr).toBe(1);
    run(g, 30); expect(b.stage).toBe(3); // the attackers dig in and wait
    expect(applyCommand(g, 0, { t: 'order', region: A, post: B, k: 2 })).toBeNull();
    expect(b.stage).toBe(1);
    for (let i = 0; i < 20 * 600 && !b.ended; i++) step(g, .05);
    expect(g.regions[B].owner).toBe(0);
  });
  it('a corps that has held its border for a while is dug in deeper', () => {
    const t = (held: number) => {
      const { g, A, B } = setup(); g.regions[A].units = { ...emptyUnits(), inf: 8 }; g.regions[B].units = { ...emptyUnits(), inf: 4 }; g.regions[B].works[A] = { tr: 1, sand: 0, wire: 0 }; fill(g);
      man(g, B, A); g.regions[B].fr![A].since = g.time - held;
      const b = openFront(g, 0, A, B, 1, 2, true); return b.tr;
    };
    expect(t(0)).toBe(1); expect(t(DIG_IN + 5)).toBe(2);
  });
  it('when a region falls, the corps on its other borders fall back to a neighbouring region', () => {
    const { g, A, B } = setup(); const C = W.regions[B].adj.find(i => i !== A && !W.seaLane.has(B + '|' + i))!; g.regions[C].owner = 1;
    g.regions[A].units = { ...emptyUnits(), inf: 24, art: 2 }; g.regions[B].units = { ...emptyUnits(), inf: 7 }; fill(g); updateSupplyLines(g);
    const other = W.regions[B].adj.find(i => i !== A && i !== C)!;
    g.regions[B].deploy = 1; g.regions[B].fr = { [A]: { u: { ...emptyUnits(), inf: 2 }, n: 4, ord: 0 }, [other]: { u: { ...emptyUnits(), inf: 5 }, n: 5, ord: 0 } };
    const b = openFront(g, 0, A, B, 1, 2, true);
    for (let i = 0; i < 20 * 600 && !b.ended; i++) step(g, .05);
    expect(g.regions[B].owner).toBe(0);
    expect(g.armies.some(a => a.owner === 1 && a.to === C && a.units.inf === 5)).toBe(true);
  });
  it('an attack launched before assembly costs morale and fires unregistered', () => {
    const { g, A, B } = setup(); g.regions[A].units = { ...emptyUnits(), inf: 8 }; g.regions[B].units = { ...emptyUnits(), inf: 2 }; fill(g); man(g, B, A);
    g.regions[A].mor = 80; g.regions[A].deploy = 1; g.regions[A].fr = { [B]: { u: { ...emptyUnits(), inf: 6 }, n: 3, ord: 0 } };
    expect(applyCommand(g, 0, { t: 'order', region: A, post: B, k: 2, now: true })).toBeNull();
    for (let i = 0; i < 20 * 30 && !frontsOf(g, B).length; i++) step(g, .05);
    const b = frontsOf(g, B)[0];
    expect(b.unreg).toBeGreaterThan(0); expect(b.mor0[0]).toBeLessThanOrEqual(80 - 15 + .01);
  });
  it('orders are checked', () => {
    const { g, A, B } = setup(); g.regions[A].units.inf = 4; fill(g);
    expect(applyCommand(g, 0, { t: 'order', region: A, post: B, k: 2 })).toMatch(/no corps/);
    expect(applyCommand(g, 0, { t: 'order', region: B, post: A, k: 2 })).toMatch(/own regions/);
    expect(applyCommand(g, 0, { t: 'move', region: A, post: -1, to: B, toPost: -1, frac: 1 })).toMatch(/not yours/);
    expect(applyCommand(g, 0, { t: 'move', region: A, post: -1, to: A, toPost: -1, frac: 1 })).toMatch(/already there/);
    expect(applyCommand(g, 0, { t: 'move', region: A, post: -1, to: A, toPost: 9999, frac: 1 })).toMatch(/border/);
    expect(applyCommand(g, 0, { t: 'deploy', region: A, mode: 1 })).toBeNull(); expect(g.regions[A].deploy).toBe(1);
  });
});

describe('names, fog, snapshots and saves', () => {
  it('armies and corps are named per nation', () => {
    expect(armyName(0, 1)).toBe('First Army'); expect(armyName(1, 1)).toBe('1re Armée'); expect(armyName(3, 4)).toBe('4. Armee');
    expect(corpsName(3, 7)).toBe('VII. Armeekorps'); expect(corpsName(0, 11)).toBe('XI Corps'); expect(corpsName(5, 15)).toBe('XV. Kolordu');
    const g = createGame({ seed: 6, humans: [0] });
    const nums = g.regions.filter(r => r.owner === 3).flatMap(r => Object.values(r.fr ?? {}).map(c => c.n));
    expect(new Set(nums).size).toBe(nums.length);
  });
  it('rivals see the corps across their own borders as an estimate, nothing of the others', () => {
    const { g, A, B } = setup(); const other = W.regions[B].adj.find(i => i !== A)!;
    g.regions[B].units = { ...emptyUnits(), inf: 9 }; fill(g);
    g.regions[B].fr = { [A]: { u: { ...emptyUnits(), inf: 4 }, n: 2, ord: 0 }, [other]: { u: { ...emptyUnits(), inf: 3 }, n: 3, ord: 0 } };
    const v = fogView(g, 0).regions[B];
    expect(Object.keys(v.fr ?? {})).toEqual([String(A)]);
    expect(v.fr![A].n).toBe(-1); expect(v.fr![A].est![0]).toBeGreaterThan(0); expect(v.fr![A].est![1]).toBeGreaterThanOrEqual(400);
    expect(fogView(g, 1).regions[B].fr![other].n).toBe(3);
  });
  it('snapshots carry corps, names and battle stages', () => {
    const { g, A, B } = setup(); g.regions[A].units = { ...emptyUnits(), inf: 10 }; g.regions[B].units = { ...emptyUnits(), inf: 3 }; fill(g);
    const b = openFront(g, 0, A, B);
    g.regions[A].fr = { [B]: { u: { ...emptyUnits(), inf: 1 }, n: 7, ord: 1, ready: g.time + 12 } };
    const m = createMirror(); initMirrorCapitals(m); applySnapshot(m, makeSnapshot(g, 0, [b.id]));
    expect(m.regions[A].fr![B].n).toBe(7); expect(m.regions[A].fr![B].ord).toBe(1); expect(m.regions[A].fr![B].ready! - m.time).toBeCloseTo(12, 0);
    expect(m.battles[0].goal).toBe(2); expect(m.battles[0].stage).toBe(0);
    expect(m.regions[A].an).toBe(g.regions[A].an);
  });
  it('a version 4 save becomes version 5 with its garrisons placed', () => {
    const g = createGame({ seed: 9, humans: [0] });
    const old = JSON.parse(JSON.stringify(g)); old.v = 4;
    for (const r of old.regions) { delete r.fr; delete r.an; } for (const f of old.factions) { delete f.nArmy; delete f.nCorps; }
    const m = migrateState(old)!;
    expect(m.v).toBe(5);
    expect(m.regions.some(r => Object.keys(r.fr ?? {}).length > 0)).toBe(true);
    for (const r of m.regions) expect(groundUnits(mainOf(r))).toBeGreaterThanOrEqual(0);
  });
});
