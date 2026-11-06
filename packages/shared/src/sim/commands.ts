// Player commands. Every mutation a player can cause goes through applyCommand, which validates it.
// The same function runs on the host (or a future dedicated server) for humans and AI alike.
import {
  AIR_RANGE, COST, DT, FORMATION, GROUND_TYPES, MAX_SAND, MAX_TRENCH, MAX_WIRE, SLOT_USE, TRENCH_COST, UNIT_TYPES, UT, emptyUnits, groundUnits, isDef, isWork,
  type FortKind, type UnitType,
} from '../data/units';
import { HW, wrapDx } from '../world/build';
import { MARCH_MIN, MARCH_SPEED, addForce, approachSector, emit, frontsOf, hops, mkArmy, offensives, rnd, slotsMax, slotsUsed, takeForce, world, worksAt, worksFor } from './core';
import { joinBattle, launch, startAssault, startBattle, transferAgents } from './battle';
import { charge, mobilise, produce, reinforce, setBarrage, setEcon, setStance, withdraw } from './levers';
import { LEVY_COST, countRecruit, train } from './supply';
import { callPause, votePause } from './vote';
import { buildCostOf, unitCost, unitName } from './rules';
import { nationOf } from '../data/nations';
import { mountainRegion } from '../data/terrain';
import { buildRail, cutRails, hasRail, marchFactor, railOpen, weatherMarch } from './rails';
import { activeSpies } from './fog';
import { chooseDoctrine, hasDoc, rush, techOn } from './tech';
import { answer, atPeace, cancel, offer, treatyCheck, turnBack } from './diplomacy';
import { decoy, decoyArrives, raid } from './levers';
import { PHRASES } from './types';
import { techDayFor, type TechKey } from '../data/tech';
import { monthStr } from '../data/calendar';
import { bombedNow } from './economy';
import { recordIntel, MAX_SPIES } from './fog';
import { ASSEMBLE, CORPS_CAP, UNREG, addToGroup, armyNo, autoDeploy, column, columnArrives, corpsAtPost, corpsById, corpsPosts, corpsSize, depotOf, fixPosts, formTime, groupUnits, landRoute, mainOf, moveK, postUnits, renumber, routeColumn, setAttackCheck, tagOf, takeCorps, takeDepot, takeGroup } from './posts';
import { allied } from './diplomacy';
import { buildPort, buildShip, coastal, dock, landing, shipTroops, station } from './navy';
import { breakOff } from './naval';
import { assignArmy, disband, formArmyHq, hqOf, relieve, reply, setArmy } from './commanders';
import { carrierAir, embarkAir, landOnCarrier } from './carrier';
import { isCoast } from '../world/zones';
import { SHIP_KINDS } from '../data/sea';
import type { Army, Battle, BuildKind, Command, GameState, Order, RegionState, Stance } from './types';
import type { Units } from '../data/units';

/** The front of a region the owner's fresh troops should go to: the one facing `from` if there is one, else the most hard-pressed. */
export function frontFor(g: GameState, r: RegionState, f: number, from = -2): Battle | null {
  const fr = frontsOf(g, r.id).filter(b => b.def === f || b.sides.includes(f));
  if (!fr.length) return null;
  const facing = fr.find(b => b.from === from); if (facing) return facing;
  let best = fr[0], bs = Infinity;
  for (const b of fr) {
    let mine = 0, foe = 0;
    for (const a of b.agents) if (!a.dead && !a.out) { const p = isDef(a.type) ? DT[a.type].power : UT[a.type as UnitType].power; if (a.f === f) mine += p; else foe += p; }
    const s = mine / (foe + .5); if (s < bs) { bs = s; best = b; }
  }
  return best;
}

export function addUnits(g: GameState, r: RegionState, type: UnitType, n: number) {
  const b = frontFor(g, r, r.owner);
  if (b && b.def === r.owner && !b.goal) { const u = emptyUnits(); u[type] = n; joinBattle(g, b, r.owner, u, null, true, r.id, undefined, r.mor); }
  else addForce(r.units, r.men, type, n);
}

const contestedMsg = (r: RegionState) => `Enemy holdouts still fight in ${world().regions[r.id].name}. Storm them first.`;
const cutMsg = (r: RegionState) => `${world().regions[r.id].name} is cut off from supply. Reopen a route through your own regions to your capital, a factory or your home territory first.`;

/** "Tanks arrive in Sep 1916." */
export const locked = (g: GameState, fid: number, k: TechKey, what: string) => `${what} are not available yet: they arrive in ${monthStr(techDayFor(fid, k, g.factions[fid]?.rushed))}. A rush brings them six months forward.`;

/** Is a region under attack (a battle on its soil it defends)? Only then may it raise emergency levies. */
export const underAttack = (g: GameState, r: RegionState) => !!frontFor(g, r, r.owner) && frontsOf(g, r.id).some(b => b.def === r.owner && !b.ended);

/**
 * Recruit one battalion. It costs Production and men at once and trains for a week (to the next convoy with barracks); `now`
 * raises it at once at double cost, only in a region under attack. `o.p`/`o.army`: a commander's recruits for one border.
 */
export function recruit(g: GameState, fid: number, r: RegionState, type: UnitType, now = false, o: { p?: number; army?: number } = {}): string | null {
  const f = g.factions[fid], c = unitCost(g, fid, type) * (now ? LEVY_COST : 1), men = FORMATION[type].men;
  if (r.owner !== fid) return 'You can only recruit in your own regions.';
  if (r.contested >= 0) return contestedMsg(r);
  if (r.cut) return cutMsg(r);
  if (r.strike) return `The workers of ${world().regions[r.id].name} are on strike. No recruits until the unrest eases.`;
  if (now && !underAttack(g, r)) return 'Emergency levies are raised only in a region under attack.';
  if ((f.men ?? 0) < men) return `The manpower pool is empty: a ${FORMATION[type].one} needs ${men} men and ${Math.floor(f.men ?? 0)} are left. Raise conscription, or wait for the next age class.`;
  if (type === 'tank' && !techOn(g, fid, 'tank')) return locked(g, fid, 'tank', 'Tanks');
  if (type === 'plane' && !techOn(g, fid, 'air')) return locked(g, fid, 'air', 'Aircraft');
  if (type === 'tank' && !r.factory) return 'Tanks need a factory in this region.';
  if (type === 'tank' && bombedNow(g, r)) return 'The factory here was bombed. No tanks until it is repaired.';
  if (type === 'plane' && !r.airfield) return 'Aircraft need an airfield in this region.';
  if (f.supply < c) return `Not enough Production: a ${unitName(g, fid, type).toLowerCase()} costs ${c}${now ? ' as an emergency levy' : ''}.`;
  f.supply -= c; f.men -= men; countRecruit(f, men);
  if (now) addUnits(g, r, type, 1); else train(g, r, type, o);
  return null;
}

