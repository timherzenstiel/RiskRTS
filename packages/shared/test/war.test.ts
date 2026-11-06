// Border works, fronts, strength, supply lines, morale and fog of war.
import { describe, it, expect } from 'vitest';
import {
  FORMATION, UNIT_TYPES, WIRE_HP, applyCommand, autoDeploy, buildWorld, consolidate, createGame, emptyUnits, fogView, frontsOf, migrateState, run, slotsUsed, startBattle, step,
  updateSupplyLines, visibility, worksAt, income, dayOf, type GameState,
} from '../src';
import { setCs, strike } from './helpers';

const W = buildWorld();
const id = (n: string) => W.byName[n].id;
function fill(g: GameState) { for (const r of g.regions) for (const k of UNIT_TYPES) r.men[k] = r.units[k] * FORMATION[k].men; }
/** France (0) against Germany (1), everything else neutralised to power 2. */
function setup(seed = 21) {
  const g = createGame({ seed, humans: [0, 1, 2, 3, 4, 5, 6], settings: { attackCap: 0, pace: 0 } });
  for (const r of g.regions) { r.units = emptyUnits(); r.men = emptyUnits(); r.cs = undefined; r.defs = []; r.works = {}; r.owner = 2; r.home = 2; r.factory = false; }
  const A = id('France'), B = id('Germany');
  g.regions[A].owner = 0; g.regions[A].home = 0; g.regions[B].owner = 1; g.regions[B].home = 1;
  g.factions.forEach(f => { f.supply = 100; f.mission = null; });
  g.day = dayOf(1918, 6); // everything unlocked, fair weather
  updateSupplyLines(g);
  return { g, A, B };
}

describe('border works', () => {
  it('trenches, sandbags and wire are per border and share slots with defences', () => {
    const { g, A, B } = setup();
    const r = g.regions[B], other = W.regions[B].adj.find(i => i !== A && !W.seaLane.has(B + '|' + i))!;
    expect(applyCommand(g, 1, { t: 'fortify', region: B, kind: 'trench', sector: A })).toBeNull();
    expect(applyCommand(g, 1, { t: 'fortify', region: B, kind: 'trench', sector: A })).toBeNull();
    expect(worksAt(r, A).tr).toBe(2); expect(worksAt(r, other).tr).toBe(0);
    expect(applyCommand(g, 1, { t: 'fortify', region: B, kind: 'trench', sector: -1 })).toMatch(/border/);
    expect(applyCommand(g, 1, { t: 'fortify', region: B, kind: 'bunk', sector: A })).toBeNull();
    expect(applyCommand(g, 1, { t: 'fortify', region: B, kind: 'sand', sector: A })).toBeNull();
    expect(applyCommand(g, 1, { t: 'fortify', region: B, kind: 'wire', sector: A })).toBeNull();
    expect(slotsUsed(r, A)).toBe(4);
    expect(applyCommand(g, 1, { t: 'fortify', region: B, kind: 'pill', sector: A })).toMatch(/No room/);
    expect(applyCommand(g, 1, { t: 'fortify', region: B, kind: 'pill', sector: other })).toBeNull();
  });
  it('a battle over a border uses that border\'s works', () => {
    const { g, A, B } = setup();
    const r = g.regions[B]; r.works[A] = { tr: 3, sand: 2, wire: 2 }; r.units.inf = 4; fill(g);
    const b = startBattle(g, r, { x: 1, z: 0 }, 0, A);
    expect(b.tr).toBe(3); expect(b.sand).toBe(2); expect(b.wire).toBe(2 * WIRE_HP);
    const other = W.regions[B].adj.find(i => i !== A)!;
    const g2 = setup().g; g2.regions[B].works[A] = { tr: 3, sand: 2, wire: 2 };
    expect(startBattle(g2, g2.regions[B], { x: 1, z: 0 }, 0, other).tr).toBe(0);
  });
  it('wire slows the assault and gets cut', () => {
    const t = (wire: number) => {
      const { g, A, B } = setup(); g.regions[A].units = { ...emptyUnits(), inf: 14 }; g.regions[B].units = { ...emptyUnits(), inf: 5 };
      g.regions[B].works[A] = { tr: 0, sand: 0, wire }; fill(g);
      strike(g, 0, A, B);
      let s = 0; for (let i = 0; i < 20 * 600; i++) { step(g, .05); if (g.battles.some(b => b.region === B && b.ended)) break; s += .05; }
      return { s, left: g.regions[B].works[A]?.wire ?? 0 };
    };
    const none = t(0), two = t(2);
    expect(two.s).toBeGreaterThan(none.s);
    expect(two.left).toBeLessThan(2);
  });
});

