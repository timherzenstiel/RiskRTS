// Unit, defence and aircraft statistics and costs. Tune game balance here.
export type UnitType = 'inf' | 'mg' | 'art' | 'tank' | 'plane';
export const UNIT_TYPES: UnitType[] = ['inf', 'mg', 'art', 'tank', 'plane'];
/** Units that march over land (and capture regions). Planes fly separately. */
export const GROUND_TYPES: UnitType[] = ['inf', 'mg', 'art', 'tank'];
/** Fixed defences placed on one border sector of a region, or in its interior. They fight as agents in battle. */
export type DefKind = 'pill' | 'fort' | 'flak' | 'bunk';
export const DEF_KINDS: DefKind[] = ['pill', 'fort', 'flak', 'bunk'];
/** Field works on a border sector: they do not fight, they change how the battle on that border goes. */
export type WorkKind = 'trench' | 'sand' | 'wire';
export const WORK_KINDS: WorkKind[] = ['trench', 'sand', 'wire'];
/** Everything that can be placed on a border (border card) or in the interior (Build tab). */
export type FortKind = DefKind | WorkKind;
/** Everything that can fight on a battlefield. */
export type AgentType = UnitType | DefKind;
export const AGENT_TYPES: AgentType[] = [...UNIT_TYPES, ...DEF_KINDS];

export interface UnitStats { name: string; short: string; hp: number; range: number; dmg: number; rof: number; acc: number; speed: number; power: number; splash?: number }
export const UT: Record<UnitType, UnitStats> = {
  inf: { name: 'Infantry battalion', short: 'INF', hp: 10, range: 7, dmg: 2.2, rof: 1.1, acc: .55, speed: 1.25, power: 1 },
  mg: { name: 'MG company', short: 'MG', hp: 12, range: 9.5, dmg: 1.1, rof: .28, acc: .34, speed: .75, power: 1.6 },
  art: { name: 'Field battery', short: 'ART', hp: 9, range: 22, dmg: 7, rof: 3.4, acc: .5, speed: .5, power: 2.2, splash: 2.4 },
  tank: { name: 'Tank platoon', short: 'TNK', hp: 45, range: 8, dmg: 5, rof: 1.8, acc: .6, speed: .9, power: 4 },
  plane: { name: 'Air squadron', short: 'AIR', hp: 16, range: 6, dmg: 4.5, rof: 1.5, acc: .55, speed: 7, power: 2.5, splash: 2 },
};
/** What one unit stands for: a battalion of 100 men, an MG company, a battery, a tank platoon, a squadron. */
export const FORMATION: Record<UnitType, { one: string; many: string; men: number; kit: string }> = {
  inf: { one: 'battalion', many: 'battalions', men: 100, kit: '100 rifles' },
  mg: { one: 'MG company', many: 'MG companies', men: 60, kit: '6 machine guns' },
  art: { one: 'battery', many: 'batteries', men: 80, kit: '4 field guns' },
  tank: { one: 'tank platoon', many: 'tank platoons', men: 25, kit: '3 tanks' },
  plane: { one: 'squadron', many: 'squadrons', men: 12, kit: '6 aircraft' },
};
export const DT: Record<DefKind, UnitStats & { desc: string }> = {
  pill: { name: 'MG nest', short: 'MGN', hp: 80, range: 10.5, dmg: 1.4, rof: .3, acc: .4, speed: 0, power: 4, desc: 'Concrete MG nest. Shrugs off rifle fire.' },
  fort: { name: 'Gun emplacement', short: 'EMP', hp: 60, range: 25, dmg: 8, rof: 3.8, acc: .55, speed: 0, power: 5, splash: 2.6, desc: 'Heavy gun that shells the approach.' },
  flak: { name: 'Anti-air gun', short: 'AA', hp: 35, range: 17, dmg: 3.6, rof: .75, acc: .6, speed: 0, power: 1.5, desc: 'Covers the whole region against aircraft.' },
  bunk: { name: 'Bunker', short: 'BNK', hp: 220, range: 10.5, dmg: 1.4, rof: .16, acc: .42, speed: 0, power: 7, desc: 'Deep concrete bunker with two MGs. Shelters the troops on its border from shells and bombs.' },
};
/** Stats of any agent type. */
export const AS = (t: AgentType): UnitStats => (t in UT ? UT[t as UnitType] : DT[t as DefKind]);
export const isDef = (t: AgentType): t is DefKind => t === 'pill' || t === 'fort' || t === 'flak' || t === 'bunk';
export const isWork = (k: FortKind): k is WorkKind => k === 'trench' || k === 'sand' || k === 'wire';
/** How well each shooter hurts aircraft (0 = cannot target them). */
export const ANTI_AIR: Record<AgentType, number> = { inf: .35, mg: .7, art: 0, tank: 0, plane: 1, pill: .6, fort: 0, flak: 1.6, bunk: .6 };

export type Units = Record<UnitType, number>;
export const emptyUnits = (): Units => ({ inf: 0, mg: 0, art: 0, tank: 0, plane: 0 });
export const totalUnits = (u: Units) => u.inf + u.mg + u.art + u.tank + u.plane;
export const groundUnits = (u: Units) => u.inf + u.mg + u.art + u.tank;
export const unitPower = (u: Units) => u.inf * UT.inf.power + u.mg * UT.mg.power + u.art * UT.art.power + u.tank * UT.tank.power + u.plane * UT.plane.power;
/** Men at full strength for a set of units. */
export const fullMen = (u: Units) => UNIT_TYPES.reduce((s, k) => s + u[k] * FORMATION[k].men, 0);
export const COST = {
  inf: 1, mg: 2, art: 3, tank: 5, plane: 4, factory: 6, barracks: 4, airfield: 6,
  pill: 3, fort: 5, flak: 3, bunk: 6, sand: 1, wire: 2,
  /** Reconnaissance: a cavalry patrol over one border, a reconnaissance flight, a spy. */
  patrol: 1, recon: 3, spy: 4,
  /** A decoy army marching to deceive rivals. */
  decoy: 1,
} as const;
export const TRENCH_COST = [3, 5, 8] as const;
export const MAX_TRENCH = 3, MAX_SAND = 2, MAX_WIRE = 2;
/** Building slots per border: defences, sandbags and wire share them (a bunker takes two). Trench depth is separate. */
export const SLOTS_LAND = 4, SLOTS_SEA = 2, SLOTS_INTERIOR = 3;
export const SLOT_USE: Record<DefKind | 'sand' | 'wire', number> = { pill: 1, fort: 1, flak: 1, bunk: 2, sand: 1, wire: 1 };
/** Hit points of one level of barbed wire in battle. */
export const WIRE_HP = 30;
/** Aircraft reach: regions this many borders away. */
export const AIR_RANGE = 2;
/**
 * Shells: production per convoy (base, per factory, per capital), what one supply buys, what one gun shot uses, the stock a
 * power starts with, and the local dump each gun brings into a battle (used when the side is cut off from its stockpile).
 */
export const SHELLS = { base: 2, factory: 3, capital: 1, perSupply: 4, shot: 1 / 3, start: 40, dump: 10 } as const;
/** Barrage: rate of fire of the guns at light/heavy, suppression per shell landing, its half-life, and the counter-battery share. */
export const BARRAGE = { heavy: 1.8, rationed: 4, supp: 2.5, half: 20, cb: .3, cbAir: .2, cbRange: 1.5 } as const;
/** Seconds between supply convoys. Every power receives supply at the same instant. */
export const TICK_SECONDS = 20;