export function build(g: GameState, fid: number, r: RegionState, kind: BuildKind): string | null {
  const f = g.factions[fid];
  if (r.owner !== fid) return 'You can only build in your own regions.';
  if (r.contested >= 0) return contestedMsg(r);
  if (kind === 'port') return buildPort(g, fid, r);
  if (r[kind]) return 'Already built.';
  if (kind === 'airfield' && !techOn(g, fid, 'air')) return locked(g, fid, 'air', 'Airfields');
  const c = buildCostOf(fid, kind);
  if (f.supply < c) return `Not enough Production: this costs ${c}.`;
  f.supply -= c; r[kind] = true;
  return null;
}

/** Cost of the next step of a field work or defence on a sector, or null if it is at its limit. */
export function fortCost(r: RegionState, kind: FortKind, sector: number, g?: GameState): number | null {
  const w = worksAt(r, sector);
  if (kind === 'trench' && w.tr >= MAX_TRENCH) return null;
  if (kind === 'sand' && w.sand >= MAX_SAND) return null;
  if (kind === 'wire' && w.wire >= MAX_WIRE) return null;
  // France's fortress belt: concrete is cheaper at home
  // defence in depth: trenches are cheaper
  const base = kind === 'trench' ? Math.round(TRENCH_COST[w.tr] * (g && hasDoc(g, r.owner, 'depth') ? .7 : 1)) : COST[kind];
  if ((kind === 'bunk' || kind === 'fort') && r.home === r.owner && nationOf(r.owner).flags.fortress) return Math.ceil(base * .75);
  // Austria-Hungary's mountain war: fortifications are cheaper in mountain regions
  if (nationOf(r.owner).flags.mountain && mountainRegion(r.id)) return Math.max(1, Math.round(base * .8));
  return base;
}

/** Place a defence or field work on a border sector (`sector` = neighbouring region id), or a defence in the interior (-1). */
export function fortify(g: GameState, fid: number, r: RegionState, kind: FortKind, sector: number, mult = 1): string | null {
  const f = g.factions[fid], W = world();
  if (r.owner !== fid) return 'You can only fortify your own regions.';
  if (r.contested >= 0) return contestedMsg(r);
  if (!(kind in DT) && !isWork(kind)) return 'Invalid order.';
  if (sector !== -1 && !W.regions[r.id].sectors.includes(sector)) return 'That border does not belong to this region.';
  if (isWork(kind) && sector < 0) return 'Trenches, sandbags and wire are dug on a border. Pick one.';
  if (kind === 'trench' && worksAt(r, sector).tr >= 1 && !techOn(g, fid, 'trench2')) return locked(g, fid, 'trench2', 'Deeper trenches');
  if (kind === 'trench' && worksAt(r, sector).tr >= 2 && !techOn(g, fid, 'trench3')) return locked(g, fid, 'trench3', 'Trench III systems');
  if (kind === 'bunk' && !techOn(g, fid, 'trench3')) return locked(g, fid, 'trench3', 'Bunkers');
  if (kind === 'flak' && !techOn(g, fid, 'air')) return locked(g, fid, 'air', 'Anti-air guns');
  const c0 = fortCost(r, kind, sector, g), c = c0 === null ? null : mult === 1 ? c0 : Math.max(1, Math.round(c0 * mult));
  if (c === null) return kind === 'trench' ? 'The trench on this border is already at full depth.' : kind === 'sand' ? 'This border already has every sandbag row it can hold.' : 'This border already has every wire belt it can hold.';
  if (kind !== 'trench') {
    const use = SLOT_USE[kind], max = slotsMax(r.id, sector), now = slotsUsed(r, sector);
    if (now + use > max) return `No room: this ${sector < 0 ? 'interior' : 'border'} has ${max} building slots and ${now} are in use${use > 1 ? ' (a bunker needs two)' : ''}.`;
  }
  if (f.supply < c) return `Not enough Production: this costs ${c}.`;
  f.supply -= c;
  if (kind === 'trench') worksFor(r, sector).tr++;
  else if (kind === 'sand') worksFor(r, sector).sand++;
  else if (kind === 'wire') worksFor(r, sector).wire++;
  else r.defs.push({ id: g.nextId++, k: kind, s: sector, hp: DT[kind].hp, f: fid });
  return null;
}

export function capCheck(g: GameState, fid: number, to: number): string | null {
  const cap = g.cfg?.attackCap ?? 0; if (!cap || g.regions[to].owner === fid) return null;
  const now = offensives(g, fid); if (now.has(to) || now.size < cap) return null;
  return `You already run ${now.size} attack${now.size === 1 ? '' : 's'} at once (limit ${cap}). Wait for one to finish.`;
}

/** Seconds after arriving within which marching on counts as a forced march, and after a battle within which troops are tired. */
export const FORCED_MARCH = 45, BATTLE_REST = 60, FATIGUE_MORALE = 15;

/**
 * Form a column of a share of a region's main army marching to a neighbouring region (one formation always stays behind in the
 * region). It ends at `toPost` there (default: the border it comes over when the region is foreign, else the centre).
 * Checks ownership, battle, border and size; the column is already on its way. Returns it or an error text.
 */
export function formArmy(g: GameState, fid: number, fromId: number, toId: number, frac: number, toPost?: number): Army | string {
  const W = world(), A = g.regions[fromId], B = g.regions[toId], WA = W.regions[fromId], WB = W.regions[toId];
  if (!A || !B) return 'Unknown region.';
  if (A.owner !== fid) return 'Select one of your own regions first.';
  if (A.battle >= 0 && !frontsOf(g, A.id).every(b => b.goal)) return `${WA.name} is under attack. Its troops cannot leave.`;
  if (!WA.land.includes(toId)) return WA.seaAdj.includes(toId) ? `${WB.name} lies across the sea from ${WA.name}. Troops cross it by ship.` : `${WB.name} does not border ${WA.name}. Infantry and tanks can only attack across a direct border; aircraft reach two borders.`;
  const tot = groundUnits(A.units); if (tot < 2) return `${WA.name} needs at least 2 ground formations to march. One always stays behind.`;
  const main = mainOf(A);
  let out: { u: Units; m: Units };
  if (B.owner === fid) {
    // a move into your own region takes its share of every idle formation, main army first, then the corps on the borders
    // (corps with attack orders stay); otherwise a region on Auto, with most of its troops on the borders, could hardly move
    const idle = { ...main }, posts = corpsPosts(A).filter(p => corpsAtPost(A, p).every(c => !(c.ord ?? 0)));
    for (const p of posts) { const pu = postUnits(A, p); for (const k of GROUND_TYPES) idle[k] += pu[k]; }
    if (groundUnits(idle) < 1) return `Every formation in ${WA.name} is committed to an attack.`;
    const want = shareOf(idle, frac, groundUnits(idle) >= tot) as Units;
    out = takeGroup(A, -1, 0, want);
    for (const p of posts) {
      const left: Partial<Units> = {}; let any = 0;
      for (const k of GROUND_TYPES) { left[k] = Math.max(0, (want[k] ?? 0) - out.u[k]); any += left[k]!; }
      if (!any) break;
      const t = takeGroup(A, p, 0, left); for (const k of GROUND_TYPES) { out.u[k] += t.u[k]; out.m[k] += t.m[k]; }
    }
    fixPosts(g, A);
  } else {
    if (groundUnits(main) < 1) return `The main army of ${WA.name} is empty: its troops stand on the borders. Move some back to the centre, or give the corps on the border its orders.`;
    out = takeGroup(A, -1, 0, shareOf(main, frac, groundUnits(main) >= tot));
  }
  if (groundUnits(out.u) < 1) return 'No troops to move.';
  const legs = (A.arrT !== undefined && g.time - A.arrT < FORCED_MARCH ? (A.legs ?? 1) : 0) + 1;
  const tired = A.foughtT !== undefined && g.time - A.foughtT < BATTLE_REST;
  return column(g, fid, fromId, -1, toId, toPost ?? (B.owner === fid ? -1 : fromId), out.u, out.m, A.mor, { stance: A.stance ?? 0, legs, tired, gn: armyNo(g, A), gk: 0 });
}

