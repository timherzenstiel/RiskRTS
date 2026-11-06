// Naval battles, ship by ship. When fleets of powers at war meet in a zone with warships on at least one side (a stationed
// fleet always fights; a convoy passing through fights when it runs into one), every squadron becomes its ships: two
// dreadnoughts and a destroyer per battleship squadron, the carrier and its aircraft, each transport and landing flotilla.
// Dreadnoughts form a line ahead and turn to bring their broadsides to bear (a line across the head of the enemy's fires
// all its turrets, the enemy only its forward ones), destroyers screen and make torpedo runs, transports run for it. Fire
// is aimed: it falls off with range and walks onto a target salvo by salvo; hits start fires, knock out turrets, and now
// and then blow up a magazine. Night falls during the battle: half the range, torpedoes twice as deadly.
// Positions are battle units around the battle point (1 battle unit = NAVAL.scale world units), +x along the axis the fleets
// met on; the same fixed step as the land battles keeps it deterministic.
import { NAVAL } from '../data/sea';
import { HW, wrapDx } from '../world/build';
import { dayOf } from '../data/calendar';
import { nationOf } from '../data/nations';
import { emit, rnd } from './core';
import { allied } from './diplomacy';
import { atWar, fleetOf, fleetPos, fleetShips, fleetZone, goHome, loseCargo, shipMax, sinkShip } from './navy';
import type { Fleet, GameState, SeaBattle, Ship, ShipAgent, ShipAgentKind } from './types';

const N = NAVAL;
const wrapA = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const FX_CAP = 900;
const warship = (k: ShipAgentKind) => k === 'dn' || k === 'dd' || k === 'cv';
const active = (a: ShipAgent) => !a.dead && !a.out;

/** World position of a battle-local point. */
export function seaWorld(b: SeaBattle, x: number, z: number): { x: number; z: number } {
  const s = N.scale, px = -b.az, pz = b.ax; let wx = b.x + (b.ax * x + px * z) * s; const wz = b.z + (b.az * x + pz * z) * s;
  if (wx < -HW) wx += 2 * HW; if (wx > HW) wx -= 2 * HW;
  return { x: wx, z: wz };
}
/** World heading of a battle-local heading. */
export function seaHeading(b: SeaBattle, hd: number) { const s = Math.sin(hd), c = Math.cos(hd); return Math.atan2(b.ax * s - b.az * c, b.az * s + b.ax * c); }

const sideOf = (b: SeaBattle, f: number) => b.sides[0].includes(f) ? 0 : b.sides[1].includes(f) ? 1 : -1;

/** Warships of a fleet that make it a fighting fleet. */
const fighting = (g: GameState, fl: Fleet) => fleetShips(g, fl).some(s => s.kind === 'bb' || (s.kind === 'carrier' && (s.planes ?? 0) > 0));
const atSea = (fl: Fleet) => fl.state !== 'land' && fl.state !== 'embark' && fl.zs.length > 0;

/** Spawn a fleet's ships as agents on side `side`, on the near edge of the battle area. */
function spawn(g: GameState, b: SeaBattle, fl: Fleet, side: number, gap = 30) {
  const ships = fleetShips(g, fl), sgn = side === 0 ? -1 : 1, hd = side === 0 ? Math.PI / 2 : -Math.PI / 2;
  let line = 0, scr = 0, back = 0;
  const lineN = ships.filter(s => s.kind === 'bb').length * 2;
  const add = (ship: Ship, kind: ShipAgentKind, hp: number, x: number, z: number, extra: Partial<ShipAgent> = {}) => {
    b.agents.push({ id: g.nextId++, ship: ship.id, f: ship.owner, kind, x, z, hd: hd + (rnd(g) - .5) * .2, v: 0, hp, hp0: hp, tur: kind === 'dn' ? N.dn.turrets : 0, torps: kind === 'dd' ? N.dd.torps : 0, tgt: -1, cd: rnd(g) * 3, fire: 0, str: 0, aim: 0, fireT: -9, out: false, dead: false, dieT: 0, ...extra });
  };
  const x0 = sgn * gap / 2;
  for (const s of ships) {
    if (s.kind === 'bb') {
      for (let k = 0; k < 2; k++) { const z = (line - (lineN - 1) / 2) * N.dn.spacing; add(s, 'dn', s.hp * N.dn.hpShare / (N.dn.hpShare * 2 + N.dd.hpShare), x0, z); line++; }
      add(s, 'dd', s.hp * N.dd.hpShare / (N.dn.hpShare * 2 + N.dd.hpShare), x0 - sgn * 4, (scr++ % 2 ? 1 : -1) * (lineN * 1.6 + 2 + scr));
    } else if (s.kind === 'carrier') {
      add(s, 'cv', s.hp, x0 + sgn * 5, (back++ - 1) * 3);
      for (let p = 0; p < (s.planes ?? 0); p++) add(s, 'pl', 16, x0 + sgn * 6, (back - 1) * 3 + p * .6, { fuel: N.plane.fuel, cv: s.id, hd: hd + Math.PI });
    } else add(s, s.kind === 'trans' ? 'tr' : 'lc', s.hp, x0 + sgn * (lineN ? 4 + (back % 3) * 1.5 : (back % 3) * 1.5), ((back++ % 5) - 2) * 2.4);
  }
  if (!b.fleets.includes(fl.id)) b.fleets.push(fl.id);
  fl.sea = b.id;
}

