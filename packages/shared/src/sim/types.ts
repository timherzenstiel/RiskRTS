// Game state. Everything here is plain JSON-able data so it can be snapshotted, sent over the wire and unit-tested.
import type { ContKey } from '../data/regions';
import type { AgentType, DefKind, FortKind, Units, UnitType } from '../data/units';
import type { DoctrineKey } from '../data/nations';
import type { TechKey } from '../data/tech';
import type { ShipKind } from '../data/sea';

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
  /** How far this power trusts each other power's word (0..1); broken treaties lower it. */
  trust?: number[];
  /** Its player is away (dedicated server): the computer stands in but keeps the player's stances. */
  away?: boolean;
  /** Armies and corps raised so far (their numbers name the next ones). */
  nArmy?: number; nCorps?: number;
}

export type TreatyKind = 'cease' | 'nap' | 'ally';
export const TREATY_NAMES: Record<TreatyKind, string> = { cease: 'Ceasefire', nap: 'Non-aggression pact', ally: 'Alliance' };
/** A treaty between two powers: a ceasefire runs until a day; a pact or alliance runs until cancelled (it then ends on `ends`). */
export interface Treaty { a: number; b: number; kind: TreatyKind; until?: number; ends?: number }
/** An offer waiting for an answer until game time `exp`. */
export interface Offer { id: number; from: number; to: number; kind: TreatyKind; exp: number }
/** Quick phrases powers can send each other in game. */
export const PHRASES = ['Peace in our time?', 'Stay out of my way.', 'Together against the common enemy!', 'You will regret this.', 'We have no quarrel with you.', 'Good luck, old friend.'] as const;

/** Battle stance of a garrison or an attacking army: balanced, aggressive, defensive, hold at all costs. */
export type Stance = 0 | 1 | 2 | 3;
export const STANCES = ['Balanced', 'Aggressive', 'Defensive', 'Hold at all costs'] as const;
/** Barrage level of one side's guns in a battle: off, light, heavy. */
export type Barrage = 0 | 1 | 2;
export const BARRAGES = ['Hold fire', 'Light', 'Heavy'] as const;

/** Field works on one border sector: trench depth (0..3), sandbag rows (0..2), barbed wire belts (0..2). */
export interface Works { tr: number; sand: number; wire: number }

/** Order of a corps at a front: hold the border, take the enemy's first line, or invade the region beyond. */
export type Order = 0 | 1 | 2;
export const ORDERS = ['Hold', 'Take the first line', 'Invade'] as const;
/**
 * A corps: the troops holding one border of a region. Its formations are part of the region's `units` (the main army in the
 * middle of the region is whatever is not in a corps); men are spread evenly, so a corps fights at the region's strength.
 */
