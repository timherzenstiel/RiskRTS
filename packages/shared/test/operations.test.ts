// Operations (design-play §3.3): the plan a commander on the Attack mandate offers, approving it (with more corps), putting
// it off, the battle it starts, the result card and the star, and computer powers using the same plans.
import { describe, it, expect } from 'vitest';
import {
  FORMATION, OP, UNIT_TYPES, aiArmies, applyCommand, applySnapshot, buildWorld, corpsIn, createGame, createMirror, emptyUnits, fogView, makeSnapshot, opOdds, planOp, recordIntel, run,
  updateSupplyLines, warMinister, type GameState, type Hq,
} from '../src';
import { setCs } from './helpers';

const W = buildWorld();
const id = (n: string) => W.byName[n].id;
const fill = (g: GameState) => { for (const r of g.regions) for (const k of UNIT_TYPES) r.men[k] = r.units[k] * FORMATION[k].men; };
function setup(ours = 20, theirs = 4) {
  const g = createGame({ seed: 7, humans: [0, 1, 2, 3, 4, 5, 6], settings: { attackCap: 0, pace: 0 } });
  for (const r of g.regions) { r.units = emptyUnits(); r.men = emptyUnits(); r.cs = undefined; r.defs = []; r.works = {}; r.owner = 2; r.home = 2; r.factory = false; r.capitalOf = -1; r.port = false; r.deploy = 1; }
  g.ships = []; g.fleets = [];
  const A = id('France'), B = id('Germany');
  for (const n of W.regions[A].adj) g.regions[n].owner = 0;
  g.regions[A].owner = 0; g.regions[A].home = 0; g.regions[A].capitalOf = 0; g.regions[B].owner = 1; g.regions[B].home = 1; g.regions[B].capitalOf = 1;
  g.factions.forEach(f => { f.supply = 100; f.mission = null; f.shells = 3000; f.men = 50000; });
  g.regions[A].units.inf = ours; g.regions[A].units.art = 2; g.regions[B].units.inf = theirs; fill(g);
  setCs(g, A, [[B, { inf: ours, art: 2 }]]); setCs(g, B, [[A, { inf: theirs }]]);
  updateSupplyLines(g);
  return { g, A, B };
}
function offensive(g: GameState, A: number, B: number): Hq {
  expect(applyCommand(g, 0, { t: 'army', corps: corpsIn(g.regions[A]).map(c => c.id) })).toBeNull();
  const h = g.hq![g.hq!.length - 1]; h.cmd.tr = ['insp', 'insp'];
  expect(applyCommand(g, 0, { t: 'armySet', army: h.id, target: B })).toBeNull();
  recordIntel(g, 0, B);
  return h;
}
const plans = (g: GameState) => (g.requests ?? []).filter(q => q.kind === 'op');