function sideHp(b: SeaBattle, side: number) { let h = 0; for (const a of b.agents) if (a.kind !== 'pl' && sideOf(b, a.f) === side && !a.dead) h += Math.max(0, a.hp); return h; }

/** Open a naval battle in zone `z` between two groups of fleets (side 0 intercepts or holds, side 1 comes in). */
function startSeaBattle(g: GameState, z: number, s0: Fleet[], s1: Fleet[], at: { x: number; z: number }, gap = 30) {
  const p0 = centroid(s0), p1 = centroid(s1);
  let ax = wrapDx(p0.x, p1.x), az = p1.z - p0.z; const L = Math.hypot(ax, az);
  if (L < 1e-3) { ax = 1; az = 0; } else { ax /= L; az /= L; }
  const b: SeaBattle = {
    id: g.nextId++, zone: z, x: at.x, z: at.z, ax, az, sides: [[], []], fleets: [], agents: [], shells: [], torps: [], age: 0, ended: false, removeAt: 0,
    night: N.nightFrom + rnd(g) * (N.nightTo - N.nightFrom), hp0: [0, 0], brk: [false, false], sunk: [{}, {}],
  };
  for (const fl of s0) { if (!b.sides[0].includes(fl.owner)) b.sides[0].push(fl.owner); spawn(g, b, fl, 0, gap); }
  for (const fl of s1) { if (!b.sides[1].includes(fl.owner)) b.sides[1].push(fl.owner); spawn(g, b, fl, 1, gap); }
  b.hp0 = [sideHp(b, 0), sideHp(b, 1)];
  (g.seaBattles ??= []).push(b);
  emit(g, { k: 'seaBattle', zone: z, sides: b.sides.map(s => [...s]), winner: -1, sunk: [{}, {}], start: true, id: b.id });
  return b;
}
function centroid(fl: Fleet[]) {
  const p0 = fleetPos(fl[0]); let x = 0, z = 0;
  for (const f of fl) { const p = fleetPos(f); x += wrapDx(p0.x, p.x); z += p.z; }
  return { x: p0.x + x / fl.length, z: z / fl.length };
}

/** Fleets of power `f`'s side (it and its allies) at sea in zone `z` and free to fight. */
const freeFleets = (g: GameState, z: number, side: (o: number) => boolean) => g.fleets.filter(fl => fl.sea === undefined && side(fl.owner) && atSea(fl) && fleetZone(fl) === z && !calm(g, fl));
/** A fleet that just got away from a battle is not caught again for a while. */
const calm = (g: GameState, fl: Fleet) => (fl.calm ?? -1) > g.time;

/**
 * A fleet enters zone `z`: a battle of its enemies already burning there takes it in; enemy warships stationed there intercept it.
 * Returns true when the fleet is now fighting.
 */
