// Front commanders: armies, shifting corps along the front, requests and answers, sending corps back only with permission
// (after a treaty or on a safe border), standing approvals, fog.
import { describe, it, expect } from 'vitest';
import {
  FORMATION, UNIT_TYPES, applyCommand, buildWorld, corpsAtPost, corpsIn, createGame, emptyUnits, findCorps, fogView, hqOf, makeSnapshot,
  createMirror, initMirrorCapitals, applySnapshot, run, updateSupplyLines, type GameState, type Hq,
} from '../src';
import { setCs } from './helpers';

const W = buildWorld();
const id = (n: string) => W.byName[n].id;
const fill = (g: GameState) => { for (const r of g.regions) for (const k of UNIT_TYPES) r.men[k] = r.units[k] * FORMATION[k].men; };
/** France (0) against Germany (1); France's other neighbours are French, so the German border is its only front; no navies. */
function setup() {
  const g = createGame({ seed: 7, humans: [0, 1, 2, 3, 4, 5, 6], settings: { attackCap: 0, pace: 1 } });
  for (const r of g.regions) { r.units = emptyUnits(); r.men = emptyUnits(); r.cs = undefined; r.defs = []; r.works = {}; r.owner = 2; r.home = 2; r.factory = false; r.capitalOf = -1; r.port = false; r.deploy = 1; }
  g.ships = []; g.fleets = [];
  const A = id('France'), B = id('Germany');
  for (const n of W.regions[A].adj) g.regions[n].owner = 0;
  g.regions[A].owner = 0; g.regions[A].home = 0; g.regions[A].capitalOf = 0; g.regions[B].owner = 1; g.regions[B].home = 1; g.regions[B].capitalOf = 1;
  g.factions.forEach(f => { f.supply = 100; f.mission = null; f.shells = 300; f.men = 5000; });
  updateSupplyLines(g);
  return { g, A, B };
}
/** Form an army from all corps of France and give its commander neutral traits. */
function army(g: GameState, A: number): Hq {
  expect(applyCommand(g, 0, { t: 'army', corps: corpsIn(g.regions[A]).map(c => c.id) })).toBeNull();
  const h = g.hq![g.hq!.length - 1]; h.cmd.tr = ['insp', 'insp']; return h;
}
const reqs = (g: GameState, kind?: string) => (g.requests ?? []).filter(q => !kind || q.kind === kind);

