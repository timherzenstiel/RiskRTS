// Agent-based auto-battle. Positions are in battle-local units; +x runs along (ax,az), the defenders hold a trench line near x=1.8.
// Every battle is one front: the border sector the attack comes over. A region attacked over two borders fights two battles;
// it falls only when its last front collapses, and troops that break through one front fall on the defenders of another from behind.
// Fixed defences fight where they stand (their border; interior defences and anti-air guns join the first front), field works
// (trench depth, sandbags, barbed wire) belong to the border they were dug on. Formations fight at their strength: a battalion at
// half strength takes the field with half its hit points, and men lost feed casualties, wounded and war weariness.
import { ANTI_AIR, AS, BARRAGE, FORMATION, GROUND_TYPES, MAX_TRENCH, SHELLS, UNIT_TYPES, WIRE_HP, emptyUnits, groundUnits, isDef, totalUnits, type AgentType, type Units, type UnitType } from '../data/units';
import { FACTIONS } from '../data/factions';
import { wrapDx } from '../world/build';
import { consolidate, emit, frontsOf, rnd, updateContested, world, worksAt, worksFor } from './core';
import { CONSOLIDATE, DIG_IN, UNREG, XP_DMG, XP_MAX, addToGroup, armyNo, column, corpsAtPost, corpsIn, depotOf, fixPosts, mainOf, moveK, tagOf, takeCorps, takeDepot } from './posts';
import { checkElim, checkMissions } from './missions';
import { STANCE_DEALT, STANCE_TAKEN, SUPP_SILENCE, combinedMod, crossSpeed, dealtMod, depthBonus, shellMod, wwLossMod, fieldMod, fieldOf, holdMorale, splashMod, stanceIn, statsOf, suppMod, suppSlow, takenMod, wireSlow, type Field } from './rules';
import { hasDoc, techOn } from './tech';
import { flyToCarrier } from './carrier';
import { beachSupplied, bombarding, shipMax, sinkShip } from './navy';
import { isCoast, zoneOfKey } from '../world/zones';
import { nationOf } from '../data/nations';
import { PACES, type Agent, type Army, type Battle, type CorpsTag, type Defence, type Shell, type GameState, type RegionState, type Stance } from './types';

export const trenchX = (z: number) => 1.8 + ((Math.floor((z + 40) / 3)) % 2 ? .6 : -.6);
const FX_CAP = 900;
export const paceOf = (g: GameState) => PACES[g.cfg?.pace ?? 1] ?? PACES[1];
/** Seconds without fresh troops after which a front settles into trench warfare, and when the lull is deepest. */
export const LULL_FROM = 60;
const LULL_FULL = 180, LULL_ROF = .4;
/** Share of the men lost in battle who are wounded and come back. */
export const WOUNDED_SHARE = .3;
/** Morale ceiling for a power at a given war weariness. */
export const moraleCap = (g: GameState, f: number) => 100 + nationOf(f).morale - (g.factions[f]?.ww ?? 0) * .45;

function newBattle(g: GameState, region: number, dir: { x: number; z: number }, attacker: number, def: number, from: number): Battle {
  const r = g.regions[region], w = from >= 0 ? worksAt(r, from) : { tr: 0, sand: 0, wire: 0 };
  return {
    id: g.nextId++, region, ax: dir.x, az: dir.z, agents: [], shells: [], age: 0, ended: false, removeAt: 0, endCheck: .5, sides: [], attacker, def, from,
    tr: w.tr, sand: w.sand, wire: w.wire * WIRE_HP, wire0: w.wire * WIRE_HP, mor: {}, lost: {}, lastJoin: 0,
    bar: {}, st: {}, go: false, supp: {}, ammo: {}, used: {}, lostT: {}, mor0: {}, reach: 99, craters: 0,
  };
}

/**
 * Open a front in `region` against an attack over border sector `from` (a neighbour id, or -1).
 * With a `goal` (phased offensives) the corps of that border and its defences hold the first line; the main army waits in the
 * depth (a region that deploys itself sends half of it to the threatened border). Without one the whole garrison fights at once.
 */
export function startBattle(g: GameState, region: RegionState, dir: { x: number; z: number }, attacker: number, from: number, goal?: number): Battle {
  fixPosts(g, region);
  const others = frontsOf(g, region.id).filter(o => o.def === region.owner);
  const b = newBattle(g, region.id, dir, attacker, region.owner, from);
  if (region.battle < 0) region.battle = b.id;
  g.battles.push(b);
  const first = !others.length;
  if (goal) {
    b.goal = goal; b.stage = 0; b.stT = 0;
    const here = from >= 0 ? corpsAtPost(region, from) : [];
    if (here.length) {
      b.cn = here[0].n;
      // corps that have held their border for a while have dug in deeper
      if (here.some(c => (c.ord ?? 0) === 0 && c.since !== undefined && g.time - c.since >= DIG_IN)) b.tr = Math.min(MAX_TRENCH + 1, b.tr + 1);
      for (const c of here) { const st = c.st ?? region.stance, mor = c.mor, tag = tagOf(c), out = takeCorps(region, c); joinBattle(g, b, region.owner, out.u, dir, true, region.id, out.m, mor, st, tag); }
    }
    // the squadrons of the region scramble to the first front
    if (first && region.units.plane > 0) {
      const u = { ...emptyUnits(), plane: region.units.plane }, m = { ...emptyUnits(), plane: region.men.plane };
      region.units.plane = 0; region.men.plane = 0;
      joinBattle(g, b, region.owner, u, dir, true, region.id, m, region.mor, region.stance);
    }
    fixPosts(g, region);
    // a region that deploys itself sends half of its main army to the threatened border
    if (region.deploy !== 1 && from >= 0) {
      const dep = depotOf(region).u;
      if (groundUnits(dep) > 1) {
        const half: Partial<Units> = {}; for (const k of GROUND_TYPES) half[k] = Math.round(dep[k] * .5);
        const out = takeDepot(region, half);
        if (groundUnits(out.u)) column(g, region.owner, region.id, -1, region.id, from, out.u, out.m, region.mor, { front: b.id, stance: region.stance, gn: armyNo(g, region), gk: 0 });
      }
    }
  } else {
    joinAll(g, b, region, dir, true);
    // a new front draws its share of the defenders from the fronts already burning in this region
    for (const o of others) transferAgents(g, o, b, region.owner, 1 / (others.length + 1));
  }
  // Defences on the attacked sector, and anti-air guns with the first front. Interior defences stand with the first front, or in the
  // depth of a phased attack. Holdouts rise up behind the lines.
  const own = region.defs.filter(d => d.f === region.owner && (d.s === from || (first && (d.k === 'flak' || (d.s < 0 && !goal)))));
  const hold = first ? region.defs.filter(d => d.f === attacker) : [];
  region.defs = region.defs.filter(d => !own.includes(d) && !hold.includes(d));
  placeDefs(b, own, true); placeDefs(b, hold, false);
  for (const [f, list] of [[region.owner, own], [attacker, hold]] as const) { const guns = list.filter(d => d.k === 'fort').length; if (guns) b.ammo[f] = (b.ammo[f] ?? 0) + guns * SHELLS.dump; }
  b.st[region.owner] ??= region.stance ?? 0;
  if (own.length && !b.sides.includes(region.owner)) b.sides.push(region.owner);
  if (hold.length && !b.sides.includes(attacker)) b.sides.push(attacker);
  if (b.mor[region.owner] === undefined) b.mor[region.owner] = region.mor;
  b.mor0[region.owner] ??= b.mor[region.owner];
  emit(g, { k: 'battleStart', region: region.id, attacker, defender: region.owner });
  return b;
}

