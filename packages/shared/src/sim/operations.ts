// Operations (design-play §3.3): a commander on the Attack mandate does not ask "may I attack?" but offers a plan – objective,
// forces, barrage, the odds and the cost – which the player approves (with more corps if he likes), postpones or denies.
// Once approved, the army gathers its corps, fires the barrage and goes in by itself, through the usual attack phases; the
// player can still work the battle's levers at any moment. When the fighting at the objective is over, a result card compares
// plan and outcome, and the general wins or loses a star. Computer powers plan their offensives through the same code.
import { BARRAGE, FORMATION, SHELLS, TICK_SECONDS, UT, groundUnits } from '../data/units';
import { emit } from './core';
import { paceOf } from './battle';
import { setOrder } from './commands';
import { corpsById, corpsSize } from './posts';
import { cmdMove, transferCandidate } from './commanders';
import { adjustStars } from './generals';
import type { Corps, GameState, Hq, OpPlan, OpResult, Order, Req } from './types';

export const OP = {
  /** Weeks the army waits for extra corps before it goes in with what has arrived. */
  gatherWeeks: 2,
  /** Weeks after the corps were sent in without a battle starting before the operation is called off. */
  startWeeks: 3,
  /** Weeks of fighting after which the operation is judged as it stands. */
  fightWeeks: 10,
  /** Most extra corps a plan asks for; the odds the extra corps aim for. */
  moreMax: 3, aim: .7,
  /** Ratio at which the odds are even, and how steeply they rise. Calibrated on computer wars: the ratio a commander sees
   *  through the fog predicts the outcome only loosely (reserves march in, estimates are rough), so the curve is flat. */
  even: 3, steep: 1.2,
  /** Share of the attackers' men lost: a base, and a part that shrinks with the ratio. */
  lossBase: .25, lossRatio: .6,
  /** Weeks a postponed plan rests. */
  laterWeeks: 1,
  /** Results kept. */
  keep: 30,
} as const;

/** Code names: from myth, so they read the same in every language. */
const NAMES = ['Achilles', 'Ajax', 'Hector', 'Mars', 'Vulcan', 'Neptune', 'Orion', 'Pegasus', 'Hydra', 'Titan', 'Atlas', 'Jupiter', 'Minerva', 'Hercules', 'Perseus', 'Theseus', 'Castor', 'Pollux', 'Janus', 'Saturn', 'Apollo', 'Diana', 'Odin', 'Thor', 'Siegfried', 'Roland', 'Hannibal', 'Scipio', 'Leonidas', 'Spartacus'];
export const opName = (g: GameState, f: number, n: number) => NAMES[(g.seed + f * 7 + n * 11) % NAMES.length];

/** Odds of success at a strength ratio (ours to theirs). */
export const opOdds = (ratio: number) => ratio <= 0 ? 0 : Math.max(.03, Math.min(.97, 1 / (1 + (OP.even / ratio) ** OP.steep)));
/** Ratio at which the odds reach `p`. */
const ratioFor = (p: number) => OP.even / ((1 - p) / p) ** (1 / OP.steep);

/** The enemy battalions in a whole region as power `V`'s view knows them (a report, an estimate, or what is seen). */
export function regionStrength(V: GameState, rid: number): number {
  const r = V.regions[rid];
  if (r.est && (r.vis ?? 3) < 2) return (r.est[0] + r.est[1]) / 2 / FORMATION.inf.men;
  return groundUnits(r.units);
}

/** The plan for an offensive over border `sector` of region `region` with corps `going`, against `their` battalions on that
 *  border at `ratio`. To take the region the attack must also beat what stands behind the border: `whole` is the enemy's
 *  strength in the whole region, and the odds use the ratio against that. */
