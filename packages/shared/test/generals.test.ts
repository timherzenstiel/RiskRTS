// Generals are a limited resource (design-play §3.2): slots, forming and disbanding, appointing to a front, relieving,
// captured headquarters, new war years, wins, stars and promotion, trait effects, the snapshot, and computer powers.
import { describe, it, expect } from 'vitest';
import {
  FORMATION, GEN, TICK_SECONDS, UNIT_TYPES, applyCommand, applySnapshot, buildWorld, corpsIn, createGame, createMirror, dayOf, emptyUnits,
  fortCost, generalWon, initMirrorCapitals, makeSnapshot, nextGeneral, noGeneral, run, updateSupplyLines, type GameState, type Hq,
} from '../src';
import { setCs } from './helpers';

const W = buildWorld();
const id = (n: string) => W.byName[n].id;
const fill = (g: GameState) => { for (const r of g.regions) for (const k of UNIT_TYPES) r.men[k] = r.units[k] * FORMATION[k].men; };
function setup() {
  const g = createGame({ seed: 7, humans: [0, 1, 2, 3, 4, 5, 6], settings: { attackCap: 0, pace: 1 } });
  for (const r of g.regions) { r.units = emptyUnits(); r.men = emptyUnits(); r.cs = undefined; r.defs = []; r.works = {}; r.owner = 2; r.home = 2; r.factory = false; r.capitalOf = -1; r.port = false; r.deploy = 1; }
  g.ships = []; g.fleets = [];
  const A = id('France'), B = id('Germany');
  for (const n of W.regions[A].adj) g.regions[n].owner = 0;
  g.regions[A].owner = 0; g.regions[A].home = 0; g.regions[A].capitalOf = 0; g.regions[B].owner = 1; g.regions[B].home = 1; g.regions[B].capitalOf = 1;
  g.factions.forEach(f => { f.supply = 100; f.mission = null; f.shells = 300; f.men = 5000; });
  g.regions[A].units.inf = 12; fill(g);
  setCs(g, A, [[B, { inf: 6 }, { man: true }], [B, { inf: 6 }, { man: true }]]);
  updateSupplyLines(g);
  return { g, A, B };
}
const total = (g: GameState, f: number) => { const G = g.factions[f].gen!; return G.pool.length + (g.hq ?? []).filter(h => h.owner === f).length + G.due.length; };

