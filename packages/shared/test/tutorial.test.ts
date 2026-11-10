// The guided first war (design-play §6) and the difficulty bundles (§7).
import { describe, it, expect } from 'vitest';
import {
  DIFFICULTIES, TUT, TUT_STAGES, applyCommand, atPeace, corpsIn, createGame, emit, generals, offensives, reqExpiry, step, type GameState, type Req,
} from '../src';

const guided = () => createGame({ seed: TUT.seed, humans: [TUT.me], difficulty: 0, fx: false, guided: true });
const run = (g: GameState, s: number) => { for (let i = 0; i < s / .05; i++) step(g, .05); };

describe('the guided first war', () => {
  it('starts at stage 1 with a ceasefire between the player and every power, so nobody attacks the player yet', () => {
    const g = guided(), t = g.tut!;
    expect(t.stage).toBe(0); expect(g.regions[t.home].owner).toBe(TUT.me); expect(g.regions[t.front].owner).toBe(t.foe);
    for (const F of g.factions) if (F.id !== TUT.me) expect(atPeace(g, TUT.me, F.id)).toBe(true);
    run(g, 120);
    expect(g.battles.some(b => b.sides.includes(TUT.me))).toBe(false);
    expect(createGame({ seed: 1, humans: [1], fx: false }).tut).toBeUndefined();
  });

  it('walks through the stages as the player does what each asks', () => {
    const g = guided(), t = g.tut!, me = TUT.me, home = g.regions[t.home];
    // 1 · Mobilise: form two corps, move one to the threatened border
    home.units.inf += 4; home.men.inf += 400;
    expect(applyCommand(g, me, { t: 'form', region: t.home, u: { inf: 1 } })).toBeNull();
    step(g, .05); expect(t.ok).toEqual([0]);
    const c = corpsIn(home).filter(x => x.p !== t.front).at(-1)!;
    expect(applyCommand(g, me, { t: 'moveCorps', region: t.home, id: c.id, to: t.home, toPost: t.front })).toBeNull();
    run(g, 12); expect(t.stage).toBe(1);
    // 2 · Dig in: field works on the marked border
    g.factions[me].supply = 50;
    expect(applyCommand(g, me, { t: 'fortify', region: t.home, kind: 'wire', sector: t.front })).toBeNull();
    step(g, .05); expect(t.stage).toBe(2);
    // 3 · First battle: the ceasefires are lifted and the neighbour attacks
    expect(atPeace(g, me, t.foe)).toBe(false);
    expect(t.flags.sent).toBeGreaterThan(0);
    emit(g, { k: 'battleEnd', region: t.home, winner: me, prev: me, sides: [t.foe, me], capital: true, holdouts: -1 });
    step(g, .05); expect(t.stage).toBe(3);
    // 4 · Hand off: appoint a commander, answer his first request
    const ids = corpsIn(home).map(x => x.id);
    expect(applyCommand(g, me, { t: 'army', corps: ids })).toBeNull();
    step(g, .05); expect(t.ok).toEqual([0]);
    const h = g.hq!.find(x => x.owner === me)!;
    const q: Req = { id: 9999, owner: me, army: h.id, kind: 'fort', key: 'x', region: t.home, sector: t.front, at: g.time, urg: 0, cost: 1, why: '' } as never;
    (g.requests ??= []).push(q);
    expect(applyCommand(g, me, { t: 'reply', req: 9999, opt: 'deny' })).toBeNull();
    step(g, .05); expect(t.stage).toBe(4);
    // 5 · Supply: open Supply mode; every region under capacity
    expect(applyCommand(g, me, { t: 'tut', what: 'supply' })).toBeNull();
    step(g, .05); expect(t.stage).toBe(5);
    // 6 · Offensive: an army ordered to attack, a region taken
    h.mandate = 2; step(g, .05); expect(t.ok).toEqual([0]);
    emit(g, { k: 'battleEnd', region: t.front, winner: me, prev: t.foe, sides: [me, t.foe], capital: false, holdouts: -1 });
    step(g, .05); expect(t.stage).toBe(TUT_STAGES.length);
  });

  it('can be skipped: the guidance ends and the ceasefires are lifted', () => {
    const g = guided();
    expect(applyCommand(g, TUT.me, { t: 'tut', what: 'skip' })).toBeNull();
    expect(g.tut!.stage).toBe(TUT_STAGES.length);
    for (const F of g.factions) if (F.id !== TUT.me) expect(atPeace(g, TUT.me, F.id)).toBe(false);
  });
});

describe('difficulty', () => {
  it('gives players more generals on Recruit and fewer on Marshal', () => {
    const n = (d: number) => generals(createGame({ seed: 3, humans: [1], difficulty: d, fx: false }), 1).slots;
    expect(n(0) - n(1)).toBe(DIFFICULTIES[0].gen);
    expect(n(2) - n(1)).toBe(DIFFICULTIES[2].gen);
    // computer powers are not affected
    const ai = (d: number) => generals(createGame({ seed: 3, humans: [1], difficulty: d, fx: false }), 3).slots;
    expect(ai(0)).toBe(ai(2));
  });
  it('requests never lapse on Recruit, after three weeks on Officer, after one on Marshal', () => {
    const q = { at: 100, urg: 0 } as Req;
    expect(reqExpiry(q, { diff: 0 })).toBe(Infinity);
    expect(reqExpiry(q, { diff: 1 })).toBe(100 + 3 * 20);
    expect(reqExpiry(q, { diff: 2 })).toBe(100 + 20);
  });
  it('Recruit computer powers mostly run one attack at a time, Officer ones more', () => {
    const calm = (d: number) => {
      const g = createGame({ seed: 8, humans: [], difficulty: d, fx: false }); let n = 0, one = 0;
      for (let i = 0; i < 600 / .05; i++) { step(g, .05); if (i % 20 === 0) for (const F of g.factions) { n++; if (offensives(g, F.id).size <= 1) one++; } }
      return one / n;
    };
    const r = calm(0), o = calm(1);
    expect(r).toBeGreaterThan(.7); expect(r).toBeGreaterThan(o + .2);
  }, 120000);
});
