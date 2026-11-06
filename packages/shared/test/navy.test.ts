// The navy: sea zones and straits, ports, transports, amphibious assaults, sea control, naval battles and carriers.
import { describe, it, expect } from 'vitest';
import {
  FORMATION, UNIT_TYPES, applyCommand, applySnapshot, buildWorld, coastKey, createGame, createMirror, dayOf, docked, drainEvents, emptyUnits, fleetShips, frontsOf,
  initMirrorCapitals, makeSnapshot, migrateState, newShip, planRoute, coastNodes, run, seaControl, step, stepSeaBattle, updateSupplyLines, type GameState,
} from '../src';

const W = buildWorld();
const id = (n: string) => W.byName[n].id;
function fill(g: GameState) { for (const r of g.regions) for (const k of UNIT_TYPES) r.men[k] = r.units[k] * FORMATION[k].men; }
/** Everything belongs to power 2, no ships, except what a test hands out. */
function blank(seed = 3) {
  const g = createGame({ seed, humans: [0, 1, 2, 3, 4, 5, 6], settings: { attackCap: 0, pace: 1 } });
  for (const r of g.regions) { r.units = emptyUnits(); r.men = emptyUnits(); r.defs = []; r.works = {}; r.fr = undefined; r.owner = 2; r.home = 2; r.factory = false; r.capitalOf = -1; r.deploy = 1; }
  g.factions.forEach(f => { f.mission = null; f.supply = 100; f.shells = 400; });
  g.ships = []; g.fleets = []; g.seaBattles = [];
  return g;
}
const give = (g: GameState, f: number, name: string, inf = 0) => { const r = g.regions[id(name)]; r.owner = f; r.home = f; r.units.inf = inf; r.men.inf = inf * 100; return r; };

describe('sea zones', () => {
  it('every sea lane runs through a zone both ends touch, and every strait has its gates', () => {
    for (const [k, z] of W.laneZone) { const [a, b] = k.split('|').map(Number); expect(z).toBeGreaterThanOrEqual(0); expect(W.regions[a].zones).toContain(z); expect(W.regions[b].zones).toContain(z); }
    for (const L of W.links) { expect(L.ta).toBeGreaterThanOrEqual(0); expect(L.tb).toBeGreaterThanOrEqual(0); }
    expect(W.regions[id('Britain')].sectors).toContain(coastKey(0));
    expect(W.regions[id('Britain')].land).not.toContain(id('France'));
  });
  it('Britain reaches India through Suez; with Egypt hostile the route goes round the Cape', () => {
    const g = blank(); for (const n of ['Britain', 'India', 'Egypt', 'Iberia', 'Italy']) give(g, 0, n);
    const via = planRoute(g, 0, coastNodes(id('Britain')), coastNodes(id('India')))!;
    expect(via.links.map(l => W.links[l].name)).toContain('Suez Canal');
    g.regions[id('Egypt')].owner = 3;
    const round = planRoute(g, 0, coastNodes(id('Britain')), coastNodes(id('India')))!;
    expect(round.links.map(l => W.links[l].name)).not.toContain('Suez Canal');
    expect(round.len).toBeGreaterThan(via.len * 1.3);
  });
});

describe('transports', () => {
  it('a move over the Channel goes by ship: troops embark, sail, land and march; the transports come home', () => {
    const g = blank(); const B = give(g, 0, 'Britain', 10), F = give(g, 0, 'France', 2); B.port = true; F.port = true; B.capitalOf = 0; B.factory = true; fill(g);
    newShip(g, 0, 'trans', B.id); newShip(g, 0, 'trans', B.id);
    expect(applyCommand(g, 0, { t: 'march', from: B.id, to: F.id, frac: .5 })).toBeNull();
    expect(g.fleets.length).toBe(1); expect(g.fleets[0].cargo.inf).toBe(5);
    run(g, 90);
    expect(F.units.inf + g.armies.filter(a => a.owner === 0 && a.to === F.id).reduce((s, a) => s + a.units.inf, 0)).toBe(7);
    run(g, 60);
    expect(g.fleets.length).toBe(0); expect(docked(g, B.id, 0, 'trans').length).toBe(2);
  });
  it('without transports the sea cannot be crossed; guns need a quay', () => {
    const g = blank(); const B = give(g, 0, 'Britain', 10); give(g, 0, 'France', 2); fill(g);
    expect(applyCommand(g, 0, { t: 'march', from: B.id, to: id('France'), frac: .5 })).toMatch(/No transports/);
    B.port = true; newShip(g, 0, 'trans', B.id); g.regions[id('France')].port = false; B.units.art = 2; B.men.art = 160; B.units.inf = 0; B.men.inf = 0;
    expect(applyCommand(g, 0, { t: 'ship', region: B.id, post: -1, to: id('France'), toPost: -1, frac: 1 })).toMatch(/port/);
  });
  it('a move with no land route ships the troops to a far own coast', () => {
    const g = blank(); const B = give(g, 0, 'Britain', 12); const I = give(g, 0, 'India', 1); B.port = true; I.port = true; fill(g);
    for (let i = 0; i < 3; i++) newShip(g, 0, 'trans', B.id);
    expect(applyCommand(g, 0, { t: 'move', region: B.id, post: -1, to: I.id, toPost: -1, frac: .5 })).toBeNull();
    run(g, 400);
    expect(I.units.inf).toBe(7);
  });
});

