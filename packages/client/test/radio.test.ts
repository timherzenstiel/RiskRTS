import { describe, it, expect } from 'vitest';
import { FORMATION, UNIT_TYPES, buildWorld, createGame, emptyUnits, frontsOf, step, updateSupplyLines, type GameEvent, type GameState } from '@riskrts/shared';
import { dispatchFor, frontReport, homeReport, menSpoken, ordinal, sitrep, station, urgency, type SitrepMemo } from '../src/audio/dispatches';
import { strike } from '../../shared/test/helpers';

const W = buildWorld();
const id = (n: string) => W.byName[n].id;

/** France (power 1) attacks Germany (power 3) with a full corps; everyone else is neutral filler. */
function battle() {
  const g = createGame({ seed: 21, humans: [0, 1, 2, 3, 4, 5, 6], settings: { attackCap: 0, pace: 0 } });
  for (const r of g.regions) { r.units = emptyUnits(); r.men = emptyUnits(); r.defs = []; r.works = {}; r.owner = 2; r.home = 2; r.factory = false; }
  const A = id('France'), B = id('Germany');
  g.regions[A].owner = 1; g.regions[A].home = 1; g.regions[B].owner = 3; g.regions[B].home = 3;
  g.regions[A].units = { ...emptyUnits(), inf: 12, mg: 2, art: 3 };
  g.regions[B].units = { ...emptyUnits(), inf: 6, mg: 2, art: 1 };
  for (const r of [g.regions[A], g.regions[B]]) for (const k of UNIT_TYPES) r.men[k] = r.units[k] * FORMATION[k].men;
  g.factions.forEach(f => { f.supply = 100; f.mission = null; });
  updateSupplyLines(g);
  strike(g, 1, A, B);
  for (let i = 0; i < 20 * 60 && !frontsOf(g, B).length; i++) step(g, .05);
  const b = frontsOf(g, B)[0];
  for (let i = 0; i < 20 * 4 && !b.ended; i++) step(g, .05);
  return { g, A, B, b };
}

describe('radio speech helpers', () => {
  it('names corps and rounds men the way an officer says them', () => {
    expect(ordinal(7)).toBe('Seventh');
    expect(ordinal(23)).toBe('Twenty-third');
    expect(ordinal(40)).toBe('Fortieth');
    expect(menSpoken(12)).toBe('12 men');
    expect(menSpoken(1183)).toBe('about 1,200 men');
    expect(menSpoken(247)).toBe('about 250 men');
  });
});

describe('radio dispatches', () => {
  it('speaks for every side of a battle, with the corps as station', () => {
    const { g, B, b } = battle();
    const st = station(g, b, 1);
    expect(st.name).toMatch(/Corps, Germany$/);
    const e: GameEvent = { k: 'battleStart', region: B, attacker: 1, defender: 3 };
    expect(dispatchFor(g, e, 1)?.say).toBeTruthy();
    expect(dispatchFor(g, e, 3)?.pri).toBe(2);
    expect(dispatchFor(g, e, 0)).toBeNull();
  });

  it('covers the front events the old radio ignored', () => {
    const { g, B, A } = battle();
    const evs: GameEvent[] = [
      { k: 'overTop', faction: 1, region: B }, { k: 'firstLine', faction: 1, def: 3, region: B, from: A, hold: false },
      { k: 'surrender', faction: 3, region: B, n: 2 }, { k: 'cut', faction: 1, region: A },
      { k: 'massing', faction: 3, region: B, to: A, owner: 1 }, { k: 'convoyLost', faction: 1, zone: 0, ships: 2, men: 900, by: 'uboat' },
    ];
    for (const e of evs) expect(dispatchFor(g, e, 1), e.k).not.toBeNull();
    expect(dispatchFor(g, evs[5], 1)!.say).toMatch(/2 transports lost, about 900 men/);
  });

  it('situation report gives strength, morale and a request, and is not repeated at once', () => {
    const { g, b } = battle(), memo: SitrepMemo = {};
    const d = frontReport(g, b, 1, memo);
    expect(d.say).toMatch(/Situation report/);
    expect(d.say).toMatch(/still fighting/);
    expect(d.say).toMatch(/Morale is good|steady|shaken|breaking/);
    expect(d.say).toMatch(/Over\.$/);
    expect(memo[b.id]).toBeDefined();
    expect(urgency(b, 1, memo, g.time)).toBeLessThan(urgency(b, 1, {}, g.time));
    expect(sitrep(g, 1, {})?.region).toBe(b.region);
  });

  it('home report speaks only when something is worth saying', () => {
    const { g } = battle();
    g.factions[1].shells = 9999; g.factions[1].men = 9999; g.factions[1].ww = 0;
    for (const r of g.regions) r.cut = false;
    expect(homeReport(g, 1)).toBeNull();
    g.factions[1].shells = 10;
    expect(homeReport(g, 1)?.say).toMatch(/shell stockpile/);
  });
});

export type { GameState };

describe('commanders on the radio', () => {
  it('a commander asks over the radio in his own voice, and says when he sends a corps back', async () => {
    const { applyCommand, corpsIn, run } = await import('@riskrts/shared');
    const { setCs } = await import('../../shared/test/helpers');
    const { commanderCall, rankSpoken } = await import('../src/audio/dispatches');
    expect(rankSpoken('Gen. Otto von Albeck')).toBe('General Otto von Albeck');
    const g = createGame({ seed: 7, humans: [0, 1, 2, 3, 4, 5, 6], settings: { attackCap: 0, pace: 1 } });
    for (const r of g.regions) { r.units = emptyUnits(); r.men = emptyUnits(); r.cs = undefined; r.defs = []; r.works = {}; r.owner = 2; r.home = 2; r.port = false; r.deploy = 1; }
    g.ships = []; g.fleets = [];
    const A = id('France'), B = id('Germany');
    for (const n of W.regions[A].adj) g.regions[n].owner = 0;
    g.regions[A].owner = 0; g.regions[B].owner = 1; g.regions[A].capitalOf = 0; updateSupplyLines(g);
    g.regions[A].units.inf = 2; g.regions[B].units.inf = 20;
    for (const r of g.regions) for (const k of UNIT_TYPES) r.men[k] = r.units[k] * FORMATION[k].men;
    setCs(g, A, [[B, { inf: 2 }]]); setCs(g, B, [[A, { inf: 20 }]]);
    applyCommand(g, 0, { t: 'army', corps: corpsIn(g.regions[A]).map(c => c.id) });
    const h = g.hq![0]; h.cmd.tr = ['insp', 'insp']; h.cmd.name = 'Gen. Henri Garnier';
    run(g, 4);
    const ev = g.events.find((e): e is Extract<GameEvent, { k: 'request' }> => e.k === 'request' && e.kind === 'men');
    expect(ev).toBeTruthy();
    const d = commanderCall(g, ev!, 0)!;
    expect(d.say).toContain('General Garnier'); expect(d.say).toContain(`${ordinal(h.n)} Army`); expect(d.say).toContain('Germany border');
    expect(d.who).toBe('front'); expect(d.voice).toBe(200 + h.n);
    expect(dispatchFor(g, ev!, 1)).toBeNull();
    const rel = commanderCall(g, { k: 'release', faction: 0, army: h.id, n: 7, region: A, why: 'peace' }, 0)!;
    expect(rel.say).toContain('Seventh Corps'); expect(rel.say).toContain('at peace');
  });
});
