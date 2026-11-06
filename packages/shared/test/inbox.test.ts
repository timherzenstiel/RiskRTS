// Design-play phase 2 (the Inbox): requests lapse unanswered at a price, trained recruits are announced and can join a
// corps, and players can stop the war by a majority vote.
import { describe, it, expect } from 'vitest';
import {
  EXPIRE, FORMATION, TICK_SECONDS, UNIT_TYPES, VOTE, applyCommand, buildWorld, corpsIn, createGame, createMirror, applySnapshot, drainEvents, emptyUnits,
  initMirrorCapitals, makeSnapshot, reqExpiry, run, step, train, updateSupplyLines, votePaused, voteTick, type GameState,
} from '../src';
import { setCs } from './helpers';

const W = buildWorld();
const id = (n: string) => W.byName[n].id;
const fill = (g: GameState) => { for (const r of g.regions) for (const k of UNIT_TYPES) r.men[k] = r.units[k] * FORMATION[k].men; };
function setup(humans = [0, 1, 2, 3, 4, 5, 6]) {
  const g = createGame({ seed: 7, humans, settings: { attackCap: 0, pace: 1 } });
  for (const r of g.regions) { r.units = emptyUnits(); r.men = emptyUnits(); r.cs = undefined; r.defs = []; r.works = {}; r.owner = 2; r.home = 2; r.factory = false; r.capitalOf = -1; r.port = false; r.deploy = 1; }
  g.ships = []; g.fleets = [];
  const A = id('France'), B = id('Germany');
  for (const n of W.regions[A].adj) g.regions[n].owner = 0;
  g.regions[A].owner = 0; g.regions[A].home = 0; g.regions[A].capitalOf = 0; g.regions[B].owner = 1; g.regions[B].home = 1; g.regions[B].capitalOf = 1;
  g.factions.forEach(f => { f.supply = 0; f.mission = null; f.shells = 300; f.men = 5000; });
  updateSupplyLines(g);
  return { g, A, B };
}

describe('the inbox', () => {
  it('a request left unanswered lapses: the corps on that border lose morale and he does not ask again at once', () => {
    const { g, A, B } = setup(); g.regions[A].units.inf = 2; g.regions[B].units.inf = 20; fill(g);
    setCs(g, A, [[B, { inf: 2 }]]); setCs(g, B, [[A, { inf: 20 }]]);
    expect(applyCommand(g, 0, { t: 'army', corps: corpsIn(g.regions[A]).map(c => c.id) })).toBeNull();
    run(g, 4);
    const q = (g.requests ?? []).find(x => x.kind === 'men')!; expect(q).toBeTruthy();
    const c = corpsIn(g.regions[A])[0], mor = c.mor; drainEvents(g);
    q.at = g.time - (q.urg === 2 ? EXPIRE.critical : EXPIRE.weeks) * TICK_SECONDS; expect(reqExpiry(q)).toBeLessThanOrEqual(g.time);
    step(g, .05);
    expect((g.requests ?? []).some(x => x.id === q.id)).toBe(false);
    expect(corpsIn(g.regions[A])[0].mor).toBeLessThanOrEqual(mor - EXPIRE.mor + 1);
    const ev = drainEvents(g).find(e => e.k === 'reqExpired'); expect(ev).toMatchObject({ k: 'reqExpired', kind: 'men', mor: EXPIRE.mor });
    run(g, 4); expect((g.requests ?? []).some(x => x.key === q.key)).toBe(false);
  });

  it('trained recruits are announced, and can join a corps of the region', () => {
    const { g, A, B } = setup(); g.regions[A].units.inf = 3; fill(g);
    setCs(g, A, [[B, { inf: 3 }, { man: true }]]);
    train(g, g.regions[A], 'inf'); train(g, g.regions[A], 'inf');
    for (const t of g.regions[A].train!) t.at = g.time; drainEvents(g);
    step(g, .05);
    expect(drainEvents(g).find(e => e.k === 'trained')).toMatchObject({ faction: 0, region: A, n: 2 });
    const c = corpsIn(g.regions[A]).find(x => x.p === B)!;
    expect(applyCommand(g, 0, { t: 'form', region: A, u: { inf: 2 }, into: c.id })).toBeNull();
    expect(corpsIn(g.regions[A]).find(x => x.id === c.id)!.u.inf).toBe(5);
    expect(applyCommand(g, 0, { t: 'form', region: A, u: { inf: 1 }, into: c.id })).toMatch(/depot/);
  });

  it('a majority of the human players stops the war for a minute; the clock runs on real seconds', () => {
    const { g } = setup([0, 1, 2]);
    expect(applyCommand(g, 3, { t: 'pauseCall' })).toMatch(/players/);
    expect(applyCommand(g, 0, { t: 'pauseCall' })).toBeNull();
    expect(applyCommand(g, 1, { t: 'pauseCall' })).toMatch(/already/);
    expect(votePaused(g)).toBe(false);
    expect(applyCommand(g, 1, { t: 'pauseVote', yes: true })).toBeNull();
    expect(votePaused(g)).toBe(true);
    voteTick(g, VOTE.pause - 1); expect(votePaused(g)).toBe(true);
    voteTick(g, 2); expect(votePaused(g)).toBe(false); expect(g.vote).toBeUndefined();
  });

  it('refusals end a call; calls are limited per hour; the host can switch votes off; guests see the vote', () => {
    const { g } = setup([0, 1, 2]);
    expect(applyCommand(g, 0, { t: 'pauseCall' })).toBeNull();
    applyCommand(g, 1, { t: 'pauseVote', yes: false }); expect(g.vote).toBeTruthy();
    applyCommand(g, 2, { t: 'pauseVote', yes: false }); expect(g.vote).toBeUndefined();
    expect(applyCommand(g, 0, { t: 'pauseCall' })).toBeNull(); voteTick(g, VOTE.open + 1); expect(g.vote).toBeUndefined();
    expect(applyCommand(g, 0, { t: 'pauseCall' })).toBeNull(); voteTick(g, VOTE.open + 1);
    expect(applyCommand(g, 0, { t: 'pauseCall' })).toMatch(/3 pause calls/);
    expect(applyCommand(g, 1, { t: 'pauseCall' })).toBeNull();
    const m = createMirror(); initMirrorCapitals(m); applySnapshot(m, makeSnapshot(g, 2));
    expect(m.vote?.by).toBe(1); expect(m.factions[3].ai).toBe(true); expect(m.factions[2].ai).toBe(false);
    g.cfg.vote = false; voteTick(g, .1); expect(g.vote).toBeUndefined();
    expect(applyCommand(g, 2, { t: 'pauseCall' })).toMatch(/switched/);
  });

  it('single player has no votes', () => {
    const { g } = setup([0]);
    expect(applyCommand(g, 0, { t: 'pauseCall' })).toMatch(/speed/);
  });
});
