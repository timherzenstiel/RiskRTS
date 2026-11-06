// Corps as formations: own men, morale and experience, at most CORPS_CAP battalions, several per post, identity kept on the
// march and through battle, player orders (move, attack, detach, merge, form), Auto leaving the player's corps alone, saves.
import { describe, it, expect } from 'vitest';
import {
  CORPS_CAP, FORMATION, UNIT_TYPES, applyCommand, autoDeploy, buildWorld, corpsAtPost, corpsIn, createGame, depotOf, emptyUnits, findCorps,
  frontsOf, groundUnits, marchEta, migrateState, run, step, updateSupplyLines, type GameState,
} from '../src';
import { setCs } from './helpers';

const W = buildWorld();
const id = (n: string) => W.byName[n].id;
const fill = (g: GameState) => { for (const r of g.regions) for (const k of UNIT_TYPES) r.men[k] = r.units[k] * FORMATION[k].men; };
/** France (0) against Germany (1); everything else belongs to power 2 and is empty. */
function setup() {
  const g = createGame({ seed: 4, humans: [0, 1, 2, 3, 4, 5, 6], settings: { attackCap: 0, pace: 0 } });
  for (const r of g.regions) { r.units = emptyUnits(); r.men = emptyUnits(); r.cs = undefined; r.defs = []; r.works = {}; r.owner = 2; r.home = 2; r.factory = false; r.capitalOf = -1; r.barracks = false; }
  const A = id('France'), B = id('Germany');
  g.regions[A].owner = 0; g.regions[A].home = 0; g.regions[B].owner = 1; g.regions[B].home = 1;
  g.factions.forEach(f => { f.supply = 100; f.mission = null; f.shells = 300; });
  updateSupplyLines(g);
  return { g, A, B };
}