export interface Corps {
  u: Units;
  /** Corps number within its power (names are made from it, see data/names.ts); -1 when the viewer does not know it. */
  n: number;
  /** Standing order and stance. `ready`: game time from which the corps is assembled (jump-off trenches dug, guns registered). */
  ord?: Order; ready?: number; st?: Stance;
  /** Game time the corps has been holding its border since (it digs in over time). */
  since?: number;
  /** Attack now without waiting for assembly. */
  now?: boolean;
  /** Fog-of-war views only: estimated men [low, high]. */
  est?: [number, number];
}

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
  /** Corps per border (keyed by neighbouring region id). The main army is `units` minus every corps. */
  fr?: Record<number, Corps>;
  /** Number of the main army (names, see data/names.ts), and the deploy mode (1 manual; otherwise the region deploys itself). */
  an?: number; deploy?: number;
  /** Shell craters per border sector, left by past battles (visual). */
  cr?: Record<number, number>;
  /** Strikes: the region pays no supply or shells and cannot recruit until the unrest eases. */
  strike?: boolean;
  /** Supply quality: 2 full (rail to a source), 1 thin (land or sea only), 0 cut off. */
  supplyQ?: number;
  /** The factory was bombed: it produces nothing until this day. */
  bombed?: number;
  /** A fake concentration: rivals estimate `men` more here, until `until`, unless their latest report is newer than `day`. */
  fake?: { men: number; day: number; until: number };
  /** A harbour (coastal regions only), and the game time it is finished if it is still being built. */
  port?: boolean; portAt?: number;
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
  /** A decoy: no troops, but rivals watching see `fake` battalions marching. */
  decoy?: boolean; fake?: number;
  /** Ground columns: the post they left (-1 the main army, else a border) and the post they march to; their group's number and kind (0 army, 1 corps). */
  src?: number; post?: number; gn?: number; gk?: number;
  /** Seconds still needed to form up before the column moves (called up from the main army for an offensive). */
  wait?: number;
  /** Order the troops take up at the front they march to, and attacking without waiting for assembly. */
  ord?: Order; now?: boolean;
  /** Regions still to pass after `to` on a march through own land, and the post to end at in the last one. */
  path?: number[]; fin?: number;
  /** Moving between posts of one region (`from` = `to`). */
  inner?: boolean;
  /** Aircraft from (and back to) a carrier. */
  cv?: number;
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
  /** Aircraft: remaining time over the battlefield, home region, and whether it has left; the carrier they fly back to. */
  fuel?: number; home?: number; out?: boolean; cv?: number;
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
  /** Battle time of each faction's last trench raid here. */
  raidT?: Record<number, number>;
  /** Phased offensives: goal 1 take the first line, 2 invade (none = the whole region at once, as for holdout assaults). */
  goal?: number;
  /** Stage: 0 first line, 1 consolidating the captured line, 2 fighting the depth, 3 foothold (first line held, attack stopped). */
  stage?: number;
  /** Battle age the current stage began at; the barrage before going over the top counts from here. */
  stT?: number;
  /** Number of the defending corps of this border, and battle age until which the attackers' guns fire unregistered. */
  cn?: number; unreg?: number;
  /** Attack over a coast: the region the attackers' supply runs back to, and the fleet of an amphibious assault (the second wave is aboard). */
  src?: number; amph?: number;
  /** Reload timers of battleships bombarding this coast (ship id → seconds). */
  bomb?: Record<number, number>;
}

/** A ship: docked in a port, or at sea with a fleet. Battleship squadrons and carriers carry their hit points over from battle to battle. */
export interface Ship {
  id: number; owner: number; kind: ShipKind; hp: number;
  /** The port it was built in (or last docked at); it returns there. */
  home: number;
  /** Region whose port it lies in (-1 at sea), and its fleet at sea (-1 docked). */
  port: number; fleet: number;
  /** Carriers: squadrons aboard. */
  planes?: number;
  /** Still being built: the game time it is launched. */
  ready?: number;
}
export type FleetTask = 'move' | 'assault' | 'station' | 'return';
/** muster: ships gather off the embarkation coast while the troops march down; then embark, sail, and the end of the voyage. */
export type FleetState = 'muster' | 'embark' | 'sail' | 'offshore' | 'beach' | 'unload' | 'land' | 'stationed';
export interface Fleet {
  id: number; owner: number; ships: number[];
  task: FleetTask; state: FleetState;
  /** Troops aboard (in an assault the first wave rides the landing craft), their men and morale. */
  cargo: Units; men: Units; mor: number;
  /** Route: polyline (flat x, z; x runs on past the date line), zones along it ([distance, zone] pairs), length and distance sailed. */
  path: number[]; zs: number[]; len: number; d: number;
  /** Speed of the slowest ship (world units per second, pace and weather included). */
  v: number;
  /** Seconds left in a timed state (muster, embark, offshore, landing, unload). */
  t: number;
  /** Regions it sails from and to, the post the troops take up there, and the zone of the target coast or station. */
  from: number; to: number; toPost?: number; zone: number;
  /** Assaults: goal (1 beachhead, 2 invade), the battle on the beach, the troops' stance. */
  goal?: number; battle?: number; st?: Stance;
  /** Naval battle it is fighting in. */
  sea?: number;
  /** Zones already checked for interception on this voyage. */
  seen?: number[];
  /** Group number and kind of the troops aboard (names). */
  gn?: number; gk?: number;
  /** The assault is held offshore by storms. */
  storm?: boolean;
  /** Just out of a naval battle: not caught again until this game time. */
  calm?: number;
}