export function joinSeaBattle(g: GameState, fl: Fleet, z: number): boolean {
  const run = (g.seaBattles ?? []).find(b => !b.ended && b.zone === z && b.sides.some((s, i) => s.some(o => atWar(g, o, fl.owner)) && !b.sides[1 - i].some(o => atWar(g, o, fl.owner))));
  if (run) { const side = run.sides[0].some(o => atWar(g, o, fl.owner)) ? 1 : 0; if (!run.sides[side].includes(fl.owner)) run.sides[side].push(fl.owner); spawn(g, run, fl, side); run.hp0[side] = sideHp(run, side); return true; }
  if (calm(g, fl)) return false;
  const foes = g.fleets.filter(o => o.sea === undefined && o.state === 'stationed' && !calm(g, o) && atWar(g, o.owner, fl.owner) && fleetZone(o) === z && fighting(g, o));
  if (!foes.length) return false;
  const enemy = foes[0].owner, mates = freeFleets(g, z, o => o === fl.owner || allied(g, o, fl.owner)).filter(o => o.state === 'stationed' || o === fl);
  if (!mates.includes(fl)) mates.push(fl);
  const theirs = freeFleets(g, z, o => o === enemy || (allied(g, o, enemy) && atWar(g, o, fl.owner))).filter(o => o.state === 'stationed');
  if (!theirs.length) return false;
  // the warships have found the convoy: the fight opens within gun range
  startSeaBattle(g, z, theirs, mates, fleetPos(fl), fighting(g, fl) ? 26 : 13);
  return true;
}

/** Stationed warships of powers at war in the same zone fight (checked about once a second). */
export function seaBattleCheck(g: GameState) {
  if (!g.fleets?.length || Math.floor(g.time) === Math.floor(g.time - .05)) return;
  const zs = new Map<number, Fleet[]>();
  for (const fl of g.fleets) if (fl.sea === undefined && atSea(fl)) { const z = fleetZone(fl); if (z >= 0) { let l = zs.get(z); if (!l) zs.set(z, l = []); l.push(fl); } }
  for (const [z, list] of zs) {
    const st = list.filter(f => f.state === 'stationed' && fighting(g, f) && !calm(g, f));
    for (const a of st) {
      if (a.sea !== undefined) continue;
      const foe = list.find(o => o.sea === undefined && !calm(g, o) && atWar(g, a.owner, o.owner) && (o.state === 'stationed' || o.state === 'offshore' || o.state === 'beach' || o.state === 'unload' || o.state === 'muster'));
      if (!foe) continue;
      const s0 = list.filter(o => o.sea === undefined && (o.owner === a.owner || (allied(g, o.owner, a.owner) && atWar(g, o.owner, foe.owner))));
      const s1 = list.filter(o => o.sea === undefined && (o.owner === foe.owner || (allied(g, o.owner, foe.owner) && atWar(g, o.owner, a.owner))));
      const pa = fleetPos(a), pb = fleetPos(foe);
      const t0 = s0.filter(o => !calm(g, o)), t1 = s1.filter(o => !calm(g, o)); if (!t0.length || !t1.length) continue;
      startSeaBattle(g, z, t0, t1, { x: pa.x + wrapDx(pa.x, pb.x) / 2, z: (pa.z + pb.z) / 2 }, fighting(g, foe) ? 30 : 14);
    }
  }
}

/** A power breaks off: its ships turn away and run for it. */
export function breakOff(g: GameState, fid: number, id: number): string | null {
  const b = (g.seaBattles ?? []).find(x => x.id === id && !x.ended); if (!b) return 'That battle is over.';
  const s = sideOf(b, fid); if (s < 0) return 'Your ships are not in that battle.';
  b.brk[s] = true; b.brkT ??= b.age; for (const a of b.agents) if (sideOf(b, a.f) === s) a.brk = true;
  return null;
}

// ---------------------------------------------------------------- the fight

const statsOf = (k: ShipAgentKind): { speed: number; turn: number } => k === 'dn' ? { speed: N.dn.speed, turn: .22 } : k === 'dd' ? { speed: N.dd.speed, turn: .7 } : k === 'cv' ? { speed: N.cv.speed, turn: .25 } : k === 'tr' ? { speed: N.tr.speed, turn: .3 } : k === 'lc' ? { speed: N.lc.speed, turn: .5 } : { speed: N.plane.speed, turn: 2 };