export function planOp(g: GameState, h: Hq, region: number, sector: number, going: Corps[], their: [number, number], ratio: number, whole?: number): OpPlan {
  const f = h.owner, btl = going.reduce((n, c) => n + corpsSize(c), 0), guns = going.reduce((n, c) => n + c.u.art, 0);
  const border = (their[0] + their[1]) / 2;
  if (whole !== undefined && whole > border && border > 0) ratio = ratio * border / whole;
  else if (whole !== undefined && border <= 0 && whole > 0) ratio = Math.min(ratio || btl / whole, btl / whole);
  const P = paceOf(g), shells = Math.round(guns * P.go / (UT.art.rof * P.rof) * SHELLS.shot * BARRAGE.heavy);
  const heavy = (g.factions[f]?.shells ?? 0) >= shells;
  // an attack that fails costs most of the men who go in; a crushing one few (calibrated on computer wars)
  const loss = Math.round(btl * FORMATION.inf.men * Math.min(1, OP.lossBase + OP.lossRatio / Math.max(.5, ratio)) / 10) * 10;
  // the player's free corps that would raise the odds towards OP.aim
  let more = 0, moreBtl = 0;
  if (!g.factions[f]?.ai && ratio > 0 && opOdds(ratio) < OP.aim && btl > 0) {
    const need = Math.ceil(btl * (ratioFor(OP.aim) / ratio - 1)), seen = new Set<number>();
    const q = { region, sector } as Req;
    for (let i = 0; i < OP.moreMax && moreBtl < need; i++) {
      const c = freeCorps(g, f, q, seen); if (!c) break;
      seen.add(c.id); more++; moreBtl += corpsSize(c);
    }
  }
  const pMore = btl ? opOdds(ratio * (btl + moreBtl) / btl) : 0;
  return { p: opOdds(ratio), r: Math.round(ratio * 100) / 100, loss, shells: heavy ? shells : Math.round(shells / BARRAGE.heavy), days: Math.round(P.go / TICK_SECONDS * 7), heavy, btl, their, more, moreBtl, pMore };
}

/** The nearest corps under the player's own orders, not yet counted in `seen`. */
function freeCorps(g: GameState, f: number, q: Req, seen: Set<number>): Corps | null {
  const hide: Corps[] = [];
  try {
    for (let i = 0; i < 12; i++) {
      const t = transferCandidate(g, f, q); if (!t) return null;
      if (!seen.has(t.c.id)) return t.c;
      // look past corps already counted: take them out of the running for a moment
      t.c.man = false; hide.push(t.c);
    }
    return null;
  } finally { for (const c of hide) c.man = true; }
}

/** The player approved a plan (`more`: with the extra corps it asks for). */
export function approveOp(g: GameState, f: number, h: Hq, q: Req, more: boolean): string | null {
  if (h.op) return 'This army is already carrying out an operation.';
  if (!q.op || q.corps === undefined) return 'That plan is no longer open.';
  const r = g.regions[q.region], corps = (q.corps ?? []).filter(id => { const c = corpsById(r, id); return c && c.p === q.sector; });
  if (!corps.length) return 'Those corps are no longer on that border.';
  let gather = false;
  if (more) for (let i = 0; i < q.op.more; i++) {
    const t = transferCandidate(g, f, q); if (!t) break;
    t.c.army = h.id; t.c.man = undefined;
    if (!cmdMove(g, t.r, t.c, q.region, q.sector)) { t.c.army = undefined; t.c.man = true; break; }
    corps.push(t.c.id); gather = true;
  }
  h.op = { id: g.nextId++, name: q.name ?? opName(g, f, h.n), target: q.sector, region: q.region, sector: q.sector, corps, plan: q.op, status: gather ? 'gather' : 'go', at: g.time, until: g.time + OP.gatherWeeks * TICK_SECONDS, rep: g.nextId };
  emit(g, { k: 'op', faction: f, army: h.id, name: h.op.name, what: 'approved', region: q.sector });
  if (!gather) return goIn(g, h);
  return null;
}

