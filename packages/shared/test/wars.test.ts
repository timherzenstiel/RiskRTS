// Wars as stories (design-play §5): a war begins with the first battle, each side has an aim, a war score, peace terms both
// sides may take or refuse, and the week's news filtered by what each power may know.
import { describe, it, expect } from 'vitest';
import {
  WAR, applyCommand, applySnapshot, buildWorld, createGame, createMirror, emit, initMirrorCapitals, makeSnapshot, treatyOf, warBetween, warScore, warsStep, warsWeek,
  type GameState,
} from '../src';

const W = buildWorld();
const id = (n: string) => W.byName[n].id;

/** France (1) and Germany (3) as players, the rest computer powers; a battle between them opens the war. */
function setup(humans = [1, 3]) {
  const g = createGame({ seed: 5, humans, fx: false });
  const fr = id('France'), de = id('Germany');
  emit(g, { k: 'battleStart', region: fr, attacker: 3, defender: 1 });
  return { g, fr, de, w: warBetween(g, 1, 3)! };
}
/** A region of `lose` next to one of `win`'s, not a capital. */
function border(g: GameState, win: number, lose: number) {
  return g.regions.find(r => r.owner === lose && r.capitalOf < 0 && W.regions[r.id].land.some(n => g.regions[n].owner === win))!;
}

describe('a war begins', () => {
  it('with the first battle between two powers; each player is offered aims, a computer power picks at once', () => {
    const { g, w } = setup([1]);
    expect(w).toBeTruthy(); expect(w.battles).toBe(1);
    const fi = w.a === 1 ? 0 : 1;
    expect(w.opts[fi]?.map(o => o.k)).toContain('hold');
    expect(w.aims[1 - fi]).toBeTruthy(); expect(w.opts[1 - fi]).toBeNull();
    // a second battle belongs to the same war
    emit(g, { k: 'battleStart', region: id('Germany'), attacker: 1, defender: 3 });
    expect(g.wars!.filter(x => !x.end)).toHaveLength(1); expect(w.battles).toBe(2);
  });
  it('the player picks an aim; one left alone is picked by the War Office', () => {
    const { g, w } = setup();
    const ia = w.a === 1 ? 0 : 1;
    expect(applyCommand(g, 1, { t: 'aim', war: w.id, k: 1 })).toBeNull();
    expect(w.aims[ia]?.k).toBe('hold');
    expect(applyCommand(g, 1, { t: 'aim', war: w.id, k: 0 })).toMatch(/already set/);
    expect(applyCommand(g, 2, { t: 'aim', war: w.id, k: 0 })).toMatch(/over/);
    g.time = w.due! + 1; warsStep(g);
    expect(w.aims[1 - ia]).toBeTruthy(); expect(w.due).toBeUndefined();
  });
});

describe('aims and war score', () => {
  it('a region taken counts for the score and fulfils a take aim, which pays Production', () => {
    const { g, w } = setup();
    const i = w.a === 3 ? 0 : 1, opts = w.opts[i]!, k = opts.findIndex(o => o.k === 'take');
    expect(k).toBeGreaterThanOrEqual(0);
    expect(applyCommand(g, 3, { t: 'aim', war: w.id, k })).toBeNull();
    const r = g.regions[opts[k].region!], prev = r.owner, s0 = g.factions[3].supply;
    r.owner = 3;
    emit(g, { k: 'battleEnd', region: r.id, winner: 3, prev, sides: [3, prev], capital: false, holdouts: -1 });
    expect(w.taken[i]).toBe(1);
    expect(w.aims[i]?.res).toBe(1);
    expect(g.factions[3].supply).toBe(s0 + WAR.takeProd);
    expect(warScore(w, 3)).toBe(WAR.region + WAR.aim);
    expect(warScore(w, 1)).toBe(-(WAR.region + WAR.aim));
    // new aims to choose from
    expect(w.opts[i]).toBeTruthy();
  });
  it('losing a region breaks a hold aim at once and costs weariness', () => {
    const { g, w } = setup();
    const i = w.a === 1 ? 0 : 1;
    applyCommand(g, 1, { t: 'aim', war: w.id, k: w.opts[i]!.findIndex(o => o.k === 'hold') });
    const ww = g.factions[1].ww, r = border(g, 3, 1);
    r.owner = 3; emit(g, { k: 'battleEnd', region: r.id, winner: 3, prev: 1, sides: [3, 1], capital: false, holdouts: -1 });
    expect(w.aims[i]?.res).toBe(-1); expect(g.factions[1].ww).toBe(ww + WAR.missWW);
  });
  it('men lost in battle reports count for the side that lost them', () => {
    const { g, w } = setup();
    const lost = (n: number) => ({ inf: n, mg: 0, art: 0, tank: 0, plane: 0 });
    g.reports.push({ id: 999, region: id('France'), from: -1, day: g.day, dur: 10, attacker: 3, def: 1, winner: 1, reach: 1, sides: [{ f: 3, lost: lost(900), shells: 0, mor0: 70, mor1: 40 }, { f: 1, lost: lost(300), shells: 0, mor0: 70, mor1: 60 }] });
    emit(g, { k: 'report', id: 999, region: id('France'), sides: [3, 1] });
    expect(w.lost[w.a === 3 ? 0 : 1]).toBe(900);
    expect(warScore(w, 1)).toBe(Math.round(WAR.men * 600 / WAR.menMin));
  });
});

