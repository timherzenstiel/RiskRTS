// Agent-based auto-battle. Positions are in battle-local units; +x runs along (ax,az), the defenders hold a trench line near x=1.8.
// Fixed defences fight where they stand: a pillbox on the border to Germany only joins battles against attacks coming from Germany,
// interior defences join every battle in the region, and anti-air guns cover the whole region against aircraft.
import { ANTI_AIR, AS, UNIT_TYPES, emptyUnits, isDef, totalUnits, type AgentType, type Units } from '../data/units';
import { FACTIONS } from '../data/factions';
import { wrapDx } from '../world/build';
import { emit, rnd, updateContested, world } from './core';
import { checkElim, checkMissions } from './missions';
import { PACES, type Agent, type Army, type Battle, type Defence, type Shell, type GameState, type RegionState } from './types';

export const trenchX = (z: number) => 1.8 + ((Math.floor((z + 40) / 3)) % 2 ? .6 : -.6);
const FX_CAP = 900;
export const paceOf = (g: GameState) => PACES[g.cfg?.pace ?? 1] ?? PACES[1];

export function startBattle(g: GameState, region: RegionState, dir: { x: number; z: number }, attacker: number, from: number): Battle {
  const b: Battle = { id: g.nextId++, region: region.id, ax: dir.x, az: dir.z, agents: [], shells: [], age: 0, ended: false, removeAt: 0, endCheck: .5, sides: [], attacker, def: region.owner, from };
  region.battle = b.id; g.battles.push(b);
  if (totalUnits(region.units) > 0) joinBattle(g, b, region.owner, region.units, dir, true, region.id);
  region.units = emptyUnits();
  // Defences on the attacked sector, in the interior, and every anti-air gun join the defence. Holdouts of the attacker rise up behind the lines.
  const own = region.defs.filter(d => d.f === region.owner && (d.s === from || d.s < 0 || d.k === 'flak'));
  const hold = region.defs.filter(d => d.f === attacker);
  region.defs = region.defs.filter(d => !own.includes(d) && !hold.includes(d));
  placeDefs(b, own, true); placeDefs(b, hold, false);
  if (own.length && !b.sides.includes(region.owner)) b.sides.push(region.owner);
  if (hold.length && !b.sides.includes(attacker)) b.sides.push(attacker);
  emit(g, { k: 'battleStart', region: region.id, attacker, defender: region.owner });
  return b;
}

/** The owner of a contested region storms the holdouts with the region's garrison. */
export function startAssault(g: GameState, region: RegionState): Battle {
  const W = world(), h = region.contested, me = region.owner, wr = W.regions[region.id];
  const hold = region.defs.filter(d => d.f === h), sector = hold.find(d => d.s >= 0)?.s ?? -1;
  let dir = { x: 1, z: 0 };
  if (sector >= 0) { const n = W.regions[sector], dx = wrapDx(wr.cx, n.cx), dz = n.cz - wr.cz, l = Math.hypot(dx, dz) || 1; dir = { x: -dx / l, z: -dz / l }; }
  const b: Battle = { id: g.nextId++, region: region.id, ax: dir.x, az: dir.z, agents: [], shells: [], age: 0, ended: false, removeAt: 0, endCheck: .5, sides: [h], attacker: me, def: h, from: sector };
  region.battle = b.id; g.battles.push(b);
  region.defs = region.defs.filter(d => d.f !== h);
  placeDefs(b, hold, true);
  joinBattle(g, b, me, region.units, dir, false, region.id);
  region.units = emptyUnits();
  emit(g, { k: 'battleStart', region: region.id, attacker: me, defender: h });
  return b;
}

function placeDefs(b: Battle, defs: Defence[], defending: boolean) {
  const ax = b.ax, az = b.az, px = -az, pz = ax;
  const groups: Record<string, Defence[]> = {};
  for (const d of defs) { const key = !defending ? 'h' : d.s === b.from ? 'front' : d.k === 'flak' ? 'aa' : 'in'; (groups[key] ??= []).push(d); }
  for (const [key, list] of Object.entries(groups)) list.forEach((d, i) => {
    const lat = ((i + .5) / list.length - .5) * (key === 'front' ? 20 : 16) + ((d.id * 7919) % 100 / 100 - .5) * 2;
    let along: number;
    if (key === 'h') along = 13 + (d.id % 3);
    else if (key === 'front') along = d.k === 'fort' ? trenchX(lat) - 3 : d.k === 'flak' ? trenchX(lat) - 1.8 : trenchX(lat) + 1.4;
    else if (key === 'aa') along = -4.5;
    else along = d.k === 'fort' ? -10 : -6.5;
    b.agents.push({
      f: d.f, type: d.k, x: ax * along + px * lat, z: az * along + pz * lat, hp: d.hp, cd: 0, rt: 0, tgt: -1, dead: false, dieT: 0, fireT: -9,
      face: Math.atan2(ax, az) + (defending ? 0 : Math.PI), phase: 0, moving: false, trench: false, defId: d.id, sector: d.s,
    });
  });
}

