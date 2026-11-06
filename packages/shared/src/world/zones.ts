// Sea zones built from the tile map: every water tile goes to the zone whose seeds reach it first through the water (a
// geodesic Voronoi split, so zones follow the coasts), coastal regions belong to every zone their coast touches, and the
// zones are linked by hand-placed gates (straits and open-ocean boundaries). Ships plan routes over that small graph and
// sail along water paths found on the tiles. Deterministic and DOM-free, like the rest of the world build.
import { LINKS, ZONES } from '../data/sea';
import { COLS, HW, N, ROWS, TS, tileAtLL, tx, tz, wrapDx, type World } from './build';

/** Sector keys from COAST up are coasts: COAST + zone. Below are neighbouring region ids (land borders). */
export const COAST = 1000;
export const coastKey = (z: number) => COAST + z;
export const isCoast = (k: number) => k >= COAST;
export const zoneOfKey = (k: number) => k - COAST;

export interface CoastPt {
  /** Coastal land tile of the region facing the zone, and the water tile off it (the anchorage). */
  tile: number; water: number;
  x: number; z: number; wx: number; wz: number;
  /** Number of coast tiles the region has on this zone. */
  n: number;
}
export interface ZoneInfo {
  id: number; name: string; short: string; storm: boolean;
  /** Label and station point (a water tile near the first seed). */
  tile: number; x: number; z: number;
  /** Coastal regions of the zone. */
  coast: number[];
  tiles: number;
}
export interface ZoneLink { id: number; a: number; b: number; ta: number; tb: number; strait: number; name: string; from: number }

const nbW = (i: number, out: number[]) => {
  const c = i % COLS;
  out[0] = c > 0 ? i - 1 : i + COLS - 1; out[1] = c < COLS - 1 ? i + 1 : i - COLS + 1;
  out[2] = i >= COLS ? i - COLS : -1; out[3] = i + COLS < N ? i + COLS : -1;
  return out;
};
export const tilePos = (t: number) => ({ x: tx(t % COLS), z: tz((t / COLS) | 0) });

/** Nearest tile around (lon, lat) that passes `ok`, searching outwards up to `rmax` tiles. */
function snap(lon: number, lat: number, ok: (i: number) => boolean, rmax = 40): number {
  const i0 = tileAtLL(lon, lat); if (i0 < 0) return -1;
  if (ok(i0)) return i0;
  const c0 = i0 % COLS, r0 = (i0 / COLS) | 0;
  for (let r = 1; r <= rmax; r++) {
    let best = -1, bd = 1e9;
    for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) !== r) continue;
      const rr = r0 + dr; if (rr < 0 || rr >= ROWS) continue;
      const cc = ((c0 + dc) % COLS + COLS) % COLS, i = rr * COLS + cc;
      if (!ok(i)) continue; const d = dr * dr + dc * dc; if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** Builds the zones into the world (called once from buildWorld). */