/** A ship in a naval battle. Positions in battle units around the battle point; `hd` is the heading (radians, 0 = +z). */
export type ShipAgentKind = 'dn' | 'dd' | 'cv' | 'tr' | 'lc' | 'pl';
export interface ShipAgent {
  id: number; ship: number; f: number; kind: ShipAgentKind;
  x: number; z: number; hd: number; v: number; hp: number; hp0: number;
  /** Turrets still working, torpedoes left, current target (agent index), reload timer, fire timer (seconds burning). */
  tur: number; torps: number; tgt: number; cd: number; fire: number;
  /** Consecutive salvos on the same target (straddling), turret bearing for drawing, game time of the last salvo. */
  str: number; aim: number; fireT: number;
  /** Left the battle area, sunk (and when), breaking off. */
  out: boolean; dead: boolean; dieT: number; brk?: boolean;
  /** Turning away from a torpedo attack until this battle age. */
  evade?: number;
  /** Aircraft: fuel left, the carrier it came from. */
  fuel?: number; cv?: number;
  /** Destroyers: on a torpedo run. */
  run?: boolean;
}
export interface SeaShell { x: number; z: number; t: number; f: number; tgt: number; hit: boolean; dmg: number }
export interface Torpedo { x: number; z: number; hd: number; t: number; f: number }
export interface SeaBattle {
  id: number; zone: number;
  /** Battle point on the map (world units) and the axis the fleets met along. */
  x: number; z: number; ax: number; az: number;
  /** Powers on each side, fleets taking part. */
  sides: number[][]; fleets: number[];
  agents: ShipAgent[]; shells: SeaShell[]; torps: Torpedo[];
  age: number; ended: boolean; removeAt: number;
  /** Battle age at which night falls. */
  night: number;
  /** Hit points each side started with, sides breaking off and when the first did. */
  hp0: number[]; brk: boolean[]; brkT?: number;
  /** Ships sunk per side, by agent kind. */
  sunk: Record<string, number>[];
  /** Winning side (0/1), -1 drawn. */
  winner?: number;
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
  | { k: 'flak'; b: number; x: number; z: number }
  /** Naval battles, in world units: a salvo from (x0, z0) landing at (x1, z1) after `fl` seconds; a hit, fire or explosion; a torpedo. */
  | { k: 'nfire'; s: number; x0: number; z0: number; x1: number; z1: number; fl: number; hit: boolean; big: boolean }
  | { k: 'nboom'; s: number; x: number; z: number; big: number }
  /** Shore bombardment: a battleship broadside from offshore at a land battle. */
  | { k: 'bomb'; b: number; x: number; z: number; tx: number; tz: number; fl: number };

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
  /** Phased offensives: the attacker took the first line (and stops there with `hold`), pushes into the depth, or orders the advance from a foothold; troops mass on a border. */
  | { k: 'firstLine'; faction: number; def: number; region: number; from: number; hold: boolean }
  | { k: 'depth'; faction: number; def: number; region: number }
  | { k: 'advance'; faction: number; region: number }
  | { k: 'massing'; faction: number; region: number; to: number; owner: number }
  | { k: 'raid'; faction: number; region: number; ok: boolean; target: number }
  | { k: 'offer'; id: number; from: number; to: number; kind: TreatyKind }
  | { k: 'treaty'; a: number; b: number; kind: TreatyKind; what: 'signed' | 'declined' | 'ended' | 'broken' | 'notice'; by?: number }
  | { k: 'say'; from: number; to: number; p: number }
  | { k: 'over'; winner: number | null; reason?: string }
  /** The navy: a ship launched, a port finished, a fleet offshore, a convoy lost at sea, ships scuttled in a captured port. */
  | { k: 'shipBuilt'; faction: number; region: number; kind: ShipKind }
  | { k: 'portBuilt'; faction: number; region: number }
  | { k: 'offshore'; faction: number; region: number; zone: number; owner: number; est: number }
  | { k: 'convoyLost'; faction: number; zone: number; ships: number; men: number; by: 'uboat' | 'navy' }
  | { k: 'scuttled'; faction: number; region: number; n: number }
  | { k: 'shipped'; faction: number; from: number; to: number; units: number }
  | { k: 'landing'; faction: number; region: number; zone: number; ok: boolean; owner: number }
  | { k: 'seaBattle'; zone: number; sides: number[][]; winner: number; sunk: Record<string, number>[]; start: boolean; id: number }
  | { k: 'strait'; link: number; open: boolean; region: number };

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
  { name: 'Fast', rof: .65, charge: 110, go: 40, fuel: 30, move: .6, desc: 'Short, bloody battles' },
  { name: 'Normal', rof: 1, charge: 180, go: 75, fuel: 40, move: 1, desc: 'Length follows army size' },
  { name: 'Long', rof: 1.6, charge: 300, go: 120, fuel: 60, move: 1.5, desc: 'Drawn-out sieges, time to reinforce' },
] as const;

