// Creating and advancing a game.
import { FACTIONS, NUM_FACTIONS } from '../data/factions';
import { emptyUnits } from '../data/units';
import { Rng } from '../rng';
import { world, rnd } from './core';
import { aiThink } from './ai';
import { arrive } from './commands';
import { DIFFICULTIES, supplyTick } from './economy';
import { stepBattle } from './battle';
import { buildMissions } from './missions';
import { TICK_SECONDS } from '../data/units';
import { DEFAULT_SETTINGS, type GameSettings, type GameState } from './types';
import { DT } from '../data/units';

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
    v: 2, seed, rng: R.s, time: 0, day: 0, supplyT: 0, diff: opt.difficulty ?? 1, cfg: { ...DEFAULT_SETTINGS, ...opt.settings },
    regions: W.regions.map(r => ({ id: r.id, owner: -1, units: emptyUnits(), trench: 0, factory: false, barracks: false, airfield: false, defs: [], contested: -1, capitalOf: -1, battle: -1 })),
    factions: FACTIONS.map((_, id) => ({ id, supply: opt.humans.includes(id) ? 8 : 5, alive: true, mission: null, aiT: 1.5 + R.next() * 2, ai: !opt.humans.includes(id) })),
    armies: [], battles: [], over: false, winner: null, nextId: 1,
    stats: { won: Array(NUM_FACTIONS).fill(0), lost: Array(NUM_FACTIONS).fill(0) },
    events: [], fx: opt.fx === false ? null : [],
  };
  FACTIONS.forEach((f, id) => { const t = g.regions[W.byName[f.capital].id]; t.owner = id; t.capitalOf = id; t.units = { inf: 6, mg: 2, art: 1, tank: 0, plane: 0 }; t.trench = 2; t.factory = true; t.defs.push({ id: g.nextId++, k: 'pill', s: -1, hp: DT.pill.hp, f: id }); });
  const rest = R.shuffle(g.regions.filter(t => t.owner < 0)), off = R.int(6);
  rest.forEach((t, k) => { t.owner = (k + off) % NUM_FACTIONS; t.units.inf = 2 + (R.next() < .5 ? 1 : 0); });
  const pool = R.shuffle(buildMissions());
  g.factions.forEach(f => { const i = pool.findIndex(m => !(m.type === 'destroy' && m.target === f.id)); f.mission = pool.splice(i, 1)[0]; });
  g.factions.forEach(f => { if (f.mission!.type === 'destroy') (f.mission as { n0?: number }).n0 = g.regions.filter(r => r.owner === (f.mission as { target: number }).target).length; });
  g.rng = R.s;
  g.events.push({ k: 'start' });
  return g;
}

/** Advance the simulation by dt seconds (callers use small fixed steps, e.g. 0.05). */
export function step(g: GameState, dt: number) {
  if (g.over) return;
  g.time += dt; g.supplyT += dt;
  if (g.supplyT >= TICK_SECONDS) { g.supplyT -= TICK_SECONDS; supplyTick(g); }
  for (let i = g.armies.length - 1; i >= 0; i--) { const a = g.armies[i]; a.t += dt / a.dur; if (a.t >= 1) { g.armies.splice(i, 1); arrive(g, a); } }
  for (const b of g.battles) stepBattle(g, b, dt);
  for (let i = g.battles.length - 1; i >= 0; i--) if (g.battles[i].ended && g.time > g.battles[i].removeAt) g.battles.splice(i, 1);
  const d = DIFFICULTIES[g.diff] ?? DIFFICULTIES[1];
  for (const f of g.factions) { if (!f.alive || !f.ai) continue; f.aiT -= dt; if (f.aiT <= 0) { f.aiT = (2.5 + rnd(g) * 1.8) * d.ai; aiThink(g, f); } }
}

/** Convenience for tests and tools: run for `seconds` of game time in 0.05 s steps. */
export function run(g: GameState, seconds: number) { const n = Math.round(seconds / .05); for (let i = 0; i < n && !g.over; i++) step(g, .05); }

/** Take and clear the pending events. */
export function drainEvents(g: GameState) { const e = g.events; g.events = []; return e; }
