// Computer powers with armies (design-command §6): each stretch of front with several hostile borders gets an army under a
// commander, who deploys its corps, digs in and scouts by himself (standing approvals and a front budget) and files the same
// requests a player gets. The power's "war minister" answers the rest – men, attacks, falling back, corps sent back – by the
// nation's character and what it can afford. The old planner keeps recruiting, building and launching the big offensives.
import { world, offensives, rnd } from './core';
import { hostileBorders } from './balance';
import { attackCap, diffOf } from './economy';
import { isCoast } from '../world/zones';
import { nationOf } from '../data/nations';
import { unitCost } from './rules';
import { capCheck } from './commands';
import { missionWants } from './missions';
import { corpsIn } from './posts';
import { disbandHq, hqOf, newHq, relieve, reply, requestsOf } from './commanders';
import { generals, isBad, stars, takeGeneral } from './generals';
import type { TraitKey } from '../data/commanders';
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

/** How much a general's traits make a computer power want to open an offensive with his army. */
const OFFENSIVE_WILL: Partial<Record<TraitKey, number>> = { off: 2, care: 1.5, meth: .6, caut: .5, def: .7, slow: .7 };
export const offensiveWill = (h: Hq) => h.cmd.tr.reduce((m, t) => m * (OFFENSIVE_WILL[t] ?? 1), 1) * (1 + .15 * stars(h.cmd));

/** Form, update and disband the armies of a computer power; put the Auto corps on their fronts under them. The power has only
 *  so many generals (design-play §3.2): the biggest fronts get them first. */
export function aiArmies(g: GameState, f: FactionState, V: GameState) {
  if (f.away) return; // a player who stepped away keeps his own arrangement
  const mine = (g.hq ?? []).filter(h => h.owner === f.id);
  const fronts = frontsOfPower(V, f.id).filter(x => x.borders >= AI_ARMY.minBorders).slice(0, AI_ARMY.max);
  const used = new Set<Hq>();
  for (const fr of fronts) {
    // the army already holding most of this front, else a new one if a general is free
    let h: Hq | undefined, best = 0;
    for (const x of mine) { if (used.has(x)) continue; const n = x.front.filter(id => fr.regions.includes(id)).length; if (n > best) { best = n; h = x; } }
    if (!h) {
      // an offensive-minded general for the front with the most borders, a steady one elsewhere
      const pool = generals(g, f.id).pool; if (!pool.length) continue;
      const want = used.size === 0 ? (x: typeof pool[0]) => -offensiveWill({ cmd: x } as Hq) : (x: typeof pool[0]) => x.tr.filter(isBad).length - stars(x);
      const x = takeGeneral(g, f.id, [...pool].sort((a, b) => want(a) - want(b))[0].id)!;
      h = newHq(g, f.id, fr.regions, x); h.budget = AI_ARMY.budget; h.standing = [...STANDING]; mine.push(h);
    }
    used.add(h);
    h.front = [...fr.regions];
    // the corps standing on the front's borders (region Auto made them) come under the commander
    for (const id of fr.regions) for (const c of corpsIn(g.regions[id])) if (c.army === undefined && !c.man && (c.ord ?? 0) === 0 && c.p >= 0) c.army = h.id;
    // now and then an offensive on a region the power's orders want
    if (h.mandate !== 2 && rnd(g) < .02 * offensiveWill(h) / (nationOf(f.id).ai.aggr * diffOf(g).margin)) {
      const W = world(), tgt = fr.regions.flatMap(id => W.regions[id].land).find(j => g.regions[j].owner !== f.id && g.regions[j].owner >= 0 && missionWants(g, f, j) && !capCheck(g, f.id, j));
      if (tgt !== undefined) { h.mandate = 2; h.target = tgt; }
    }
    if (h.mandate === 2 && (h.target === undefined || g.regions[h.target].owner === f.id)) { h.mandate = 1; h.target = undefined; }
  }
  // armies whose front has gone quiet hand their corps back to the regions
  for (const h of mine) if (!used.has(h)) disbandHq(g, h);
  // now and then a general with bad traits and no record is relieved, if the home front can bear it and a better man is free
  const P = nationOf(f.id);
  for (const h of mine) {
    if (!used.has(h) || h.shaken !== undefined || stars(h.cmd) >= 1) continue;
    const bad = h.cmd.tr.filter(isBad).length; if (!bad) continue;
    if (f.ww > P.unrest - 20 || rnd(g) > .004 * bad) continue;
    const better = generals(g, f.id).pool.find(x => x.tr.filter(isBad).length < bad);
    relieve(g, f.id, h.id, better?.id);
  }
}

/**
 * The war minister answers the open requests of the power's armies: men while it can afford them (keeping a little for the
 * rest of the war effort), attacks when the odds suit the nation and the power is not already running too many, falling back
 * when the nation is willing to, and corps sent back where a treaty made the border peaceful.
 */
export function warMinister(g: GameState, f: FactionState) {
  const P = nationOf(f.id).ai, cap = attackCap(g, f.id), aggr = P.aggr * diffOf(g).margin;
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
        const want = 1.5 * aggr, odds = q.ratio ?? 0;
        if (room && odds >= want && rnd(g) < .6 && !reply(g, f.id, q.id, 'yes')) attacks++;
        else if (odds < want * .8) reply(g, f.id, q.id, 'deny');
        break;
      }
      // an operation plan: approved when the odds suit the nation and the power is not running too many attacks, else put off
      case 'op': {
        const room = attacks < 2 + (cap ? 0 : 1) && (!cap || attacks < cap), want = Math.min(.6, .35 * aggr);
        if (room && (q.op?.p ?? 0) >= want && !reply(g, f.id, q.id, 'yes')) attacks++;
        else reply(g, f.id, q.id, 'later');
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

/** Who runs a front (design-play §3.1): an army's general, the player corps by corps, or the regions' Auto. */
export type FrontLevel = 'cmd' | 'you' | 'auto';
export interface FrontInfo { regions: number[]; borders: number; level: FrontLevel; hq?: number; manual: number; corps: number }
/** Every front of power `f` with its level: an army covering at least half its regions commands it; else the player if any
 *  corps there is under his own orders or a region is deployed by hand; else Auto. */
export function frontLevels(g: GameState, f: number): FrontInfo[] {
  const armies = (g.hq ?? []).filter(h => h.owner === f);
  return frontsOfPower(g, f).map(fr => {
    let hq: Hq | undefined, n = 0;
    for (const h of armies) { const k = h.front.filter(id => fr.regions.includes(id)).length; if (k > n) { n = k; hq = h; } }
    const cs = fr.regions.flatMap(id => corpsIn(g.regions[id])).filter(c => c.army === undefined);
    const manual = cs.filter(c => c.man).length;
    const level: FrontLevel = hq && n * 2 >= fr.regions.length ? 'cmd' : manual > 0 || fr.regions.some(id => g.regions[id].deploy === 1) ? 'you' : 'auto';
    return { regions: fr.regions, borders: fr.borders, level, hq: level === 'cmd' ? hq!.id : undefined, manual, corps: cs.length };
  });
}
