// Talking to a dedicated server: the world list and ladder, creating wars, taking or retaking a seat, spectating.
import { PROTOCOL_VERSION, type ClientMsg, type GameSettings, type Rating, type ServerMsg, type WorldInfo } from '@riskrts/shared';
import type { Channel } from './channel';
import { wsChannel } from './ws';

const PID_KEY = 'f14pid', SEATS_KEY = 'f14seats';
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

/** This browser's player id (kept across visits, so a player keeps their seats and ladder entry). */
export function playerId(): string {
  let id = lsGet(PID_KEY);
  if (!id) { id = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join(''); lsSet(PID_KEY, id); }
  return id;
}
type Seats = Record<string, { faction: number; token: string }>;
const seatsKey = (url: string, world: string) => `${url}#${world}`;
/** The seat this browser holds in a world on a server, if any. */
export function mySeat(url: string, world: string) { try { return (JSON.parse(lsGet(SEATS_KEY) ?? '{}') as Seats)[seatsKey(url, world)]; } catch { return undefined; } }
function rememberSeat(url: string, world: string, faction: number, token: string) {
  let s: Seats = {}; try { s = JSON.parse(lsGet(SEATS_KEY) ?? '{}') as Seats; } catch { /* reset */ }
  s[seatsKey(url, world)] = { faction, token }; lsSet(SEATS_KEY, JSON.stringify(s));
}

export class ServerLink {
  worlds: WorldInfo[] = []; ladder: Rating[] = [];
  onList?: () => void;
  onError?: (m: string) => void;
  /** The server started a session for us: a seat (`spectate` false) or spectating. */
  onStart?: (faction: number, ch: Channel, spectate: boolean, ranked: boolean) => void;
  onClosed?: () => void;
  private spectating = false; private ranked = false;

  private constructor(readonly url: string, readonly ch: Channel) {
    ch.onMessage((raw) => {
      const m = raw as ServerMsg;
      if (m.t === 'worlds') { this.worlds = m.worlds; this.ladder = m.ladder; this.onList?.(); }
      else if (m.t === 'joined') { rememberSeat(this.url, m.world, m.faction, m.token); this.spectating = false; this.ranked = m.ranked; }
      else if (m.t === 'spectating') { this.spectating = true; this.ranked = false; }
      else if (m.t === 'start') this.onStart?.(m.you, ch, this.spectating, this.ranked);
      else if (m.t === 'err') this.onError?.(m.message);
    });
    ch.onClose(() => this.onClosed?.());
  }
  static async connect(url: string, name: string): Promise<ServerLink> {
    const ch = await wsChannel(url); const l = new ServerLink(url, ch);
    l.send({ t: 'hello', v: PROTOCOL_VERSION, name }); return l;
  }
  send(m: ClientMsg) { this.ch.send(m); }
  refresh() { this.send({ t: 'list' }); }
  create(name: string, ranked: boolean, settings: GameSettings, difficulty: number) { this.send({ t: 'create', name, ranked, settings, difficulty }); }
  join(world: string, faction: number) { this.send({ t: 'join', world, faction, player: playerId(), token: mySeat(this.url, world)?.token }); }
  spectate(world: string, follow: number) { this.send({ t: 'spectate', world, follow }); }
  close() { this.ch.close(); }
}
