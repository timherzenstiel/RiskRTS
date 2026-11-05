// Network snapshots. The host builds one per guest (secret missions stay secret) and guests fold it into a mirror GameState.
import { FACTIONS } from '../data/factions';
import { AGENT_TYPES, DEF_KINDS, type AgentType } from '../data/units';
import { newRegion, world } from './core';
import { fogView } from './fog';
import { DEFAULT_SETTINGS, type Agent, type Army, type Barrage, type Battle, type Fx, type GameSettings, type GameState, type Mission, type Report, type Spy, type Stance } from './types';

/** [agent type index, faction, x, z, face, flags(1 dead,2 moving,4 trench,8 left the field), seconds since last shot] */
export type AgentSnap = [number, number, number, number, number, number, number];
export interface BattleSnap {
  id: number; region: number; ax: number; az: number; age: number; ended: boolean; sides: number[]; attacker: number; def: number; from: number;
  tr: number; sand: number; wire: number; wire0: number; mor: Record<number, number>; lastJoin: number;
  counts: [number, number, number][]; agents?: AgentSnap[];
  /** Levers per faction: barrage, stance, suppression (rounded), shells in the local dump and spent; over the top; closest approach. */
  bar: Record<number, Barrage>; st: Record<number, Stance>; supp: Record<number, number>; ammo: Record<number, number>; used: Record<number, number>; go: boolean; reach: number;
}
export interface Snapshot {
  time: number; day: number; supplyT: number; diff: number; over: boolean; winner: number | null;
  /** [supply, alive, war weariness, wounded, shells, manpower pool, mobilisation, unrest convoys] per faction. */
  f: [number, number, number, number, number, number, number, number][];
  /** After-action reports of battles the recipient fought in. */
  rep?: Report[];
  /** Rail links cut until a day, and lines under construction. */
  rc?: Record<string, number>; rn?: [number, number, number][];
  /** The recipient's own mission; all missions once the game is over. */
  missions: (Mission | null)[];
  /**
   * Per region: [owner, inf, mg, art, tank, plane, flags(1 factory, 2 barracks, 4 airfield, 8 cut off, 16 spied), battle, contested,
   * visibility, report day (-1), estimate low, estimate high (-1), morale, men inf, mg, art, tank, plane, home power, stance]. Already fogged for the recipient.
   */
  r: number[][];
  /** Field works: [region, sector, trench, sandbags, wire]. */
  w: number[][];
  /** The recipient's spies. */
  spies: Spy[];
  /** Defences: [region, id, kind index, sector, hp, faction]. */
  d: number[][];
  cfg: GameSettings;
  a: Army[];
  b: BattleSnap[];
  stats: { won: number[]; lost: number[] };
  fx?: Fx[];
}

const q2 = (n: number) => Math.round(n * 100) / 100;
const rnd0 = (o?: Record<number, number>) => { const r: Record<number, number> = {}; if (o) for (const [k, v] of Object.entries(o)) r[+k] = Math.round(v); return r; };

export function makeSnapshot(full: GameState, recipient: number, watch: Iterable<number> = [], fx?: Fx[]): Snapshot {
  const w = new Set(watch), g = fogView(full, recipient);
  const missions = full.factions.map(f => (full.over || f.id === recipient) ? f.mission : null);
  const b: BattleSnap[] = g.battles.map(x => {
    const cnt = new Map<number, [number, number]>();
    for (const a of x.agents) { const c = cnt.get(a.f) ?? [0, 0]; c[1]++; if (!a.dead && !a.out) c[0]++; cnt.set(a.f, c); }
    const mor: Record<number, number> = {}; for (const [f, m] of Object.entries(x.mor ?? {})) mor[+f] = Math.round(m);
    const s: BattleSnap = { id: x.id, region: x.region, ax: q2(x.ax), az: q2(x.az), age: q2(x.age), ended: x.ended, sides: x.sides, attacker: x.attacker, def: x.def, from: x.from,
      tr: x.tr, sand: x.sand, wire: Math.round(x.wire), wire0: x.wire0, mor, lastJoin: q2(x.lastJoin ?? 0), counts: [...cnt].map(([f, c]) => [f, c[0], c[1]]),
      bar: x.bar ?? {}, st: x.st ?? {}, supp: rnd0(x.supp), ammo: rnd0(x.ammo), used: rnd0(x.used), go: !!x.go, reach: q2(Math.min(99, x.reach ?? 99)) };
    if (w.has(x.id)) s.agents = x.agents.map(a => [AGENT_TYPES.indexOf(a.type), a.f, q2(a.x), q2(a.z), q2(a.face), (a.dead ? 1 : 0) | (a.moving ? 2 : 0) | (a.trench ? 4 : 0) | (a.out ? 8 : 0), q2(Math.max(0, Math.min(9, g.time - a.fireT)))]);
    return s;
  });
  return {
    time: q2(g.time), day: g.day, supplyT: q2(g.supplyT), diff: g.diff, over: g.over, winner: g.winner,
    f: g.factions.map(f => [f.supply, f.alive ? 1 : 0, Math.round(f.ww * 10) / 10, Math.round(f.wounded), Math.floor(f.shells ?? 0), Math.floor(f.men ?? 0), f.mob ?? 0, f.unrestT ?? 0]), missions, rep: g.reports, rc: g.railCut, rn: g.railNew,
    r: g.regions.map(r => [r.owner, r.units.inf, r.units.mg, r.units.art, r.units.tank, r.units.plane,
      (r.factory ? 1 : 0) | (r.barracks ? 2 : 0) | (r.airfield ? 4 : 0) | (r.cut ? 8 : 0) | (r.spied ? 16 : 0) | (r.strike ? 32 : 0), r.battle, r.contested,
      r.vis ?? 3, r.seen ?? -1, r.est ? r.est[0] : -1, r.est ? r.est[1] : -1, Math.round(r.mor), r.men.inf, r.men.mg, r.men.art, r.men.tank, r.men.plane, r.home, r.stance ?? 0, r.supplyQ ?? -1]),
    w: g.regions.flatMap(r => Object.entries(r.works).map(([s, x]) => [r.id, +s, x.tr, x.sand, x.wire])),
    spies: g.spies,
    d: g.regions.flatMap(r => r.defs.map(d => [r.id, d.id, DEF_KINDS.indexOf(d.k), d.s, Math.round(d.hp), d.f])), cfg: g.cfg,
    a: g.armies, b, stats: g.stats, fx,
  };
}

