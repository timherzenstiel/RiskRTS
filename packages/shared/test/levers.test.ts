// Battle levers and shells: barrage, suppression, over the top, stance, reinforcements, withdrawal, after-action reports.
import { describe, it, expect } from 'vitest';
import {
  FORMATION, SHELLS, UNIT_TYPES, applyCommand, applySnapshot, buildWorld, createGame, createMirror, emptyUnits, frontsOf, initMirrorCapitals, makeSnapshot,
  run, shellIncome, step, updateSupplyLines, type Battle, type GameState,
} from '../src';
import { openFront } from './helpers';

const W = buildWorld();
const id = (n: string) => W.byName[n].id;
function fill(g: GameState) { for (const r of g.regions) for (const k of UNIT_TYPES) r.men[k] = r.units[k] * FORMATION[k].men; }
/** France (0) against Germany (1); every other region belongs to power 2 and is empty. */
function setup(seed = 21, pace = 1) {
  const g = createGame({ seed, humans: [0, 1, 2, 3, 4, 5, 6], settings: { attackCap: 0, pace } });
  for (const r of g.regions) { r.units = emptyUnits(); r.men = emptyUnits(); r.defs = []; r.works = {}; r.owner = 2; r.home = 2; r.factory = false; r.capitalOf = -1; }
  const A = id('France'), B = id('Germany');
  g.regions[A].owner = 0; g.regions[A].home = 0; g.regions[B].owner = 1; g.regions[B].home = 1;
  g.factions.forEach(f => { f.supply = 100; f.mission = null; f.shells = 200; });
  updateSupplyLines(g);
  return { g, A, B };
}
/** March from A on B and run until the battle opens. */
function open(g: GameState, A: number, B: number, frac = 1): Battle { return openFront(g, 0, A, B, frac); }
const attackers = (b: Battle) => b.agents.filter(a => a.f === b.attacker && !a.dead && !a.out && a.type === 'inf');
const along = (b: Battle) => Math.min(...attackers(b).map(a => a.x * b.ax + a.z * b.az));

describe('over the top', () => {
  it('attackers with guns hold the start line until ordered over the top', () => {
    const { g, A, B } = setup();
    g.regions[A].units = { ...emptyUnits(), inf: 8, art: 2 }; g.regions[B].units = { ...emptyUnits(), inf: 4 }; g.regions[B].works[A] = { tr: 2, sand: 0, wire: 1 }; fill(g);
    const b = open(g, A, B);
    run(g, 10); expect(b.go).toBe(false);
    const x0 = along(b); run(g, 10); expect(along(b)).toBeGreaterThan(x0 - .5); // still waiting
    expect(applyCommand(g, 1, { t: 'charge', battle: b.id })).toMatch(/attackers/);
    expect(applyCommand(g, 0, { t: 'charge', battle: b.id })).toBeNull();
    expect(b.go).toBe(true);
    run(g, 6); expect(along(b)).toBeLessThan(x0 - 3);
  });
  it('attackers without guns go at once; with guns they go on their own at the pace\'s latest time', () => {
    const s1 = setup(); s1.g.regions[s1.A].units = { ...emptyUnits(), inf: 8 }; s1.g.regions[s1.B].units = { ...emptyUnits(), inf: 3 }; fill(s1.g);
    const b1 = open(s1.g, s1.A, s1.B); run(s1.g, 1); expect(b1.go).toBe(true);
    const s2 = setup(22, 0); s2.g.regions[s2.A].units = { ...emptyUnits(), inf: 8, art: 2 }; s2.g.regions[s2.B].units = { ...emptyUnits(), inf: 3 }; fill(s2.g);
    s2.g.regions[s2.B].units = { ...emptyUnits(), inf: 12, mg: 3 }; s2.g.regions[s2.B].works[s2.A] = { tr: 3, sand: 2, wire: 0 }; fill(s2.g);
    const b2 = open(s2.g, s2.A, s2.B); run(s2.g, 30); expect(b2.go).toBe(false); run(s2.g, 15); expect(b2.go).toBe(true);
  });
});