describe('amphibious assault', () => {
  it('an attack over a sea lane is a landing: the fleet assembles offshore, the first wave fights on the coast sector', () => {
    const g = blank(); const B = give(g, 0, 'Britain', 20), D = give(g, 3, 'Germany', 2); B.port = true; fill(g);
    for (let i = 0; i < 3; i++) newShip(g, 0, 'land', B.id);
    newShip(g, 0, 'trans', B.id); newShip(g, 0, 'trans', B.id);
    expect(applyCommand(g, 0, { t: 'march', from: B.id, to: D.id, frac: .6, goal: 2 })).toBeNull();
    drainEvents(g);
    let off = false, beach = -1;
    for (let i = 0; i < 20 * 400 && D.owner === 3; i++) {
      step(g, .05);
      for (const e of drainEvents(g)) if (e.k === 'offshore') off = true;
      const b = frontsOf(g, D.id)[0]; if (b && beach < 0) { beach = b.from; expect(b.amph).toBeDefined(); }
    }
    expect(off).toBe(true);
    expect(beach).toBe(coastKey(W.laneZone.get(D.id + '|' + B.id)!));
    expect(D.owner).toBe(0);
  });
  it('no landing craft, no assault', () => {
    const g = blank(); const B = give(g, 0, 'Britain', 20); give(g, 3, 'Germany', 2); B.port = true; fill(g);
    expect(applyCommand(g, 0, { t: 'march', from: B.id, to: id('Germany'), frac: .5 })).toMatch(/landing flotillas/);
  });
});

describe('sea control and naval battles', () => {
  it('battle fleets stationed in one zone fight it out ship by ship; losses carry over', () => {
    const g = blank(); const B = give(g, 0, 'Britain', 2), D = give(g, 3, 'Germany', 2); B.port = true; D.port = true; fill(g);
    for (let i = 0; i < 3; i++) newShip(g, 0, 'bb', B.id);
    for (let i = 0; i < 2; i++) newShip(g, 3, 'bb', D.id);
    expect(applyCommand(g, 0, { t: 'station', region: B.id, zone: 0 })).toBeNull();
    expect(applyCommand(g, 3, { t: 'station', region: D.id, zone: 0 })).toBeNull();
    let started = false, ended = false;
    for (let i = 0; i < 20 * 400 && !ended; i++) { step(g, .05); for (const e of drainEvents(g)) if (e.k === 'seaBattle') { if (e.start) started = true; else ended = true; } }
    expect(started).toBe(true); expect(ended).toBe(true);
    const hp = g.ships.reduce((s, x) => s + x.hp, 0);
    expect(hp).toBeLessThan(5 * 160 * 1.1);
  });
  it('a stationed fleet holds the zone; an enemy convoy running into it is intercepted', () => {
    const g = blank(); const B = give(g, 0, 'Britain', 10), F = give(g, 0, 'France', 1), D = give(g, 3, 'Germany', 2); B.port = true; F.port = true; D.port = true; fill(g);
    for (let i = 0; i < 2; i++) newShip(g, 3, 'bb', D.id);
    expect(applyCommand(g, 3, { t: 'station', region: D.id, zone: 0 })).toBeNull();
    run(g, 40);
    expect(seaControl(g).ctrl[0]).toBe(3);
    for (let i = 0; i < 2; i++) newShip(g, 0, 'trans', B.id);
    expect(applyCommand(g, 0, { t: 'march', from: B.id, to: F.id, frac: .6 })).toBeNull();
    let battle = false; for (let i = 0; i < 20 * 80; i++) { step(g, .05); if (g.seaBattles.length) battle = true; }
    expect(battle).toBe(true);
  });
  it('the bigger battle fleet wins, whichever side reaches the zone first', () => {
    for (const first of [1, 2]) {
      const g = blank(5); const A = give(g, 1, 'Britain'), B = give(g, 2, 'Germany'); A.port = true; B.port = true; fill(g);
      for (let i = 0; i < 4; i++) newShip(g, 1, 'bb', A.id); for (let i = 0; i < 2; i++) newShip(g, 2, 'bb', B.id);
      const st = (f: number) => applyCommand(g, f, { t: 'station', region: f === 1 ? A.id : B.id, zone: 0 });
      st(first); st(3 - first);
      let w = -9; for (let i = 0; i < 20 * 500 && w === -9; i++) { step(g, .05); for (const e of drainEvents(g)) if (e.k === 'seaBattle' && !e.start) w = e.sides[e.winner]?.[0] ?? -1; }
      expect(w).toBe(1);
    }
  });
  it('the dreadnoughts of a battle line fire only the turrets that bear', async () => {
    const { turretsBearing } = await import('../src');
    expect(turretsBearing(Math.PI / 2, 5)).toBe(5); expect(turretsBearing(0, 5)).toBe(2); expect(turretsBearing(Math.PI, 5)).toBe(2); expect(turretsBearing(Math.PI / 2, 3)).toBe(3);
    void stepSeaBattle;
  });
});

