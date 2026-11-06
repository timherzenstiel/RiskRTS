// Unit models. When the baked low-poly meshes (meshPools.ts, tools/bake/models.py) have loaded, soldiers, guns, MGs, tanks,
// planes, pillboxes and bunkers draw as those; everything else, and everything before the meshes load, is composed from
// coloured boxes pushed into Pools.
// Models are built in a local frame (+z = forward, sizes in model units scaled by S). The base boxes always draw; the fine detail
// (faces, webbing, rivets, spokes, ammunition belts, markings) only draws while `hi` is set, i.e. when the camera is close enough to see it.
import type { UnitType } from '@riskrts/shared';
import type * as THREE from 'three';
import type { Pool } from './pools';
import { DEADC, HELM, K, TANKC, TANKD, TANKL, UNI, UNI2, facCol } from './palette';
import { HELM_OF, TANK_OF, type MeshKey, type MeshPools } from './meshPools';

const FLAG = facCol;
/** Soldier arm poses. */
export const POSE_RIFLE = 0, POSE_GRIP = 1, POSE_SHELL = 2, POSE_HANG = 3;

export class Models {
  /** Draw fine detail (set each frame from the zoom level). */
  hi = true;
  /** Animation clock in seconds (propellers). */
  t = 0;
  // current model frame: origin, facing (sin/cos) and scale
  private ox = 0; private oy = 0; private oz = 0; private of = 0; private os = 0; private oc = 1; private oS = 1;

  /** Use the detailed baked figures (battle and close bands). */
  hiMesh = true;
  /** Far-zoom sprite cards for infantry (used when the detailed meshes are off). */
  sprites: import('./impostors').Impostors | null = null;
  /** Baked meshes (null or not ready: box models). */
  mesh: MeshPools | null = null;

  constructor(private readonly lit: Pool, readonly glowPool: Pool) {}

  /** Push a box at local offset (lx,ly,lz) from (x,y,z), rotated by `face` about Y. */
  part(x: number, y: number, z: number, face: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, c: THREE.Color, pool: Pool = this.lit) {
    const s = Math.sin(face), co = Math.cos(face);
    pool.push(x + lx * co + lz * s, y + ly, z - lx * s + lz * co, sx, sy, sz, face, c);
  }

  /** Start a model frame at (x,y,z) facing `face`, scale S. */
  private at(x: number, y: number, z: number, face: number, S: number) {
    this.ox = x; this.oy = y; this.oz = z; this.of = face; this.os = Math.sin(face); this.oc = Math.cos(face); this.oS = S;
  }

