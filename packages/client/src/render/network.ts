// Strategic overlays drawn into the shared line batch: the rail network (own lines bright, cut lines red, lines under
// construction dashed) and mountain borders (a small range of peaks across the border). Plus weather particles close up.
import * as THREE from 'three';
import { MOUNTAINS, allRails, railKey, tileAtW, weatherAt, wrapDx, type GameState, type RouteLeg, type World } from '@riskrts/shared';
import type { LineBatch } from './pools';
import type { Terrain } from './terrain';
import type { CameraRig } from './camera';
import { F_DUST, F_THIN, type FxSystem } from './fxSystem';
import { col } from './util';

/** Supply mode: the route that supplies the region under the cursor (or, when it is cut off, the line to where it broke). */
export interface SupplyPath { from: number; legs: RouteLeg[] | null; brk: number }

const C = { routeRail: col('#ffffff'), routeRoad: col('#ffcc40'), routeSea: col('#7cd0ff'), routeCut: col('#ff5a44'), mine: col('#e9dcb4'), other: col('#7a6e58'), cut: col('#e0503c'), build: col('#e6b85c'), peak: col('#d6cdb6'), snow: col('#f2f4f6'), rain: col('#9fb0c0'), dust: col('#c2a46e') };

export class NetworkLayer {
  private readonly mtn: [number, number][];
  constructor(private readonly world: World, private readonly terrain: Terrain) {
    this.mtn = MOUNTAINS.map(([a, b]) => [world.byName[a].id, world.byName[b].id]);
  }

  /** Draw rails and mountain borders (strategic zoom only), and in Supply mode the route of one region. */
  draw(lines: LineBatch, g: GameState, me: number, rig: CameraRig, route: SupplyPath | null = null) {
    if (rig.dist < 9 || rig.dist > 140) return;
    const W = this.world, y = (id: number) => this.terrain.anchorH(id) + .12;
    if (route) this.drawRoute(lines, route, rig, y);
    const seg = (a: number, b: number, c: THREE.Color, dash: boolean) => {
      const A = W.regions[a], B = W.regions[b], dx = wrapDx(A.cx, B.cx), dz = B.cz - A.cz, ya = y(a), yb = y(b);
      const n = dash ? 14 : 1;
      for (let k = 0; k < n; k++) {
        if (dash && k % 2) continue;
        const t0 = k / n, t1 = (k + 1) / n;
        lines.add(A.cx + dx * t0, ya + (yb - ya) * t0, A.cz + dz * t0, A.cx + dx * t1, ya + (yb - ya) * t1, A.cz + dz * t1, c);
      }
    };
    for (const [a, b] of allRails(g)) {
      const cut = (g.railCut?.[railKey(a, b)] ?? -1) > g.day, mine = g.regions[a].owner === me && g.regions[b].owner === me;
      seg(a, b, cut ? C.cut : mine ? C.mine : C.other, cut);
    }
    for (const [a, b, ready] of g.railNew ?? []) if (ready > g.day) seg(a, b, C.build, true);
    // mountain borders: a little range of peaks at the middle of the border, across the line between the two regions
    if (rig.dist > 70) return;
    for (const [a, b] of this.mtn) {
      const A = W.regions[a], B = W.regions[b], dx = wrapDx(A.cx, B.cx), dz = B.cz - A.cz, l = Math.hypot(dx, dz) || 1;
      const mx = A.cx + dx / 2, mz = A.cz + dz / 2, px = -dz / l, pz = dx / l, my = Math.max(y(a), y(b)) + .05, s = .35;
      for (let k = -1; k <= 1; k++) {
        const cx = mx + px * k * s * 1.2, cz = mz + pz * k * s * 1.2, h = k === 0 ? s * .9 : s * .6;
        lines.add(cx - px * s * .55, my, cz - pz * s * .55, cx, my + h, cz, C.peak);
        lines.add(cx, my + h, cz, cx + px * s * .55, my, cz + pz * s * .55, C.peak);
      }
    }
  }

