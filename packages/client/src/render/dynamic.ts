// Per-frame drawing of everything that changes: garrisons, buildings, defences, flags, marching armies, ships and flights.
// Everything is drawn at map scale: a soldier is about the height of a village house, a tank about a house long.
// All of it is pushed into instanced pools; nothing here allocates.
import { DEF_KINDS, HW, armyPos, tileAtW, type GameState, type World } from '@riskrts/shared';
import type { CameraRig } from './camera';
import type { FxSystem } from './fxSystem';
import { F_MAP } from './fxSystem';
import type { Models } from './models';
import type { LineBatch } from './pools';
import { FLAGD, K, facCol } from './palette';
import { sectorPoint } from './sectors';
import type { Terrain } from './terrain';
import { lerp } from './util';

/** Map scale of figures and vehicles (1 = battlefield model size). */
export const MAP_S = .5;
/** Map scale of buildings relative to their original model size. */
const BLD = .5;

export class DynamicDraw {
  private factT = 0; private holdT = 0;
  /** Highlighted sector while the fortify tab is open: [region, sector] or null. */
  marker: [number, number] | null = null;
  constructor(private readonly world: World, private readonly terrain: Terrain, private readonly m: Models, private readonly lines: LineBatch, private readonly fx: FxSystem) {}

  private hAt(x: number, z: number, fallback: number) { const i = tileAtW(x, z); return i >= 0 && this.world.land[i] ? this.terrain.tileH[i] : fallback; }