export function joinBattle(g: GameState, b: Battle, f: number, u: Units, dir: { x: number; z: number } | null, def: boolean, home = b.region) {
  if (!b.sides.includes(f)) b.sides.push(f);
  const a = def ? { x: b.ax, z: b.az } : (dir || { x: b.ax, z: b.az }), p = { x: -a.z, z: a.x }, P = paceOf(g);
  for (const k of UNIT_TYPES) for (let n = 0; n < u[k]; n++) {
    let along: number, lat: number;
    if (k === 'plane') { along = def ? -14 - rnd(g) * 4 : 30 + rnd(g) * 6; lat = (rnd(g) - .5) * 24; }
    else if (def) { lat = (rnd(g) - .5) * 26; along = k === 'art' ? -7 - rnd(g) * 2 : (k === 'tank' ? -2 + rnd(g) * 2 : trenchX(lat) + (rnd(g) - .5) * .6); }
    else { along = (k === 'art' ? 26 : 20) + rnd(g) * 4; lat = (rnd(g) - .5) * 22; }
    const s = AS(k);
    const ag: Agent = { f, type: k, x: a.x * along + p.x * lat, z: a.z * along + p.z * lat, hp: s.hp, cd: rnd(g) * s.rof, rt: 0, tgt: -1, dead: false, dieT: 0, fireT: -9, face: Math.atan2(-a.x, -a.z) + (def ? Math.PI : 0), phase: rnd(g) * 6, moving: false, trench: def && (k === 'inf' || k === 'mg') };
    if (k === 'plane') { ag.fuel = P.fuel * (.85 + rnd(g) * .3); ag.home = home; }
    b.agents.push(ag);
  }
}

const canTarget = (a: AgentType, o: Agent) => o.type === 'plane' ? ANTI_AIR[a] > 0 : a !== 'flak';