describe('operations', () => {
  it('odds rise with the strength ratio', () => {
    expect(opOdds(OP.even)).toBeCloseTo(.5, 5);
    expect(opOdds(1)).toBeLessThan(.3); expect(opOdds(9)).toBeGreaterThan(.75); expect(opOdds(0)).toBe(0);
  });

  it('on the Attack mandate the commander offers a plan instead of asking to attack', () => {
    const { g, A, B } = setup();
    offensive(g, A, B);
    run(g, 4);
    expect((g.requests ?? []).some(q => q.kind === 'attack')).toBe(false);
    const q = plans(g)[0];
    expect(q).toBeTruthy(); expect(q.name).toBeTruthy(); expect(q.sector).toBe(B);
    expect(q.op!.btl).toBe(22); expect(q.op!.p).toBeGreaterThan(.5); expect(q.op!.loss).toBeGreaterThan(0);
    expect(q.op!.shells).toBeGreaterThan(0); expect(q.op!.heavy).toBe(true); expect(q.op!.days).toBeGreaterThan(0);
  });

  it('approved, the army attacks by itself, and the result card compares plan and outcome', () => {
    const { g, A, B } = setup();
    const h = offensive(g, A, B);
    run(g, 4);
    const q = plans(g)[0];
    expect(applyCommand(g, 0, { t: 'reply', req: q.id, opt: 'yes' })).toBeNull();
    expect(h.op?.status).toBe('go'); expect(corpsIn(g.regions[A]).some(c => c.ord === 2)).toBe(true);
    expect(g.events.some(e => e.k === 'op' && e.what === 'approved')).toBe(true);
    // no second plan while one runs
    let fought = false, heavy = false;
    for (let i = 0; i < 400 && h.op; i++) {
      run(g, 2);
      expect(plans(g).length).toBe(0);
      const b = g.battles.find(x => !x.ended && x.region === B && x.attacker === 0);
      if (b) { fought = true; if (b.bar[0] === 2) heavy = true; }
    }
    expect(fought).toBe(true); expect(heavy).toBe(true);
    expect(h.op).toBeUndefined();
    const res = g.ops![g.ops!.length - 1];
    expect(res.name).toBe(q.name); expect(res.plan.p).toBe(q.op!.p); expect(res.army).toBe(h.id);
    expect(res.taken).toBe(g.regions[B].owner === 0); expect(res.ok).toBe(res.taken);
    expect(res.star).toBe(res.ok ? 1 : -1);
    if (res.ok) expect(Math.floor(h.cmd.xp)).toBeGreaterThanOrEqual(1);
    expect(res.shells).toBeGreaterThan(0);
  }, 60000);

  it('a plan short of men offers the player\'s free corps, and approving with them gathers first', () => {
    const { g, A, B } = setup(8, 4);
    // a corps of the player's own in a neighbouring French region
    const N = W.regions[A].land.find(j => g.regions[j].owner === 0)!;
    g.regions[N].units.inf = 12; fill(g); setCs(g, N, [[-1, { inf: 8 }, { man: true }]]);
    const h = offensive(g, A, B);
    run(g, 4);
    const q = plans(g)[0];
    expect(q).toBeTruthy();
    // at a thinner margin the plan asks for the player's corps nearby
    q.op = planOp(g, h, A, B, corpsIn(g.regions[A]), [3, 6], 1.8);
    expect(q.op!.more).toBe(1); expect(q.op!.moreBtl).toBe(8); expect(q.op!.pMore).toBeGreaterThan(q.op!.p);
    expect(applyCommand(g, 0, { t: 'reply', req: q.id, opt: 'more' })).toBeNull();
    expect(h.op?.status).toBe('gather'); expect(h.op!.corps.length).toBe(2);
    const extra = h.op!.corps[1];
    for (let i = 0; i < 60 && h.op?.status === 'gather'; i++) run(g, 1);
    expect(h.op?.status === 'go' || h.op?.status === 'fight' || !h.op).toBe(true);
    expect(corpsIn(g.regions[N]).some(c => c.id === extra)).toBe(false);
  }, 60000);

  it('postponing rests the plan for a week; denying for longer', () => {
    const { g, A, B } = setup();
    offensive(g, A, B);
    run(g, 4);
    const q = plans(g)[0];
    expect(applyCommand(g, 0, { t: 'reply', req: q.id, opt: 'later' })).toBeNull();
    run(g, 6); expect(plans(g).length).toBe(0);
    run(g, OP.laterWeeks * 20); expect(plans(g).length).toBe(1);
  });

  it('a guest sees its plans and results', () => {
    const { g, A, B } = setup();
    offensive(g, A, B); run(g, 4);
    g.ops = [{ id: 1, owner: 0, army: 1, gen: 'X', name: 'Ajax', target: B, region: A, plan: plans(g)[0].op!, ok: true, taken: true, lost: 100, shells: 5, day: 1, star: 1 }, { id: 2, owner: 1, army: 2, gen: 'Y', name: 'Mars', target: A, region: B, plan: plans(g)[0].op!, ok: false, taken: false, lost: 0, shells: 0, day: 1, star: -1 }];
    const m = createMirror(); applySnapshot(m, makeSnapshot(g, 0));
    expect(m.requests!.find(q => q.kind === 'op')?.op?.btl).toBe(22);
    expect(m.ops!.map(o => o.name)).toEqual(['Ajax']);
  });

  it('a computer power approves a good plan through the same code', () => {
    const { g, A, B } = setup();
    const h = offensive(g, A, B);
    run(g, 4);
    expect(plans(g).length).toBe(1);
    // the war minister answers (a computer power's armies file the same plans)
    for (let i = 0; i < 20 && !h.op; i++) { warMinister(g, g.factions[0]); if (!h.op) run(g, 8); }
    expect(h.op).toBeTruthy();
    void aiArmies; void fogView;
  });
});
