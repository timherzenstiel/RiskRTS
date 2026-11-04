// Voxel models (soldiers, guns, tanks, ships, planes). Everything is composed from coloured boxes pushed into Pools.
import type { UnitType } from '@riskrts/shared';
import type * as THREE from 'three';
import type { Pool } from './pools';
import { DEADC, HELM, K, TANKC, TANKD, TANKL, UNI, UNI2, facCol } from './palette';

const FLAG = facCol;

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

  /** A track run on one side: dark links with a lighter top run, road wheels on the outer face and link stripes. */
  private track(x: number, y: number, z: number, face: number, S: number, lx: number, len: number, h: number, w: number, lz = 0) {
    const p = this.part.bind(this), out = lx > 0 ? 1 : -1;
    p(x, y, z, face, lx * S, h / 2 * S, lz * S, w * S, h * S, len * S, K.track);
    p(x, y, z, face, lx * S, (h - .004) * S, lz * S, w * 1.04 * S, .008 * S, len * .94 * S, K.trackHi);
    const n = Math.max(3, Math.round(len / .05));
    for (let k = 0; k < n; k++) {
      const tz = lz + (k + .5) / n * len * .86 - len * .43;
      p(x, y, z, face, (lx + out * w * .52) * S, h * .42 * S, tz * S, .005 * S, h * .5 * S, h * .5 * S, K.wheel);
      p(x, y, z, face, lx * S, h * S, (tz + len / n * .43) * S, w * 1.06 * S, .004 * S, .008 * S, K.rivet);
    }
  }

  /** WW1-era armour in Command & Conquer detail: tracks with wheels and links, lit top plates, hatches, vision slits, guns. */
  private tank(x: number, y: number, z: number, face: number, f: number, S: number) {
    const p = this.part.bind(this), c = TANKC[f], d = TANKD[f], l = TANKL[f];
    if (f === 1) { // light tank with a rotating turret
      this.track(x, y, z, face, S, .07, .27, .07, .04);
      p(x, y, z, face, .07 * S, .075 * S, .14 * S, .042 * S, .05 * S, .04 * S, K.track);
      p(x, y, z, face, -.07 * S, .075 * S, .14 * S, .042 * S, .05 * S, .04 * S, K.track);
      this.track(x, y, z, face, S, -.07, .27, .07, .04);
      p(x, y, z, face, 0, .065 * S, 0, .1 * S, .08 * S, .22 * S, d); p(x, y, z, face, 0, .108 * S, -.01 * S, .1 * S, .008 * S, .2 * S, l);
      p(x, y, z, face, 0, .09 * S, .1 * S, .09 * S, .05 * S, .04 * S, c); p(x, y, z, face, 0, .1 * S, .121 * S, .05 * S, .006 * S, .002 * S, K.slit);
      p(x, y, z, face, 0, .14 * S, .02 * S, .07 * S, .055 * S, .07 * S, c); p(x, y, z, face + .785, 0, .14 * S, 0, .06 * S, .055 * S, .06 * S, d);
      p(x, y, z, face, 0, .17 * S, .02 * S, .05 * S, .008 * S, .05 * S, l); p(x, y, z, face, 0, .182 * S, .02 * S, .026 * S, .016 * S, .026 * S, K.hatch);
      p(x, y, z, face, 0, .142 * S, .08 * S, .012 * S, .012 * S, .06 * S, K.gun); p(x, y, z, face, 0, .142 * S, .113 * S, .016 * S, .016 * S, .008 * S, K.gun);
      p(x, y, z, face, 0, .05 * S, -.15 * S, .08 * S, .016 * S, .07 * S, d); p(x, y, z, face, .03 * S, .12 * S, -.08 * S, .012 * S, .03 * S, .012 * S, K.exhaust);
      return;
    }
    if (f === 3) { // heavy box-hulled assault tank
      this.track(x, y, z, face, S, .085, .3, .055, .05); this.track(x, y, z, face, S, -.085, .3, .055, .05);
      p(x, y, z, face, 0, .1 * S, 0, .21 * S, .1 * S, .32 * S, c);
      p(x, y, z, face, 0, .151 * S, 0, .2 * S, .006 * S, .3 * S, l);
      p(x, y, z, face, 0, .08 * S, .17 * S, .2 * S, .05 * S, .03 * S, d);
      for (const sd of [-1, 1]) {
        p(x, y, z, face, sd * .106 * S, .1 * S, 0, .006 * S, .088 * S, .3 * S, d);
        for (let k = -1; k <= 1; k++) p(x, y, z, face, sd * .11 * S, .115 * S, k * .09 * S, .004 * S, .012 * S, .02 * S, K.slit);
        p(x, y, z, face, sd * .112 * S, .1 * S, .09 * S, .012 * S, .012 * S, .03 * S, K.gun);
        p(x, y, z, face, sd * .109 * S, .085 * S, -.06 * S, .004 * S, .05 * S, .035 * S, K.hatch);
      }
      p(x, y, z, face, 0, .18 * S, .04 * S, .1 * S, .05 * S, .11 * S, c); p(x, y, z, face, 0, .206 * S, .04 * S, .09 * S, .006 * S, .1 * S, l);
      p(x, y, z, face, 0, .19 * S, .096 * S, .06 * S, .006 * S, .003 * S, K.slit); p(x, y, z, face, -.02 * S, .213 * S, .02 * S, .03 * S, .008 * S, .03 * S, K.hatch);
      p(x, y, z, face, 0, .11 * S, .2 * S, .022 * S, .022 * S, .07 * S, K.gun); p(x, y, z, face, 0, .11 * S, .18 * S, .05 * S, .05 * S, .015 * S, d);
      for (const sd of [-1, 1]) p(x, y, z, face, sd * .06 * S, .16 * S, -.15 * S, .016 * S, .03 * S, .016 * S, K.exhaust);
      return;
    }
    // rhomboid tank: tracks wrap around a tall hull, gun sponsons on both sides
    for (const sd of [-1, 1]) {
      const lx = sd * .1;
      this.track(x, y, z, face, S, lx, .34, .055, .05);
      p(x, y, z, face, lx * S, .1 * S, .01 * S, .05 * S, .08 * S, .36 * S, d);
      p(x, y, z, face, lx * S, .145 * S, .02 * S, .052 * S, .012 * S, .3 * S, K.trackHi);
      p(x, y, z, face, lx * S, .12 * S, .185 * S, .05 * S, .05 * S, .05 * S, K.track); p(x, y, z, face, lx * S, .07 * S, .2 * S, .05 * S, .05 * S, .04 * S, K.track);
      for (let k = 0; k < 6; k++) p(x, y, z, face, (lx + sd * .026) * S, .1 * S, (-.13 + k * .055) * S, .004 * S, .006 * S, .006 * S, K.rivet);
      p(x, y, z, face, sd * .14 * S, .09 * S, .03 * S, .04 * S, .055 * S, .1 * S, c); p(x, y, z, face, sd * .14 * S, .118 * S, .03 * S, .04 * S, .006 * S, .1 * S, l);
      p(x, y, z, face, sd * .14 * S, .095 * S, .082 * S, .02 * S, .02 * S, .01 * S, K.hatch);
      p(x, y, z, face, sd * .165 * S, .095 * S, .085 * S, .012 * S, .012 * S, .07 * S, K.gun);
    }
    p(x, y, z, face, 0, .085 * S, 0, .15 * S, .11 * S, .27 * S, c); p(x, y, z, face, 0, .141 * S, -.01 * S, .14 * S, .006 * S, .25 * S, l);
    p(x, y, z, face, 0, .16 * S, .1 * S, .08 * S, .04 * S, .07 * S, c); p(x, y, z, face, 0, .181 * S, .1 * S, .07 * S, .006 * S, .06 * S, l);
    p(x, y, z, face, 0, .165 * S, .136 * S, .05 * S, .005 * S, .003 * S, K.slit);
    p(x, y, z, face, 0, .155 * S, -.08 * S, .06 * S, .02 * S, .05 * S, K.hatch);
    p(x, y, z, face, 0, .16 * S, -.16 * S, .26 * S, .022 * S, .022 * S, K.wood);
    p(x, y, z, face, .03 * S, .17 * S, -.09 * S, .015 * S, .04 * S, .015 * S, K.exhaust); p(x, y, z, face, -.03 * S, .17 * S, -.09 * S, .015 * S, .04 * S, .015 * S, K.exhaust);
  }

  /** Draw any unit type. `recoil` (0..1) pulls an artillery barrel back after a shot. */
  unit(type: UnitType, x: number, y: number, z: number, face: number, f: number, S: number, walk: number, recoil: number) {
    if (type === 'inf') { this.soldier(x, y, z, face, f, S, false, walk); return; }
    if (type === 'plane') { this.plane(x, y, z, face, FLAG[f] ?? K.wing, S * .9); return; }
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

  /** Concrete pillbox with a firing slit facing `face`. `hold` = holdout (cut off, shown with a white flag). */
  pillbox(x: number, y: number, z: number, face: number, f: number, S: number, hold = false) {
    const p = this.part.bind(this);
    p(x, y, z, face, 0, .03 * S, 0, .15 * S, .06 * S, .15 * S, K.concrete);
    p(x, y, z, face, 0, .015 * S, 0, .18 * S, .03 * S, .18 * S, K.sand2);
    p(x, y, z, face, 0, .068 * S, 0, .17 * S, .018 * S, .17 * S, K.concrete2);
    p(x, y, z, face, 0, .042 * S, .076 * S, .1 * S, .012 * S, .006 * S, K.slit);
    p(x, y, z, face, .05 * S, .045 * S, .07 * S, .012 * S, .006 * S, .04 * S, K.gun);
    p(x, y, z, face, -.06 * S, .11 * S, -.06 * S, .006 * S, .08 * S, .006 * S, K.pole);
    p(x, y, z, face, -.04 * S, .135 * S, -.06 * S, .04 * S, .025 * S, .004 * S, hold ? K.white : FLAG[f] ?? K.white);
  }

  /** Sandbagged heavy gun pit. `recoil` 0..1 after a shot. */
  emplacement(x: number, y: number, z: number, face: number, f: number, S: number, recoil = 0) {
    const p = this.part.bind(this);
    for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; if (Math.abs(Math.cos(a)) > .9 && Math.cos(a) > 0) continue; p(x, y, z, face + a, 0, .018 * S, .12 * S, .07 * S, .036 * S, .035 * S, k % 2 ? K.sand : K.sand2); }
    p(x, y, z, face, 0, .02 * S, 0, .12 * S, .03 * S, .12 * S, K.olive);
    p(x, y, z, face, 0, .07 * S, (.09 - recoil * .05) * S, .03 * S, .03 * S, .26 * S, K.gun);
    p(x, y, z, face, 0, .07 * S, .0, .1 * S, .07 * S, .014 * S, K.olive);
    p(x, y, z, face, 0, .045 * S, -.06 * S, .06 * S, .05 * S, .07 * S, K.jacket);
    p(x, y, z, face, -.14 * S, .012 * S, -.06 * S, .03 * S, .024 * S, .03 * S, K.crate); p(x, y, z, face, -.15 * S, .012 * S, -.02 * S, .03 * S, .024 * S, .03 * S, K.crate);
    p(x, y, z, face, .1 * S, .11 * S, -.1 * S, .006 * S, .08 * S, .006 * S, K.pole); p(x, y, z, face, .12 * S, .135 * S, -.1 * S, .04 * S, .025 * S, .004 * S, FLAG[f] ?? K.white);
  }

  /** Anti-aircraft gun on a platform, barrel raised. */
  flak(x: number, y: number, z: number, face: number, f: number, S: number, recoil = 0) {
    const p = this.part.bind(this);
    p(x, y, z, face, 0, .01 * S, 0, .16 * S, .02 * S, .16 * S, K.concrete2);
    for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) p(x, y, z, face, sx * .08 * S, .006 * S, sz * .08 * S, .05 * S, .012 * S, .05 * S, K.wood);
    p(x, y, z, face, 0, .04 * S, 0, .05 * S, .04 * S, .05 * S, K.olive);
    for (let k = 0; k < 5; k++) p(x, y, z, face, 0, (.065 + k * .025) * S, (.01 + k * .018 - recoil * .01) * S, .016 * S, .03 * S, .02 * S, K.gun);
    p(x, y, z, face, .04 * S, .05 * S, -.02 * S, .006 * S, .03 * S, .03 * S, K.olive);
    p(x, y, z, face, -.07 * S, .03 * S, -.07 * S, .025 * S, .03 * S, .02 * S, K.crate);
    void f;
  }

  /** Grass strip with hangar and windsock; `planes` parked aircraft. */
  airfield(x: number, y: number, z: number, face: number, f: number, S: number, planes: number, t: number) {
    const p = this.part.bind(this);
    p(x, y, z, face, 0, .002 * S, 0, .16 * S, .004 * S, .9 * S, K.runway);
    for (let k = -3; k <= 3; k++) p(x, y, z, face, 0, .0045 * S, k * .12 * S, .012 * S, .002 * S, .05 * S, K.runway2);
    p(x, y, z, face, .2 * S, .04 * S, -.2 * S, .16 * S, .08 * S, .2 * S, K.hangar);
    p(x, y, z, face, .2 * S, .085 * S, -.2 * S, .12 * S, .02 * S, .21 * S, K.roof); p(x, y, z, face, .2 * S, .1 * S, -.2 * S, .07 * S, .014 * S, .21 * S, K.roof);
    p(x, y, z, face, .118 * S, .03 * S, -.2 * S, .005 * S, .05 * S, .14 * S, K.slit);
    p(x, y, z, face, -.14 * S, .05 * S, .35 * S, .005 * S, .1 * S, .005 * S, K.pole);
    p(x, y, z, face + Math.sin(t * 1.3) * .5, -.14 * S, .095 * S, .35 * S + .02 * S, .012 * S, .012 * S, .04 * S, K.funnel);
    for (let k = 0; k < Math.min(3, planes); k++) this.plane(x + Math.cos(face) * (.2 + k * .14) * S, y + .02 * S, z - Math.sin(face) * (.2 + k * .14) * S + .1 * S, face + Math.PI / 2, FLAG[f] ?? K.wing, .45 * S);
  }

  corpse(x: number, y: number, z: number, face: number, f: number, S = 1) {
    this.part(x, y, z, face + .4, 0, .014 * S, 0, .07 * S, .028 * S, .15 * S, DEADC[f]);
    this.part(x, y, z, face + .4, 0, .02 * S, .09 * S, .04 * S, .035 * S, .04 * S, K.skin);
  }
}