describe('front commanders', () => {
  it('an army gets a commander with a name and two traits; its corps are his', () => {
    const { g, A, B } = setup(); g.regions[A].units.inf = 6; fill(g);
    setCs(g, A, [[B, { inf: 6 }, { man: true }]]);
    expect(applyCommand(g, 0, { t: 'army', corps: corpsIn(g.regions[A]).map(c => c.id) })).toBeNull();
    const h = g.hq![0];
    expect(h.cmd.name.length).toBeGreaterThan(5); expect(h.cmd.tr.length).toBe(2); expect(h.front).toEqual([A]); expect(h.mandate).toBe(1);
    const c = corpsIn(g.regions[A])[0]; expect(c.army).toBe(h.id); expect(c.man).toBeFalsy();
  });

  it('moves his reserve to a border where the enemy masses, by himself', () => {
    const { g, A, B } = setup(); g.regions[A].units.inf = 14; g.regions[B].units.inf = 20; fill(g);
    setCs(g, A, [[B, { inf: 4 }], [-1, { inf: 10 }]]);
    setCs(g, B, [[A, { inf: 20 }, { ord: 2, ready: g.time + 9999 }]]);
    const h = army(g, A);
    run(g, 4);
    const col = g.armies.find(a => a.ct?.army === h.id && a.post === B);
    expect(col).toBeTruthy();
    expect(h.notes.some(n => n.k === 'move')).toBe(true);
  });

  it('after a treaty with the power across he asks to send the corps back, and only moves them once allowed', () => {
    const { g, A, B } = setup(); g.regions[A].units.inf = 12; g.regions[B].units.inf = 8; fill(g);
    setCs(g, A, [[B, { inf: 6 }], [-1, { inf: 6 }]]);
    setCs(g, B, [[A, { inf: 8 }]]);
    const h = army(g, A);
    run(g, 4); expect(reqs(g, 'release').length).toBe(0);
    g.treaties.push({ a: 0, b: 1, kind: 'nap' });
    run(g, 7);
    const q = reqs(g, 'release')[0];
    expect(q).toBeTruthy(); expect(q.why).toBe('peace');
    const cid = q.corps![0];
    // nothing moves while the request waits
    run(g, 10);
    expect(findCorps(g, 0, cid)?.c.p).toBe(B); expect(findCorps(g, 0, cid)?.c.army).toBe(h.id);
    expect(applyCommand(g, 0, { t: 'reply', req: q.id, opt: 'yes' })).toBeNull();
    const col = g.armies.find(a => a.ct?.id === cid);
    expect(col?.ct?.man).toBe(true); expect(col?.ct?.army).toBeUndefined(); expect(col?.post).toBe(-1);
    expect(g.events.some(e => e.k === 'release' && e.why === 'peace')).toBe(true);
  });

  it('offers spare corps of a safe border back; a denial rests for three weeks', () => {
    const { g, A, B } = setup(); g.regions[A].units.inf = 60; g.regions[B].units.inf = 2; fill(g);
    setCs(g, A, [[B, { inf: 20 }], [B, { inf: 20 }], [B, { inf: 20 }]]);
    setCs(g, B, [[A, { inf: 2 }]]);
    army(g, A);
    run(g, 10);
    const q = reqs(g, 'release')[0];
    expect(q?.why).toBe('safe');
    expect(applyCommand(g, 0, { t: 'reply', req: q.id, opt: 'deny' })).toBeNull();
    run(g, 10);
    expect(reqs(g, 'release').length).toBe(0);
  });

  it('asks for men where the line is short; recruits approved join his corps on that border', () => {
    const { g, A, B } = setup(); g.regions[A].units.inf = 2; g.regions[B].units.inf = 20; fill(g);
    setCs(g, A, [[B, { inf: 2 }]]);
    setCs(g, B, [[A, { inf: 20 }]]);
    const h = army(g, A);
    run(g, 4);
    const q = reqs(g, 'men')[0];
    expect(q).toBeTruthy(); expect(q.n).toBeGreaterThan(3);
    const sup = g.factions[0].supply;
    expect(applyCommand(g, 0, { t: 'reply', req: q.id, opt: 'recruit', n: 3 })).toBeNull();
    expect(g.factions[0].supply).toBeLessThan(sup);
    const here = corpsAtPost(g.regions[A], B).filter(c => c.army === h.id);
    expect(here.reduce((s, c) => s + c.u.inf, 0)).toBe(5);
  });

  it('never attacks on his own: he asks, and the corps go only once the player says yes', () => {
    const { g, A, B } = setup(); g.regions[A].units.inf = 20; g.regions[B].units.inf = 4; fill(g);
    setCs(g, A, [[B, { inf: 20 }]]);
    setCs(g, B, [[A, { inf: 4 }]]);
    army(g, A);
    run(g, 30);
    expect(corpsIn(g.regions[A]).every(c => (c.ord ?? 0) === 0)).toBe(true);
    const q = reqs(g, 'attack')[0];
    expect(q?.goal).toBe(1);
    expect(applyCommand(g, 0, { t: 'reply', req: q.id, opt: 'yes' })).toBeNull();
    expect(corpsIn(g.regions[A]).some(c => c.ord === 1)).toBe(true);
  });

  it('a standing approval carries the request out without asking', () => {
    const { g, A, B } = setup(); g.regions[A].units.inf = 4; g.regions[B].units.inf = 8; fill(g);
    setCs(g, A, [[B, { inf: 4 }]]);
    setCs(g, B, [[A, { inf: 8 }]]);
    const h = army(g, A);
    expect(applyCommand(g, 0, { t: 'armySet', army: h.id, standing: ['fort'] })).toBeNull();
    run(g, 4);
    expect(g.regions[A].works[B]?.tr ?? 0).toBeGreaterThan(0);
    expect(reqs(g, 'fort').length).toBe(0);
  });

  it('settings and fog: mandate, target and budget are checked; others never see an army', () => {
    const { g, A, B } = setup(); g.regions[A].units.inf = 4; fill(g);
    setCs(g, A, [[B, { inf: 4 }]]);
    const h = army(g, A);
    expect(applyCommand(g, 0, { t: 'armySet', army: h.id, target: A })).toMatch(/not an enemy/);
    expect(applyCommand(g, 0, { t: 'armySet', army: h.id, target: B })).toBeNull(); expect(hqOf(g, h.id)?.mandate).toBe(2);
    expect(applyCommand(g, 0, { t: 'armySet', army: h.id, budget: 5 })).toBeNull(); expect(h.budget).toBe(.3);
    expect(applyCommand(g, 1, { t: 'armySet', army: h.id, mandate: 0 })).toMatch(/not yours/);
    expect(fogView(g, 1).hq?.length).toBe(0); expect(fogView(g, 0).hq?.length).toBe(1);
    const m = createMirror(); initMirrorCapitals(m); applySnapshot(m, makeSnapshot(g, 0));
    expect(m.hq?.[0].cmd.name).toBe(h.cmd.name); expect(corpsIn(m.regions[A])[0].army).toBe(h.id);
    expect(applyCommand(g, 0, { t: 'disband', army: h.id })).toBeNull();
    expect(g.hq?.length).toBe(0); expect(corpsIn(g.regions[A])[0].man).toBe(true);
  });

  it('a whole war with every corps of one power under commanders runs without trouble', () => {
    const g = createGame({ seed: 13, humans: [3] });
    for (const r of g.regions) if (r.owner === 3 && r.cs?.length) applyCommand(g, 3, { t: 'army', corps: r.cs.map(c => c.id) });
    const n = g.hq!.length; expect(n).toBeGreaterThan(3);
    for (let t = 0; t < 600; t += 20) {
      run(g, 20);
      for (const h of g.hq ?? []) expect((g.requests ?? []).filter(q => q.army === h.id).length).toBeLessThanOrEqual(3);
      for (const q of g.requests ?? []) if (q.kind !== 'attack' && q.kind !== 'release') applyCommand(g, 3, { t: 'reply', req: q.id, opt: q.kind === 'men' ? 'recruit' : 'yes' });
    }
    expect((g.hq ?? []).every(h => h.front.every(id => g.regions[id].owner === 3))).toBe(true);
  }, 120000);
});