  /** A supply route as a broad line (several strands side by side), rail white, road amber, sea blue (dashed); a cut-off region
   *  gets a red dashed line to where its route broke and a cross there. The source end gets a small diamond. */
  private drawRoute(lines: LineBatch, p: SupplyPath, rig: CameraRig, y: (id: number) => number) {
    const W = this.world, w = Math.max(.07, rig.dist * .0042), lift = .1 + rig.dist * .002;
    const strand = (a: number, b: number, c: THREE.Color, dash: boolean) => {
      const A = W.regions[a], B = W.regions[b], dx = wrapDx(A.cx, B.cx), dz = B.cz - A.cz, l = Math.hypot(dx, dz) || 1, px = -dz / l, pz = dx / l;
      const ya = y(a) + lift, yb = y(b) + lift, n = dash ? Math.max(6, Math.round(l / .6)) : 1;
      for (const o of [-1, -.5, 0, .5, 1]) for (let k = 0; k < n; k++) {
        if (dash && k % 2) continue;
        const t0 = k / n, t1 = (k + 1) / n, ox = px * o * w, oz = pz * o * w;
        lines.add(A.cx + dx * t0 + ox, ya + (yb - ya) * t0, A.cz + dz * t0 + oz, A.cx + dx * t1 + ox, ya + (yb - ya) * t1, A.cz + dz * t1 + oz, c);
      }
    };
    const mark = (id: number, c: THREE.Color, cross: boolean) => {
      const R = W.regions[id], s = w * 6, h = y(id) + lift;
      if (cross) { lines.add(R.cx - s, h, R.cz - s, R.cx + s, h, R.cz + s, c); lines.add(R.cx - s, h, R.cz + s, R.cx + s, h, R.cz - s, c); return; }
      const pts: [number, number][] = [[s, 0], [0, s], [-s, 0], [0, -s]];
      for (let k = 0; k < 4; k++) { const [x0, z0] = pts[k], [x1, z1] = pts[(k + 1) % 4]; lines.add(R.cx + x0, h, R.cz + z0, R.cx + x1, h, R.cz + z1, c); }
    };
    if (!p.legs) { if (p.brk >= 0) { strand(p.from, p.brk, C.routeCut, true); mark(p.brk, C.routeCut, true); } return; }
    for (const l of p.legs) strand(l.a, l.b, l.sea ? C.routeSea : l.q >= 2 ? C.routeRail : C.routeRoad, l.sea);
    if (p.legs.length) mark(p.legs[p.legs.length - 1].b, C.routeRail, false); else mark(p.from, C.routeRail, false);
  }

  /** Rain, snow or dust drifting over the ground near the camera when zoomed in, from the weather of the region in view. */
  weather(fx: FxSystem, g: GameState, rig: CameraRig, dt: number) {
    if (rig.dist > 18) return;
    const i = tileAtW(rig.tx, rig.tz); if (i < 0 || !this.world.land[i]) return;
    const w = weatherAt(this.world.terrOf[i], g.day); if (!w) return;
    const R = rig.dist * .7, n = Math.min(30, Math.ceil(dt * (w === 3 ? 25 : 160))), base = this.terrain.anchorH(this.world.terrOf[i]);
    for (let k = 0; k < n; k++) {
      const x = rig.tx + (Math.random() - .5) * 2 * R, z = rig.tz + (Math.random() - .5) * 2 * R, top = base + rig.dist * .45;
      if (w === 1) fx.spawn(x, top, z, .4, -9, .2, 0, .5, .02, .02, C.rain, F_THIN, base);
      else if (w === 2) fx.spawn(x, top, z, (Math.random() - .5) * .6, -1.1, (Math.random() - .5) * .6, 0, 3.5, .035, .03, C.snow, F_THIN, base);
      else fx.spawn(x, base + .1, z, 1.2, .25, .4, 0, 2.5, .05, .12, C.dust, F_DUST, base);
    }
  }
}
