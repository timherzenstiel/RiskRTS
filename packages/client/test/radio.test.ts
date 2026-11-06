import { describe, it, expect } from 'vitest';
import { FORMATION, UNIT_TYPES, buildWorld, createGame, emptyUnits, frontsOf, step, updateSupplyLines, type GameEvent, type GameState } from '@riskrts/shared';
import { dispatchFor, frontReport, homeReport, menSpoken, ordinal, sitrep, station, urgency, type SitrepMemo } from '../src/audio/dispatches';
import { strike } from '../../shared/test/helpers';
import { missing, withLang } from '../src/i18n';

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

describe('radio in German', () => {
  it('names corps, men and peoples in German', () => {
    withLang('de', () => {
      expect(ordinal(7)).toBe('Siebtes');
      expect(ordinal(23)).toBe('Dreiundzwanzigstes');
      expect(ordinal(40)).toBe('Vierzigstes');
      expect(menSpoken(12)).toBe('12 Mann');
      expect(menSpoken(1183)).toBe('etwa 1.200 Mann');
    });
  });

  it('speaks its calls and reports in German', () => {
    const { g, A, B, b } = battle();
    withLang('de', () => {
      missing.clear();
      expect(station(g, b, 1).name).toMatch(/Korps, /);
      const def = dispatchFor(g, { k: 'battleStart', region: B, attacker: 1, defender: 3 }, 3)!.say;
      expect(def).toMatch(/die Franzosen|den Franzosen/i);
      expect(dispatchFor(g, { k: 'convoyLost', faction: 1, zone: 0, ships: 2, men: 900, by: 'uboat' }, 1)!.say).toMatch(/2 Transporter verloren, mit ihnen etwa 900 Mann\.$/);
      expect(dispatchFor(g, { k: 'cut', faction: 1, region: A }, 1)!.say).toMatch(/ist abgeschnitten/);
      const rep = frontReport(g, b, 1, {}).say;
      expect(rep).toMatch(/Lagebericht/);
      expect(rep).toMatch(/Kommen\.$/);
      g.factions[1].shells = 10;
      expect(homeReport(g, 1)?.say).toMatch(/^Generalstab an alle Kommandos\. Das Granatenlager/);
      expect([...missing].filter(s => !/^[A-Z][a-z]+$/.test(s))).toEqual([]);
    });
  });
});

export type { GameState };
