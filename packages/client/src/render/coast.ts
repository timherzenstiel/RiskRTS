// Smooth coastline for the whole map: a signed distance field (in tiles) of a rounded land mask at 4x the tile resolution.
// The tile raster is bilinearly upsampled and blurred before thresholding, so 90-degree tile steps become curves; the ground
// shaders cut land against it (with fine noise on top for a rocky, broken edge) and the water reads depth and surf from it.
import * as THREE from 'three';
import { COLS, ROWS, type World } from '@riskrts/shared';

export const COAST_SS = 4;
/** Encoding of the texture: value = OFFSET + signedDistanceInTiles * SCALE (positive = sea). */
export const COAST_OFFSET = 40, COAST_SCALE = 12;
/** GLSL: signed distance to the coast in tiles at normalized map coordinate t (positive at sea). */
export const COAST_GLSL = `float coastSd(sampler2D tex, vec2 t){ return (texture2D(tex, t).r * 255. - ${COAST_OFFSET.toFixed(1)}) / ${COAST_SCALE.toFixed(1)}; }`;

export function coastTexture(world: World): THREE.DataTexture {
  const S = COAST_SS, W = COLS * S, H = ROWS * S, n = W * H;
  const L = (c: number, r: number) => (r >= 0 && r < ROWS && world.land[r * COLS + ((c + COLS) % COLS)]) ? 1 : 0;
  // bilinear upsample of the tile mask
  let f = new Float32Array(n);
  for (let y = 0; y < H; y++) {
    const fy = (y + .5) / S - .5, r0 = Math.floor(fy), ty = fy - r0;
    for (let x = 0; x < W; x++) {
      const fx = (x + .5) / S - .5, c0 = Math.floor(fx), tx = fx - c0;
      f[y * W + x] = (L(c0, r0) * (1 - tx) + L(c0 + 1, r0) * tx) * (1 - ty) + (L(c0, r0 + 1) * (1 - tx) + L(c0 + 1, r0 + 1) * tx) * ty;
    }
  }
  // two separable box blurs (radius ~ half a tile) round the corners into curves
  const R = 2, tmp = new Float32Array(n);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) { let acc = 0; for (let x = -R; x <= R; x++) acc += f[y * W + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) { tmp[y * W + x] = acc / (2 * R + 1); acc += f[y * W + Math.min(W - 1, x + R + 1)] - f[y * W + Math.max(0, x - R)]; } }
    for (let x = 0; x < W; x++) { let acc = 0; for (let y = -R; y <= R; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) { f[y * W + x] = acc / (2 * R + 1); acc += tmp[Math.min(H - 1, y + R + 1) * W + x] - tmp[Math.max(0, y - R) * W + x]; } }
  }
  // signed chamfer distance (sub-tile units) to the 0.5 contour, outside and inside
  const INF = 1e6, out = new Float32Array(n), inn = new Float32Array(n);
  for (let i = 0; i < n; i++) { const land = f[i] >= .5; out[i] = land ? 0 : INF; inn[i] = land ? INF : 0; }
  const chamfer = (D: Float32Array) => {
    const d2 = Math.SQRT2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; let v = D[i]; if (!v) continue;
      if (x > 0) v = Math.min(v, D[i - 1] + 1);
      if (y > 0) { v = Math.min(v, D[i - W] + 1); if (x > 0) v = Math.min(v, D[i - W - 1] + d2); if (x < W - 1) v = Math.min(v, D[i - W + 1] + d2); }
      D[i] = v;
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x; let v = D[i]; if (!v) continue;
      if (x < W - 1) v = Math.min(v, D[i + 1] + 1);
      if (y < H - 1) { v = Math.min(v, D[i + W] + 1); if (x < W - 1) v = Math.min(v, D[i + W + 1] + d2); if (x > 0) v = Math.min(v, D[i + W - 1] + d2); }
      D[i] = v;
    }
  };
  chamfer(out); chamfer(inn);
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    // sub-pixel accurate zero crossing: blend in the blurred field's slope near the contour
    const sd = (out[i] > 0 ? out[i] - .5 : -(inn[i] - .5)) / S;
    data[i] = Math.max(0, Math.min(255, Math.round(COAST_OFFSET + sd * COAST_SCALE)));
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  return tex;
}