/** Formations to take from a group for a share `frac` (at least one; one stays behind when `keep`). */
function shareOf(src: Units, frac: number, keep: boolean): Partial<Units> {
  frac = Math.max(.05, Math.min(1, frac));
  const n: Partial<Units> = {}; let sent = 0, tot = 0;
  for (const k of GROUND_TYPES) { n[k] = Math.round(src[k] * frac); sent += n[k]!; tot += src[k]; }
  if (keep && sent >= tot) { for (const k of GROUND_TYPES) if (n[k]! > 0) { n[k]!--; sent--; break; } }
  if (sent <= 0) { for (const k of GROUND_TYPES) if (src[k] > 0) { n[k] = 1; break; } }
  return n;
}

/**
 * Quick order. To an own region: a share of the main army marches there. To a foreign region: the troops are called up and form
 * up, march to the border facing it, assemble, and attack with goal `goal` (1 take the first line, 2 invade) — every phase takes
 * its time. If the main army is empty, the corps already on that border gets the order.
 */
export function sendArmy(g: GameState, fid: number, fromId: number, toId: number, frac: number, brk?: boolean, goal: Order = 2, post?: number): string | null {
  const B = g.regions[toId], A = g.regions[fromId], W = world();
  if (!A || !B) return 'Unknown region.';
  if (B.owner === fid || (B.owner >= 0 && allied(g, fid, B.owner))) {
    if (B.owner !== fid) return 'Your troops do not garrison allied regions.';
    // over the sea by transport
    // further inside your own land: march along your own roads and rails
    if (!W.regions[fromId].land.includes(toId) && A.owner === fid && landRoute(g, fid, fromId, toId)) return moveGroup(g, fid, fromId, -1, toId, -1, frac);
    if (!W.regions[fromId].land.includes(toId) && coastal(fromId) && coastal(toId)) return shipTroops(g, fid, fromId, -1, toId, post !== undefined && W.regions[toId].sectors.includes(post) ? post : -1, frac);
    const a = formArmy(g, fid, fromId, toId, frac, post !== undefined && W.regions[toId].sectors.includes(post) ? post : -1); if (typeof a === 'string') return a;
    emit(g, { k: 'march', faction: fid, from: fromId, to: toId, units: groundUnits(a.units) });
    return null;
  }
  if (A.owner !== fid) return 'Select one of your own regions first.';
  const cap = capCheck(g, fid, toId); if (cap) return cap;
  const t = treatyCheck(g, fid, toId, brk); if (t) return t;
  if (goal !== 1 && goal !== 2) goal = 2;
  // over a sea lane: an amphibious assault (landing craft carry the first wave)
  if (W.regions[fromId].seaAdj.includes(toId) && !W.regions[fromId].land.includes(toId)) return landing(g, fid, fromId, toId, frac, goal);
  if (!W.regions[fromId].adj.includes(toId)) return `${W.regions[toId].name} does not border ${W.regions[fromId].name}. Infantry and tanks can only attack across a direct border; aircraft reach two borders. Over the sea, order an assault.`;
  const main = mainOf(A), here = corpsAtPost(A, toId);
  if (groundUnits(main) < 1 || groundUnits(A.units) < 2) {
    if (here.length) return setOrder(g, fid, fromId, toId, goal, false, brk);
    return groundUnits(A.units) < 2 ? `${W.regions[fromId].name} needs at least 2 ground formations to march. One always stays behind.` : `The main army of ${W.regions[fromId].name} is empty.`;
  }
  const keep = groundUnits(main) >= groundUnits(A.units);
  const out = takeGroup(A, -1, 0, shareOf(main, frac, keep));
  // forming up, then the march to the border; the corps there assembles and attacks
  column(g, fid, fromId, -1, fromId, toId, out.u, out.m, A.mor, { wait: formTime(g, A, out.u), ord: goal, stance: A.stance ?? 0, gn: armyNo(g, A), gk: 0 });
  for (const c of here) if ((c.ord ?? 0) === 0) { c.ord = goal; c.ready = Math.max(c.ready ?? 0, g.time + ASSEMBLE * moveK(g)); }
  emit(g, { k: 'march', faction: fid, from: fromId, to: toId, units: groundUnits(out.u) });
  return null;
}

/** Move a share of a group (`post` -1 main army, else a corps) to another post of the region, or through own land to a post of `to`. */
export function moveGroup(g: GameState, fid: number, region: number, post: number, to: number, toPost: number, frac: number): string | null {
  const W = world(), A = g.regions[region], B = g.regions[to];
  if (!A || !B) return 'Unknown region.';
  if (A.owner !== fid) return 'Select one of your own regions first.';
  if (B.owner !== fid) return `${W.regions[to].name} is not yours. To attack, give the corps on its border an order.`;
  if (post >= 0 && !W.regions[region].sectors.includes(post)) return 'That border does not belong to this region.';
  if (toPost >= 0 && !W.regions[to].sectors.includes(toPost)) return `That border does not belong to ${W.regions[to].name}.`;
  if (region === to && post === toPost) return 'The troops are already there.';
  const src = groupUnits(A, post); if (groundUnits(src) < 1) return post < 0 ? `The main army of ${W.regions[region].name} has no ground troops.` : 'There is no corps on that border.';
  const n = shareOf(src, frac, false);
  if (region !== to) {
    const tot = groundUnits(A.units); let sent = 0; for (const k of GROUND_TYPES) sent += n[k] ?? 0;
    if (tot < 2) return `${W.regions[region].name} needs at least 2 ground formations to march. One always stays behind.`;
    if (sent >= tot) for (const k of GROUND_TYPES) if ((n[k] ?? 0) > 0) { n[k]!--; break; }
  }
  const route = region === to ? [] : landRoute(g, fid, region, to);
  // no way over land: by sea, if both are on a coast
  if (!route && coastal(region) && coastal(to)) return shipTroops(g, fid, region, post, to, toPost, frac);
  if (!route) return `No route through your own land leads from ${W.regions[region].name} to ${W.regions[to].name}.`;
  const fb = toPost >= 0 && region === to ? frontsOf(g, region).find(b => b.from === toPost && b.def === fid) : undefined;
  const out = takeGroup(A, post, 0, n); if (groundUnits(out.u) < 1) return 'No troops to move.';
  // a whole corps keeps its identity and is the player's from now on; anything else forms or joins a corps where it arrives
  const ct = out.tag ? { ...out.tag, man: true } : undefined, gk = out.n !== undefined ? 1 : 0, gn = out.n ?? armyNo(g, A), st = out.st ?? A.stance;
  if (region === to) column(g, fid, region, post, region, toPost, out.u, out.m, out.mor, { front: fb?.id, stance: st, gn, gk, ct });
  else {
    const legs = (A.arrT !== undefined && g.time - A.arrT < FORCED_MARCH ? (A.legs ?? 1) : 0) + 1;
    routeColumn(g, fid, region, post, route, toPost, out.u, out.m, out.mor, { stance: st, legs, gn, gk, ct });
  }
  if (!ct) { A.deploy = 1; if (region !== to || toPost >= 0) B.deploy = 1; }
  fixPosts(g, A);
  return null;
}

