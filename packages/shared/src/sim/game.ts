// Creating and advancing a game.
import { FACTIONS, NUM_FACTIONS } from '../data/factions';
import { nationOf } from '../data/nations';
import { FORMATION, UNIT_TYPES, emptyUnits, type Units } from '../data/units';
import { Rng } from '../rng';
import { newRegion, world, rnd } from './core';
import { aiThink } from './ai';
import { arrive } from './commands';
import { DIFFICULTIES, MANPOWER, supplyTick, updateSupplyLines } from './economy';
import { updateSpies } from './fog';
import { stepBattle } from './battle';
import { buildMissions } from './missions';
import { TICK_SECONDS } from '../data/units';
import { DEFAULT_SETTINGS, type GameSettings, type GameState } from './types';
import { DT, SHELLS } from '../data/units';

export interface GameOptions {
  seed?: number;
  /** Faction ids controlled by humans; every other power is computer-controlled. */
  humans: number[];
  difficulty?: number;
  /** Collect visual effects (set false on a headless server). */
  fx?: boolean;
  /** Lobby rules (attack cap, battle pace). */
  settings?: Partial<GameSettings>;
}

export function createGame(opt: GameOptions): GameState {
  const W = world(), seed = (opt.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0, R = new Rng(seed);
  const g: GameState = {
    v: 4, seed, rng: R.s, time: 0, day: 0, supplyT: 0, diff: opt.difficulty ?? 1, cfg: { ...DEFAULT_SETTINGS, ...opt.settings },
    regions: W.regions.map(r => newRegion(r.id)),
    factions: FACTIONS.map((_, id) => ({ id, supply: opt.humans.includes(id) ? 8 : 5, alive: true, mission: null, aiT: 1.5 + R.next() * 2, ai: !opt.humans.includes(id), ww: 0, wounded: 0, shells: SHELLS.start, men: 0, mob: 0, unrestT: 0 })),
    armies: [], battles: [], intel: FACTIONS.map(() => []), spies: [], reports: [], over: false, winner: null, nextId: 1,
    stats: { won: Array(NUM_FACTIONS).fill(0), lost: Array(NUM_FACTIONS).fill(0) },
    events: [], fx: opt.fx === false ? null : [],
  };
  FACTIONS.forEach((f, id) => {
    const t = g.regions[W.byName[f.capital].id]; t.owner = id; t.capitalOf = id; t.units = { inf: nationOf(id).startInf, mg: 2, art: 1, tank: 0, plane: 0 }; t.factory = true;
    for (const n of W.regions[t.id].adj) if (!W.seaLane.has(t.id + '|' + n)) t.works[n] = { tr: 2, sand: 0, wire: 0 };
    t.defs.push({ id: g.nextId++, k: 'pill', s: -1, hp: DT.pill.hp, f: id });
  });
  const rest = R.shuffle(g.regions.filter(t => t.owner < 0)), off = R.int(6);
  rest.forEach((t, k) => { t.owner = (k + off) % NUM_FACTIONS; t.units.inf = 2 + (R.next() < .5 ? 1 : 0); });
  for (const t of g.regions) { t.men = fullStrength(t.units); t.home = t.owner; }
  // Gallipoli: Ottoman home regions start dug in on every land border
  for (const t of g.regions) if (nationOf(t.owner).flags.gallipoli) for (const n of W.regions[t.id].adj) if (!W.seaLane.has(t.id + '|' + n)) { const w = (t.works[n] ??= { tr: 0, sand: 0, wire: 0 }); w.tr = Math.max(w.tr, 2); }
  // manpower pool: about three times the men under arms, scaled by nation
  for (const f of g.factions) { let m = 0; for (const t of g.regions) if (t.owner === f.id) for (const k of UNIT_TYPES) m += t.men[k]; f.men = Math.round(m * MANPOWER.startMult * nationOf(f.id).pool); }
  const pool = R.shuffle(buildMissions());
  g.factions.forEach(f => { const i = pool.findIndex(m => !(m.type === 'destroy' && m.target === f.id)); f.mission = pool.splice(i, 1)[0]; });
  g.factions.forEach(f => { if (f.mission!.type === 'destroy') (f.mission as { n0?: number }).n0 = g.regions.filter(r => r.owner === (f.mission as { target: number }).target).length; });
  g.rng = R.s;
  updateSupplyLines(g);
  g.events.push({ k: 'start' });
  return g;
}

const fullStrength = (u: Units) => { const m = emptyUnits(); for (const k of UNIT_TYPES) m[k] = u[k] * FORMATION[k].men; return m; };

/** Bring a saved game from an older version up to date. Returns null if it cannot be read. */
export function migrateState(s: GameState & { v: number }): GameState | null {
  if (!s || !Array.isArray(s.regions)) return null;
  if (s.v === 4) return fill4(s);
  if (s.v === 3) return migrate3(s);
  if (s.v !== 2) return null;
  const W = world();
  type Old = GameState['regions'][number] & { trench?: number };
  for (const r of s.regions as Old[]) {
    const tr = r.trench ?? 0; delete r.trench;
    r.works = {}; if (tr) for (const n of W.regions[r.id].adj) if (!W.seaLane.has(r.id + '|' + n)) r.works[n] = { tr, sand: 0, wire: 0 };
    r.men = fullStrength(r.units); r.mor = 80; r.cut = false; r.home = r.owner;
  }
  for (const f of s.factions) { f.ww ??= 0; f.wounded ??= 0; }
  for (const a of s.armies) { a.men ??= fullStrength(a.units); a.mor ??= 75; }
  for (const b of s.battles) { b.tr ??= 0; b.sand ??= 0; b.wire ??= 0; b.wire0 ??= 0; b.mor ??= {}; b.lost ??= {}; b.lastJoin ??= b.age; }
  s.intel = s.factions.map(() => []); s.spies = [];
  (s as { v: number }).v = 3; updateSupplyLines(s);
  return migrate3(s);
}

/** Version 3 → 4: battle levers and shells. Stockpiles start from the guns each power has; battles in progress get default levers. */
function migrate3(s: GameState): GameState {
  for (const f of s.factions) {
    let guns = 0; for (const r of s.regions) if (r.owner === f.id) guns += r.units.art + r.defs.filter(d => d.k === 'fort' && d.f === f.id).length;
    f.shells ??= SHELLS.start + guns * SHELLS.dump;
  }
  for (const r of s.regions) r.stance ??= 0;
  for (const b of s.battles) {
    b.bar ??= {}; b.st ??= {}; b.supp ??= {}; b.ammo ??= {}; b.used ??= {}; b.lostT ??= {}; b.mor0 ??= { ...b.mor }; b.reach ??= 99; b.craters ??= 0;
    b.go ??= b.age > 30;
  }
  s.reports ??= [];
  s.v = 4;
  return fill4(s);
}

/** Fields added to version 4 during the Great War update: defaults for saves made before them. */
function fill4(s: GameState): GameState {
  for (const f of s.factions) {
    if (f.men === undefined) { let m = 0; for (const t of s.regions) if (t.owner === f.id) for (const k of UNIT_TYPES) m += t.men[k]; f.men = Math.round(m * MANPOWER.startMult * nationOf(f.id).pool); }
    f.mob ??= 0; f.unrestT ??= 0;
  }
  return s;
}

/** Advance the simulation by dt seconds (callers use small fixed steps, e.g. 0.05). */
export function step(g: GameState, dt: number) {
  if (g.over) return;
  g.time += dt; g.supplyT += dt;
  if (g.supplyT >= TICK_SECONDS) { g.supplyT -= TICK_SECONDS; supplyTick(g); }
  for (let i = g.armies.length - 1; i >= 0; i--) { const a = g.armies[i]; a.t += dt / a.dur; if (a.t >= 1) { g.armies.splice(i, 1); arrive(g, a); } }
  for (let i = 0; i < g.battles.length; i++) stepBattle(g, g.battles[i], dt);
  updateSpies(g);
  for (let i = g.battles.length - 1; i >= 0; i--) if (g.battles[i].ended && g.time > g.battles[i].removeAt) g.battles.splice(i, 1);
  const d = DIFFICULTIES[g.diff] ?? DIFFICULTIES[1];
  for (const f of g.factions) { if (!f.alive || !f.ai) continue; f.aiT -= dt; if (f.aiT <= 0) { f.aiT = (2.5 + rnd(g) * 1.8) * d.ai; aiThink(g, f); } }
}

/** Convenience for tests and tools: run for `seconds` of game time in 0.05 s steps. */
export function run(g: GameState, seconds: number) { const n = Math.round(seconds / .05); for (let i = 0; i < n && !g.over; i++) step(g, .05); }

/** Take and clear the pending events. */
export function drainEvents(g: GameState) { const e = g.events; g.events = []; return e; }
