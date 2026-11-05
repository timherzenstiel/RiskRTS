// Terrain and weather on the 54-region map: mountain borders, and the weather per continent and month.
import { buildWorld } from '../world/build';
import { dateOf } from './calendar';

/** Borders across mountain ranges: defenders hold them more easily. */
export const MOUNTAINS: [string, string][] = [
  ['Italy', 'Austria-Hungary'], ['France', 'Italy'], ['Germany', 'Italy'], ['Iberia', 'France'],
  ['Austria-Hungary', 'Balkans'], ['Austria-Hungary', 'Poland'], ['Austria-Hungary', 'Ukraine'], ['Balkans', 'Ukraine'],
  ['Caucasus', 'Anatolia'], ['Caucasus', 'Persia'], ['Caucasus', 'Ukraine'], ['Anatolia', 'Mesopotamia'],
  ['India', 'Mongolia'], ['India', 'China'], ['India', 'Turkestan'], ['India', 'Persia'], ['Persia', 'Turkestan'],
  ['Peru', 'Argentina'], ['Prairies', 'Yukon'],
];

let mtn: Set<string> | null = null;
const key = (a: number, b: number) => a < b ? a + '|' + b : b + '|' + a;
function mountainSet() {
  if (mtn) return mtn;
  const W = buildWorld(); mtn = new Set(MOUNTAINS.map(([a, b]) => key(W.byName[a].id, W.byName[b].id)));
  return mtn;
}
/** Is the border between two regions a mountain border? */
export const isMountain = (a: number, b: number) => a >= 0 && b >= 0 && mountainSet().has(key(a, b));
/** Does a region have any mountain border? */
export const mountainRegion = (r: number) => buildWorld().regions[r].adj.some(n => isMountain(r, n));

export type Weather = 0 | 1 | 2 | 3;
export const WEATHER = ['Fair', 'Mud', 'Winter', 'Heat'] as const;
const HOT = new Set(['Mesopotamia', 'Arabia', 'Persia', 'India', 'Egypt', 'Maghreb', 'West Africa', 'East Africa', 'Congo', 'Turkestan']);
const EAST_EU = new Set(['Poland', 'Petrograd', 'Ukraine', 'Scandinavia', 'Austria-Hungary', 'Balkans']);

/**
 * Weather of a region on a game day: mud in Europe in October, November and March; winter from December to February in eastern
 * Europe, Scandinavia, Canada and Asia north of 45°; heat from June to August in Africa, the Middle East, India and Turkestan.
 */
export function weatherAt(region: number, day: number): Weather {
  const r = buildWorld().regions[region], { m } = dateOf(day);
  const winterLand = EAST_EU.has(r.name) || (r.cont === 'AS' && r.lat >= 45) || (r.cont === 'NA' && r.lat >= 48) || r.name === 'Iceland' || r.name === 'Greenland';
  if ((m === 12 || m <= 2) && winterLand) return 2;
  if ((m >= 6 && m <= 8) && HOT.has(r.name)) return 3;
  if (r.cont === 'EU' && (m === 10 || m === 11 || m === 3)) return 1;
  return 0;
}