function nearestEnemy(b: Battle, a: Agent): number {
  let best = -1, bd = 1e9;
  for (let i = 0; i < b.agents.length; i++) {
    const o = b.agents[i]; if (o.dead || o.out || o.f === a.f || !canTarget(a.type, o)) continue;
    let d = (o.x - a.x) ** 2 + (o.z - a.z) ** 2;
    if (a.type === 'plane' && o.type !== 'plane' && isDef(o.type) && o.type !== 'flak') d *= .6; // bombers go for the concrete
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function damage(g: GameState, b: Battle, region: RegionState, t: Agent, dmg: number, src: AgentType) {
  if (t.dead || t.out) return;
  if (t.type === 'plane') dmg *= ANTI_AIR[src];
  else if (isDef(t.type)) { if (src === 'inf' || src === 'mg' || src === 'pill') dmg *= .3; else if (src === 'tank') dmg *= .8; }
  else if (t.type === 'tank' && (src === 'inf' || src === 'mg' || src === 'pill')) dmg *= .25;
  if (t.trench && t.f === b.def) dmg *= Math.max(.35, .8 - .15 * region.trench);
  t.hp -= dmg;
  if (t.hp <= 0) { t.dead = true; t.dieT = g.time; if (g.fx && (t.type === 'tank' || isDef(t.type) || t.type === 'plane')) boom(g, b, t.x, t.z, t.type === 'plane' ? .8 : 1.5); }
}
function boom(g: GameState, b: Battle, x: number, z: number, s: number) { if (g.fx && g.fx.length < FX_CAP) g.fx.push({ k: 'boom', b: b.id, x, z, s }); }
const wrapA = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export function stepBattle(g: GameState, b: Battle, dt: number) {
  if (b.ended) return;
  const region = g.regions[b.region]; b.age += dt;
  const A = b.agents, P = paceOf(g), charge = b.age > P.charge, fx = g.fx;
  for (const a of A) {
    if (a.dead || a.out) continue; const s = AS(a.type);
    a.cd -= dt; a.rt -= dt;
    if (a.type === 'plane') {
      if (a.home !== b.region) { a.fuel = (a.fuel ?? 0) - dt; if (a.fuel <= 0) { a.out = true; flyHome(g, b, a.f, a.home ?? b.region, 1); continue; } }
      if (a.tgt < 0 || A[a.tgt].dead || A[a.tgt].out || a.rt <= 0) { a.tgt = nearestEnemy(b, a); a.rt = .6 + rnd(g) * .6; }
      let diff = .9;
      if (a.tgt >= 0) { const t = A[a.tgt]; diff = wrapA(Math.atan2(t.x - a.x, t.z - a.z) - a.face); }
      a.face = wrapA(a.face + Math.max(-2.2 * dt, Math.min(2.2 * dt, diff)));
      a.x += Math.sin(a.face) * s.speed * dt; a.z += Math.cos(a.face) * s.speed * dt; a.moving = true; a.phase += dt * 20;
      const R = Math.hypot(a.x, a.z); if (R > 34) { a.x *= 34 / R; a.z *= 34 / R; }
      if (a.tgt >= 0 && a.cd <= 0 && Math.abs(diff) < .5) {
        const t = A[a.tgt], d = Math.hypot(t.x - a.x, t.z - a.z);
        if (d <= s.range) {
          a.cd = s.rof * P.rof * (.75 + rnd(g) * .5); a.fireT = g.time;
          if (t.type === 'plane') {
            const hit = rnd(g) < s.acc * (1 - .4 * d / s.range); if (hit) damage(g, b, region, t, s.dmg * .6, 'plane');
            if (fx && fx.length < FX_CAP) fx.push({ k: 'shot', b: b.id, x0: a.x, z0: a.z, x1: t.x, z1: t.z, type: 'plane', hit, air: true });
          } else b.shells.push({ x: t.x + (rnd(g) - .5) * 1.6, z: t.z + (rnd(g) - .5) * 1.6, time: .45, f: a.f, dmg: s.dmg, sp: s.splash ?? 2, src: 'plane' });
        }
      }
      continue;
    }
    if (a.tgt < 0 || A[a.tgt].dead || A[a.tgt].out || a.rt <= 0) { a.tgt = nearestEnemy(b, a); a.rt = .35 + rnd(g) * .45; }
    if (a.tgt < 0) { a.moving = false; continue; }
    const t = A[a.tgt], dx = t.x - a.x, dz = t.z - a.z, d = Math.hypot(dx, dz) || .001;
    a.face = Math.atan2(dx, dz);
    if (d <= s.range) {
      a.moving = false;
      if (a.cd <= 0) {
        a.cd = s.rof * P.rof * (.75 + rnd(g) * .5); a.fireT = g.time;
        if (s.splash && t.type !== 'plane') {
          const sh: Shell = { x: t.x + (rnd(g) - .5) * 3.5, z: t.z + (rnd(g) - .5) * 3.5, time: .5 + d * .03, f: a.f, dmg: s.dmg, sp: s.splash, src: a.type };
          b.shells.push(sh);
          if (fx && fx.length < FX_CAP) fx.push({ k: 'fire', b: b.id, x: a.x + Math.sin(a.face) * 2, z: a.z + Math.cos(a.face) * 2, face: a.face, tx: sh.x, tz: sh.z, fl: sh.time });
        } else {
          const air = t.type === 'plane', acc = s.acc * (air && a.type !== 'flak' ? .6 : 1);
          const hit = rnd(g) < acc * (1 - .45 * d / s.range);
          if (hit) damage(g, b, region, t, s.dmg, a.type);
          if (fx && fx.length < FX_CAP) {
            if (a.type === 'flak') fx.push({ k: 'flak', b: b.id, x: t.x + (hit ? 0 : (rnd(g) - .5) * 3), z: t.z + (hit ? 0 : (rnd(g) - .5) * 3) });
            else fx.push({ k: 'shot', b: b.id, x0: a.x + Math.sin(a.face) * 1.2, z0: a.z + Math.cos(a.face) * 1.2, x1: t.x + (hit ? 0 : (rnd(g) - .5) * 1.5), z1: t.z + (hit ? 0 : (rnd(g) - .5) * 1.5), type: a.type, hit, air });
          }
        }
      }
    } else if (s.speed > 0 && !(a.trench && !charge) && !(a.type === 'art' && a.f === b.def && !charge)) {
      const st = s.speed * dt; a.x += dx / d * st; a.z += dz / d * st; a.moving = true; a.phase += dt * 9;
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
  for (let i = b.shells.length - 1; i >= 0; i--) {
    const sh = b.shells[i]; sh.time -= dt; if (sh.time > 0) continue; b.shells.splice(i, 1);
    for (const o of A) { if (o.dead || o.out || o.f === sh.f || o.type === 'plane') continue; const d = Math.hypot(o.x - sh.x, o.z - sh.z); if (d < sh.sp) damage(g, b, region, o, sh.dmg * (1 - d / sh.sp * .6), sh.src); }
    boom(g, b, sh.x, sh.z, sh.src === 'plane' ? 1.2 : 1);
  }
  b.endCheck -= dt;
  if (b.endCheck <= 0) {
    b.endCheck = .3;
    // Ground troops and defences hold a battlefield; aircraft cannot. A raid keeps the battle going until its planes run out of fuel.
    const ground = new Set<number>(); let raid = false;
    for (const a of A) if (!a.dead && !a.out && a.type !== 'plane') ground.add(a.f);
    for (const a of A) if (!a.dead && !a.out && a.type === 'plane' && a.home !== b.region && !ground.has(a.f)) raid = true;
    if (ground.size <= 1 && !raid && !b.shells.length) endBattle(g, b, ground.size ? [...ground][0] : null);
  }
}

/** Send `n` aircraft from a battle back home (or to the nearest friendly region, or they are lost). */
export function flyHome(g: GameState, b: Battle, f: number, home: number, n: number) {
  if (n <= 0) return;
  const W = world(), here = g.regions[b.region];
  let dest = -1;
  if (home !== b.region && g.regions[home]?.owner === f) dest = home;
  else if (here.owner === f && b.ended) { here.units.plane += n; return; }
  else dest = W.regions[b.region].adj.find(j => g.regions[j].owner === f) ?? -1;
  if (dest < 0) return;
  launch(g, f, b.region, dest, { ...emptyUnits(), plane: n }, true);
}

/** Put an aircraft flight in the air. */
export function launch(g: GameState, f: number, from: number, to: number, u: Units, ret: boolean): Army {
  const W = world(), A = W.regions[from], B = W.regions[to];
  const dx = wrapDx(A.cx, B.cx), dz = B.cz - A.cz, dist = Math.hypot(dx, dz);
  const a: Army = { id: g.nextId++, owner: f, units: u, from, to, t: 0, dur: Math.max(1.5, dist / 7), sea: false, air: true, ret, ax: A.cx, az: A.cz, dx, dz };
  g.armies.push(a); return a;
}

export function endBattle(g: GameState, b: Battle, winner: number | null) {
  const t = g.regions[b.region]; b.ended = true; b.removeAt = g.time + 10; t.battle = -1;
  const prev = t.owner, wasContested = t.contested;
  if (winner !== null && winner !== prev) { t.owner = winner; t.trench = Math.max(0, t.trench - 1); }
  const u = emptyUnits(), home = new Map<string, number>();
  for (const a of b.agents) {
    if (a.dead || a.out) continue;
    if (isDef(a.type)) { t.defs.push({ id: a.defId ?? g.nextId++, k: a.type, s: a.sector ?? -1, hp: a.hp, f: a.f }); continue; }
    if (a.type === 'plane') { const k = a.f + ':' + (a.home ?? b.region); home.set(k, (home.get(k) ?? 0) + 1); continue; }
    if (a.f === winner) u[a.type]++;
  }
  t.units = u;
  for (const [k, n] of home) { const [f, h] = k.split(':').map(Number); flyHome(g, b, f, h, n); }
  updateContested(t);
  const capital = t.capitalOf === prev && t.owner !== prev;
  emit(g, { k: 'battleEnd', region: t.id, winner, prev, sides: [...b.sides], capital, holdouts: t.contested });
  if (wasContested >= 0 && t.contested < 0 && t.owner === prev) emit(g, { k: 'cleared', region: t.id, faction: t.owner });
  for (const f of b.sides) { if (f === winner) g.stats.won[f]++; else g.stats.lost[f]++; }
  for (const f of b.sides) checkElim(g, f, winner);
  if (prev !== winner) checkElim(g, prev, winner);
  checkMissions(g);
}

export const unitsAlive = (b: Battle, f: number) => { const u = emptyUnits(); for (const a of b.agents) if (!a.dead && !a.out && a.f === f && !isDef(a.type)) u[a.type as keyof Units]++; return u; };
export const worldRegion = (id: number) => world().regions[id];
export const factionName = (i: number) => FACTIONS[i].name;
