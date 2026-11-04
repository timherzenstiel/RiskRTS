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