/** Standing order of the corps on border `post` of `region` (only corps `id` when given): 0 hold, 1 take the first line, 2 invade. */
export function setOrder(g: GameState, fid: number, region: number, post: number, k: Order, now = false, brk?: boolean, id?: number): string | null {
  const W = world(), r = g.regions[region];
  if (!r || r.owner !== fid) return 'Select one of your own regions first.';
  if (!W.regions[region].sectors.includes(post)) return 'That border does not belong to this region.';
  if (k !== 0 && k !== 1 && k !== 2) return 'Invalid order.';
  if (isCoast(post) && k !== 0) return 'A coast corps holds the coast. To attack over the sea, order an amphibious assault from the region.';
  const list = corpsAtPost(r, post).filter(c => id === undefined || c.id === id);
  const foothold = frontsOf(g, post).find(b => b.from === region && b.attacker === fid && b.stage === 3);
  const advance = () => { foothold!.stage = 1; foothold!.stT = foothold!.age; foothold!.goal = 2; emit(g, { k: 'advance', faction: fid, region: post }); };
  if (!list.length) {
    if (foothold && k === 2) { advance(); return null; }
    return id !== undefined ? 'That corps is not on this border.' : 'There is no corps on that border. Move troops there first.';
  }
  if (k === 0) { for (const c of list) { c.ord = 0; c.now = false; c.since = g.time; } return null; }
  const T = g.regions[post];
  if (T.owner === fid || (T.owner >= 0 && allied(g, fid, T.owner))) return `${W.regions[post].name} is not an enemy region.`;
  if (!foothold) { const cap = capCheck(g, fid, post); if (cap) return cap; }
  const t = treatyCheck(g, fid, post, brk); if (t) return t;
  let massing = false;
  for (const c of list) {
    const was = c.ord ?? 0;
    c.ord = k; c.now = now;
    if (was === 0) { c.ready = Math.max(c.ready ?? 0, g.time + ASSEMBLE * moveK(g)); massing = true; }
  }
  if (massing) emit(g, { k: 'massing', faction: fid, region, to: post, owner: T.owner });
  if (foothold && k === 2) advance();
  if (id === undefined) r.deploy = 1;
  return null;
}

// ---------------------------------------------------------------- corps orders

const unitsOf = (n: Partial<Units>): Units => { const u = emptyUnits(); for (const k of GROUND_TYPES) u[k] = Math.max(0, Math.floor(n[k] ?? 0)); return u; };
function ownCorps(g: GameState, fid: number, region: number, id: number) {
  const A = g.regions[region];
  if (!A || A.owner !== fid) return 'Select one of your own regions first.';
  const c = corpsById(A, id); if (!c) return 'That corps is not in this region.';
  return { A, c };
}

/** March a corps to a post of an own region (through own land, or by sea between coasts). It is the player's from then on. */
export function moveCorps(g: GameState, fid: number, region: number, id: number, to: number, toPost: number): string | null {
  const W = world(), o = ownCorps(g, fid, region, id); if (typeof o === 'string') return o;
  const { A, c } = o, B = g.regions[to];
  if (!B) return 'Unknown region.';
  if (B.owner !== fid) return `${W.regions[to].name} is not yours. To attack it, give the corps an attack order.`;
  if (toPost >= 0 && !W.regions[to].sectors.includes(toPost)) return `That border does not belong to ${W.regions[to].name}.`;
  if (region === to && c.p === toPost) return 'The corps is already there.';
  if (region !== to && frontsOf(g, region).some(b => !b.goal)) return `${W.regions[region].name} is under attack. Its troops cannot leave.`;
  let n: Partial<Units> | undefined;
  if (region !== to && corpsSize(c) >= groundUnits(A.units)) {
    // one formation always stays behind in a region
    if (corpsSize(c) < 2) return `${W.regions[region].name} needs at least 2 ground formations to march. One always stays behind.`;
    n = { ...c.u }; for (const k of GROUND_TYPES) if ((n[k] ?? 0) > 0) { n[k]!--; break; }
  }
  const route = region === to ? [] : landRoute(g, fid, region, to);
  if (!route && coastal(region) && coastal(to)) { c.man = true; return shipTroops(g, fid, region, c.p, to, toPost, 1, { cid: id }); }
  if (!route) return `No route through your own land leads from ${W.regions[region].name} to ${W.regions[to].name}.`;
  c.ord = 0; c.now = false;
  const tag = { ...tagOf(c), man: true }, mor = c.mor, st = c.st ?? A.stance, from = c.p;
  const out = takeCorps(A, c, n);
  if (n && corpsSize(c) > 0) renumber(g, A, c);
  const fb = region === to && toPost >= 0 ? frontsOf(g, region).find(b => b.from === toPost && b.def === fid) : undefined;
  if (region === to) column(g, fid, region, from, region, toPost, out.u, out.m, mor, { front: fb?.id, stance: st, ct: tag });
  else {
    const legs = (A.arrT !== undefined && g.time - A.arrT < FORCED_MARCH ? (A.legs ?? 1) : 0) + 1;
    routeColumn(g, fid, region, from, route, toPost, out.u, out.m, mor, { stance: st, legs, ct: tag });
    emit(g, { k: 'march', faction: fid, from: region, to, units: groundUnits(out.u) });
  }
  fixPosts(g, A);
  return null;
}

