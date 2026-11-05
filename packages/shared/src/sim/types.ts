// Game state. Everything here is plain JSON-able data so it can be snapshotted, sent over the wire and unit-tested.
import type { ContKey } from '../data/regions';
import type { AgentType, DefKind, FortKind, Units, UnitType } from '../data/units';
import type { DoctrineKey } from '../data/nations';
import type { TechKey } from '../data/tech';

export type Mission =
  | { type: 'conts' | 'conts1'; conts: ContKey[] }
  | { type: 'count'; n: number; converted?: boolean }
  | { type: 'count2'; n: number }
  | { type: 'destroy'; target: number; n0?: number };

export interface FactionState {
  id: number; supply: number; alive: boolean; mission: Mission | null; aiT: number; ai: boolean;
  /** War weariness 0..100: grows with casualties, cuts income and morale, fades in quiet times. */
  ww: number;
  /** Wounded men who return to under-strength formations with the next convoys. */
  wounded: number;
  /** Artillery shells in the national stockpile. */
  shells: number;
  /** Manpower pool: men available for new formations. */
  men: number;
  /** Mobilisation level 0..2 (faster manpower growth, more war weariness). */
  mob: number;
  /** Convoys in a row spent above the unrest threshold. */
  unrestT: number;
  /** Doctrines adopted, one per war year. */
  doctrines?: DoctrineKey[];
  /** Unlocks brought forward by a rush, and the war year of the last rush. */
  rushed?: TechKey[]; rushY?: number;
  /** A doctrine choice waiting: the war year offered and the game time by which the War Office picks instead. */
  docOffer?: number; docDue?: number;
}

/** Battle stance of a garrison or an attacking army: balanced, aggressive, defensive, hold at all costs. */
export type Stance = 0 | 1 | 2 | 3;
export const STANCES = ['Balanced', 'Aggressive', 'Defensive', 'Hold at all costs'] as const;
/** Barrage level of one side's guns in a battle: off, light, heavy. */
export type Barrage = 0 | 1 | 2;
export const BARRAGES = ['Hold fire', 'Light', 'Heavy'] as const;

/** Field works on one border sector: trench depth (0..3), sandbag rows (0..2), barbed wire belts (0..2). */
export interface Works { tr: number; sand: number; wire: number }

/** A fixed defence. `s` is the border sector it covers (a neighbouring region id) or -1 for the interior. */
export interface Defence { id: number; k: DefKind; s: number; hp: number; f: number }

export interface RegionState {
  id: number; owner: number; units: Units;
  /** Men actually present per unit type (full strength = units × FORMATION.men). */
  men: Units;
  factory: boolean; barracks: boolean; airfield: boolean;
  defs: Defence[];
  /** Field works per border sector, keyed by neighbouring region id. Missing = none. */
  works: Record<number, Works>;
  /** Morale of the garrison, 0..100. */
  mor: number;
  /** Power that held this region when the war began (its home territory is always a source of supply for it), or -1. */
  home: number;
  /** No supply line back to the capital, a factory or home territory: no income, no recruiting, the garrison wears down. */
  cut: boolean;
  /** Fog-of-war views only: 3 full, 2 scouted (stale report), 1 observed from across the border, 0 unknown. */
  vis?: number;
  /** Fog-of-war views only: day of the report shown (vis 2), and the estimated men [low, high] (vis 1 or 2). */
  seen?: number; est?: [number, number];
  /** Fog-of-war views only: a spy of the viewer works here. */
  spied?: boolean;
  /** Faction whose defences still hold out here after the region fell, or -1. A contested region pays no income and cannot recruit or build. */
  contested: number;
  /** Faction whose capital this is, or -1. */
  capitalOf: number;
  /** Id of the battle fought here, or -1. */
  battle: number;
  /** Stance of the garrison (armies marching out take it with them). */
  stance: Stance;
  /** Fatigue bookkeeping: when marching troops last arrived, after how many borders in a row, and when a battle here last ended. */
  arrT?: number; legs?: number; foughtT?: number;
  /** Shell craters per border sector, left by past battles (visual). */
  cr?: Record<number, number>;
  /** Strikes: the region pays no supply or shells and cannot recruit until the unrest eases. */
  strike?: boolean;
  /** Supply quality: 2 full (rail to a source), 1 thin (land or sea only), 0 cut off. */
  supplyQ?: number;
  /** The factory was bombed: it produces nothing until this day. */
  bombed?: number;
}

