// Diplomacy (light): ceasefires, non-aggression pacts and alliances, offered and answered live. Breaking one costs war
// weariness and every power's trust. Secret missions stay individual, so allies may still be rivals.
import { FACTIONS } from '../data/factions';
import { emit, rnd } from './core';
import { hasDoc } from './tech';
import type { GameState, Treaty, TreatyKind } from './types';
import { TREATY_NAMES } from './types';

/** Days a ceasefire lasts (ten convoys), the notice to end a pact or alliance (three convoys), seconds an offer stays open. */
export const DIPLO = { cease: 70, notice: 21, offer: 30, breakWW: 10, breakTrust: .3 } as const;

export const treatyOf = (g: GameState, a: number, b: number): Treaty | undefined => (g.treaties ?? []).find(t => (t.a === a && t.b === b) || (t.a === b && t.b === a));
/** Allies share vision and supply lines. */
export const allied = (g: GameState, a: number, b: number) => a === b || treatyOf(g, a, b)?.kind === 'ally';
/** Any treaty forbids attacks between the two. */
export const atPeace = (g: GameState, a: number, b: number) => a !== b && !!treatyOf(g, a, b);

/** Offer a treaty to another power. Computer powers answer at once. */
export function offer(g: GameState, fid: number, to: number, kind: TreatyKind): string | null {
  const T = g.factions[to];
  if (!T || to === fid || !T.alive) return 'There is no one to talk to there.';
  if (!(kind in TREATY_NAMES)) return 'Invalid order.';
  const t = treatyOf(g, fid, to);
  if (t?.kind === kind && t.ends === undefined) return `You already have a ${TREATY_NAMES[kind].toLowerCase()} with ${FACTIONS[to].the}.`;
  if ((g.offers ??= []).some(o => o.from === fid && o.to === to)) return 'Your last offer is still waiting for an answer.';
  const o = { id: g.nextId++, from: fid, to, kind, exp: g.time + DIPLO.offer };
  g.offers.push(o); emit(g, { k: 'offer', id: o.id, from: fid, to, kind });
  if (T.ai) answer(g, to, o.id, aiAccepts(g, to, fid, kind));
  return null;
}

/** Answer an offer made to you. */
export function answer(g: GameState, fid: number, id: number, yes: boolean): string | null {
  const i = (g.offers ?? []).findIndex(o => o.id === id && o.to === fid); if (i < 0) return 'That offer is no longer on the table.';
  const o = g.offers.splice(i, 1)[0];
  if (!yes || !g.factions[o.from]?.alive) { emit(g, { k: 'treaty', a: o.from, b: o.to, kind: o.kind, what: 'declined', by: fid }); return null; }
  sign(g, o.from, o.to, o.kind); return null;
}

function sign(g: GameState, a: number, b: number, kind: TreatyKind) {
  g.treaties = (g.treaties ?? []).filter(t => t !== treatyOf(g, a, b));
  g.treaties.push({ a, b, kind, until: kind === 'cease' ? g.day + DIPLO.cease : undefined });
  emit(g, { k: 'treaty', a, b, kind, what: 'signed' });
  // the guns fall silent between them: attackers pull out, armies on the way turn back
  for (const bt of g.battles) {
    if (bt.ended) continue;
    for (const [x, y] of [[a, b], [b, a]]) if (bt.def === y && bt.sides.includes(x)) stopAttack(g, bt.id, x);
  }
  for (const ar of g.armies) {
    const o = g.regions[ar.to].owner;
    if (!ar.ret && !ar.scout && ((ar.owner === a && o === b) || (ar.owner === b && o === a))) turnBack(ar);
  }
}
let stopAttack = (_g: GameState, _b: number, _f: number) => { /* set by levers to avoid an import cycle */ };
export function setStopAttack(fn: typeof stopAttack) { stopAttack = fn; }
function turnBack(a: GameState['armies'][number]) {
  [a.from, a.to] = [a.to, a.from]; a.ax += a.dx; a.az += a.dz; a.dx = -a.dx; a.dz = -a.dz; a.t = 1 - a.t;
  a.front = undefined; a.strike = undefined;
}

/** Give notice on a pact or alliance: it ends after three convoys. A ceasefire simply runs out. */
export function cancel(g: GameState, fid: number, to: number): string | null {
  const t = treatyOf(g, fid, to); if (!t) return `You have no treaty with ${FACTIONS[to]?.the ?? 'them'}.`;
  if (t.kind === 'cease') return 'A ceasefire cannot be cancelled. It runs out on its own (or you break it by attacking).';
  if (t.ends !== undefined) return 'Notice has already been given.';
  t.ends = g.day + DIPLO.notice; emit(g, { k: 'treaty', a: t.a, b: t.b, kind: t.kind, what: 'notice', by: fid });
  return null;
}