describe('fronts', () => {
  it('a second attack over another border opens a second front that draws defenders', () => {
    const { g, A, B } = setup();
    const C = W.regions[B].adj.find(i => i !== A && !W.seaLane.has(B + '|' + i))!;
    g.regions[C].owner = 0; g.regions[C].home = 0;
    g.regions[A].units.inf = 10; g.regions[C].units.inf = 10; g.regions[B].units = { ...emptyUnits(), inf: 12, art: 2 }; fill(g);
    // the defenders stand on both borders
    g.regions[B].deploy = 1; setCs(g, B, [[A, { inf: 6, art: 1 }, { n: 1 }], [C, { inf: 6, art: 1 }, { n: 2 }]]);
    strike(g, 0, A, B, .5, 2, true); run(g, 6);
    expect(frontsOf(g, B).length).toBe(1);
    strike(g, 0, C, B, .5, 2, true); run(g, 6);
    const fr = frontsOf(g, B); expect(fr.length).toBe(2);
    const defs = fr.map(b => b.agents.filter(a => a.f === 1 && !a.dead && !a.out).length);
    expect(defs[0]).toBeGreaterThan(0); expect(defs[1]).toBeGreaterThan(0);
    expect(new Set(fr.map(b => b.from))).toEqual(new Set([A, C]));
    expect(applyCommand(g, 1, { t: 'shift', region: B, battle: fr[1].id })).toBeNull();
  });
  // Runs until the region changes hands: a beaten first wave can leave a short gap before the next one goes in.
  it('the region falls only when its last front ends', () => {
    const { g, A, B } = setup();
    const C = W.regions[B].adj.find(i => i !== A && !W.seaLane.has(B + '|' + i))!;
    g.regions[C].owner = 0; g.regions[C].home = 0;
    g.regions[A].units = { ...emptyUnits(), inf: 20, tank: 3 }; g.regions[C].units.inf = 8; g.regions[B].units = { ...emptyUnits(), inf: 6 }; fill(g);
    autoDeploy(g, g.regions[B], true); // the defenders stand on their borders
    applyCommand(g, 0, { t: 'march', from: C, to: B, frac: 1 }); run(g, 5);
    applyCommand(g, 0, { t: 'march', from: A, to: B, frac: 1 });
    let sawTwo = false, ownerDuring = true;
    for (let i = 0; i < 20 * 500; i++) { step(g, .05); const n = frontsOf(g, B).length; if (n === 2) sawTwo = true; if (n > 0 && g.regions[B].owner !== 1) ownerDuring = false; if (!n && sawTwo && g.regions[B].owner !== 1) break; }
    expect(sawTwo).toBe(true); expect(ownerDuring).toBe(true);
    expect(g.regions[B].owner).toBe(0);
  });
});

describe('strength, wounded and war weariness', () => {
  it('formations at half strength fight with half their hit points, battered ones merge', () => {
    const { g, A, B } = setup();
    g.regions[B].units.inf = 4; g.regions[B].men.inf = 200;
    const b = startBattle(g, g.regions[B], { x: 1, z: 0 }, 0, A);
    const inf = b.agents.filter(a => a.type === 'inf');
    expect(inf.length).toBe(4); expect(inf[0].hp).toBeCloseTo(5);
    const u = { ...emptyUnits(), inf: 6 }, m = { ...emptyUnits(), inf: 220 };
    consolidate(u, m); expect(u.inf).toBe(3); expect(m.inf).toBe(220);
  });
  it('battles cost men, feed the wounded pool and war weariness, and income falls with it', () => {
    const { g, A, B } = setup();
    g.regions[A].units.inf = 16; g.regions[B].units.inf = 8; fill(g);
    const inc0 = income(g, 0);
    applyCommand(g, 0, { t: 'march', from: A, to: B, frac: 1 });
    for (let i = 0; i < 20 * 400 && !g.battles.some(b => b.ended); i++) step(g, .05);
    expect(g.factions[0].wounded + g.factions[1].wounded).toBeGreaterThan(0);
    expect(g.factions[1].ww).toBeGreaterThan(0);
    g.factions[0].ww = 100; expect(income(g, 0)).toBeLessThan(inc0 + 10);
  });
});

describe('supply lines', () => {
  it('a conquered region with no route home is cut off, cannot recruit and wears down', () => {
    const { g, A, B } = setup();
    // India without its port: no route home over land or sea
    const far = id('India'); g.regions[far].owner = 0; g.regions[far].port = false; g.regions[far].units.inf = 4; fill(g);
    updateSupplyLines(g);
    expect(g.regions[far].cut).toBe(true); expect(g.regions[A].cut).toBe(false);
    expect(applyCommand(g, 0, { t: 'recruit', region: far, unit: 'inf' })).toMatch(/cut off/);
    const men = g.regions[far].men.inf; run(g, 41);
    expect(g.regions[far].men.inf).toBeLessThan(men);
    void B;
  });
});

