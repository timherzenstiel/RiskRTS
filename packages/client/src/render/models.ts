// Voxel models (soldiers, guns, tanks, ships, planes). Everything is composed from coloured boxes pushed into Pools.
import type { UnitType } from '@riskrts/shared';
import type * as THREE from 'three';
import type { Pool } from './pools';
import { DEADC, HELM, K, TANKC, TANKD, UNI, UNI2 } from './palette';

export class Models {
  constructor(private readonly lit: Pool, readonly glowPool: Pool) {}

  /** Push a box at local offset (lx,ly,lz) from (x,y,z), rotated by `face` about Y. */
  part(x: number, y: number, z: number, face: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, c: THREE.Color, pool: Pool = this.lit) {
    const s = Math.sin(face), co = Math.cos(face);
    pool.push(x + lx * co + lz * s, y + ly, z - lx * s + lz * co, sx, sy, sz, face, c);
  }

  private helmet(x: number, y: number, z: number, face: number, f: number, S: number, hy: number) {
    const h = HELM[f], p = this.part.bind(this);
    if (f === 0) { p(x, y, z, face, 0, hy * S, 0, .085 * S, .01 * S, .085 * S, h); p(x, y, z, face, 0, (hy + .014) * S, 0, .05 * S, .022 * S, .05 * S, h); }
    else if (f === 1) { p(x, y, z, face, 0, hy * S, 0, .07 * S, .008 * S, .078 * S, h); p(x, y, z, face, 0, (hy + .014) * S, 0, .052 * S, .026 * S, .056 * S, h); p(x, y, z, face, 0, (hy + .032) * S, 0, .01 * S, .012 * S, .05 * S, h); }
    else if (f === 2) { p(x, y, z, face, 0, (hy + .008) * S, 0, .052 * S, .022 * S, .052 * S, UNI[f]); p(x, y, z, face, 0, (hy - .002) * S, .03 * S, .042 * S, .006 * S, .02 * S, K.boot); }
    else if (f === 5) { p(x, y, z, face, 0, (hy - .002) * S, 0, .062 * S, .012 * S, .062 * S, K.khaki); p(x, y, z, face, 0, (hy + .016) * S, 0, .056 * S, .026 * S, .056 * S, K.khaki); }
    else { p(x, y, z, face, 0, (hy - .004) * S, 0, .066 * S, .014 * S, .07 * S, h); p(x, y, z, face, 0, (hy + .016) * S, 0, .058 * S, .034 * S, .062 * S, h); }
  }

  soldier(x: number, y: number, z: number, face: number, f: number, S: number, crouch: boolean, walk: number, rifle = true) {
    const p = this.part.bind(this);
    const sw = walk ? Math.sin(walk) * .018 : 0, bob = walk ? Math.abs(Math.cos(walk)) * .008 : 0; y += bob * S;
    if (!crouch) {
      p(x, y, z, face, -.016 * S, .035 * S, sw * S, .024 * S, .07 * S, .03 * S, K.puttee); p(x, y, z, face, .016 * S, .035 * S, -sw * S, .024 * S, .07 * S, .03 * S, K.puttee);
      p(x, y, z, face, -.016 * S, .006 * S, (sw + .006) * S, .026 * S, .012 * S, .036 * S, K.boot); p(x, y, z, face, .016 * S, .006 * S, (-sw + .006) * S, .026 * S, .012 * S, .036 * S, K.boot);
    } else { p(x, y, z, face, -.016 * S, .012 * S, .02 * S, .024 * S, .024 * S, .06 * S, K.puttee); p(x, y, z, face, .018 * S, .028 * S, 0, .024 * S, .05 * S, .03 * S, K.puttee); }
    const ty = crouch ? .06 : .105;
    p(x, y, z, face, 0, ty * S, 0, .07 * S, .07 * S, .045 * S, UNI[f]);
    p(x, y, z, face, 0, (ty - .03) * S, 0, .072 * S, .01 * S, .047 * S, K.belt);
    p(x, y, z, face, 0, (ty + .005) * S, -.033 * S, .05 * S, .05 * S, .022 * S, K.pack); p(x, y, z, face, 0, (ty + .034) * S, -.046 * S, .056 * S, .014 * S, .016 * S, K.khaki); p(x, y, z, face, .03 * S, (ty - .018) * S, -.04 * S, .014 * S, .02 * S, .012 * S, K.steel);
    p(x, y, z, face, -.044 * S, (ty - .002) * S, .012 * S, .02 * S, .058 * S, .024 * S, UNI2[f]); p(x, y, z, face, .044 * S, (ty - .002) * S, .02 * S, .02 * S, .058 * S, .024 * S, UNI2[f]);
    p(x, y, z, face, 0, (ty + .058) * S, .002 * S, .042 * S, .042 * S, .042 * S, K.skin);
    this.helmet(x, y, z, face, f, S, ty + .083);
    if (rifle) {
      p(x, y, z, face, .03 * S, (ty + .006) * S, .05 * S, .01 * S, .012 * S, .12 * S, K.wood); p(x, y, z, face, .03 * S, (ty + .008) * S, .122 * S, .006 * S, .006 * S, .03 * S, K.steel);
      p(x, y, z, face, .03 * S, (ty + .008) * S, .15 * S, .003 * S, .003 * S, .03 * S, K.steel); p(x, y, z, face, .03 * S, (ty + .014) * S, .04 * S, .012 * S, .01 * S, .05 * S, K.wood);
    }
  }

