// The war calendar in play: unlocks by date (rushes bring one forward), and the doctrine each power adopts every war year.
import { dateOf } from '../data/calendar';
import { nationOf, type DoctrineKey } from '../data/nations';
import { DOCTRINE_TIME, RUSH, TECH, doctrinesOf, techDayFor, type TechKey } from '../data/tech';
import { emit } from './core';
import type { GameState } from './types';

/** Does power `f` have technology `k` today? */
export const techOn = (g: GameState, f: number, k: TechKey) => g.day >= techDayFor(f, k, g.factions[f]?.rushed);
/** Has power `f` adopted doctrine `k`? */
export const hasDoc = (g: GameState, f: number, k: DoctrineKey) => !!g.factions[f]?.doctrines?.includes(k);
/** War years with a doctrine choice. */
export const DOCTRINE_YEARS = [1915, 1916, 1917, 1918];

/** Bring an unlock forward by six months. */
export function rush(g: GameState, fid: number, k: TechKey): string | null {
  const f = g.factions[fid], t = TECH.find(x => x.key === k); if (!t) return 'Invalid order.';
  if (techOn(g, fid, k)) return 'You already have that.';
  if (f.rushed?.includes(k)) return 'That has already been rushed.';
  const y = dateOf(g.day).y; if (f.rushY === y) return `You already rushed one development in ${y}. Next year you can rush another.`;
  if (f.supply < RUSH.cost) return `Not enough Production: a rush costs ${RUSH.cost}.`;
  f.supply -= RUSH.cost; (f.rushed ??= []).push(k); f.rushY = y;
  if (techOn(g, fid, k)) emit(g, { k: 'tech', faction: fid, tech: k });
  return null;
}

/** Adopt one of the doctrines offered this war year. */
export function chooseDoctrine(g: GameState, fid: number, k: DoctrineKey): string | null {
  const f = g.factions[fid];
  if (!f.docOffer) return 'There is no doctrine to choose right now.';
  if (!doctrinesOf(f.docOffer).some(d => d.key === k)) return 'That doctrine is not on offer this year.';
  (f.doctrines ??= []).push(k); f.docOffer = undefined; f.docDue = undefined;
  emit(g, { k: 'doctrine', faction: fid, doc: k });
  return null;
}

/** The doctrine the War Office prefers for a power among this year's options. */
export function favouriteDoctrine(fid: number, year: number): DoctrineKey {
  const opts = doctrinesOf(year).map(d => d.key), pref = nationOf(fid).ai.doctrines;
  return pref.find(k => opts.includes(k)) ?? opts[0];
}

/** After a convoy: announce unlocks that arrived this week and offer the new year's doctrines. */
export function calendarTick(g: GameState, prevDay: number) {
  for (const f of g.factions) {
    if (!f.alive) continue;
    for (const t of TECH) { const d = techDayFor(f.id, t.key, f.rushed); if (d > prevDay && d <= g.day) emit(g, { k: 'tech', faction: f.id, tech: t.key }); }
  }
  const y0 = dateOf(prevDay).y, y = dateOf(g.day).y;
  if (y === y0 || !DOCTRINE_YEARS.includes(y)) return;
  for (const f of g.factions) {
    if (!f.alive) continue;
    if (f.docOffer) chooseDoctrine(g, f.id, favouriteDoctrine(f.id, f.docOffer));
    f.docOffer = y; f.docDue = g.time + DOCTRINE_TIME;
    if (f.ai) chooseDoctrine(g, f.id, favouriteDoctrine(f.id, y)); else emit(g, { k: 'docOffer', faction: f.id, year: y });
  }
}

/** Every step: a choice left open past its time is made by the War Office. */
export function doctrineDeadlines(g: GameState) {
  for (const f of g.factions) if (f.docOffer && f.docDue !== undefined && g.time >= f.docDue) chooseDoctrine(g, f.id, favouriteDoctrine(f.id, f.docOffer));
}
