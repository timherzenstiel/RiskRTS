// The navy: sea zones and the straits between them, harbours of 1914, ship types and the fleets each power starts with.
// Pure data; world/zones.ts builds the zones from the tile map and sim/navy.ts runs the ships.
import { dayOf } from './calendar';

/** Sea zones: name and seed points [lon, lat]. Water tiles go to the zone whose seeds reach them first through the water. */
export interface ZoneDef { name: string; short: string; seeds: [number, number][]; /** Winter storms (Nov–Feb): +30% sailing time, no landings. */ storm?: boolean }
export const ZONES: ZoneDef[] = [
  { name: 'North Sea & Channel', short: 'North Sea', seeds: [[3, 55], [-1, 50.3], [5, 58]], storm: true },
  { name: 'Baltic', short: 'Baltic', seeds: [[19, 57], [20, 61.5], [25, 59.8], [14, 55]] },
  { name: 'Arctic Ocean', short: 'Arctic', seeds: [[38, 73], [65, 75], [110, 76], [160, 72], [-140, 71.5], [-100, 74.5], [-65, 73]] },
  { name: 'North Atlantic', short: 'N. Atlantic', seeds: [[-30, 50], [-15, 62], [-55, 57], [5, 67], [-10, 45]], storm: true },
  { name: 'Central Atlantic & Caribbean', short: 'C. Atlantic', seeds: [[-40, 25], [-75, 15], [-90, 25], [-20, 15], [-5, 3]] },
  { name: 'South Atlantic', short: 'S. Atlantic', seeds: [[-20, -25], [5, -15], [-50, -45], [10, -45]] },
  { name: 'Western Mediterranean', short: 'W. Med', seeds: [[5, 40], [-3, 36.5], [10, 38]] },
  { name: 'Eastern Mediterranean', short: 'E. Med', seeds: [[20, 35], [16, 43], [25, 38.5], [30, 33.5]] },
  { name: 'Black Sea', short: 'Black Sea', seeds: [[34, 43.5]] },
  { name: 'Arabian Sea', short: 'Arabian Sea', seeds: [[64, 15], [38, 20], [52, 27], [60, -10], [42, -18], [75, 2]] },
  { name: 'Bay of Bengal', short: 'Bengal', seeds: [[88, 15], [95, -10], [105, -25]] },
  { name: 'South China Sea', short: 'S. China Sea', seeds: [[113, 13], [112, -4], [127, -4]] },
  { name: 'North Pacific', short: 'N. Pacific', seeds: [[160, 40], [-170, 45], [135, 40], [150, 52], [125, 31], [-140, 50]], storm: true },
  { name: 'East Pacific', short: 'E. Pacific', seeds: [[-110, 10], [-85, -20], [-82, -45], [-125, 25], [-140, -30]] },
  { name: 'Tasman & Coral Sea', short: 'Tasman', seeds: [[160, -30], [152, -15], [130, -38], [175, -48]] },
];
export const NUM_ZONES = ZONES.length;

/**
 * Links between zones. `gate` is [lon, lat] on the side of `a` and [lon, lat] on the side of `b`; ships sail between the two.
 * A strait is held by the owner of a land region and closed to every power at war with it. `from`: the day it opens.
 */
