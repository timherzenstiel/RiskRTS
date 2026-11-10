// design-optimize phase 1: a player's army takes over its front, gathers for an attack and may go without asking; the reserve
// takes orders like a corps; the guided war says why an attack is refused.
import { describe, it, expect } from 'vitest';
import { TUT, applyCommand, buildWorld, corpsIn, createGame, depotOf, groundUnits, lookCorps, reserveId, run, type GameState } from '../src';

const W = buildWorld();
const id = (n: string) => W.byName[n].id;
/** France (power 1) in a normal war, with a few recruits, and an army holding its capital region. */
function france(auto: boolean) {
  const me = 1, g = createGame({ seed: 11, humans: [me], fx: false }), cap = g.regions.find(r => r.capitalOf === me)!;
  for (let i = 0; i < 4; i++) applyCommand(g, me, { t: 'recruit', region: cap.id, unit: 'inf', n: 2 });
  run(g, 45);
  expect(applyCommand(g, me, { t: 'army', corps: [], front: [cap.id] })).toBeNull();
  const h = g.hq!.find(x => x.owner === me)!;
  expect(applyCommand(g, me, { t: 'armySet', army: h.id, mandate: 2, target: id('Iberia'), auto })).toBeNull();
  return { g, me, cap, h };
}
const attacking = (g: GameState, me: number) => g.battles.some(b => b.attacker === me) || g.armies.some(a => a.owner === me && (a.ord ?? 0) >= 1) || g.regions.some(r => r.owner === me && corpsIn(r).some(c => (c.ord ?? 0) >= 1));

describe('a player\'s army', () => {
  it('takes over the corps Auto raised on its front and draws on the reserve for its target', () => {
    const { g, cap, h } = france(false);
    run(g, 30);
    const border = corpsIn(cap).filter(c => c.p >= 0);
    expect(border.length).toBeGreaterThan(0);
    expect(border.every(c => c.army === h.id || c.man)).toBe(true);
    // what the border facing the target lacked came out of the reserve
    const facing = corpsIn(cap).filter(c => c.p === id('Iberia')).reduce((n, c) => n + groundUnits(c.u), 0);
    expect(facing).toBeGreaterThanOrEqual(3);
    expect(groundUnits(depotOf(cap).u)).toBeLessThanOrEqual(1);
  });

  it('asks first by default, and says what it is waiting for', () => {
    const { g, me, h } = france(false);
    run(g, 240);
    expect(attacking(g, me)).toBe(false);
    expect(h.why).toBeDefined();
    expect(h.why!.sector).toBe(id('Iberia'));
    // either something is still missing, or the plan waits for the player's answer
    const asked = (g.requests ?? []).some(q => q.owner === me && (q.kind === 'op' || q.kind === 'attack'));
    expect(h.why!.ok ? asked : (h.why!.going < h.why!.need || !h.why!.fresh || !h.why!.known || h.why!.have < h.why!.want || (h.why!.ratio ?? 0) < h.why!.min || h.why!.busy || h.why!.cap)).toBe(true);
  });

  it('attacks without asking when told to attack when ready', () => {
    const { g, me, h } = france(true);
    let went = false;
    for (let i = 0; i < 36 && !went; i++) { run(g, 5); went = attacking(g, me) || !!h.op; }
    expect(went).toBe(true);
    expect((g.requests ?? []).some(q => q.owner === me && (q.kind === 'op' || q.kind === 'attack'))).toBe(false);
  });
});

describe('the reserve as a formation', () => {
  it('is found by its id, takes a move or attack order as a corps, and is handed back when the order fails', () => {
    const me = 1, g = createGame({ seed: 11, humans: [me], fx: false }), cap = g.regions.find(r => r.capitalOf === me)!;
    const rid = reserveId(cap.id), res = groundUnits(depotOf(cap).u);
    expect(res).toBeGreaterThan(0);
    expect(groundUnits(lookCorps(g, me, rid)!.c.u)).toBe(res);
    expect(lookCorps(g, 0, rid)).toBeNull();
    // an order that cannot be carried out leaves the reserve as it was
    const n0 = corpsIn(cap).length;
    expect(applyCommand(g, me, { t: 'attackCorps', region: cap.id, id: rid, to: id('Egypt'), goal: 2 })).toBeTruthy();
    expect(groundUnits(depotOf(cap).u)).toBe(res); expect(corpsIn(cap).length).toBe(n0);
    // an attack order: the reserve marches to the border as a corps under the player's orders
    expect(applyCommand(g, me, { t: 'attackCorps', region: cap.id, id: rid, to: id('Iberia'), goal: 2 })).toBeNull();
    expect(groundUnits(depotOf(cap).u)).toBe(0);
    const col = g.armies.find(a => a.owner === me && a.ct?.man);
    expect(col).toBeDefined(); expect(groundUnits(col!.units)).toBe(res);
    expect(applyCommand(g, me, { t: 'moveCorps', region: cap.id, id: rid, to: cap.id, toPost: id('Germany') })).toBe('The reserve of this region is empty.');
  });
});

describe('the guided war', () => {
  it('answers an attack order during its ceasefire with the reason', () => {
    const g = createGame({ seed: TUT.seed, humans: [TUT.me], guided: true, difficulty: 0, fx: false }), t = g.tut!;
    const e = applyCommand(g, TUT.me, { t: 'attackCorps', region: t.home, id: reserveId(t.home), to: t.front, goal: 2 });
    expect(e).toMatch(/guided war keeps a ceasefire/);
  });
});