  /** A box in the current model frame (offsets and sizes in model units). `yaw` turns the box on top of the model's facing. */
  private readonly b = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, c: THREE.Color, yaw = 0, pool: Pool = this.lit) => {
    const S = this.oS; lx *= S; lz *= S;
    pool.push(this.ox + lx * this.oc + lz * this.os, this.oy + ly * S, this.oz - lx * this.os + lz * this.oc, sx * S, sy * S, sz * S, this.of + yaw, c);
  };

  /** World x/z of a local point in the current frame (for placing crew). */
  private wx(lx: number, lz: number) { return this.ox + (lx * this.oc + lz * this.os) * this.oS; }
  private wz(lx: number, lz: number) { return this.oz + (-lx * this.os + lz * this.oc) * this.oS; }

  /** A spoked wheel standing in the local YZ plane: a ring of rim blocks, hub and (close up) spokes. */
  private wheel(lx: number, ly: number, lz: number, r: number, w: number, rim: THREE.Color, spoke: THREE.Color) {
    const b = this.b, n = this.hi ? 16 : 8, sz = r * 2 * Math.PI / n * 1.15;
    for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; b(lx, ly + Math.sin(a) * r, lz + Math.cos(a) * r, w, sz, sz, rim); }
    if (this.hi) {
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        for (let j = 1; j <= 3; j++) { const rr = r * j / 3.7; b(lx, ly + sa * rr, lz + ca * rr, w * .55, r * .15, r * .15, spoke); }
      }
    } else { b(lx, ly, lz, w * .55, r * 1.8, r * .22, spoke); b(lx, ly, lz, w * .55, r * .22, r * 1.8, spoke); }
    b(lx, ly, lz, w * 1.5, r * .36, r * .36, K.gun);
  }

  private helmet(f: number, hy: number) {
    const b = this.b, h = HELM[f], hi = this.hi;
    if (f === 0 || f === 6) { // Brodie (and the American M1917 copy): wide flat brim and a shallow bowl
      b(0, hy + .002, 0, .088, .007, .088, h); b(0, hy + .013, 0, .052, .018, .052, h);
      if (hi) { b(0, hy + .024, 0, .036, .006, .036, h); b(0, hy - .016, .016, .042, .003, .003, K.leather); }
    } else if (f === 1) { // Adrian: peaked front and back, crest along the top
      b(0, hy + .001, .002, .062, .006, .08, h); b(0, hy + .013, 0, .05, .022, .054, h); b(0, hy + .029, 0, .01, .012, .05, h);
      if (hi) { b(0, hy + .012, .0275, .01, .01, .002, K.brass); b(0, hy + .024, 0, .038, .006, .044, h); }
    } else if (f === 2) { // peaked field cap
      b(0, hy + .004, 0, .044, .012, .044, K.boot); b(0, hy + .015, -.002, .054, .012, .056, UNI[f]); b(0, hy - .001, .03, .04, .004, .02, K.boot);
      if (hi) b(0, hy + .006, .0225, .008, .008, .002, K.brass);
    } else if (f === 5) { // kabalak: cloth wrapped round a frame
      b(0, hy, 0, .06, .012, .06, K.khaki); b(0, hy + .012, 0, .056, .012, .056, K.canvas2); b(0, hy + .023, 0, .046, .01, .046, K.khaki);
      if (hi) { b(0, hy + .006, .0305, .05, .002, .002, K.canvas2); b(0, hy + .018, .0285, .046, .002, .002, K.khaki); }
    } else { // Stahlhelm: flared skirt over ears and neck, tall dome, side lugs
      b(0, hy - .004, -.004, .064, .014, .07, h); b(0, hy + .015, 0, .056, .028, .058, h);
      if (hi) { b(0, hy + .03, 0, .044, .006, .046, h); for (let sd = -1; sd <= 1; sd += 2) b(sd * .029, hy + .012, 0, .004, .007, .007, K.hatch); b(0, hy + .002, .033, .04, .006, .01, h); }
    }
  }

  /** Infantryman. `pose`: POSE_RIFLE carries the rifle at the ready, GRIP reaches forward to a gun, SHELL carries a shell, HANG lets the arms hang. */
  soldier(x: number, y: number, z: number, face: number, f: number, S: number, crouch: boolean, walk: number, pose = POSE_RIFLE) {
    const sw = walk ? Math.sin(walk) * .018 : 0, bob = walk ? Math.abs(Math.cos(walk)) * .008 : 0;
    // beyond the battle band: a pre-rendered sprite card instead of a mesh (crouching figures keep the light mesh)
    if (!this.hiMesh && !crouch && this.sprites?.ready) { this.sprites.push(x, y + bob * S, z, face, f, S, walk ? (Math.sin(walk) > 0 ? 1 : 2) : 0); return; }
    if (this.mesh?.has('soldier_lo')) {
      // close up: the detailed figure, two stride frames while marching; further out the light figure with a sway
      const d = crouch ? -.045 : 0, hiRes = this.hiMesh && this.mesh.has('soldier');
      const key: MeshKey = hiRes ? (crouch ? 'soldier_kneel' : walk ? (Math.sin(walk) > 0 ? 'soldier_walk_a' : 'soldier_walk_b') : 'soldier') : crouch ? 'soldier_kneel_lo' : 'soldier_lo';
      const yy = y + bob * S, roll = hiRes ? 0 : sw * 2.2, hh = (hiRes && !crouch && walk ? .188 : .19) + d;
      this.mesh.push(key, x, yy, z, face, S, UNI[f] ?? K.khaki, roll);
      this.mesh.push(HELM_OF[f] ?? 'helm_stahl', x - Math.cos(face) * roll * hh * S, yy + hh * S, z + Math.sin(face) * roll * hh * S, face, S, UNI[f] ?? K.khaki);
      void pose; return;
    }
    this.at(x, y + bob * S, z, face, S);
    const b = this.b, hi = this.hi, U = UNI[f], U2 = UNI2[f];
    let d = 0;
    if (!crouch) {
      for (let sd = -1; sd <= 1; sd += 2) {
        const ls = sd < 0 ? sw : -sw, lx = sd * .016;
        b(lx, .007, ls + .007, .026, .014, .04, K.boot);
        b(lx, .033, ls * .8, .024, .038, .028, K.puttee);
        if (hi) { b(lx, .04, ls * .8, .026, .004, .03, K.belt); b(lx, .026, ls * .8, .026, .003, .03, K.belt); }
        b(lx, .067, ls * .45, .027, .036, .032, U2);
      }
    } else { // kneeling on the right knee, left foot planted forward
      d = -.045;
      b(-.016, .007, .052, .026, .014, .04, K.boot); b(-.016, .026, .048, .024, .036, .026, K.puttee); b(-.016, .046, .028, .027, .024, .05, U2);
      b(.016, .012, -.035, .024, .022, .05, K.puttee); b(.016, .008, -.066, .022, .016, .016, K.boot); b(.016, .036, -.004, .027, .042, .03, U2);
    }
    // tunic, belt, collar
    b(0, .084 + d, 0, .074, .03, .05, U2);
    b(0, .119 + d, 0, .07, .054, .044, U);
    b(0, .089 + d, 0, .076, .01, .052, K.belt);
    b(0, .148 + d, .002, .05, .01, .038, U2);
    // pack with the blanket roll on top
    b(0, .118 + d, -.033, .052, .05, .022, K.pack); b(0, .15 + d, -.037, .064, .016, .02, K.khaki);
    if (hi) {
      b(0, .089 + d, .0265, .012, .008, .003, K.brass);
      for (let sd = -1; sd <= 1; sd += 2) {
        b(sd * .025, .096 + d, .0275, .018, .016, .008, K.leather); b(sd * .021, .123 + d, .0225, .007, .046, .002, K.leather);
        b(sd * .026, .15 + d, -.037, .004, .018, .022, K.leather);
      }
      b(.04, .074 + d, -.006, .013, .022, .016, K.khaki); b(.04, .087 + d, -.006, .006, .004, .006, K.gun); // canteen
      b(-.03, .07 + d, -.03, .012, .03, .008, K.wood); b(-.03, .052 + d, -.03, .016, .012, .004, K.steel); // entrenching tool
      b(0, .121 + d, -.045, .022, .02, .006, K.steel); // mess tin
    }
    // head
    b(0, .153 + d, 0, .022, .01, .022, K.skin); b(0, .171 + d, .002, .04, .036, .04, K.skin);
    if (hi) {
      b(-.009, .173 + d, .0225, .007, .006, .002, K.eye); b(.009, .173 + d, .0225, .007, .006, .002, K.eye);
      b(0, .166 + d, .024, .007, .01, .005, K.skin);
      for (let sd = -1; sd <= 1; sd += 2) b(sd * .0215, .169 + d, 0, .004, .012, .01, K.skin);
      if (f === 2 || f === 3 || f === 5) b(0, .159 + d, .0225, .022, .004, .002, K.stache);
      else b(0, .158 + d, .0225, .012, .002, .002, K.eye);
    }
    this.helmet(f, .19 + d);
    // arms and whatever they hold
    if (pose === POSE_RIFLE) {
      b(.043, .123 + d, .006, .018, .036, .022, U2); b(.033, .104 + d, .022, .016, .016, .03, U2); b(.022, .103 + d, .038, .014, .014, .014, K.skin);
      b(-.043, .123 + d, .01, .018, .036, .022, U2); b(-.022, .11 + d, .042, .04, .016, .016, U2); b(.004, .11 + d, .068, .014, .014, .014, K.skin);
      const rx = .013, ry = .108 + d;
      b(rx, ry - .004, .02, .012, .02, .04, K.wood); b(rx, ry, .074, .01, .012, .07, K.wood); b(rx, ry + .002, .122, .005, .005, .03, K.steel);
      if (hi) {
        b(rx + .007, ry + .006, .044, .006, .004, .012, K.steel); b(rx, ry + .004, .098, .012, .006, .005, K.steel);
        b(rx, ry - .008, .07, .003, .004, .06, K.leather); b(rx, ry + .002, .152, .003, .003, .032, K.bayo);
      }
    } else if (pose === POSE_HANG) {
      for (let sd = -1; sd <= 1; sd += 2) { b(sd * .044, .113 + d, .004, .018, .058, .022, U2); b(sd * .044, .079 + d, .006, .014, .014, .014, K.skin); }
    } else {
      for (let sd = -1; sd <= 1; sd += 2) { b(sd * .043, .123 + d, .008, .018, .036, .022, U2); b(sd * .036, .11 + d, .034, .016, .016, .036, U2); b(sd * .032, .11 + d, .056, .014, .014, .014, K.skin); }
      if (pose === POSE_SHELL) { b(0, .11 + d, .062, .05, .018, .018, K.brass); b(.03, .11 + d, .062, .012, .012, .012, K.gun); }
    }
  }

  /** A track run on one side: dark links with a lighter top run, road wheels on the outer face, link stripes and caked mud. */
  private track(x: number, y: number, z: number, face: number, S: number, lx: number, len: number, h: number, w: number, lz = 0) {
    const p = this.part.bind(this), out = lx > 0 ? 1 : -1;
    p(x, y, z, face, lx * S, h / 2 * S, lz * S, w * S, h * S, len * S, K.track);
    p(x, y, z, face, lx * S, (h - .004) * S, lz * S, w * 1.04 * S, .008 * S, len * .94 * S, K.trackHi);
    const n = Math.max(3, Math.round(len / .05));
    for (let k = 0; k < n; k++) {
      const tz = lz + (k + .5) / n * len * .86 - len * .43;
      p(x, y, z, face, (lx + out * w * .52) * S, h * .42 * S, tz * S, .005 * S, h * .5 * S, h * .5 * S, K.wheel);
      p(x, y, z, face, lx * S, h * S, (tz + len / n * .43) * S, w * 1.06 * S, .004 * S, .008 * S, K.rivet);
      if (this.hi) {
        p(x, y, z, face, (lx + out * w * .52) * S, h * .42 * S, tz * S, .007 * S, h * .14 * S, h * .14 * S, K.hatch);
        p(x, y, z, face, lx * S, .002 * S, (tz + len / n * .2) * S, w * 1.08 * S, .004 * S, .006 * S, K.rivet);
        if ((k * 7 + Math.round(lx * 100)) % 3 !== 0) p(x, y, z, face, (lx + out * w * .53) * S, h * .14 * S, (tz + .012) * S, .006 * S, h * .26 * S, len / n * .7 * S, k % 2 ? K.mud : K.dirt);
      }
    }
  }

  /** WW1-era armour in Command & Conquer detail: tracks with wheels and links, lit top plates, hatches, vision slits, rivets, guns. */
  private tank(x: number, y: number, z: number, face: number, f: number, S: number) {
    { const tk = TANK_OF[f] ?? 'tank_mk4'; if (this.mesh?.has(tk)) { this.mesh.push(tk, x, y, z, face, S, TANKC[f] ?? K.olive); return; } }
    const p = this.part.bind(this), c = TANKC[f], d = TANKD[f], l = TANKL[f], hi = this.hi;
    if (f === 1) { // Renault FT: light tank with a rotating turret
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
      if (!hi) return;
      this.at(x, y, z, face, S); const b = this.b;
      for (let sd = -1; sd <= 1; sd += 2) {
        b(sd * .07, .074, -.01, .044, .012, .2, K.hatch); // leaf-spring housing over the track
        for (let k = 0; k < 6; k++) b(sd * .093, .074, -.09 + k * .035, .003, .005, .005, K.rivet);
        b(sd * .036, .142, .02, .002, .006, .03, K.slit); // turret vision slits
        b(sd * .03, .04, -.21, .008, .008, .08, K.gun); // tail skid
      }
      b(0, .032, -.25, .07, .008, .008, K.gun);
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; b(Math.cos(a) * .03, .174, .02 + Math.sin(a) * .03, .005, .004, .005, K.rivet); }
      b(0, .195, .02, .018, .008, .018, K.hatch);
      for (let k = 0; k < 4; k++) b(0, .07, -.07 - k * .018, .07, .005, .008, K.rivet); // engine louvres
      b(.03, .103, .123, .012, .012, .006, K.steel); // headlamp
      for (let k = -1; k <= 1; k++) b(k * .02, .115, .121, .004, .004, .003, K.rivet);
      return;
    }
    if (f === 3) { // A7V: heavy box-hulled assault tank
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
      if (!hi) return;
      this.at(x, y, z, face, S); const b = this.b;
      for (let sd = -1; sd <= 1; sd += 2) {
        for (let k = 0; k < 10; k++) { b(sd * .1, .148, -.135 + k * .03, .004, .004, .004, K.rivet); b(sd * .109, .06, -.135 + k * .03, .003, .004, .004, K.rivet); }
        for (let k = -1; k <= 1; k += 2) b(sd * .1095, .1, k * .05, .002, .08, .004, K.rivet); // plate seams
        b(sd * .112, .1, -.01, .012, .012, .022, K.gun); b(sd * .112, .1, -.11, .012, .012, .022, K.gun); // more MG ports
        // Iron cross
        b(sd * .1105, .118, -.035, .003, .032, .032, K.rWhite); b(sd * .112, .118, -.035, .003, .026, .008, K.blk); b(sd * .112, .118, -.035, .003, .008, .026, K.blk);
        b(sd * .03, .1, -.163, .014, .012, .012, K.gun);
      }
      b(0, .11, .186, .064, .064, .01, K.hatch); // gun mantlet
      for (let k = 0; k < 3; k++) b(-.024 + k * .024, .19, -.016, .012, .006, .003, K.slit);
      b(.05, .158, -.08, .05, .014, .05, K.tarp); b(.05, .167, -.08, .03, .006, .03, K.canvas2); // stowed tarpaulin
      return;
    }
    // Mark IV rhomboid: tracks wrap around a tall hull, gun sponsons on both sides
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
    if (!hi) return;
    this.at(x, y, z, face, S); const b = this.b;
    for (let sd = -1; sd <= 1; sd += 2) {
      for (let k = 0; k < 5; k++) { b(sd * .161, .068, -.01 + k * .02, .003, .004, .004, K.rivet); b(sd * .161, .11, -.01 + k * .02, .003, .004, .004, K.rivet); }
      b(sd * .161, .085, .055, .002, .028, .02, K.hatch); // sponson door
      b(sd * .162, .089, .045, .002, .004, .006, K.brass);
      for (let k = 0; k < 9; k++) b(sd * .076, .138, -.12 + k * .03, .004, .004, .004, K.rivet);
      b(sd * .07, .157, -.1, .008, .008, .14, K.trackHi); // unditching rails
      b(sd * .1, .158, -.17, .05, .03, .02, K.track); b(sd * .1, .174, -.17, .052, .005, .02, K.trackHi); // rear horns
    }
    b(-.02, .165, .136, .008, .008, .03, K.gun); // Lewis gun in the cab
    for (let k = -1; k <= 1; k++) b(k * .022, .152, .136, .01, .003, .003, K.slit);
    b(.04, .152, -.02, .03, .02, .06, K.tarp); b(.04, .162, -.02, .034, .004, .012, K.leather);
    b(0, .18, -.12, .012, .012, .06, K.exhaust); // exhaust silencer on the roof
  }

  /** Maxim / Vickers machine gun: water-cooled barrel, belt feed from an ammunition box, its mount and a crew of two. */
  private mg(x: number, y: number, z: number, face: number, f: number, S: number) {
    this.at(x, y, z, face, S);
    if (this.mesh?.has('mg')) {
      this.mesh.push('mg', x, y, z, face, S * 1.1, TANKC[f] ?? K.olive);
      this.soldier(this.wx(0, -.075), y, this.wz(0, -.075), face, f, S, true, 0, POSE_GRIP);
      this.soldier(this.wx(.1, -.03), y, this.wz(.1, -.03), face - .7, f, S, true, 0, POSE_GRIP);
      return;
    }
    const b = this.b, hi = this.hi, gy = .05;
    if (f === 2) { // Sokolov wheeled mount with a gun shield
      for (let sd = -1; sd <= 1; sd += 2) this.wheel(sd * .05, .028, -.01, .024, .01, K.tyre, K.gun);
      b(0, .028, -.01, .1, .008, .008, K.gun); b(0, .02, -.07, .016, .012, .1, K.gun);
      b(0, .078, .055, .1, .07, .006, K.olive); b(0, .1, .056, .02, .012, .007, K.slit);
      if (hi) for (let k = 0; k < 5; k++) { b(-.04 + k * .02, .11, .059, .004, .004, .002, K.rivet); b(-.04 + k * .02, .048, .059, .004, .004, .002, K.rivet); }
    } else if (f === 3 || f === 4) { // sledge mount
      for (let sd = -1; sd <= 1; sd += 2) { b(sd * .032, .008, .02, .01, .008, .17, K.gun); b(sd * .032, .014, .105, .01, .012, .01, K.gun); }
      b(0, .012, -.04, .074, .006, .01, K.gun); b(0, .012, .07, .074, .006, .01, K.gun); b(0, .03, .03, .014, .036, .014, K.gun);
    } else { // tripod
      b(0, .024, .09, .008, .008, .08, K.gun); b(0, .036, .03, .022, .022, .022, K.gun);
      for (let sd = -1; sd <= 1; sd += 2) b(sd * .032, .02, -.02, .008, .008, .07, K.gun, sd * .55);
    }
    // water jacket, muzzle booster, receiver, grips
    b(0, gy, .09, .034, .034, .11, K.jacket);
    b(0, gy, .152, .018, .018, .016, K.gun); b(0, gy, .166, .007, .007, .014, K.gun);
    b(0, gy + .002, .014, .036, .036, .05, K.gun);
    if (hi) {
      for (let k = 0; k < 5; k++) b(0, gy + .0175, .045 + k * .022, .03, .002, .012, K.wheel); // jacket fluting
      b(0, gy + .02, .06, .008, .006, .008, K.brass); b(0, gy, .039, .038, .038, .004, K.gun); b(0, gy, .142, .038, .038, .004, K.gun);
      b(0, gy + .021, .014, .03, .006, .04, K.hatch); b(.024, gy + .004, .02, .012, .014, .018, K.brass);
      b(0, gy + .004, -.014, .03, .008, .008, K.gun);
      for (let sd = -1; sd <= 1; sd += 2) b(sd * .014, gy + .004, -.022, .006, .008, .012, K.wood);
      b(0, gy + .026, .05, .004, .012, .004, K.gun);
      for (let k = 0; k < 7; k++) b(.034 + k * .008, gy - .004 - k * .005, .022, .007, .004, .012, K.brass); // belt
      if (f === 0) { b(-.065, .02, .05, .022, .04, .022, K.olive); b(-.033, .03, .09, .06, .004, .004, K.rivet); } // condenser can and hose
    }
    // ammunition box
    b(.088, .016, .022, .03, .032, .045, K.olive);
    if (hi) { b(.088, .033, .022, .032, .004, .047, K.hatch); b(.088, .038, .022, .004, .004, .02, K.gun); b(.115, .006, .07, .03, .012, .045, K.olive, .4); }
    // crew: gunner behind the grips, loader feeding the belt
    const gx = this.wx(0, -.075), gz = this.wz(0, -.075), lx = this.wx(.1, -.03), lz = this.wz(.1, -.03);
    this.soldier(gx, y, gz, face, f, S, true, 0, POSE_GRIP);
    this.soldier(lx, y, lz, face - .7, f, S, true, 0, POSE_GRIP);
  }

  /** Field gun (18-pounder / 75 mm): spoked wheels, gun shield, recoiling barrel on its cradle, box trail with spade, ammunition and crew. */
  private fieldGun(x: number, y: number, z: number, face: number, f: number, S: number, recoil: number) {
    this.at(x, y, z, face, S);
    if (this.mesh?.has('art')) {
      const rb = recoil * .04 * S;
      this.mesh.push('art', x - Math.sin(face) * rb, y, z - Math.cos(face) * rb, face, S * 1.25, TANKC[f] ?? K.olive);
      this.soldier(this.wx(.11, -.07), y, this.wz(.11, -.07), face, f, S, true, 0, POSE_GRIP);
      this.soldier(this.wx(-.12, -.11), y, this.wz(-.12, -.11), face + .3, f, S, true, 0, POSE_SHELL);
      if (this.hi) this.soldier(this.wx(.04, -.22), y, this.wz(.04, -.22), face + .2, f, S, false, 0, POSE_HANG);
      return;
    }
    const b = this.b, hi = this.hi, rb = recoil * .04;
    for (let sd = -1; sd <= 1; sd += 2) this.wheel(sd * .08, .058, 0, .056, .012, K.tyre, K.wood);
    b(0, .058, 0, .17, .012, .012, K.gun);
    // trail and spade
    b(0, .04, -.1, .036, .02, .17, K.olive); b(0, .022, -.185, .052, .03, .012, K.gun);
    // cradle, barrel, breech
    b(0, .088, .05 - rb, .03, .022, .15, K.olive);
    if (f === 1) { // Canon de 75: long slim barrel with its recuperator underneath
      b(0, .108, .13 - rb, .018, .018, .28, K.gun); b(0, .108, .27 - rb, .022, .022, .012, K.gun); b(0, .092, .08 - rb, .02, .014, .16, K.hatch);
    } else if (f === 4) { // Škoda siege howitzer: short fat barrel and a heavy breech
      b(0, .116, .08 - rb, .042, .042, .17, K.gun); b(0, .116, .165 - rb, .048, .048, .016, K.gun); b(0, .112, -.02 - rb, .05, .05, .05, K.hatch);
    } else { b(0, .108, .1 - rb, .022, .022, .22, K.gun); b(0, .108, .21 - rb, .026, .026, .014, K.gun); }
    b(0, .106, -.015 - rb, .036, .034, .04, K.hatch);
    // shield
    b(0, .11, .03, .15, .075, .008, K.olive); b(0, .044, .032, .12, .04, .006, K.olive);
    if (hi) {
      b(0, .0505, -.12, .03, .004, .1, K.wheel); b(0, .05, -.16, .07, .006, .006, K.wood); // trail top, handspike
      for (let sd = -1; sd <= 1; sd += 2) { b(sd * .045, .075, -.02, .022, .006, .02, K.gun); b(sd * .045, .066, -.02, .006, .016, .006, K.gun); }
      b(0, .108, -.036 - rb, .02, .02, .004, K.steel); b(.022, .1, -.03 - rb, .006, .006, .022, K.steel);
      b(0, .121, .1 - rb, .024, .002, .2, K.trackHi);
      for (let k = 0; k < 8; k++) { b(-.07 + k * .02, .144, .035, .004, .004, .003, K.rivet); b(-.07 + k * .02, .076, .035, .004, .004, .003, K.rivet); }
      b(0, .149, .03, .152, .004, .012, K.wheel); b(-.032, .126, .035, .014, .01, .003, K.slit);
      b(-.03, .134, .0, .008, .026, .01, K.brass); b(-.03, .15, .0, .01, .008, .016, K.gun); // sight
      // ammunition: an open crate and shells laid out beside the gun
      b(-.14, .016, -.1, .046, .032, .05, K.crate); b(-.14, .033, -.1, .04, .002, .044, K.wood);
      for (let k = 0; k < 3; k++) b(-.15 + k * .014, .037, -.1, .01, .01, .03, K.brass);
      for (let k = 0; k < 3; k++) { b(-.1, .006, -.05 + k * .014, .03, .01, .01, K.brass); b(-.08, .006, -.05 + k * .014, .01, .008, .008, K.gun); }
    }
    // crew: layer at the sight, loader with a shell, a third man on the trail (close up only)
    const ax = this.wx(.11, -.07), az = this.wz(.11, -.07), lx = this.wx(-.12, -.11), lz = this.wz(-.12, -.11), tx = this.wx(.04, -.22), tz = this.wz(.04, -.22);
    this.soldier(ax, y, az, face, f, S, true, 0, POSE_GRIP);
    this.soldier(lx, y, lz, face + .3, f, S, true, 0, POSE_SHELL);
    if (hi) this.soldier(tx, y, tz, face + .2, f, S, false, 0, POSE_HANG);
  }

  /**
   * An infantryman in battle, posed from what he is doing (design 1.2): marching (stride frames), firing from the trench
   * (rifle shouldered), pinned in the open (prone, or kneeling to fire), throwing a grenade. Falls back to `soldier` without meshes.
   */
  infantry(x: number, y: number, z: number, face: number, f: number, S: number, st: { walk: number; recoil: number; trench: boolean; id: number }) {
    const M = this.mesh;
    if (!M?.has('soldier_aim') || !this.hiMesh || st.walk) { this.soldier(x, y, z, face, f, S, false, st.walk); return; }
    const U = UNI[f] ?? K.khaki, helm = HELM_OF[f] ?? 'helm_stahl', h = (st.id * 2654435761 >>> 0) % 9, firing = st.recoil > .05;
    if (st.trench) {
      if (firing && h === 0) { M.push('soldier_throw', x, y, z, face, S, U); M.push(helm, x, y + .188 * S, z, face, S, U); return; }
      M.push(firing ? 'soldier_aim' : 'soldier', x, y, z, face, S, U); M.push(helm, x, y + .19 * S, z, face, S, U); return;
    }
    if (h < 3) { // kneeling to fire
      M.push(firing ? 'soldier_kneel_aim' : 'soldier_kneel', x, y, z, face, S, U); M.push(helm, x, y + .145 * S, z, face, S, U); return;
    }
    // prone: the helmet tips forward with the head
    M.push('soldier_prone', x, y, z, face, S, U);
    M.push(helm, x + Math.sin(face) * .19 * S, y + .06 * S, z + Math.cos(face) * .19 * S, face, S, U, 0, Math.PI / 2);
  }

  /** Draw any unit type. `recoil` (0..1) pulls an artillery barrel back after a shot. */
  unit(type: UnitType, x: number, y: number, z: number, face: number, f: number, S: number, walk: number, recoil: number) {
    if (type === 'inf') { this.soldier(x, y, z, face, f, S, false, walk); return; }
    if (type === 'plane') { this.plane(x, y, z, face, FLAG[f] ?? K.wing, S * .9, f); return; }
    if (type === 'mg') { this.mg(x, y, z, face, f, S); return; }
    if (type === 'art') { this.fieldGun(x, y, z, face, f, S, recoil); return; }
    this.tank(x, y, z, face, f, S);
  }

  /** National marking lying flat on a wing (roundel, cross or square), r = half size. */
  private marking(lx: number, ly: number, lz: number, r: number, f: number) {
    const b = this.b;
    if (f === 3 || f === 4) { b(lx, ly, lz, r * 2, .002, r * 2, K.rWhite); b(lx, ly + .001, lz, r * 1.7, .002, r * .55, K.blk); b(lx, ly + .001, lz, r * .55, .002, r * 1.7, K.blk); return; }
    if (f === 5) { b(lx, ly, lz, r * 2, .002, r * 2, K.rWhite); b(lx, ly + .001, lz, r * 1.3, .002, r * 1.3, K.blk); return; }
    const o = f === 1 ? K.rRed : f === 2 ? K.rWhite : K.rBlue, m = f === 2 ? K.rBlue : K.rWhite, i = f === 1 ? K.rBlue : K.rRed;
    b(lx, ly, lz, r * 2, .002, r * 1.3, o); b(lx, ly, lz, r * 1.3, .002, r * 2, o);
    b(lx, ly + .0005, lz, r * 1.35, .002, r * .9, m); b(lx, ly + .0005, lz, r * .9, .002, r * 1.35, m);
    b(lx, ly + .001, lz, r * .6, .002, r * .6, i);
  }

  /** Biplane: tapering fuselage, two wings with struts and markings, spinning propeller, pilot, guns, tail and fixed undercarriage. f < 0 = no markings. */
  plane(x: number, y: number, z: number, face: number, c: THREE.Color, S: number, f = -1) {
    this.at(x, y, z, face, S);
    if (this.mesh?.has('plane')) {
      this.mesh.push('plane', x, y, z, face, S, c);
      this.mesh.push('prop', x, y, z, face, S, K.wood, this.t * 38 + x * 7);
      if (f >= 0 && f < 7) this.mesh.push(`mark_${f}` as MeshKey, x, y, z, face, S, K.wood);
      return;
    }
    const b = this.b, hi = this.hi;
    // fuselage
    b(0, 0, .105, .054, .054, .02, K.hatch); b(0, 0, .06, .048, .048, .07, c); b(0, 0, -.01, .042, .042, .07, c);
    b(0, -.002, -.07, .032, .032, .05, c); b(0, -.002, -.11, .02, .024, .04, c);
    // wings
    b(0, .06, .04, .38, .008, .065, K.wing); b(0, -.022, .045, .34, .008, .06, K.wing);
    for (let sd = -1; sd <= 1; sd += 2) b(sd * .13, .019, .04, .006, .074, .006, K.pole);
    // tail
    b(0, 0, -.125, .13, .006, .035, K.wing); b(0, .022, -.125, .006, .04, .03, c);
    // propeller, drawn as the projection of the spinning blades
    const a = this.t * 38 + x * 7, ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
    b(0, 0, .12, .014, .014, .012, K.gun); b(0, 0, .124, .15 * ca + .012, .012, .004, K.prop); b(0, 0, .124, .012, .15 * sa + .012, .004, K.prop);
    // pilot and gun
    b(0, .024, -.005, .028, .004, .03, K.slit); b(0, .033, -.008, .018, .018, .018, K.leather);
    b(0, .034, .062, .008, .008, .045, K.gun); b(0, 0, .135, .006, .006, .006, K.gun, 0, this.glowPool);
    if (!hi) return;
    b(0, .025, .03, .03, .004, .06, K.wing); // decking
    b(0, .036, .0015, .02, .005, .002, K.glass); b(0, .029, .0005, .014, .007, .002, K.skin); b(0, .033, .012, .026, .012, .002, K.glass);
    for (let k = 0; k < 6; k++) { const an = k / 6 * Math.PI * 2; b(Math.cos(an) * .022, Math.sin(an) * .022, .1, .01, .01, .012, K.wheel); } // rotary cylinders
    if (f === 3 || f === 4) b(.012, .034, .062, .008, .008, .045, K.gun);
    for (let k = -4; k <= 4; k++) if (k) { b(k * .042, .0645, .04, .004, .002, .062, K.canvas2); b(k * .038, -.0175, .045, .004, .002, .058, K.canvas2); }
    for (let sd = -1; sd <= 1; sd += 2) {
      b(sd * .14, .06, .0045, .09, .009, .012, K.canvas2); // ailerons
      b(sd * .13, .019, .062, .006, .074, .006, K.pole); b(sd * .022, .04, .05, .005, .04, .005, K.pole);
      b(sd * .022, -.044, .06, .006, .04, .006, K.pole); b(sd * .036, -.062, .06, .008, .026, .026, K.tyre); // undercarriage
      if (f >= 0) { this.marking(sd * .13, .0655, .04, .022, f); this.marking(sd * .12, -.0175, .045, .02, f); }
    }
    b(0, -.062, .06, .07, .005, .005, K.pole); b(0, -.02, -.12, .004, .02, .004, K.pole);
    b(0, .0035, -.137, .13, .007, .008, K.canvas2);
    // rudder stripes (blue, white, red) for the British and French, plain otherwise
    if (f === 0 || f === 1) { b(0, .024, -.138, .007, .044, .007, K.rBlue); b(0, .024, -.145, .007, .044, .007, K.rWhite); b(0, .024, -.152, .007, .044, .007, K.rRed); }
    else b(0, .024, -.145, .006, .044, .02, c);
  }

  /** Dreadnought (or, with `merchant`, a cargo steamer): tapering hull, turrets, bridge, funnels, masts, boats and a wake. */
  ship(x: number, z: number, face: number, band: THREE.Color, S: number, t: number, merchant = false, aim?: number, sink = 0) {
    const y = .12 + Math.sin(t * 2 + x) * .008 - sink;
    if (this.mesh?.has(merchant ? 'liner' : 'dreadnought') && sink < .02) {
      // baked hull; the turrets turn on their own to the bearing of the target
      this.mesh.push(merchant ? 'liner' : 'dreadnought', x, y, z, face, S, band);
      if (!merchant && this.mesh.has('turret')) {
        const sf = Math.sin(face), cf = Math.cos(face);
        for (const [tz, ty, dir] of [[.21, .066, 1], [.145, .088, 1], [-.045, .052, -1], [-.15, .072, -1], [-.215, .052, -1]] as const) {
          const a = aim ?? (dir > 0 ? 0 : Math.PI);
          this.mesh.push('turret', x + tz * S * sf, y + ty * S, z + tz * S * cf, face + a, S, band);
        }
      }
      return;
    }
    this.at(x, y, z, face, S);
    const b = this.b, hi = this.hi, H = merchant ? K.merch : K.navy, D = merchant ? K.deck : K.plank;
    // hull: full midships, tapering bow, rounded stern
    b(0, .025, 0, .14, .05, .42, H); b(0, .026, .235, .11, .048, .05, H); b(0, .027, .275, .07, .046, .035, H); b(0, .028, .305, .03, .044, .03, H);
    b(0, .025, -.23, .12, .046, .04, H); b(0, .025, -.255, .08, .044, .02, H);
    b(0, .04, 0, .142, .008, .42, band);
    b(0, .051, 0, .124, .004, .42, D); b(0, .051, .24, .09, .004, .05, D); b(0, .052, .275, .05, .004, .03, D);
    if (merchant) {
      b(0, .064, .22, .11, .026, .1, H); b(0, .064, -.21, .11, .026, .08, H);
      b(0, .074, 0, .1, .045, .08, K.cream); b(0, .105, .015, .06, .02, .04, K.cream);
      b(0, .12, -.04, .04, .08, .05, K.funnel); b(0, .162, -.04, .042, .008, .052, K.blk);
      b(0, .06, .12, .06, .014, .06, K.tarp); b(0, .06, -.12, .06, .014, .06, K.tarp);
      b(0, .14, .17, .007, .17, .007, K.pole); b(0, .13, -.17, .007, .15, .007, K.pole);
      if (hi) {
        b(0, .105, .0355, .05, .006, .002, K.glass); b(0, .084, .0405, .08, .005, .002, K.glass);
        for (let sd = -1; sd <= 1; sd += 2) {
          b(sd * .045, .1, .08, .006, .006, .07, K.pole, sd * .3); b(sd * .045, .1, -.08, .006, .006, .07, K.pole, -sd * .3); // derricks
          b(sd * .045, .066, -.03, .016, .01, .04, K.white);
          for (let k = 0; k < 9; k++) b(sd * .0705, .03, -.16 + k * .04, .002, .005, .005, K.slit);
        }
        b(0, .068, .12, .064, .004, .002, K.beam); b(0, .068, -.12, .064, .004, .002, K.beam);
        b(0, .002, 0, .144, .008, .43, K.red);
      }
    } else {
      const turret = (tz: number, ty: number, dir: number) => {
        // turned to the bearing of the target when in action (`aim`, relative to the bow), else fore and aft
        const a = aim ?? (dir > 0 ? 0 : Math.PI), sa = Math.sin(a), ca = Math.cos(a);
        b(0, ty, tz, .06, .028, .058, K.navy3, a); b(0, ty + .015, tz, .05, .004, .048, K.navy4, a);
        for (let sd = -1; sd <= 1; sd += 2) b(sd * .013 * ca + sa * .065, ty + .003, tz + ca * .065 - sd * .013 * sa, .008, .008, .075, K.gun, a);
        if (hi) { b(-sa * .012, ty + .02, tz - ca * .012, .07, .008, .012, K.navy2, a); for (let sd = -1; sd <= 1; sd += 2) b(sd * .013 * ca + sa * .1, ty + .003, tz + ca * .1 - sd * .013 * sa, .01, .01, .006, K.gun, a); }
      };
      turret(.17, .066, 1); b(0, .07, .1, .052, .03, .052, H); turret(.1, .095, 1); turret(-.17, .066, -1);
      b(0, .075, .035, .08, .045, .07, K.navy3); b(0, .104, .045, .1, .014, .05, K.navy3); b(0, .088, .078, .03, .04, .03, K.navy2);
      for (const fz of [-.01, -.075]) { b(0, .11, fz, .036, .09, .046, K.navy2); b(0, .132, fz, .038, .012, .048, band); b(0, .158, fz, .038, .006, .048, K.blk); }
      b(0, .17, .055, .008, .16, .008, K.pole); b(0, .22, .055, .08, .005, .005, K.pole);
      b(0, .14, -.13, .007, .13, .007, K.pole); b(0, .18, -.13, .06, .005, .005, K.pole);
      if (hi) {
        b(0, .1, .0705, .07, .006, .002, K.glass); b(0, .2, .055, .03, .01, .03, K.navy2);
        for (let sd = -1; sd <= 1; sd += 2) {
          b(sd * .02, .13, .04, .005, .11, .005, K.pole); // tripod legs
          b(sd * .05, .066, -.04, .018, .012, .045, K.cream); b(sd * .05, .074, -.04, .016, .003, .04, K.tarp); // boats
          for (let k = 0; k < 3; k++) b(sd * .08, .042, .07 - k * .06, .024, .006, .006, K.gun); // casemate guns
          for (let k = 0; k < 9; k++) b(sd * .0705, .03, -.16 + k * .04, .002, .005, .005, K.slit);
          b(sd * .04, .06, .21, .01, .006, .01, K.gun); // capstans
        }
        b(0, .002, 0, .144, .008, .43, K.red);
        for (let k = -2; k <= 2; k++) b(k * .024, .0535, 0, .002, .001, .4, K.beam);
        b(0, .085, -.265, .004, .06, .004, K.pole); b(0, .107, -.282 + Math.sin(t * 6) * .002, .002, .018, .03, band, Math.sin(t * 4) * .2);
      }
    }
    // bow wave and stern wake, on the water surface
    const wy = (.126 - y) / S;
    b(0, wy, .3, .09, .01, .04, K.white); b(0, wy, -.3, .05, .008, .08, K.white);
    // a V of broken foam spreading behind the stern
    const n = hi ? 4 : 2;
    for (let k = 0; k < n; k++) for (let sd = -1; sd <= 1; sd += 2) {
      const w = (n - k) / n;
      b(sd * (.03 + k * .013), wy, -.32 - k * .04, .012 * w + .003, .005, .026 * w + .008, K.cloud2, -sd * .3);
    }
    if (hi) for (let sd = -1; sd <= 1; sd += 2) b(sd * .075, wy, .17, .01, .006, .12, K.cloud2);
  }

  /** Destroyer: long narrow hull, low bridge, four funnels, a gun fore and aft and torpedo tubes amidships. */
  destroyer(x: number, z: number, face: number, band: THREE.Color, S: number, t: number, sink = 0) {
    const y = .12 + Math.sin(t * 2.6 + x) * .01 - sink;
    if (this.mesh?.has('destroyer') && sink < .02) { this.mesh.push('destroyer', x, y, z, face, S, band); return; }
    this.at(x, y, z, face, S);
    const b = this.b, H = K.navy;
    b(0, .02, 0, .07, .04, .4, H); b(0, .021, .22, .05, .038, .05, H); b(0, .022, .255, .025, .036, .03, H); b(0, .02, -.21, .055, .036, .03, H);
    b(0, .032, 0, .072, .006, .4, band); b(0, .042, 0, .06, .004, .4, K.plank);
    b(0, .058, .13, .05, .03, .05, K.navy3); b(0, .078, .14, .03, .02, .03, K.navy2);
    for (let k = 0; k < 4; k++) { b(0, .07, .06 - k * .05, .022, .05, .026, K.navy2); b(0, .097, .06 - k * .05, .023, .006, .027, K.blk); }
    b(0, .054, .2, .02, .012, .03, K.gun); b(0, .056, .225, .006, .006, .04, K.gun); b(0, .054, -.17, .02, .012, .03, K.gun);
    if (this.hi) { for (let sd = -1; sd <= 1; sd += 2) b(sd * .018, .05, -.07, .012, .012, .06, K.gun); b(0, .12, .12, .005, .1, .005, K.pole); }
    const wy = (.126 - y) / S; b(0, wy, .28, .05, .008, .03, K.white); b(0, wy, -.27, .035, .006, .1, K.white);
    for (let k = 0; k < 3; k++) for (let sd = -1; sd <= 1; sd += 2) b(sd * (.02 + k * .012), wy, -.3 - k * .045, .01, .004, .03, K.cloud2, -sd * .35);
  }

  /** Aircraft carrier, Furious style: flight deck forward, bridge and funnel midships, landing deck aft; parked biplanes. */
  carrier(x: number, z: number, face: number, band: THREE.Color, S: number, t: number, planes: number, sink = 0) {
    const y = .12 + Math.sin(t * 1.8 + x) * .007 - sink;
    if (this.mesh?.has('carrier') && sink < .02) { this.mesh.push('carrier', x, y, z, face, S, band); }
    else {
      this.at(x, y, z, face, S);
      const b = this.b, H = K.navy;
      b(0, .028, 0, .13, .056, .44, H); b(0, .029, .25, .09, .052, .06, H); b(0, .03, .29, .05, .05, .03, H); b(0, .028, -.24, .11, .05, .04, H);
      b(0, .045, 0, .132, .008, .44, band);
      b(0, .066, .15, .15, .008, .2, K.plank); b(0, .062, .15, .13, .02, .2, K.navy2);
      b(0, .066, -.17, .15, .008, .15, K.plank); b(0, .062, -.17, .13, .02, .15, K.navy2);
      b(0, .08, 0, .06, .05, .07, K.navy3); b(0, .12, -.01, .03, .07, .035, K.navy2); b(0, .156, -.01, .032, .006, .037, K.blk);
      b(0, .14, .03, .006, .12, .006, K.pole);
      if (this.hi) { for (let k = 0; k < 7; k++) b(0, .0705, .07 + k * .03, .003, .001, .016, K.white); b(0, .071, -.17, .1, .001, .004, K.white); }
      const wy = (.126 - y) / S; b(0, wy, .32, .08, .01, .04, K.white); b(0, wy, -.3, .05, .008, .1, K.white);
    }
    // biplanes parked on the deck
    const sf = Math.sin(face), cf = Math.cos(face);
    for (let k = 0; k < Math.min(3, planes); k++) { const lz = (.2 - k * .07) * S; this.plane(x + lz * sf, y + .075 * S, z + lz * cf, face, band, .4 * S); }
  }

  /** Landing flotilla: a group of low armoured motor lighters ("Beetles") with bow ramps. */
  lighters(x: number, z: number, face: number, band: THREE.Color, S: number, t: number, n = 3, sink = 0) {
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * .13 * S, back = (k % 2) * .08 * S, sf = Math.sin(face), cf = Math.cos(face);
      const px = x + off * cf - back * sf, pz = z - off * sf - back * cf, y = .12 + Math.sin(t * 3 + k + x) * .01 - sink;
      if (this.mesh?.has('lighter') && sink < .02) { this.mesh.push('lighter', px, y, pz, face, S, band); continue; }
      this.at(px, y, pz, face, S);
      const b = this.b;
      b(0, .012, 0, .06, .024, .16, K.blk); b(0, .016, .085, .05, .02, .02, K.blk);
      b(0, .026, -.04, .04, .018, .05, K.navy2); b(0, .045, -.05, .01, .025, .01, K.blk);
      b(0, .026, .02, .05, .003, .08, band);
      const wy = (.126 - y) / S; b(0, wy, -.1, .03, .006, .06, K.white);
    }
  }

  /** Harbour: a stone quay along the water, two cranes and a warehouse; scaffolding while it is being built. */
  harbour(x: number, y: number, z: number, face: number, S: number, building = false) {
    if (this.mesh?.has('harbour') && !building) { this.mesh.push('harbour', x, y, z, face, S, K.stone); return; }
    this.at(x, y, z, face, S);
    const b = this.b;
    b(0, .015, .05, .5, .03, .08, K.stone); b(0, .032, .05, .5, .004, .08, K.concrete);
    if (building) { for (let k = 0; k < 3; k++) b(-.18 + k * .18, .07, -.02, .006, .1, .006, K.pole); b(0, .12, -.02, .4, .006, .006, K.pole); return; }
    b(-.12, .06, -.05, .16, .09, .08, K.brick); b(-.12, .11, -.05, .17, .02, .09, K.roof);
    for (const cx of [.08, .2]) {
      b(cx, .1, .04, .02, .16, .02, K.gun); b(cx, .18, .07, .015, .015, .1, K.gun); b(cx, .15, .12, .003, .06, .003, K.pole);
      b(cx, .03, .04, .04, .02, .04, K.navy2);
    }
  }

  /** Concrete pillbox with a firing slit facing `face`. `hold` = holdout (cut off, shown with a white flag). */
  pillbox(x: number, y: number, z: number, face: number, f: number, S: number, hold = false) {
    const p = this.part.bind(this);
    if (this.mesh?.has('pill')) {
      this.mesh.push('pill', x, y, z, face, S, K.concrete);
      p(x, y, z, face, -.06 * S, .11 * S, -.06 * S, .006 * S, .08 * S, .006 * S, K.pole);
      p(x, y, z, face, -.04 * S, .135 * S, -.06 * S, .04 * S, .025 * S, .004 * S, hold ? K.white : FLAG[f] ?? K.white);
      return;
    }
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

  /** Deep bunker: a low concrete block under an earth mound, two firing slits. `hold` = holdout (white flag). */
  bunker(x: number, y: number, z: number, face: number, f: number, S: number, hold = false) {
    const p = this.part.bind(this);
    if (this.mesh?.has('bunk')) {
      this.mesh.push('bunk', x, y, z, face, S * 1.2, K.concrete);
      p(x, y, z, face, -.1 * S, .13 * S, -.08 * S, .006 * S, .09 * S, .006 * S, K.pole);
      p(x, y, z, face, -.08 * S, .16 * S, -.08 * S, .04 * S, .025 * S, .004 * S, hold ? K.white : FLAG[f] ?? K.white);
      return;
    }
    p(x, y, z, face, 0, .012 * S, 0, .32 * S, .024 * S, .26 * S, K.mud);
    p(x, y, z, face, 0, .04 * S, -.01 * S, .26 * S, .05 * S, .2 * S, K.dirt);
    p(x, y, z, face, 0, .05 * S, .04 * S, .24 * S, .06 * S, .12 * S, K.concrete);
    p(x, y, z, face, 0, .085 * S, .02 * S, .25 * S, .014 * S, .16 * S, K.concrete2);
    for (const sd of [-1, 1]) { p(x, y, z, face, sd * .06 * S, .055 * S, .102 * S, .07 * S, .01 * S, .004 * S, K.slit); p(x, y, z, face, sd * .06 * S, .056 * S, .1 * S, .01 * S, .005 * S, .035 * S, K.gun); }
    p(x, y, z, face, -.1 * S, .13 * S, -.08 * S, .006 * S, .09 * S, .006 * S, K.pole);
    p(x, y, z, face, -.08 * S, .16 * S, -.08 * S, .04 * S, .025 * S, .004 * S, hold ? K.white : FLAG[f] ?? K.white);
  }

  /** A row of `rows` sandbag courses, `len` long, centred on (x, z) and running across `face`. */
  sandbags(x: number, y: number, z: number, face: number, len: number, rows: number, S: number) {
    const p = this.part.bind(this), n = Math.max(2, Math.round(len / (.06 * S)));
    for (let r = 0; r < rows; r++) for (let k = 0; k < n; k++) {
      const lx = (k + .5 - n / 2) * len / n + (r % 2 ? len / n / 2 : 0); if (Math.abs(lx) > len / 2) continue;
      p(x, y, z, face, lx, (.012 + r * .02) * S, 0, len / n * .92, .02 * S, .035 * S, (k + r) % 2 ? K.sand : K.sand2);
    }
  }

  /** A belt of barbed wire on posts, `len` long, `dense` 0..1. */
  wireBelt(x: number, y: number, z: number, face: number, len: number, dense: number, S: number) {
    const p = this.part.bind(this), n = Math.max(2, Math.round(len / (.09 * S) * (.4 + .6 * dense)));
    for (let k = 0; k < n; k++) {
      const lx = (k + .5 - n / 2) * len / n, lz = (k % 2 ? .02 : -.02) * S;
      p(x, y, z, face + (k % 2 ? .5 : -.5), lx, .03 * S, lz, .006 * S, .06 * S, .006 * S, K.wood);
      p(x, y, z, face, lx, .045 * S, lz, len / n, .003 * S, .003 * S, K.gun);
      p(x, y, z, face, lx, .02 * S, lz, len / n, .003 * S, .003 * S, K.gun);
    }
  }

  /** A zig-zag trench line, `len` long, deeper and wider with `depth` 1..3. */
  trenchLine(x: number, y: number, z: number, face: number, len: number, depth: number, S: number) {
    const p = this.part.bind(this), n = Math.max(3, Math.round(len / (.08 * S))), w = (.03 + .012 * depth) * S;
    for (let k = 0; k < n; k++) {
      const lx = (k + .5 - n / 2) * len / n, lz = (Math.floor(k / 2) % 2 ? .025 : -.025) * S;
      p(x, y, z, face, lx, .002 * S, lz, len / n * 1.25, .004 * S, w, K.mud);
      p(x, y, z, face, lx, .008 * S, lz + w * .6, len / n * 1.25, (.006 + .004 * depth) * S, .012 * S, K.dirt);
    }
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
    if (this.mesh?.has('hangar')) {
      const hx = .2 * S, hz = -.2 * S, co = Math.cos(face), si = Math.sin(face);
      this.mesh.push('hangar', x + hx * co + hz * si, y, z - hx * si + hz * co, face - Math.PI / 2, S * .75, FLAG[f] ?? K.wing);
    } else {
      p(x, y, z, face, .2 * S, .04 * S, -.2 * S, .16 * S, .08 * S, .2 * S, K.hangar);
      p(x, y, z, face, .2 * S, .085 * S, -.2 * S, .12 * S, .02 * S, .21 * S, K.roof); p(x, y, z, face, .2 * S, .1 * S, -.2 * S, .07 * S, .014 * S, .21 * S, K.roof);
      p(x, y, z, face, .118 * S, .03 * S, -.2 * S, .005 * S, .05 * S, .14 * S, K.slit);
    }
    p(x, y, z, face, -.14 * S, .05 * S, .35 * S, .005 * S, .1 * S, .005 * S, K.pole);
    p(x, y, z, face + Math.sin(t * 1.3) * .5, -.14 * S, .095 * S, .35 * S + .02 * S, .012 * S, .012 * S, .04 * S, K.funnel);
    for (let k = 0; k < Math.min(3, planes); k++) this.plane(x + Math.cos(face) * (.2 + k * .14) * S, y + .03 * S, z - Math.sin(face) * (.2 + k * .14) * S + .1 * S, face + Math.PI / 2, FLAG[f] ?? K.wing, .45 * S, f);
  }

  corpse(x: number, y: number, z: number, face: number, f: number, S = 1) {
    if (this.mesh?.has('soldier_dead') && this.hiMesh) {
      const U = UNI[f] ?? K.khaki, a = face + .4;
      this.mesh.push('soldier_dead', x, y, z, a, S, U);
      // the helmet knocked off, lying beside him
      this.mesh.push(HELM_OF[f] ?? 'helm_stahl', x + Math.cos(a) * .07 * S, y + .004 * S, z - Math.sin(a) * .07 * S, a + 1.3, S, U, .25);
      return;
    }
    this.at(x, y, z, face + .4, S); const b = this.b;
    b(0, .014, 0, .07, .028, .15, DEADC[f]); b(0, .02, .09, .04, .035, .04, K.skin);
    if (!this.hi) return;
    b(-.018, .01, -.088, .026, .016, .03, K.boot); b(.018, .01, -.084, .026, .016, .03, K.boot);
    b(0, .03, -.01, .05, .006, .07, K.pack); b(-.055, .012, .13, .05, .014, .05, HELM[f]);
    b(.06, .005, .04, .01, .008, .13, K.wood, .5); b(.06, .005, .1, .004, .004, .04, K.steel, .5);
  }
}