  private tank(x: number, y: number, z: number, face: number, f: number, S: number) {
    const p = this.part.bind(this), c = TANKC[f], d = TANKD[f];
    if (f === 1) {
      p(x, y, z, face, 0, .06 * S, 0, .12 * S, .08 * S, .22 * S, c);
      p(x, y, z, face, .07 * S, .045 * S, 0, .04 * S, .07 * S, .26 * S, K.track); p(x, y, z, face, -.07 * S, .045 * S, 0, .04 * S, .07 * S, .26 * S, K.track);
      p(x, y, z, face, 0, .13 * S, .02 * S, .075 * S, .06 * S, .075 * S, d); p(x, y, z, face, 0, .165 * S, .02 * S, .04 * S, .015 * S, .04 * S, d);
      p(x, y, z, face, 0, .135 * S, .085 * S, .012 * S, .012 * S, .06 * S, K.gun); p(x, y, z, face, 0, .05 * S, -.15 * S, .08 * S, .02 * S, .07 * S, d); return;
    }
    if (f === 3) {
      p(x, y, z, face, 0, .03 * S, 0, .21 * S, .05 * S, .31 * S, K.track); p(x, y, z, face, 0, .11 * S, 0, .2 * S, .12 * S, .3 * S, c);
      p(x, y, z, face, 0, .19 * S, .02 * S, .09 * S, .04 * S, .09 * S, d); p(x, y, z, face, 0, .1 * S, .18 * S, .022 * S, .022 * S, .07 * S, K.gun);
      p(x, y, z, face, .105 * S, .1 * S, .04 * S, .02 * S, .015 * S, .04 * S, K.gun); p(x, y, z, face, -.105 * S, .1 * S, .04 * S, .02 * S, .015 * S, .04 * S, K.gun); return;
    }
    p(x, y, z, face, 0, .075 * S, 0, .16 * S, .11 * S, .26 * S, c);
    for (const sd of [-1, 1]) {
      const lx = sd * .1 * S;
      p(x, y, z, face, lx, .03 * S, 0, .05 * S, .05 * S, .34 * S, K.track); p(x, y, z, face, lx, .085 * S, .01 * S, .05 * S, .07 * S, .38 * S, d);
      p(x, y, z, face, lx, .14 * S, .02 * S, .05 * S, .04 * S, .3 * S, d); p(x, y, z, face, lx, .115 * S, .19 * S, .05 * S, .05 * S, .05 * S, K.track);
      p(x, y, z, face, sd * .14 * S, .08 * S, .02 * S, .04 * S, .05 * S, .09 * S, c); p(x, y, z, face, sd * .165 * S, .08 * S, .08 * S, .012 * S, .012 * S, .07 * S, K.gun);
    }
    p(x, y, z, face, 0, .15 * S, .1 * S, .08 * S, .04 * S, .07 * S, c); p(x, y, z, face, .03 * S, .17 * S, -.09 * S, .015 * S, .04 * S, .015 * S, K.gun);
  }

