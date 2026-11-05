// One persistent world on the dedicated server: the authoritative simulation, its seats, connected players and spectators.
// Same rules as a browser host (createGame, step, applyCommand, makeSnapshot), saved after every convoy.
import {
  applyCommand, createGame, drainEvents, eventsFor, makeSnapshot, migrateState, step, TICK_DT,
  type ClientMsg, type Fx, type GameEvent, type GameSettings, type GameState, type ServerMsg, type WorldInfo,
} from '@riskrts/shared';
import { randomBytes } from 'node:crypto';

/** A connection as the world sees it. */
export interface Conn { id: string; send(m: ServerMsg): void }

interface SeatRec { faction: number; player: string | null; name: string | null; token: string | null }
interface Peer { conn: Conn; faction: number; spectator: boolean; watch: Set<number>; queue?: { at: number; msg: ServerMsg }[] }

/** What is written to disk. */
export interface SavedWorld { v: 1; id: string; name: string; ranked: boolean; difficulty: number; settings: GameSettings; seats: SeatRec[]; state: GameState; rated?: boolean }

/** Ranked worlds use fixed rules. */
export const RANKED_RULES: GameSettings = { attackCap: 3, pace: 1 };
const SNAP_EVERY = .1, SPEC_EVERY = .5;

export class World {
  readonly sim: GameState;
  readonly seats: SeatRec[];
  rated = false;
  private peers = new Map<string, Peer>();
  private acc = 0; private sinceSnap = 0; private sinceSpec = 0; private lastDay: number;
  private evNet: GameEvent[] = []; private fxNet: Fx[] = [];
  /** Called after every convoy (and on demand) with the state to persist. */
  onSave?: (w: SavedWorld) => void;
  /** Called once when the war ends. */
  onOver?: (w: World) => void;

  constructor(readonly id: string, readonly name: string, readonly ranked: boolean, readonly difficulty: number, readonly settings: GameSettings,
    opts: { seed?: number; restore?: SavedWorld; spectatorDelay?: number } = {}) {
    this.spectatorDelay = opts.spectatorDelay ?? 20;
    if (opts.restore) {
      const st = migrateState({ ...opts.restore.state, events: [], fx: [] } as GameState & { v: number });
      if (!st) throw new Error(`World ${id} cannot be read.`);
      this.sim = st; this.seats = opts.restore.seats; this.rated = !!opts.restore.rated;
      // nobody is connected after a restart: every power is on the computer until its player comes back
      for (const f of this.sim.factions) { f.ai = true; f.away = this.seats[f.id]?.player ? true : undefined; }
    } else {
      this.sim = createGame({ seed: opts.seed, humans: [], difficulty, settings, fx: true });
      this.seats = this.sim.factions.map(f => ({ faction: f.id, player: null, name: null, token: null }));
    }
    this.lastDay = this.sim.day;
  }
  readonly spectatorDelay: number;

  /** Casual worlds only run while someone plays; ranked worlds always run. */
  get running() { return !this.sim.over && (this.ranked || [...this.peers.values()].some(p => !p.spectator)); }
  get humans() { return [...this.peers.values()].filter(p => !p.spectator).length; }

  info(): WorldInfo {
    const online = new Set([...this.peers.values()].filter(p => !p.spectator).map(p => p.faction));
    return {
      id: this.id, name: this.name, ranked: this.ranked, day: this.sim.day, over: this.sim.over, winner: this.sim.winner, difficulty: this.difficulty, settings: this.settings,
      seats: this.seats.map(s => ({ faction: s.faction, name: s.name, online: online.has(s.faction) })),
      spectators: [...this.peers.values()].filter(p => p.spectator).length,
    };
  }

  /** Take a seat (a computer power, or your own again with its token). Returns the token or an error. */
  join(conn: Conn, faction: number, player: string, name: string, token?: string): { token: string } | { error: string } {
    const seat = this.seats[faction]; if (!seat) return { error: 'There is no such power.' };
    if (this.sim.over) return { error: 'This war is over.' };
    if (!player) return { error: 'Invalid player.' };
    // a held seat is only given back with its token (player ids are not secret)
    const mine = !!seat.player && !!token && seat.token === token;
    if (seat.player && !mine) return { error: `${seat.name ?? 'Another player'} commands that power.` };
    if (this.ranked && !mine && this.seats.some(s => s.player === player)) return { error: 'In a ranked war each player commands one power.' };
    for (const p of this.peers.values()) if (!p.spectator && p.faction === faction) return { error: 'That power is already being commanded from another window.' };
    seat.player = player; seat.name = name.slice(0, 20) || 'Commander'; seat.token ??= randomBytes(12).toString('hex');
    const f = this.sim.factions[faction]; f.ai = false; f.away = undefined;
    this.peers.set(conn.id, { conn, faction, spectator: false, watch: new Set() });
    conn.send({ t: 'joined', world: this.id, faction, token: seat.token, ranked: this.ranked });
    conn.send({ t: 'start', seed: this.sim.seed, humans: this.seats.filter(s => s.player).map(s => s.faction), difficulty: this.difficulty, you: faction, settings: this.settings });
    this.sendSnap(this.peers.get(conn.id)!, true);
    return { token: seat.token };
  }