describe('barrage, shells and suppression', () => {
  const shell = (level: 0 | 1 | 2, stock = 200) => {
    const { g, A, B } = setup(); g.factions[0].shells = stock;
    g.regions[A].units = { ...emptyUnits(), inf: 6, art: 3 }; g.regions[B].units = { ...emptyUnits(), inf: 14, mg: 4 }; g.regions[B].works[A] = { tr: 3, sand: 2, wire: 0 }; fill(g);
    const b = open(g, A, B);
    expect(applyCommand(g, 0, { t: 'barrage', battle: b.id, level })).toBeNull();
    let peak = 0; for (let i = 0; i < 20 * 40; i++) { step(g, .05); peak = Math.max(peak, b.supp[1] ?? 0); }
    expect(b.ended).toBe(false);
    return { used: b.used[0] ?? 0, peak, lost: b.lost[1] ?? 0, left: g.factions[0].shells, b, g };
  };
  it('holding fire saves shells; a heavy barrage burns more and pins the defenders down harder', () => {
    const off = shell(0), light = shell(1), heavy = shell(2);
    expect(off.used).toBe(0); expect(off.peak).toBe(0);
    expect(light.used).toBeGreaterThan(5); expect(heavy.used).toBeGreaterThan(light.used * 1.4);
    expect(heavy.peak).toBeGreaterThan(light.peak); expect(light.peak).toBeGreaterThan(20);
    expect(heavy.lost).toBeGreaterThan(light.lost);
  });
  it('guns out of shells fire rationed, for free', () => {
    const dry = shell(2, 0), full = shell(2);
    expect(dry.used).toBeLessThanOrEqual(2 * SHELLS.base + .01); // only what the convoys brought
    expect(dry.lost).toBeGreaterThan(0); expect(dry.lost).toBeLessThan(full.lost);
  });
  it('suppression fades when the guns fall silent', () => {
    // the same front twice: one keeps firing, one falls silent; the silenced defenders recover
    const quiet = shell(2), loud = shell(2), before = quiet.b.supp[1];
    applyCommand(quiet.g, 0, { t: 'barrage', battle: quiet.b.id, level: 0 }); run(quiet.g, 20); run(loud.g, 20);
    expect(quiet.b.supp[1]).toBeLessThan(before * .8);
    expect(quiet.b.supp[1]).toBeLessThan((loud.b.supp[1] ?? 0) * .7);
  });
  it('factories and the capital produce shells; supply buys more', () => {
    const { g, A } = setup(); g.regions[A].factory = true; g.regions[A].capitalOf = 0;
    expect(shellIncome(g, 0)).toBe(SHELLS.base + SHELLS.factory + SHELLS.capital);
    const s0 = g.factions[0].shells; run(g, 20.1); expect(g.factions[0].shells).toBe(s0 + shellIncome(g, 0));
    expect(applyCommand(g, 0, { t: 'produce', kind: 'shells', n: 5 })).toBeNull();
    expect(g.factions[0].shells).toBe(s0 + shellIncome(g, 0) + 5 * SHELLS.perSupply);
  });
});

describe('stance', () => {
  const fight = (st: 0 | 1 | 2 | 3) => {
    const { g, A, B } = setup(31);
    g.regions[A].units = { ...emptyUnits(), inf: 10 }; g.regions[B].units = { ...emptyUnits(), inf: 6 }; g.regions[B].works[A] = { tr: 1, sand: 0, wire: 0 }; fill(g);
    expect(applyCommand(g, 1, { t: 'stance', region: B, s: st })).toBeNull();
    const b = open(g, A, B); run(g, 25);
    return { def: b.lost[1] ?? 0, att: b.lost[0] ?? 0, b, g };
  };
  it('defensive troops lose fewer men, aggressive ones more but hit harder', () => {
    const bal = fight(0), def = fight(2), agg = fight(1);
    expect(def.def).toBeLessThan(bal.def);
    expect(agg.def).toBeGreaterThan(bal.def); expect(agg.att).toBeGreaterThan(bal.att * .9);
  });
  it('troops holding at all costs cannot be withdrawn', () => {
    const h = fight(3);
    expect(applyCommand(h.g, 1, { t: 'withdraw', battle: h.b.id })).toMatch(/hold at all costs/);
    expect(applyCommand(h.g, 1, { t: 'stance', region: id('Germany'), s: 0 })).toBeNull();
  });
});

