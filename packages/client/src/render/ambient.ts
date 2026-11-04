// Decorative life: merchant ships on sea routes and drifting clouds. Seeded, so every client sees the same traffic at start.
import { HH, HW, ROUTES, Rng, wxLon, wzLat } from '@riskrts/shared';
import type { FxSystem } from './fxSystem';
import type { Models } from './models';
import type { Pool } from './pools';
import { K } from './palette';
import { lerp } from './util';

interface Route { p: [number, number][]; seg: number[]; L: number }
interface Ship { r: number; s: number; dir: 1 | -1; smoke: number }
interface Cloud { x: number; z: number; y: number; sp: number; bx: [number, number, number, number, number, number][] }

const out: [number, number, number] = [0, 0, 0];
function routePos(r: Route, s: number) {
  s = ((s % r.L) + r.L) % r.L;
  for (let i = 0; i < r.seg.length; i++) {
    if (s <= r.seg[i]) { const t = s / r.seg[i], a = r.p[i], b = r.p[i + 1]; out[0] = lerp(a[0], b[0], t); out[1] = lerp(a[1], b[1], t); out[2] = Math.atan2(b[0] - a[0], b[1] - a[1]); return out; }
    s -= r.seg[i];
  }
  const e = r.p[r.p.length - 1]; out[0] = e[0]; out[1] = e[1]; out[2] = 0; return out;
}

export class Ambient {
  private readonly routes: Route[];
  private readonly ships: Ship[] = [];
  private readonly clouds: Cloud[] = [];

  constructor() {
    const rng = new Rng(77);
    this.routes = ROUTES.map((R) => {
      const p: [number, number][] = []; for (let i = 0; i < R.length; i += 2) p.push([wxLon(R[i]), wzLat(R[i + 1])]);
      let L = 0; const seg: number[] = [];
      for (let i = 0; i < p.length - 1; i++) { const l = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]); seg.push(l); L += l; }
      return { p, seg, L };
    });
    this.routes.forEach((r, ri) => { for (let k = 0; k < 2; k++) this.ships.push({ r: ri, s: rng.next() * r.L, dir: k ? 1 : -1, smoke: rng.next() }); });
    for (let k = 0; k < 34; k++) {
      const n = 5 + Math.floor(rng.next() * 8), bx: Cloud['bx'] = [];
      for (let j = 0; j < n; j++) bx.push([(rng.next() - .5) * 3.2, rng.next() * .35, (rng.next() - .5) * 1.6, .8 + rng.next() * 1.4, .35 + rng.next() * .35, .6 + rng.next() * 1]);
      this.clouds.push({ x: (rng.next() - .5) * 2 * HW, z: (rng.next() - .5) * 1.7 * HH, y: 7 + rng.next() * 2.5, bx, sp: .4 + rng.next() * .4 });
    }
  }

  update(dt: number, fx: FxSystem) {
    for (const s of this.ships) {
      s.s += s.dir * dt * .7; s.smoke -= dt;
      if (s.smoke <= 0) {
        s.smoke = .35; const p = routePos(this.routes[s.r], s.s), fc = s.dir > 0 ? p[2] : p[2] + Math.PI;
        fx.spawn(p[0] - Math.sin(fc) * .03, .3, p[1] - Math.cos(fc) * .03, -Math.sin(fc) * .1, .12, -Math.cos(fc) * .1, 0, 1.8, .04, .12, K.smoke2);
      }
    }
    for (const c of this.clouds) { c.x += c.sp * dt; if (c.x > HW + 4) c.x = -HW - 4; }
  }

  drawShips(m: Models, t: number) {
    for (const s of this.ships) { const p = routePos(this.routes[s.r], s.s); m.ship(p[0], p[1], s.dir > 0 ? p[2] : p[2] + Math.PI, K.funnel, 1.6, t); }
  }

  drawClouds(pool: Pool) {
    for (const c of this.clouds) for (const [ox, oy, oz, sx, sy, sz] of c.bx) pool.push(c.x + ox, c.y + oy, c.z + oz, sx, sy, sz, 0, oy > .2 ? K.cloud : K.cloud2);
  }
}