/** Send the operation's corps in: they assemble on the border and attack to invade. */
function goIn(g: GameState, h: Hq): string | null {
  const op = h.op!, r = g.regions[op.region];
  let ok = 0, err: string | null = null;
  for (const id of op.corps) { const c = corpsById(r, id); if (!c || c.p !== op.sector || r.owner !== h.owner) continue; const e = setOrder(g, h.owner, op.region, op.sector, 2 as Order, false, undefined, id); if (e) err ??= e; else ok++; }
  if (!ok) { finish(g, h, true); return err ?? 'Those corps are no longer on that border.'; }
  op.status = 'go'; op.t0 = g.time;
  emit(g, { k: 'op', faction: h.owner, army: h.id, name: op.name, what: 'begins', region: op.target });
  return null;
}

/** The commander's look at his operation: gather, start the barrage, watch the battle, judge it. */
export function stepOp(g: GameState, h: Hq) {
  const op = h.op; if (!op) return;
  const f = h.owner, r = g.regions[op.region];
  if (r.owner !== f) { finish(g, h, true); return; }
  if (op.status === 'gather') {
    const here = op.corps.filter(id => { const c = corpsById(r, id); return c && c.p === op.sector; });
    if (here.length === op.corps.length || g.time >= op.until) goIn(g, h);
    return;
  }
  const live = g.battles.find(b => !b.ended && b.region === op.target && b.attacker === f && b.id >= op.rep);
  if (op.status === 'go') {
    if (live) {
      op.battle = live.id; op.status = 'fight';
      // the barrage the plan promised (the player can change it on the battle card at any moment)
      live.bar[f] = op.plan.heavy ? 2 : 1;
      return;
    }
    if (g.regions[op.target].owner === f) { finish(g, h, false); return; }
    const waiting = op.corps.some(id => { const c = corpsById(r, id); return c && (c.ord ?? 0) >= 1; }) || g.armies.some(a => a.owner === f && a.to === op.target && a.ct && op.corps.includes(a.ct.id));
    if (!waiting && g.time - (op.t0 ?? op.at) > OP.startWeeks * TICK_SECONDS) finish(g, h, true);
    return;
  }
  if (live) { op.battle = live.id; if (g.time - (op.t0 ?? op.at) < OP.fightWeeks * TICK_SECONDS) return; }
  finish(g, h, false);
}

/** Judge the operation, file its result card, and give or take the general's star. `off`: called off before any battle. */
function finish(g: GameState, h: Hq, off: boolean) {
  const op = h.op!, f = h.owner; h.op = undefined;
  const reps = (g.reports ?? []).filter(x => x.id >= op.rep && x.region === op.target && x.attacker === f);
  const side = reps.map(x => x.sides.find(s => s.f === f)).filter(Boolean);
  const lost = side.reduce((n, s) => n + Object.values(s!.lost).reduce((a, b) => a + b, 0), 0), shells = side.reduce((n, s) => n + s!.shells, 0);
  const taken = g.regions[op.target].owner === f, ok = !off && taken, star: -1 | 0 | 1 = off && !reps.length ? 0 : ok ? 1 : -1;
  if (star) adjustStars(g, h, star);
  const res: OpResult = { id: op.id, owner: f, army: h.id, gen: h.cmd.name, name: op.name, target: op.target, region: op.region, plan: op.plan, ok, taken, lost: Math.round(lost / 10) * 10, shells, day: g.day, star, off: off && !reps.length ? true : undefined };
  (g.ops ??= []).push(res); if (g.ops.length > OP.keep) g.ops.splice(0, g.ops.length - OP.keep);
  emit(g, { k: 'op', faction: f, army: h.id, name: op.name, what: res.off ? 'off' : 'ended', region: op.target, ok, res: res.id });
  // corps left in the attack order stop where they are
  for (const id of op.corps) { const c = corpsById(g.regions[op.region], id); if (c && (c.ord ?? 0) >= 1 && !g.battles.some(b => !b.ended && b.region === op.target && b.attacker === f)) c.ord = 0; }
}

/** Corps tied to the army's operation (the commander does not shift them elsewhere). */
export const inOp = (h: Hq, id: number) => !!h.op?.corps.includes(id);