export interface LinkDef { a: number; b: number; gate: [number, number, number, number]; strait?: string; name?: string; from?: number }
export const LINKS: LinkDef[] = [
  { a: 0, b: 1, gate: [9, 57.6, 12.5, 55], strait: 'Germany', name: 'Danish straits' },
  { a: 0, b: 3, gate: [-2, 59.5, -6, 60.5] },
  { a: 0, b: 3, gate: [-4.5, 49.8, -7, 49] },
  { a: 3, b: 2, gate: [18, 71, 26, 72.5] },
  { a: 3, b: 2, gate: [-58, 66, -62, 70] },
  { a: 3, b: 4, gate: [-40, 37, -40, 32] },
  { a: 3, b: 4, gate: [-14, 37, -15, 32] },
  { a: 3, b: 6, gate: [-7.5, 36.3, -4.5, 36.2], strait: 'Iberia', name: 'Gibraltar' },
  { a: 4, b: 6, gate: [-8.5, 35.2, -4.5, 36.2], strait: 'Iberia', name: 'Gibraltar' },
  { a: 4, b: 5, gate: [-25, -2, -25, -8] },
  { a: 4, b: 5, gate: [5, -1, 5, -6] },
  { a: 4, b: 13, gate: [-79.5, 9.8, -79.5, 7.5], strait: 'Gran Colombia', name: 'Panama Canal', from: dayOf(1914, 8, 15) },
  { a: 5, b: 9, gate: [24, -38, 34, -37] },
  { a: 5, b: 13, gate: [-62, -55.5, -77, -53] },
  { a: 6, b: 7, gate: [11, 37.6, 13.5, 36.4], strait: 'Italy', name: 'Sicilian Channel' },
  { a: 7, b: 8, gate: [26, 40.1, 29.6, 41.5], strait: 'Anatolia', name: 'Dardanelles' },
  { a: 7, b: 9, gate: [32.3, 31.6, 32.6, 29.4], strait: 'Egypt', name: 'Suez Canal' },
  { a: 9, b: 10, gate: [79, 4, 86, 4] },
  { a: 9, b: 10, gate: [84, -18, 92, -18] },
  { a: 10, b: 11, gate: [98, 5.5, 104.5, 1.8], strait: 'East Indies', name: 'Strait of Malacca' },
  { a: 10, b: 14, gate: [112, -36, 120, -37] },
  { a: 11, b: 14, gate: [141, -9.5, 144, -11] },
  { a: 11, b: 12, gate: [121, 21, 124, 24] },
  { a: 12, b: 2, gate: [-169, 64.5, -169, 67.5] },
  { a: 12, b: 13, gate: [-148, 32, -136, 26] },
  { a: 12, b: 14, gate: [160, 2, 162, -8] },
  { a: 13, b: 14, gate: [-168, -32, 178, -36] },
];

/** Harbours in 1914: these regions start with a port, whoever holds them. */
export const START_PORTS: string[] = [
  'Britain', 'France', 'Germany', 'Petrograd', 'Austria-Hungary', 'Anatolia', 'Eastern States', 'Western States', 'Quebec', 'Brazil', 'Argentina',
  'South Africa', 'Egypt', 'India', 'Japan', 'China', 'East Indies', 'Eastern Australia', 'New Zealand', 'Ukraine', 'Italy', 'Iberia', 'Maghreb',
  'Scandinavia', 'Iceland', 'Madagascar', 'Indochina', 'Gran Colombia',
];
/** Building a port: cost and convoys until it is ready. */
export const PORT = { cost: 5, convoys: 2 } as const;