/**
 * Only the attackers are left on a phased front. Returns true when the battle goes on: the first line is taken (the attackers
 * stop there for a foothold, or consolidate and then push into the depth), or they wait in the captured line.
 */
function stageWon(g: GameState, b: Battle): boolean {
  const st = b.stage ?? 0, r = g.regions[b.region];
  if (st === 1 || st === 3) return true;
  if (st === 2 || r.owner !== b.def) return false;
  // nobody at all left in the region: the attackers simply march in
  if (groundUnits(r.units) <= 0 && !r.defs.some(d => d.f === r.owner && d.s < 0)) return false;
  // the trench of that border is the attackers' now: wire and sandbags are gone, the trench is battered
  if (b.from >= 0) { const w = worksFor(r, b.from); w.tr = Math.max(0, w.tr - 1); w.sand = 0; w.wire = 0; }
  b.tr = 0; b.sand = 0; b.wire = 0; b.wire0 = 0;
  const depth = groundUnits(mainOf(r)) > 0 || r.defs.some(d => d.f === r.owner && d.s < 0);
  if (b.goal !== 1 && !depth) return false; // only corps on other borders are left: the region falls
  b.stage = b.goal === 1 ? 3 : 1; b.stT = b.age;
  emit(g, { k: 'firstLine', faction: b.attacker, def: b.def, region: b.region, from: b.from, hold: b.goal === 1 });
  return true;
}

/** After consolidating the captured first line, the attackers meet the main army and the interior defences in the depth. */
function startDepth(g: GameState, b: Battle) {
  const r = g.regions[b.region];
  b.stage = 2; b.stT = b.age; b.go = false; b.lastJoin = b.age;
  if (r.owner !== b.def) return;
  // the attackers re-form in the captured line, facing open ground
  for (const a of b.agents) if (!a.dead && !a.out && a.f !== b.def && !isDef(a.type) && a.type !== 'plane') {
    const u = alongOf(b, a.x, a.z), to = (a.type === 'art' ? 24 : 18) + rnd(g) * 3; a.x += b.ax * (to - u); a.z += b.az * (to - u); a.trench = false;
  }
  const main = mainOf(r);
  joinCentre(g, b, r);
  const own = r.defs.filter(d => d.f === b.def && d.s < 0);
  r.defs = r.defs.filter(d => !own.includes(d));
  placeDefs(b, own, true);
  if (own.some(d => d.k === 'fort')) b.ammo[b.def] = (b.ammo[b.def] ?? 0) + own.filter(d => d.k === 'fort').length * SHELLS.dump;
  if (!b.sides.includes(b.def) && (own.length || groundUnits(main))) b.sides.push(b.def);
  emit(g, { k: 'depth', faction: b.attacker, def: b.def, region: b.region });
}

/** The owner of a contested region storms the holdouts with the region's garrison. */
export function startAssault(g: GameState, region: RegionState): Battle {
  fixPosts(g, region);
  const W = world(), h = region.contested, me = region.owner, wr = W.regions[region.id];
  const hold = region.defs.filter(d => d.f === h), sector = hold.find(d => d.s >= 0)?.s ?? -1;
  let dir = { x: 1, z: 0 };
  if (sector >= 0) { const n = W.regions[sector], dx = wrapDx(wr.cx, n.cx), dz = n.cz - wr.cz, l = Math.hypot(dx, dz) || 1; dir = { x: -dx / l, z: -dz / l }; }
  const b = newBattle(g, region.id, dir, me, h, sector); b.tr = 0; b.sand = 0; b.wire = b.wire0 = 0;
  b.sides = [h]; b.mor[h] = 60; b.mor0[h] = 60; b.st[h] = 3;
  region.battle = b.id; g.battles.push(b);
  region.defs = region.defs.filter(d => d.f !== h);
  placeDefs(b, hold, true);
  joinAll(g, b, region, dir, false);
  emit(g, { k: 'battleStart', region: region.id, attacker: me, defender: h });
  return b;
}

/** The whole garrison of a region takes the field: every corps with its identity, then the depot (aircraft included). */
function joinAll(g: GameState, b: Battle, r: RegionState, dir: { x: number; z: number }, def: boolean) {
  const f = r.owner;
  for (const c of [...corpsIn(r)]) { const st = c.st ?? r.stance, mor = c.mor, tag = tagOf(c), out = takeCorps(r, c); joinBattle(g, b, f, out.u, dir, def, r.id, out.m, mor, st, tag); }
  if (totalUnits(r.units) > 0) joinBattle(g, b, f, r.units, dir, def, r.id, r.men, r.mor, r.stance);
  r.units = emptyUnits(); r.men = emptyUnits(); r.cs = undefined;
}
/** The troops at the centre of a region (depot and reserve corps) join a battle there as defenders. */
function joinCentre(g: GameState, b: Battle, r: RegionState) {
  for (const c of corpsAtPost(r, -1)) { const st = c.st ?? r.stance, mor = c.mor, tag = tagOf(c), out = takeCorps(r, c); joinBattle(g, b, b.def, out.u, null, true, r.id, out.m, mor, st, tag); }
  const d = depotOf(r), u = { ...d.u, plane: 0 };
  if (groundUnits(u) > 0) { const out = takeDepot(r, u); joinBattle(g, b, b.def, out.u, null, true, r.id, out.m, r.mor, r.stance); }
}

function placeDefs(b: Battle, defs: Defence[], defending: boolean) {
  const ax = b.ax, az = b.az, px = -az, pz = ax;
  const groups: Record<string, Defence[]> = {};
  for (const d of defs) { const key = !defending ? 'h' : d.s === b.from && d.k !== 'flak' ? 'front' : d.k === 'flak' ? 'aa' : 'in'; (groups[key] ??= []).push(d); }
  for (const [key, list] of Object.entries(groups)) list.forEach((d, i) => {
    const lat = ((i + .5) / list.length - .5) * (key === 'front' ? 20 : 16) + ((d.id * 7919) % 100 / 100 - .5) * 2;
    let along: number;
    if (key === 'h') along = 13 + (d.id % 3);
    else if (key === 'front') along = d.k === 'fort' ? trenchX(lat) - 3 : d.k === 'bunk' ? trenchX(lat) - .4 : trenchX(lat) + 1.4;
    else if (key === 'aa') along = -4.5;
    else along = d.k === 'fort' ? -10 : -6.5;
    b.agents.push({
      f: d.f, type: d.k, x: ax * along + px * lat, z: az * along + pz * lat, hp: d.hp, cd: 0, rt: 0, tgt: -1, dead: false, dieT: 0, fireT: -9,
      face: Math.atan2(ax, az) + (defending ? 0 : Math.PI), phase: 0, moving: false, trench: false, defId: d.id, sector: d.s,
    });
  });
}

