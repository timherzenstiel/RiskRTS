// Wire protocol between a host (authoritative simulation) and guests. Transport-agnostic JSON messages,
// so the same protocol runs over WebRTC today and over a dedicated WebSocket server later.
import type { Command, GameEvent, GameSettings } from './sim/types';
import type { Snapshot } from './sim/snapshot';

export const PROTOCOL_VERSION = 5;

export interface Seat { faction: number; player: string | null; name: string | null; ai: boolean }
export interface LobbyState {
  room: string; hostId: string; difficulty: number; started: boolean;
  /** Rules for the war (attack cap, battle pace). */
  settings: GameSettings;
  /** One entry per faction. A seat is `player: id` when a human has claimed it. */
  seats: Seat[];
  players: { id: string; name: string }[];
}

/** A world on a dedicated server, as listed to players. */
export interface WorldInfo {
  id: string; name: string; ranked: boolean; day: number; over: boolean; winner: number | null; difficulty: number; settings: GameSettings;
  /** One entry per power: the commanding player's name (null = computer) and whether they are connected. */
  seats: { faction: number; name: string | null; online: boolean }[];
  spectators: number;
}
export interface Rating { player: string; name: string; elo: number; games: number }

export type ClientMsg =
  | { t: 'hello'; v: number; name: string }
  /** Dedicated server: list the worlds, create one, take (or retake, with the token) a seat, watch one, leave. */
  | { t: 'list' }
  | { t: 'create'; name: string; ranked: boolean; settings: GameSettings; difficulty: number }
  | { t: 'join'; world: string; faction: number; player: string; token?: string }
  | { t: 'spectate'; world: string; follow: number }
  | { t: 'leave' }
  | { t: 'pick'; faction: number }
  | { t: 'cmd'; cmd: Command }
  | { t: 'watch'; battles: number[] }
  | { t: 'ping'; at: number };

export type ServerMsg =
  | { t: 'welcome'; v: number; you: string; lobby: LobbyState }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'start'; seed: number; humans: number[]; difficulty: number; you: number; settings: GameSettings }
  | { t: 'snap'; snap: Snapshot; events: GameEvent[]; speed: number }
  | { t: 'err'; message: string }
  /** Dedicated server: the world list (and the ranked ladder), a seat taken (keep the token to come back), spectating. */
  | { t: 'worlds'; worlds: WorldInfo[]; ladder: Rating[] }
  | { t: 'joined'; world: string; faction: number; token: string; ranked: boolean }
  | { t: 'spectating'; world: string; follow: number; delay: number }
  | { t: 'pong'; at: number };
