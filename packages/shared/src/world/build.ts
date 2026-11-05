// Builds the tile world: land and the 54 regions come from the real-border table (Natural Earth outlines grouped into
// 1914 regions by tools/borders/build.py); rivers are rasterised on top. Deterministic and DOM-free, so server and
// client build the identical world.
import { RIVERS } from './geometry';
import { SEEDS, SEA, type ContKey } from '../data/regions';
import { REGION_TILES, REGION_TILES_COLS, REGION_TILES_ROWS } from '../data/regionTiles';

export const RES = .5;                    // degrees per tile
export const COLS = 720, ROWS = 282, LAT_TOP = 84, N = COLS * ROWS;
export const TS = 1 / 3;                  // world units per tile
export const HW = COLS * TS / 2, HH = ROWS * TS / 2;

export const lonOf = (c: number) => -180 + (c + .5) * RES;
export const latOf = (r: number) => LAT_TOP - (r + .5) * RES;
export const tileAtLL = (lon: number, lat: number) => { const c = Math.floor((lon + 180) / RES), r = Math.floor((LAT_TOP - lat) / RES); return (c < 0 || c >= COLS || r < 0 || r >= ROWS) ? -1 : r * COLS + c; };
export const tileAtW = (x: number, z: number) => { const c = Math.floor((x + HW) / TS), r = Math.floor((z + HH) / TS); return (c < 0 || c >= COLS || r < 0 || r >= ROWS) ? -1 : r * COLS + c; };
export const tx = (c: number) => (c + .5) * TS - HW;
export const tz = (r: number) => (r + .5) * TS - HH;
export const wxLon = (lon: number) => (lon + 180) / RES * TS - HW;
export const wzLat = (lat: number) => (LAT_TOP - lat) / RES * TS - HH;

export interface RegionDef {
  id: number; name: string; cont: ContKey; lon: number; lat: number;
  tiles: number[]; adj: number[]; seaAdj: number[];
  anchor: number; cx: number; cz: number;
}
export interface World {
  land: Uint8Array; river: Uint8Array; terrOf: Int16Array; borderNb: Int16Array;
  regions: RegionDef[]; byName: Record<string, RegionDef>;
  /** "a|b" keys of region pairs connected by a sea lane. */
  seaLane: Set<string>;
}

const nb4 = (i: number, out: number[]) => { const c = i % COLS; out[0] = c > 0 ? i - 1 : -1; out[1] = c < COLS - 1 ? i + 1 : -1; out[2] = i >= COLS ? i - COLS : -1; out[3] = i + COLS < N ? i + COLS : -1; return out; };

/** Unpacks the generated table: (value, run) varint pairs over all tiles, value 0 = sea, else region id + 1. */
function decodeRegionTiles(land: Uint8Array, terrOf: Int16Array) {
  if (REGION_TILES_COLS !== COLS || REGION_TILES_ROWS !== ROWS) throw new Error('regionTiles.ts was built for another grid');
  const bin = atob(REGION_TILES);
  let p = 0, i = 0;
  const next = () => { let x = 0, sh = 0, c: number; do { c = bin.charCodeAt(p++); x |= (c & 127) << sh; sh += 7; } while (c & 128); return x; };
  while (p < bin.length && i < N) {
    const v = next(), run = next();
    for (let k = 0; k < run; k++, i++) if (v) { land[i] = 1; terrOf[i] = v - 1; }
  }
  if (i !== N) throw new Error('regionTiles.ts is truncated');
}

let cache: World | null = null;
export function buildWorld(): World {
  if (cache) return cache;
  const land = new Uint8Array(N), river = new Uint8Array(N), terrOf = new Int16Array(N).fill(-1);
  decodeRegionTiles(land, terrOf);
  for (const R of RIVERS) for (let k = 0; k < R.length - 2; k += 2) {
    const x0 = R[k], y0 = R[k + 1], x1 = R[k + 2], y1 = R[k + 3], n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / .1);
    for (let s = 0; s <= n; s++) { const i = tileAtLL(x0 + (x1 - x0) * s / n, y0 + (y1 - y0) * s / n); if (i >= 0 && land[i]) river[i] = 1; }
  }

  const regions: RegionDef[] = SEEDS.map(([name, cont, lon, lat], id) => ({ id, name, cont, lon, lat, tiles: [], adj: [], seaAdj: [], anchor: 0, cx: 0, cz: 0 }));
  const byName: Record<string, RegionDef> = {}; regions.forEach(t => byName[t.name] = t);
  const NB = [0, 0, 0, 0];
  for (let i = 0; i < N; i++) if (land[i]) regions[terrOf[i]].tiles.push(i);
  const adj = regions.map(() => new Set<number>());
  for (let i = 0; i < N; i++) {
    if (!land[i]) continue; const c = i % COLS;
    for (const j of [c < COLS - 1 ? i + 1 : -1, i + COLS < N ? i + COLS : -1]) if (j >= 0 && land[j] && terrOf[j] !== terrOf[i]) { adj[terrOf[i]].add(terrOf[j]); adj[terrOf[j]].add(terrOf[i]); }
  }
  const seaLane = new Set<string>();
  for (const [a, b] of SEA) { const A = byName[a], B = byName[b]; adj[A.id].add(B.id); adj[B.id].add(A.id); seaLane.add(A.id + '|' + B.id); seaLane.add(B.id + '|' + A.id); A.seaAdj.push(B.id); B.seaAdj.push(A.id); }
  for (const t of regions) {
    t.adj = [...adj[t.id]].sort((a, b) => a - b);
    let mx = 0, mz = 0; for (const i of t.tiles) { mx += i % COLS; mz += (i / COLS) | 0; } mx /= t.tiles.length; mz /= t.tiles.length;
    let best = t.tiles[0], bd = 1e9;
    for (const i of t.tiles) {
      const c = i % COLS, r = (i / COLS) | 0; let inner = 0;
      for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) { const j = i + dr * COLS + dc; if (j >= 0 && j < N && land[j] && terrOf[j] === t.id) inner++; }
      const d = (c - mx) ** 2 + (r - mz) ** 2 + (49 - inner) * 9 + (river[i] ? 90 : 0); if (d < bd) { bd = d; best = i; }
    }
    t.anchor = best; t.cx = tx(best % COLS); t.cz = tz((best / COLS) | 0);
  }
  const borderNb = new Int16Array(N).fill(-1);
  for (let i = 0; i < N; i++) { if (!land[i]) continue; nb4(i, NB); for (const j of NB) if (j >= 0 && land[j] && terrOf[j] !== terrOf[i]) { borderNb[i] = terrOf[j]; break; } }
  cache = { land, river, terrOf, borderNb, regions, byName, seaLane };
  return cache;
}

/** Shortest world-space x difference across the date line. */
export function wrapDx(ax: number, bx: number) { let dx = bx - ax; if (dx > HW) dx -= 2 * HW; if (dx < -HW) dx += 2 * HW; return dx; }
