// Particles, tracer lines and ground scorch decals. Structure-of-arrays storage so spawning and updating never allocates.
// Particles are drawn as volumetric sprites (see sprites.ts): lit smoke/dust puffs, additive fire, never boxes.
import * as THREE from 'three';
import type { LineBatch } from './pools';
import { K } from './palette';
import { FIREBALL, FLAME, GLOW, type Sprites } from './sprites';
import { clamp, col, lerp } from './util';

const MAX_P = 5000, MAX_T = 700, MAX_D = 400;
/** F_GLOW: additive glow (flash, spark, ember, tracer). F_MAP: map-scale, hidden when close. F_FLAME: a flame tongue.
 *  F_BALL: a fireball. F_HOT: smoke lit from inside by fire while young. F_THIN: faint haze. F_DUST: dust (drier, lighter). */
export const F_GLOW = 1, F_MAP = 2, F_FLAME = 4, F_BALL = 8, F_HOT = 16, F_THIN = 32, F_DUST = 64;

export const SCORCH = col('#2b2219');

export class FxSystem {
  private n = 0;
  private readonly x = new Float32Array(MAX_P); private readonly y = new Float32Array(MAX_P); private readonly z = new Float32Array(MAX_P);
  private readonly vx = new Float32Array(MAX_P); private readonly vy = new Float32Array(MAX_P); private readonly vz = new Float32Array(MAX_P);
  private readonly grav = new Float32Array(MAX_P); private readonly life = new Float32Array(MAX_P); private readonly max = new Float32Array(MAX_P);
  private readonly s0 = new Float32Array(MAX_P); private readonly s1 = new Float32Array(MAX_P); private readonly floor = new Float32Array(MAX_P);
  private readonly rot = new Float32Array(MAX_P); private readonly spin = new Float32Array(MAX_P); private readonly seed = new Float32Array(MAX_P);
  private readonly col: THREE.Color[] = new Array<THREE.Color>(MAX_P);
  private readonly flags = new Uint8Array(MAX_P);

  private tn = 0;
  private readonly tx0 = new Float32Array(MAX_T); private readonly ty0 = new Float32Array(MAX_T); private readonly tz0 = new Float32Array(MAX_T);
  private readonly tx1 = new Float32Array(MAX_T); private readonly ty1 = new Float32Array(MAX_T); private readonly tz1 = new Float32Array(MAX_T);
  private readonly tlife = new Float32Array(MAX_T); private readonly tmax = new Float32Array(MAX_T);

  // scorch decals (ring buffer: the oldest is replaced when full)
  private dn = 0; private dHead = 0;
  private readonly dx = new Float32Array(MAX_D); private readonly dy = new Float32Array(MAX_D); private readonly dz = new Float32Array(MAX_D);
  private readonly dr = new Float32Array(MAX_D); private readonly drot = new Float32Array(MAX_D); private readonly dseed = new Float32Array(MAX_D);
  private readonly dlife = new Float32Array(MAX_D); private readonly dmax = new Float32Array(MAX_D); private readonly dburn = new Float32Array(MAX_D);

  get count() { return this.n; }