describe('fog of war and reconnaissance', () => {
  it('hides troops and buildings beyond the border, shows an estimate next to it', () => {
    const { g, A, B } = setup();
    g.regions[B].units.inf = 9; g.regions[B].factory = true; g.regions[B].defs.push({ id: 991, k: 'pill', s: A, hp: 80, f: 1 });
    const other = W.regions[B].adj.find(i => i !== A)!; g.regions[B].defs.push({ id: 992, k: 'fort', s: other, hp: 60, f: 1 });
    const far = id('Japan'); g.regions[far].units.inf = 5; fill(g);
    const v = fogView(g, 0);
    expect(v.regions[A].vis).toBe(3);
    expect(v.regions[B].vis).toBe(1); expect(v.regions[B].units.inf).toBe(0); expect(v.regions[B].factory).toBe(false);
    const [lo, hi] = v.regions[B].est!; expect(lo).toBeLessThanOrEqual(900); expect(hi).toBeGreaterThanOrEqual(900);
    expect(v.regions[B].defs.map(d => d.id)).toEqual([991]); // only the defence facing France
    expect(v.regions[far].vis).toBe(0); expect(v.regions[far].units.inf).toBe(0); expect(v.regions[far].est).toBeUndefined();
  });
  it('a patrol reports troops and its border, a reconnaissance flight everything, a spy keeps watching', () => {
    const { g, A, B } = setup(33);
    g.regions[B].units.inf = 7; g.regions[B].barracks = true; fill(g);
    expect(applyCommand(g, 0, { t: 'patrol', from: A, to: B })).toBeNull();
    run(g, 6);
    const v = fogView(g, 0);
    const ok = g.intel[0][B];
    if (ok) { expect(v.regions[B].units.inf).toBe(7); expect(v.regions[B].barracks).toBe(false); }
    g.regions[A].airfield = true;
    expect(applyCommand(g, 0, { t: 'recon', from: A, to: B })).toBeNull();
    run(g, 6);
    if (g.intel[0][B]?.barracks) expect(fogView(g, 0).regions[B].barracks).toBe(true);
    const far = id('Japan');
    expect(applyCommand(g, 0, { t: 'spy', to: far })).toMatch(/capital/);
    for (const r of g.regions) if (r.capitalOf === 0) r.capitalOf = -1;
    g.regions[id('France')].capitalOf = 0;
    expect(applyCommand(g, 0, { t: 'spy', to: far })).toBeNull();
    run(g, 60);
    const vis = visibility(g, 0);
    const caught = !g.spies.some(s => s.f === 0);
    expect(caught || vis[far] === 3).toBe(true);
    expect(g.intel[0][far]).toBeTruthy();
  });
});

describe('saves', () => {
  it('a save from before the United States joined loads with them as a defeated power', () => {
    const g = createGame({ seed: 4, humans: [0] }); const old = JSON.parse(JSON.stringify(g)) as GameState & { v: number };
    old.factions.pop(); old.intel.pop(); for (const r of old.regions) if (r.owner === 6) { r.owner = 0; r.home = 0; if (r.capitalOf === 6) r.capitalOf = -1; }
    const m = migrateState(old)!;
    expect(m.factions.length).toBe(7); expect(m.factions[6].alive).toBe(false); expect(m.intel.length).toBe(7);
    expect(m.regions.some(r => r.owner === 6)).toBe(false);
  });
  it('migrates a version 2 save', () => {
    const g = createGame({ seed: 2, humans: [0] }) as unknown as Record<string, unknown> & GameState;
    const old = JSON.parse(JSON.stringify(g));
    old.v = 2; for (const r of old.regions) { r.trench = r.capitalOf >= 0 ? 2 : 0; delete r.works; delete r.men; delete r.mor; delete r.cut; delete r.home; }
    for (const f of old.factions) { delete f.ww; delete f.wounded; } delete old.intel; delete old.spies;
    const m = migrateState(old)!;
    expect(m.v).toBe(7); expect(m.intel.length).toBe(m.factions.length); expect(m.factions[0].shells).toBeGreaterThan(0);
    const cap = m.regions.find(r => r.capitalOf === 1)!;
    expect(Object.values(cap.works).some(w => w.tr === 2)).toBe(true);
    expect(cap.men.inf).toBe(cap.units.inf * 100);
    run(m, 30);
  });
});