  /** Watch the war with full vision, delayed so a spectator cannot scout for a player. */
  spectate(conn: Conn, follow: number) {
    const p: Peer = { conn, faction: Math.max(0, Math.min(this.sim.factions.length - 1, follow | 0)), spectator: true, watch: new Set(), queue: [] };
    this.peers.set(conn.id, p);
    conn.send({ t: 'spectating', world: this.id, follow: p.faction, delay: this.spectatorDelay });
    conn.send({ t: 'start', seed: this.sim.seed, humans: [], difficulty: this.difficulty, you: p.faction, settings: this.settings });
  }

  /** A connection leaves: its power goes back to the computer, which keeps the player's stances and doctrines. */
  leave(connId: string) {
    const p = this.peers.get(connId); if (!p) return;
    this.peers.delete(connId);
    if (!p.spectator) { const f = this.sim.factions[p.faction]; f.ai = true; f.away = true; f.aiT = 2; }
  }

  message(connId: string, m: ClientMsg) {
    const p = this.peers.get(connId); if (!p) return;
    if (m.t === 'cmd') {
      if (p.spectator) { p.conn.send({ t: 'err', message: 'Spectators cannot give orders.' }); return; }
      const err = applyCommand(this.sim, p.faction, m.cmd); if (err) p.conn.send({ t: 'err', message: err });
    } else if (m.t === 'watch') p.watch = new Set(m.battles.slice(0, 8));
    else if (m.t === 'ping') p.conn.send({ t: 'pong', at: m.at });
  }

  /** Advance by real seconds (ticks fixed 50 ms steps), stream snapshots, save after each convoy. */
  update(dt: number) {
    if (this.running) {
      this.acc += Math.min(dt, .5);
      while (this.acc >= TICK_DT) { step(this.sim, TICK_DT); this.acc -= TICK_DT; this.collect(); }
      if (this.sim.day !== this.lastDay) { this.lastDay = this.sim.day; this.save(); }
      if (this.sim.over) { this.save(); this.onOver?.(this); }
    }
    this.sinceSnap += dt; this.sinceSpec += dt;
    if (this.sinceSnap >= SNAP_EVERY) {
      this.sinceSnap = 0;
      for (const p of this.peers.values()) if (!p.spectator) this.sendSnap(p, false);
      this.specEv.push(...eventsFor(this.sim, this.evNet, -1));
      if (this.sinceSpec >= SPEC_EVERY) { this.sinceSpec = 0; this.queueSpectators(); }
      this.evNet.length = 0; this.fxNet.length = 0;
    }
    this.flushSpectators();
  }

  private collect() {
    const ev = drainEvents(this.sim); if (ev.length) this.evNet.push(...ev);
    const fx = this.sim.fx; if (fx && fx.length) { if (this.peers.size) this.fxNet.push(...fx); fx.length = 0; if (this.fxNet.length > 1500) this.fxNet.splice(0, this.fxNet.length - 1500); }
  }

  private sendSnap(p: Peer, full: boolean) {
    const fx = this.fxNet.filter(f => p.watch.has(f.b));
    p.conn.send({ t: 'snap', snap: makeSnapshot(this.sim, p.faction, p.watch, fx), events: full ? [] : eventsFor(this.sim, this.evNet, p.faction), speed: this.running ? 1 : 0 });
  }

  /** Spectators get full-vision snapshots (no sealed orders) after a delay. */
  private specEv: GameEvent[] = [];
  private queueSpectators() {
    const specs = [...this.peers.values()].filter(p => p.spectator);
    if (!specs.length) { this.specEv.length = 0; return; }
    const snap = makeSnapshot(this.sim, -1, [], []);
    const at = Date.now() / 1000;
    for (const p of specs) p.queue!.push({ at, msg: { t: 'snap', snap, events: this.specEv.slice(), speed: this.running ? 1 : 0 } });
    this.specEv.length = 0;
  }
  private flushSpectators() {
    const now = Date.now() / 1000;
    for (const p of this.peers.values()) {
      if (!p.spectator || !p.queue) continue;
      while (p.queue.length && now - p.queue[0].at >= this.spectatorDelay) p.conn.send(p.queue.shift()!.msg);
      if (p.queue.length > 400) p.queue.splice(0, p.queue.length - 400);
    }
  }

  save(): SavedWorld {
    const { events: _e, fx: _f, ...state } = this.sim;
    const w: SavedWorld = { v: 1, id: this.id, name: this.name, ranked: this.ranked, difficulty: this.difficulty, settings: this.settings, seats: this.seats, state: { ...state, events: [], fx: null } as GameState, rated: this.rated };
    this.onSave?.(w); return w;
  }

  /** Human players of the war, by seat: [faction, player id, name]. */
  players(): [number, string, string][] { return this.seats.filter(s => s.player).map(s => [s.faction, s.player!, s.name ?? 'Commander']); }
  has(connId: string) { return this.peers.has(connId); }
}
