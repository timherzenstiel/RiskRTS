// Pause by vote in multiplayer (design-play §2, decided §10): any player may call a pause; when a majority of the human
// players agree, the war stands still for up to a minute. Each power has a few calls per hour of play, and the host can
// switch votes off. Votes run on real seconds (`g.wall`), which the host counts even while the war stands still.
import { emit } from './core';
import type { GameState } from './types';

/** Seconds a call stays open, the longest pause, calls per power per hour of play. */
export const VOTE = { open: 10, pause: 60, calls: 3, hour: 3600 } as const;

/** Human powers still in the war. */
export const humansOf = (g: GameState) => g.factions.filter(f => f.alive && !f.ai).map(f => f.id);
/** Votes need more than half of the humans. */
const needed = (g: GameState) => Math.floor(humansOf(g).length / 2) + 1;
/** Whether the war stands still by vote right now. */
export const votePaused = (g: GameState) => !!g.vote?.on && (g.wall ?? 0) < g.vote.on;
/** Pause calls a power has left in the current hour of play. */
export const callsLeft = (g: GameState, f: number) => VOTE.calls - (g.factions[f]?.pc ?? []).filter(t => t > g.time - VOTE.hour).length;

export function callPause(g: GameState, f: number): string | null {
  if (g.cfg.vote === false) return 'The host has switched pause votes off.';
  const hum = humansOf(g);
  if (!hum.includes(f)) return 'Only players can call a pause.';
  if (hum.length < 2) return 'Pause the game with the speed buttons.';
  if (g.vote) return votePaused(g) ? 'The war already stands still.' : 'A pause vote is already open.';
  if (callsLeft(g, f) <= 0) return `You have used your ${VOTE.calls} pause calls this hour.`;
  const F = g.factions[f]; F.pc = [...(F.pc ?? []).filter(t => t > g.time - VOTE.hour), g.time];
  g.vote = { by: f, yes: [f], no: [], ends: (g.wall ?? 0) + VOTE.open };
  emit(g, { k: 'vote', faction: f, what: 'call' });
  settle(g);
  return null;
}

/** Vote on the open call; during a pause the caller (or a majority) may also end it early with `yes: false`. */
export function votePause(g: GameState, f: number, yes: boolean): string | null {
  const v = g.vote; if (!v) return 'There is no pause vote open.';
  if (!humansOf(g).includes(f)) return 'Only players can vote.';
  if (votePaused(g)) {
    if (yes) return null;
    if (f === v.by || !v.no.includes(f)) { v.no = [...v.no.filter(x => x !== f), f]; if (f === v.by || v.no.length >= needed(g)) end(g, 'over'); }
    return null;
  }
  v.yes = v.yes.filter(x => x !== f); v.no = v.no.filter(x => x !== f);
  (yes ? v.yes : v.no).push(f);
  settle(g);
  return null;
}

function settle(g: GameState) {
  const v = g.vote; if (!v || v.on) return;
  const need = needed(g), hum = humansOf(g);
  v.yes = v.yes.filter(x => hum.includes(x)); v.no = v.no.filter(x => hum.includes(x));
  if (v.yes.length >= need) { v.on = (g.wall ?? 0) + VOTE.pause; v.no = []; emit(g, { k: 'vote', faction: v.by, what: 'carried' }); }
  else if (hum.length - v.no.length < need) end(g, 'refused');
}

function end(g: GameState, what: 'refused' | 'over') { const v = g.vote; if (!v) return; g.vote = undefined; emit(g, { k: 'vote', faction: v.by, what }); }

/** Count real seconds (also while paused) and close calls and pauses that have run out. Called by the host every frame. */
export function voteTick(g: GameState, dt: number) {
  g.wall = (g.wall ?? 0) + dt;
  const v = g.vote; if (!v) return;
  if (g.cfg.vote === false) { end(g, 'over'); return; }
  if (v.on) { if (g.wall >= v.on) end(g, 'over'); return; }
  settle(g);
  if (g.vote && g.wall >= v.ends) end(g, 'refused');
}
