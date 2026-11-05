// Deception and diplomacy: decoys, fake concentrations, trench raids, treaties, breaking them, alliances.
import { describe, it, expect } from 'vitest';
import {
  FORMATION, UNIT_TYPES, applyCommand, applySnapshot, buildWorld, createGame, createMirror, emptyUnits, fogView, frontsOf, initMirrorCapitals, makeSnapshot, run, step,
  treatyOf, updateSupplyLines, visibility, eventsFor, type GameState,
} from '../src';

const W = buildWorld(); const id = (n: string) => W.byName[n].id;
function fill(g: GameState) { for (const r of g.regions) for (const k of UNIT_TYPES) r.men[k] = r.units[k] * FORMATION[k].men; }
function setup(humans = [0, 1, 2, 3, 4, 5]) {
  const g = createGame({ seed: 4, humans, settings: { attackCap: 0, pace: 1 } });
  for (const r of g.regions) { r.units = emptyUnits(); r.men = emptyUnits(); r.defs = []; r.works = {}; r.owner = 2; r.home = 2; r.factory = false; r.capitalOf = -1; }
  const A = id('France'), B = id('Germany'), C = id('Italy');
  g.regions[A].owner = 0; g.regions[A].home = 0; g.regions[B].owner = 1; g.regions[B].home = 1; g.regions[C].owner = 0; g.regions[C].home = 0;
  g.factions.forEach(f => { f.supply = 100; f.mission = null; f.ww = 0; });
  updateSupplyLines(g);
  return { g, A, B, C };
}

describe('deception', () => {
  it('a decoy army looks real to rivals and becomes a fake concentration in an own border region', () => {
    const { g, A, B, C } = setup(); g.regions[C].units.inf = 1; fill(g);
    expect(applyCommand(g, 0, { t: 'decoy', from: A, to: C })).toBeNull();
    const seen = fogView(g, 1).armies[0];
    expect(seen.decoy).toBeUndefined(); expect(seen.units.inf).toBeGreaterThanOrEqual(5);
    expect(fogView(g, 0).armies[0].decoy).toBe(true);
    const before = fogView(g, 1).regions[C].est?.[1] ?? 0;
    run(g, 10);
    expect(g.armies.length).toBe(0);
    if (W.regions[C].adj.includes(B)) expect(fogView(g, 1).regions[C].est![1]).toBeGreaterThan(before + 300);
    expect(g.regions[C].units.inf).toBe(1); // nothing real arrived
  });
  it('a trench raid from a quiet front costs men and brings back a report', () => {
    const { g, A, B } = setup(); g.regions[A].units = { ...emptyUnits(), inf: 6 }; g.regions[B].units = { ...emptyUnits(), inf: 8, mg: 2 }; g.regions[B].works[A] = { tr: 3, sand: 2, wire: 2 }; fill(g);
    applyCommand(g, 0, { t: 'march', from: A, to: B, frac: .5 }); for (let i = 0; i < 400 && !frontsOf(g, B).length; i++) step(g, .05);
    const b = frontsOf(g, B)[0];
    expect(applyCommand(g, 1, { t: 'raid', battle: b.id })).toMatch(/trench warfare/);
    b.lastJoin = b.age - 100; const lost = b.lost[1] ?? 0;
    expect(applyCommand(g, 1, { t: 'raid', battle: b.id })).toBeNull();
    expect(b.lost[1]).toBeGreaterThan(lost);
    expect(applyCommand(g, 1, { t: 'raid', battle: b.id })).toMatch(/just come back/);
  });
});

