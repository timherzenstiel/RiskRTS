// Agent-based auto-battle. Positions are in battle-local units; +x runs along (ax,az), the defenders hold a trench line near x=1.8.
import { UT, UNIT_TYPES, emptyUnits, type Units, type UnitType } from '../data/units';
import { FACTIONS } from '../data/factions';
import { emit, rnd, world } from './core';
import { checkElim, checkMissions } from './missions';
import type { Agent, Battle, GameState, RegionState } from './types';

export const trenchX = (z: number) => 1.8 + ((Math.floor((z + 40) / 3)) % 2 ? .6 : -.6);
const FX_CAP = 900;

export function startBattle(g: GameState, region: RegionState, dir: { x: number; z: number }, attacker: number): Battle {
  const b: Battle = { id: g.nextId++, region: region.id, ax: dir.x, az: dir.z, agents: [], shells: [], age: 0, ended: false, removeAt: 0, endCheck: .5, sides: [], attacker };
  region.battle = b.id; g.battles.push(b);
  if (region.units.inf + region.units.mg + region.units.art + region.units.tank > 0) joinBattle(g, b, region.owner, region.units, dir, true);
  region.units = emptyUnits();
  emit(g, { k: 'battleStart', region: region.id, attacker, defender: region.owner });
  return b;
}

export function joinBattle(g: GameState, b: Battle, f: number, u: Units, dir: { x: number; z: number } | null, def: boolean) {
  if (!b.sides.includes(f)) b.sides.push(f);
  const a = def ? { x: b.ax, z: b.az } : (dir || { x: b.ax, z: b.az }), p = { x: -a.z, z: a.x };
  for (const k of UNIT_TYPES) for (let n = 0; n < u[k]; n++) {
    let along: number, lat: number;
    if (def) { lat = (rnd(g) - .5) * 26; along = k === 'art' ? -7 - rnd(g) * 2 : (k === 'tank' ? -2 + rnd(g) * 2 : trenchX(lat) + (rnd(g) - .5) * .6); }
    else { along = (k === 'art' ? 26 : 20) + rnd(g) * 4; lat = (rnd(g) - .5) * 22; }
    const s = UT[k];
    b.agents.push({ f, type: k, x: a.x * along + p.x * lat, z: a.z * along + p.z * lat, hp: s.hp, cd: rnd(g) * s.rof, rt: 0, tgt: -1, dead: false, dieT: 0, fireT: -9, face: Math.atan2(-a.x, -a.z) + (def ? Math.PI : 0), phase: rnd(g) * 6, moving: false, trench: def && k !== 'art' && k !== 'tank' });
  }
}