describe('reserves and retreat', () => {
  it('reinforce sends troops from a neighbouring region straight into one front', () => {
    const { g, A, B } = setup();
    const C = W.regions[B].adj.find(i => i !== A && !W.seaLane.has(B + '|' + i))!; g.regions[C].owner = 1;
    g.regions[A].units = { ...emptyUnits(), inf: 10, art: 1 }; g.regions[B].units = { ...emptyUnits(), inf: 3 }; g.regions[C].units = { ...emptyUnits(), inf: 6 }; fill(g);
    updateSupplyLines(g);
    const b = open(g, A, B); const n0 = b.agents.filter(a => a.f === 1).length;
    expect(applyCommand(g, 1, { t: 'reinforce', from: C, battle: b.id, frac: .5 })).toBeNull();
    for (let i = 0; i < 20 * 20 && b.agents.filter(a => a.f === 1).length === n0; i++) step(g, .05);
    expect(b.agents.filter(a => a.f === 1).length).toBeGreaterThan(n0);
    expect(frontsOf(g, B).length).toBe(1);
  });
  it('attackers who withdraw march back home with their men; defenders who withdraw give up the region', () => {
    const { g, A, B } = setup();
    g.regions[A].units = { ...emptyUnits(), inf: 8, art: 2 }; g.regions[B].units = { ...emptyUnits(), inf: 3 }; fill(g);
    const b = open(g, A, B); run(g, 5);
    const left = g.regions[A].units.inf;
    expect(applyCommand(g, 0, { t: 'withdraw', battle: b.id })).toBeNull();
    run(g, 15);
    expect(g.regions[A].units.inf).toBeGreaterThan(left + 4);
    expect(g.regions[B].owner).toBe(1);
    expect(g.reports.some(r => r.region === B)).toBe(true);

    const s = setup(); const C = W.regions[s.B].adj.find(i => i !== s.A && !W.seaLane.has(s.B + '|' + i))!; s.g.regions[C].owner = 1;
    s.g.regions[s.A].units = { ...emptyUnits(), inf: 8 }; s.g.regions[s.B].units = { ...emptyUnits(), inf: 5 }; fill(s.g); updateSupplyLines(s.g);
    const b2 = open(s.g, s.A, s.B);
    expect(applyCommand(s.g, 1, { t: 'withdraw', battle: b2.id })).toBeNull();
    run(s.g, 90);
    expect(s.g.regions[s.B].owner).toBe(0);
    expect(s.g.regions[C].units.inf).toBeGreaterThan(3);
  });
});

describe('fatigue and reports', () => {
  it('troops that marched three borders in a row arrive tired', () => {
    const { g, A, B } = setup();
    g.regions[A].units = { ...emptyUnits(), inf: 6 }; g.regions[A].mor = 80; g.regions[A].legs = 2; g.regions[A].arrT = g.time; fill(g);
    g.regions[B].units = { ...emptyUnits(), inf: 2 }; fill(g);
    const b = open(g, A, B);
    expect(b.mor0[0]).toBeLessThanOrEqual(80 - 15 + .01);
  });
  it('an after-action report lists losses by type, shells and how far the attackers got', () => {
    const { g, A, B } = setup();
    g.regions[A].units = { ...emptyUnits(), inf: 14, art: 2 }; g.regions[B].units = { ...emptyUnits(), inf: 3, mg: 1 }; fill(g);
    const b = open(g, A, B); applyCommand(g, 0, { t: 'charge', battle: b.id });
    for (let i = 0; i < 20 * 300 && !b.ended; i++) step(g, .05);
    const r = g.reports.find(x => x.id === b.id)!;
    expect(r).toBeTruthy(); expect(r.winner).toBe(0); expect(r.reach).toBe(3);
    const def = r.sides.find(s => s.f === 1)!; expect(def.lost.inf + def.lost.mg).toBeGreaterThan(100);
    expect(r.sides.find(s => s.f === 0)!.shells).toBeGreaterThan(0);
  });
});

describe('network', () => {
  it('snapshots carry levers, shells and reports', () => {
    const { g, A, B } = setup();
    g.regions[A].units = { ...emptyUnits(), inf: 8, art: 2 }; g.regions[B].units = { ...emptyUnits(), inf: 3 }; fill(g);
    const b = open(g, A, B); applyCommand(g, 0, { t: 'barrage', battle: b.id, level: 2 }); applyCommand(g, 0, { t: 'stance', region: A, s: 1 }); run(g, 10);
    const m = createMirror(); initMirrorCapitals(m); applySnapshot(m, makeSnapshot(g, 0, [b.id]));
    const mb = m.battles.find(x => x.id === b.id)!;
    expect(mb.bar[0]).toBe(2); expect(mb.supp[1]).toBeGreaterThan(0); expect(m.factions[0].shells).toBe(Math.floor(g.factions[0].shells));
    expect(m.regions[A].stance).toBe(1);
  });
});