export function buildZones(w: World) {
  const { land, terrOf } = w, zoneOf = new Int8Array(N).fill(-1), q = new Int32Array(N);
  let qh = 0, qt = 0;
  const water = (i: number) => i >= 0 && !land[i];
  const seedTiles: number[][] = ZONES.map(() => []);
  ZONES.forEach((Z, z) => { for (const [lon, lat] of Z.seeds) { const t = snap(lon, lat, i => water(i) && zoneOf[i] < 0, 12); if (t >= 0) { zoneOf[t] = z; q[qt++] = t; seedTiles[z].push(t); } } });
  const NB = [0, 0, 0, 0];
  while (qh < qt) { const i = q[qh++]; nbW(i, NB); for (const j of NB) if (j >= 0 && !land[j] && zoneOf[j] < 0) { zoneOf[j] = zoneOf[i]; q[qt++] = j; } }
  const count = new Int32Array(ZONES.length); for (let i = 0; i < N; i++) if (zoneOf[i] >= 0) count[zoneOf[i]]++;

  // coasts: land tiles next to the water of a zone
  const ct = w.regions.map(() => new Map<number, number[]>()), wt = w.regions.map(() => new Map<number, number[]>());
  for (let i = 0; i < N; i++) {
    if (!land[i]) continue; nbW(i, NB);
    for (const j of NB) {
      if (j < 0 || land[j] || zoneOf[j] < 0) continue;
      const r = terrOf[i], z = zoneOf[j];
      let l = ct[r].get(z); if (!l) { ct[r].set(z, l = []); wt[r].set(z, []); }
      if (l[l.length - 1] !== i) { l.push(i); wt[r].get(z)!.push(j); }
    }
  }
  const zones: ZoneInfo[] = ZONES.map((Z, z) => {
    const t = seedTiles[z][0] ?? 0, p = tilePos(t);
    return { id: z, name: Z.name, short: Z.short, storm: !!Z.storm, tile: t, x: p.x, z: p.z, coast: [], tiles: count[z] };
  });
  for (const r of w.regions) {
    r.zones = []; r.coast = {};
    for (const [z, tiles] of [...ct[r.id]].sort((a, b) => a[0] - b[0])) {
      if (tiles.length < 2) continue;
      // the coast tile nearest the middle of that coast
      const p0 = tilePos(tiles[0]); let mx = 0, mz = 0;
      for (const i of tiles) { const p = tilePos(i); mx += wrapDx(p0.x, p.x); mz += p.z; }
      mx = p0.x + mx / tiles.length; mz /= tiles.length;
      let k = 0, bd = 1e9; tiles.forEach((i, n) => { const p = tilePos(i), d = wrapDx(mx, p.x) ** 2 + (p.z - mz) ** 2; if (d < bd) { bd = d; k = n; } });
      const tile = tiles[k], wat = wt[r.id].get(z)![k], a = tilePos(tile), b = tilePos(wat);
      r.zones.push(z); r.coast[z] = { tile, water: wat, x: a.x, z: a.z, wx: b.x, wz: b.z, n: tiles.length };
      zones[z].coast.push(r.id);
    }
    r.land = r.adj.filter(n => !w.seaLane.has(r.id + '|' + n));
    r.sectors = [...r.land, ...r.zones.map(coastKey)];
  }
  const links: ZoneLink[] = LINKS.map((L, id) => ({
    id, a: L.a, b: L.b,
    ta: snap(L.gate[0], L.gate[1], i => zoneOf[i] === L.a, 60), tb: snap(L.gate[2], L.gate[3], i => zoneOf[i] === L.b, 60),
    strait: L.strait ? w.byName[L.strait].id : -1, name: L.name ?? '', from: L.from ?? -1e9,
  }));
  // every sea lane runs through one zone both ends touch (the one where their coasts are closest)
  const laneZone = new Map<string, number>();
  for (const r of w.regions) for (const n of r.seaAdj) {
    const B = w.regions[n]; let best = -1, bd = 1e9;
    for (const z of r.zones) if (B.coast[z]) { const a = r.coast[z], b = B.coast[z], d = wrapDx(a.x, b.x) ** 2 + (a.z - b.z) ** 2; if (d < bd) { bd = d; best = z; } }
    if (best < 0) for (const z of r.zones) { const a = r.coast[z], d = wrapDx(a.x, B.cx) ** 2 + (a.z - B.cz) ** 2; if (d < bd) { bd = d; best = z; } }
    laneZone.set(r.id + '|' + n, best);
  }
  w.zoneOf = zoneOf; w.zones = zones; w.links = links; w.laneZone = laneZone;
}

// ---------------------------------------------------------------- paths on the water

const pathCache = new Map<string, number[]>();

/** Can a straight line between two water tiles of zone `z` be sailed (every tile on the way is water of that zone)? */
function sight(w: World, z: number, a: number, b: number): boolean {
  const ca = a % COLS, ra = (a / COLS) | 0; let cb = b % COLS; const rb = (b / COLS) | 0;
  if (cb - ca > COLS / 2) cb -= COLS; else if (ca - cb > COLS / 2) cb += COLS;
  const n = Math.max(Math.abs(cb - ca), Math.abs(rb - ra)) * 2;
  for (let s = 1; s < n; s++) {
    const c = Math.round(ca + (cb - ca) * s / n), r = Math.round(ra + (rb - ra) * s / n), i = r * COLS + ((c % COLS) + COLS) % COLS;
    if (w.zoneOf[i] !== z) return false;
  }
  return true;
}