describe('peace', () => {
  /** Germany far ahead after enough weeks: terms come up at the weekly step. */
  function ahead(humans = [1, 3]) {
    const s = setup(humans), { g, w } = s;
    w.taken[w.a === 3 ? 0 : 1] = 5; g.day = w.day0 + WAR.minDays;
    warsWeek(g);
    return s;
  }
  it('terms come up when one side is far enough ahead; both saying yes cedes a region, pays and signs a pact', () => {
    const { g, w } = ahead();
    const o = w.offer!; expect(o).toBeTruthy(); expect(o.win).toBe(3);
    expect(o.region).toBeDefined(); expect(o.pay).toBeGreaterThan(0);
    const r = g.regions[o.region!]; expect(r.owner).toBe(1);
    g.factions[1].supply = 100; const s3 = g.factions[3].supply;
    expect(applyCommand(g, 3, { t: 'peace', war: w.id, yes: true })).toBeNull();
    expect(w.end).toBeUndefined();
    expect(applyCommand(g, 1, { t: 'peace', war: w.id, yes: true })).toBeNull();
    expect(w.end?.how).toBe('peace'); expect(w.end?.win).toBe(3);
    expect(r.owner).toBe(3);
    expect(g.factions[3].supply).toBe(s3 + o.pay); expect(g.factions[1].supply).toBe(100 - o.pay);
    expect(treatyOf(g, 1, 3)?.kind).toBe('nap');
    expect(g.newsWk?.some(n => n.k === 'peace' && n.a === 3)).toBe(true);
  });
  it('peace is never forced: refusing costs weariness, more for the loser, and the war goes on', () => {
    const { g, w } = ahead();
    const ww = g.factions[1].ww;
    expect(applyCommand(g, 1, { t: 'peace', war: w.id, yes: false })).toBeNull();
    expect(w.offer).toBeUndefined(); expect(w.end).toBeUndefined();
    expect(g.factions[1].ww).toBe(ww + WAR.refuseLoser);
    // no new terms before the gap
    g.day += 7; warsWeek(g); expect(w.offer).toBeUndefined();
    g.day = w.last! + WAR.gap; warsWeek(g); expect(w.offer).toBeTruthy();
  });
  it('a treaty signed through diplomacy ends the war; a computer power answers terms at once', () => {
    const { g, w } = ahead([1]);
    // Germany is a computer power: it has answered already (yes or no); France has not
    expect(w.offer === undefined || w.offer.yes.length <= 1).toBe(true);
    applyCommand(g, 1, { t: 'offer', to: 3, kind: 'cease' });
    if (treatyOf(g, 1, 3)) expect(w.end?.how === 'treaty' || w.end?.how === 'peace').toBe(true);
  });
});

describe('what each power may see', () => {
  it('its own aims and terms; the enemy\'s aim and other powers\' aims stay hidden', () => {
    const { g, w } = setup([1, 3, 0]);
    applyCommand(g, 1, { t: 'aim', war: w.id, k: 0 }); applyCommand(g, 3, { t: 'aim', war: w.id, k: 0 });
    const look = (me: number) => { const m = createMirror(); initMirrorCapitals(m); applySnapshot(m, makeSnapshot(g, me)); return m.wars!.find(x => x.id === w.id)!; };
    const fr = look(1), i = w.a === 1 ? 0 : 1;
    expect(fr.aims[i]).toBeTruthy(); expect(fr.aims[1 - i]).toBeNull();
    const gb = look(0); expect(gb.aims).toEqual([null, null]); expect(gb.taken).toEqual(w.taken);
  });
  it('the news: own wars and public events always, other wars only where it can see', () => {
    const { g } = setup([1, 3, 0]);
    const far = g.regions.find(r => r.owner === 5 && r.capitalOf < 0)!;
    emit(g, { k: 'strike', faction: 5, region: far.id });
    emit(g, { k: 'general', faction: 5, kind: 'relieved', name: 'Pasha' });
    warsWeek(g);
    const week = g.news!.at(-1)!;
    expect(week.items.some(n => n.k === 'war' && n.a === 3)).toBe(true);
    const m = createMirror(); initMirrorCapitals(m); applySnapshot(m, makeSnapshot(g, 0));
    const seen = m.news!.at(-1)!.items;
    expect(seen.some(n => n.k === 'war')).toBe(true);
    expect(seen.some(n => n.k === 'relieved')).toBe(false);
    const vis = makeSnapshot(g, 0).r[far.id][9];
    expect(seen.some(n => n.k === 'strike')).toBe(vis >= 1);
  });
});
