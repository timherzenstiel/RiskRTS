// Game state. Everything here is plain JSON-able data so it can be snapshotted, sent over the wire and unit-tested.
import type { ContKey } from '../data/regions';
import type { Units, UnitType } from '../data/units';

export type Mission =
  | { type: 'conts' | 'conts1'; conts: ContKey[] }
  | { type: 'count'; n: number; converted?: boolean }
  | { type: 'count2'; n: number }
  | { type: 'destroy'; target: number; n0?: number };

export interface FactionState { id: number; supply: number; alive: boolean; mission: Mission | null; aiT: number; ai: boolean }

export interface RegionState {
  id: number; owner: number; units: Units; trench: number; factory: boolean; barracks: boolean;
  /** Faction whose capital this is, or -1. */
  capitalOf: number;
  /** Id of the battle fought here, or -1. */
  battle: number;
}

export interface Army {
  id: number; owner: number; units: Units; from: number; to: number;
  /** Progress 0..1. */
  t: number; dur: number; sea: boolean;
  /** Start position and travel vector in world units (wrapping the date line). */
  ax: number; az: number; dx: number; dz: number;
}

export interface Agent {
  f: number; type: UnitType; x: number; z: number; hp: number;
  cd: number; rt: number; tgt: number; dead: boolean; dieT: number; fireT: number;
  face: number; phase: number; moving: boolean; trench: boolean;
}
export interface Shell { x: number; z: number; time: number; f: number; dmg: number }

export interface Battle {
  id: number; region: number;
  /** Unit vector pointing from the region towards the side the attackers come from. */
  ax: number; az: number;
  agents: Agent[]; shells: Shell[];
  age: number; ended: boolean; removeAt: number; endCheck: number;
  sides: number[]; attacker: number;
  /** Per-side [faction, alive, total] when agents are not streamed (network mirrors only). */
  counts?: [number, number, number][];
}

/** Visual-only effects. Collected only when GameState.fx is an array; never affects the outcome. */
export type Fx =
  | { k: 'shot'; b: number; x0: number; z0: number; x1: number; z1: number; type: UnitType; hit: boolean }
  | { k: 'fire'; b: number; x: number; z: number; face: number }
  | { k: 'boom'; b: number; x: number; z: number; s: number };

export type GameEvent =
  | { k: 'start' }
  | { k: 'supply' }
  | { k: 'march'; faction: number; from: number; to: number; units: number }
  | { k: 'battleStart'; region: number; attacker: number; defender: number }
  | { k: 'battleEnd'; region: number; winner: number | null; prev: number; sides: number[]; capital: boolean }
  | { k: 'eliminated'; faction: number }
  | { k: 'newOrders'; faction: number }
  | { k: 'over'; winner: number | null; reason?: string };

export interface GameStats { won: number[]; lost: number[] }

export interface GameState {
  v: 1; seed: number; rng: number;
  time: number; day: number; supplyT: number; diff: number;
  regions: RegionState[]; factions: FactionState[];
  armies: Army[]; battles: Battle[];
  over: boolean; winner: number | null;
  nextId: number;
  stats: GameStats;
  events: GameEvent[];
  fx: Fx[] | null;
}

export type Command =
  | { t: 'recruit'; region: number; unit: UnitType; n?: number }
  | { t: 'build'; region: number; kind: 'trench' | 'factory' | 'barracks' }
  | { t: 'march'; from: number; to: number; frac: number };
