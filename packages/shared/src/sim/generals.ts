// Generals are a limited resource (design-play §3.2). Every army has one, and an army can only be formed while one is free.
// A power starts with a few (START_GENERALS); one more comes with every new war year and another for every GEN.wins battles
// its armies win. A general captured with his headquarters is replaced after GEN.lostWeeks. Relieving one frees his slot at
// once, but costs war weariness and leaves his front shaken for a while. Generals gain stars from battles won on their front;
// at three stars a general sheds a bad trait, or gains a third one.
// Invariant: free generals + armies + replacements on the way = slots.
import { BAD_TRAITS, START_GENERALS, TRAIT_KEYS, commanderName, commanderTraits, type TraitKey } from '../data/commanders';
import { dateOf, dayOf } from '../data/calendar';
import { TICK_SECONDS } from '../data/units';
import { emit, rnd } from './core';
import type { GameState, General, Generals, Hq } from './types';

export const GEN = {
  /** Battles won by a power's armies that bring one more general. */
  wins: 3,
  /** Weeks until a captured general is replaced. */
  lostWeeks: 8,
  /** War weariness a relieved general costs, the morale his corps lose at once, and for how many weeks their morale stays
   *  below `shakenMor` of its ceiling. */
  relieveWw: 2, relieveMor: 5, shakenWeeks: 2, shakenMor: .85,
  /** Experience a battle won on his front brings (three wins, one star). */
  winXp: .34,
  /** Most traits a general can have. */
  maxTraits: 3,
} as const;

export const isBad = (t: TraitKey) => BAD_TRAITS.includes(t);
export const stars = (x: General) => Math.floor(x.xp + 1e-6);

/** Numbers in 0..1 for a general, from the game's seed and his id: deterministic, and they leave the game's random stream alone. */
export function stream(seed: number, id: number): () => number {
  let a = (seed ^ Math.imul(id + 1, 2654435761)) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A new general of power `f`, with a name no general of that power has now. */
export function drawGeneral(g: GameState, f: number): General {
  const id = g.nextId++, r = stream(g.seed, id);
  const taken = new Set([...(g.hq ?? []).filter(h => h.owner === f).map(h => h.cmd.name), ...(g.factions[f]?.gen?.pool ?? []).map(x => x.name)]);
  let name = commanderName(f, r(), r());
  for (let i = 0; i < 6 && taken.has(name); i++) name = commanderName(f, r(), r());
  return { id, name, tr: commanderTraits(f, r), xp: 0 };
}

/** A power's generals, set up on first use (new games and saves from before generals were limited). */
export function generals(g: GameState, f: number): Generals {
  const F = g.factions[f];
  if (!F.gen) {
    const inUse = (g.hq ?? []).filter(h => h.owner === f).length, slots = Math.max(START_GENERALS[f] ?? 3, inUse);
    F.gen = { slots, pool: [], wins: 0, due: [], y: dateOf(g.day).y };
    for (let i = inUse; i < slots; i++) F.gen.pool.push(drawGeneral(g, f));
  }
  return F.gen;
}

/** Take a free general for a new army: the one asked for, else the most experienced. Null if none is free. */
export function takeGeneral(g: GameState, f: number, id?: number): General | null {
  const G = generals(g, f);
  const x = id !== undefined ? G.pool.find(p => p.id === id) : [...G.pool].sort((a, b) => b.xp - a.xp)[0];
  if (!x) return null;
  G.pool = G.pool.filter(p => p !== x);
  return x;
}

/** An army is gone: its general goes back to the free ones (with his experience). */
export const returnGeneral = (g: GameState, f: number, x: General) => { generals(g, f).pool.push(x); };

function add(g: GameState, f: number, why: 'year' | 'wins') {
  const G = generals(g, f), x = drawGeneral(g, f);
  G.slots++; G.pool.push(x);
  emit(g, { k: 'general', faction: f, kind: 'new', why, name: x.name });
}

/** A general was captured: his slot is filled again after GEN.lostWeeks. */
export function loseGeneral(g: GameState, h: Hq, region: number) {
  generals(g, h.owner).due.push(g.time + GEN.lostWeeks * TICK_SECONDS);
  emit(g, { k: 'general', faction: h.owner, kind: 'lost', name: h.cmd.name, army: h.id, region });
}

/** A battle won on a general's front: experience for him, and one more general for the power every GEN.wins wins. */
export function generalWon(g: GameState, h: Hq) {
  const G = generals(g, h.owner);
  h.cmd.xp = Math.min(3, h.cmd.xp + GEN.winXp);
  if (++G.wins % GEN.wins === 0) add(g, h.owner, 'wins');
  if (stars(h.cmd) >= 3 && !h.cmd.up) promote(g, h);
}

/** An operation won or lost: a star more or less (design-play §3.3). */
export function adjustStars(g: GameState, h: Hq, d: number) {
  h.cmd.xp = Math.max(0, Math.min(3, h.cmd.xp + d));
  if (stars(h.cmd) >= 3 && !h.cmd.up) promote(g, h);
}

/** Three stars: a bad trait is replaced by a good one, else a third good trait. */
function promote(g: GameState, h: Hq) {
  const x = h.cmd; x.up = true;
  const good = TRAIT_KEYS.filter(k => !isBad(k) && !x.tr.includes(k));
  if (!good.length) return;
  const tr = good[Math.floor(rnd(g) * good.length) % good.length], bad = x.tr.find(isBad);
  if (bad) x.tr = x.tr.map(k => k === bad ? tr : k);
  else if (x.tr.length < GEN.maxTraits) x.tr = [...x.tr, tr];
  else return;
  emit(g, { k: 'general', faction: h.owner, kind: 'star', name: x.name, army: h.id, tr, lost: bad });
}

/** Game time at which power `f` gets its next general (a replacement, or the next war year), or null. */
export function nextGeneral(g: GameState, f: number): { at: number; why: 'year' | 'back' } | null {
  const G = g.factions[f]?.gen; if (!G) return null;
  const y = dateOf(g.day).y, ny = g.time + (dayOf(y + 1, 1, 1) - g.day) / 7 * TICK_SECONDS;
  const back = G.due.length ? Math.min(...G.due) : Infinity;
  return back < ny ? { at: back, why: 'back' } : { at: ny, why: 'year' };
}

/** Every step: new war years, replacements arriving. */
export function stepGenerals(g: GameState) {
  for (const F of g.factions) {
    if (!F.alive) continue;
    const G = generals(g, F.id), y = dateOf(g.day).y;
    if (G.y === undefined) G.y = y;
    else if (y > G.y) { G.y = y; add(g, F.id, 'year'); }
    if (G.due.length && G.due.some(t => t <= g.time)) {
      const now = G.due.filter(t => t <= g.time); G.due = G.due.filter(t => t > g.time);
      for (let i = 0; i < now.length; i++) { const x = drawGeneral(g, F.id); G.pool.push(x); emit(g, { k: 'general', faction: F.id, kind: 'new', why: 'back', name: x.name }); }
    }
  }
}
