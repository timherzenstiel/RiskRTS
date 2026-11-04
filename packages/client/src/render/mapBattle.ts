// Map-scale war: what a battle looks like from the strategic zoom. Two lines of troops trade tracer fire across the region,
// shells and rocket volleys land among them, craters scorch the ground and burn, and smoke climbs over the front.
// Purely visual and seeded per battle; it never reads or changes the simulation beyond the alive counts.
import { battleCounts, tileAtW, type Battle, type GameState, type World } from '@riskrts/shared';
import { Sfx } from '../audio/sfx';
import type { CameraRig } from './camera';
import { MAP_S } from './dynamic';
import { F_BALL, F_DUST, F_FLAME, F_GLOW, F_HOT, SCORCH, type FxSystem } from './fxSystem';
import type { Models } from './models';
import { K } from './palette';
import { FLAME as FLAME_K, GLOW, type Sprites } from './sprites';
import type { Terrain } from './terrain';
import { clamp, col } from './util';

const EMBER = col('#ff5e1a'), FLAME = col('#ffa23a'), ROCKET = col('#ffe7a8'), BLACK = col('#26231f');

interface Scar { x: number; z: number; y: number; r: number; rot: number; fire: number; fire0: number }
interface Rocket { x0: number; z0: number; y0: number; x1: number; z1: number; y1: number; t: number; dur: number; h: number; f: number }
interface Fig { u: number; v: number; tank: boolean; crouch: boolean; ph: number }
interface Front {
  region: number; cx: number; cz: number;
  /** Unit vector towards the attackers, and its perpendicular. */
  ax: number; az: number; px: number; pz: number;
  sides: [number, number];
  figs: [Fig[], Fig[]];
  scars: Scar[]; rockets: Rocket[];
  gunT: number; shellT: number; volleyT: number; volleyLeft: number; volleySide: number; volleyGap: number; smokeT: number;
  /** Seconds since the battle ended (scars cool and fade), or -1 while it rages. */
  over: number;
  alive: [number, number];
  seed: number;
}

const MAX_SCARS = 60;

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

export class MapBattles {
  private readonly fronts = new Map<number, Front>();
  /** Effect size multiplier: grows as the camera pulls back so explosions stay readable. */
  private k = 1;

  constructor(private readonly world: World, private readonly terrain: Terrain, private readonly m: Models, private readonly fx: FxSystem) {}

  private land(x: number, z: number) { const i = tileAtW(x, z); return i >= 0 && this.world.land[i]; }
  /** Ground height: the higher of the close-up surface and the map tile top, so marks never sink under the map-scale ground. */
  private gy(x: number, z: number) { const i = tileAtW(x, z), t = i >= 0 && this.world.land[i] ? this.terrain.tileH[i] : 0; return Math.max(this.terrain.surfaceAt(x, z), t); }

  private make(b: Battle): Front {
    const r = this.world.regions[b.region];
    let ax = b.ax, az = b.az; const l = Math.hypot(ax, az);
    if (!(l > 1e-6)) { ax = 1; az = 0; } else { ax /= l; az /= l; }
    const R = rng(b.id * 9973 + b.region * 31 + 7);
    const figs = (): Fig[] => Array.from({ length: 14 }, (_, i) => ({ u: R(), v: R(), tank: i % 6 === 5, crouch: R() < .5, ph: R() * 6 }));
    const def = b.def >= 0 ? b.def : (b.sides.find(f => f !== b.attacker) ?? -1);
    return {
      region: b.region, cx: r.cx, cz: r.cz, ax, az, px: -az, pz: ax, sides: [b.attacker, def], figs: [figs(), figs()],
      scars: [], rockets: [], gunT: 0, shellT: .5, volleyT: 2 + R() * 3, volleyLeft: 0, volleySide: 0, volleyGap: 0, smokeT: 0, over: -1, alive: [0, 0], seed: b.id,
    };
  }

  /** A point on one side of the front: side 0 = attackers, 1 = defenders. `u` 0..1 across the front, `v` 0..1 depth behind it. */
  private pt(F: Front, side: number, u: number, v: number, out: { x: number; z: number }) {
    const across = (u - .5) * 4.2, depth = .15 + v * 1.05, d = side === 0 ? depth + .2 : -depth + .2;
    out.x = F.cx + F.ax * d + F.px * across; out.z = F.cz + F.az * d + F.pz * across;
    return out;
  }