export type ShipKind = 'trans' | 'land' | 'bb' | 'carrier';
export const SHIP_KINDS: ShipKind[] = ['trans', 'land', 'bb', 'carrier'];
export interface ShipStats {
  name: string; one: string; many: string; short: string;
  cost: number; convoys: number; hp: number;
  /** World units per second at Normal pace. */
  speed: number;
  /** Cargo slots (infantry and MG 1, a battery 2, a tank platoon 3), squadrons for a carrier. */
  cap: number;
  /** Strength in sea control per ship at full hit points. */
  sea: number;
  /** Needs a factory in the port region. */
  factory?: boolean;
  desc: string;
}
export const SHIP: Record<ShipKind, ShipStats> = {
  trans: { name: 'Troop transport', one: 'transport', many: 'transports', short: 'TRN', cost: 4, convoys: 1, hp: 30, speed: .6, cap: 6, sea: 0, desc: 'Two or three requisitioned liners. Carries 6 slots of troops over the sea.' },
  land: { name: 'Landing flotilla', one: 'landing flotilla', many: 'landing flotillas', short: 'LND', cost: 3, convoys: 1, hp: 20, speed: .45, cap: 4, sea: 0, desc: 'Ten landing boats. Puts the first wave ashore in an assault: 4 slots of infantry and MGs (tanks from 1918).' },
  bb: { name: 'Battleship squadron', one: 'battleship squadron', many: 'battleship squadrons', short: 'BB', cost: 12, convoys: 5, hp: 160, speed: .55, cap: 0, sea: 2, factory: true, desc: 'Two dreadnoughts and a destroyer screen. Wins sea control, fights naval battles, bombards coasts.' },
  carrier: { name: 'Aircraft carrier', one: 'carrier', many: 'carriers', short: 'CV', cost: 14, convoys: 4, hp: 120, speed: .6, cap: 3, sea: 0, factory: true, desc: 'A floating airfield for 3 squadrons. Flies air missions from the sea and adds 1 sea control per squadron.' },
};
/** Slots a formation takes aboard. */
export const CARGO_SLOTS = { inf: 1, mg: 1, art: 2, tank: 3, plane: 0 } as const;
/** Carriers: Britain (HMS Furious) first, every other power a year later at a premium. */
export const CARRIER_FROM = { gb: dayOf(1917, 7), others: dayOf(1918, 7), premium: 1.3 } as const;
/** Landing craft: armoured X-lighters from April 1915 (half damage from coast guns); tanks in the first wave from 1918. */
export const XLIGHTER_FROM = dayOf(1915, 4), LAND_TANKS_FROM = dayOf(1918, 1);
/** Seconds to embark or disembark at a port, and anchored off a coast without one. */
export const EMBARK = { port: 15, anchor: 40 } as const;
/** Seconds an assault fleet assembles offshore (visible to the defender), and the second wave takes to unload. */
export const OFFSHORE = 30, UNLOAD = 20;
/** Port repairs per convoy (more with a factory). */
export const REPAIR = { base: 10, factory: 20 } as const;
/** Interception: loss per zone crossed is min(max, per × (enemy strength − escort)). */
export const INTERCEPT = { per: .08, max: .4 } as const;

/** Fleets in August 1914: transports, landing flotillas and battleship squadrons, and where they lie (region names, fallback the capital). */
export interface StartFleet { trans: number; land: number; bb: number; at?: { region: string; trans?: number; land?: number; bb?: number }[] }
export const START_FLEETS: StartFleet[] = [
  { trans: 8, land: 3, bb: 5, at: [{ region: 'Egypt', bb: 1 }, { region: 'India', trans: 2 }] },
  { trans: 4, land: 2, bb: 2 },
  { trans: 3, land: 1, bb: 2, at: [{ region: 'Ukraine', bb: 1, trans: 1 }] },
  { trans: 3, land: 1, bb: 3 },
  { trans: 1, land: 0, bb: 1 },
  { trans: 2, land: 1, bb: 1 },
  { trans: 5, land: 2, bb: 3, at: [{ region: 'Western States', bb: 1, trans: 2 }] },
];

/** Naval battles: ship agents per type. Ranges and speeds in battle units (1 battle unit = 0.25 world units). */
export const NAVAL = {
  /** World units per battle unit. */
  scale: .25,
  /** Half extent of the battle area. */
  halfW: 26, halfH: 18,
  dn: { speed: .32, turrets: 5, dmg: 4, reload: 6, range: 14, hpShare: .44, spacing: 2.6 },
  dd: { speed: .6, dmg: 1.5, reload: 2.5, range: 5, torps: 2, torpDmg: 25, torpRange: 4.5, hpShare: .12 },
  cv: { speed: .3, dmg: 1.5, reload: 3, range: 5 },
  tr: { speed: .26 }, lc: { speed: .2 },
  plane: { speed: 2.2, fuel: 55, dmg: 3, reload: 4, range: 2.2 },
  /** Battle length, the window in which night falls, break-off share of the starting hit points. */
  maxAge: 180, nightFrom: 95, nightTo: 150, breakOff: .5, afterBreak: 35,
  acc: { near: .6, far: .25, straddle: .05, maxStraddle: .2 },
  fire: { chance: .15, dps: 1, time: 8 }, turretHit: .1, magazine: .02,
} as const;
