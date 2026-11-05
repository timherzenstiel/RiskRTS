// Smooth region borders for the close-up ground (the mockup look): region labels at 4x the tile resolution, voted with a gaussian
// over the surrounding tiles so 90-degree tile corners round off into curves, then for every texel the distance to the nearest
// border with another region and which region lies across it. The ground shader draws border lines, trenches, wire and
// no-man's-land from these instead of from tile edges, and a tiny per-region table gives owners, trench levels and shell damage.
import * as THREE from 'three';
import { COLS, ROWS, type World } from '@riskrts/shared';

export const BF_SS = 4;
/** Distance encoding: value = tiles * BF_SCALE, so 255 is ~2 tiles. */
export const BF_SCALE = 120;

export interface BorderField {
  /** R: distance to the nearest region border in tiles (x BF_SCALE), linear filtered. */
  readonly distTex: THREE.DataTexture;
  /** R: own region + 1, G: region across the nearest border + 1 (0 = none), nearest filtered. */
  readonly idTex: THREE.DataTexture;
  /** Per-region table, width = regions, height = regions + 1: row r col n = (trench level x80, damage 0-255) of r's border with n;
   *  the last row holds each region's owner + 1. */
  readonly tableTex: THREE.DataTexture;
  readonly table: Uint8Array;
  readonly regions: number;
  /** CPU copies for prop placement: distance in tiles, own and across region (+1). */
  readonly dist: Float32Array; readonly own: Uint8Array; readonly nb: Uint8Array;
  readonly W: number; readonly H: number;
}

export const BORDER_GLSL = (nReg: number) => /* glsl */ `
uniform sampler2D uBDist, uBId, uBTab;
float bDist(vec2 t){ return texture2D(uBDist,t).r*255./${BF_SCALE.toFixed(1)}; }
vec2 bIds(vec2 t){ vec2 v=texture2D(uBId,t).rg*255.+.5; return floor(v)-1.; }
vec4 bTab(float r, float n){ return texture2D(uBTab,(vec2(n,r)+.5)/vec2(${nReg}.,${nReg + 1}.)); }
float bOwner(float r){ return floor(bTab(${nReg}.,r).r*255.+.5)-1.; }
`;

export function borderField(world: World): BorderField {
  const S = BF_SS, W = COLS * S, H = ROWS * S, n = W * H, nReg = world.regions.length;
  const { land, terrOf } = world;
  const reg = (c: number, r: number) => { if (r < 0 || r >= ROWS) return -1; const i = r * COLS + ((c + COLS) % COLS); return land[i] ? terrOf[i] : -1; };
  const own = new Uint8Array(n);
  const SIG2 = 2 * .62 * .62, wsum = new Float32Array(nReg);
  const seen: number[] = [];
  for (let y = 0; y < H; y++) {
    const fy = (y + .5) / S, r0 = Math.floor(fy);
    for (let x = 0; x < W; x++) {
      const fx = (x + .5) / S, c0 = Math.floor(fx);
      // fast path: the 3x3 tiles around agree
      const a = reg(c0, r0);
      let same = true;
      for (let dr = -1; dr <= 1 && same; dr++) for (let dc = -1; dc <= 1; dc++) { const b = reg(c0 + dc, r0 + dr); if (b !== a && b >= 0) { same = false; break; } }
      if (same && a >= 0) { own[y * W + x] = a + 1; continue; }
      let best = -1, bw = 0;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const b = reg(c0 + dc, r0 + dr); if (b < 0) continue;
        const dx = c0 + dc + .5 - fx, dy = r0 + dr + .5 - fy, w = Math.exp(-(dx * dx + dy * dy) / SIG2);
        if (!wsum[b]) seen.push(b);
        wsum[b] += w;
      }
      for (const b of seen) { if (wsum[b] > bw) { bw = wsum[b]; best = b; } wsum[b] = 0; }
      seen.length = 0;
      own[y * W + x] = best + 1;
    }
  }
  // nearest border seed per texel (two-pass propagation of the nearest seed, euclidean to the seed)
  const seed = new Int32Array(n).fill(-1), seedNb = new Uint8Array(n), D = new Float32Array(n).fill(1e9);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = own[i]; if (!o) continue;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
      if (j >= 0 && own[j] && own[j] !== o) { seed[i] = i; seedNb[i] = own[j]; D[i] = 0; break; }
    }
  }
  const relax = (i: number, j: number, x: number, y: number) => {
    const s = seed[j]; if (s < 0) return;
    const dx = x - s % W, dy = y - ((s / W) | 0), d = dx * dx + dy * dy;
    if (d < D[i]) { D[i] = d; seed[i] = s; }
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (x > 0) relax(i, i - 1, x, y);
    if (y > 0) { relax(i, i - W, x, y); if (x > 0) relax(i, i - W - 1, x, y); if (x < W - 1) relax(i, i - W + 1, x, y); }
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    if (x < W - 1) relax(i, i + 1, x, y);
    if (y < H - 1) { relax(i, i + W, x, y); if (x < W - 1) relax(i, i + W + 1, x, y); if (x > 0) relax(i, i + W - 1, x, y); }
  }
  const dist = new Float32Array(n), nb = new Uint8Array(n), dData = new Uint8Array(n), idData = new Uint8Array(n * 2);
  for (let i = 0; i < n; i++) {
    const s = seed[i], dt = s < 0 ? 9 : (Math.sqrt(D[i]) + .5) / S;
    dist[i] = dt; nb[i] = s < 0 ? 0 : seedNb[s];
    dData[i] = Math.min(255, Math.round(dt * BF_SCALE));
    idData[i * 2] = own[i]; idData[i * 2 + 1] = nb[i];
  }
  const distTex = new THREE.DataTexture(dData, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  distTex.magFilter = distTex.minFilter = THREE.LinearFilter; distTex.needsUpdate = true;
  const idTex = new THREE.DataTexture(idData, W, H, THREE.RGFormat, THREE.UnsignedByteType);
  idTex.magFilter = idTex.minFilter = THREE.NearestFilter; idTex.needsUpdate = true;
  const table = new Uint8Array(nReg * (nReg + 1) * 4);
  const tableTex = new THREE.DataTexture(table, nReg, nReg + 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tableTex.magFilter = tableTex.minFilter = THREE.NearestFilter; tableTex.needsUpdate = true;
  return { distTex, idTex, tableTex, table, regions: nReg, dist, own, nb, W, H };
}
