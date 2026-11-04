// Per-frame drawing of everything that changes: garrisons, buildings, flags, marching armies and ships.
// All of it is pushed into instanced pools; nothing here allocates.
import { HW, armyPos, totalUnits, type GameState, type World } from '@riskrts/shared';
import type { CameraRig } from './camera';
import type { FxSystem } from './fxSystem';
import { F_MAP } from './fxSystem';
import type { Models } from './models';
import type { LineBatch } from './pools';
import { FLAGD, K, facCol } from './palette';
import type { Terrain } from './terrain';
import { lerp } from './util';

export class DynamicDraw {
  private factT = 0;
  constructor(private readonly world: World, private readonly terrain: Terrain, private readonly m: Models, private readonly lines: LineBatch, private readonly fx: FxSystem) {}

  /** Garrison figures, flags, factories, barracks, trench piles. */
  regions(g: GameState, rig: CameraRig, T: number) {
    const m = this.m, near = rig.dist < 26, cull = rig.dist * 3 + 8;
    for (const def of this.world.regions) {
      const t = g.regions[def.id], x = def.cx, z = def.cz;
      if (Math.abs(x - rig.tx) > cull || Math.abs(z - rig.tz) > cull) continue;
      const y = this.terrain.anchorH(def.id), f = t.owner;
      if (t.battle >= 0 && near) continue;
      if (t.capitalOf >= 0 && t.capitalOf === f) {
        m.part(x, y, z, 0, -.2, .45, -.55, .035, .9, .035, K.pole); m.part(x, y, z, 0, -.2, .91, -.55, .05, .03, .05, K.flash);
        for (let k = 0; k < 6; k++) { const w = Math.sin(T * 3 + k * .8 + def.id) * .02 * k / 5; m.part(x, y, z, 0, -.15 + k * .06, .8, -.55 + w, .06, .22, .02, k % 2 ? facCol[f] : FLAGD[f]); }
      } else if (t.capitalOf >= 0) m.part(x, y, z, 0, -.2, .3, -.55, .035, .6, .035, K.pole);
      if (t.factory) {
        m.part(x, y, z, 0, .95, .15, -.35, .5, .3, .38, K.brick);
        for (let k = 0; k < 3; k++) m.part(x, y, z, 0, .78 + k * .16, .34, -.35, .13, .07, .38, K.brick2);
        m.part(x, y, z, 0, 1.1, .33, -.5, .1, .66, .1, K.brick2); m.part(x, y, z, 0, 1.1, .68, -.5, .12, .04, .12, K.gun);
        for (let k = 0; k < 3; k++) m.part(x, y, z, 0, .8 + k * .15, .16, -.155, .07, .08, .01, K.flash, this.glow);
      }
      if (t.barracks) {
        m.part(x, y, z, 0, -.95, .08, -.3, .6, .16, .3, K.bar); m.part(x, y, z, 0, -.95, .19, -.3, .64, .06, .34, K.roof); m.part(x, y, z, 0, -.95, .235, -.3, .4, .04, .2, K.roof);
        for (let k = 0; k < 4; k++) m.part(x, y, z, 0, -1.18 + k * .15, .09, -.148, .05, .05, .01, K.flash, this.glow);
      }
      for (let k = 0; k < t.trench * 5; k++) { const lx = -.6 + (k % 7) * .2, lz = .5 + Math.floor(k / 7) * .13; m.part(x, y, z, 0, lx, .035, lz, .17, .07, .1, (k % 2) ? K.sand : K.sand2); }
      if (t.battle >= 0) continue;
      const tot = totalUnits(t.units); if (!tot) continue;
      const S = 3, n = tot >= 15 ? 3 : tot >= 6 ? 2 : 1;
      if (n === 1) m.soldier(x, y, z, 0, f, S, false, 0);
      else if (n === 2) { m.soldier(x - .2, y, z + .02, 0, f, S, false, 0); m.soldier(x + .2, y, z - .04, 0, f, S, false, 0); }
      else { m.soldier(x - .32, y, z + .04, 0, f, S, false, 0); m.soldier(x, y, z - .08, 0, f, S, false, 0); m.soldier(x + .32, y, z + .04, 0, f, S, false, 0); }
      if (t.units.tank) m.unit('tank', x + .66, y, z + .18, -.4, f, 2.3, 0, 0);
      if (t.units.art) m.unit('art', x - .66, y, z + .18, .35, f, 2.3, 0, 0);
      if (t.units.mg) m.unit('mg', x, y, z + .45, 0, f, 2.3, 0, 0);
    }
  }

  private get glow() { return this.m.glowPool; }

  /** Marching columns, ships carrying armies and their dashed route lines. */
  armies(g: GameState, T: number) {
    const m = this.m;
    for (const a of g.armies) {
      const [x, z] = armyPos(a), face = Math.atan2(a.dx, a.dz);
      if (a.sea) m.ship(x, z, face, facCol[a.owner], 2.2, T);
      else {
        const y = lerp(this.terrain.anchorH(a.from), this.terrain.anchorH(a.to), a.t) + Math.sin(a.t * Math.PI) * .4;
        const c = Math.cos(face), s = Math.sin(face);
        m.soldier(x - .2 * c, y, z + .2 * s, face, a.owner, 2.6, false, T * 9);
        m.soldier(x + .2 * c, y, z - .2 * s, face, a.owner, 2.6, false, T * 9 + 1.7);
        m.soldier(x - .25 * s, y, z - .25 * c, face, a.owner, 2.6, false, T * 9 + 3.1);
      }
      const fc = facCol[a.owner], rem = 1 - a.t, steps = Math.ceil(rem * Math.hypot(a.dx, a.dz) / .6);
      for (let s = 0; s < steps; s++) {
        const t0 = a.t + (s / steps) * rem, t1 = a.t + ((s + .5) / steps) * rem;
        let x0 = a.ax + a.dx * t0, x1 = a.ax + a.dx * t1;
        if (x0 < -HW) x0 += 2 * HW; if (x0 > HW) x0 -= 2 * HW; if (x1 < -HW) x1 += 2 * HW; if (x1 > HW) x1 -= 2 * HW;
        if (Math.abs(x1 - x0) < 5) this.lines.add(x0, .62, a.az + a.dz * t0, x1, .62, a.az + a.dz * t1, fc);
      }
    }
  }

  /** Smoke from factory chimneys (a few puffs per second across the map). */
  factorySmoke(g: GameState, dt: number) {
    this.factT += dt; if (this.factT < .5) return; this.factT -= .5;
    for (const def of this.world.regions) {
      const t = g.regions[def.id];
      if (t.factory && t.battle < 0 && Math.random() < .7) this.fx.spawn(def.cx + 1.1, this.terrain.anchorH(def.id) + .62, def.cz - .5, .06, .25, -.02, 0, 2.4, .1, .3, K.smoke, F_MAP);
    }
  }
}
