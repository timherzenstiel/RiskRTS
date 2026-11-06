// Interface language. The simulation (@riskrts/shared) always speaks English, so every client can
// translate what it gets, including texts that come from a host or server running another language.
//
//   t('Attack {0}', regionName)  translate an English template, then fill it. String arguments are
//                                translated too (region, power, unit names), numbers are left alone.
//   tx(text)                     translate a finished English text from the simulation, e.g. a feed
//                                line or a command error. Templates with {0} placeholders in the
//                                dictionary are matched as patterns, and the captured parts are
//                                translated in turn.
//
// German templates may ask for a grammatical case: {0:gen}, {0:dat}, {0:acc}. That only changes
// names listed in DECL (the powers); everything else is inserted as it is.
import { useSyncExternalStore } from 'react';
import { DE, DECL } from './de';

export type Lang = 'en' | 'de';
export const LANGS: { id: Lang; label: string }[] = [{ id: 'en', label: 'English' }, { id: 'de', label: 'Deutsch' }];
const KEY = 'f14lang';

function initial(): Lang {
  try { const v = localStorage.getItem(KEY); if (v === 'en' || v === 'de') return v; } catch { /* storage unavailable */ }
  try { if (typeof navigator !== 'undefined' && /^de\b/i.test(navigator.language)) return 'de'; } catch { /* no navigator */ }
  return 'en';
}

let lang: Lang = initial();
let version = 0;
const subs = new Set<() => void>();
const setDocLang = () => { try { document.documentElement.lang = lang; } catch { /* no DOM */ } };
setDocLang();

export const getLang = () => lang;
/** Bumps on every language change, for caches outside React (map labels). */
export const langVersion = () => version;
export function setLang(l: Lang) {
  if (l === lang) return;
  lang = l; version++; cache.clear();
  try { localStorage.setItem(KEY, l); } catch { /* storage unavailable */ }
  setDocLang();
  subs.forEach(f => f());
}
export function onLang(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
/** Re-render a component when the language changes. */
export function useLang(): Lang { return useSyncExternalStore(onLang, getLang, getLang); }

export type Case = 'nom' | 'gen' | 'dat' | 'acc';
type Arg = string | number | null | undefined;

/** Translate one inserted value, in a grammatical case when it is a declined name. */
function arg(v: Arg, c: Case = 'nom'): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return lang === 'de' ? numDe(v) : String(v);
  if (lang === 'en') return v;
  const d = DECL[v] ?? DECL[tx(v)];
  if (d) return d[c];
  return tx(v);
}
const numDe = (n: number) => Number.isInteger(n) ? String(n) : String(n).replace('.', ',');

const PH = /\{(\d+)(?::(nom|gen|dat|acc))?\}/g;
/** Fill placeholders. A value that opens the text (or a sentence) starts with a capital letter. */
function fill(tpl: string, get: (i: number, c: Case | undefined) => string): string {
  return tpl.replace(PH, (_, i, c, off: number) => {
    const v = get(+i, c as Case | undefined);
    return lang === 'de' && v && (off === 0 || /[.!?]\s$/.test(tpl.slice(Math.max(0, off - 2), off))) ? v[0].toUpperCase() + v.slice(1) : v;
  });
}

/** Translate an English template and fill in its arguments. */
export function t(tpl: string, ...args: Arg[]): string {
  if (lang === 'en') return fill(tpl, i => arg(args[i]));
  const de = DE[tpl] ?? (/[A-Za-z]{3}/.test(tpl) && missing.add(tpl), tpl);
  return fill(de, (i, c) => arg(args[i], c));
}

// ---- pattern matching for finished English texts ----
interface Pat { re: RegExp; order: number[]; de: string }
let pats: Pat[] | null = null;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function patterns(): Pat[] {
  if (pats) return pats;
  const list: { p: Pat; lit: number }[] = [];
  for (const [en, de] of Object.entries(DE)) {
    if (!/\{\d+\}/.test(en)) continue;
    const order: number[] = []; let src = '^', last = 0, lit = 0;
    for (const m of en.matchAll(/\{(\d+)\}/g)) {
      const part = en.slice(last, m.index); src += esc(part); lit += part.length;
      src += '(.+?)'; order.push(+m[1]); last = m.index! + m[0].length;
    }
    const tail = en.slice(last); src += esc(tail) + '$'; lit += tail.length;
    if (lit === 0) continue;
    list.push({ p: { re: new RegExp(src, 's'), order, de }, lit });
  }
  list.sort((a, b) => b.lit - a.lit);
  return (pats = list.map(x => x.p));
}

const cache = new Map<string, string>();
/** Missing texts seen this session (German only), for finding gaps: `__i18nMissing` in the console. */
export const missing = new Set<string>();
if (typeof window !== 'undefined') (window as unknown as { __i18nMissing: Set<string> }).__i18nMissing = missing;

/** Translate a finished English text (from the simulation, a server or a host). */
export function tx(s: string | null | undefined): string {
  if (s === null || s === undefined) return '';
  if (lang === 'en' || s === '') return s;
  const hit = cache.get(s); if (hit !== undefined) return hit;
  let out = DE[s] ?? DECL[s]?.nom;
  if (out === undefined) {
    for (const p of patterns()) {
      const m = p.re.exec(s); if (!m) continue;
      const caps: string[] = []; p.order.forEach((n, k) => { caps[n] = m[k + 1]; });
      out = fill(p.de, (i, c) => { const v = caps[i] ?? ''; return /^-?\d+([.,]\d+)?$/.test(v) ? v.replace('.', ',') : arg(v, c); });
      break;
    }
  }
  if (out === undefined) {
    if (/[A-Za-z]{3}/.test(s) && !/^[A-Z0-9 .·\-–—]+$/.test(s)) missing.add(s);
    out = s;
  }
  if (cache.size > 5000) cache.clear();
  cache.set(s, out);
  return out;
}

/** For tests and tools: translate as if `l` were the language. */
export function withLang<T>(l: Lang, f: () => T): T {
  const prev = lang; lang = l; cache.clear();
  try { return f(); } finally { lang = prev; cache.clear(); }
}
