// Lobby logic on top of Channels. Host owns the truth; guests only claim seats and wait for the start message.
import { DEFAULT_SETTINGS, FACTIONS, PROTOCOL_VERSION, type ClientMsg, type GameSettings, type LobbyState, type ServerMsg, type Seat } from '@riskrts/shared';
import type { Channel } from './channel';
import { openRoom, type RoomHost } from './peer';
import { HostSession } from '../game/session';

const newSeats = (): Seat[] => FACTIONS.map((_, faction) => ({ faction, player: null, name: null, ai: true }));

export class LobbyHost {
  readonly state: LobbyState;
  private chans = new Map<string, Channel>();
  private room!: RoomHost;
  onChange?: (l: LobbyState) => void;
  /** Called when the host presses start; the host's UI should switch to the game with this session. */
  onStarted?: (s: HostSession) => void;

  private constructor(private hostName: string) {
    this.state = { room: '', hostId: 'host', difficulty: 1, started: false, settings: { ...DEFAULT_SETTINGS }, seats: newSeats(), players: [{ id: 'host', name: hostName }] };
    this.claim('host', hostName, 3); // default seat: Germany, so the host does not start on the same side as most guests
  }
  static async open(name: string): Promise<LobbyHost> {
    const l = new LobbyHost(name); l.room = await openRoom(); l.state.room = l.room.code;
    l.room.onGuest((ch) => l.guestJoined(ch)); return l;
  }

  private guestJoined(ch: Channel) {
    ch.onMessage((raw) => {
      const m = raw as ClientMsg;
      if (m.t === 'hello') {
        if (m.v !== PROTOCOL_VERSION) { ch.send({ t: 'err', message: 'Version mismatch. Reload the page to update.' } satisfies ServerMsg); ch.close(); return; }
        if (this.state.started) { ch.send({ t: 'err', message: 'That game has already started.' } satisfies ServerMsg); ch.close(); return; }
        if (this.state.players.length >= 6) { ch.send({ t: 'err', message: 'The room is full.' } satisfies ServerMsg); ch.close(); return; }
        this.chans.set(ch.id, ch); this.state.players.push({ id: ch.id, name: (m.name || 'Guest').slice(0, 20) });
        const free = this.state.seats.find(s => !s.player); if (free) this.claim(ch.id, m.name, free.faction);
        ch.send({ t: 'welcome', v: PROTOCOL_VERSION, you: ch.id, lobby: this.state } satisfies ServerMsg); this.broadcast();
      } else if (m.t === 'pick') this.claim(ch.id, null, m.faction);
    });
    ch.onClose(() => this.leave(ch.id));
  }

  claim(playerId: string, name: string | null, faction: number) {
    const seat = this.state.seats[faction]; if (!seat || (seat.player && seat.player !== playerId)) return false;
    for (const s of this.state.seats) if (s.player === playerId) { s.player = null; s.name = null; s.ai = true; }
    const p = this.state.players.find(x => x.id === playerId);
    seat.player = playerId; seat.name = name ?? p?.name ?? 'Player'; seat.ai = false; this.broadcast(); return true;
  }
  setDifficulty(d: number) { this.state.difficulty = d; this.broadcast(); }
  setSettings(p: Partial<GameSettings>) { this.state.settings = { ...this.state.settings, ...p }; this.broadcast(); }
  private leave(id: string) {
    this.chans.delete(id); this.state.players = this.state.players.filter(p => p.id !== id);
    for (const s of this.state.seats) if (s.player === id) { s.player = null; s.name = null; s.ai = true; }
    this.broadcast();
  }
  private broadcast() { const m: ServerMsg = { t: 'lobby', lobby: this.state }; for (const c of this.chans.values()) c.send(m); this.onChange?.(this.state); }

  /** Start the game: build the shared simulation here and tell every guest which faction they command. */
  start(): HostSession {
    this.state.started = true; this.broadcast();
    const humans = this.state.seats.filter(s => s.player).map(s => s.faction);
    const mine = this.state.seats.find(s => s.player === 'host')!.faction;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const session = new HostSession(mine, { seed, humans, difficulty: this.state.difficulty, settings: this.state.settings, network: true });
    for (const [id, ch] of this.chans) {
      const seat = this.state.seats.find(s => s.player === id); if (!seat) { ch.close(); continue; }
      ch.send({ t: 'start', seed, humans, difficulty: this.state.difficulty, you: seat.faction, settings: this.state.settings } satisfies ServerMsg);
      session.addPeer(id, seat.faction, ch);
    }
    this.onStarted?.(session);
    return session;
  }
  close() { this.room.close(); for (const c of this.chans.values()) c.close(); }
}

export class LobbyGuest {
  lobby: LobbyState | null = null; you = '';
  onChange?: (l: LobbyState) => void;
  onStarted?: (faction: number, ch: Channel) => void;
  onError?: (m: string) => void;
  onClosed?: () => void;
  private started = false;
  constructor(public readonly ch: Channel, name: string, private closeFn: () => void) {
    ch.onMessage((raw) => {
      const m = raw as ServerMsg;
      if (m.t === 'welcome') { this.you = m.you; this.lobby = m.lobby; this.onChange?.(m.lobby); }
      else if (m.t === 'lobby') { this.lobby = m.lobby; this.onChange?.(m.lobby); }
      else if (m.t === 'start') { this.started = true; this.onStarted?.(m.you, ch); }
      else if (m.t === 'err') this.onError?.(m.message);
    });
    ch.onClose(() => { if (!this.started) this.onClosed?.(); });
    ch.send({ t: 'hello', v: PROTOCOL_VERSION, name } satisfies ClientMsg);
  }
  pick(faction: number) { this.ch.send({ t: 'pick', faction } satisfies ClientMsg); }
  leave() { this.ch.close(); this.closeFn(); }
}