function steer(a: ShipAgent, want: number, turn: number, dt: number) { const d = wrapA(want - a.hd); a.hd = wrapA(a.hd + Math.max(-turn * dt, Math.min(turn * dt, d))); }

function nearest(b: SeaBattle, a: ShipAgent, ok: (o: ShipAgent) => boolean, max = 1e9): number {
  let best = -1, bd = max * max;
  b.agents.forEach((o, i) => { if (!active(o) || sideOf(b, o.f) === sideOf(b, a.f) || !ok(o)) return; const d = (o.x - a.x) ** 2 + (o.z - a.z) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}

function hurt(g: GameState, b: SeaBattle, t: ShipAgent, dmg: number) {
  if (!active(t)) return;
  t.hp -= dmg;
  if (t.kind === 'dn' && t.hp > 0) {
    if (rnd(g) < N.fire.chance) t.fire = Math.max(t.fire, N.fire.time);
    if (rnd(g) < N.turretHit && t.tur > 0) t.tur--;
    const proof = t.f === 0 && g.day >= dayOf(1917, 1);
    if (!proof && rnd(g) < N.magazine) { t.hp = 0; boom(g, b, t.x, t.z, 3); }
  }
  if (t.hp <= 0) { t.dead = true; t.dieT = g.time; boom(g, b, t.x, t.z, t.kind === 'dn' || t.kind === 'cv' ? 2 : 1); const s = sideOf(b, t.f); b.sunk[s][t.kind] = (b.sunk[s][t.kind] ?? 0) + 1; }
}
function boom(g: GameState, b: SeaBattle, x: number, z: number, big: number) { if (g.fx && g.fx.length < FX_CAP) { const p = seaWorld(b, x, z); g.fx.push({ k: 'nboom', s: b.id, x: p.x, z: p.z, big }); } }

/** Turrets that bear on a target at relative bearing `rel` (2 forward, 1 midships, 2 aft). */
export function turretsBearing(rel: number, tur: number) {
  const d = Math.abs(wrapA(rel)) * 180 / Math.PI;
  const n = (d < 150 ? 2 : 0) + (d > 30 && d < 150 ? 1 : 0) + (d > 30 ? 2 : 0);
  return Math.round(n * tur / N.dn.turrets);
}

function fireAt(g: GameState, b: SeaBattle, a: ShipAgent, ti: number, guns: number, dmg: number, range: number, big: boolean) {
  const t = b.agents[ti], d = Math.hypot(t.x - a.x, t.z - a.z);
  if (a.tgt === ti) a.str++; else { a.str = 0; a.tgt = ti; }
  const acc = (N.acc.near + (N.acc.far - N.acc.near) * Math.min(1, d / range) + Math.min(N.acc.maxStraddle, a.str * N.acc.straddle)) * (t.kind === 'dd' ? .7 : 1);
  const krupp = nationOf(a.f).flags.krupp ? 1.2 : 1;
  for (let k = 0; k < guns; k++) {
    const hit = rnd(g) < acc, fl = .5 + d * .05;
    b.shells.push({ x: t.x + (hit ? 0 : (rnd(g) - .5) * 2.4), z: t.z + (hit ? 0 : (rnd(g) - .5) * 2.4), t: fl, f: a.f, tgt: ti, hit, dmg: dmg * krupp });
    if (g.fx && g.fx.length < FX_CAP) { const p0 = seaWorld(b, a.x, a.z), p1 = seaWorld(b, t.x + (hit ? 0 : (rnd(g) - .5) * 2.4), t.z + (hit ? 0 : (rnd(g) - .5) * 2.4)); g.fx.push({ k: 'nfire', s: b.id, x0: p0.x, z0: p0.z, x1: p1.x, z1: p1.z, fl, hit, big }); }
  }
  a.fireT = g.time; a.aim = wrapA(Math.atan2(t.x - a.x, t.z - a.z) - a.hd);
}

export function stepSeaBattle(g: GameState, b: SeaBattle, dt: number) {
  if (b.ended) return;
  b.age += dt;
  const A = b.agents, night = b.age >= b.night, rk = night ? .5 : 1;
  // the centre of each side's warships (or of all its ships)
  const cen = [0, 1].map(s => { let x = 0, z = 0, n = 0; for (const a of A) if (active(a) && a.kind !== 'pl' && sideOf(b, a.f) === s && (warship(a.kind) || !A.some(o => active(o) && sideOf(b, o.f) === s && warship(o.kind)))) { x += a.x; z += a.z; n++; } return n ? { x: x / n, z: z / n, n } : null; });
  const power = [0, 1].map(s => A.reduce((p, a) => p + (active(a) && sideOf(b, a.f) === s ? (a.kind === 'dn' ? a.hp * a.tur / N.dn.turrets : a.kind === 'dd' ? a.hp * .5 : a.kind === 'pl' ? 6 : a.kind === 'cv' ? a.hp * .1 : 0) : 0), 0));
  const leaders: number[] = [-1, -1];
  A.forEach((a, i) => { if (a.kind === 'dn' && active(a) && !a.brk && a.hp > a.hp0 * .3) { const s = sideOf(b, a.f); if (leaders[s] < 0) leaders[s] = i; } });
  const prevOf = new Map<number, number>(); { const last = [-1, -1]; A.forEach((a, i) => { if (a.kind === 'dn' && active(a) && !a.brk && a.hp > a.hp0 * .3) { const s = sideOf(b, a.f); if (last[s] >= 0) prevOf.set(i, last[s]); last[s] = i; } }); }
  for (let i = 0; i < A.length; i++) {
    const a = A[i]; if (!active(a)) continue;
    const s = sideOf(b, a.f), foe = cen[1 - s], S = statsOf(a.kind);
    a.cd -= dt;
    if (a.fire > 0) { a.fire -= dt; a.hp -= N.fire.dps * dt; if (a.hp <= 0) { hurt(g, b, a, 0); continue; } }
    let want = a.hd, v = S.speed;
    const dToFoe = foe ? Math.hypot(foe.x - a.x, foe.z - a.z) : 99, bearing = foe ? Math.atan2(foe.x - a.x, foe.z - a.z) : a.hd;
    const flee = a.brk || ((a.kind === 'dn' || a.kind === 'cv') && a.hp < a.hp0 * .3) || (a.kind === 'dd' && a.hp < a.hp0 * .25);
    if (a.kind === 'pl') {
      a.fuel = (a.fuel ?? 0) - dt;
      if (a.fuel <= 0) {
        // back to the carrier, or lost at sea
        const cv = A.find(o => o.kind === 'cv' && o.ship === a.cv && active(o));
        if (!cv) { a.dead = true; a.dieT = g.time; continue; }
        const dd = Math.hypot(cv.x - a.x, cv.z - a.z); steer(a, Math.atan2(cv.x - a.x, cv.z - a.z), S.turn, dt);
        if (dd < 1) { a.out = true; continue; }
      } else {
        if (a.tgt < 0 || !active(A[a.tgt]) || rnd(g) < dt * .5) a.tgt = nearest(b, a, o => o.kind === 'pl', 8) >= 0 ? nearest(b, a, o => o.kind === 'pl', 8) : nearest(b, a, o => o.kind !== 'pl');
        if (a.tgt >= 0) {
          const t = A[a.tgt], d = Math.hypot(t.x - a.x, t.z - a.z), want2 = Math.atan2(t.x - a.x, t.z - a.z); steer(a, want2, S.turn, dt);
          if (d < N.plane.range && a.cd <= 0 && Math.abs(wrapA(want2 - a.hd)) < .6) {
            a.cd = N.plane.reload * (.8 + rnd(g) * .4); a.fireT = g.time;
            if (t.kind === 'pl') { if (rnd(g) < .4) hurt(g, b, t, 4); }
            else if (rnd(g) < .55) hurt(g, b, t, N.plane.dmg * (t.kind === 'tr' || t.kind === 'lc' ? 2 : 1));
            if (g.fx && g.fx.length < FX_CAP) { const p0 = seaWorld(b, a.x, a.z), p1 = seaWorld(b, t.x, t.z); g.fx.push({ k: 'nfire', s: b.id, x0: p0.x, z0: p0.z, x1: p1.x, z1: p1.z, fl: .3, hit: true, big: false }); }
          }
        }
      }
      a.x += Math.sin(a.hd) * S.speed * dt; a.z += Math.cos(a.hd) * S.speed * dt; a.v = S.speed;
      continue;
    }
    if (flee) {
      // turn away from the enemy and run for the edge of the area
      want = bearing + Math.PI; v = S.speed * (a.hp < a.hp0 * .3 ? .55 : 1);
    } else if (a.kind === 'tr' || a.kind === 'lc') {
      // keep the own warships between them and the enemy, and slip away
      want = foe ? bearing + Math.PI + (a.id % 2 ? .5 : -.5) : a.hd;
    } else if (a.kind === 'cv') {
      want = foe && dToFoe < 20 ? bearing + Math.PI : bearing + Math.PI / 2;
    } else if (a.kind === 'dn') {
      const lead = leaders[s] === i, strong = power[s] >= power[1 - s] * .9, R = N.dn.range * rk;
      if (a.evade !== undefined && a.evade > b.age) want = bearing + Math.PI + (s ? .9 : -.9);
      else if (lead && foe) {
        const el = leaders[1 - s] >= 0 ? A[leaders[1 - s]] : null;
        if (dToFoe > R * .9) {
          // close in, aiming ahead of the enemy's van to cross his T; the weaker side keeps its distance
          if (strong && el) { const px = el.x + Math.sin(el.hd) * 9, pz = el.z + Math.cos(el.hd) * 9; want = Math.atan2(px - a.x, pz - a.z); }
          else if (strong) want = bearing;
          else want = dToFoe > R * 1.15 ? bearing : bearing + (wrapA(a.hd - bearing) > 0 ? 1 : -1) * Math.PI / 2;
        } else {
          // in range: broadside on, turning the way that keeps across the enemy's line; the weaker side turns away when pressed
          const side = wrapA(a.hd - bearing) > 0 ? 1 : -1;
          want = bearing + side * Math.PI / 2 * (strong ? 1 : 1.25);
          if (!strong && dToFoe < R * .55) want = bearing + side * Math.PI * .8;
        }
      } else if (!lead) {
        // follow the ship ahead in line
        const pi = prevOf.get(i), p = pi !== undefined ? A[pi] : leaders[s] >= 0 ? A[leaders[s]] : null;
        if (p) { const tx = p.x - Math.sin(p.hd) * N.dn.spacing, tz = p.z - Math.cos(p.hd) * N.dn.spacing, dd = Math.hypot(tx - a.x, tz - a.z); want = Math.atan2(tx - a.x, tz - a.z); v = S.speed * Math.max(.6, Math.min(1.5, .8 + dd * .2)); if (p.evade !== undefined && p.evade > b.age) a.evade = p.evade; }
      }
    } else if (a.kind === 'dd') {
      const tdn = nearest(b, a, o => o.kind === 'dn');
      if (a.run && tdn >= 0) {
        const t = A[tdn], d = Math.hypot(t.x - a.x, t.z - a.z); want = Math.atan2(t.x - a.x, t.z - a.z);
        if (d < N.dd.torpRange * (night ? 1.2 : 1)) {
          // a spread of torpedoes at the target's future position; the enemy line turns away
          const lead = d / .9, tx2 = t.x + Math.sin(t.hd) * t.v * lead, tz2 = t.z + Math.cos(t.hd) * t.v * lead;
          b.torps.push({ x: a.x, z: a.z, hd: Math.atan2(tx2 - a.x, tz2 - a.z), t: 12, f: a.f });
          a.torps--; a.run = false;
          for (const o of A) if (o.kind === 'dn' && sideOf(b, o.f) === 1 - s && active(o) && rnd(g) < .7) { o.evade = b.age + 10; o.str = 0; }
        }
      } else {
        if (a.torps > 0 && tdn >= 0 && b.age > 12 && rnd(g) < dt * (night ? .12 : .05)) a.run = true;
        // screen ahead of the own line, towards the enemy
        const own = cen[s];
        if (own && foe) { const ux = (foe.x - own.x), uz = (foe.z - own.z), L = Math.hypot(ux, uz) || 1, tx = own.x + ux / L * 4, tz = own.z + uz / L * 4; want = Math.atan2(tx - a.x, tz - a.z); if (Math.hypot(tx - a.x, tz - a.z) < 1.5) want = a.hd + .6; }
      }
      v = a.run ? S.speed * 1.1 : S.speed * .8;
    }
    // stay inside the area unless leaving it
    if (!flee && a.kind !== 'tr' && a.kind !== 'lc' && (Math.abs(a.x) > N.halfW * .85 || Math.abs(a.z) > N.halfH * .85)) want = Math.atan2(-a.x, -a.z);
    steer(a, want, S.turn * (a.hp < a.hp0 * .3 ? .5 : 1), dt);
    a.v = v; a.x += Math.sin(a.hd) * v * dt; a.z += Math.cos(a.hd) * v * dt;
    if (Math.abs(a.x) > N.halfW || Math.abs(a.z) > N.halfH) { a.out = true; continue; }
    // gunnery
    if (a.cd > 0) continue;
    if (a.kind === 'dn' && a.tur > 0) {
      const R = N.dn.range * rk;
      const ti = a.tgt >= 0 && active(A[a.tgt]) && A[a.tgt].kind !== 'pl' && Math.hypot(A[a.tgt].x - a.x, A[a.tgt].z - a.z) <= R ? a.tgt : nearest(b, a, o => o.kind !== 'pl', R);
      if (ti < 0) { a.cd = .5; continue; }
      const t = A[ti], guns = turretsBearing(Math.atan2(t.x - a.x, t.z - a.z) - a.hd, a.tur);
      if (guns <= 0 || (a.evade !== undefined && a.evade > b.age)) { a.cd = .5; continue; }
      fireAt(g, b, a, ti, guns, N.dn.dmg, R, true);
      a.cd = N.dn.reload * (.85 + rnd(g) * .3);
    } else if (a.kind === 'dd' || a.kind === 'cv') {
      const R = (a.kind === 'dd' ? N.dd.range : N.cv.range) * rk;
      const ti = nearest(b, a, o => o.kind !== 'pl', R); if (ti < 0) { a.cd = .5; continue; }
      fireAt(g, b, a, ti, 1, a.kind === 'dd' ? N.dd.dmg : N.cv.dmg, R, false);
      a.cd = (a.kind === 'dd' ? N.dd.reload : N.cv.reload) * (.85 + rnd(g) * .3);
    } else a.cd = 1;
  }
  // soft separation between ships
  for (let i = 0; i < A.length; i++) { const a = A[i]; if (!active(a) || a.kind === 'pl') continue; for (let j = i + 1; j < A.length; j++) { const o = A[j]; if (!active(o) || o.kind === 'pl') continue; const dx = o.x - a.x, dz = o.z - a.z, d2 = dx * dx + dz * dz; if (d2 < 2.2 && d2 > 1e-6) { const d = Math.sqrt(d2), p = (1.5 - d) * .25 / d; a.x -= dx * p; a.z -= dz * p; o.x += dx * p; o.z += dz * p; } } }
  // shells land
  for (let k = b.shells.length - 1; k >= 0; k--) { const sh = b.shells[k]; sh.t -= dt; if (sh.t > 0) continue; b.shells.splice(k, 1); const t = A[sh.tgt]; if (sh.hit && t && active(t)) hurt(g, b, t, sh.dmg); }
  // torpedoes run
  for (let k = b.torps.length - 1; k >= 0; k--) {
    const tp = b.torps[k]; tp.t -= dt; tp.x += Math.sin(tp.hd) * .9 * dt; tp.z += Math.cos(tp.hd) * .9 * dt;
    let hitI = -1; for (let i = 0; i < A.length; i++) { const o = A[i]; if (!active(o) || o.kind === 'pl' || sideOf(b, o.f) === sideOf(b, tp.f)) continue; if ((o.x - tp.x) ** 2 + (o.z - tp.z) ** 2 < .8) { hitI = i; break; } }
    if (hitI >= 0) { const o = A[hitI]; if (rnd(g) < .55) { hurt(g, b, o, N.dd.torpDmg * (night ? 2 : 1)); boom(g, b, o.x, o.z, 1.5); } b.torps.splice(k, 1); continue; }
    if (tp.t <= 0) b.torps.splice(k, 1);
  }
  // breaking off below half the starting strength
  for (const s of [0, 1]) if (!b.brk[s] && b.hp0[s] > 0 && sideHp(b, s) < b.hp0[s] * N.breakOff && A.some(a => active(a) && sideOf(b, a.f) === s && warship(a.kind))) { b.brk[s] = true; b.brkT = b.age; for (const a of A) if (sideOf(b, a.f) === s) a.brk = true; }
  // the end: one side gone, nobody left with guns, or the battle has run its time
  if (Math.floor(b.age * 2) === Math.floor((b.age - dt) * 2)) return;
  const alive = [0, 1].map(s => A.filter(a => active(a) && a.kind !== 'pl' && sideOf(b, a.f) === s));
  const guns = alive.map(l => l.some(a => warship(a.kind)));
  let w = -2;
  if (!alive[0].length && !alive[1].length) w = -1;
  else if (!alive[0].length) w = 1; else if (!alive[1].length) w = 0;
  else if (!guns[0] && !guns[1]) w = -1;
  else if (b.age >= N.maxAge || (b.brkT !== undefined && b.age - b.brkT > N.afterBreak)) w = b.brkT !== undefined && b.brk[0] !== b.brk[1] ? (b.brk[0] ? 1 : 0) : sideHp(b, 0) / Math.max(1, b.hp0[0]) > sideHp(b, 1) / Math.max(1, b.hp0[1]) + .15 ? 0 : sideHp(b, 1) / Math.max(1, b.hp0[1]) > sideHp(b, 0) / Math.max(1, b.hp0[0]) + .15 ? 1 : -1;
  if (w > -2) endSeaBattle(g, b, w);
}

/** Losses carry over: sunk ships are gone, squadrons keep the hit points their ships have left. Fleets sail on or go home. */
function endSeaBattle(g: GameState, b: SeaBattle, w: number) {
  b.ended = true; b.removeAt = g.time + 12; b.winner = w;
  const byShip = new Map<number, ShipAgent[]>(); for (const a of b.agents) { let l = byShip.get(a.ship); if (!l) byShip.set(a.ship, l = []); l.push(a); }
  for (const [id, list] of byShip) {
    const s = g.ships.find(x => x.id === id); if (!s) continue;
    const fl = fleetOf(g, s.fleet);
    if (s.kind === 'bb') {
      const dn = list.filter(a => a.kind === 'dn' && !a.dead);
      if (!dn.length) { sinkShip(g, s); continue; }
      s.hp = Math.max(1, list.reduce((h, a) => h + (a.dead ? 0 : Math.max(0, a.hp)), 0));
    } else if (s.kind === 'carrier') {
      const cv = list.find(a => a.kind === 'cv'); if (!cv || cv.dead) { sinkShip(g, s); continue; }
      s.hp = Math.max(1, cv.hp); s.planes = list.filter(a => a.kind === 'pl' && !a.dead).length;
    } else {
      const a = list[0]; if (a.dead) { if (fl) { const of = fleetShips(g, fl).filter(x => x.kind === 'trans' || x.kind === 'land').length; const men = loseCargo(fl, 1, of); if (men > 0) emit(g, { k: 'convoyLost', faction: s.owner, zone: b.zone, ships: 1, men, by: 'navy' }); } sinkShip(g, s); continue; }
      s.hp = Math.max(1, a.hp);
    }
  }
  for (const id of b.fleets) {
    const fl = fleetOf(g, id); if (!fl) continue; fl.sea = undefined; fl.calm = g.time + 40;
    if (!fleetShips(g, fl).length) continue;
    const side = sideOf(b, fl.owner), lost = w >= 0 && side !== w;
    if ((fl.task === 'station' && (lost || b.brk[side])) || (fl.task === 'station' && fleetShips(g, fl).every(s => s.hp < shipMax(s) * .4))) goHome(g, fl);
  }
  emit(g, { k: 'seaBattle', zone: b.zone, sides: b.sides.map(s => [...s]), winner: w, sunk: b.sunk, start: false, id: b.id });
}

export function stepSeaBattles(g: GameState, dt: number) {
  const L = g.seaBattles; if (!L?.length) return;
  for (const b of L) stepSeaBattle(g, b, dt);
  for (let i = L.length - 1; i >= 0; i--) if (L[i].ended && g.time > L[i].removeAt) L.splice(i, 1);
}
export { fleetZone };