  /** Garrison figures, flags, factories, barracks, airfields, trenches and fixed defences. */
  regions(g: GameState, rig: CameraRig, T: number) {
    const m = this.m, near = rig.dist < 26, cull = rig.dist * 3 + 8, S = MAP_S;
    for (const def of this.world.regions) {
      const t = g.regions[def.id], x = def.cx, z = def.cz;
      if (Math.abs(x - rig.tx) > cull || Math.abs(z - rig.tz) > cull) continue;
      const y = this.terrain.anchorH(def.id), f = t.owner;
      if (rig.dist < 45) this.defences(g, def.id, y, T);
      if (t.battle >= 0 && near) continue;
      const P = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, c: typeof K.pole, pool?: Parameters<Models['part']>[11]) => m.part(x, y, z, 0, lx, ly * BLD, lz, sx * BLD, sy * BLD, sz * BLD, c, pool);
      if (t.capitalOf >= 0 && t.capitalOf === f) {
        P(-.12, .45, -.32, .035, .9, .035, K.pole); P(-.12, .91, -.32, .05, .03, .05, K.flash);
        for (let k = 0; k < 6; k++) { const w = Math.sin(T * 3 + k * .8 + def.id) * .012 * k / 5; m.part(x, y, z, 0, -.095 + k * .03, .4, -.32 + w, .03, .11, .01, k % 2 ? facCol[f] : FLAGD[f]); }
      } else if (t.capitalOf >= 0) P(-.12, .3, -.32, .035, .6, .035, K.pole);
      if (t.factory) {
        const fx = .5, fz = -.22;
        P(fx, .15, fz, .5, .3, .38, K.brick);
        for (let k = 0; k < 3; k++) P(fx - .085 + k * .08, .34, fz, .13, .07, .38, K.brick2);
        P(fx + .08, .33, fz - .08, .1, .66, .1, K.brick2); P(fx + .08, .68, fz - .08, .12, .04, .12, K.gun);
        for (let k = 0; k < 3; k++) P(fx - .075 + k * .075, .16, fz + .095, .07, .08, .01, K.flash, m.glowPool);
      }
      if (t.barracks) {
        const bx = -.5, bz = -.18;
        P(bx, .08, bz, .6, .16, .3, K.bar); P(bx, .19, bz, .64, .06, .34, K.roof); P(bx, .235, bz, .4, .04, .2, K.roof);
        for (let k = 0; k < 4; k++) P(bx - .11 + k * .075, .09, bz + .076, .05, .05, .01, K.flash, m.glowPool);
      }
      if (t.airfield) m.airfield(x + .05, this.hAt(x + .05, z + .62, y), z + .62, Math.PI / 2, f, .7, t.battle >= 0 ? 0 : t.units.plane, T);
      for (let k = 0; k < t.trench * 4; k++) { const lx = -.3 + (k % 6) * .1, lz = .26 + Math.floor(k / 6) * .07; m.part(x, y, z, 0, lx, .018, lz, .085, .035, .05, (k % 2) ? K.sand : K.sand2); }
      if (t.battle >= 0) continue;
      this.garrison(x, y, z, f, t.units, S);
    }
  }

  /** A small formation: up to 12 riflemen, then gun teams, field guns and tanks beside them. */
  private garrison(x: number, y: number, z: number, f: number, u: GameState['regions'][number]['units'], S: number) {
    const m = this.m;
    const inf = u.inf ? Math.min(12, Math.max(1, Math.ceil(u.inf / 2))) : 0, cols = 4, sp = .055;
    for (let k = 0; k < inf; k++) { const cx = (k % cols) - (cols - 1) / 2, cz = Math.floor(k / cols); m.soldier(x + cx * sp, y, z + .05 + cz * sp, 0, f, S, false, 0); }
    for (let k = 0; k < Math.min(3, u.mg); k++) m.unit('mg', x - .09 + k * .09, y, z - .07, 0, f, S * .9, 0, 0);
    for (let k = 0; k < Math.min(3, u.art); k++) m.unit('art', x - .28, y, z + .02 + k * .1, .35, f, S * .9, 0, 0);
    for (let k = 0; k < Math.min(3, u.tank); k++) m.unit('tank', x + .3, y, z + .02 + k * .13, -.4, f, S * .9, 0, 0);
  }

  /** Fixed defences stand on their border sector, facing the neighbour they guard. */
  private defences(g: GameState, rid: number, y0: number, T: number) {
    const t = g.regions[rid]; if (!t.defs.length) return;
    const W = this.world, R = W.regions[rid], m = this.m;
    const bySec = new Map<number, number>();
    for (const d of t.defs) {
      const n = t.defs.filter(o => o.s === d.s).length, k = bySec.get(d.s) ?? 0; bySec.set(d.s, k + 1);
      const p = sectorPoint(W, rid, d.s), off = (k - (n - 1) / 2) * .16 * (d.s < 0 ? 1.4 : 1);
      const x = p.x + p.ux * off, z = p.z + p.uz * off, y = this.hAt(x, z, y0);
      const face = d.s < 0 ? 0 : Math.atan2(x - R.cx, z - R.cz), hold = d.f !== t.owner;
      const S = .72 * (.75 + .25 * Math.max(.2, d.hp / 80));
      if (d.k === 'pill') m.pillbox(x, y, z, face, d.f, S, hold);
      else if (d.k === 'fort') m.emplacement(x, y, z, face, d.f, S);
      else m.flak(x, y, z, face, d.f, S, 0);
      if (hold && Math.random() < .015) this.fx.spawn(x, y + .05, z, .01, .12, 0, 0, 2.5, .03, .12, K.smoke2, F_MAP);
    }
    void DEF_KINDS; void T;
  }

  /** Pulsing ring on the border sector picked in the fortify tab. */
  drawMarker(T: number) {
    if (!this.marker) return;
    const [rid, sec] = this.marker, p = sectorPoint(this.world, rid, sec), y = this.hAt(p.x, p.z, this.terrain.anchorH(rid)), r = .16 + Math.sin(T * 5) * .02;
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; this.m.part(p.x, y, p.z, -a, 0, .02, r, .045, .012, .012, K.flare, this.m.glowPool); }
  }

  /** Marching columns, ships carrying armies, aircraft in flight and their dashed route lines. */
  armies(g: GameState, T: number) {
    const m = this.m, S = MAP_S;
    for (const a of g.armies) {
      const [x, z] = armyPos(a), face = Math.atan2(a.dx, a.dz), c = Math.cos(face), s = Math.sin(face);
      if (a.air) {
        const y = Math.max(this.terrain.anchorH(a.from), this.terrain.anchorH(a.to)) + .9 + Math.sin(a.t * Math.PI) * .4, n = Math.min(3, a.units.plane);
        for (let k = 0; k < n; k++) { const bx = k === 0 ? 0 : (k === 1 ? -.14 : .14), bz = k === 0 ? 0 : -.12; m.plane(x + bx * c + bz * s, y + Math.sin(T * 3 + k) * .01, z - bx * s + bz * c, face, facCol[a.owner], .75, a.owner); }
      } else if (a.sea) m.ship(x, z, face, facCol[a.owner], 1.1, T);
      else {
        const y = lerp(this.terrain.anchorH(a.from), this.terrain.anchorH(a.to), a.t) + Math.sin(a.t * Math.PI) * .25;
        const tot = a.units.inf + a.units.mg + a.units.art + a.units.tank, n = Math.min(8, Math.max(2, Math.ceil(tot / 2)));
        for (let k = 0; k < n; k++) { const row = Math.floor(k / 2), side = (k % 2 ? 1 : -1) * .03; m.soldier(x - s * row * .06 + c * side, y, z - c * row * .06 - s * side, face, a.owner, S, false, T * 9 + k * 1.3); }
        if (a.units.tank) m.unit('tank', x + s * .1, y, z + c * .1, face, a.owner, S * .9, 0, 0);
        if (a.units.art) m.unit('art', x - s * (n / 2 + 1) * .06, y, z - c * (n / 2 + 1) * .06, face, a.owner, S * .9, 0, 0);
      }
      const fc = facCol[a.owner], rem = 1 - a.t, steps = Math.ceil(rem * Math.hypot(a.dx, a.dz) / .6), ly = a.air ? 1.2 : .62;
      for (let st = 0; st < steps; st++) {
        if (a.ret && st % 2) continue;
        const t0 = a.t + (st / steps) * rem, t1 = a.t + ((st + .5) / steps) * rem;
        let x0 = a.ax + a.dx * t0, x1 = a.ax + a.dx * t1;
        if (x0 < -HW) x0 += 2 * HW; if (x0 > HW) x0 -= 2 * HW; if (x1 < -HW) x1 += 2 * HW; if (x1 > HW) x1 -= 2 * HW;
        if (Math.abs(x1 - x0) < 5) this.lines.add(x0, ly, a.az + a.dz * t0, x1, ly, a.az + a.dz * t1, fc);
      }
    }
  }

  /** Smoke from factory chimneys (a few puffs per second across the map). */
  factorySmoke(g: GameState, dt: number) {
    this.factT += dt; this.holdT += dt; if (this.factT < .5) return; this.factT -= .5;
    for (const def of this.world.regions) {
      const t = g.regions[def.id];
      if (t.factory && t.battle < 0 && Math.random() < .7) this.fx.spawn(def.cx + .58, this.terrain.anchorH(def.id) + .34, def.cz - .3, .03, .14, -.01, 0, 2.4, .05, .17, K.smoke, F_MAP);
    }
  }
}