/**
 * Put formations on the battlefield. `men` (default: full strength) sets each agent's hit points; `mor` is the morale they bring.
 * `dir` is where attackers come from; pass the reverse of the battle axis for troops breaking in from behind the defenders.
 */
export function joinBattle(g: GameState, b: Battle, f: number, u: Units, dir: { x: number; z: number } | null, def: boolean, home = b.region, men?: Units, mor = 75, stance?: Stance, tag?: CorpsTag) {
  if (!b.sides.includes(f)) b.sides.push(f);
  if (tag) (b.ct ??= {})[tag.id] = tag;
  if (stance !== undefined || b.st[f] === undefined) b.st[f] = stance ?? b.st[f] ?? 0;
  if (u.art) b.ammo[f] = (b.ammo[f] ?? 0) + u.art * SHELLS.dump;
  const a = def ? { x: b.ax, z: b.az } : (dir || { x: b.ax, z: b.az }), p = { x: -a.z, z: a.x }, P = paceOf(g);
  let n0 = 0, n1 = 0;
  for (const x of b.agents) if (x.f === f && !x.dead && !x.out && !isDef(x.type)) n0++;
  for (const k of UNIT_TYPES) {
    const frac = men && u[k] > 0 ? Math.max(.08, Math.min(1, men[k] / (u[k] * FORMATION[k].men))) : 1;
    for (let n = 0; n < u[k]; n++) {
      let along: number, lat: number;
      if (k === 'plane') { along = def ? -14 - rnd(g) * 4 : 30 + rnd(g) * 6; lat = (rnd(g) - .5) * 24; }
      else if (def) { lat = (rnd(g) - .5) * 26; along = k === 'art' ? -7 - rnd(g) * 2 : (k === 'tank' ? -2 + rnd(g) * 2 : trenchX(lat) + (rnd(g) - .5) * .6); }
      else { along = (k === 'art' ? 26 : 20) + rnd(g) * 4; lat = (rnd(g) - .5) * 22; }
      const s = statsOf(g, f, k);
      const ag: Agent = { f, type: k, x: a.x * along + p.x * lat, z: a.z * along + p.z * lat, hp: s.hp * frac, cd: rnd(g) * s.rof, rt: 0, tgt: -1, dead: false, dieT: 0, fireT: -9, face: Math.atan2(-a.x, -a.z) + (def ? Math.PI : 0), phase: rnd(g) * 6, moving: false, trench: def && (k === 'inf' || k === 'mg'), men: FORMATION[k].men };
      if (k === 'plane') { ag.fuel = P.fuel * (.85 + rnd(g) * .3); ag.home = home; }
      else if (tag) { ag.c = tag.id; if (tag.xp) ag.xp = tag.xp; }
      b.agents.push(ag); n1++;
    }
  }
  if (n1) {
    b.mor[f] = b.mor[f] === undefined || !n0 ? Math.min(mor, moraleCap(g, f)) : (b.mor[f] * n0 + mor * n1) / (n0 + n1);
    b.lastJoin = b.age;
  } else if (b.mor[f] === undefined) b.mor[f] = Math.min(mor, moraleCap(g, f));
  b.mor0[f] ??= b.mor[f];
}

/** Units, men and morale of a faction's ground troops still fighting in a battle. */
export function forceIn(b: Battle, f: number, planes = false, g?: GameState): { u: Units; m: Units; mor: number } {
  const u = emptyUnits(), m = emptyUnits();
  for (const a of b.agents) {
    if (a.dead || a.out || a.f !== f || isDef(a.type) || (a.type === 'plane' && !planes)) continue;
    const k = a.type as UnitType; u[k]++; m[k] += Math.round(Math.max(0, a.hp) / (g ? statsOf(g, f, k) : AS(k)).hp * (a.men ?? FORMATION[k].men));
  }
  return { u, m, mor: b.mor[f] ?? 70 };
}

/** A faction's ground troops still fighting, per corps (key -1: troops in no corps). */
export function forceParts(b: Battle, f: number, g: GameState): Map<number, { u: Units; m: Units }> {
  const out = new Map<number, { u: Units; m: Units }>();
  for (const a of b.agents) {
    if (a.dead || a.out || a.f !== f || isDef(a.type) || a.type === 'plane') continue;
    const key = a.c !== undefined && b.ct?.[a.c] ? a.c : -1;
    let p = out.get(key); if (!p) out.set(key, p = { u: emptyUnits(), m: emptyUnits() });
    const k = a.type as UnitType; p.u[k]++; p.m[k] += Math.round(Math.max(0, a.hp) / statsOf(g, f, k).hp * (a.men ?? FORMATION[k].men));
  }
  return out;
}

/** Pull a share of a faction's ground troops out of battle `src` and put them into `dst` on the same side. */
export function transferAgents(g: GameState, src: Battle, dst: Battle, f: number, frac: number): number {
  const pick = src.agents.filter(a => a.f === f && !a.dead && !a.out && !isDef(a.type) && a.type !== 'plane');
  let n = Math.round(pick.length * frac); if (n >= pick.length) n = pick.length - 1; if (n <= 0) return 0;
  // the reserve leaves from the back: guns and men behind the trench first
  pick.sort((a, b) => (a.x * src.ax + a.z * src.az) - (b.x * src.ax + b.z * src.az));
  const parts = new Map<number, { u: Units; m: Units }>();
  for (const a of pick.slice(0, n)) {
    a.out = true; const k = a.type as UnitType, key = a.c !== undefined && src.ct?.[a.c] ? a.c : -1;
    let p = parts.get(key); if (!p) parts.set(key, p = { u: emptyUnits(), m: emptyUnits() });
    p.u[k]++; p.m[k] += Math.round(a.hp / statsOf(g, f, k).hp * (a.men ?? FORMATION[k].men));
  }
  for (const [key, p] of parts) joinBattle(g, dst, f, p.u, null, dst.def === f, dst.region, p.m, src.mor[f] ?? 70, stanceIn(src, f), key >= 0 ? src.ct![key] : undefined);
  return n;
}

const canTarget = (a: AgentType, o: Agent) => o.type === 'plane' ? ANTI_AIR[a] > 0 : a !== 'flak';

const isGun = (t: AgentType) => t === 'art' || t === 'fort';

