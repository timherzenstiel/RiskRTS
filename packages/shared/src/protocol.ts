// Wire protocol between a host (authoritative simulation) and guests. Transport-agnostic JSON messages,
// so the same protocol runs over WebRTC today and over a dedicated WebSocket server later.
import type { Command, GameEvent, GameSettings } from './sim/types';
import type { Snapshot } from './sim/snapshot';

export const PROTOCOL_VERSION = 3;

export interface Seat { faction: number; player: string | null; name: string | null; ai: boolean }
export interface LobbyState {
  room: string; hostId: string; difficulty: number; started: boolean;
  /** Rules for the war (attack cap, battle pace). */
  settings: GameSettings;
  /** One entry per faction. A seat is `player: id` when a human has claimed it. */
  seats: Seat[];
  players: { id: string; name: string }[];
}

export type ClientMsg =
  | { t: 'hello'; v: number; name: string }
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
  | { t: 'pong'; at: number };