describe('generals', () => {
  it('each power starts with its generals, free and with two traits', () => {
    const g = createGame({ seed: 3, humans: [0] });
    expect(g.factions.map(f => f.gen!.slots)).toEqual([2, 3, 4, 3, 3, 3, 2]);
    for (const f of g.factions) { expect(f.gen!.pool.length).toBe(f.gen!.slots); for (const x of f.gen!.pool) expect(x.tr.length).toBe(2); }
    // every name differs within a power
    for (const f of g.factions) expect(new Set(f.gen!.pool.map(x => x.name)).size).toBe(f.gen!.pool.length);
  });

  it('an army takes a free general; with none free it cannot be formed; disbanding frees him with his experience', () => {
    const { g, A } = setup();
    const [c1, c2] = corpsIn(g.regions[A]);
    g.factions[0].gen!.pool.length = 1;
    g.factions[0].gen!.slots = 1;
    const x = g.factions[0].gen!.pool[0];
    expect(applyCommand(g, 0, { t: 'army', corps: [c1.id] })).toBeNull();
    const h = g.hq![0]; expect(h.cmd).toBe(x); expect(g.factions[0].gen!.pool.length).toBe(0);
    const err = applyCommand(g, 0, { t: 'army', corps: [c2.id] });
    expect(err).toMatch(/No general free/); expect(noGeneral(g, 0)).toMatch(/week/);
    h.cmd.xp = 1.5;
    expect(applyCommand(g, 0, { t: 'disband', army: h.id })).toBeNull();
    expect(g.factions[0].gen!.pool).toEqual([x]); expect(x.xp).toBe(1.5);
  });

  it('a commander appointed to a front takes the corps there that are in no army, and the general asked for', () => {
    const { g, A } = setup();
    const want = g.factions[0].gen!.pool[1];
    expect(applyCommand(g, 0, { t: 'army', corps: [], front: [A], gen: want.id })).toBeNull();
    const h = g.hq![0];
    expect(h.cmd).toBe(want); expect(h.front).toEqual([A]); expect(h.seat).toBe(A);
    expect(corpsIn(g.regions[A]).every(c => c.army === h.id && !c.man)).toBe(true);
    expect(applyCommand(g, 0, { t: 'army', corps: [], front: [id('Germany')] })).toMatch(/no longer ours/);
  });

  it('relieving costs weariness and shakes the front, and fills the slot at once', () => {
    const { g, A } = setup();
    expect(applyCommand(g, 0, { t: 'army', corps: [], front: [A] })).toBeNull();
    const h = g.hq![0], old = h.cmd, ww = g.factions[0].ww, free = g.factions[0].gen!.pool.length, pick = g.factions[0].gen!.pool[0];
    for (const c of corpsIn(g.regions[A])) c.mor = 100;
    expect(applyCommand(g, 0, { t: 'relieve', army: h.id, gen: pick.id })).toBeNull();
    expect(h.cmd).toBe(pick); expect(g.factions[0].gen!.pool.some(x => x === old)).toBe(false);
    expect(g.factions[0].gen!.pool.length).toBe(free); // the new man waits among the free ones
    expect(g.factions[0].ww).toBe(ww + GEN.relieveWw); expect(h.shaken).toBeGreaterThan(g.time);
    expect(total(g, 0)).toBe(g.factions[0].gen!.slots);
    run(g, 4);
    for (const c of corpsIn(g.regions[A])) expect(c.mor).toBeLessThanOrEqual(100 * GEN.shakenMor + .01);
    expect(g.events.some(e => e.k === 'general' && e.kind === 'relieved' && e.name === old.name)).toBe(true);
  });

  it('a captured headquarters costs the general; a free one takes over, and a replacement comes later', () => {
    const { g, A } = setup();
    const n = W.regions[A].adj.find(j => g.regions[j].owner === 0 && W.regions[j].land.includes(A))!;
    expect(applyCommand(g, 0, { t: 'army', corps: [], front: [A, n] })).toBeNull();
    const h = g.hq![0]; h.seat = n; const old = h.cmd, slots = g.factions[0].gen!.slots;
    g.regions[n].owner = 1;
    run(g, 4);
    expect(h.cmd).not.toBe(old); expect(g.hq).toContain(h);
    expect(g.factions[0].gen!.due.length).toBe(1); expect(total(g, 0)).toBe(slots);
    expect(g.events.some(e => e.k === 'general' && e.kind === 'lost')).toBe(true);
    expect(nextGeneral(g, 0)!.why).toBe('back');
    g.factions[0].gen!.due[0] = g.time + 1;
    run(g, 2);
    expect(g.factions[0].gen!.due.length).toBe(0); expect(total(g, 0)).toBe(slots);
  });

  it('with no general free a captured headquarters breaks the army up', () => {
    const { g, A } = setup();
    expect(applyCommand(g, 0, { t: 'army', corps: [], front: [A] })).toBeNull();
    const h = g.hq![0]; g.factions[0].gen!.slots -= g.factions[0].gen!.pool.length; g.factions[0].gen!.pool = [];
    const n = W.regions[A].adj.find(j => g.regions[j].owner === 0)!; h.front.push(n); h.seat = n; g.regions[n].owner = 1;
    run(g, 4);
    expect(g.hq).not.toContain(h); expect(g.factions[0].gen!.pool.length).toBe(0); expect(total(g, 0)).toBe(g.factions[0].gen!.slots);
  });

  it('a new war year brings one more general', () => {
    const { g } = setup();
    const s0 = g.factions[0].gen!.slots;
    g.day = dayOf(1914, 12, 28); g.factions[0].gen!.y = 1914;
    expect(nextGeneral(g, 0)!.why).toBe('year');
    expect(nextGeneral(g, 0)!.at - g.time).toBeLessThan(TICK_SECONDS);
    run(g, TICK_SECONDS + 1);
    expect(g.factions[0].gen!.slots).toBe(s0 + 1); expect(g.factions[0].gen!.pool.length).toBe(s0 + 1);
    expect(g.events.some(e => e.k === 'general' && e.kind === 'new' && e.why === 'year' && e.faction === 0)).toBe(true);
  });

  it('wins bring stars and more generals; at three stars a bad trait goes', () => {
    const { g, A } = setup();
    expect(applyCommand(g, 0, { t: 'army', corps: [], front: [A] })).toBeNull();
    const h: Hq = g.hq![0]; h.cmd.tr = ['slow', 'insp']; const s0 = g.factions[0].gen!.slots;
    for (let i = 0; i < 3; i++) generalWon(g, h);
    expect(Math.floor(h.cmd.xp + 1e-6)).toBe(1); expect(g.factions[0].gen!.slots).toBe(s0 + 1);
    for (let i = 0; i < 6; i++) generalWon(g, h);
    expect(h.cmd.xp).toBe(3); expect(h.cmd.up).toBe(true);
    expect(h.cmd.tr).not.toContain('slow'); expect(h.cmd.tr).toContain('insp'); expect(h.cmd.tr.length).toBe(2);
    expect(g.factions[0].gen!.slots).toBe(s0 + 3);
  });

  it('a three-star general with no bad trait gains a third', () => {
    const { g, A } = setup();
    expect(applyCommand(g, 0, { t: 'army', corps: [], front: [A] })).toBeNull();
    const h = g.hq![0]; h.cmd.tr = ['def', 'insp'];
    for (let i = 0; i < 9; i++) generalWon(g, h);
    expect(h.cmd.tr.length).toBe(3);
  });

  it('an Engineer asks for cheaper works; denying a Political general costs weariness', () => {
    const { g, A, B } = setup();
    expect(applyCommand(g, 0, { t: 'army', corps: [], front: [A] })).toBeNull();
    const h = g.hq![0]; h.cmd.tr = ['eng', 'pol'];
    // an enemy mass across the border makes it unsafe
    g.regions[B].units.inf = 40; fill(g); setCs(g, B, [[A, { inf: 40 }]]);
    run(g, 4);
    const q = (g.requests ?? []).find(x => x.kind === 'fort');
    expect(q).toBeTruthy();
    expect(q!.cost).toBe(Math.max(1, Math.round(fortCost(g.regions[A], q!.fort!, q!.sector, g)! * .75)));
    const ww = g.factions[0].ww;
    expect(applyCommand(g, 0, { t: 'reply', req: q!.id, opt: 'deny' })).toBeNull();
    expect(g.factions[0].ww).toBe(ww + 1);
  });

  it('a guest sees its own generals', () => {
    const g = createGame({ seed: 5, humans: [0, 3] });
    const m = createMirror(); initMirrorCapitals(m);
    applySnapshot(m, makeSnapshot(g, 3));
    expect(m.factions[3].gen!.pool.map(x => x.name)).toEqual(g.factions[3].gen!.pool.map(x => x.name));
    expect(m.factions[0].gen).toBeUndefined();
  });

  it('computer powers never have more armies than generals', () => {
    const g = createGame({ seed: 11, humans: [] });
    for (let t = 0; t < 400; t += 20) {
      run(g, 20);
      for (const f of g.factions) { if (!f.alive) continue; expect((g.hq ?? []).filter(h => h.owner === f.id).length).toBeLessThanOrEqual(f.gen!.slots); expect(total(g, f.id)).toBe(f.gen!.slots); }
    }
  }, 120000);
});
