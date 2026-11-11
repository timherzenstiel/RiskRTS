// The staff of a human power under the simple command (design-simple §3, §8). The player gives each front one order, hold or
// attack a target, and moves troops by region; everything the old interface asked him to run by hand is done here with the
// code the computer powers use: an army with a general on every front, its requests answered, the factories' split between
// Production and shells, and the guns and the whistle in battles.
import { TICK_SECONDS } from '../data/units';
import { world } from './core';
import { levers } from './ai';
import { frontsOfPower } from './aiarmies';
import { disbandHq, newHq, reply, requestsOf } from './commanders';
import { treatyCheck, treatyOf } from './diplomacy';
import { corpsIn } from './posts';
import { STANDING_KINDS, type FactionState, type FrontOrder, type GameState, type Hq } from './types';

/** Share of weekly Production a front's general may spend by himself, and how many fronts get a general at most. */
export const STAFF = { budget: .3, max: 8 } as const;

/** The army holding most of a front, if any. */
function armyOf(g: GameState, f: number, regions: number[], used?: Set<Hq>): Hq | undefined {
  let h: Hq | undefined, best = 0;
  for (const x of g.hq ?? []) { if (x.owner !== f || used?.has(x)) continue; const n = x.front.filter(id => regions.includes(id)).length; if (n > best) { best = n; h = x; } }
  return h;
}

/** One army per front the player has not kept for himself: formed, kept on its front, disbanded when the front is gone. */
export function staffArmies(g: GameState, f: FactionState) {
  const mine = new Set(f.mine ?? []), used = new Set<Hq>();
  const fronts = frontsOfPower(g, f.id).filter(fr => !fr.regions.some(id => mine.has(id))).sort((a, b) => b.borders - a.borders).slice(0, STAFF.max);
  for (const fr of fronts) {
    let h = armyOf(g, f.id, fr.regions, used);
    if (!h) { h = newHq(g, f.id, fr.regions); h.mandate = 0; }
    used.add(h);
    h.front = [...fr.regions]; h.auto = true; h.budget = STAFF.budget / Math.max(1, fronts.length); h.standing = [...STANDING_KINDS];
    // an attack that reached its target, or lost it to someone else's treaty, goes back to holding
    if (h.mandate === 2 && (h.target === undefined || g.regions[h.target].owner === f.id || (g.regions[h.target].owner >= 0 && !!treatyOf(g, f.id, g.regions[h.target].owner)))) { h.mandate = 0; h.target = undefined; }
    if (h.mandate === 1) h.mandate = 0;
  }
  for (const h of (g.hq ?? []).filter(x => x.owner === f.id)) if (!used.has(h)) disbandHq(g, h);
  // the fronts the player kept: only what still is a front stays on the list
  if (f.mine) { const live = new Set(frontsOfPower(g, f.id).flatMap(fr => fr.regions)); f.mine = f.mine.filter(id => live.has(id) && g.regions[id].owner === f.id); if (!f.mine.length) f.mine = undefined; }
}

/** What the generals still ask is answered at once: falling back is theirs to decide, corps go back across a new treaty only. */
function answer(g: GameState, f: FactionState) {
  for (const q of requestsOf(g, f.id)) {
    if (q.kind === 'fallback') reply(g, f.id, q.id, 'yes');
    else if (q.kind === 'release') reply(g, f.id, q.id, q.why === 'peace' ? 'yes' : 'deny');
    else if (q.kind === 'men' && q.urg >= 1 && f.supply >= 4) reply(g, f.id, q.id, 'recruit', 1);
    else if (q.at !== undefined && g.time - q.at > TICK_SECONDS * 2) reply(g, f.id, q.id, 'deny');
  }
}


/** One look of the staff (every few seconds, like a computer power's). */
export function staffThink(g: GameState, f: FactionState) {
  const own = g.regions.filter(r => r.owner === f.id); if (!own.length) return;
  staffArmies(g, f); answer(g, f);
  levers(g, f, own, true);
}

/** Give a front its order. `region` is any region of the front; `target` the region to take for 'attack'. */
export function frontOrder(g: GameState, fid: number, region: number, order: FrontOrder, target?: number): string | null {
  const f = g.factions[fid], W = world();
  if (!g.cfg.staff) return 'Front orders belong to the simple command.';
  const fr = frontsOfPower(g, fid).find(x => x.regions.includes(region));
  if (!fr) return 'That region is not on a front.';
  if (order === 'mine') {
    f.mine = [...new Set([...(f.mine ?? []), ...fr.regions])];
    const h = armyOf(g, fid, fr.regions); if (h) disbandHq(g, h);
    return null;
  }
  if (order === 'attack') {
    const T = target === undefined ? undefined : g.regions[target];
    if (!T || T.owner === fid) return 'Pick an enemy region next to this front.';
    if (!fr.regions.some(id => W.regions[id].land.includes(target!))) return 'That region does not border this front.';
    const e = treatyCheck(g, fid, target!, false); if (e) return e;
  }
  if (f.mine) { f.mine = f.mine.filter(id => !fr.regions.includes(id)); if (!f.mine.length) f.mine = undefined; }
  // a new order hands the general everything on his front again, also what the player had placed on a border by hand
  for (const id of fr.regions) { const r = g.regions[id]; if (r.deploy === 1) r.deploy = 0; for (const c of corpsIn(r)) if (c.man && (c.ord ?? 0) === 0) c.man = undefined; }
  staffArmies(g, f);
  const h = armyOf(g, fid, fr.regions); if (!h) return 'No general is free for that front.';
  if (order === 'attack') { h.mandate = 2; h.target = target; h.op = undefined; } else { h.mandate = 0; h.target = undefined; h.op = undefined; }
  h.next = g.time; h.why = undefined;
  return null;
}

/** The order a front stands under, for its banner. */
export function frontOrderOf(g: GameState, fid: number, region: number): { order: FrontOrder; target?: number; hq?: Hq } {
  if ((g.factions[fid].mine ?? []).includes(region)) return { order: 'mine' };
  const h = (g.hq ?? []).find(x => x.owner === fid && x.front.includes(region));
  return h ? { order: h.mandate === 2 ? 'attack' : 'hold', target: h.mandate === 2 ? h.target : undefined, hq: h } : { order: 'hold' };
}