/** What a power last learned about a region from reconnaissance. */
export interface Intel {
  day: number; time: number; owner: number; units: Units; men: Units; defs: Defence[]; works: Record<number, Works>;
  factory: boolean; barracks: boolean; airfield: boolean;
  /** Corps seen on the borders. */
  fr?: Record<number, Corps>;
}
/** A spy: travelling until `eta`, then reporting continuously from `region` until found. */
export interface Spy { id: number; f: number; region: number; eta: number; /** Exposed by sabotage until this day: twice as likely to be caught. */ hot?: number }

export interface GameState {
  v: 6; seed: number; rng: number;
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
  /** Treaties in force and offers waiting for an answer. */
  treaties: Treaty[]; offers: Offer[];
  /** The navy: every ship, fleets at sea, naval battles. */
  ships: Ship[]; fleets: Fleet[]; seaBattles: SeaBattle[];
  /** Fog-of-war views only: the faction this view was made for. */
  viewer?: number;
  over: boolean; winner: number | null;
  nextId: number;
  stats: GameStats;
  events: GameEvent[];
  fx: Fx[] | null;
}

export type BuildKind = 'factory' | 'barracks' | 'airfield' | 'port';
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
  /** Quick order: a share of the main army of `from` marches to `to`. Into an enemy region it forms up, moves to the border, assembles and attacks (`goal` 1 first line, 2 invade). */
  | { t: 'march'; from: number; to: number; frac: number; brk?: boolean; goal?: Order; post?: number }
  /** Move a share of a group (`post` -1 the main army, else the corps of that border) to another post of the region, or through own land to a post of region `to`. */
  | { t: 'move'; region: number; post: number; to: number; toPost: number; frac: number }
  /** Standing order of the corps on border `post`: 0 hold, 1 take the first line, 2 invade. `now`: attack without waiting for assembly. */
  | { t: 'order'; region: number; post: number; k: Order; now?: boolean; brk?: boolean }
  /** Deploy mode of a region: 0 the region deploys itself, 1 manual. */
  | { t: 'deploy'; region: number; mode: number }
  /** Fly aircraft from `from` to a region up to AIR_RANGE borders away. */
  | { t: 'air'; from: number; to: number; frac: number; rail?: boolean; factory?: boolean; brk?: boolean }
  /** Bring one unlock forward by six months (one rush per war year). */
  | { t: 'rush'; tech: TechKey }
  /** Adopt one of the doctrines offered for the war year. */
  | { t: 'doctrine'; doc: DoctrineKey }
  /** Deception: march a decoy army (rivals see troops that are not there); a trench raid from a quiet front. */
  | { t: 'decoy'; from: number; to: number }
  | { t: 'raid'; battle: number }
  /** Diplomacy: offer a treaty, answer an offer, cancel a pact or alliance, send a quick phrase (`to` -1 = everyone). */
  | { t: 'offer'; to: number; kind: TreatyKind }
  | { t: 'answer'; id: number; yes: boolean }
  | { t: 'cancel'; to: number }
  | { t: 'say'; to: number; p: number }
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
  | { t: 'mobilise'; level: number }
  /** The navy: build ships in a port; ship a share of a group over the sea to an own post; an amphibious assault on an enemy coast. */
  | { t: 'buildShip'; region: number; kind: ShipKind; n?: number }
  | { t: 'ship'; region: number; post: number; to: number; toPost: number; frac: number }
  | { t: 'landing'; from: number; to: number; zone?: number; frac: number; goal?: Order; brk?: boolean; escort?: boolean }
  /** Battleships and carriers: station the warships docked in a port (or a fleet at sea) in a zone, or send a fleet home. */
  | { t: 'station'; region?: number; fleet?: number; zone: number; kind?: 'bb' | 'carrier'; brk?: boolean }
  | { t: 'dock'; fleet: number }
  | { t: 'breakOff'; sea: number }
  /** Take squadrons of a port region aboard a docked carrier (negative: fly them off). */
  | { t: 'embarkAir'; region: number; ship: number; n: number }
  /** Carrier air mission against a region in reach of its zone. */
  | { t: 'carrierAir'; ship: number; to: number; rail?: boolean; factory?: boolean; brk?: boolean };