  /** Spawn effects. `close(b)` is true when the battle's close-up troops are drawn instead. */
  update(g: GameState, rig: CameraRig, dt: number, close: (b: Battle) => boolean) {
    this.k = clamp(rig.dist / 16, .8, 6);
    const seen = new Set<number>();
    for (const b of g.battles) {
      let F = this.fronts.get(b.region);
      if (!F || (F.over >= 0 && !b.ended)) { const old = F; F = this.make(b); if (old) F.scars = old.scars; this.fronts.set(b.region, F); }
      seen.add(b.region);
      if (b.ended) { if (F.over < 0) F.over = 0; continue; }
      const cnt = battleCounts(b); F.alive = [cnt.get(F.sides[0])?.[0] ?? 0, cnt.get(F.sides[1])?.[0] ?? 0];
      if (F.sides[1] < 0) for (const [f, c] of cnt) if (f !== F.sides[0]) { F.sides[1] = f; F.alive[1] = c[0]; }
      if (close(b)) { F.rockets.length = 0; continue; }
      const onScreen = Math.abs(F.cx - rig.tx) < rig.dist * 1.25 + 3 && Math.abs(F.cz - rig.tz) < rig.dist * .75 + 3;
      if (onScreen) this.fight(F, dt, rig.dist);
    }
    for (const [rid, F] of this.fronts) {
      if (!seen.has(rid) && F.over < 0) F.over = 0;
      if (F.over >= 0) { F.over += dt; this.flyRockets(F, dt); if (F.over > 90) this.fronts.delete(rid); }
      this.burn(F, dt);
    }
  }

  private fight(F: Front, dt: number, dist: number) {
    const fx = this.fx, k = this.k, tot = F.alive[0] + F.alive[1], I = clamp(tot / 30, .35, 1.3), p = { x: 0, z: 0 }, q = { x: 0, z: 0 };
    // small-arms fire: tracers between the lines, with muzzle flashes
    F.gunT -= dt * 26 * I;
    while (F.gunT < 0) {
      F.gunT += 1;
      const side = Math.random() < F.alive[0] / Math.max(1, tot) ? 0 : 1;
      if (!F.alive[side]) continue;
      const a = this.pt(F, side, Math.random(), Math.random() * .5, p), b = this.pt(F, 1 - side, Math.random(), Math.random() * .6, q);
      if (!this.land(a.x, a.z)) continue;
      const ya = this.gy(a.x, a.z) + .04, yb = this.gy(b.x, b.z) + .03;
      // tracers are drawn short, as bright dashes flying part of the way
      const t0 = Math.random() * .3, t1 = t0 + .25 + Math.random() * .3;
      fx.tracer(a.x + (b.x - a.x) * t0, ya + (yb - ya) * t0, a.z + (b.z - a.z) * t0, a.x + (b.x - a.x) * t1, ya + (yb - ya) * t1, a.z + (b.z - a.z) * t1, .09);
      fx.spawn(a.x, ya, a.z, 0, 0, 0, 0, .07, .035 * k, .01, K.flash, F_GLOW);
      if (Math.random() < .5) { const fl = .22; fx.spawn(a.x, ya, a.z, (b.x - a.x) / fl, (yb - ya) / fl, (b.z - a.z) / fl, 0, fl, .02 * k, .015 * k, K.tracer, F_GLOW); }
    }
    // artillery and mortar shells
    F.shellT -= dt * 2.6 * I;
    if (F.shellT < 0) {
      F.shellT += .3 + Math.random() * .7;
      const side = Math.random() < .5 ? 0 : 1, at = this.pt(F, side, Math.random(), Math.random(), p);
      if (this.land(at.x, at.z)) this.explode(at.x, at.z, .8 + Math.random() * .5, Math.random() < .5, dist);
    }
    // rocket volleys (Katyusha-style ripples), alternating sides
    F.volleyT -= dt;
    if (F.volleyT < 0 && F.volleyLeft <= 0) {
      F.volleyT = 5 + Math.random() * 6; F.volleyLeft = 5 + Math.floor(Math.random() * 6 * I); F.volleyGap = 0;
      F.volleySide = F.alive[0] && (!F.alive[1] || Math.random() < .55) ? 0 : 1;
    }
    if (F.volleyLeft > 0) {
      F.volleyGap -= dt;
      if (F.volleyGap <= 0) {
        F.volleyGap = .09 + Math.random() * .08; F.volleyLeft--;
        const s = F.volleySide, from = this.pt(F, s, .35 + Math.random() * .3, 1.4, p), to = this.pt(F, 1 - s, Math.random(), Math.random() * .9, q);
        const y0 = this.gy(from.x, from.z) + .06, y1 = this.gy(to.x, to.z), len = Math.hypot(to.x - from.x, to.z - from.z);
        F.rockets.push({ x0: from.x, z0: from.z, y0, x1: to.x, z1: to.z, y1, t: 0, dur: .9 + len * .35, h: .45 + len * .35, f: F.sides[s] });
        fx.spawn(from.x, y0, from.z, 0, .05, 0, 0, .12, .08 * k, .02, K.flash, F_GLOW);
        fx.spawn(from.x, y0, from.z, (Math.random() - .5) * .1, .1, (Math.random() - .5) * .1, 0, 1.6, .05 * k, .16 * k, K.smoke);
      }
    }
    this.flyRockets(F, dt);
    // a pall of smoke drifting over the front
    F.smokeT -= dt * (2 + I * 2);
    if (F.smokeT < 0) {
      F.smokeT += 1;
      const at = this.pt(F, Math.random() < .5 ? 0 : 1, Math.random(), Math.random() * .6, p);
      fx.spawn(at.x, this.gy(at.x, at.z) + .1, at.z, .06, .1 + Math.random() * .08, .02, 0, 3 + Math.random() * 2, .04 * k, .17 * k, Math.random() < .7 ? K.smoke : K.smoke2);
    }
  }