export interface Army {
  id: number; owner: number; units: Units; men: Units; mor: number; from: number; to: number;
  /** Reconnaissance: a cavalry patrol (returns with a report on one border) or a reconnaissance flight. */
  scout?: 'patrol' | 'recon';
  /** Progress 0..1. */
  t: number; dur: number; sea: boolean;
  /** Aircraft flight (straight line, no sea lane needed). `ret` = returning home after a sortie. */
  air?: boolean; ret?: boolean;
  /** Start position and travel vector in world units (wrapping the date line). */
  ax: number; az: number; dx: number; dz: number;
  /** Stance the troops fight with. */
  stance?: Stance;
  /** Reinforcements: the battle (front) to join on arrival, if it still burns. */
  front?: number;
  /** Fatigue: borders marched in a row, and whether the troops come straight out of a battle. */
  legs?: number; tired?: boolean;
  /** Travelling by rail. */
  rail?: boolean;
  /** Aircraft on a strike against the rail links or the factory of the target region. */
  strike?: 'rail' | 'factory';
}

export interface Agent {
  f: number; type: AgentType; x: number; z: number; hp: number;
  cd: number; rt: number; tgt: number; dead: boolean; dieT: number; fireT: number;
  face: number; phase: number; moving: boolean; trench: boolean;
  /** Men in this formation at full health (hp tracks the share still fighting). */
  men?: number;
  /** Guns: the current target is an enemy gun (counter-battery fire reaches further). */
  cb?: boolean;
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
  /** Field works of the defended border: trench depth, sandbag rows, barbed wire hit points (and at start). */
  tr: number; sand: number; wire: number; wire0: number;
  /** Morale per faction (0..100) and men lost per faction. */
  mor: Record<number, number>; lost: Record<number, number>;
  /** Battle age when fresh troops last arrived; long quiet spells settle into trench warfare. */
  lastJoin: number;
  /** Morale bookkeeping: losses already counted per faction, and factions whose men have started to surrender. */
  seen?: Record<number, number>; broke?: Record<number, number>;
  /** Per-side [faction, alive, total] when agents are not streamed (network mirrors only). */
  counts?: [number, number, number][];
  /** Battle levers per faction: barrage level, stance. `go`: the attackers have gone over the top. */
  bar: Record<number, Barrage>; st: Record<number, Stance>; go: boolean;
  /** Suppression per faction 0..100: how pinned down that side is by the shells landing on it. */
  supp: Record<number, number>;
  /** Shells per faction: a local dump for a side cut off from its stockpile, and shells spent here. */
  ammo: Record<number, number>; used: Record<number, number>;
  /** After-action bookkeeping: men lost per unit type, morale at the start, closest the attackers got (along the axis), craters. */
  lostT: Record<number, Units>; mor0: Record<number, number>; reach: number; craters: number;
  /** Second line already used (elastic defence) per faction. */
  fell?: Record<number, number>;
}

/** After-action report of a finished battle. */
export interface Report {
  id: number; region: number; from: number; day: number; dur: number;
  attacker: number; def: number; winner: number | null;
  /** How far the attackers got: 0 never left the start line, 1 no-man's-land, 2 the wire, 3 the enemy trench. */
  reach: number;
  sides: { f: number; lost: Units; shells: number; mor0: number; mor1: number }[];
}

/** Visual-only effects. Collected only when GameState.fx is an array; never affects the outcome. */
export type Fx =
  | { k: 'shot'; b: number; x0: number; z0: number; x1: number; z1: number; type: AgentType; hit: boolean; air?: boolean }
  /** A gun firing a shell that lands at (tx, tz) after `fl` simulated seconds (used for the incoming whistle). */
  | { k: 'fire'; b: number; x: number; z: number; face: number; tx?: number; tz?: number; fl?: number }
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
  | { k: 'intel'; faction: number; region: number; by: 'patrol' | 'recon' | 'spy' }
  | { k: 'scoutLost'; faction: number; region: number; by: 'patrol' | 'recon' | 'spy' }
  | { k: 'spyFound'; faction: number; region: number; owner: number }
  | { k: 'cut'; faction: number; region: number }
  | { k: 'surrender'; faction: number; region: number; n: number }
  | { k: 'breakthrough'; faction: number; region: number; from: number }
  | { k: 'report'; id: number; region: number; sides: number[] }
  | { k: 'overTop'; faction: number; region: number }
  | { k: 'withdraw'; faction: number; region: number; to: number }
  | { k: 'strike'; faction: number; region: number; end?: boolean }
  | { k: 'rising'; faction: number; region: number; to: number }
  | { k: 'railCut'; faction: number; region: number; by: 'air' | 'spy'; owner: number }
  | { k: 'railBuilt'; faction: number; a: number; b: number }
  | { k: 'tech'; faction: number; tech: TechKey }
  | { k: 'docOffer'; faction: number; year: number }
  | { k: 'doctrine'; faction: number; doc: DoctrineKey }
  | { k: 'bombed'; faction: number; region: number; owner: number }
  | { k: 'fallback'; faction: number; region: number }
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
  { name: 'Fast', rof: .65, charge: 110, go: 40, fuel: 30, desc: 'Short, bloody battles' },
  { name: 'Normal', rof: 1, charge: 180, go: 75, fuel: 40, desc: 'Length follows army size' },
  { name: 'Long', rof: 1.6, charge: 300, go: 120, fuel: 60, desc: 'Drawn-out sieges, time to reinforce' },
] as const;

