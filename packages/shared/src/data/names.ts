// Names of armies (the main army of a region) and corps (the troops on one border), per power, from their numbers.
// Numbers are handed out per power in the order the groups are raised, so every client names them the same.

const ROMAN: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export function roman(n: number): string { let s = ''; for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v; } return s || 'O'; }

const WORDS = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
const ordEn = (n: number) => { const t = n % 100; return n + (t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'); };

/** Name of army number `n` of power `f` (British Empire, France, Russia, Germany, Austria-Hungary, Ottomans). */
export function armyName(f: number, n: number): string {
  switch (f) {
    case 0: return (WORDS[n] ?? ordEn(n)) + ' Army';
    case 1: return (n === 1 ? '1re' : n + 'e') + ' Armée';
    case 2: return n + '-ya Armiya';
    case 3: return n + '. Armee';
    case 4: return 'k.u.k. ' + n + '. Armee';
    case 5: return n + '. Ordu';
    default: return ordEn(n) + ' Army';
  }
}

/** Name of corps number `n` of power `f`. */
export function corpsName(f: number, n: number): string {
  const r = roman(n);
  switch (f) {
    case 0: return r + ' Corps';
    case 1: return r + "e Corps d'armée";
    case 2: return r + ' Korpus';
    case 3: return r + '. Armeekorps';
    case 4: return r + '. Korps';
    case 5: return r + '. Kolordu';
    default: return r + ' Corps';
  }
}

/** Short form for map markers. */
export function corpsShort(f: number, n: number): string {
  const r = roman(n);
  return f === 3 ? r + '. AK' : f === 1 ? r + 'e CA' : f === 5 ? r + '. Kol.' : f === 2 ? r + ' K.' : f === 4 ? r + '. K.' : r + ' Corps';
}

/** Name of a group: kind 0 army, 1 corps; an unknown number (-1 or undefined) gives a plain description. */
export function groupName(f: number, kind: number, n: number | undefined, short = false): string {
  if (n === undefined || n < 1) return kind ? 'Corps' : 'Main army';
  return kind ? (short ? corpsShort(f, n) : corpsName(f, n)) : armyName(f, n);
}
