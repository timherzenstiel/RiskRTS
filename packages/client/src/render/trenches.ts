// Dug-in trenches as real geometry (the mockup look): along every held border a fire trench (and a support line for trench II+)
// follows the smooth border field (borderField.ts) at a fixed depth inside the region, crenellated into fire bays. Each line is a
// ribbon mesh with a sandbag parapet towards the enemy, a lower parados behind, revetted walls and a duckboard floor below ground;
// the close-up ground shader cuts the same strip out (TRENCH_GLSL), so the cut and the mesh line up.
import * as THREE from 'three';
import { HH, HW, TS, type GameState } from '@riskrts/shared';
import { BF_SS, type BorderField } from './borderField';
import type { Terrain } from './terrain';
import { col } from './util';
import { uGOn, uGTex } from './groundTex';

/** Distance of each line from the border (tiles), and the half width of the cut (tiles) for trench level lv. */
export const TR_D = [.42, 1.12];
export const trHalf = (line: number, lv: number) => line === 0 ? .075 + .013 * lv : .06;
const AMP = [.06, .035];
/** Fire-bay offset (tiles) at world (x,z): a squared zig-zag; the same formula runs in the ground shader. */
const tri = (v: number) => Math.abs(v - Math.floor(v) - .5);
export function zig(x: number, z: number, line: number) {
  const zx = (tri(x * 3.1 + .17) + tri(z * 3.1 + .61)) * 4 - 2;
  return Math.max(-1, Math.min(1, zx * 2.2)) * AMP[line];
}
export const TRENCH_GLSL = /* glsl */ `
float trZig(vec2 p, int L){ float zx=(abs(fract(p.x*3.1+.17)-.5)+abs(fract(p.y*3.1+.61)-.5))*4.-2.; return clamp(zx*2.2,-1.,1.)*(L==0?${AMP[0]}:${AMP[1]}); }
float trHalf(int L, float lv){ return L==0?.075+.013*lv:.06; }
`;

const C = { bag: col('#9c8b66'), bag2: col('#7d6e50'), earth: col('#5a4632'), wall: col('#3e3022'), floor: col('#4d3a27'), grass: col('#55603a') };

type Seg = [number, number, number, number];

export class Trenches {
  private readonly group = new THREE.Group();
  private readonly mat = trenchMaterial();
  private readonly meshes = new Map<string, THREE.Mesh>();
  /** Candidate cells per (region pair, line): indices of field cells whose corners all lie on that pair's side near the line. */
  private readonly cells = new Map<string, Int32Array>();
  private key = '';

