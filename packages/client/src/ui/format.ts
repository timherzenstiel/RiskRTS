// Number and strength formatting for the HUD.
import { FORMATION, UNIT_TYPES, type Units } from '@riskrts/shared';
import { getLang, t } from '../i18n';

/** 1234 -> "1,234" (German: "1.234"). */
export const menStr = (n: number) => Math.round(n).toLocaleString(getLang() === 'de' ? 'de-DE' : 'en-GB');
/** Total men in a set of formations. */
export const menOf = (m: Units) => UNIT_TYPES.reduce((s, k) => s + m[k], 0);
/** Average strength of the formations, 0..1. */
export function strengthOf(u: Units, m: Units) {
  let full = 0, have = 0; for (const k of UNIT_TYPES) { full += u[k] * FORMATION[k].men; have += Math.min(m[k], u[k] * FORMATION[k].men); }
  return full ? have / full : 1;
}

/** A name from the simulation (power, region) in the interface language; powers in a case when asked. */
export const nm = (s: string) => t('{0}', s);
/** A translated sentence split around its {0}, to put a React element (bold word, button) in the middle. */
export const around = (tpl: string): [string, string] => { const [a, b = ''] = t(tpl, '\u0000').split('\u0000'); return [a, b]; };