/** An empty state for a guest to mirror the host into. */
export function createMirror(): GameState {
  const W = world();
  return {
    v: 4, seed: 0, rng: 0, time: 0, day: 0, supplyT: 0, diff: 1, cfg: { ...DEFAULT_SETTINGS },
    regions: W.regions.map(r => newRegion(r.id)),
    factions: FACTIONS.map((_, id) => ({ id, supply: 0, alive: true, mission: null, aiT: 0, ai: false, ww: 0, wounded: 0, shells: 0, men: 0, mob: 0, unrestT: 0 })),
    armies: [], battles: [], intel: FACTIONS.map(() => []), spies: [], reports: [], railCut: {}, railNew: [], over: false, winner: null, nextId: 1, stats: { won: [], lost: [] }, events: [], fx: [],
  };
}

/** Capitals never change hands in the data; mirrors learn them from the first snapshot's region order. */
export function initMirrorCapitals(m: GameState) {
  const W = world();
  FACTIONS.forEach((f, id) => { m.regions[W.byName[f.capital].id].capitalOf = id; });
}

export function applySnapshot(m: GameState, s: Snapshot) {
  m.time = s.time; m.day = s.day; m.supplyT = s.supplyT; m.diff = s.diff; m.over = s.over; m.winner = s.winner; m.stats = s.stats;
  s.f.forEach(([sup, alive, ww, wounded, shells, men, mob, unr], i) => {
    const f = m.factions[i]; f.supply = sup; f.alive = !!alive; f.ww = ww ?? 0; f.wounded = wounded ?? 0; f.shells = shells ?? 0; f.men = men ?? 0; f.mob = mob ?? 0; f.unrestT = unr ?? 0;
    if (s.missions[i]) f.mission = s.missions[i];
  });
  m.reports = s.rep ?? []; m.railCut = s.rc ?? {}; m.railNew = s.rn ?? [];
  if (s.cfg) m.cfg = s.cfg;
  s.r.forEach((r, i) => {
    const t = m.regions[i]; t.owner = r[0]; t.units.inf = r[1]; t.units.mg = r[2]; t.units.art = r[3]; t.units.tank = r[4]; t.units.plane = r[5];
    t.factory = !!(r[6] & 1); t.barracks = !!(r[6] & 2); t.airfield = !!(r[6] & 4); t.cut = !!(r[6] & 8); t.spied = !!(r[6] & 16); t.strike = !!(r[6] & 32); t.battle = r[7]; t.contested = r[8];
    t.vis = r[9]; t.seen = r[10] >= 0 ? r[10] : undefined; t.est = r[12] >= 0 ? [r[11], r[12]] : undefined; t.mor = r[13];
    t.men = { inf: r[14], mg: r[15], art: r[16], tank: r[17], plane: r[18] }; t.home = r[19] ?? -1; t.stance = (r[20] ?? 0) as Stance; t.supplyQ = r[21] !== undefined && r[21] >= 0 ? r[21] : undefined; t.defs = []; t.works = {};
  });
  for (const [ri, sec, tr, sand, wire] of s.w ?? []) m.regions[ri].works[sec] = { tr, sand, wire };
  for (const [ri, id, k, sec, hp, f] of s.d ?? []) m.regions[ri].defs.push({ id, k: DEF_KINDS[k], s: sec, hp, f });
  m.spies = s.spies ?? []; m.viewer = undefined;
  m.armies = s.a;
  const keep = new Set<number>();
  for (const bs of s.b) {
    keep.add(bs.id);
    let b = m.battles.find(x => x.id === bs.id);
    if (!b) {
      b = { id: bs.id, region: bs.region, ax: bs.ax, az: bs.az, agents: [], shells: [], age: 0, ended: false, removeAt: 0, endCheck: 0, sides: [], attacker: bs.attacker, def: bs.def, from: bs.from, tr: 0, sand: 0, wire: 0, wire0: 0, mor: {}, lost: {}, lastJoin: 0,
        bar: {}, st: {}, go: false, supp: {}, ammo: {}, used: {}, lostT: {}, mor0: {}, reach: 99, craters: 0 };
      m.battles.push(b);
    }
    b.bar = bs.bar ?? {}; b.st = bs.st ?? {}; b.supp = bs.supp ?? {}; b.ammo = bs.ammo ?? {}; b.used = bs.used ?? {}; b.go = !!bs.go; b.reach = bs.reach ?? 99;
    b.age = bs.age; b.ended = bs.ended; b.sides = bs.sides; b.counts = bs.counts; b.ax = bs.ax; b.az = bs.az; b.def = bs.def; b.from = bs.from;
    b.tr = bs.tr; b.sand = bs.sand; b.wire = bs.wire; b.wire0 = bs.wire0; b.mor = bs.mor; b.lastJoin = bs.lastJoin;
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
