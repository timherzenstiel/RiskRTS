// Number and strength formatting for the HUD.
import { FORMATION, UNIT_TYPES, type Units } from '@riskrts/shared';

/** 1234 -> "1,234". */
export const menStr = (n: number) => Math.round(n).toLocaleString('en-GB');
/** Total men in a set of formations. */
export const menOf = (m: Units) => UNIT_TYPES.reduce((s, k) => s + m[k], 0);
/** Average strength of the formations, 0..1. */
export function strengthOf(u: Units, m: Units) {
  let full = 0, have = 0; for (const k of UNIT_TYPES) { full += u[k] * FORMATION[k].men; have += Math.min(m[k], u[k] * FORMATION[k].men); }
  return full ? have / full : 1;
}
