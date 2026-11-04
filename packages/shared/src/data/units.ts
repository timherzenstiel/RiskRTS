// Unit, defence and aircraft statistics and costs. Tune game balance here.
export type UnitType = 'inf' | 'mg' | 'art' | 'tank' | 'plane';
export const UNIT_TYPES: UnitType[] = ['inf', 'mg', 'art', 'tank', 'plane'];
/** Units that march over land (and capture regions). Planes fly separately. */
export const GROUND_TYPES: UnitType[] = ['inf', 'mg', 'art', 'tank'];
/** Fixed defences placed on one border sector of a region, or in its interior. */
export type DefKind = 'pill' | 'fort' | 'flak';
export const DEF_KINDS: DefKind[] = ['pill', 'fort', 'flak'];
/** Everything that can fight on a battlefield. */
export type AgentType = UnitType | DefKind;
export const AGENT_TYPES: AgentType[] = [...UNIT_TYPES, ...DEF_KINDS];

export interface UnitStats { name: string; short: string; hp: number; range: number; dmg: number; rof: number; acc: number; speed: number; power: number; splash?: number }
export const UT: Record<UnitType, UnitStats> = {
  inf: { name: 'Infantry', short: 'INF', hp: 10, range: 7, dmg: 2.2, rof: 1.1, acc: .55, speed: 1.25, power: 1 },
  mg: { name: 'Machine gun', short: 'MG', hp: 12, range: 9.5, dmg: 1.1, rof: .28, acc: .34, speed: .75, power: 1.6 },
  art: { name: 'Field gun', short: 'ART', hp: 9, range: 22, dmg: 7, rof: 3.4, acc: .5, speed: .5, power: 2.2, splash: 2.4 },
  tank: { name: 'Tank', short: 'TNK', hp: 45, range: 8, dmg: 5, rof: 1.8, acc: .6, speed: .9, power: 4 },
  plane: { name: 'Biplane', short: 'AIR', hp: 16, range: 6, dmg: 4.5, rof: 1.5, acc: .55, speed: 7, power: 2.5, splash: 2 },
};
export const DT: Record<DefKind, UnitStats & { desc: string }> = {
  pill: { name: 'Pillbox', short: 'PBX', hp: 80, range: 10.5, dmg: 1.4, rof: .3, acc: .4, speed: 0, power: 4, desc: 'Concrete MG nest. Shrugs off rifle fire.' },
  fort: { name: 'Gun emplacement', short: 'EMP', hp: 60, range: 25, dmg: 8, rof: 3.8, acc: .55, speed: 0, power: 5, splash: 2.6, desc: 'Heavy gun that shells the approach.' },
  flak: { name: 'Anti-air gun', short: 'AA', hp: 35, range: 17, dmg: 3.6, rof: .75, acc: .6, speed: 0, power: 1.5, desc: 'Covers the whole region against aircraft.' },
};
/** Stats of any agent type. */
export const AS = (t: AgentType): UnitStats => (t in UT ? UT[t as UnitType] : DT[t as DefKind]);
export const isDef = (t: AgentType): t is DefKind => t === 'pill' || t === 'fort' || t === 'flak';
/** How well each shooter hurts aircraft (0 = cannot target them). */
export const ANTI_AIR: Record<AgentType, number> = { inf: .35, mg: .7, art: 0, tank: 0, plane: 1, pill: .6, fort: 0, flak: 1.6 };

export type Units = Record<UnitType, number>;
export const emptyUnits = (): Units => ({ inf: 0, mg: 0, art: 0, tank: 0, plane: 0 });
export const totalUnits = (u: Units) => u.inf + u.mg + u.art + u.tank + u.plane;
export const groundUnits = (u: Units) => u.inf + u.mg + u.art + u.tank;
export const unitPower = (u: Units) => u.inf * UT.inf.power + u.mg * UT.mg.power + u.art * UT.art.power + u.tank * UT.tank.power + u.plane * UT.plane.power;
export const COST = { inf: 1, mg: 2, art: 3, tank: 5, plane: 4, factory: 6, barracks: 4, airfield: 6, pill: 3, fort: 5, flak: 3 } as const;
export const TRENCH_COST = [3, 5, 8] as const;
export const MAX_TRENCH = 3;
/** Defences allowed per border sector and in the interior. */
export const MAX_DEF_SECTOR = 2, MAX_DEF_INTERIOR = 3;
/** Aircraft reach: regions this many borders away. */
export const AIR_RANGE = 2;
/** Seconds between supply convoys. Every power receives supply at the same instant. */
export const TICK_SECONDS = 20;