  private flyRockets(F: Front, dt: number) {
    const fx = this.fx, k = this.k;
    for (let i = F.rockets.length - 1; i >= 0; i--) {
      const r = F.rockets[i]; r.t += dt / r.dur;
      if (r.t >= 1) {
        F.rockets.splice(i, 1);
        if (this.land(r.x1, r.z1)) this.explode(r.x1, r.z1, 1.1, Math.random() < .55, 0); else fx.spawn(r.x1, .02, r.z1, 0, .5, 0, 1.2, .7, .05 * k, .02, K.cloud);
        continue;
      }
      const t = r.t, x = r.x0 + (r.x1 - r.x0) * t, z = r.z0 + (r.z1 - r.z0) * t, y = r.y0 + (r.y1 - r.y0) * t + r.h * 4 * t * (1 - t);
      if (Math.random() < dt * 30) fx.spawn(x, y, z, (Math.random() - .5) * .03, .02, (Math.random() - .5) * .03, 0, 1.1 + Math.random() * .6, .025 * k, .09 * k, Math.random() < .6 ? K.smoke : K.cloud2);
      if (Math.random() < dt * 15) fx.spawn(x, y, z, 0, 0, 0, 0, .08, .03 * k, .01, FLAME, F_GLOW);
    }
  }

  /** A shell or rocket landing: flash, fireball, flying dirt, a smoke column and (often) a scorched crater. */
  private explode(x: number, z: number, s: number, scar: boolean, dist: number) {
    const fx = this.fx, k = this.k, y = this.gy(x, z);
    const R = Math.random;
    fx.spawn(x, y + .05, z, 0, 0, 0, 0, .14, .2 * s * k, .38 * s * k, K.flash, F_GLOW);
    fx.spawn(x, y + .06, z, 0, .2 * k, 0, 0, .8, .08 * s * k, .22 * s * k, K.fire, F_BALL);
    for (let i = 0; i < 3; i++) fx.spawn(x + (R() - .5) * .05 * k, y + .03, z + (R() - .5) * .05 * k, 0, .12 * k, 0, 0, .5 + R() * .4, .05 * s * k, .1 * s * k, K.fire, F_FLAME);
    for (let i = 0; i < 4; i++) { const an = R() * 6.28; fx.spawn(x, y + .05, z, Math.cos(an) * .25 * k, .2 + R() * .3, Math.sin(an) * .25 * k, 0, .35 + R() * .2, .02 * k, .01 * k, R() < .5 ? FLAME : EMBER, F_GLOW); }
    for (let i = 0; i < 7; i++) {
      const an = R() * 6.28, sp = (.3 + R() * .5) * Math.min(k, 1.6);
      fx.spawn(x, y + .03, z, Math.cos(an) * sp * .4, (.6 + R() * .7) * Math.min(k, 1.6), Math.sin(an) * sp * .4, 3.2, .9, .022 * k, .016 * k, R() < .6 ? K.dirt : K.boot, 0, y);
    }
    for (let i = 0; i < 6; i++) { const an = i / 6 * 6.28 + R() * .6, sp = (.12 + R() * .08) * s * k; fx.spawn(x, y + .03, z, Math.cos(an) * sp, .012 * k, Math.sin(an) * sp, 0, 1.5 + R(), .04 * s * k, .13 * s * k, K.dust, F_DUST); }
    for (let i = 0; i < 3; i++) fx.spawn(x + (R() - .5) * .08 * k, y + .1, z + (R() - .5) * .08 * k, .03, (.14 + R() * .1) * Math.min(k, 2), .01, 0, 2.4 + R() * 1.6, .06 * s * k, .2 * s * k, i ? K.smoke : K.smoke2, F_HOT);
    if (dist > 0 && Math.random() < .25) Sfx.rumble(Math.max(.15, 1 - dist / 160));
    if (scar) this.addScar(x, z, y, s);
  }