  constructor(scene: THREE.Scene, private readonly terrain: Terrain) {
    scene.add(this.group); this.group.visible = false;
    const B = terrain.border, { W, H, dist, own, nb } = B, near: Map<string, number[]> = new Map();
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
      const i = y * W + x, o = own[i], n = nb[i]; if (!o || !n) continue;
      const d = dist[i]; let line = -1;
      for (let L = 0; L < 2; L++) if (Math.abs(d - TR_D[L]) < .45) line = L;
      if (line < 0) continue;
      if (own[i + 1] !== o || own[i + W] !== o || own[i + W + 1] !== o || nb[i + 1] !== n || nb[i + W] !== n || nb[i + W + 1] !== n) continue;
      for (let L = 0; L < 2; L++) if (Math.abs(d - TR_D[L]) < .45) { const k = `${o - 1}|${n - 1}|${L}`; let a = near.get(k); if (!a) near.set(k, a = []); a.push(i); }
    }
    for (const [k, a] of near) this.cells.set(k, Int32Array.from(a));
  }

  setVisible(on: boolean) { this.group.visible = on; }

  /** Rebuild the trench lines whose level changed. */
  update(g: GameState | null) {
    if (!g) return;
    const B = this.terrain.border, NR = B.regions, T = B.table, want = new Map<string, number>();
    for (let r = 0; r < NR; r++) for (let n = 0; n < NR; n++) {
      const lv = Math.round(T[(r * NR + n) * 4] / 80); if (!lv) continue;
      for (let L = 0; L < (lv >= 2 ? 2 : 1); L++) want.set(`${r}|${n}|${L}`, lv);
    }
    const key = [...want].map(([k, v]) => k + '=' + v).join(',');
    if (key === this.key) return; this.key = key;
    for (const [k, m] of this.meshes) if (!want.has(k) || m.userData.lv !== want.get(k)) { m.removeFromParent(); m.geometry.dispose(); this.meshes.delete(k); }
    for (const [k, lv] of want) if (!this.meshes.has(k)) { const m = this.build(k, lv); if (m) { m.userData.lv = lv; this.meshes.set(k, m); this.group.add(m); } }
  }

  private build(k: string, lv: number): THREE.Mesh | null {
    const cells = this.cells.get(k); if (!cells) return null;
    const L = +k.split('|')[2], D0 = TR_D[L], B = this.terrain.border, { W, dist } = B, S = BF_SS;
    // marching squares on dist - D0
    const segs: Seg[] = [];
    const P = (i: number, j: number) => { const fi = dist[i] - D0, fj = dist[j] - D0, t = fi / (fi - fj), xi = i % W, yi = (i / W) | 0, xj = j % W, yj = (j / W) | 0; return [xi + (xj - xi) * t, yi + (yj - yi) * t]; };
    for (const i of cells) {
      const a = i, b = i + 1, c = i + W + 1, d = i + W;
      const s = (dist[a] > D0 ? 1 : 0) | (dist[b] > D0 ? 2 : 0) | (dist[c] > D0 ? 4 : 0) | (dist[d] > D0 ? 8 : 0);
      if (s === 0 || s === 15) continue;
      const e: number[][] = [];
      if ((s & 1) !== ((s >> 1) & 1)) e.push(P(a, b));
      if (((s >> 1) & 1) !== ((s >> 2) & 1)) e.push(P(b, c));
      if (((s >> 2) & 1) !== ((s >> 3) & 1)) e.push(P(c, d));
      if (((s >> 3) & 1) !== (s & 1)) e.push(P(d, a));
      if (e.length >= 2) segs.push([e[0][0], e[0][1], e[1][0], e[1][1]]);
      if (e.length === 4) segs.push([e[2][0], e[2][1], e[3][0], e[3][1]]);
    }
    const lines = chain(segs);
    if (!lines.length) return null;
    // texel -> world
    const wx = (x: number) => (x + .5) / S * TS - HW, wz = (y: number) => (y + .5) / S * TS - HH;
    const distAt = (x: number, z: number) => { // bilinear field distance at world (x,z), in tiles
      const fx = (x + HW) / TS * S - .5, fy = (z + HH) / TS * S - .5, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, i = iy * W + ix;
      return (dist[i] * (1 - tx) + dist[i + 1] * tx) * (1 - ty) + (dist[i + W] * (1 - tx) + dist[i + W + 1] * tx) * ty;
    };
    const hw = trHalf(L, lv) * TS, pw = .075 * TS, dep = (L === 0 ? .03 + .004 * lv : .024), ter = this.terrain;
    // cross-section: offset across (towards the interior = +), height above ground, colour, texture layer of the band to the next point
    // (0 grass, 1 dirt, 2 mud, 6 sandbags, 7 planks; groundTex.ts)
    const prof: [number, number, THREE.Color, number][] = [
      [-(hw + pw), 0, C.grass, 6], [-(hw + pw * .5), .011 + .002 * lv, C.bag, 6], [-hw * 1.02, .006, C.bag2, 7], [-hw * .82, -dep, C.wall, 2], [-hw * .55, -dep, C.floor, 7],
      [hw * .55, -dep, C.floor, 2], [hw * .82, -dep, C.wall, 7], [hw * 1.02, .004, C.earth, 1], [hw + pw * .5, .007, C.earth, 1], [hw + pw, 0, C.grass, 0],
    ];
    const pos: number[] = [], colr: number[] = [], uvs: number[] = [], lay: number[] = [], idx: number[] = [];
    for (const ln of lines) {
      // resample the centre line evenly, push each point out by the fire-bay offset
      const pts = resample(ln.map(([x, y]) => [wx(x), wz(y)] as [number, number]), .008);
      if (pts.length < 2) continue;
      const ring: [number, number, number][][] = [];
      let arc = 0;
      for (let q = 0; q < pts.length; q++) {
        const [x, z] = pts[q], [xa, za] = pts[Math.max(0, q - 1)], [xb, zb] = pts[Math.min(pts.length - 1, q + 1)];
        let tx = xb - xa, tz = zb - za; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        let nx = -tz, nz = tx; if (distAt(x + nx * .02, z + nz * .02) < distAt(x - nx * .02, z - nz * .02)) { nx = -nx; nz = -nz; }
        let o = 0; for (let it = 0; it < 3; it++) o = zig(x + nx * o, z + nz * o, L) * TS;
        const cx = x + nx * o, cz = z + nz * o;
        ring.push(prof.map(([off]) => { const px = cx + nx * off, pz = cz + nz * off; return [px, 0, pz]; }));
        for (let j = 0; j < prof.length; j++) { const r = ring[q][j]; r[1] = ter.surfaceAt(r[0], r[2]) + prof[j][1] + .002; }
      }
      // each band gets its own vertices so its texture layer does not blend into the next
      for (let j = 0; j < prof.length - 1; j++) {
        const base = pos.length / 3, [o0, , c0, ly] = prof[j], [o1, , c1] = prof[j + 1];
        arc = 0;
        for (let q = 0; q < ring.length; q++) {
          if (q) { const a0 = ring[q - 1][j], a1 = ring[q][j]; arc += Math.hypot(a1[0] - a0[0], a1[2] - a0[2]); }
          const sh = .9 + .2 * hashf(Math.floor(q / 3) * 7 + j);
          for (const [r, off, c] of [[ring[q][j], o0, c0], [ring[q][j + 1], o1, c1]] as [[number, number, number], number, THREE.Color][]) {
            pos.push(r[0], r[1], r[2]); colr.push(c.r * sh, c.g * sh, c.b * sh);
            uvs.push(arc * 9, (off + r[1] * 1.5) * 9); lay.push(ly);
          }
        }
        for (let q = 0; q < ring.length - 1; q++) { const a = base + q * 2, b2 = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b2, b2, c, d); }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    geo.setAttribute('tuv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setAttribute('lay', new THREE.Float32BufferAttribute(lay, 1));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.mat); m.receiveShadow = true; m.castShadow = true; m.frustumCulled = true;
    geo.computeBoundingSphere();
    return m;
  }

  dispose() { for (const m of this.meshes.values()) m.geometry.dispose(); this.mat.dispose(); this.group.removeFromParent(); }
}

/** Lambert with vertex colours, replaced by the painted texture layer of each band once the textures have loaded. */
function trenchMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uGTex, uGOn });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float lay; attribute vec2 tuv; varying float vLay; varying vec2 vTUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLay=lay; vTUv=tuv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform highp sampler2DArray uGTex; uniform float uGOn; varying float vLay; varying vec2 vTUv;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  { vec3 t=texture(uGTex,vec3(vTUv,floor(vLay+.5))).rgb; diffuseColor.rgb=mix(diffuseColor.rgb,t,uGOn); }');
  };
  return m;
}

