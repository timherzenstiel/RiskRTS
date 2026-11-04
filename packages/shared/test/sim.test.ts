import { describe, it, expect } from 'vitest';
import { createGame, run, step, applyCommand, buildWorld, makeSnapshot, createMirror, applySnapshot, initMirrorCapitals, income, FACTIONS, totalUnits, missionText } from '../src';

describe('world', () => {
  const W = buildWorld();
  it('has 54 regions, all with land and neighbours', () => {
    expect(W.regions.length).toBe(54);
    for (const r of W.regions) { expect(r.tiles.length).toBeGreaterThan(0); expect(r.adj.length).toBeGreaterThan(0); }
  });
  it('adjacency is symmetric', () => { for (const r of W.regions) for (const j of r.adj) expect(W.regions[j].adj).toContain(r.id); });
  it('every capital exists', () => { for (const f of FACTIONS) expect(W.byName[f.capital]).toBeTruthy(); });
});

describe('game', () => {
  it('starts with every region owned and a mission per power', () => {
    const g = createGame({ seed: 1, humans: [0] });
    expect(g.regions.every(r => r.owner >= 0)).toBe(true);
    for (const f of g.factions) expect(missionText(f.mission!)[0].length).toBeGreaterThan(3);
  });
  it('is deterministic for a seed', () => {
    const a = createGame({ seed: 42, humans: [] }), b = createGame({ seed: 42, humans: [] });
    run(a, 120); run(b, 120);
    const key = (g: typeof a) => JSON.stringify([g.regions.map(r => [r.owner, r.units, r.trench]), g.factions.map(f => f.supply), g.time]);
    expect(key(a)).toBe(key(b));
  });
  it('AI-only war produces battles and conquest, and finishes without errors', () => {
    const g = createGame({ seed: 7, humans: [] }); let battles = 0;
    for (let i = 0; i < 20 * 600 && !g.over; i++) { step(g, .05); if (g.events.some(e => e.k === 'battleStart')) battles++; g.events.length = 0; if (g.fx) g.fx.length = 0; }
    expect(battles).toBeGreaterThan(5);
    expect(new Set(g.regions.map(r => r.owner)).size).toBeGreaterThan(1);
  });
  it('supply convoy pays out to everyone at once', () => {
    const g = createGame({ seed: 3, humans: [0] }); const before = g.factions.map(f => f.supply);
    run(g, 20.1);
    expect(g.factions[0].supply).toBe(before[0] + income(g, 0));
  });
});

describe('commands', () => {
  const g = createGame({ seed: 5, humans: [0] });
  const mine = g.regions.find(r => r.owner === 0)!, other = g.regions.find(r => r.owner === 1)!;
  it('recruits and charges supply', () => {
    const s = g.factions[0].supply, n = totalUnits(mine.units);
    expect(applyCommand(g, 0, { t: 'recruit', region: mine.id, unit: 'inf', n: 2 })).toBeNull();
    expect(g.factions[0].supply).toBe(s - 2); expect(totalUnits(mine.units)).toBe(n + 2);
  });
  it('refuses foreign regions, tanks without factory, and broke players', () => {
    expect(applyCommand(g, 0, { t: 'recruit', region: other.id, unit: 'inf' })).toMatch(/own regions/);
    const noFac = g.regions.find(r => r.owner === 0 && !r.factory)!;
    expect(applyCommand(g, 0, { t: 'recruit', region: noFac.id, unit: 'tank' })).toMatch(/factory/);
    g.factions[0].supply = 0;
    expect(applyCommand(g, 0, { t: 'build', region: mine.id, kind: 'trench' })).toMatch(/Not enough/);
  });
  it('rejects marching into non-neighbours', () => {
    const far = g.regions.find(r => !buildWorld().regions[mine.id].adj.includes(r.id) && r.id !== mine.id)!;
    expect(applyCommand(g, 0, { t: 'march', from: mine.id, to: far.id, frac: .5 })).toMatch(/does not border/);
  });
});

describe('snapshots', () => {
  it('round-trips strategic state into a mirror and hides other missions', () => {
    const g = createGame({ seed: 9, humans: [0, 1] }); run(g, 60);
    const snap = JSON.parse(JSON.stringify(makeSnapshot(g, 1, g.battles.map(b => b.id))));
    expect(snap.missions[1]).toBeTruthy(); expect(snap.missions[0]).toBeNull();
    const m = createMirror(); initMirrorCapitals(m); applySnapshot(m, snap);
    expect(m.regions.map(r => r.owner)).toEqual(g.regions.map(r => r.owner));
    expect(m.factions.map(f => f.supply)).toEqual(g.factions.map(f => f.supply));
    expect(m.battles.length).toBe(g.battles.length);
    expect(m.factions[1].mission).toEqual(g.factions[1].mission);
  });
});

import { emptyUnits, landIncome, hops, offensives, fortify, startBattle, stepBattle, DT } from '../src';
import type { GameState } from '../src';

/** A quiet game: AI off, every region of `a` and `b` set up by hand. */
function duel(seed = 11) {
  const g = createGame({ seed, humans: [0, 1, 2, 3, 4, 5], settings: { attackCap: 2, pace: 0 } });
  const W = buildWorld();
  const A = W.byName['France'].id, B = W.byName['Germany'].id, C = W.byName['Poland'].id;
  for (const r of g.regions) { r.units = emptyUnits(); r.defs = []; r.trench = 0; }
  g.regions[A].owner = 0; g.regions[B].owner = 1; g.regions[C].owner = 1;
  return { g, W, A, B, C };
}
const settle = (g: GameState, s = 400) => run(g, s);

