// National character: every power fields the same five unit types, but one of them is a national variant with its own name and
// stats, and every power has two strengths, two weaknesses and an AI personality. Balance values are starting points.
import { dayOf } from './calendar';
import type { UnitType } from './units';

export interface StatMult { hp?: number; dmg?: number; rof?: number; speed?: number }
export interface Trait { name: string; desc: string }
/** Doctrines a power can adopt (one per war year, from 1915). */
export type DoctrineKey =
  | 'artillery' | 'depth' | 'mass'
  | 'creeping' | 'elastic' | 'blockade'
  | 'infiltration' | 'tankcorps' | 'air'
  | 'combined' | 'total' | 'peace';

export interface Nation {
  /** The national variant: which unit type, its name, short label and description; `from` = the day it takes the field (else from the start). */
  unit: UnitType; unitName: string; unitShort: string; unitDesc: string; from?: number;
  /** Stat multipliers of the national variant (rof multiplies the reload time: below 1 fires faster). */
  mult: StatMult;
  strengths: [Trait, Trait]; weaknesses: [Trait, Trait];
  /** Day the power can field tanks, and their cost multiplier. */
  tankFrom: number; tankCost: number;
  /** Manpower: starting pool multiplier, growth multiplier, and a growth multiplier that applies until a day. */
  pool: number; growth: number; growthUntil?: [number, number];
  /** Shell production multiplier (and one until a day), shells per factory, extra factory cost. */
  shells: number; shellsUntil?: [number, number]; factoryShells: number; factoryCost: number;
  /** Morale ceiling offset, war weariness at which unrest begins, war weariness from losses multiplier. */
  morale: number; unrest: number; wwLoss: number;
  /** Morale loss multiplier when holding at all costs. */
  hold: number;
  /** Infantry battalions in the capital at the start. */
  startInf: number;
  /** Rule flags used by rails, weather, terrain and the economy. */
  flags: {
    navy?: boolean; empire?: boolean; fortress?: boolean; siberian?: boolean; interior?: boolean; krupp?: boolean; blockaded?: boolean;
    skoda?: boolean; canon?: boolean; mountain?: boolean; gallipoli?: boolean; desert?: boolean; storm?: boolean; fortInf?: boolean; poorRails?: boolean;
  };
  /** AI personality: doctrine preferences (best first) and behaviour weights (1 = neutral). */
  ai: {
    doctrines: DoctrineKey[];
    /** Margin an attack needs (below 1 attacks on thinner odds). */ aggr: number;
    /** Digging in. */ dig: number;
    /** Share of guns among new units. */ guns: number;
    /** Share of infantry among new units. */ mass: number;
    /** Preference for targets across sea lanes and on coasts. */ navy: number;
    /** Chance an offensive only takes the enemy's first line (and digs in there) instead of invading. */ line: number;
    /** Chance an assembling attack goes in early, without waiting for the guns to register. */ rush: number;
    /** Suppression wanted before going over the top. */ patience: number;
    /** Willingness to call off a failing attack. */ retreat: number;
  };
}

