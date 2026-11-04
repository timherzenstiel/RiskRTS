// Network snapshots. The host builds one per guest (secret missions stay secret) and guests fold it into a mirror GameState.
import { FACTIONS } from '../data/factions';
import { AGENT_TYPES, DEF_KINDS, emptyUnits, type AgentType } from '../data/units';
import { world } from './core';
import { DEFAULT_SETTINGS, type Agent, type Army, type Battle, type Fx, type GameSettings, type GameState, type Mission } from './types';

/** [agent type index, faction, x, z, face, flags(1 dead,2 moving,4 trench,8 left the field), seconds since last shot] */
export type AgentSnap = [number, number, number, number, number, number, number];
export interface BattleSnap {
  id: number; region: number; ax: number; az: number; age: number; ended: boolean; sides: number[]; attacker: number; def: number; from: number;
  counts: [number, number, number][]; agents?: AgentSnap[];
}
export interface Snapshot {
  time: number; day: number; supplyT: number; diff: number; over: boolean; winner: number | null;
  /** [supply, alive] per faction. */
  f: [number, number][];
  /** The recipient's own mission; all missions once the game is over. */
  missions: (Mission | null)[];
  /** [owner, inf, mg, art, tank, plane, trench, flags(1 factory, 2 barracks, 4 airfield), battle, contested] per region. */
  r: number[][];
  /** Defences: [region, id, kind index, sector, hp, faction]. */
  d: number[][];
  cfg: GameSettings;
  a: Army[];
  b: BattleSnap[];
  stats: { won: number[]; lost: number[] };
  fx?: Fx[];
}

const q2 = (n: number) => Math.round(n * 100) / 100;

export function makeSnapshot(g: GameState, recipient: number, watch: Iterable<number> = [], fx?: Fx[]): Snapshot {
  const w = new Set(watch);
  const missions = g.factions.map(f => (g.over || f.id === recipient) ? f.mission : null);
  const b: BattleSnap[] = g.battles.map(x => {
    const cnt = new Map<number, [number, number]>();
    for (const a of x.agents) { const c = cnt.get(a.f) ?? [0, 0]; c[1]++; if (!a.dead && !a.out) c[0]++; cnt.set(a.f, c); }
    const s: BattleSnap = { id: x.id, region: x.region, ax: q2(x.ax), az: q2(x.az), age: q2(x.age), ended: x.ended, sides: x.sides, attacker: x.attacker, def: x.def, from: x.from, counts: [...cnt].map(([f, c]) => [f, c[0], c[1]]) };
    if (w.has(x.id)) s.agents = x.agents.map(a => [AGENT_TYPES.indexOf(a.type), a.f, q2(a.x), q2(a.z), q2(a.face), (a.dead ? 1 : 0) | (a.moving ? 2 : 0) | (a.trench ? 4 : 0) | (a.out ? 8 : 0), q2(Math.max(0, Math.min(9, g.time - a.fireT)))]);
    return s;
  });
  return {
    time: q2(g.time), day: g.day, supplyT: q2(g.supplyT), diff: g.diff, over: g.over, winner: g.winner,
    f: g.factions.map(f => [f.supply, f.alive ? 1 : 0]), missions,
    r: g.regions.map(r => [r.owner, r.units.inf, r.units.mg, r.units.art, r.units.tank, r.units.plane, r.trench, (r.factory ? 1 : 0) | (r.barracks ? 2 : 0) | (r.airfield ? 4 : 0), r.battle, r.contested]),
    d: g.regions.flatMap(r => r.defs.map(d => [r.id, d.id, DEF_KINDS.indexOf(d.k), d.s, Math.round(d.hp), d.f])), cfg: g.cfg,
    a: g.armies, b, stats: g.stats, fx,
  };
}

