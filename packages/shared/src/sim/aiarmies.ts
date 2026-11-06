// Computer powers with armies (design-command §6): each stretch of front with several hostile borders gets an army under a
// commander, who deploys its corps, digs in and scouts by himself (standing approvals and a front budget) and files the same
// requests a player gets. The power's "war minister" answers the rest – men, attacks, falling back, corps sent back – by the
// nation's character and what it can afford. The old planner keeps recruiting, building and launching the big offensives.
import { world, offensives, rnd } from './core';
import { hostileBorders } from './balance';
import { isCoast } from '../world/zones';
import { nationOf } from '../data/nations';
import { unitCost } from './rules';
import { capCheck } from './commands';
import { missionWants } from './missions';
import { corpsIn } from './posts';
import { disbandHq, hqOf, newHq, reply, requestsOf } from './commanders';
import type { FactionState, GameState, Hq, ReqKind } from './types';

/** Hostile land borders a front needs to get an army; most armies per power; share of Production the minister spends per look. */
export const AI_ARMY = { minBorders: 3, max: 4, spend: .4, keep: 3, budget: .15 } as const;
const STANDING: ReqKind[] = ['fort', 'recon'];

/** Fronts of a power: groups of own regions with hostile land borders, joined over own land, with their hostile border count. */
export function frontsOfPower(V: GameState, f: number): { regions: number[]; borders: number }[] {
  const W = world(), per = new Map<number, number>();
  for (const b of hostileBorders(V, f)) if (!isCoast(b.sector)) per.set(b.region, (per.get(b.region) ?? 0) + 1);
  const seen = new Set<number>(), out: { regions: number[]; borders: number }[] = [];
  for (const start of [...per.keys()].sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    const comp: number[] = [], q = [start]; seen.add(start);
    for (let h = 0; h < q.length; h++) { const i = q[h]; comp.push(i); for (const j of W.regions[i].land) if (per.has(j) && !seen.has(j)) { seen.add(j); q.push(j); } }
    out.push({ regions: comp.sort((a, b) => a - b), borders: comp.reduce((s, i) => s + (per.get(i) ?? 0), 0) });
  }
  return out.sort((a, b) => b.borders - a.borders);
}

/** Form, update and disband the armies of a computer power; put the Auto corps on their fronts under them. */
export function aiArmies(g: GameState, f: FactionState, V: GameState) {
  if (f.away) return; // a player who stepped away keeps his own arrangement
  const mine = (g.hq ?? []).filter(h => h.owner === f.id);
  const fronts = frontsOfPower(V, f.id).filter(x => x.borders >= AI_ARMY.minBorders).slice(0, AI_ARMY.max);
  const used = new Set<Hq>();
  for (const fr of fronts) {
    // the army already holding most of this front, else a new one
    let h: Hq | undefined, best = 0;
    for (const x of mine) { if (used.has(x)) continue; const n = x.front.filter(id => fr.regions.includes(id)).length; if (n > best) { best = n; h = x; } }
    if (!h) { h = newHq(g, f.id, fr.regions); h.budget = AI_ARMY.budget; h.standing = [...STANDING]; mine.push(h); }
    used.add(h);
    h.front = [...fr.regions];
    // the corps standing on the front's borders (region Auto made them) come under the commander
    for (const id of fr.regions) for (const c of corpsIn(g.regions[id])) if (c.army === undefined && !c.man && (c.ord ?? 0) === 0 && c.p >= 0) c.army = h.id;
    // now and then an offensive on a region the power's orders want
    if (h.mandate !== 2 && rnd(g) < .02 / nationOf(f.id).ai.aggr) {
      const W = world(), tgt = fr.regions.flatMap(id => W.regions[id].land).find(j => g.regions[j].owner !== f.id && g.regions[j].owner >= 0 && missionWants(g, f, j) && !capCheck(g, f.id, j));
      if (tgt !== undefined) { h.mandate = 2; h.target = tgt; }
    }
    if (h.mandate === 2 && (h.target === undefined || g.regions[h.target].owner === f.id)) { h.mandate = 1; h.target = undefined; }
  }
  // armies whose front has gone quiet hand their corps back to the regions
  for (const h of mine) if (!used.has(h)) disbandHq(g, h);
}

/**
 * The war minister answers the open requests of the power's armies: men while it can afford them (keeping a little for the
 * rest of the war effort), attacks when the odds suit the nation and the power is not already running too many, falling back
 * when the nation is willing to, and corps sent back where a treaty made the border peaceful.
 */
export function warMinister(g: GameState, f: FactionState) {
  const P = nationOf(f.id).ai, cap = g.cfg?.attackCap ?? 0;
  let budget = Math.max(0, f.supply - AI_ARMY.keep) * AI_ARMY.spend;
  let attacks = offensives(g, f.id).size;
  for (const q of requestsOf(g, f.id).sort((a, b) => b.urg - a.urg)) {
    if (!hqOf(g, q.army)) continue;
    switch (q.kind) {
      case 'men': {
        const cost = unitCost(g, f.id, 'inf'), n = Math.min(q.n ?? 1, Math.floor(budget / cost), Math.floor((f.men ?? 0) / 100));
        // urgent requests get men; routine ones only when the power is flush
        if (n >= 1 && (q.urg >= 1 || budget > cost * 6) && !reply(g, f.id, q.id, 'recruit', n)) budget -= n * cost;
        break;
      }
      case 'fort': case 'recon':
        if ((q.cost ?? 0) <= budget && !reply(g, f.id, q.id, 'yes')) budget -= q.cost ?? 0;
        break;
      case 'attack': {
        const room = attacks < 2 + (cap ? 0 : 1) && (!cap || attacks < cap);
        const want = 1.5 * P.aggr, odds = q.ratio ?? 0;
        if (room && odds >= want && rnd(g) < .6 && !reply(g, f.id, q.id, 'yes')) attacks++;
        else if (odds < want * .8) reply(g, f.id, q.id, 'deny');
        break;
      }
      case 'fallback':
        if (rnd(g) < .35 + .3 * P.retreat) reply(g, f.id, q.id, 'yes'); else reply(g, f.id, q.id, 'deny');
        break;
      // corps across a new treaty go back to the regions; corps on a safe border stay (Auto would only send them out again)
      case 'release': reply(g, f.id, q.id, q.why === 'peace' ? 'yes' : 'deny'); break;
    }
  }
}
