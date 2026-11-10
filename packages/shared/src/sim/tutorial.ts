// The guided first war (design-play §6): six stages, each with a few objectives checked here, so the game knows when the
// player has done them. The computer powers keep a ceasefire with the player until the first battle (stage 3), which a
// scripted attack on the threatened border opens. The client shows the objective list and hides what is not unlocked yet.
import { emit, hooks, world } from './core';
import { attackCorps, sendArmy } from './commands';
import { corpsIn, dissolve } from './posts';
import { loadRatio } from './supply';
import { atPeace } from './diplomacy';
import type { GameState, Tut } from './types';

/** The stages and their objectives, in order. */
export const TUT_STAGES = [
  { key: 'mobilise', goals: ['corps2', 'post'] },
  { key: 'dig', goals: ['trench'] },
  { key: 'battle', goals: ['hold'] },
  { key: 'handoff', goals: ['army', 'reply'] },
  { key: 'supply', goals: ['mode', 'cap'] },
  { key: 'offensive', goals: ['attack', 'take'] },
] as const;
export const TUT = {
  /** Seed and power of the guided war: France facing Germany. */
  seed: 1914, me: 1, foe: 3,
  /** Weeks after which an objective that depends on the enemy or a commander counts as done anyway. */
  holdWeeks: 8, replyWeeks: 6,
  /** Share of the threatening army's region sent in the scripted first attack. */
  attack: .6,
  /** A ceasefire that lasts until the guided war lifts it. */
  forever: 1e9,
};

/** Corps of a power, standing in its regions or on the march. */
const corpsOf = (g: GameState, f: number) => g.regions.filter(r => r.owner === f).reduce((n, r) => n + (r.cs?.length ?? 0), 0) + g.armies.filter(a => a.owner === f && a.ct).length;
const atBorder = (g: GameState, t: Tut) => (g.regions[t.home].cs ?? []).filter(c => c.p === t.front).length;
/** Field works and defences on the threatened border (a trench, sandbags, wire or a gun nest all count). */
const worksOn = (g: GameState, t: Tut) => { const r = g.regions[t.home], w = r.works[t.front]; return (w ? w.tr + w.sand + w.wire : 0) + r.defs.filter(d => d.s === t.front && d.f === t.me).length; };

/** Set up the guided war in a new game: the threatened border, the ceasefires, the counts objectives compare with. */
export function startTutorial(g: GameState, me = TUT.me, foe = TUT.foe) {
  const W = world();
  const home = g.regions.find(r => r.owner === me && r.capitalOf === me) ?? g.regions.find(r => r.owner === me)!;
  const front = W.regions[home.id].land.find(n => g.regions[n].owner === foe) ?? W.regions[home.id].land.find(n => g.regions[n].owner !== me) ?? -1;
  if (front >= 0) foe = g.regions[front].owner;
  const t: Tut = { me, foe, home: home.id, front, stage: 0, ok: [], t0: g.time, c0: corpsOf(g, me), p0: 0, w0: 0, flags: {} };
  t.p0 = atBorder(g, t); t.w0 = worksOn(g, t);
  g.tut = t;
  for (const F of g.factions) if (F.id !== me && !atPeace(g, me, F.id)) (g.treaties ??= []).push({ a: me, b: F.id, kind: 'cease', until: TUT.forever });
}

/** Lift the ceasefires of the guided war: the computer powers play normally from now on. */
function release(g: GameState, t: Tut) {
  g.treaties = (g.treaties ?? []).filter(x => !(x.kind === 'cease' && x.until === TUT.forever && (x.a === t.me || x.b === t.me)));
}

function enter(g: GameState, t: Tut, stage: number) {
  t.stage = stage; t.ok = []; t.t0 = g.time;
  emit(g, { k: 'tut', stage });
  if (TUT_STAGES[stage]?.key === 'battle') {
    release(g, t);
    // the first attack: the neighbour across the threatened border goes over
    const fr = t.front >= 0 ? g.regions[t.front] : undefined;
    if (fr && fr.owner === t.foe) {
      // the corps on that border go over now; failing that, part of the main army marches
      // (the scripted attack is not held back by the cap on attacks at once)
      let n = 0; const cfg = g.cfg, F = g.factions[t.foe], ai = F.ai;
      g.cfg = { ...cfg, attackCap: 0 }; F.ai = false;
      for (const c of [...corpsIn(fr)].filter(c => c.p === t.home)) if (!attackCorps(g, t.foe, fr.id, c.id, t.home, 1, true)) n++;
      if (!n) {
        // nothing stands on that border: the corps on the region's other borders fall back to the centre and march from there
        if (fr.battle < 0) for (const c of [...corpsIn(fr)]) if (c.p !== t.home && (c.ord ?? 0) === 0) dissolve(fr, c);
        if (!sendArmy(g, t.foe, t.front, t.home, TUT.attack, false, 1)) n++;
      }
      g.cfg = cfg; F.ai = ai;
      t.flags.sent = n;
    }
  }
  if (stage >= TUT_STAGES.length) release(g, t);
}

function done(g: GameState, t: Tut, goal: string): boolean {
  const weeks = (g.time - t.t0) / 20;
  switch (goal) {
    case 'corps2': return corpsOf(g, t.me) >= t.c0 + 1;
    case 'post': return atBorder(g, t) >= t.p0 + 1;
    case 'trench': return worksOn(g, t) > t.w0;
    case 'hold': return !!t.flags.held || weeks >= TUT.holdWeeks;
    case 'army': return (g.hq ?? []).some(h => h.owner === t.me);
    case 'reply': return !!t.flags.reply || ((g.hq ?? []).some(h => h.owner === t.me) && weeks >= TUT.replyWeeks);
    case 'mode': return !!t.flags.supply;
    case 'cap': return g.regions.every(r => r.owner !== t.me || loadRatio(g, r) <= 1);
    case 'attack': return (g.hq ?? []).some(h => h.owner === t.me && h.mandate === 2);
    case 'take': return !!t.flags.taken;
    default: return true;
  }
}

/** Every step: tick off what the player has done, and open the next stage when all of the current one is done. */
export function stepTutorial(g: GameState) {
  const t = g.tut; if (!t || t.stage >= TUT_STAGES.length) return;
  const s = TUT_STAGES[t.stage];
  // objectives stay ticked once done (a corps that moves on later does not undo the lesson)
  s.goals.forEach((k, i) => { if (!t.ok.includes(i) && done(g, t, k)) t.ok.push(i); });
  if (t.ok.length >= s.goals.length) enter(g, t, t.stage + 1);
}

/** Things the player did that the objectives cannot see in the state: opened Supply mode, or skipped the guidance. */
export function tutFlag(g: GameState, fid: number, k: string): string | null {
  const t = g.tut; if (!t || fid !== t.me) return null;
  if (k === 'skip') { release(g, t); t.stage = TUT_STAGES.length; emit(g, { k: 'tut', stage: t.stage }); return null; }
  if (k === 'supply') t.flags.supply = 1;
  return null;
}

hooks.events.push((g, e) => {
  const t = g.tut; if (!t || t.stage >= TUT_STAGES.length) return;
  if (e.k === 'battleEnd' && e.region === t.home && e.prev === t.me) t.flags.held = 1;
  if (e.k === 'battleEnd' && e.winner === t.me && e.prev !== t.me && e.prev >= 0 && TUT_STAGES[t.stage].key === 'offensive') t.flags.taken = 1;
});

/** The player answered a commander's request (commands.ts calls this). */
export function tutReplied(g: GameState, fid: number) { if (g.tut && g.tut.me === fid) g.tut.flags.reply = 1; }
