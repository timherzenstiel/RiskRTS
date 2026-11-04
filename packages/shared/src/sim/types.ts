// Game state. Everything here is plain JSON-able data so it can be snapshotted, sent over the wire and unit-tested.
import type { ContKey } from '../data/regions';
import type { AgentType, DefKind, Units, UnitType } from '../data/units';

export type Mission =
  | { type: 'conts' | 'conts1'; conts: ContKey[] }
  | { type: 'count'; n: number; converted?: boolean }
  | { type: 'count2'; n: number }
  | { type: 'destroy'; target: number; n0?: number };

export interface FactionState { id: number; supply: number; alive: boolean; mission: Mission | null; aiT: number; ai: boolean }

/** A fixed defence. `s` is the border sector it covers (a neighbouring region id) or -1 for the interior. */
export interface Defence { id: number; k: DefKind; s: number; hp: number; f: number }

export interface RegionState {
  id: number; owner: number; units: Units; trench: number; factory: boolean; barracks: boolean; airfield: boolean;
  defs: Defence[];
  /** Faction whose defences still hold out here after the region fell, or -1. A contested region pays no income and cannot recruit or build. */
  contested: number;
  /** Faction whose capital this is, or -1. */
  capitalOf: number;
  /** Id of the battle fought here, or -1. */
  battle: number;
}

export interface Army {
  id: number; owner: number; units: Units; from: number; to: number;
  /** Progress 0..1. */
  t: number; dur: number; sea: boolean;
  /** Aircraft flight (straight line, no sea lane needed). `ret` = returning home after a sortie. */
  air?: boolean; ret?: boolean;
  /** Start position and travel vector in world units (wrapping the date line). */
  ax: number; az: number; dx: number; dz: number;
}

export interface Agent {
  f: number; type: AgentType; x: number; z: number; hp: number;
  cd: number; rt: number; tgt: number; dead: boolean; dieT: number; fireT: number;
  face: number; phase: number; moving: boolean; trench: boolean;
  /** Defence agents: the Defence they came from (they return to the region when the battle ends). */
  defId?: number; sector?: number;
  /** Aircraft: remaining time over the battlefield, home region, and whether it has left. */
  fuel?: number; home?: number; out?: boolean;
}
export interface Shell { x: number; z: number; time: number; f: number; dmg: number; sp: number; src: AgentType }

export interface Battle {
  id: number; region: number;
  /** Unit vector pointing from the region towards the side the attackers come from. */
  ax: number; az: number;
  agents: Agent[]; shells: Shell[];
  age: number; ended: boolean; removeAt: number; endCheck: number;
  sides: number[]; attacker: number;
  /** Defending faction (the region owner, or the holdouts when an owner storms its own contested region). */
  def: number;
  /** Border sector the attack comes through (neighbouring region id), or -1. */
  from: number;
  /** Per-side [faction, alive, total] when agents are not streamed (network mirrors only). */
  counts?: [number, number, number][];
}

/** Visual-only effects. Collected only when GameState.fx is an array; never affects the outcome. */
export type Fx =
  | { k: 'shot'; b: number; x0: number; z0: number; x1: number; z1: number; type: AgentType; hit: boolean; air?: boolean }
  | { k: 'fire'; b: number; x: number; z: number; face: number }
  | { k: 'boom'; b: number; x: number; z: number; s: number }
  | { k: 'flak'; b: number; x: number; z: number };

export type GameEvent =
  | { k: 'start' }
  | { k: 'supply' }
  | { k: 'march'; faction: number; from: number; to: number; units: number }
  | { k: 'air'; faction: number; from: number; to: number; units: number }
  | { k: 'battleStart'; region: number; attacker: number; defender: number }
  | { k: 'battleEnd'; region: number; winner: number | null; prev: number; sides: number[]; capital: boolean; holdouts: number }
  | { k: 'cleared'; region: number; faction: number }
  | { k: 'eliminated'; faction: number }
  | { k: 'newOrders'; faction: number }
  | { k: 'over'; winner: number | null; reason?: string };

export interface GameStats { won: number[]; lost: number[] }

/** Per-game rules chosen in the lobby. */
export interface GameSettings {
  /** Simultaneous attacks each power may run (0 = unlimited). Reinforcing your own regions never counts. */
  attackCap: number;
  /** Battle pace: 0 fast, 1 normal, 2 long. */
  pace: number;
}
export const DEFAULT_SETTINGS: GameSettings = { attackCap: 3, pace: 1 };
export const ATTACK_CAPS = [1, 2, 3, 5, 0] as const;
export const PACES = [
  { name: 'Fast', rof: .65, charge: 110, fuel: 30, desc: 'Short, bloody battles' },
  { name: 'Normal', rof: 1, charge: 180, fuel: 40, desc: 'Length follows army size' },
  { name: 'Long', rof: 1.6, charge: 300, fuel: 60, desc: 'Drawn-out sieges, time to reinforce' },
] as const;

export interface GameState {
  v: 2; seed: number; rng: number;
  time: number; day: number; supplyT: number; diff: number;
  cfg: GameSettings;
  regions: RegionState[]; factions: FactionState[];
  armies: Army[]; battles: Battle[];
  over: boolean; winner: number | null;
  nextId: number;
  stats: GameStats;
  events: GameEvent[];
  fx: Fx[] | null;
}

export type BuildKind = 'trench' | 'factory' | 'barracks' | 'airfield';
export type Command =
  | { t: 'recruit'; region: number; unit: UnitType; n?: number }
  | { t: 'build'; region: number; kind: BuildKind }
  /** Place a defence on a border sector (neighbour id) or the interior (-1). */
  | { t: 'fortify'; region: number; kind: DefKind; sector: number }
  | { t: 'march'; from: number; to: number; frac: number }
  /** Fly aircraft from `from` to a region up to AIR_RANGE borders away. */
  | { t: 'air'; from: number; to: number; frac: number }
  /** Storm the holdout defences in one of your own contested regions with its garrison. */
  | { t: 'assault'; region: number };