  clear() { this.n = 0; this.tn = 0; this.dn = 0; this.dHead = 0; }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, grav: number, max: number, s0: number, s1: number, c: THREE.Color, flags = 0, floor = -1e9) {
    if (this.n >= MAX_P) return;
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz; this.grav[i] = grav;
    this.life[i] = 0; this.max[i] = max; this.s0[i] = s0; this.s1[i] = s1; this.col[i] = c; this.flags[i] = flags; this.floor[i] = floor;
    this.rot[i] = Math.random() * 6.283; this.spin[i] = (Math.random() - .5) * .7; this.seed[i] = Math.random();
  }

  tracer(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, max: number) {
    if (this.tn >= MAX_T) return;
    const i = this.tn++;
    this.tx0[i] = x0; this.ty0[i] = y0; this.tz0[i] = z0; this.tx1[i] = x1; this.ty1[i] = y1; this.tz1[i] = z1; this.tlife[i] = 0; this.tmax[i] = max;
  }

  /** A scorched crater on the ground that lasts `life` seconds; `burn` > 0 leaves embers glowing for a while. */
  decal(x: number, y: number, z: number, r: number, life: number, burn = 0) {
    const i = this.dn < MAX_D ? this.dn++ : (this.dHead = (this.dHead + 1) % MAX_D);
    this.dx[i] = x; this.dy[i] = y; this.dz[i] = z; this.dr[i] = r; this.drot[i] = Math.random() * 6.283; this.dseed[i] = Math.random();
    this.dlife[i] = 0; this.dmax[i] = life; this.dburn[i] = burn;
  }

  update(dt: number) {
    for (let i = this.n - 1; i >= 0; i--) {
      this.life[i] += dt;
      if (this.life[i] >= this.max[i]) { this.removeP(i); continue; }
      this.vy[i] -= this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt; this.z[i] += this.vz[i] * dt;
      if (this.y[i] < this.floor[i]) { this.y[i] = this.floor[i]; this.vx[i] *= .4; this.vz[i] *= .4; this.vy[i] = 0; }
    }
    for (let i = this.tn - 1; i >= 0; i--) {
      this.tlife[i] += dt;
      if (this.tlife[i] >= this.tmax[i]) this.removeT(i);
    }
    for (let i = 0; i < this.dn; i++) this.dlife[i] += dt;
  }

  private removeP(i: number) {
    const l = --this.n; if (i === l) return;
    this.x[i] = this.x[l]; this.y[i] = this.y[l]; this.z[i] = this.z[l]; this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l]; this.vz[i] = this.vz[l];
    this.grav[i] = this.grav[l]; this.life[i] = this.life[l]; this.max[i] = this.max[l]; this.s0[i] = this.s0[l]; this.s1[i] = this.s1[l];
    this.col[i] = this.col[l]; this.flags[i] = this.flags[l]; this.floor[i] = this.floor[l];
    this.rot[i] = this.rot[l]; this.spin[i] = this.spin[l]; this.seed[i] = this.seed[l];
  }
  private removeT(i: number) {
    const l = --this.tn; if (i === l) return;
    this.tx0[i] = this.tx0[l]; this.ty0[i] = this.ty0[l]; this.tz0[i] = this.tz0[l]; this.tx1[i] = this.tx1[l]; this.ty1[i] = this.ty1[l]; this.tz1[i] = this.tz1[l];
    this.tlife[i] = this.tlife[l]; this.tmax[i] = this.tmax[l];
  }

  /** Push every live particle and decal into the sprite batches. Particles flagged F_MAP are map-scale smoke and are hidden when the camera is close. */
  draw(sp: Sprites, near: boolean) {
    for (let i = 0; i < this.n; i++) {
      const f = this.flags[i];
      if ((f & F_MAP) && near) continue;
      const t = this.life[i] / this.max[i], s = lerp(this.s0[i], this.s1[i], t), c = this.col[i], x = this.x[i], y = this.y[i], z = this.z[i];
      if (f & F_FLAME) sp.fire(x, y + s * .55, z, s * .95, s * 1.8, c, Math.min(1, t * 8) * (1 - t * t), this.seed[i], t, FLAME);
      else if (f & F_BALL) sp.fire(x, y, z, s * 1.7, s * 1.7, c, 1, this.seed[i], t, FIREBALL, this.rot[i] + this.spin[i] * this.life[i]);
      else if (f & F_GLOW) sp.fire(x, y, z, s * 2.4, s * 2.4, c, 1 - t * t, this.seed[i], t, GLOW);
      else if (this.grav[i] > 0) sp.puff(x, y, z, s * 1.6, c, 1 - t * t * t, this.rot[i] + this.spin[i] * 4 * this.life[i], this.seed[i], 0);
      else {
        // dust is thin and already wispy when it appears; smoke starts dense and erodes
        const dust = (f & F_DUST) !== 0, base = f & F_THIN ? .38 : dust ? .5 : .92;
        sp.puff(x, y, z, s * (dust ? 2.1 : 1.75), c, base * clamp(t * 9, 0, 1), this.rot[i] + this.spin[i] * this.life[i], this.seed[i], dust ? .3 + t * .7 : t, f & F_HOT ? Math.max(0, 1 - t * 2.4) : 0);
      }
    }
    for (let i = 0; i < this.dn; i++) {
      const t = this.dlife[i], m = this.dmax[i]; if (t >= m) continue;
      const a = clamp((m - t) / (m * .3), 0, 1) * clamp(t * 6, 0, 1), r = this.dr[i];
      sp.decal(this.dx[i], this.dy[i], this.dz[i], r * 2.2, r * 1.8, SCORCH, a, this.drot[i], this.dseed[i], this.dburn[i] * Math.max(0, 1 - t / 14));
    }
  }

  drawTracers(lines: LineBatch) {
    for (let i = 0; i < this.tn; i++) lines.add(this.tx0[i], this.ty0[i], this.tz0[i], this.tx1[i], this.ty1[i], this.tz1[i], K.tracer);
  }
}