/** Attack a neighbouring region with a corps: it moves up to the border facing it (unless it stands there), assembles and goes over. */
export function attackCorps(g: GameState, fid: number, region: number, id: number, to: number, goal: Order, now = false, brk?: boolean): string | null {
  const W = world(), o = ownCorps(g, fid, region, id); if (typeof o === 'string') return o;
  const { A, c } = o, T = g.regions[to];
  if (!T) return 'Unknown region.';
  if (T.owner === fid || (T.owner >= 0 && allied(g, fid, T.owner))) return `${W.regions[to].name} is not an enemy region.`;
  if (!W.regions[region].land.includes(to)) return W.regions[region].seaAdj.includes(to) ? `${W.regions[to].name} lies across the sea. Order an amphibious assault from ${W.regions[region].name}.` : `${W.regions[to].name} does not border ${W.regions[region].name}. A corps attacks across a direct border.`;
  if (goal !== 1 && goal !== 2) goal = 2;
  c.man = true;
  if (c.p === to) return setOrder(g, fid, region, to, goal, now, brk, id);
  const cap = capCheck(g, fid, to); if (cap) return cap;
  const t = treatyCheck(g, fid, to, brk); if (t) return t;
  c.ord = 0;
  const tag = tagOf(c), mor = c.mor, st = c.st ?? A.stance, from = c.p, out = takeCorps(A, c);
  column(g, fid, region, from, region, to, out.u, out.m, mor, { ord: goal, now, stance: st, ct: tag });
  emit(g, { k: 'march', faction: fid, from: region, to, units: groundUnits(out.u) });
  return null;
}

/** Split battalions off a corps into a new corps at the same post. */
export function detach(g: GameState, fid: number, region: number, id: number, n: Partial<Units>): string | null {
  const o = ownCorps(g, fid, region, id); if (typeof o === 'string') return o;
  const { A, c } = o, u = unitsOf(n);
  for (const k of GROUND_TYPES) if (u[k] > c.u[k]) return 'The corps does not have that many battalions.';
  const q = groundUnits(u); if (q < 1) return 'Pick the battalions to detach.';
  if (q >= corpsSize(c)) return 'Leave at least one battalion in the corps.';
  if ((c.ord ?? 0) >= 1) return 'The corps is assembling for an attack. Set it to Hold first.';
  c.man = true;
  const mor = c.mor, out = takeCorps(A, c, u);
  addToGroup(g, A, c.p, out.u, out.m, mor, { id: -1, n: 0, man: true, st: c.st, xp: c.xp });
  return null;
}

/** Merge corps `b` into corps `a`: both at the same post, together at most CORPS_CAP battalions. */
export function mergeCorps(g: GameState, fid: number, region: number, a: number, b: number): string | null {
  const o = ownCorps(g, fid, region, a); if (typeof o === 'string') return o;
  const { A, c } = o, d = corpsById(A, b);
  if (!d || d === c) return 'Pick another corps of this region to merge with.';
  if (d.p !== c.p) return 'Both corps must stand at the same post. Move one there first.';
  if (corpsSize(c) + corpsSize(d) > CORPS_CAP) return `A corps holds at most ${CORPS_CAP} battalions.`;
  const mc = groundUnits(c.u), md = groundUnits(d.u);
  c.mor = (c.mor * mc + d.mor * md) / Math.max(1, mc + md);
  c.xp = Math.round(((c.xp ?? 0) * mc + (d.xp ?? 0) * md) / Math.max(1, mc + md)) || undefined;
  for (const k of GROUND_TYPES) { c.u[k] += d.u[k]; c.m[k] += d.m[k]; }
  if ((d.ord ?? 0) > (c.ord ?? 0)) { c.ord = d.ord; c.ready = Math.max(c.ready ?? 0, d.ready ?? 0); }
  c.man = true;
  A.cs = A.cs!.filter(x => x !== d);
  return null;
}

/** Form a new corps at the region centre from battalions of the depot. */
export function formCorps(g: GameState, fid: number, region: number, n: Partial<Units>, into?: number): string | null {
  const A = g.regions[region];
  if (!A || A.owner !== fid) return 'Select one of your own regions first.';
  const u = unitsOf(n), dep = depotOf(A).u, q = groundUnits(u);
  for (const k of GROUND_TYPES) if (u[k] > dep[k]) return 'The depot does not have that many battalions.';
  if (q < 1) return 'Pick the battalions for the new corps.';
  // into an existing corps of the region (design-play §2: trained recruits join a corps)
  if (into !== undefined) {
    const c = corpsById(A, into); if (!c) return 'That corps is not in this region.';
    if ((c.ord ?? 0) >= 1) return 'That corps is moving up to attack.';
    if (corpsSize(c) + q > CORPS_CAP) return `A corps holds at most ${CORPS_CAP} battalions.`;
    const out = takeDepot(A, u);
    addToGroup(g, A, c.p, out.u, out.m, A.mor, { id: c.id, n: c.n, man: c.man, army: c.army });
    return null;
  }
  if (q > CORPS_CAP) return `A corps holds at most ${CORPS_CAP} battalions.`;
  const out = takeDepot(A, u);
  addToGroup(g, A, -1, out.u, out.m, A.mor, { id: -1, n: 0, man: true });
  return null;
}

/** Corps settings: stance, and whether the player commands it (`man` false hands it back to the region's Auto). */
export function corpsSet(g: GameState, fid: number, region: number, id: number, st?: Stance, man?: boolean, refill?: boolean): string | null {
  const o = ownCorps(g, fid, region, id); if (typeof o === 'string') return o;
  const { A, c } = o;
  if (st !== undefined) { if (![0, 1, 2, 3].includes(st)) return 'Invalid order.'; c.st = st; }
  if (refill !== undefined) c.nr = refill ? undefined : true;
  if (man !== undefined) { c.man = man || undefined; if (!man) { fixPosts(g, A); if (A.deploy !== 1) autoDeploy(g, A); } }
  return null;
}

/** Fly aircraft to a region up to AIR_RANGE borders away: strike an enemy, support a battle, or rebase. */
export function sendAir(g: GameState, fid: number, fromId: number, toId: number, frac: number, rail = false, factory = false, brk?: boolean): string | null {
  const W = world(), A = g.regions[fromId], B = g.regions[toId];
  if (!A || !B || fromId === toId) return 'Pick another region as the target.';
  if (A.owner !== fid) return 'Select one of your own regions first.';
  if (A.units.plane < 1) return `No squadrons are based in ${W.regions[fromId].name}.`;
  if (hops(fromId, toId, AIR_RANGE) > AIR_RANGE) return `${W.regions[toId].name} is out of range. Aircraft reach regions up to ${AIR_RANGE} borders away.`;
  if (rail && !techOn(g, fid, 'railAir')) return locked(g, fid, 'railAir', 'Rail strikes');
  if (factory) {
    if (!techOn(g, fid, 'bomb')) return locked(g, fid, 'bomb', 'Bombing raids on factories');
    if (B.owner === fid) return 'Bomb the factories of enemy regions.';
    if (!B.factory) return `There is no factory in ${W.regions[toId].name} that we know of.`;
  }
  if (rail) {
    if (B.owner === fid) return 'Bomb the railways of enemy regions.';
    if (!W.regions[toId].adj.some(n => railOpen(g, toId, n))) return `No working railway runs through ${W.regions[toId].name}.`;
  }
  const cap = capCheck(g, fid, toId); if (cap) return cap;
  const tc = treatyCheck(g, fid, toId, brk); if (tc) return tc;
  const n = Math.max(1, Math.min(A.units.plane, Math.round(A.units.plane * Math.max(.05, Math.min(1, frac)))));
  const men = takeForce(A.units, A.men, 'plane', n);
  const fl = launch(g, fid, fromId, toId, { ...emptyUnits(), plane: n }, false, { ...emptyUnits(), plane: men }); if (rail) fl.strike = 'rail'; else if (factory) fl.strike = 'factory';
  emit(g, { k: 'air', faction: fid, from: fromId, to: toId, units: n });
  return null;
}