/** Water tiles from `a` to `b` inside zone `z` (A* with diagonal steps, then straightened). Falls back to the straight line. */
export function zonePath(w: World, z: number, a: number, b: number): number[] {
  if (a === b) return [a];
  const key = z + ':' + a + ':' + b; const hit = pathCache.get(key); if (hit) return hit;
  const ok = (i: number) => i >= 0 && w.zoneOf[i] === z;
  if (!ok(a) || !ok(b)) { const p = [a, b]; pathCache.set(key, p); return p; }
  const cb = b % COLS, rb = (b / COLS) | 0;
  const h = (i: number) => { let dc = Math.abs(i % COLS - cb); if (dc > COLS / 2) dc = COLS - dc; const dr = Math.abs(((i / COLS) | 0) - rb); return Math.max(dc, dr) + .414 * Math.min(dc, dr); };
  const gs = new Map<number, number>([[a, 0]]), prev = new Map<number, number>();
  // binary heap of [f, tile]
  const heap: [number, number][] = [[h(a), a]];
  const push = (e: [number, number]) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  let found = false, guard = 0;
  while (heap.length && guard++ < 400000) {
    const [, i] = pop(); if (i === b) { found = true; break; }
    const gi = gs.get(i)!, c = i % COLS, r = (i / COLS) | 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue; const rr = r + dr; if (rr < 0 || rr >= ROWS) continue;
      const cc = (c + dc + COLS) % COLS, j = rr * COLS + cc; if (!ok(j)) continue;
      if (dr && dc && (!ok(r * COLS + cc) || !ok(rr * COLS + c))) continue;
      const ng = gi + (dr && dc ? 1.414 : 1); if (ng >= (gs.get(j) ?? 1e9)) continue;
      gs.set(j, ng); prev.set(j, i); push([ng + h(j), j]);
    }
  }
  let tiles: number[];
  if (!found) tiles = [a, b];
  else { tiles = [b]; let p = b; while (p !== a) { p = prev.get(p)!; tiles.push(p); } tiles.reverse(); }
  // string pulling: keep only the turns the straight line cannot cut
  const out = [tiles[0]]; let k = 0;
  while (k < tiles.length - 1) { let far = k + 1; for (let m = tiles.length - 1; m > k + 1; m--) if (sight(w, z, tiles[k], tiles[m])) { far = m; break; } out.push(tiles[far]); k = far; }
  pathCache.set(key, out);
  return out;
}

/** A point at sea: a water tile of a zone. */
export interface SeaNode { z: number; t: number }
export interface SeaLeg { z: number; t0: number; t1: number }
export interface SeaPlan { legs: SeaLeg[]; cost: number; links: number[] }

const tdist = (a: number, b: number) => { const p = tilePos(a), q = tilePos(b); return Math.hypot(wrapDx(p.x, q.x), q.z - p.z); };

/**
 * Shortest route over the zone graph from any start to any goal through the links that `open` allows. Within a zone the cost
 * is the straight distance (a little more, since coasts bend the way); the real path is found afterwards by seaPath.
 */