describe('carriers', () => {
  it('squadrons go aboard in port; from the zone they strike a coast and fly back to the carrier', () => {
    const g = blank(); g.day = dayOf(1917, 8); const B = give(g, 0, 'Britain', 2), D = give(g, 3, 'Germany', 3); B.port = true; B.factory = true; B.units.plane = 3; B.men.plane = 36; fill(g);
    const cv = newShip(g, 0, 'carrier', B.id);
    expect(applyCommand(g, 0, { t: 'embarkAir', region: B.id, ship: cv.id, n: 3 })).toBeNull();
    expect(cv.planes).toBe(3); expect(B.units.plane).toBe(0);
    expect(applyCommand(g, 0, { t: 'station', region: B.id, zone: 0, kind: 'carrier' })).toBeNull();
    run(g, 20);
    expect(seaControl(g).at[0][0]).toBe(3);
    expect(applyCommand(g, 0, { t: 'carrierAir', ship: cv.id, to: D.id })).toBeNull();
    expect(cv.planes).toBe(0);
    run(g, 200);
    expect((cv.planes ?? 0) + B.units.plane).toBeGreaterThan(0);
  });
  it('carriers arrive in July 1917 for Britain, a year later for everyone else', () => {
    const g = blank(); g.day = dayOf(1917, 8); const D = give(g, 3, 'Germany'); D.port = true; D.factory = true; const B = give(g, 0, 'Britain'); B.port = true; B.factory = true;
    expect(applyCommand(g, 3, { t: 'buildShip', region: D.id, kind: 'carrier' })).toMatch(/Jul 1918/);
    expect(applyCommand(g, 0, { t: 'buildShip', region: B.id, kind: 'carrier' })).toBeNull();
  });
});

describe('start and saves', () => {
  it('every power starts with its fleet in port, the ports of 1914 are open', () => {
    const g = createGame({ seed: 4, humans: [0] });
    expect(g.ships.filter(s => s.owner === 0 && s.kind === 'bb').length).toBe(5);
    expect(g.ships.filter(s => s.owner === 6 && s.kind === 'trans').length).toBe(5);
    expect(g.regions[id('Britain')].port).toBe(true);
    for (const s of g.ships) expect(g.regions[s.port].owner).toBe(s.owner);
  });
  it('fleets travel in snapshots; a version 5 save gets its navy and lane works move to the coast', () => {
    const g = createGame({ seed: 4, humans: [0] }); updateSupplyLines(g);
    const B = id('Britain'), F = id('France');
    expect(applyCommand(g, 0, { t: 'ship', region: B, post: -1, to: g.regions.find(r => r.owner === 0 && r.id !== B && W.regions[r.id].zones.length > 0)?.id ?? F, toPost: -1, frac: .3 })).toBe(null);
    const m = createMirror(); initMirrorCapitals(m); applySnapshot(m, makeSnapshot(g, 0));
    expect(m.fleets.length).toBe(g.fleets.length); expect(m.ships.length).toBeGreaterThan(0);
    const old = JSON.parse(JSON.stringify(g)); old.v = 5; delete old.ships; delete old.fleets; delete old.seaBattles;
    for (const r of old.regions) { delete r.port; }
    old.regions[B].works = { [F]: { tr: 2, sand: 1, wire: 0 } };
    const s = migrateState(old)!;
    expect(s.v).toBe(6); expect(s.ships.length).toBeGreaterThan(0);
    expect(s.regions[B].works[coastKey(W.laneZone.get(B + '|' + F)!)]?.tr).toBe(2);
    expect(s.regions[B].works[F]).toBeUndefined();
  });
  it('an AI war with navies runs a year without errors', () => {
    const g = createGame({ seed: 11, humans: [] });
    const t0 = Date.now(); run(g, 20 * 52);
    const ms = Date.now() - t0;
    expect(g.day).toBeGreaterThan(300);
    expect(ms).toBeLessThan(120000);
    void fleetShips;
  });
});