describe('diplomacy', () => {
  it('a ceasefire stops attacks; attacking anyway breaks it and costs weariness and trust', () => {
    const { g, A, B } = setup(); g.regions[A].units.inf = 6; fill(g);
    expect(applyCommand(g, 0, { t: 'offer', to: 1, kind: 'cease' })).toBeNull();
    const o = g.offers[0]; expect(applyCommand(g, 1, { t: 'answer', id: o.id, yes: true })).toBeNull();
    expect(treatyOf(g, 0, 1)?.kind).toBe('cease');
    expect(applyCommand(g, 0, { t: 'march', from: A, to: B, frac: .5 })).toMatch(/ceasefire/);
    expect(applyCommand(g, 0, { t: 'march', from: A, to: B, frac: .5, brk: true })).toBeNull();
    expect(treatyOf(g, 0, 1)).toBeUndefined(); expect(g.factions[0].ww).toBeGreaterThanOrEqual(10);
    expect(g.factions[1].trust![0]).toBeLessThan(1);
  });
  it('signing a ceasefire pulls attackers out and turns armies back', () => {
    const { g, A, B } = setup(); g.regions[A].units = { ...emptyUnits(), inf: 10 }; g.regions[B].units = { ...emptyUnits(), inf: 6 }; fill(g);
    applyCommand(g, 0, { t: 'march', from: A, to: B, frac: .5 }); for (let i = 0; i < 400 && !frontsOf(g, B).length; i++) step(g, .05);
    applyCommand(g, 0, { t: 'march', from: A, to: B, frac: .9 });
    applyCommand(g, 1, { t: 'offer', to: 0, kind: 'cease' }); applyCommand(g, 0, { t: 'answer', id: g.offers[0].id, yes: true });
    run(g, 20);
    expect(g.regions[B].owner).toBe(1); expect(g.regions[A].units.inf).toBeGreaterThan(6);
  });
  it('offers lapse unanswered; pacts end after notice; ceasefires run out', () => {
    const { g } = setup();
    applyCommand(g, 0, { t: 'offer', to: 1, kind: 'nap' }); run(g, 31); expect(g.offers.length).toBe(0); expect(treatyOf(g, 0, 1)).toBeUndefined();
    applyCommand(g, 0, { t: 'offer', to: 1, kind: 'nap' }); applyCommand(g, 1, { t: 'answer', id: g.offers[0].id, yes: true });
    expect(applyCommand(g, 1, { t: 'cancel', to: 0 })).toBeNull(); run(g, 20 * 3 + 1); expect(treatyOf(g, 0, 1)).toBeUndefined();
    applyCommand(g, 0, { t: 'offer', to: 1, kind: 'cease' }); applyCommand(g, 1, { t: 'answer', id: g.offers[0].id, yes: true });
    run(g, 20 * 10 + 1); expect(treatyOf(g, 0, 1)).toBeUndefined();
  });
  it('allies share vision and supply lines', () => {
    const { g, A, B } = setup(); const P = id('Poland'); g.regions[P].owner = 0; g.regions[P].home = -1; updateSupplyLines(g);
    expect(g.regions[P].cut).toBe(true); expect(visibility(g, 0)[B]).toBe(1);
    applyCommand(g, 0, { t: 'offer', to: 1, kind: 'ally' }); applyCommand(g, 1, { t: 'answer', id: g.offers[0].id, yes: true });
    updateSupplyLines(g); expect(g.regions[P].cut).toBe(false);
    expect(visibility(g, 0)[B]).toBe(3); void A;
  });
  it('a computer power weighs offers by its interest; a weary one on several fronts takes a ceasefire', () => {
    const { g } = setup([0]);
    g.factions[1].ww = 0; applyCommand(g, 0, { t: 'offer', to: 1, kind: 'cease' }); expect(treatyOf(g, 0, 1)).toBeUndefined();
    g.factions[1].ww = 90; g.factions[1].mission = null; applyCommand(g, 0, { t: 'offer', to: 1, kind: 'cease' });
    expect(treatyOf(g, 0, 1)?.kind).toBe('cease');
  });
  it('quick phrases and treaties travel in snapshots', () => {
    const { g } = setup();
    expect(applyCommand(g, 0, { t: 'say', to: 1, p: 0 })).toBeNull(); expect(g.events.some(e => e.k === 'say')).toBe(true);
    applyCommand(g, 0, { t: 'offer', to: 1, kind: 'nap' });
    const m = createMirror(); initMirrorCapitals(m); applySnapshot(m, makeSnapshot(g, 1)); expect(m.offers.length).toBe(1);
    applyCommand(g, 1, { t: 'answer', id: g.offers[0].id, yes: true }); applySnapshot(m, makeSnapshot(g, 3)); expect(m.treaties.length).toBe(1);
  });
});

describe('review fixes', () => {
  it('rejects malformed commands from the network', () => {
    const { g, A } = setup(); const s = g.factions[0].supply;
    expect(applyCommand(g, 0, { t: 'produce', kind: 'shells', n: 'x' as unknown as number })).toBe('Invalid order.');
    expect(applyCommand(g, 0, { t: 'offer', to: 1, kind: 'toString' as never })).toBe('Invalid order.');
    expect(applyCommand(g, 0, { t: 'fortify', region: A, kind: 'toString' as never, sector: -1 })).toBe('Invalid order.');
    expect(applyCommand(g, 0, { t: 'recruit', region: A, unit: 'toString' as never })).toBe('Invalid order.');
    expect(applyCommand(g, 0, { t: 'march', from: A, to: 0, frac: NaN })).toBe('Invalid order.');
    expect(g.factions[0].supply).toBe(s);
  });
  it('a captured region stops striking; decoys look like real marches', () => {
    const { g, A, B } = setup(); g.regions[B].strike = true; g.regions[A].units = { ...emptyUnits(), inf: 12 }; g.regions[B].units = { ...emptyUnits(), inf: 1 }; fill(g);
    applyCommand(g, 0, { t: 'march', from: A, to: B, frac: .9 });
    for (let i = 0; i < 20 * 200 && g.regions[B].owner !== 0; i++) step(g, .05);
    expect(g.regions[B].owner).toBe(0); expect(g.regions[B].strike).toBe(false);
    applyCommand(g, 0, { t: 'decoy', from: A, to: B }); const d = fogView(g, 1).armies.find(a => a.from === A)!;
    expect(d.stance).toBeDefined(); expect(d.legs).toBe(1);
  });
  it('reinforcing an attack on a treaty partner needs the treaty broken', () => {
    const { g, A, B, C } = setup(); g.regions[A].units = { ...emptyUnits(), inf: 10 }; g.regions[C].units = { ...emptyUnits(), inf: 6 }; g.regions[B].units = { ...emptyUnits(), inf: 8 }; fill(g);
    applyCommand(g, 0, { t: 'march', from: A, to: B, frac: .5 }); for (let i = 0; i < 400 && !frontsOf(g, B).length; i++) step(g, .05);
    const b = frontsOf(g, B)[0]; g.treaties.push({ a: 0, b: 1, kind: 'nap' });
    expect(applyCommand(g, 0, { t: 'reinforce', from: C, battle: b.id, frac: .5 })).toMatch(/non-aggression/);
  });
  it('private messages and other powers\' offers are not sent to everyone', () => {
    const { g } = setup(); applyCommand(g, 0, { t: 'say', to: 1, p: 0 }); applyCommand(g, 0, { t: 'offer', to: 1, kind: 'nap' });
    const ev = g.events.slice();
    expect(eventsFor(g, ev, 1).map(e => e.k)).toEqual(expect.arrayContaining(['say', 'offer']));
    expect(eventsFor(g, ev, 3).some(e => e.k === 'say' || e.k === 'offer')).toBe(false);
  });
});