export function seaPlan(w: World, starts: SeaNode[], goals: SeaNode[], open: (l: ZoneLink) => boolean = () => true): SeaPlan | null {
  // nodes: starts, then both ends of every open link, then goals
  type Node = { z: number; t: number; link?: number; side?: 0 | 1 };
  const nodes: Node[] = [...starts];
  const linkNode: number[][] = [];
  for (const L of w.links) { if (!open(L) || L.ta < 0 || L.tb < 0) continue; linkNode[L.id] = [nodes.length, nodes.length + 1]; nodes.push({ z: L.a, t: L.ta, link: L.id, side: 0 }, { z: L.b, t: L.tb, link: L.id, side: 1 }); }
  const g0 = nodes.length; nodes.push(...goals);
  const dist = new Array(nodes.length).fill(Infinity), prev = new Array(nodes.length).fill(-1), done = new Array(nodes.length).fill(false);
  for (let i = 0; i < starts.length; i++) dist[i] = 0;
  for (;;) {
    let u = -1, best = Infinity; for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0) return null;
    if (u >= g0) {
      const seq: number[] = []; for (let p = u; p >= 0; p = prev[p]) seq.unshift(p);
      const legs: SeaLeg[] = [], links: number[] = [];
      for (let k = 0; k < seq.length - 1; k++) { const A = nodes[seq[k]], B = nodes[seq[k + 1]]; if (A.z === B.z && !(A.link !== undefined && A.link === B.link)) legs.push({ z: A.z, t0: A.t, t1: B.t }); else if (A.link !== undefined) links.push(A.link); }
      if (!legs.length) { const s = nodes[seq[0]]; legs.push({ z: s.z, t0: s.t, t1: nodes[u].t }); }
      return { legs, cost: dist[u], links };
    }
    done[u] = true; const U = nodes[u];
    const relax = (v: number, c: number) => { if (!done[v] && dist[u] + c < dist[v]) { dist[v] = dist[u] + c; prev[v] = u; } };
    // across a link
    if (U.link !== undefined) { const other = linkNode[U.link][U.side ? 0 : 1]; relax(other, tdist(U.t, nodes[other].t)); }
    // within the zone
    for (let v = starts.length; v < nodes.length; v++) if (v !== u && nodes[v].z === U.z) relax(v, tdist(U.t, nodes[v].t) * 1.15);
  }
}

/** The polyline of a plan in continuous world x (may run past ±HW across the date line), and the zone at each stretch. */
export function seaPath(w: World, plan: SeaPlan): { path: number[]; zs: number[]; len: number } {
  const path: number[] = [], zs: number[] = [];
  let len = 0, lx = 0, lz = 0, first = true;
  const add = (t: number, z: number) => {
    const p = tilePos(t); let x = p.x;
    if (!first) { x = lx + wrapDx(lx, p.x); const d = Math.hypot(x - lx, p.z - lz); if (d < 1e-6) return; len += d; }
    if (zs.length === 0 || zs[zs.length - 1] !== z) zs.push(len, z);
    path.push(x, p.z); lx = x; lz = p.z; first = false;
  };
  for (const L of plan.legs) for (const t of zonePath(w, L.z, L.t0, L.t1)) add(t, L.z);
  if (path.length === 2) path.push(path[0] + .01, path[1]);
  return { path, zs, len };
}

/** Position and heading at distance `d` along a path (x wrapped into the map). */
export function pathAt(path: number[], d: number): { x: number; z: number; hd: number } {
  let acc = 0;
  for (let k = 0; k + 3 < path.length; k += 2) {
    const x0 = path[k], z0 = path[k + 1], x1 = path[k + 2], z1 = path[k + 3], L = Math.hypot(x1 - x0, z1 - z0);
    if (acc + L >= d || k + 4 >= path.length) {
      const u = L > 0 ? Math.max(0, Math.min(1, (d - acc) / L)) : 1; let x = x0 + (x1 - x0) * u;
      if (x < -HW) x += 2 * HW; if (x > HW) x -= 2 * HW;
      return { x, z: z0 + (z1 - z0) * u, hd: Math.atan2(x1 - x0, z1 - z0) };
    }
    acc += L;
  }
  return { x: path[0] ?? 0, z: path[1] ?? 0, hd: 0 };
}
/** Zone a fleet is in at distance `d` along its route. */
export function zoneAt(zs: number[], d: number): number { let z = zs[1] ?? -1; for (let k = 0; k < zs.length; k += 2) if (zs[k] <= d) z = zs[k + 1]; return z; }

/** Name of a sector key: a neighbouring region, or the coast on a zone. */
export function sectorName(w: World, s: number): string { return isCoast(s) ? `${w.zones[zoneOfKey(s)]?.short ?? 'sea'} coast` : w.regions[s]?.name ?? 'interior'; }
/** "France border", "North Sea coast", "Inside the region". */
export function borderLabel(w: World, s: number): string { return s < 0 ? 'Inside the region' : isCoast(s) ? sectorName(w, s) : `${w.regions[s]?.name} border`; }

void TS;
