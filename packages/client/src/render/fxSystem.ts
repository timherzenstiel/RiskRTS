// Particles and tracer lines. Structure-of-arrays storage so spawning and updating never allocates.
import type * as THREE from 'three';
import type { LineBatch, Pool } from './pools';
import { K } from './palette';
import { lerp } from './util';

const MAX_P = 5000, MAX_T = 700;
export const F_GLOW = 1, F_MAP = 2;

export class FxSystem {
  private n = 0;
  private readonly x = new Float32Array(MAX_P); private readonly y = new Float32Array(MAX_P); private readonly z = new Float32Array(MAX_P);
  private readonly vx = new Float32Array(MAX_P); private readonly vy = new Float32Array(MAX_P); private readonly vz = new Float32Array(MAX_P);
  private readonly grav = new Float32Array(MAX_P); private readonly life = new Float32Array(MAX_P); private readonly max = new Float32Array(MAX_P);
  private readonly s0 = new Float32Array(MAX_P); private readonly s1 = new Float32Array(MAX_P); private readonly floor = new Float32Array(MAX_P);
  private readonly col: THREE.Color[] = new Array<THREE.Color>(MAX_P);
  private readonly flags = new Uint8Array(MAX_P);

  private tn = 0;
  private readonly tx0 = new Float32Array(MAX_T); private readonly ty0 = new Float32Array(MAX_T); private readonly tz0 = new Float32Array(MAX_T);
  private readonly tx1 = new Float32Array(MAX_T); private readonly ty1 = new Float32Array(MAX_T); private readonly tz1 = new Float32Array(MAX_T);
  private readonly tlife = new Float32Array(MAX_T); private readonly tmax = new Float32Array(MAX_T);

  get count() { return this.n; }

  clear() { this.n = 0; this.tn = 0; }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, grav: number, max: number, s0: number, s1: number, c: THREE.Color, flags = 0, floor = -1e9) {
    if (this.n >= MAX_P) return;
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz; this.grav[i] = grav;
    this.life[i] = 0; this.max[i] = max; this.s0[i] = s0; this.s1[i] = s1; this.col[i] = c; this.flags[i] = flags; this.floor[i] = floor;
  }

  tracer(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, max: number) {
    if (this.tn >= MAX_T) return;
    const i = this.tn++;
    this.tx0[i] = x0; this.ty0[i] = y0; this.tz0[i] = z0; this.tx1[i] = x1; this.ty1[i] = y1; this.tz1[i] = z1; this.tlife[i] = 0; this.tmax[i] = max;
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
  }

  private removeP(i: number) {
    const l = --this.n; if (i === l) return;
    this.x[i] = this.x[l]; this.y[i] = this.y[l]; this.z[i] = this.z[l]; this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l]; this.vz[i] = this.vz[l];
    this.grav[i] = this.grav[l]; this.life[i] = this.life[l]; this.max[i] = this.max[l]; this.s0[i] = this.s0[l]; this.s1[i] = this.s1[l];
    this.col[i] = this.col[l]; this.flags[i] = this.flags[l]; this.floor[i] = this.floor[l];
  }
  private removeT(i: number) {
    const l = --this.tn; if (i === l) return;
    this.tx0[i] = this.tx0[l]; this.ty0[i] = this.ty0[l]; this.tz0[i] = this.tz0[l]; this.tx1[i] = this.tx1[l]; this.ty1[i] = this.ty1[l]; this.tz1[i] = this.tz1[l];
    this.tlife[i] = this.tlife[l]; this.tmax[i] = this.tmax[l];
  }

  /** Push every live particle into the pools. Particles flagged F_MAP are map-scale smoke columns and are hidden when the camera is close. */
  draw(lit: Pool, glow: Pool, near: boolean) {
    for (let i = 0; i < this.n; i++) {
      const f = this.flags[i];
      if ((f & F_MAP) && near) continue;
      const s = lerp(this.s0[i], this.s1[i], this.life[i] / this.max[i]);
      ((f & F_GLOW) ? glow : lit).push(this.x[i], this.y[i], this.z[i], s, s, s, this.life[i] * 2, this.col[i]);
    }
  }

  drawTracers(lines: LineBatch) {
    for (let i = 0; i < this.tn; i++) lines.add(this.tx0[i], this.ty0[i], this.tz0[i], this.tx1[i], this.ty1[i], this.tz1[i], K.tracer);
  }
}