/** Attacking a treaty partner breaks the treaty: war weariness for the breaker, and nobody trusts its word as much. */
export function breakTreaty(g: GameState, breaker: number, other: number) {
  const t = treatyOf(g, breaker, other); if (!t) return;
  g.treaties = g.treaties.filter(x => x !== t);
  const f = g.factions[breaker]; f.ww = Math.min(100, f.ww + DIPLO.breakWW);
  for (const o of g.factions) if (o.id !== breaker) { const tr = (o.trust ??= g.factions.map(() => 1)); tr[breaker] = Math.max(0, (tr[breaker] ?? 1) - DIPLO.breakTrust * (o.id === other ? 2 : 1)); }
  emit(g, { k: 'treaty', a: t.a, b: t.b, kind: t.kind, what: 'broken', by: breaker });
}

/** The check before an attack on another power's region: with a treaty in force it needs `brk` and breaks the treaty. */
export function treatyCheck(g: GameState, fid: number, target: number, brk?: boolean): string | null {
  const o = g.regions[target]?.owner ?? -1; if (o < 0 || o === fid) return null;
  const t = treatyOf(g, fid, o); if (!t) return null;
  if (!brk) return `You have a ${TREATY_NAMES[t.kind].toLowerCase()} with ${FACTIONS[o].the}. Attacking breaks it: war weariness and lost trust. Use "Break treaty" in the region file if you mean it.`;
  breakTreaty(g, fid, o); return null;
}

/** Every step: offers left unanswered lapse. Every convoy: ceasefires run out, notices take effect. */
export function diploStep(g: GameState) {
  if (g.offers?.length) for (let i = g.offers.length - 1; i >= 0; i--) if (g.time >= g.offers[i].exp) { const o = g.offers.splice(i, 1)[0]; emit(g, { k: 'treaty', a: o.from, b: o.to, kind: o.kind, what: 'declined', by: o.to }); }
}
export function diploConvoy(g: GameState) {
  for (const t of [...(g.treaties ?? [])]) {
    const dead = !g.factions[t.a].alive || !g.factions[t.b].alive;
    if (dead || (t.until !== undefined && g.day >= t.until) || (t.ends !== undefined && g.day >= t.ends)) {
      g.treaties = g.treaties.filter(x => x !== t); if (!dead) emit(g, { k: 'treaty', a: t.a, b: t.b, kind: t.kind, what: 'ended' });
    }
  }
}

/** Powers currently fighting `f` (as attacker or defender), with the number of fronts. */
export function enemiesOf(g: GameState, f: number): Map<number, number> {
  const m = new Map<number, number>();
  for (const b of g.battles) {
    if (b.ended) continue;
    if (b.def === f) for (const s of b.sides) { if (s !== f) m.set(s, (m.get(s) ?? 0) + 1); }
    else if (b.sides.includes(f)) m.set(b.def, (m.get(b.def) ?? 0) + 1);
  }
  return m;
}

/** A computer power weighs an offer by its interest: war weariness, other fronts, relative strength, trust, its orders. */
export function aiAccepts(g: GameState, ai: number, from: number, kind: TreatyKind): boolean {
  const f = g.factions[ai], m = f.mission;
  if (m?.type === 'destroy' && m.target === from) return false;
  const regions = (x: number) => g.regions.filter(r => r.owner === x).length;
  const ratio = regions(from) / Math.max(1, regions(ai)), trust = f.trust?.[from] ?? 1, foes = enemiesOf(g, ai);
  const others = [...foes.keys()].filter(x => x !== from).length;
  let s = .3 + f.ww / 100 * 1.5 + .35 * Math.min(2, others) + (ratio > 1.3 ? .3 : 0) - (ratio < .6 ? .4 : 0) - (1 - trust) * 1.5;
  s += (hasDoc(g, from, 'peace') ? .35 : 0) + (hasDoc(g, ai, 'peace') ? .25 : 0);
  if (kind === 'nap') s -= .15;
  if (kind === 'ally') {
    const common = [...foes.keys()].some(x => x !== from && enemiesOf(g, from).has(x));
    s = (common ? .85 : 0) + .1 - (1 - trust) * 1.5 + (ratio > 1 ? .15 : 0) - (ratio > 2 ? .4 : 0) + f.ww / 100 * .5;
  }
  return s + (rnd(g) - .5) * .2 > .9;
}
