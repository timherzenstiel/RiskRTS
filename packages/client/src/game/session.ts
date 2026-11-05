// A Session is the client's view of one running game. The UI and renderer only talk to this interface,
// so single player, hosting and joining all look the same to them.
import {
  applyCommand, applySnapshot, createGame, eventsFor, createMirror, drainEvents, fogView, initMirrorCapitals, makeSnapshot, migrateState, step, TICK_DT,
  type Command, type Fx, type GameEvent, type GameSettings, type GameState, type ServerMsg, type ClientMsg,
} from '@riskrts/shared';
import type { Channel } from '../net/channel';

export interface Session {
  readonly kind: 'local' | 'host' | 'guest';
  /** My faction id. */
  readonly me: number;
  /** What this player may see: a fog-of-war view of the authoritative state (local/host) or the host's fogged mirror (guest). Read-only. */
  readonly state: GameState;
  /** Game speed multiplier; only the local player or the host can change it. 0 = paused. */
  speed: number;
  readonly canControlTime: boolean;
  /** Issue a command. Local/host: returns an error text or null immediately. Guest: returns null, errors arrive via onError. */
  send(cmd: Command): string | null;
  /** Battle ids whose per-unit detail this client wants (guests only need it for battles on screen). */
  setWatch(ids: number[]): void;
  /** Advance by real elapsed seconds. Called once per frame. */
  update(dt: number): void;
  drainEvents(): GameEvent[];
  drainFx(): Fx[];
  onError?: (message: string) => void;
  destroy(): void;
}

const SNAP_EVERY = .1;

interface PeerSlot { id: string; faction: number; ch: Channel; watch: Set<number> }

/** Runs the simulation in this browser. With no peers it is plain single player; with peers it is the authoritative host. */
export class HostSession implements Session {
  kind: 'local' | 'host';
  /** The authoritative game. Never shown directly: the UI gets the fogged view. */
  private readonly sim: GameState;
  private view: GameState;
  get state() { return this.view; }
  speed = 1;
  readonly canControlTime = true;
  onError?: (m: string) => void;
  private acc = 0; private sinceSnap = 0;
  private evBuf: GameEvent[] = []; private fxBuf: Fx[] = [];
  private evNet: GameEvent[] = []; private fxNet: Fx[] = [];
  private peers = new Map<string, PeerSlot>();
  private myWatch = new Set<number>();

  constructor(public readonly me: number, opts: { seed?: number; humans: number[]; difficulty: number; settings?: GameSettings; network?: boolean; restore?: GameState }) {
    this.sim = opts.restore ?? createGame({ seed: opts.seed, humans: opts.humans, difficulty: opts.difficulty, settings: opts.settings, fx: true });
    if (opts.restore) { opts.restore.fx = []; opts.restore.events = []; }
    this.view = fogView(this.sim, me);
    this.kind = opts.network ? 'host' : 'local';
    this.collect();
  }

  /** Serialise the whole game (single player save). Battles in progress are included as-is. */
  serialize(): string { const { events: _e, fx: _f, ...rest } = this.sim; return JSON.stringify({ me: this.me, state: rest }); }
  /** Rebuild a single-player session from serialize(). Returns null if the data is unusable. */
  static restore(json: string): HostSession | null {
    try {
      const d = JSON.parse(json) as { me: number; state: GameState }; const st = d.state && migrateState({ ...d.state, events: [], fx: [] });
      if (!st) return null; return new HostSession(d.me, { humans: [d.me], difficulty: st.diff, restore: st });
    }
    catch { return null; }
  }

  addPeer(id: string, faction: number, ch: Channel) {
    const slot: PeerSlot = { id, faction, ch, watch: new Set() };
    this.peers.set(id, slot);
    ch.onMessage((raw) => this.fromPeer(slot, raw as ClientMsg));
    ch.onClose(() => { this.peers.delete(id); this.sim.factions[faction].ai = true; });
    this.sendSnap(slot, true);
  }

  private fromPeer(p: PeerSlot, m: ClientMsg) {
    if (m.t === 'cmd') { const err = applyCommand(this.sim, p.faction, m.cmd); if (err) p.ch.send({ t: 'err', message: err } satisfies ServerMsg); }
    else if (m.t === 'watch') p.watch = new Set(m.battles.slice(0, 8));
    else if (m.t === 'ping') p.ch.send({ t: 'pong', at: m.at } satisfies ServerMsg);
  }