/** A cavalry patrol rides over one border and reports the troops there and the defences of that border. */
export function patrol(g: GameState, fid: number, fromId: number, toId: number): string | null {
  const W = world(), A = g.regions[fromId], B = g.regions[toId], f = g.factions[fid];
  if (!A || !B) return 'Unknown region.';
  if (A.owner !== fid) return 'Patrols ride out from your own regions.';
  if (B.owner === fid) return 'That region is already yours.';
  if (!W.regions[fromId].adj.includes(toId)) return `A patrol only reaches across one border. ${W.regions[toId].name} does not border ${W.regions[fromId].name}.`;
  if (f.supply < COST.patrol) return `Not enough Production: a patrol costs ${COST.patrol}.`;
  f.supply -= COST.patrol;
  const a = mkArmy(g, fid, fromId, toId, 4.5, 1.5); a.scout = 'patrol'; a.dur *= weatherMarch(g, fid, toId); g.armies.push(a);
  return null;
}

/** A reconnaissance flight photographs a region up to AIR_RANGE borders away: troops, buildings and every border's defences. */
export function recon(g: GameState, fid: number, fromId: number, toId: number): string | null {
  const W = world(), A = g.regions[fromId], B = g.regions[toId], f = g.factions[fid];
  if (!A || !B || fromId === toId) return 'Pick another region as the target.';
  if (A.owner !== fid) return 'Reconnaissance flights take off from your own airfields.';
  if (!techOn(g, fid, 'air')) return locked(g, fid, 'air', 'Reconnaissance flights');
  if (!A.airfield) return `Reconnaissance flights need an airfield in ${W.regions[fromId].name}.`;
  if (B.owner === fid) return 'That region is already yours.';
  if (hops(fromId, toId, AIR_RANGE) > AIR_RANGE) return `${W.regions[toId].name} is out of range. Aircraft reach regions up to ${AIR_RANGE} borders away.`;
  if (f.supply < COST.recon) return `Not enough Production: a reconnaissance flight costs ${COST.recon}.`;
  f.supply -= COST.recon;
  const a = launch(g, fid, fromId, toId, emptyUnits(), false); a.scout = 'recon';
  return null;
}

/** Send a spy from the capital into any foreign region. Once there, it reports everything until it is caught. */
export function spy(g: GameState, fid: number, toId: number): string | null {
  const W = world(), B = g.regions[toId], f = g.factions[fid];
  if (!B) return 'Unknown region.';
  if (B.owner === fid) return 'Spies work in foreign regions.';
  const cap = g.regions.find(r => r.capitalOf === fid);
  if (!cap || cap.owner !== fid) return 'Spies are trained in your capital, and it has fallen.';
  if (g.spies.filter(s => s.f === fid).length >= MAX_SPIES) return `You already have ${MAX_SPIES} spies in the field.`;
  if (g.spies.some(s => s.f === fid && s.region === toId)) return `A spy of yours already works in ${W.regions[toId].name}.`;
  if (f.supply < COST.spy) return `Not enough Production: a spy costs ${COST.spy}.`;
  f.supply -= COST.spy;
  const A = W.regions[cap.id], T = W.regions[toId], dist = Math.hypot(wrapDx(A.cx, T.cx), T.cz - A.cz);
  g.spies.push({ id: g.nextId++, f: fid, region: toId, eta: g.time + 6 + dist / 4 });
  return null;
}

export function assault(g: GameState, fid: number, r: RegionState): string | null {
  if (r.owner !== fid) return 'You can only storm holdouts in your own regions.';
  if (r.contested < 0) return 'There are no holdouts here.';
  if (r.battle >= 0) return 'A battle is already being fought here.';
  if (groundUnits(r.units) < 1) return 'You need ground troops in the region to storm the holdouts.';
  const cap = g.cfg?.attackCap ?? 0, now = offensives(g, fid);
  if (cap && now.size >= cap) return `You already run ${now.size} attacks at once (limit ${cap}).`;
  startAssault(g, r); // the whole garrison, aircraft included, storms the holdouts
  return null;
}

/** Shift reserves: about a third of the defenders on every other front of the region move to the front of battle `bid`. */
export function shift(g: GameState, fid: number, r: RegionState, bid: number): string | null {
  if (r.owner !== fid) return 'You can only move troops between fronts of your own regions.';
  const b = g.battles.find(x => x.id === bid && x.region === r.id && !x.ended);
  if (!b || b.def !== fid) return 'There is no front of yours to reinforce there.';
  const others = frontsOf(g, r.id).filter(o => o !== b && o.def === fid);
  if (!others.length) return `${world().regions[r.id].name} is attacked on one front only. Every defender is already there.`;
  let moved = 0; for (const o of others) moved += transferAgents(g, o, b, fid, .35);
  if (!moved) return 'The other fronts have no troops to spare.';
  return null;
}

export const armyPos = (a: Army): [number, number] => { let x = a.ax + a.dx * a.t; if (x < -HW) x += 2 * HW; if (x > HW) x -= 2 * HW; return [x, a.az + a.dz * a.t]; };

/** Scouts sent by an Intelligence officer are caught half as often. */
const sharp = (g: GameState, a: Army) => a.hq !== undefined && hqOf(g, a.hq)?.cmd.tr.includes('intel') ? .5 : 1;

/** A patrol or reconnaissance flight reaches its target: it may be caught, otherwise it files its report. */
function scoutArrives(g: GameState, a: Army) {
  const t = g.regions[a.to];
  if (t.owner === a.owner) return;
  if (a.scout === 'patrol') {
    const nest = t.defs.filter(d => d.f === t.owner && d.s === a.from && (d.k === 'pill' || d.k === 'bunk')).length;
    const p = Math.min(.8, .05 + .12 * nest + .1 * worksAt(t, a.from).wire);
    if (rnd(g) < p * sharp(g, a)) { emit(g, { k: 'scoutLost', faction: a.owner, region: t.id, by: 'patrol' }); return; }
    recordIntel(g, a.owner, t.id, a.from);
  } else {
    const flak = t.defs.filter(d => d.f === t.owner && d.k === 'flak').length;
    const p = Math.min(.85, .05 + .2 * flak);
    if (!hasDoc(g, a.owner, 'air') && rnd(g) < p * sharp(g, a)) { emit(g, { k: 'scoutLost', faction: a.owner, region: t.id, by: 'recon' }); return; }
    recordIntel(g, a.owner, t.id);
  }
  emit(g, { k: 'intel', faction: a.owner, region: t.id, by: a.scout! });
}

