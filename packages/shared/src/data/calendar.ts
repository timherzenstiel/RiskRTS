// Calendar: the war starts on 1 August 1914 and each supply convoy is one week.
const START = Date.UTC(1914, 7, 1);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Game day of a calendar date (month 1–12). */
export const dayOf = (y: number, m: number, d = 1) => Math.round((Date.UTC(y, m - 1, d) - START) / 864e5);
/** Calendar date of a game day. */
export function dateOf(day: number) { const d = new Date(START + day * 864e5); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; }
/** "1 Aug 1914". */
export function dateStr(day: number) { const { y, m, d } = dateOf(day); return `${d} ${MON[m - 1]} ${y}`; }
/** "Sep 1916". */
export function monthStr(day: number) { const { y, m } = dateOf(day); return `${MON[m - 1]} ${y}`; }