  /** Draw any unit type. `recoil` (0..1) pulls an artillery barrel back after a shot. */
  unit(type: UnitType, x: number, y: number, z: number, face: number, f: number, S: number, walk: number, recoil: number) {
    if (type === 'inf') { this.soldier(x, y, z, face, f, S, false, walk); return; }
    const p = this.part.bind(this), s = Math.sin(face), c = Math.cos(face);
    if (type === 'mg') {
      p(x, y, z, face, 0, .045 * S, .05 * S, .03 * S, .03 * S, .12 * S, K.jacket); p(x, y, z, face, 0, .045 * S, .12 * S, .01 * S, .01 * S, .03 * S, K.gun);
      p(x, y, z, face, 0, .02 * S, .06 * S, .008 * S, .04 * S, .008 * S, K.gun); p(x, y, z, face, .025 * S, .02 * S, .02 * S, .008 * S, .04 * S, .008 * S, K.gun); p(x, y, z, face, -.025 * S, .02 * S, .02 * S, .008 * S, .04 * S, .008 * S, K.gun);
      p(x, y, z, face, .06 * S, .014 * S, .04 * S, .03 * S, .025 * S, .04 * S, K.olive);
      this.soldier(x - s * .06 * S, y, z - c * .06 * S, face, f, S, true, 0, false); this.soldier(x - s * .03 * S + c * .07 * S, y, z - c * .03 * S - s * .07 * S, face, f, S, true, 0, false); return;
    }
    if (type === 'art') {
      const rb = recoil * .04;
      p(x, y, z, face, 0, .05 * S, 0, .09 * S, .03 * S, .06 * S, K.olive);
      for (const sd of [-1, 1]) { p(x, y, z, face, sd * .07 * S, .05 * S, 0, .02 * S, .1 * S, .03 * S, K.wood); p(x, y, z, face, sd * .07 * S, .05 * S, 0, .02 * S, .03 * S, .1 * S, K.wood); p(x, y, z, face, sd * .07 * S, .05 * S, 0, .024 * S, .024 * S, .024 * S, K.gun); }
      p(x, y, z, face, 0, .095 * S, (.11 - rb) * S, .026 * S, .026 * S, .2 * S, K.gun); p(x, y, z, face, 0, .075 * S, (.06 - rb) * S, .02 * S, .015 * S, .12 * S, K.jacket);
      p(x, y, z, face, 0, .1 * S, .03 * S, .14 * S, .08 * S, .012 * S, K.olive); p(x, y, z, face, 0, .025 * S, -.13 * S, .03 * S, .02 * S, .18 * S, K.wood);
      this.soldier(x - s * .17 * S + c * .07 * S, y, z - c * .17 * S - s * .07 * S, face, f, S, true, 0, false); this.soldier(x - s * .15 * S - c * .08 * S, y, z - c * .15 * S + s * .08 * S, face, f, S, false, 0, false); return;
    }
    this.tank(x, y, z, face, f, S);
  }

  ship(x: number, z: number, face: number, band: THREE.Color, S: number, t: number) {
    const p = this.part.bind(this), y = .12 + Math.sin(t * 2 + x) * .008;
    p(x, y, z, face, 0, .025 * S, 0, .14 * S, .05 * S, .5 * S, K.hull); p(x, y, z, face, 0, .025 * S, .27 * S, .08 * S, .04 * S, .06 * S, K.hull);
    p(x, y, z, face, 0, .052 * S, 0, .12 * S, .01 * S, .46 * S, K.deck); p(x, y, z, face, 0, .04 * S, 0, .142 * S, .012 * S, .5 * S, band);
    p(x, y, z, face, 0, .085 * S, .04 * S, .08 * S, .06 * S, .14 * S, K.super); p(x, y, z, face, 0, .125 * S, .06 * S, .05 * S, .03 * S, .06 * S, K.super);
    p(x, y, z, face, 0, .14 * S, -.06 * S, .04 * S, .1 * S, .04 * S, K.funnel); p(x, y, z, face, 0, .1 * S, .2 * S, .008 * S, .12 * S, .008 * S, K.pole); p(x, y, z, face, 0, .1 * S, -.2 * S, .008 * S, .1 * S, .008 * S, K.pole);
    // bow wave and stern wake
    p(x, .126, z, face, 0, 0, .29 * S, .1 * S, .01 * S, .05 * S, K.white); p(x, .126, z, face, 0, 0, -.32 * S, .06 * S, .008 * S, .22 * S, K.white);
  }

  plane(x: number, y: number, z: number, face: number, c: THREE.Color, S: number) {
    const p = this.part.bind(this);
    p(x, y, z, face, 0, 0, 0, .04 * S, .04 * S, .24 * S, c); p(x, y, z, face, 0, .035 * S, .03 * S, .34 * S, .008 * S, .06 * S, K.wing); p(x, y, z, face, 0, -.015 * S, .03 * S, .3 * S, .008 * S, .055 * S, K.wing);
    p(x, y, z, face, 0, .012 * S, -.11 * S, .12 * S, .006 * S, .04 * S, K.wing); p(x, y, z, face, 0, .03 * S, -.11 * S, .006 * S, .05 * S, .04 * S, c); p(x, y, z, face, 0, 0, .125 * S, .06 * S, .006 * S, .006 * S, K.gun, this.glowPool);
  }

  corpse(x: number, y: number, z: number, face: number, f: number) {
    this.part(x, y, z, face + .4, 0, .014, 0, .07, .028, .15, DEADC[f]);
    this.part(x, y, z, face + .4, 0, .02, .09, .04, .035, .04, K.skin);
  }
}