describe('corps', () => {
  it('Auto spreads a large garrison over several corps of at most 20 battalions', () => {
    const { g, A, B } = setup(); for (const n of W.regions[A].adj) if (n !== B) g.regions[n].owner = 0;
    for (const r of g.regions) r.port = false; g.fleets = []; // no threat from the sea
    g.regions[A].units.inf = 80; fill(g);
    autoDeploy(g, g.regions[A], true);
    const here = corpsAtPost(g.regions[A], B);
    expect(here.length).toBeGreaterThan(1);
    for (const c of corpsIn(g.regions[A])) expect(groundUnits(c.u)).toBeLessThanOrEqual(CORPS_CAP);
    expect(new Set(corpsIn(g.regions[A]).map(c => c.id)).size).toBe(corpsIn(g.regions[A]).length);
    expect(depotOf(g.regions[A]).u.inf).toBeGreaterThan(0);
  });

  it('a corps keeps its men, morale and experience; losses elsewhere in the region do not touch it', () => {
    const { g, A, B } = setup(); g.regions[A].units.inf = 10; fill(g); g.regions[A].deploy = 1;
    const [c] = setCs(g, A, [[B, { inf: 4 }, { mor: 55, xp: 2, man: true }]]);
    c.m.inf = 300;
    g.regions[A].men.inf = 300 + 6 * 100;
    run(g, 1);
    expect(c.m.inf).toBe(300); expect(c.mor).toBe(55); expect(c.xp).toBe(2);
    expect(depotOf(g.regions[A]).m.inf).toBe(600);
  });

  it('moving a corps keeps its identity and makes it the player\'s; Auto leaves it alone', () => {
    const { g, A, B } = setup(); const C = id('Iberia'); g.regions[C].owner = 0;
    g.regions[A].units.inf = 12; fill(g);
    const [c] = setCs(g, A, [[B, { inf: 6 }, { xp: 1 }]]);
    expect(applyCommand(g, 0, { t: 'moveCorps', region: A, id: c.id, to: C, toPost: -1 })).toBeNull();
    expect(g.armies[0].ct?.id).toBe(c.id);
    run(g, g.armies[0].dur + 1);
    const got = findCorps(g, 0, c.id);
    expect(got?.r.id).toBe(C); expect(got?.c.p).toBe(-1); expect(got?.c.man).toBe(true); expect(got?.c.xp).toBe(1);
    // Auto runs on C and keeps its hands off the reserve corps
    autoDeploy(g, g.regions[C]); run(g, 1);
    expect(findCorps(g, 0, c.id)?.c.u.inf).toBe(6);
  });

  it('detach, merge and form', () => {
    const { g, A, B } = setup(); g.regions[A].units.inf = 30; fill(g); g.regions[A].deploy = 1;
    const [a, b] = setCs(g, A, [[B, { inf: 12 }], [B, { inf: 10 }]]);
    expect(applyCommand(g, 0, { t: 'merge', region: A, a: a.id, b: b.id })).toMatch(/at most 20/);
    expect(applyCommand(g, 0, { t: 'detach', region: A, id: a.id, u: { inf: 12 } })).toMatch(/at least one/);
    expect(applyCommand(g, 0, { t: 'detach', region: A, id: a.id, u: { inf: 4 } })).toBeNull();
    expect(corpsAtPost(g.regions[A], B).length).toBe(3); expect(a.u.inf).toBe(8);
    expect(applyCommand(g, 0, { t: 'merge', region: A, a: a.id, b: b.id })).toBeNull();
    expect(a.u.inf).toBe(18); expect(a.m.inf).toBe(1800); expect(corpsAtPost(g.regions[A], B).length).toBe(2);
    expect(applyCommand(g, 0, { t: 'form', region: A, u: { inf: 9 } })).toMatch(/depot does not have/);
    expect(applyCommand(g, 0, { t: 'form', region: A, u: { inf: 8 } })).toBeNull();
    const res = corpsAtPost(g.regions[A], -1); expect(res.length).toBe(1); expect(res[0].man).toBe(true); expect(res[0].u.inf).toBe(8);
    expect(groundUnits(g.regions[A].units)).toBe(30);
  });

  it('a corps ordered to attack moves up, wins, gains a star and stands in the conquered region', () => {
    const { g, A, B } = setup(); g.regions[A].units = { ...emptyUnits(), inf: 22, art: 2 }; g.regions[B].units.inf = 2; fill(g); g.regions[A].deploy = 1; g.regions[B].deploy = 1;
    const [c] = setCs(g, A, [[-1, { inf: 18, art: 2 }, { man: true }]]);
    setCs(g, B, [[A, { inf: 2 }]]);
    expect(applyCommand(g, 0, { t: 'attackCorps', region: A, id: c.id, to: B, goal: 2 })).toBeNull();
    for (let i = 0; i < 20 * 120 && !frontsOf(g, B).length; i++) step(g, .05);
    const b = frontsOf(g, B)[0]; expect(b).toBeTruthy();
    expect(b.ct?.[c.id]).toBeTruthy();
    expect(b.agents.filter(x => x.f === 0 && x.c === c.id).length).toBeGreaterThan(15);
    for (let i = 0; i < 20 * 600 && !b.ended; i++) step(g, .05);
    expect(g.regions[B].owner).toBe(0);
    const got = findCorps(g, 0, c.id);
    expect(got?.r.id).toBe(B); expect(got?.c.xp).toBe(1);
  });

  it('orders are checked', () => {
    const { g, A, B } = setup(); g.regions[A].units.inf = 6; fill(g);
    const [c] = setCs(g, A, [[B, { inf: 3 }]]);
    expect(applyCommand(g, 0, { t: 'moveCorps', region: A, id: 999999, to: A, toPost: -1 })).toMatch(/not in this region/);
    expect(applyCommand(g, 0, { t: 'moveCorps', region: A, id: c.id, to: B, toPost: -1 })).toMatch(/not yours/);
    expect(applyCommand(g, 0, { t: 'moveCorps', region: A, id: c.id, to: A, toPost: B })).toMatch(/already there/);
    expect(applyCommand(g, 0, { t: 'attackCorps', region: A, id: c.id, to: A, goal: 2 })).toMatch(/not an enemy/);
    expect(applyCommand(g, 1, { t: 'corpsSet', region: A, id: c.id, st: 2 })).toMatch(/own regions/);
    expect(applyCommand(g, 0, { t: 'corpsSet', region: A, id: c.id, st: 2 })).toBeNull(); expect(c.st).toBe(2);
    expect(applyCommand(g, 0, { t: 'detach', region: A, id: c.id, u: { inf: -1 } as never })).toMatch(/Invalid/);
  });

  it('a version 6 save turns its border corps into corps of their own, split at 20 battalions', () => {
    const g = createGame({ seed: 9, humans: [0] });
    const old = JSON.parse(JSON.stringify(g)); old.v = 6;
    const A = id('France'), B = id('Germany');
    for (const r of old.regions) delete r.cs;
    const r = old.regions[A]; r.units = { ...emptyUnits(), inf: 40 }; r.men = { ...emptyUnits(), inf: 2000 }; r.mor = 66;
    r.fr = { [B]: { u: { ...emptyUnits(), inf: 30 }, n: 5, ord: 0 } };
    const m = migrateState(old)!;
    expect(m.v).toBe(7);
    const here = corpsAtPost(m.regions[A], B);
    expect(here.map(c => c.u.inf).sort()).toEqual([10, 20]);
    expect(here.some(c => c.n === 5)).toBe(true);
    expect(here.reduce((s, c) => s + c.m.inf, 0)).toBe(1500);
    expect(here[0].mor).toBe(66);
    expect((m.regions[A] as unknown as { fr?: unknown }).fr).toBeUndefined();
  });

  it('in a war between computer powers corps never hold more than their region, nor more than 20 battalions', () => {
    const g = createGame({ seed: 12, humans: [] });
    let checks = 0, ids = 0;
    for (let t = 0; t < 900; t += 30) {
      run(g, 30);
      for (const r of g.regions) {
        const seen = new Set<number>();
        for (const c of corpsIn(r)) {
          expect(groundUnits(c.u)).toBeLessThanOrEqual(CORPS_CAP); expect(groundUnits(c.u)).toBeGreaterThan(0);
          expect(seen.has(c.id)).toBe(false); seen.add(c.id); ids++;
          for (const k of UNIT_TYPES) expect(c.m[k]).toBeLessThanOrEqual(c.u[k] * FORMATION[k].men + 1e-6);
        }
        const d = depotOf(r);
        for (const k of UNIT_TYPES) { const sum = corpsIn(r).reduce((s, c) => s + c.u[k], 0); expect(sum).toBeLessThanOrEqual(r.units[k]); expect(d.u[k]).toBeGreaterThanOrEqual(0); }
        checks++;
      }
    }
    expect(checks).toBeGreaterThan(0); expect(ids).toBeGreaterThan(100);
    expect(g.battles.length + g.reports.length).toBeGreaterThan(0);
  }, 120000);

  it('march times: within a region, through own land (longer the further), none through enemy land', () => {
    const { g, A, B } = setup(); const C = id('Iberia'); g.regions[C].owner = 0;
    const inner = marchEta(g, 0, A, -1, A, B)!, out = marchEta(g, 0, A, -1, C, -1)!;
    expect(inner).toBeGreaterThan(0); expect(out).toBeGreaterThan(inner);
    expect(marchEta(g, 0, A, -1, B, -1)).toBeNull();
  });
});