  private addScar(x: number, z: number, y: number, s: number) {
    for (const F of this.fronts.values()) {
      if (Math.hypot(F.cx - x, F.cz - z) > 3.2) continue;
      const fire = Math.random() < .6 ? 10 + Math.random() * 25 : 0;
      F.scars.push({ x, z, y, r: (.08 + Math.random() * .1) * s, rot: Math.random() * 3.14, fire, fire0: fire });
      if (F.scars.length > MAX_SCARS) { const i = F.scars.findIndex(c => c.fire <= 0); F.scars.splice(i >= 0 ? i : 0, 1); }
      return;
    }
  }

  /** Burning craters throw flames and smoke while their fire lasts. */
  private burn(F: Front, dt: number) {
    const fx = this.fx, k = this.k;
    for (const c of F.scars) {
      if (c.fire <= 0) continue;
      c.fire -= dt * (F.over >= 0 ? 2 : 1);
      // sparks drifting up, and a column of oily black smoke lit by the fire underneath
      if (Math.random() < dt * 5) fx.spawn(c.x + (Math.random() - .5) * c.r, c.y + .03, c.z + (Math.random() - .5) * c.r, (Math.random() - .5) * .04, .15 + Math.random() * .12, 0, 0, .6 + Math.random() * .4, .012 * k, .006 * k, Math.random() < .5 ? FLAME : EMBER, F_GLOW);
      if (Math.random() < dt * 3.5) fx.spawn(c.x, c.y + .06, c.z, .05, .14 + Math.random() * .1, .015, 0, 3 + Math.random() * 2, .03 * k, .16 * k, Math.random() < .5 ? BLACK : K.smoke2, F_HOT);
    }
  }

  /** Draw troops, rocket heads, scorched ground and flames. */
  draw(g: GameState, T: number, close: (b: Battle) => boolean, sp: Sprites) {
    const m = this.m, p = { x: 0, z: 0 };
    const active = new Map<number, Battle>(); for (const b of g.battles) if (!b.ended) active.set(b.region, b);
    for (const F of this.fronts.values()) {
      const b = active.get(F.region), isClose = !!b && close(b);
      // scorched craters (they stay a while after the battle, slowly shrinking)
      const fade = F.over < 0 ? 1 : clamp(1 - (F.over - 30) / 60, 0, 1);
      if (fade > 0 && !isClose) for (const c of F.scars) {
        const life = c.fire > 0 ? clamp(c.fire / Math.max(1, c.fire0) * 1.5, .2, 1) : 0;
        sp.decal(c.x, c.y, c.z, c.r * 2.6, c.r * 2.1, SCORCH, fade, c.rot, c.rot * .159, life);
        if (c.fire > 0) {
          // two or three flame tongues licking up out of the crater
          const w = Math.max(c.r * 1.3, .04 * this.k) * life, sd = c.rot * .159;
          for (let j = 0; j < 3; j++) {
            const ox = Math.cos(c.rot + j * 2.1) * c.r * .45, oz = Math.sin(c.rot + j * 2.1) * c.r * .35, ww = w * (j ? .7 : 1);
            sp.fire(c.x + ox, c.y + ww * 1.7 * .42, c.z + oz, ww, ww * 1.9, K.fire, .9, sd + j * .31, 0, FLAME_K);
          }
          sp.fire(c.x, c.y + w * .3, c.z, w * 2.6, w * 2.6, EMBER, .35 * (.8 + .2 * Math.sin(T * 9 + c.rot * 7)), sd, 0, GLOW);
        }
      }
      if (!b || isClose) continue;
      // the two lines of troops (one figure per few men), dug in facing each other
      for (let s = 0; s < 2; s++) {
        const f = F.sides[s]; if (f < 0) continue;
        const n = Math.min(F.figs[s].length, Math.ceil(F.alive[s] / 2)), face = Math.atan2(F.ax, F.az) + (s === 0 ? Math.PI : 0);
        for (let i = 0; i < n; i++) {
          const fg = F.figs[s][i], at = this.pt(F, s, fg.u, fg.v * .45, p);
          if (!this.land(at.x, at.z)) continue;
          const y = this.gy(at.x, at.z);
          if (fg.tank) m.unit('tank', at.x, y, at.z, face, f, MAP_S * .9, 0, Math.max(0, Math.sin(T * 2 + fg.ph * 3)) > .97 ? 1 : 0);
          else m.soldier(at.x, y, at.z, face + Math.sin(T * .7 + fg.ph) * .3, f, MAP_S, fg.crouch, 0);
        }
      }
      // rocket heads
      for (const r of F.rockets) {
        const t = r.t, x = r.x0 + (r.x1 - r.x0) * t, z = r.z0 + (r.z1 - r.z0) * t, y = r.y0 + (r.y1 - r.y0) * t + r.h * 4 * t * (1 - t);
        sp.fire(x, y, z, .045 * this.k, .045 * this.k, ROCKET, 1, 0, t, GLOW);
      }
    }
  }

  clear() { this.fronts.clear(); }
}