/** A rail strike reaches its target: anti-air guns may down squadrons; the survivors wreck the region's rail links and fly home. */
function railStrike(g: GameState, a: Army) {
  const t = g.regions[a.to], flak = t.defs.filter(d => d.f === t.owner && d.k === 'flak').length;
  let n = a.units.plane; for (let i = 0; i < a.units.plane; i++) if (rnd(g) < Math.min(.7, .05 + .15 * flak)) n--;
  if (n < a.units.plane) emit(g, { k: 'scoutLost', faction: a.owner, region: t.id, by: 'recon' });
  if (n > 0 && t.owner !== a.owner) {
    if (a.strike === 'factory') { if (t.factory) { t.bombed = g.day + 21; emit(g, { k: 'bombed', faction: a.owner, region: t.id, owner: t.owner }); } }
    else cutRails(g, a.owner, t.id, null, 'air');
  }
  const home = g.regions[a.from].owner === a.owner ? a.from : world().regions[a.to].adj.find(j => g.regions[j].owner === a.owner);
  if (n > 0 && home !== undefined) launch(g, a.owner, a.to, home, { ...emptyUnits(), plane: n }, true, { ...emptyUnits(), plane: Math.round(a.men.plane * n / Math.max(1, a.units.plane)) });
}

/** A working spy cuts one rail link of the region it works in, and is twice as likely to be caught for a while. */
export function sabotage(g: GameState, fid: number, region: number, to: number): string | null {
  const s = activeSpies(g, fid).find(x => x.region === region), W = world();
  if (!s) return `None of your agents works in ${W.regions[region]?.name ?? 'that region'}.`;
  if (!W.regions[region].adj.includes(to) || !hasRail(g, region, to)) return 'No railway runs there.';
  if (!railOpen(g, region, to)) return 'That line is already cut.';
  cutRails(g, fid, region, to, 'spy'); s.hot = g.day + 21;
  return null;
}

export function arrive(g: GameState, a: Army) {
  if (a.scout) { scoutArrives(g, a); return; }
  if (a.strike) { railStrike(g, a); return; }
  if (a.decoy) { decoyArrives(g, a); return; }
  const t = g.regions[a.to], len = Math.hypot(a.dx, a.dz) || 1, dir = { x: -a.dx / len, z: -a.dz / len };
  // fatigue: more than two borders in a row, or straight out of a battle, costs morale when the troops have to fight
  if (!a.air && ((a.legs ?? 1) > 2 || a.tired) && (frontsOf(g, t.id).length || t.owner !== a.owner)) a.mor = Math.max(5, a.mor - FATIGUE_MORALE);
  // reinforcements sent to one front join it directly while it still burns
  if (a.front !== undefined) {
    const fb = g.battles.find(b => b.id === a.front && !b.ended && b.region === a.to);
    if (fb && (fb.def === a.owner ? t.owner === a.owner : fb.sides.includes(a.owner))) { joinBattle(g, fb, a.owner, a.units, dir, fb.def === a.owner, a.to, a.men, a.mor, a.stance, a.ct); return; }
  }
  // ground columns: march on, take up their post, or join a front; only an attack on a foreign region goes on below
  if (a.post !== undefined && !a.air && columnArrives(g, a, bid => {
    const fb = g.battles.find(b => b.id === bid && !b.ended && b.region === a.to);
    if (!fb || !(fb.def === a.owner ? t.owner === a.owner : fb.sides.includes(a.owner))) return false;
    joinBattle(g, fb, a.owner, a.units, dir, fb.def === a.owner, a.to, a.men, a.mor, a.stance, a.ct); return true;
  })) return;
  const sector = approachSector(a.from, a.to);
  if (a.ret) {
    // aircraft back from a carrier sortie land aboard (what does not fit lands ashore)
    if (a.cv !== undefined) { const left = landOnCarrier(g, a); if (left <= 0) return; a.men.plane = Math.round(a.men.plane * left / a.units.plane); a.units.plane = left; }
    // returning aircraft land at home, or join its defence; a lost home means a lost squadron
    if (t.owner !== a.owner) return;
    const b = frontFor(g, t, a.owner);
    if (b) joinBattle(g, b, a.owner, a.units, dir, b.def === a.owner, a.to, a.men); else { t.units.plane += a.units.plane; t.men.plane += a.men.plane; }
    return;
  }
  const fronts = frontsOf(g, t.id);
  if (t.owner === a.owner) {
    const b = frontFor(g, t, a.owner, sector);
    if (b) { joinBattle(g, b, a.owner, a.units, dir, b.def === a.owner, a.air ? a.from : a.to, a.men, a.mor); tagCarrier(b, a); }
    else {
      t.units.plane += a.units.plane; t.men.plane += a.men.plane;
      const ground = { ...a.units, plane: 0 }, gm = { ...a.men, plane: 0 };
      if (groundUnits(ground)) { addToGroup(g, t, -1, ground, gm, a.mor, a.ct); t.arrT = g.time; t.legs = a.legs ?? 1; }
    }
    return;
  }
  // a treaty signed while the troops were on the way: they turn back instead of attacking
  if (atPeace(g, a.owner, t.owner) && g.regions[a.from].owner === a.owner) { turnBack(a); a.t = 0; g.armies.push(a); return; }
  // attacking: join the front over the same border, aircraft support any front, otherwise open a new front
  const same = fronts.find(b => b.from === sector) ?? (a.air ? fronts.find(b => b.sides.includes(a.owner)) ?? fronts[0] : undefined);
  if (same) { joinBattle(g, same, a.owner, a.units, dir, same.def === a.owner, a.air ? a.from : a.to, a.men, a.mor, a.air ? undefined : a.stance, a.ct); tagCarrier(same, a); return; }
  const nb = startBattle(g, t, dir, a.owner, sector, !a.air && a.post !== undefined ? (a.ord || 2) : undefined);
  if (isCoast(sector)) nb.src = a.from;
  if (a.now) nb.unreg = UNREG;
  joinBattle(g, nb, a.owner, a.units, dir, false, a.air ? a.from : a.to, a.men, a.mor, a.air ? undefined : a.stance, a.ct);
  tagCarrier(nb, a);
}
/** Aircraft that flew off a carrier remember it (they fly back to it when they leave the battle). */
function tagCarrier(b: Battle, a: Army) {
  if (a.cv === undefined || !a.air) return;
  let n = a.units.plane; for (let i = b.agents.length - 1; i >= 0 && n > 0; i--) { const x = b.agents[i]; if (x.f === a.owner && x.type === 'plane' && x.cv === undefined) { x.cv = a.cv; n--; } }
}

const FORT_KINDS: FortKind[] = ['trench', 'sand', 'wire', 'pill', 'fort', 'flak', 'bunk'];
const NUM_FIELDS = ['region', 'from', 'to', 'frac', 'n', 'sector', 'battle', 'level', 'id', 'p', 's', 'post', 'toPost', 'k', 'goal', 'mode', 'zone', 'fleet', 'sea', 'ship', 'a', 'b', 'st', 'army', 'req', 'mandate', 'target', 'budget', 'gen'] as const;
/** Commands arrive from the network: every numeric field must be a finite number. */
function validCommand(c: Command): boolean {
  if (!c || typeof c !== 'object' || typeof c.t !== 'string') return false;
  const o = c as unknown as Record<string, unknown>;
  for (const k of NUM_FIELDS) if (k in o && o[k] !== undefined && !(typeof o[k] === 'number' && Number.isFinite(o[k]))) return false;
  for (const k of ['corps', 'front', 'standing'] as const) if (k in o && o[k] !== undefined && !(Array.isArray(o[k]) && (o[k] as unknown[]).length <= 64 && (o[k] as unknown[]).every(v => k === 'standing' ? typeof v === 'string' : typeof v === 'number' && Number.isFinite(v)))) return false;
  if ('u' in o && (typeof o.u !== 'object' || o.u === null || Object.values(o.u as object).some(v => !(typeof v === 'number' && Number.isFinite(v) && v >= 0)))) return false;
  return true;
}

