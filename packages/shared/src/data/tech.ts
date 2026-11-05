// The war calendar: what becomes available when (per nation for tanks), and the doctrines a power adopts each war year.
import { dayOf } from './calendar';
import { nationOf, type DoctrineKey } from './nations';

export type TechKey = 'air' | 'trench2' | 'trench3' | 'heavy' | 'tank' | 'tank2' | 'bomb' | 'railAir' | 'combined' | 'air2';
export interface Tech { key: TechKey; name: string; desc: string; day: number }
export const TECH: Tech[] = [
  { key: 'air', name: 'Military aviation', desc: 'Airfields, air squadrons, reconnaissance flights and anti-air guns', day: dayOf(1915, 3) },
  { key: 'trench2', name: 'Trench II', desc: 'Deeper trenches with dugouts', day: dayOf(1915, 3) },
  { key: 'trench3', name: 'Trench III and bunkers', desc: 'Deep trench systems and concrete bunkers', day: dayOf(1916, 1) },
  { key: 'heavy', name: 'Heavy barrage drill', desc: 'Heavy barrages build 20% more suppression', day: dayOf(1916, 1) },
  { key: 'tank', name: 'Tanks', desc: 'Tank platoons (from a factory region)', day: dayOf(1916, 9) },
  { key: 'tank2', name: 'Better tanks', desc: 'Tanks +30% armour', day: dayOf(1917, 1) },
  { key: 'bomb', name: 'Strategic bombing', desc: 'Aircraft can bomb factories: no supply, shells or tanks from them for three convoys', day: dayOf(1917, 1) },
  { key: 'railAir', name: 'Rail interdiction', desc: 'Aircraft can bomb railways', day: dayOf(1917, 1) },
  { key: 'combined', name: 'Combined arms', desc: 'Tanks and infantry fighting on one front +10% damage', day: dayOf(1918, 1) },
  { key: 'air2', name: 'Improved aircraft', desc: 'Aircraft +20% armour and damage', day: dayOf(1918, 1) },
];
export const techDef = (k: TechKey) => TECH.find(t => t.key === k)!;
/** Days a rush brings an unlock forward, and what it costs (one rush per war year). */
export const RUSH = { days: 183, cost: 20 } as const;

/** Day a power gets a technology: tanks follow the nation's own date; a rush brings it six months forward. */
export function techDayFor(f: number, k: TechKey, rushed?: readonly TechKey[]) {
  const base = k === 'tank' ? nationOf(f).tankFrom : techDef(k).day;
  return base - (rushed?.includes(k) ? RUSH.days : 0);
}

export interface Doctrine { key: DoctrineKey; year: number; name: string; desc: string }
export const DOCTRINES: Doctrine[] = [
  { key: 'artillery', year: 1915, name: 'Artillery dominance', desc: 'Every gun shot uses 25% fewer shells' },
  { key: 'depth', year: 1915, name: 'Defence in depth', desc: 'Trenches cost 30% less; a second line behind the first (trenches count one level deeper)' },
  { key: 'mass', year: 1915, name: 'Mass mobilisation', desc: 'The manpower pool grows 50% faster' },
  { key: 'creeping', year: 1916, name: 'Creeping barrage', desc: 'Attackers take 30% less fire while the defenders are over 50% suppressed' },
  { key: 'elastic', year: 1916, name: 'Elastic defence', desc: 'Breaking defenders fall back to a second line instead, once per battle' },
  { key: 'blockade', year: 1916, name: 'Blockade and U-boat war', desc: 'Enemy sea lanes next to your regions lose a supply step' },
  { key: 'infiltration', year: 1917, name: 'Infiltration tactics', desc: 'Infantry cross 30% of the wire unhindered and move 15% faster' },
  { key: 'tankcorps', year: 1917, name: 'Tank corps', desc: 'Tanks cost 30% less' },
  { key: 'air', year: 1917, name: 'Air superiority', desc: 'Aircraft +30% armour and damage; reconnaissance flights are never shot down' },
  { key: 'combined', year: 1918, name: 'Combined arms', desc: 'Tanks and infantry on one front fight 25% harder' },
  { key: 'total', year: 1918, name: 'Total war', desc: '+30% supply income, +1 war weariness per convoy' },
  { key: 'peace', year: 1918, name: 'Peace offensive', desc: 'Losses raise war weariness 30% less; ceasefires are easier to get' },
];
export const doctrineDef = (k: DoctrineKey) => DOCTRINES.find(d => d.key === k)!;
export const doctrinesOf = (year: number) => DOCTRINES.filter(d => d.year === year);
/** Seconds a power has to choose its doctrine before the War Office picks for it. */
export const DOCTRINE_TIME = 60;