function hashf(n: number) { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); }

/** Join marching-squares segments into polylines by matching endpoints. */
function chain(segs: Seg[]): [number, number][][] {
  const key = (x: number, y: number) => Math.round(x * 64) + ',' + Math.round(y * 64);
  const at = new Map<string, number[]>();
  segs.forEach((s, i) => { for (const e of [0, 1]) { const k = key(s[e * 2], s[e * 2 + 1]); let a = at.get(k); if (!a) at.set(k, a = []); a.push(i); } });
  const used = new Uint8Array(segs.length), out: [number, number][][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue; used[i] = 1;
    const line: [number, number][] = [[segs[i][0], segs[i][1]], [segs[i][2], segs[i][3]]];
    for (const dir of [1, 0]) {
      for (;;) {
        const end = dir ? line[line.length - 1] : line[0];
        const nx = (at.get(key(end[0], end[1])) ?? []).find(j => !used[j]); if (nx === undefined) break;
        used[nx] = 1; const s = segs[nx];
        const far: [number, number] = key(s[0], s[1]) === key(end[0], end[1]) ? [s[2], s[3]] : [s[0], s[1]];
        if (dir) line.push(far); else line.unshift(far);
      }
    }
    if (line.length > 3) out.push(line);
  }
  return out;
}

/** Points along a polyline every `step` world units (light smoothing first, so the texel grid does not show). */
function resample(pts: [number, number][], step: number): [number, number][] {
  for (let it = 0; it < 2; it++) {
    const s: [number, number][] = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) s.push([(pts[i - 1][0] + pts[i][0] * 2 + pts[i + 1][0]) / 4, (pts[i - 1][1] + pts[i][1] * 2 + pts[i + 1][1]) / 4]);
    s.push(pts[pts.length - 1]); pts = s;
  }
  const out: [number, number][] = [pts[0]]; let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1], [x1, z1] = pts[i], l = Math.hypot(x1 - x0, z1 - z0); let t = step - carry;
    while (t <= l) { out.push([x0 + (x1 - x0) * t / l, z0 + (z1 - z0) * t / l]); t += step; }
    carry = l - (t - step);
  }
  return out;
}