/** What a power last learned about a region from reconnaissance. */
export interface Intel {
  day: number; time: number; owner: number; units: Units; men: Units; defs: Defence[]; works: Record<number, Works>;
  factory: boolean; barracks: boolean; airfield: boolean;
}
/** A spy: travelling until `eta`, then reporting continuously from `region` until found. */
export interface Spy { id: number; f: number; region: number; eta: number; /** Exposed by sabotage until this day: twice as likely to be caught. */ hot?: number }

export interface GameState {
  v: 4; seed: number; rng: number;
  time: number; day: number; supplyT: number; diff: number;
  cfg: GameSettings;
  regions: RegionState[]; factions: FactionState[];
  armies: Army[]; battles: Battle[];
  /** intel[faction][region]: the last reconnaissance report, or null. */
  intel: (Intel | null)[][];
  spies: Spy[];
  /** After-action reports of the last battles (each power sees those it fought in). */
  reports: Report[];
  /** Rail links cut until a day ("a|b" with a < b), and links under construction [a, b, ready day]. */
  railCut: Record<string, number>; railNew: [number, number, number][];
  /** Fog-of-war views only: the faction this view was made for. */
  viewer?: number;
  over: boolean; winner: number | null;
  nextId: number;
  stats: GameStats;
  events: GameEvent[];
  fx: Fx[] | null;
}

export type BuildKind = 'factory' | 'barracks' | 'airfield';
export type Command =
  | { t: 'recruit'; region: number; unit: UnitType; n?: number }
  | { t: 'build'; region: number; kind: BuildKind }
  /** Lay a railway from one of your regions to a neighbouring one of yours. */
  | { t: 'rail'; region: number; to: number }
  /** A working spy cuts a rail link of the region it works in. */
  | { t: 'sabotage'; region: number; to: number }
  /** Place a defence or field work on a border sector (neighbour id) or a defence in the interior (-1). */
  | { t: 'fortify'; region: number; kind: FortKind; sector: number }
  /** Reconnaissance: a cavalry patrol over one border, a reconnaissance flight up to AIR_RANGE borders, a spy from the capital to anywhere. */
  | { t: 'patrol'; from: number; to: number }
  | { t: 'recon'; from: number; to: number }
  | { t: 'spy'; to: number }
  /** Move part of the defenders of a region from its other fronts to the front in battle `battle`. */
  | { t: 'shift'; region: number; battle: number }
  | { t: 'march'; from: number; to: number; frac: number }
  /** Fly aircraft from `from` to a region up to AIR_RANGE borders away. */
  | { t: 'air'; from: number; to: number; frac: number; rail?: boolean; factory?: boolean }
  /** Bring one unlock forward by six months (one rush per war year). */
  | { t: 'rush'; tech: TechKey }
  /** Adopt one of the doctrines offered for the war year. */
  | { t: 'doctrine'; doc: DoctrineKey }
  /** Storm the holdout defences in one of your own contested regions with its garrison. */
  | { t: 'assault'; region: number }
  /** Battle levers: barrage level of your guns, send the attackers over the top, stance, reinforce a front, withdraw. */
  | { t: 'barrage'; battle: number; level: Barrage }
  | { t: 'charge'; battle: number }
  | { t: 'stance'; region: number; s: Stance; battle?: number }
  | { t: 'reinforce'; from: number; battle: number; frac: number }
  | { t: 'withdraw'; battle: number }
  /** Turn supply into shells (1 supply buys SHELLS_PER_SUPPLY shells). */
  | { t: 'produce'; kind: 'shells'; n: number }
  /** Mobilisation level 0..2: each level +50% manpower growth and +0.5 war weariness per convoy. */
  | { t: 'mobilise'; level: number };