/** Validate and apply a player command. Returns an error message, or null on success. */
export function applyCommand(g: GameState, fid: number, c: Command): string | null {
  if (g.over) return 'The war is over.';
  const f = g.factions[fid]; if (!f || !f.alive) return 'Your power has been destroyed.';
  if (!validCommand(c)) return 'Invalid order.';
  switch (c.t) {
    case 'recruit': {
      const r = g.regions[c.region]; if (!r || !Object.hasOwn(UT, c.unit)) return 'Invalid order.';
      const n = Math.max(1, Math.min(10, Math.floor(c.n ?? 1)));
      for (let i = 0; i < n; i++) { const e = recruit(g, fid, r, c.unit, c.now === true); if (e) return i ? null : e; }
      return null;
    }
    case 'build': { const r = g.regions[c.region]; if (!r || !['factory', 'barracks', 'airfield', 'port'].includes(c.kind)) return 'Invalid order.'; return build(g, fid, r, c.kind); }
    case 'buildShip': {
      const r = g.regions[c.region]; if (!r || !SHIP_KINDS.includes(c.kind)) return 'Invalid order.';
      const n = Math.max(1, Math.min(5, Math.floor(c.n ?? 1)));
      for (let i = 0; i < n; i++) { const e = buildShip(g, fid, r, c.kind); if (e) return i ? null : e; }
      return null;
    }
    case 'ship': return shipTroops(g, fid, c.region, c.post, c.to, c.toPost, c.frac);
    case 'landing': { const cap = capCheck(g, fid, c.to); if (cap) return cap; const t = g.regions[c.to] ? treatyCheck(g, fid, c.to, c.brk) : 'Unknown region.'; if (t) return t; return landing(g, fid, c.from, c.to, c.frac, c.goal === 1 ? 1 : 2, c.zone, c.escort !== false); }
    case 'station': return station(g, fid, c.zone, c.region, c.fleet, c.kind);
    case 'dock': return dock(g, fid, c.fleet);
    case 'breakOff': return breakOff(g, fid, c.sea);
    case 'embarkAir': return embarkAir(g, fid, c.region, c.ship, c.n);
    case 'carrierAir': return carrierAir(g, fid, c.ship, c.to, !!c.rail, !!c.factory, c.brk);
    case 'fortify': { const r = g.regions[c.region]; if (!r || !FORT_KINDS.includes(c.kind)) return 'Invalid order.'; return fortify(g, fid, r, c.kind, c.sector); }
    case 'march': return sendArmy(g, fid, c.from, c.to, c.frac, c.brk, c.goal ?? 2, c.post);
    case 'move': return moveGroup(g, fid, c.region, c.post, c.to, c.toPost, c.frac);
    case 'order': return setOrder(g, fid, c.region, c.post, c.k, !!c.now, c.brk, c.id);
    case 'moveCorps': return moveCorps(g, fid, c.region, c.id, c.to, c.toPost);
    case 'attackCorps': return attackCorps(g, fid, c.region, c.id, c.to, c.goal, !!c.now, c.brk);
    case 'detach': return detach(g, fid, c.region, c.id, c.u);
    case 'merge': return mergeCorps(g, fid, c.region, c.a, c.b);
    case 'form': return formCorps(g, fid, c.region, c.u, c.into);
    case 'pauseCall': return callPause(g, fid);
    case 'pauseVote': return votePause(g, fid, !!c.yes);
    case 'corpsSet': return corpsSet(g, fid, c.region, c.id, c.st, c.man, typeof c.refill === 'boolean' ? c.refill : undefined);
    case 'army': return formArmyHq(g, fid, c.corps, c.front, c.gen);
    case 'armyAssign': return assignArmy(g, fid, c.army, c.corps, !!c.on);
    case 'armySet': return setArmy(g, fid, c.army, c);
    case 'reply': return ['yes', 'recruit', 'transfer', 'deny', 'more', 'later'].includes(c.opt) ? reply(g, fid, c.req, c.opt, c.n) : 'Invalid order.';
    case 'relieve': return relieve(g, fid, c.army, c.gen);
    case 'disband': return disband(g, fid, c.army);
    case 'deploy': { const r = g.regions[c.region]; if (!r || r.owner !== fid) return 'Select one of your own regions first.'; r.deploy = c.mode === 1 ? 1 : undefined; if (r.deploy !== 1) autoDeploy(g, r); return null; }
    case 'air': return sendAir(g, fid, c.from, c.to, c.frac, !!c.rail, !!c.factory, c.brk);
    case 'decoy': return decoy(g, fid, c.from, c.to);
    case 'raid': return raid(g, fid, c.battle);
    case 'offer': return offer(g, fid, c.to, c.kind);
    case 'answer': return answer(g, fid, c.id, c.yes);
    case 'cancel': return cancel(g, fid, c.to);
    case 'say': { if (!(c.p >= 0 && c.p < PHRASES.length) || !(c.to === -1 || (c.to >= 0 && c.to < g.factions.length && c.to !== fid))) return 'Invalid order.'; emit(g, { k: 'say', from: fid, to: c.to, p: c.p }); return null; }
    case 'rush': return rush(g, fid, c.tech);
    case 'doctrine': return chooseDoctrine(g, fid, c.doc);
    case 'rail': return buildRail(g, fid, c.region, c.to);
    case 'sabotage': return sabotage(g, fid, c.region, c.to);
    case 'patrol': return patrol(g, fid, c.from, c.to);
    case 'recon': return recon(g, fid, c.from, c.to);
    case 'spy': return spy(g, fid, c.to);
    case 'shift': { const r = g.regions[c.region]; if (!r) return 'Invalid order.'; return shift(g, fid, r, c.battle); }
    case 'assault': { const r = g.regions[c.region]; if (!r) return 'Invalid order.'; return assault(g, fid, r); }
    case 'barrage': return setBarrage(g, fid, c.battle, c.level);
    case 'charge': return charge(g, fid, c.battle);
    case 'stance': return setStance(g, fid, c.region, c.s, c.battle);
    case 'reinforce': return reinforce(g, fid, c.from, c.battle, c.frac);
    case 'withdraw': return withdraw(g, fid, c.battle);
    case 'produce': return produce(g, fid, c.kind, c.n);
    case 'mobilise': return mobilise(g, fid, c.level);
    case 'econ': return setEcon(g, fid, c.level);
    default: return 'Unknown command.';
  }
}

setAttackCheck(capCheck);