  send(cmd: Command) { const e = applyCommand(this.sim, this.me, cmd); this.view = fogView(this.sim, this.me); return e; }
  setWatch(ids: number[]) { this.myWatch = new Set(ids); }

  update(dt: number) {
    if (this.sim.over || this.speed <= 0) { this.collect(); this.view = fogView(this.sim, this.me); return; }
    this.acc += Math.min(dt, .25) * this.speed;
    while (this.acc >= TICK_DT) { step(this.sim, TICK_DT); this.acc -= TICK_DT; this.collect(); }
    this.view = fogView(this.sim, this.me);
    if (this.peers.size) { this.sinceSnap += dt; if (this.sinceSnap >= SNAP_EVERY) { this.sinceSnap = 0; for (const p of this.peers.values()) this.sendSnap(p, false); this.evNet.length = 0; this.fxNet.length = 0; } }
  }

  private collect() {
    const ev = drainEvents(this.sim); if (ev.length) { this.evBuf.push(...ev); this.evNet.push(...ev); }
    const fx = this.sim.fx; if (fx && fx.length) { this.fxBuf.push(...fx); if (this.peers.size) this.fxNet.push(...fx); fx.length = 0; if (this.fxNet.length > 1500) this.fxNet.splice(0, this.fxNet.length - 1500); }
    if (this.fxBuf.length > 1500) this.fxBuf.splice(0, this.fxBuf.length - 1500);
  }

  private sendSnap(p: PeerSlot, full: boolean) {
    const fx = this.fxNet.filter(f => p.watch.has(f.b));
    const msg: ServerMsg = { t: 'snap', snap: makeSnapshot(this.sim, p.faction, p.watch, fx), events: full ? [] : eventsFor(this.sim, this.evNet, p.faction), speed: this.speed };
    try { p.ch.send(msg); } catch { /* peer went away; onClose will clean up */ }
  }

  drainEvents() { const e = this.evBuf; this.evBuf = []; return e; }
  drainFx() { const f = this.fxBuf; this.fxBuf = []; return f; }
  destroy() { for (const p of this.peers.values()) p.ch.close(); this.peers.clear(); }
  /** Connected guest count (host only). */
  get peerCount() { return this.peers.size; }
}

/** Mirrors a host's game over a Channel. Never simulates; only displays what the host sends. */
export class GuestSession implements Session {
  readonly kind = 'guest' as const;
  /** Dedicated server: watching with full vision (orders are refused), or a ranked war. */
  spectator = false; ranked = false;
  readonly state: GameState = createMirror();
  speed = 1;
  readonly canControlTime = false;
  onError?: (m: string) => void;
  latency = 0;
  private evBuf: GameEvent[] = []; private fxBuf: Fx[] = [];
  private lastWatch = '';

  constructor(public readonly me: number, private ch: Channel) {
    initMirrorCapitals(this.state);
    ch.onMessage((raw) => this.fromHost(raw as ServerMsg));
    this.pingTimer = setInterval(() => ch.send({ t: 'ping', at: performance.now() } satisfies ClientMsg), 3000);
  }
  private pingTimer: ReturnType<typeof setInterval>;

  private fromHost(m: ServerMsg) {
    if (m.t === 'snap') {
      applySnapshot(this.state, m.snap); this.speed = m.speed;
      this.evBuf.push(...m.events); this.state.events.length = 0;
      const fx = this.state.fx; if (fx && fx.length) { this.fxBuf.push(...fx); fx.length = 0; }
    } else if (m.t === 'err') this.onError?.(m.message);
    else if (m.t === 'pong') this.latency = Math.round(performance.now() - m.at);
  }

  send(cmd: Command) { this.ch.send({ t: 'cmd', cmd } satisfies ClientMsg); return null; }
  setWatch(ids: number[]) { const k = ids.join(','); if (k === this.lastWatch) return; this.lastWatch = k; this.ch.send({ t: 'watch', battles: ids } satisfies ClientMsg); }
  /** Between snapshots, keep the convoy clock moving so the countdown ring is smooth. */
  update(dt: number) { if (!this.state.over && this.speed > 0) { this.state.supplyT += dt * this.speed; this.state.time += dt * this.speed; } }
  drainEvents() { const e = this.evBuf; this.evBuf = []; return e; }
  drainFx() { const f = this.fxBuf; this.fxBuf = []; return f; }
  destroy() { clearInterval(this.pingTimer); this.ch.close(); }
}