/** An empty state for a guest to mirror the host into. */
export function createMirror(): GameState {
  const W = world();
  return {
    v: 2, seed: 0, rng: 0, time: 0, day: 0, supplyT: 0, diff: 1, cfg: { ...DEFAULT_SETTINGS },
    regions: W.regions.map(r => ({ id: r.id, owner: -1, units: emptyUnits(), trench: 0, factory: false, barracks: false, airfield: false, defs: [], contested: -1, capitalOf: -1, battle: -1 })),
    factions: FACTIONS.map((_, id) => ({ id, supply: 0, alive: true, mission: null, aiT: 0, ai: false })),
    armies: [], battles: [], over: false, winner: null, nextId: 1, stats: { won: [], lost: [] }, events: [], fx: [],
  };
}

/** Capitals never change hands in the data; mirrors learn them from the first snapshot's region order. */
export function initMirrorCapitals(m: GameState) {
  const W = world();
  FACTIONS.forEach((f, id) => { m.regions[W.byName[f.capital].id].capitalOf = id; });
}

export function applySnapshot(m: GameState, s: Snapshot) {
  m.time = s.time; m.day = s.day; m.supplyT = s.supplyT; m.diff = s.diff; m.over = s.over; m.winner = s.winner; m.stats = s.stats;
  s.f.forEach(([sup, alive], i) => { m.factions[i].supply = sup; m.factions[i].alive = !!alive; if (s.missions[i]) m.factions[i].mission = s.missions[i]; });
  if (s.cfg) m.cfg = s.cfg;
  s.r.forEach((r, i) => { const t = m.regions[i]; t.owner = r[0]; t.units.inf = r[1]; t.units.mg = r[2]; t.units.art = r[3]; t.units.tank = r[4]; t.units.plane = r[5]; t.trench = r[6]; t.factory = !!(r[7] & 1); t.barracks = !!(r[7] & 2); t.airfield = !!(r[7] & 4); t.battle = r[8]; t.contested = r[9]; t.defs = []; });
  for (const [ri, id, k, sec, hp, f] of s.d ?? []) m.regions[ri].defs.push({ id, k: DEF_KINDS[k], s: sec, hp, f });
  m.armies = s.a;
  const keep = new Set<number>();
  for (const bs of s.b) {
    keep.add(bs.id);
    let b = m.battles.find(x => x.id === bs.id);
    if (!b) { b = { id: bs.id, region: bs.region, ax: bs.ax, az: bs.az, agents: [], shells: [], age: 0, ended: false, removeAt: 0, endCheck: 0, sides: [], attacker: bs.attacker, def: bs.def, from: bs.from }; m.battles.push(b); }
    b.age = bs.age; b.ended = bs.ended; b.sides = bs.sides; b.counts = bs.counts; b.ax = bs.ax; b.az = bs.az; b.def = bs.def; b.from = bs.from;
    if (bs.agents) {
      const old = b.agents;
      b.agents = bs.agents.map((a, i): Agent => ({ f: a[1], type: AGENT_TYPES[a[0]] as AgentType, x: a[2], z: a[3], hp: 1, cd: 0, rt: 0, tgt: -1, dead: !!(a[5] & 1), dieT: old[i]?.dieT ?? (a[5] & 1 ? m.time : 0), fireT: m.time - a[6], face: a[4], phase: old[i]?.phase ?? 0, moving: !!(a[5] & 2), trench: !!(a[5] & 4), out: !!(a[5] & 8) }));
    }
  }
  m.battles = m.battles.filter(b => keep.has(b.id));
  if (s.fx && m.fx) m.fx.push(...s.fx);
}

/** [alive, total] per faction in a battle, whether or not agents are streamed. */
export function battleCounts(b: Battle): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  if (b.agents.length) { for (const a of b.agents) { const c = out.get(a.f) ?? [0, 0]; c[1]++; if (!a.dead && !a.out) c[0]++; out.set(a.f, c); } }
  else for (const [f, al, all] of b.counts ?? []) out.set(f, [al, all]);
  return out;
}