function nearestEnemy(b: Battle, a: Agent): number {
  let best = -1, bd = 1e9;
  for (let i = 0; i < b.agents.length; i++) { const o = b.agents[i]; if (o.dead || o.f === a.f) continue; const d = (o.x - a.x) ** 2 + (o.z - a.z) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}

function damage(g: GameState, b: Battle, region: RegionState, t: Agent, dmg: number, src: UnitType) {
  if (t.dead) return;
  if (t.type === 'tank' && (src === 'inf' || src === 'mg')) dmg *= .25;
  if (t.trench && t.f === region.owner) dmg *= Math.max(.35, .8 - .15 * region.trench);
  t.hp -= dmg;
  if (t.hp <= 0) { t.dead = true; t.dieT = g.time; if (g.fx && t.type === 'tank') boom(g, b, t.x, t.z, 1.4); }
}
function boom(g: GameState, b: Battle, x: number, z: number, s: number) { if (g.fx && g.fx.length < FX_CAP) g.fx.push({ k: 'boom', b: b.id, x, z, s }); }

export function stepBattle(g: GameState, b: Battle, dt: number) {
  if (b.ended) return;
  const region = g.regions[b.region]; b.age += dt;
  const A = b.agents, charge = b.age > 180, fx = g.fx;
  for (const a of A) {
    if (a.dead) continue; const s = UT[a.type];
    a.cd -= dt; a.rt -= dt;
    if (a.tgt < 0 || A[a.tgt].dead || a.rt <= 0) { a.tgt = nearestEnemy(b, a); a.rt = .35 + rnd(g) * .45; }
    if (a.tgt < 0) { a.moving = false; continue; }
    const t = A[a.tgt], dx = t.x - a.x, dz = t.z - a.z, d = Math.hypot(dx, dz) || .001;
    a.face = Math.atan2(dx, dz);
    if (d <= s.range) {
      a.moving = false;
      if (a.cd <= 0) {
        a.cd = s.rof * (.75 + rnd(g) * .5); a.fireT = g.time;
        if (a.type === 'art') {
          b.shells.push({ x: t.x + (rnd(g) - .5) * 3.5, z: t.z + (rnd(g) - .5) * 3.5, time: .5 + d * .03, f: a.f, dmg: s.dmg });
          if (fx && fx.length < FX_CAP) fx.push({ k: 'fire', b: b.id, x: a.x + Math.sin(a.face) * 2, z: a.z + Math.cos(a.face) * 2, face: a.face });
        } else {
          const hit = rnd(g) < s.acc * (1 - .45 * d / s.range);
          if (hit) damage(g, b, region, t, s.dmg, a.type);
          if (fx && fx.length < FX_CAP) fx.push({ k: 'shot', b: b.id, x0: a.x + Math.sin(a.face) * 1.2, z0: a.z + Math.cos(a.face) * 1.2, x1: t.x + (hit ? 0 : (rnd(g) - .5) * 1.5), z1: t.z + (hit ? 0 : (rnd(g) - .5) * 1.5), type: a.type, hit });
        }
      }
    } else if (!(a.trench && !charge) && !(a.type === 'art' && a.f === region.owner && !charge)) {
      const st = s.speed * dt; a.x += dx / d * st; a.z += dz / d * st; a.moving = true; a.phase += dt * 9;
    } else a.moving = false;
  }
  // soft collisions
  for (let i = 0; i < A.length; i++) {
    const a = A[i]; if (a.dead) continue;
    for (let j = i + 1; j < A.length; j++) {
      const o = A[j]; if (o.dead) continue; const dx = o.x - a.x, dz = o.z - a.z, d2 = dx * dx + dz * dz;
      const r = (a.type === 'tank' || o.type === 'tank') ? 1.8 : (a.type === 'art' || o.type === 'art') ? 1.4 : .85;
      if (d2 < r * r && d2 > 1e-6) { const d = Math.sqrt(d2), push = (r - d) * .5 / d; if (!a.trench) { a.x -= dx * push; a.z -= dz * push; } if (!o.trench) { o.x += dx * push; o.z += dz * push; } }
    }
    const R = Math.hypot(a.x, a.z); if (R > 26) { a.x *= 26 / R; a.z *= 26 / R; }
  }
  for (let i = b.shells.length - 1; i >= 0; i--) {
    const sh = b.shells[i]; sh.time -= dt; if (sh.time > 0) continue; b.shells.splice(i, 1);
    const sp = UT.art.splash!;
    for (const o of A) { if (o.dead || o.f === sh.f) continue; const d = Math.hypot(o.x - sh.x, o.z - sh.z); if (d < sp) damage(g, b, region, o, sh.dmg * (1 - d / sp * .6), 'art'); }
    boom(g, b, sh.x, sh.z, 1);
  }
  b.endCheck -= dt;
  if (b.endCheck <= 0) {
    b.endCheck = .3; const fs = new Set<number>(); for (const a of A) if (!a.dead) fs.add(a.f);
    if (fs.size <= 1 && !b.shells.length) endBattle(g, b, fs.size ? [...fs][0] : null);
  }
}

export function endBattle(g: GameState, b: Battle, winner: number | null) {
  const t = g.regions[b.region]; b.ended = true; b.removeAt = g.time + 10; t.battle = -1;
  const u = emptyUnits(); if (winner !== null) for (const a of b.agents) if (!a.dead && a.f === winner) u[a.type]++;
  const prev = t.owner; t.units = u;
  const capital = t.capitalOf === prev;
  if (winner !== null && winner !== prev) { t.owner = winner; t.trench = Math.max(0, t.trench - 1); }
  emit(g, { k: 'battleEnd', region: t.id, winner, prev, sides: [...b.sides], capital });
  for (const f of b.sides) { if (f === winner) g.stats.won[f]++; else g.stats.lost[f]++; }
  for (const f of b.sides) checkElim(g, f, winner);
  if (prev !== winner) checkElim(g, prev, winner);
  checkMissions(g);
}

export const unitsAlive = (b: Battle, f: number) => { const u = emptyUnits(); for (const a of b.agents) if (!a.dead && a.f === f) u[a.type]++; return u; };
export const worldRegion = (id: number) => world().regions[id];
export const factionName = (i: number) => FACTIONS[i].name;