function nearestEnemy(b: Battle, a: Agent, gunsOnly = false, maxD = 1e9): number {
  let best = -1, bd = maxD * maxD;
  for (let i = 0; i < b.agents.length; i++) {
    const o = b.agents[i]; if (o.dead || o.out || o.f === a.f || !canTarget(a.type, o)) continue;
    if (gunsOnly && !isGun(o.type)) continue;
    let d = (o.x - a.x) ** 2 + (o.z - a.z) ** 2;
    if (a.type === 'plane' && o.type !== 'plane' && isDef(o.type) && o.type !== 'flak') d *= .6; // bombers go for the concrete
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

const SMALL_ARMS = new Set<AgentType>(['inf', 'mg', 'pill', 'bunk']), HEAVY = new Set<AgentType>(['art', 'plane', 'fort']);
interface Tick { bunker: boolean; fl: Field; both: Record<number, boolean>; creep: boolean }

function damage(g: GameState, b: Battle, t: Agent, dmg: number, src: AgentType, k: Tick, mult: number, sf: number) {
  if (t.dead || t.out) return;
  dmg *= mult * STANCE_DEALT[stanceIn(b, sf)] * dealtMod(g, b, sf, src, t) * takenMod(g, b, t) * fieldMod(g, b, k.fl, sf, src, t) * combinedMod(g, sf, !!k.both[sf]);
  // Gallipoli: Ottoman defenders of a beach fight a quarter harder
  if (sf === b.def && b.amph !== undefined && (b.stage ?? 0) === 0 && nationOf(sf).flags.gallipoli) dmg *= 1.25;
  // creeping barrage: attackers advance behind their shells while the defenders are pinned down
  if (k.creep && t.f !== b.def && hasDoc(g, t.f, 'creeping')) dmg *= .7;
  const ts = stanceIn(b, t.f); dmg *= ts === 2 ? (t.trench || !t.moving ? STANCE_TAKEN[2] : 1) : STANCE_TAKEN[ts];
  if (t.type === 'plane') dmg *= ANTI_AIR[src];
  else if (isDef(t.type)) { if (SMALL_ARMS.has(src)) dmg *= .3; else if (src === 'tank') dmg *= .8; }
  else if (t.type === 'tank' && SMALL_ARMS.has(src)) dmg *= .25;
  if (t.trench && t.f === b.def) {
    const tr = b.tr + depthBonus(g, b.def);
    dmg *= Math.max(.3, .8 - .15 * tr);
    if (b.sand && SMALL_ARMS.has(src)) dmg *= 1 - .15 * b.sand;
    if (k.bunker && HEAVY.has(src)) dmg *= .5;
    // deep dugouts: a barrage pins entrenched men down far more than it kills them
    if (HEAVY.has(src)) dmg *= 1 - .15 * Math.min(3, tr);
  }
  const before = t.hp; t.hp -= dmg;
  if (!isDef(t.type)) {
    const s = statsOf(g, t.f, t.type), lost = (Math.min(before, Math.max(0, before - Math.max(0, t.hp)))) / s.hp * (t.men ?? FORMATION[t.type as UnitType].men);
    b.lost[t.f] = (b.lost[t.f] ?? 0) + lost; const lt = (b.lostT ??= {})[t.f] ??= emptyUnits(); lt[t.type as UnitType] += lost;
  }
  if (t.hp <= 0) { t.dead = true; t.dieT = g.time; if (g.fx && (t.type === 'tank' || isDef(t.type) || t.type === 'plane')) boom(g, b, t.x, t.z, t.type === 'plane' ? .8 : 1.5); }
}
function boom(g: GameState, b: Battle, x: number, z: number, s: number) { if (g.fx && g.fx.length < FX_CAP) g.fx.push({ k: 'boom', b: b.id, x, z, s }); }
const wrapA = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** Accuracy factor from morale (shaken troops shoot badly). */
const morAcc = (b: Battle, f: number) => .55 + .45 * Math.max(0, Math.min(100, b.mor[f] ?? 70)) / 100;
/** Along-axis coordinate of a point (towards the attackers). */
const alongOf = (b: Battle, x: number, z: number) => x * b.ax + z * b.az;
const inWire = (b: Battle, a: Agent) => { const u = alongOf(b, a.x, a.z), lat = a.x * -b.az + a.z * b.ax; const t = trenchX(lat); return u > t + .6 && u < t + 7; };

/** Shells for one shot of a gun of side `f`: from the national stockpile when the side is supplied here, else the local dump. */
export function sideSupplied(g: GameState, b: Battle, f: number) {
  if (f === b.def) { const r = g.regions[b.region]; return r.owner === f && !r.cut; }
  // over a coast the attackers' shells come by sea, unless an enemy holds the zone
  if (isCoast(b.from)) return b.src !== undefined && beachSupplied(g, f, zoneOfKey(b.from), b.src);
  const s = b.from >= 0 ? g.regions[b.from] : null; return !!s && s.owner === f && !s.cut;
}
/** Shells a side has for this battle. */
export const shellsFor = (g: GameState, b: Battle, f: number) => sideSupplied(g, b, f) ? g.factions[f]?.shells ?? 0 : b.ammo?.[f] ?? 0;
function drawShells(g: GameState, b: Battle, f: number, n: number): boolean {
  const fac = g.factions[f]; if (!fac) return false;
  if (sideSupplied(g, b, f)) { if (fac.shells < n) return false; fac.shells -= n; }
  else { if ((b.ammo[f] ?? 0) < n) return false; b.ammo[f] -= n; }
  b.used[f] = (b.used[f] ?? 0) + n; return true;
}
/** Shells one shot costs a side (defending guns fire from prepared stocks at half the rate). */
export const shotCost = (b: Battle, f: number, g?: GameState) => SHELLS.shot * (f === b.def ? .5 : 1) * (g ? (supplyQOf(g, b, f) === 1 ? 1.5 : 1) * shellMod(g, f) : 1);
/** Supply quality of the region a side draws its shells through (thin supply loses half again on the way). */
const supplyQOf = (g: GameState, b: Battle, f: number) => (f === b.def ? g.regions[b.region] : isCoast(b.from) ? (b.src !== undefined ? { supplyQ: 1 } : undefined) : b.from >= 0 ? g.regions[b.from] : undefined)?.supplyQ ?? 2;

/** The attackers leave their start line. */
export function goOverTheTop(g: GameState, b: Battle, f: number) {
  if (b.go) return; b.go = true;
  emit(g, { k: 'overTop', faction: f, region: b.region });
}

/** Seconds until the attackers go over the top on their own (they go at once without guns to prepare the assault). */
export function autoGoIn(g: GameState, b: Battle) { return Math.max(0, paceOf(g).go - (b.age - (b.stT ?? 0))); }

export function stepBattle(g: GameState, b: Battle, dt: number) {
  if (b.ended) return;
  b.age += dt;
  const A = b.agents, P = paceOf(g), fx = g.fx;
  // a captured first line is consolidated before the push into the depth
  if (b.stage === 1 && b.age - (b.stT ?? 0) >= CONSOLIDATE * moveK(g)) startDepth(g, b);
  // Over the top: attackers hold their start line while the guns prepare, then go on order or at the pace's latest time.
  if (!b.go && b.stage !== 1 && b.stage !== 3) {
    let ground = false, guns = false, waitAll = true;
    for (const a of A) if (!a.dead && !a.out && a.f !== b.def && !isDef(a.type)) { if (a.type === 'art') guns = true; else if (a.type !== 'plane') { ground = true; if (stanceIn(b, a.f) !== 2) waitAll = false; } }
    if (ground && (!guns || (b.age - (b.stT ?? 0) > P.go && !waitAll))) goOverTheTop(g, b, b.attacker);
  }
  const dst = stanceIn(b, b.def), charge = dst === 1 ? b.go && b.age > P.charge * .5 : dst === 0 ? b.age > P.charge : false;
  const decay = Math.pow(.5, dt / BARRAGE.half); for (const f in b.supp) b.supp[f] *= decay;
  let reach = b.reach ?? 99;
  const quiet = b.age - (b.lastJoin ?? 0), lull = quiet <= LULL_FROM ? 1 : Math.max(LULL_ROF, 1 - (1 - LULL_ROF) * (quiet - LULL_FROM) / (LULL_FULL - LULL_FROM));
  const rofK = P.rof / lull;
  const both: Record<number, boolean> = {}, tk: Record<number, boolean> = {}, inf: Record<number, boolean> = {};
  for (const a of A) if (!a.dead && !a.out) { if (a.type === 'tank') tk[a.f] = true; else if (a.type === 'inf') inf[a.f] = true; }
  for (const f in tk) if (inf[f]) both[f] = true;
  const k: Tick = { bunker: A.some(a => a.type === 'bunk' && !a.dead && a.f === b.def), fl: fieldOf(g, b), both, creep: (b.supp[b.def] ?? 0) > 50 };
  // a landing: the boats run in over open water, slower and without cover; battleships offshore fire the barrage
  const beach = b.amph !== undefined && (b.stage ?? 0) === 0;
  if (isCoast(b.from) && g.ships?.length) bombard(g, b, dt);
  for (const a of A) {
    if (a.dead || a.out) continue; const s = statsOf(g, a.f, a.type);
    a.cd -= dt; a.rt -= dt;
    if (a.type === 'plane') {
      if (a.home !== b.region || a.cv !== undefined) { a.fuel = (a.fuel ?? 0) - dt; if (a.fuel <= 0) { a.out = true; flyHome(g, b, a.f, a.home ?? b.region, 1, a.cv); continue; } }
      if (a.tgt < 0 || A[a.tgt].dead || A[a.tgt].out || a.rt <= 0) { a.tgt = nearestEnemy(b, a); a.rt = .6 + rnd(g) * .6; }
      let diff = .9;
      if (a.tgt >= 0) { const t = A[a.tgt]; diff = wrapA(Math.atan2(t.x - a.x, t.z - a.z) - a.face); }
      a.face = wrapA(a.face + Math.max(-2.2 * dt, Math.min(2.2 * dt, diff)));
      a.x += Math.sin(a.face) * s.speed * dt; a.z += Math.cos(a.face) * s.speed * dt; a.moving = true; a.phase += dt * 20;
      const R = Math.hypot(a.x, a.z); if (R > 34) { a.x *= 34 / R; a.z *= 34 / R; }
      if (a.tgt >= 0 && a.cd <= 0 && Math.abs(diff) < .5) {
        const t = A[a.tgt], d = Math.hypot(t.x - a.x, t.z - a.z);
        if (d <= s.range) {
          a.cd = s.rof * rofK * (.75 + rnd(g) * .5); a.fireT = g.time;
          if (t.type === 'plane') {
            const hit = rnd(g) < s.acc * morAcc(b, a.f) * (1 - .4 * d / s.range); if (hit) damage(g, b, t, s.dmg * .6, 'plane', k, 1, a.f);
            if (fx && fx.length < FX_CAP) fx.push({ k: 'shot', b: b.id, x0: a.x, z0: a.z, x1: t.x, z1: t.z, type: 'plane', hit, air: true });
          } else b.shells.push({ x: t.x + (rnd(g) - .5) * 1.6, z: t.z + (rnd(g) - .5) * 1.6, time: .45, f: a.f, dmg: s.dmg, sp: (s.splash ?? 2) * splashMod(k.fl), src: 'plane' });
        }
      }
      continue;
    }
    const gun = isGun(a.type), lvl = gun ? b.bar[a.f] ?? 1 : 1;
    if (a.tgt < 0 || A[a.tgt].dead || A[a.tgt].out || a.rt <= 0) {
      a.cb = false; a.tgt = -1;
      // counter-battery: guns facing guns that fire turn part of their shells on them (more with aircraft spotting)
      if (gun && rnd(g) < BARRAGE.cb + (A.some(o => o.f === a.f && o.type === 'plane' && !o.dead && !o.out) ? BARRAGE.cbAir : 0)) {
        const c = nearestEnemy(b, a, true, s.range * BARRAGE.cbRange); if (c >= 0 && (b.bar[A[c].f] ?? 1) > 0) { a.tgt = c; a.cb = true; }
      }
      if (a.tgt < 0) a.tgt = nearestEnemy(b, a); a.rt = .35 + rnd(g) * .45;
    }
    if (a.tgt < 0) { a.moving = false; continue; }
    const t = A[a.tgt], dx = t.x - a.x, dz = t.z - a.z, d = Math.hypot(dx, dz) || .001;
    a.face = Math.atan2(dx, dz);
    const attacker = a.f !== b.def && !isDef(a.type);
    if (attacker && a.type !== 'art') { const u = alongOf(b, a.x, a.z) - trenchX(a.x * -b.az + a.z * b.ax); if (u < reach) reach = u; }
    if (d <= s.range * (a.cb ? BARRAGE.cbRange : 1)) {
      a.moving = false;
      const sp = b.supp[a.f] ?? 0;
      if (a.cd <= 0 && !(gun && lvl === 0) && !((a.type === 'mg' || a.type === 'pill') && sp > SUPP_SILENCE)) {
        let rate = 1;
        if (gun) rate = drawShells(g, b, a.f, shotCost(b, a.f, g)) ? (lvl === 2 ? 1 / BARRAGE.heavy : 1) : BARRAGE.rationed;
        a.cd = s.rof * rofK * (.75 + rnd(g) * .5) * rate * suppSlow(sp); a.fireT = g.time;
        if (s.splash && t.type !== 'plane') {
          const sh: Shell = { x: t.x + (rnd(g) - .5) * 3.5 / morAcc(b, a.f), z: t.z + (rnd(g) - .5) * 3.5 / morAcc(b, a.f), time: .5 + d * .03, f: a.f, dmg: s.dmg * (1 + XP_DMG * (a.xp ?? 0)), sp: s.splash * splashMod(k.fl), src: a.type };
          b.shells.push(sh);
          if (fx && fx.length < FX_CAP) fx.push({ k: 'fire', b: b.id, x: a.x + Math.sin(a.face) * 2, z: a.z + Math.cos(a.face) * 2, face: a.face, tx: sh.x, tz: sh.z, fl: sh.time });
        } else {
          const air = t.type === 'plane', acc = s.acc * (air && a.type !== 'flak' ? .6 : 1) * morAcc(b, a.f);
          const hit = rnd(g) < acc * (1 - .45 * d / s.range);
          // anti-air guns concentrated on one border hit harder over it and weaker elsewhere
          const focus = a.type === 'flak' && (a.sector ?? -1) >= 0 ? (a.sector === b.from ? 1.5 : .5) : 1;
          if (hit) damage(g, b, t, s.dmg, a.type, k, focus * (1 + XP_DMG * (a.xp ?? 0)), a.f);
          if (fx && fx.length < FX_CAP) {
            if (a.type === 'flak') fx.push({ k: 'flak', b: b.id, x: t.x + (hit ? 0 : (rnd(g) - .5) * 3), z: t.z + (hit ? 0 : (rnd(g) - .5) * 3) });
            else fx.push({ k: 'shot', b: b.id, x0: a.x + Math.sin(a.face) * 1.2, z0: a.z + Math.cos(a.face) * 1.2, x1: t.x + (hit ? 0 : (rnd(g) - .5) * 1.5), z1: t.z + (hit ? 0 : (rnd(g) - .5) * 1.5), type: a.type, hit, air });
          }
        }
      }
    } else if (s.speed > 0 && !(a.trench && !charge) && !(a.type === 'art' && a.f === b.def && !charge) && !(attacker && !b.go && a.type !== 'art') && !a.cb) {
      let st = s.speed * dt * (attacker ? crossSpeed(k.fl, a.type) * (beach ? 1 / 1.5 : 1) : 1);
      // barbed wire in front of the trench: infantry and gun teams crawl through cutting it slowly, tanks flatten it
      if (b.wire > 0 && a.f !== b.def && inWire(b, a)) { if (a.type === 'tank') b.wire = Math.max(0, b.wire - dt * 3); else { st *= wireSlow(g, a.f, a.type); b.wire = Math.max(0, b.wire - dt * .15); } }
      a.x += dx / d * st; a.z += dz / d * st; a.moving = true; a.phase += dt * 9;
    } else a.moving = false;
  }
  // soft collisions (ground only; defences and dug-in troops do not get pushed)
  for (let i = 0; i < A.length; i++) {
    const a = A[i]; if (a.dead || a.out || a.type === 'plane') continue;
    const aFix = a.trench || isDef(a.type);
    for (let j = i + 1; j < A.length; j++) {
      const o = A[j]; if (o.dead || o.out || o.type === 'plane') continue; const dx = o.x - a.x, dz = o.z - a.z, d2 = dx * dx + dz * dz;
      const r = (isDef(a.type) || isDef(o.type)) ? 2 : (a.type === 'tank' || o.type === 'tank') ? 1.8 : (a.type === 'art' || o.type === 'art') ? 1.4 : .85;
      if (d2 < r * r && d2 > 1e-6) { const d = Math.sqrt(d2), push = (r - d) * .5 / d, oFix = o.trench || isDef(o.type); if (!aFix) { a.x -= dx * push * (oFix ? 2 : 1); a.z -= dz * push * (oFix ? 2 : 1); } if (!oFix) { o.x += dx * push * (aFix ? 2 : 1); o.z += dz * push * (aFix ? 2 : 1); } }
    }
    const R = Math.hypot(a.x, a.z); if (R > 26) { a.x *= 26 / R; a.z *= 26 / R; }
  }
  b.reach = reach;
  for (let i = b.shells.length - 1; i >= 0; i--) {
    const sh = b.shells[i]; sh.time -= dt; if (sh.time > 0) continue; b.shells.splice(i, 1);
    const pinned = new Set<number>();
    for (const o of A) {
      if (o.dead || o.out || o.f === sh.f || o.type === 'plane') continue; const d = Math.hypot(o.x - sh.x, o.z - sh.z);
      if (d < sh.sp) damage(g, b, o, sh.dmg * (1 - d / sh.sp * .6), sh.src, k, 1, sh.f);
      if (d < sh.sp + 1) pinned.add(o.f);
    }
    // shells landing on a side pin it down: suppressed troops fire less, MGs fall silent
    const drill = (sh.src !== 'plane' && (b.bar[sh.f] ?? 1) === 2 && techOn(g, sh.f, 'heavy') ? 1.2 : 1)
      // guns of an attack launched before assembly fire unregistered for a while
      * (b.unreg !== undefined && b.age < b.unreg && sh.f !== b.def ? .7 : 1);
    for (const f of pinned) b.supp[f] = Math.min(100, (b.supp[f] ?? 0) + BARRAGE.supp * (sh.src === 'plane' ? .8 : 1) * suppMod(g, sh.f) * drill);
    const u = alongOf(b, sh.x, sh.z); if (u > 2 && u < 18) b.craters = (b.craters ?? 0) + 1;
    if (b.wire > 0) { if (u > 2 && u < 9) b.wire = Math.max(0, b.wire - sh.dmg * .4); }
    boom(g, b, sh.x, sh.z, sh.src === 'plane' ? 1.2 : 1);
  }
  b.endCheck -= dt;
  if (b.endCheck <= 0) {
    morale(g, b, .3 + Math.max(0, -b.endCheck));
    b.endCheck = .3;
    // Ground troops and defences hold a battlefield; aircraft cannot. A raid keeps the battle going until its planes run out of fuel.
    const ground = new Set<number>(); let raid = false;
    for (const a of A) if (!a.dead && !a.out && a.type !== 'plane') ground.add(a.f);
    for (const a of A) if (!a.dead && !a.out && a.type === 'plane' && a.home !== b.region && !ground.has(a.f)) raid = true;
    if (ground.size <= 1 && !raid && !b.shells.length) {
      const w = ground.size ? [...ground][0] : null;
      if (!(w !== null && w !== b.def && b.goal && stageWon(g, b))) endBattle(g, b, w);
    }
  }
}

/** Battle units offshore where bombarding battleships lie (beyond the attackers' start line, out to sea). */
export const OFFSHORE_ALONG = 40;
/**
 * Shore bombardment: each battleship squadron offshore fires like three heavy batteries at the defenders of a coast (from the
 * stockpile of its power; harder on MG nests and gun emplacements). The coast's gun emplacements fire back at the ships.
 */
function bombard(g: GameState, b: Battle, dt: number) {
  const ships = bombarding(g, b); if (!ships.length) return;
  const A = b.agents, P = paceOf(g), cd = (b.bomb ??= {});
  const px = -b.az, pz = b.ax;
  for (const s of ships) {
    let t = cd[s.id] ?? rnd(g) * 2; t -= dt;
    if (t <= 0) {
      t = 3.4 * P.rof * (.8 + rnd(g) * .4);
      const fac = g.factions[s.owner], share = Math.max(.2, s.hp / shipMax(s)), cost = SHELLS.shot * 2;
      const lat = ((s.id * 37) % 21) - 10, ox = b.ax * OFFSHORE_ALONG + px * lat, oz = b.az * OFFSHORE_ALONG + pz * lat;
      for (let k = 0; k < 3; k++) {
        if (!fac || fac.shells < cost) break;
        const tg = A.filter(a => !a.dead && !a.out && a.f === b.def && a.type !== 'plane');
        if (!tg.length) break;
        const hard = tg.filter(a => a.type === 'pill' || a.type === 'fort'), pick = hard.length && rnd(g) < .5 ? hard : tg, x = pick[Math.floor(rnd(g) * pick.length)];
        fac.shells -= cost; b.used[s.owner] = (b.used[s.owner] ?? 0) + cost;
        const sx = x.x + (rnd(g) - .5) * 4, sz = x.z + (rnd(g) - .5) * 4, fl = 1.2 + rnd(g) * .4;
        b.shells.push({ x: sx, z: sz, time: fl, f: s.owner, dmg: 9 * share * (x.type === 'pill' || x.type === 'fort' ? 1.5 : 1), sp: 3, src: 'fort' });
        if (g.fx && g.fx.length < FX_CAP) g.fx.push({ k: 'bomb', b: b.id, x: ox, z: oz, tx: sx, tz: sz, fl });
      }
    }
    cd[s.id] = t;
  }
  // coast guns answer
  for (const a of A) if (!a.dead && !a.out && a.f === b.def && a.type === 'fort' && rnd(g) < dt * .25) {
    const s = ships[Math.floor(rnd(g) * ships.length)];
    if (rnd(g) < .5) { s.hp -= 5; if (s.hp <= 0) sinkShip(g, s); }
    if (g.fx && g.fx.length < FX_CAP) g.fx.push({ k: 'fire', b: b.id, x: a.x, z: a.z, face: Math.atan2(b.ax, b.az), tx: b.ax * OFFSHORE_ALONG, tz: b.az * OFFSHORE_ALONG, fl: 1.2 });
    break;
  }
}

/** Morale per side: losses shake it, quiet steadies it, and broken troops give up.  */
function morale(g: GameState, b: Battle, dt: number) {
  const seen = (b.seen ??= {}), broke = (b.broke ??= {});
  for (const f of b.sides) {
    let men = 0; for (const a of b.agents) if (a.f === f && !a.dead && !a.out && !isDef(a.type)) men += Math.max(0, a.hp) / statsOf(g, f, a.type).hp * (a.men ?? 50);
    const lost = (b.lost[f] ?? 0) - (seen[f] ?? 0); seen[f] = b.lost[f] ?? 0;
    let m = b.mor[f] ?? 70; const hold = stanceIn(b, f) === 3;
    if (men > 0) m -= lost / (men + lost) * 55 * (hold ? holdMorale(f) : 1);
    if (lost <= .01) m += dt * .6;
    b.mor[f] = m = Math.max(0, Math.min(moraleCap(g, f), m));
    // elastic defence: breaking defenders fall back to a second line once per battle and steady there
    if (f === b.def && m < 20 && men > 0 && !(b.fell ??= {})[f] && hasDoc(g, f, 'elastic')) {
      b.fell[f] = 1; b.mor[f] = m = 45;
      for (const a of b.agents) if (a.f === f && !a.dead && !a.out && !isDef(a.type) && a.type !== 'plane') { a.x -= b.ax * 3; a.z -= b.az * 3; }
      emit(g, { k: 'fallback', faction: f, region: b.region });
    }
    // below 15 morale, a shaken battalion now and then lays down its arms
    if (m < 15 && men > 0 && !hold && rnd(g) < dt * .35) {
      const c = b.agents.find(a => a.f === f && !a.dead && !a.out && (a.type === 'inf' || a.type === 'mg'));
      if (c) {
        const n = Math.max(0, c.hp) / statsOf(g, f, c.type).hp * (c.men ?? 50);
        c.dead = true; c.dieT = g.time; b.lost[f] = (b.lost[f] ?? 0) + n; seen[f] = b.lost[f]; ((b.lostT ??= {})[f] ??= emptyUnits())[c.type as UnitType] += n;
        if (!broke[f]) { broke[f] = 1; emit(g, { k: 'surrender', faction: f, region: b.region, n: 1 }); }
      }
    }
  }
}

/** Send `n` aircraft from a battle back home (or to the nearest friendly region, or they are lost). */
export function flyHome(g: GameState, b: Battle, f: number, home: number, n: number, cv?: number) {
  if (n <= 0) return;
  if (cv !== undefined && flyToCarrier(g, f, b.region, cv, n, home)) return;
  const W = world(), here = g.regions[b.region];
  let dest = -1;
  if (home !== b.region && g.regions[home]?.owner === f) dest = home;
  else if (here.owner === f && b.ended) { here.units.plane += n; here.men.plane += n * FORMATION.plane.men; return; }
  else dest = W.regions[b.region].adj.find(j => g.regions[j].owner === f) ?? -1;
  if (dest < 0) return;
  launch(g, f, b.region, dest, { ...emptyUnits(), plane: n }, true);
}

/** Put an aircraft flight in the air. */
export function launch(g: GameState, f: number, from: number, to: number, u: Units, ret: boolean, men?: Units): Army {
  const W = world(), A = W.regions[from], B = W.regions[to];
  const dx = wrapDx(A.cx, B.cx), dz = B.cz - A.cz, dist = Math.hypot(dx, dz);
  const a: Army = { id: g.nextId++, owner: f, units: u, men: men ?? { ...emptyUnits(), plane: u.plane * FORMATION.plane.men }, mor: 75, from, to, t: 0, dur: Math.max(1.5, dist / 7), sea: false, air: true, ret, ax: A.cx, az: A.cz, dx, dz };
  g.armies.push(a); return a;
}

/** Casualties feed the wounded pool and war weariness of every power that fought. */
function tallyLosses(g: GameState, b: Battle) {
  for (const [fs, lost] of Object.entries(b.lost)) {
    const f = g.factions[+fs]; if (!f || lost <= 0) continue;
    if (f.alive) f.wounded += lost * WOUNDED_SHARE;
    f.ww = Math.min(100, f.ww + lost / 400 * wwLossMod(g, +fs));
  }
}

export function endBattle(g: GameState, b: Battle, winner: number | null) {
  const t = g.regions[b.region]; b.ended = true; b.removeAt = g.time + 10;
  const others = frontsOf(g, t.id);
  t.battle = others.length ? others[0].id : -1;
  const prev = t.owner, wasContested = t.contested;
  tallyLosses(g, b);
  fileReport(g, b, winner);
  t.foughtT = g.time;
  if (b.from >= 0 && b.craters) { const cr = (t.cr ??= {}); cr[b.from] = Math.min(400, (cr[b.from] ?? 0) + Math.round(b.craters)); }
  // fixed defences go back to their place, aircraft fly home
  const home = new Map<string, number>();
  for (const a of b.agents) {
    if (a.dead || a.out) continue;
    if (isDef(a.type)) { t.defs.push({ id: a.defId ?? g.nextId++, k: a.type, s: a.sector ?? -1, hp: a.hp, f: a.f }); continue; }
    if (a.type === 'plane') { const k = a.f + ':' + (a.home ?? b.region) + ':' + (a.cv ?? -1); home.set(k, (home.get(k) ?? 0) + 1); }
  }
  for (const [k, n] of home) { const [f, h, cv] = k.split(':').map(Number); flyHome(g, b, f, h, n, cv >= 0 ? cv : undefined); }
  const surv = winner !== null ? forceIn(b, winner, false, g) : null;
  // survivors per corps; a won battle adds a star of experience to every corps of the winner
  const parts = winner !== null ? [...forceParts(b, winner, g)].map(([key, p]) => {
    consolidate(p.u, p.m);
    const tag = key >= 0 && b.ct?.[key] ? { ...b.ct[key], xp: Math.min(XP_MAX, (b.ct[key].xp ?? 0) + 1) } : undefined;
    return { ...p, tag };
  }).filter(p => groundUnits(p.u) > 0) : [];
  if (surv) consolidate(surv.u, surv.m);
  // barbed wire that was not cut stays; a front that held keeps its works
  if (b.from >= 0 && (b.wire0 > 0 || b.wire > 0)) worksFor(t, b.from).wire = Math.ceil(b.wire / WIRE_HP - 1e-6);

  if (others.length) {
    // Other fronts in this region are still burning. Victors there join the next front: defenders as reinforcements,
    // attackers who broke through fall on the defenders from behind. The region changes hands only when its last front ends.
    if (surv && totalUnits(surv.u) > 0) {
      if (winner === b.def) {
        const o = others.find(o => o.def === winner) ?? others[0];
        for (const p of parts) joinBattle(g, o, winner!, p.u, null, o.def === winner, t.id, p.m, Math.min(100, surv.mor + 5), undefined, p.tag);
      } else {
        const o = others.find(o => o.attacker === winner) ?? others[0];
        for (const p of parts) joinBattle(g, o, winner!, p.u, { x: -o.ax, z: -o.az }, false, t.id, p.m, Math.min(100, surv.mor + 8), undefined, p.tag);
        emit(g, { k: 'breakthrough', faction: winner!, region: t.id, from: b.from });
      }
    }
    for (const f of b.sides) { if (f === winner) g.stats.won[f]++; else g.stats.lost[f]++; }
    emit(g, { k: 'battleEnd', region: t.id, winner, prev, sides: [...b.sides], capital: false, holdouts: t.contested });
    for (const f of b.sides) checkElim(g, f, winner);
    return;
  }

  if (winner !== null && winner !== prev) {
    // defenders still standing elsewhere in the region (corps on other borders, what is left of the main army) fall back
    evacuate(g, t, prev);
    t.owner = winner; t.strike = false; t.fake = undefined; t.stance = 0; t.cs = undefined; t.an = undefined; t.deploy = undefined;
    for (const w of Object.values(t.works)) { w.tr = Math.max(0, w.tr - 1); }
    if (b.from >= 0) worksFor(t, b.from).wire = 0;
    t.units = emptyUnits(); t.men = emptyUnits();
    const mor = surv ? Math.min(moraleCap(g, winner!), surv.mor + 10) : 60;
    t.mor = mor;
    // the conquerors stand in the middle of the region: the corps the player commands as reserve corps, the rest as its depot
    if (winner !== null) for (const p of parts) addToGroup(g, t, -1, p.u, p.m, mor, p.tag);
  } else if (surv && winner === t.owner && totalUnits(surv.u) > 0) {
    // the region held: the survivors rejoin the troops still there, the defenders of a border man it again
    const holds = winner === b.def && !!b.goal && b.from >= 0, secs = world().regions[t.id].sectors;
    const mor = Math.min(moraleCap(g, winner!), surv.mor + 10);
    for (const p of parts) {
      // each corps goes back to the post it came from; the defenders of a border man it again
      const back = p.tag?.p !== undefined && (p.tag.p < 0 || secs.includes(p.tag.p)) ? p.tag.p : holds ? b.from : -1;
      const got = addToGroup(g, t, back, p.u, p.m, mor, p.tag ?? (holds ? b.cn : undefined));
      for (const c of got) if (c.p === b.from && holds) { c.ord = 0; c.since = g.time; }
    }
  }
  updateContested(t);
  const capital = t.capitalOf === prev && t.owner !== prev;
  emit(g, { k: 'battleEnd', region: t.id, winner, prev, sides: [...b.sides], capital, holdouts: t.contested });
  if (wasContested >= 0 && t.contested < 0 && t.owner === prev) emit(g, { k: 'cleared', region: t.id, faction: t.owner });
  for (const f of b.sides) { if (f === winner) g.stats.won[f]++; else g.stats.lost[f]++; }
  for (const f of b.sides) checkElim(g, f, winner);
  if (prev !== winner) checkElim(g, prev, winner);
  checkMissions(g);
}

/** The troops left in a fallen region march to a neighbouring region of their power, or are lost. */
function evacuate(g: GameState, t: RegionState, f: number) {
  if (f < 0 || totalUnits(t.units) <= 0) return;
  const W = world(), land = W.regions[t.id].adj.filter(j => g.regions[j].owner === f && !W.seaLane.has(t.id + '|' + j));
  const dest = land.sort((a, b) => (g.regions[a].cut ? 1 : 0) - (g.regions[b].cut ? 1 : 0))[0];
  if (dest !== undefined) {
    for (const c of [...corpsIn(t)]) { const tag = tagOf(c), mor = c.mor, out = takeCorps(t, c); column(g, f, t.id, tag.p ?? -1, dest, -1, out.u, out.m, Math.max(0, mor - 15), { tired: true, ct: tag.man ? tag : undefined, gn: tag.n, gk: 1 }); }
    const u = { ...t.units, plane: 0 }, m = { ...t.men, plane: 0 };
    if (groundUnits(u) > 0) column(g, f, t.id, -1, dest, -1, u, m, Math.max(0, t.mor - 15), { tired: true, gn: t.an, gk: 0 });
    if (t.units.plane > 0) launch(g, f, t.id, dest, { ...emptyUnits(), plane: t.units.plane }, true, { ...emptyUnits(), plane: t.men.plane });
    emit(g, { k: 'withdraw', faction: f, region: t.id, to: dest });
  } else if (groundUnits(t.units) > 0) emit(g, { k: 'surrender', faction: f, region: t.id, n: groundUnits(t.units) });
  t.units = emptyUnits(); t.men = emptyUnits(); t.cs = undefined;
}

/** How far the attackers got, from the closest distance to the trench line: 0 start line, 1 no-man's-land, 2 the wire, 3 the trench. */
export const reachOf = (rel: number) => rel <= .8 ? 3 : rel < 8.5 ? 2 : rel < 16 ? 1 : 0;

/** Keep an after-action report of a finished battle (the last 60 battles of the war). */
function fileReport(g: GameState, b: Battle, winner: number | null) {
  const sides = b.sides.map(f => ({ f, lost: roundUnits(b.lostT?.[f]), shells: Math.round(b.used?.[f] ?? 0), mor0: Math.round(b.mor0?.[f] ?? 70), mor1: Math.round(b.mor[f] ?? 0) }));
  const r = { id: b.id, region: b.region, from: b.from, day: g.day, dur: Math.round(b.age), attacker: b.attacker, def: b.def, winner, reach: winner !== null && winner !== b.def ? 3 : reachOf(b.reach ?? 99), sides };
  (g.reports ??= []).push(r); if (g.reports.length > 60) g.reports.splice(0, g.reports.length - 60);
  emit(g, { k: 'report', id: b.id, region: b.region, sides: [...b.sides] });
}
const roundUnits = (u?: Units) => { const o = emptyUnits(); if (u) for (const k of UNIT_TYPES) o[k] = Math.round(u[k]); return o; };

export const unitsAlive = (b: Battle, f: number) => { const u = emptyUnits(); for (const a of b.agents) if (!a.dead && !a.out && a.f === f && !isDef(a.type)) u[a.type as keyof Units]++; return u; };
export const worldRegion = (id: number) => world().regions[id];
export const factionName = (i: number) => FACTIONS[i].name;
void GROUND_TYPES;