export const NATIONS: Nation[] = [
  { // British Empire
    unit: 'tank', unitName: 'Mark IV tank platoon', unitShort: 'MK IV', unitDesc: 'The first tanks of the war · +20% armour',
    mult: { hp: 1.2 },
    strengths: [
      { name: 'Royal Navy', desc: 'Own sea lanes are always fully supplied; enemy sea lanes next to British regions lose a supply step.' },
      { name: 'Empire', desc: '+1 supply per convoy for every region held outside Europe.' },
    ],
    weaknesses: [
      { name: 'Volunteer army', desc: 'Manpower grows at half the rate until conscription in January 1916.' },
      { name: 'Small army', desc: 'Starts the war with fewer battalions in the capital.' },
    ],
    tankFrom: dayOf(1916, 9), tankCost: 1,
    pool: 1, growth: 1, growthUntil: [dayOf(1916, 1), .5],
    shells: 1, factoryShells: 3, factoryCost: 0,
    morale: 0, unrest: 80, wwLoss: 1, hold: 1.5, startInf: 5,
    flags: { navy: true, empire: true },
    ai: { doctrines: ['blockade', 'tankcorps', 'depth', 'total', 'creeping', 'air'], aggr: 1, dig: 1, guns: 1, mass: 1, navy: 2.5, line: 0.15, rush: 0.1, patience: 1, retreat: 1 },
  },
  { // French Republic
    unit: 'art', unitName: 'Canon de 75 battery', unitShort: '75', unitDesc: 'Quick-firing field guns · +35% rate of fire, −20% against deep trenches and bunkers',
    mult: { rof: 1 / 1.35 },
    strengths: [
      { name: 'Fortress belt', desc: 'Bunkers and gun emplacements cost 25% less in home regions.' },
      { name: 'Ils ne passeront pas', desc: 'Holding at all costs only adds 25% morale loss instead of 50%.' },
    ],
    weaknesses: [
      { name: 'Low birth rate', desc: 'Manpower grows 30% slower.' },
      { name: 'Bled white', desc: 'Losses raise war weariness 20% faster.' },
    ],
    tankFrom: dayOf(1917, 4), tankCost: 1,
    pool: 1, growth: .7,
    shells: 1, factoryShells: 3, factoryCost: 0,
    morale: 0, unrest: 80, wwLoss: 1.2, hold: 1.25, startInf: 6,
    flags: { fortress: true, canon: true },
    ai: { doctrines: ['artillery', 'creeping', 'air', 'combined', 'depth', 'peace'], aggr: 1.05, dig: 1.4, guns: 1.4, mass: .9, navy: 1, line: 0.5, rush: 0.05, patience: 1.1, retreat: 1 },
  },
  { // Russian Empire
    unit: 'inf', unitName: 'Siberian rifle battalion', unitShort: 'SIB', unitDesc: 'Hardened riflemen · ignore winter and fight 20% harder in it',
    mult: {},
    strengths: [
      { name: 'Vast reserves', desc: 'The manpower pool is 60% larger.' },
      { name: 'Russian winter', desc: 'Winter penalties for Russian troops are halved.' },
    ],
    weaknesses: [
      { name: 'Shell crisis', desc: 'Shell production is 40% lower until 1916. Morale ceiling −10.' },
      { name: 'Fragile empire', desc: 'Unrest starts at 70 war weariness. No own tanks until 1918.' },
    ],
    tankFrom: dayOf(1918, 1), tankCost: 1,
    pool: 1.6, growth: 1,
    shells: 1, shellsUntil: [dayOf(1916, 1), .6], factoryShells: 3, factoryCost: 0,
    morale: -10, unrest: 70, wwLoss: 1, hold: 1.5, startInf: 6,
    flags: { siberian: true },
    ai: { doctrines: ['mass', 'depth', 'total', 'elastic', 'infiltration', 'combined'], aggr: .8, dig: .9, guns: .7, mass: 1.6, navy: 1, line: 0, rush: 0.4, patience: .8, retreat: .2 },
  },
  { // German Empire
    unit: 'inf', unitName: 'Storm battalion', unitShort: 'STB', from: dayOf(1917, 1), unitDesc: 'From 1917: cross 60% of the wire unhindered, +25% speed, +15% damage in the assault',
    mult: { speed: 1.25 },
    strengths: [
      { name: 'Interior lines', desc: 'Rail movement in Europe is four times as fast instead of three.' },
      { name: 'Krupp', desc: 'Shell production +25%, suppression +10%.' },
    ],
    weaknesses: [
      { name: 'Blockaded', desc: 'German sea lanes always count as thin supply.' },
      { name: 'Late tanks', desc: 'Tanks only from March 1918, at 50% more cost (A7V).' },
    ],
    tankFrom: dayOf(1918, 3), tankCost: 1.5,
    pool: 1, growth: 1,
    shells: 1.25, factoryShells: 3, factoryCost: 0,
    morale: 0, unrest: 80, wwLoss: 1, hold: 1.5, startInf: 6,
    flags: { interior: true, krupp: true, blockaded: true, storm: true },
    ai: { doctrines: ['artillery', 'elastic', 'blockade', 'infiltration', 'combined', 'total'], aggr: 1.2, dig: 1.1, guns: 1.5, mass: .9, navy: .6, line: 0.1, rush: 0.05, patience: 1.25, retreat: 1 },
  },
  { // Austria-Hungary
    unit: 'art', unitName: 'Škoda siege battery', unitShort: 'ŠKO', unitDesc: 'Heavy howitzers · +80% damage against defences, −20% rate of fire',
    mult: { rof: 1.25 },
    strengths: [
      { name: 'Mountain war', desc: 'Defenders on mountain borders take 30% less damage on top of the terrain. Fortifications cost 20% less in mountain regions.' },
      { name: 'Siege train', desc: 'Škoda howitzers break MG nests, bunkers and gun emplacements.' },
    ],
    weaknesses: [
      { name: 'Many-nation army', desc: 'Morale ceiling −10, unrest starts at 75 war weariness, manpower grows 20% slower.' },
      { name: 'No tanks', desc: 'No own tanks until 1918.' },
    ],
    tankFrom: dayOf(1918, 1), tankCost: 1,
    pool: 1, growth: .8,
    shells: 1, factoryShells: 3, factoryCost: 0,
    morale: -10, unrest: 75, wwLoss: 1, hold: 1.5, startInf: 6,
    flags: { skoda: true, mountain: true },
    ai: { doctrines: ['depth', 'artillery', 'peace', 'elastic', 'air', 'total'], aggr: 1.2, dig: 1.4, guns: 1.3, mass: 1, navy: .7, line: 0.4, rush: 0.1, patience: 1, retreat: 1.2 },
  },
  { // Ottoman Empire
    unit: 'inf', unitName: 'Fortress infantry', unitShort: 'FOR', unitDesc: 'Stubborn defenders · +25% defence in a trench, −15% in the attack',
    mult: {},
    strengths: [
      { name: 'Gallipoli', desc: 'Home regions start with a trench II on every land border.' },
      { name: 'Desert war', desc: 'Heat penalties are halved.' },
    ],
    weaknesses: [
      { name: 'Weak industry', desc: 'Factories make 2 shells instead of 3 and cost 2 more.' },
      { name: 'Poor rails', desc: 'The Anatolia–Mesopotamia line is unfinished; more sea lanes are thin. No own tanks until 1918.' },
    ],
    tankFrom: dayOf(1918, 1), tankCost: 1,
    pool: 1, growth: 1,
    shells: 1, factoryShells: 2, factoryCost: 2,
    morale: 0, unrest: 80, wwLoss: 1, hold: 1.5, startInf: 6,
    flags: { gallipoli: true, desert: true, fortInf: true, poorRails: true },
    ai: { doctrines: ['depth', 'elastic', 'mass', 'peace', 'air', 'total'], aggr: 1.35, dig: 1.6, guns: .9, mass: 1.2, navy: .8, line: 0.5, rush: 0.1, patience: 1.2, retreat: 1 },
  },
  { // United States: neutral at first, the arsenal of the Entente, its fresh divisions only mobilised from 1917
    unit: 'inf', unitName: 'Doughboy battalion', unitShort: 'AEF', unitDesc: 'Fresh, well-fed American infantry · +15% hit points', from: dayOf(1917, 4),
    mult: { hp: 1.15 },
    strengths: [
      { name: 'Arsenal of democracy', desc: 'Factories make 4 shells per convoy and cost nothing extra.' },
      { name: 'Fresh divisions', desc: 'The manpower pool is 40% larger and, from April 1917, grows 30% faster.' },
    ],
    weaknesses: [
      { name: 'Neutrality', desc: 'Until April 1917 the nation will not mobilise: manpower grows at half speed.' },
      { name: 'Untested army', desc: 'Morale ceiling −5. Tanks only from 1918 (French-built Renaults).' },
    ],
    tankFrom: dayOf(1918, 1), tankCost: 1.1,
    pool: 1.4, growth: 1.3, growthUntil: [dayOf(1917, 4), .38],
    shells: 1.1, factoryShells: 4, factoryCost: 0,
    morale: -5, unrest: 85, wwLoss: 1.1, hold: 1.5, startInf: 5,
    flags: { navy: true },
    ai: { doctrines: ['mass', 'artillery', 'tankcorps', 'combined', 'total', 'air'], aggr: 1.25, dig: 1, guns: 1.1, mass: 1.1, navy: 1.4, line: 0.4, rush: 0.05, patience: 1.1, retreat: 1.1 },
  },
];

/** The nation of a power (falls back to a neutral profile for unknown ids). */
export const nationOf = (f: number): Nation => NATIONS[f] ?? NATIONS[3];
/** Is the national variant of `f` in the field for unit type `t` on `day`? */
export const nationalUnit = (f: number, t: UnitType, day: number) => { const n = NATIONS[f]; return !!n && n.unit === t && (n.from === undefined || day >= n.from); };