describe('rules: income and attack cap', () => {
  it('income has diminishing returns', () => {
    expect(landIncome(1)).toBe(4); expect(landIncome(9)).toBe(7); expect(landIncome(54)).toBe(13);
    expect(landIncome(54) / 54).toBeLessThan(landIncome(9) / 9);
  });
  it('caps simultaneous attacks but not reinforcement', () => {
    const { g, W, B } = duel();
    const mine = W.regions[B].adj.filter(i => i !== W.byName['Poland'].id).slice(0, 4);
    for (const i of mine) { g.regions[i].owner = 0; g.regions[i].units.inf = 6; }
    g.regions[B].units.inf = 40;
    const targets = W.regions[B].adj.filter(i => g.regions[i].owner === 0);
    // attack three foreign regions from Germany: third is refused at cap 2
    const errs = targets.slice(0, 3).map(t => applyCommand(g, 1, { t: 'march', from: B, to: t, frac: .2 }));
    expect(errs[0]).toBeNull(); expect(errs[1]).toBeNull(); expect(errs[2]).toMatch(/limit 2/);
    expect(offensives(g, 1).size).toBe(2);
    // a second wave on an existing target is fine
    expect(applyCommand(g, 1, { t: 'march', from: B, to: targets[0], frac: .2 })).toBeNull();
  });
});

describe('rules: defences by sector', () => {
  it('only the attacked border and interior defences fight; others hold out and contest the region', () => {
    const { g, A, B, W } = duel();
    const other = W.regions[B].adj.find(i => i !== A)!;
    g.factions[1].supply = 50;
    expect(fortify(g, 1, g.regions[B], 'pill', A)).toBeNull();
    expect(fortify(g, 1, g.regions[B], 'pill', other)).toBeNull();
    expect(fortify(g, 1, g.regions[B], 'pill', 9999)).toMatch(/border/);
    const b = startBattle(g, g.regions[B], { x: 1, z: 0 }, 0, other);
    expect(b.agents.filter(a => a.type === 'pill').length).toBe(1);
    expect(g.regions[B].defs.length).toBe(1);
    expect(g.regions[B].defs[0].s).toBe(A);
  });
  it('a captured region with holdouts pays no income until they are stormed', () => {
    const { g, A, B, W } = duel();
    const other = W.regions[B].adj.find(i => i !== A)!;
    g.regions[B].defs.push({ id: 900, k: 'pill', s: other, hp: DT.pill.hp, f: 1 });
    g.regions[A].units.inf = 12; g.regions[A].units.tank = 2; g.regions[B].units.inf = 1;
    expect(applyCommand(g, 0, { t: 'march', from: A, to: B, frac: 1 })).toBeNull();
    settle(g, 200);
    expect(g.regions[B].owner).toBe(0);
    expect(g.regions[B].contested).toBe(1);
    expect(applyCommand(g, 0, { t: 'recruit', region: B, unit: 'inf' })).toMatch(/holdouts/);
    expect(applyCommand(g, 0, { t: 'assault', region: B })).toBeNull();
    settle(g, 300);
    expect(g.regions[B].contested).toBe(-1);
    expect(g.regions[B].owner).toBe(0);
  });
});

describe('rules: aircraft', () => {
  it('reach two borders, not three, and cannot capture', () => {
    const { g, A, C, W } = duel();
    expect(hops(A, C)).toBe(2);
    const far = g.regions.find(r => hops(A, r.id, 3) === 3)!;
    g.regions[A].airfield = true; g.regions[A].units.plane = 4; g.regions[C].units.inf = 1;
    expect(applyCommand(g, 0, { t: 'air', from: A, to: far.id, frac: 1 })).toMatch(/out of range/);
    expect(applyCommand(g, 0, { t: 'march', from: A, to: C, frac: 1 })).toMatch(/direct border/);
    expect(applyCommand(g, 0, { t: 'air', from: A, to: C, frac: 1 })).toBeNull();
    settle(g, 150);
    expect(g.regions[C].owner).toBe(1);
    expect(g.regions[C].units.inf).toBe(0);
    expect(g.regions[A].units.plane).toBeGreaterThan(0);
    void W;
  });
  it('pace setting changes battle length', () => {
    const len = (pace: number) => {
      const g = createGame({ seed: 4, humans: [0, 1, 2, 3, 4, 5], settings: { pace } });
      const W = buildWorld(), A = W.byName['France'].id, B = W.byName['Germany'].id;
      g.regions[A].owner = 0; g.regions[B].owner = 1; g.regions[B].defs = [];
      g.regions[A].units = { ...emptyUnits(), inf: 14, art: 2 }; g.regions[B].units = { ...emptyUnits(), inf: 10, mg: 2 };
      applyCommand(g, 0, { t: 'march', from: A, to: B, frac: 1 });
      let t = 0; for (let i = 0; i < 20 * 900; i++) { step(g, .05); if (g.battles.some(b => b.region === B && b.ended)) break; if (g.battles.some(b => b.region === B)) t += .05; }
      return t;
    };
    expect(len(0)).toBeLessThan(len(2));
  });
});
