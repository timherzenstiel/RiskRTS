// Computer powers with armies: one army per front with several hostile borders, the Auto corps on its borders under the
// commander, armies disbanded when the front goes quiet (corps back to region Auto), and the war minister's answers.
import { describe, it, expect } from 'vitest';
import {
  AI_ARMY, FORMATION, UNIT_TYPES, aiArmies, buildWorld, corpsIn, createGame, emptyUnits, fogView, frontsOfPower, newHq, run, unitCost,
  updateSupplyLines, warMinister, type GameState, type Req,
} from '../src';
import { setCs } from './helpers';

const W = buildWorld();
const id = (n: string) => W.byName[n].id;
const fill = (g: GameState) => { for (const r of g.regions) for (const k of UNIT_TYPES) r.men[k] = r.units[k] * FORMATION[k].men; };
/** Germany (1, computer) surrounded by France (0) on all four land borders; everything else unowned. */
function setup() {
  const g = createGame({ seed: 9, humans: [0, 2, 3, 4, 5, 6], settings: { attackCap: 0, pace: 1 } });
  for (const r of g.regions) { r.units = emptyUnits(); r.men = emptyUnits(); r.cs = undefined; r.defs = []; r.works = {}; r.owner = -1; r.home = -1; r.factory = false; r.capitalOf = -1; r.port = false; r.deploy = 1; }
  g.ships = []; g.fleets = [];
  const B = id('Germany');
  g.regions[B].owner = 1; g.regions[B].home = 1; g.regions[B].capitalOf = 1;
  for (const n of W.regions[B].land) { g.regions[n].owner = 0; g.regions[n].home = 0; }
  g.factions.forEach(f => { f.supply = 100; f.mission = null; f.shells = 300; f.men = 5000; });
  updateSupplyLines(g);
  return { g, B, F: g.factions[1] };
}
const req = (g: GameState, o: Partial<Req> & Pick<Req, 'kind' | 'army' | 'region' | 'sector'>): Req => {
  const q: Req = { id: g.nextId++, owner: 1, key: o.kind + '|' + g.nextId, urg: 1, at: g.time, ...o };
  (g.requests ??= []).push(q); return q;
};

describe('computer armies', () => {
  it('a front with several hostile borders gets an army; the Auto corps on its borders come under the commander', () => {
    const { g, B, F } = setup();
    const nbs = W.regions[B].land; g.regions[B].units.inf = 4 * nbs.length; fill(g);
    setCs(g, B, nbs.map(n => [n, { inf: 4 }] as [number, { inf: number }]));
    expect(frontsOfPower(fogView(g, 1), 1)[0].borders).toBe(nbs.length);
    aiArmies(g, F, fogView(g, 1));
    const h = (g.hq ?? []).find(x => x.owner === 1)!;
    expect(h).toBeTruthy(); expect(h.front).toEqual([B]); expect(h.standing).toEqual(['fort', 'recon']); expect(h.budget).toBe(AI_ARMY.budget);
    expect(corpsIn(g.regions[B]).every(c => c.army === h.id)).toBe(true);
    // a second look keeps the same army
    aiArmies(g, F, fogView(g, 1)); expect((g.hq ?? []).filter(x => x.owner === 1).length).toBe(1);
    // the front goes quiet: the army is disbanded and its corps go back to the region's Auto, not to manual orders
    for (const n of nbs) g.regions[n].owner = 1;
    aiArmies(g, F, fogView(g, 1));
    expect((g.hq ?? []).some(x => x.owner === 1)).toBe(false);
    expect(corpsIn(g.regions[B]).every(c => c.army === undefined && !c.man)).toBe(true);
  });

  it('a front with too few hostile borders gets none, and human powers never get computer armies', () => {
    const { g, B, F } = setup();
    for (const n of W.regions[B].land.slice(AI_ARMY.minBorders - 1)) g.regions[n].owner = -1;
    aiArmies(g, F, fogView(g, 1));
    expect(g.hq ?? []).toEqual([]);
    run(g, 30);
    expect((g.hq ?? []).some(h => h.owner === 0)).toBe(false);
  });

  it('the war minister recruits for urgent men, pays for works, and sends corps back only across a treaty', () => {
    const { g, B, F } = setup(); const A = W.regions[B].land[0];
    g.regions[B].units.inf = 8; fill(g);
    const [c1, c2] = setCs(g, B, [[A, { inf: 4 }], [W.regions[B].land[1], { inf: 4 }]]);
    const h = newHq(g, 1, [B]); c1.army = h.id; c2.army = h.id;
    const cost = unitCost(g, 1, 'inf');
    req(g, { kind: 'men', army: h.id, region: B, sector: A, n: 2, cost, urg: 2 });
    req(g, { kind: 'fort', army: h.id, region: B, sector: A, fort: 'trench', cost: 2 });
    const safe = req(g, { kind: 'release', army: h.id, region: B, sector: c2.p, corps: [c2.id], why: 'safe' });
    req(g, { kind: 'release', army: h.id, region: B, sector: c1.p, corps: [c1.id], why: 'peace' });
    warMinister(g, F);
    expect(g.regions[B].train?.filter(t => t.p === A && t.army === h.id).length).toBe(2);
    expect(g.regions[B].works[A]?.tr).toBe(1);
    expect(h.deny[safe.key]).toBeGreaterThan(g.time); expect(c2.army).toBe(h.id);
    expect(c1.army).toBeUndefined(); expect(c1.man).toBeFalsy();
    expect(g.requests).toEqual([]);
  });

  it('attacks only on odds that suit the nation; hopeless ones are turned down', () => {
    const { g, B, F } = setup(); const A = W.regions[B].land[0];
    g.regions[B].units.inf = 12; fill(g);
    const [c] = setCs(g, B, [[A, { inf: 12 }]]);
    const h = newHq(g, 1, [B]); c.army = h.id;
    const bad = req(g, { kind: 'attack', army: h.id, region: B, sector: A, corps: [c.id], goal: 1, ratio: .6 });
    warMinister(g, F);
    expect(h.deny[bad.key]).toBeGreaterThan(g.time); expect(c.ord ?? 0).toBe(0);
    for (let i = 0; i < 20 && (c.ord ?? 0) === 0; i++) { req(g, { kind: 'attack', army: h.id, region: B, sector: A, corps: [c.id], goal: 1, ratio: 4 }); warMinister(g, F); }
    expect(c.ord).toBe(1);
  });
});
