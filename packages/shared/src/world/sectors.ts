// Where each border sector of a region lies on the map: the middle of the shared border (or the coast facing a sea lane),
// pulled a little inland so defences stand on the region's own ground. Interior = the region anchor.
import { COLS, N, tileAtW, tx, tz, wrapDx, type World } from './build';
import { coastKey, isCoast, zoneOfKey } from './zones';

export interface SectorPt { x: number; z: number; /** unit tangent along the border, for spacing several defences */ ux: number; uz: number; tile: number }

const cache = new Map<string, SectorPt>();
let built: World | null = null;

function build(w: World) {
  built = w; cache.clear();
  const { land, terrOf } = w, nb = [0, 0, 0, 0];
  const pts = new Map<string, number[]>();
  for (let i = 0; i < N; i++) {
    if (!land[i]) continue; const c = i % COLS, a = terrOf[i];
    nb[0] = c > 0 ? i - 1 : -1; nb[1] = c < COLS - 1 ? i + 1 : -1; nb[2] = i >= COLS ? i - COLS : -1; nb[3] = i + COLS < N ? i + COLS : -1;
    for (const j of nb) if (j >= 0 && land[j] && terrOf[j] !== a) { const k = a + '|' + terrOf[j]; let l = pts.get(k); if (!l) pts.set(k, l = []); l.push(i); }
  }
  for (const r of w.regions) for (const n of [...r.land, ...r.zones.map(coastKey)]) {
    const key = r.id + '|' + n; let tiles = isCoast(n) ? undefined : pts.get(key);
    // a coast: the coast tile of the region nearest the middle of its coast on that zone
    if (isCoast(n)) tiles = [r.coast[zoneOfKey(n)].tile];
    else if (!tiles?.length) tiles = [r.anchor];
    let mx = 0, mz = 0; for (const i of tiles) { mx += tx(i % COLS); mz += tz((i / COLS) | 0); } mx /= tiles.length; mz /= tiles.length;
    let pick = tiles[0], bd = 1e9; for (const i of tiles) { const d = (tx(i % COLS) - mx) ** 2 + (tz((i / COLS) | 0) - mz) ** 2; if (d < bd) { bd = d; pick = i; } }
    let x = tx(pick % COLS), z = tz((pick / COLS) | 0);
    // step inland towards the anchor, staying on own tiles
    const dx = wrapDx(x, r.cx), dz = r.cz - z, L = Math.hypot(dx, dz) || 1, step = Math.min(.55, L * .3);
    const ix = x + dx / L * step, iz = z + dz / L * step, inside = tileAtW(ix, iz);
    if (inside >= 0 && land[inside] && terrOf[inside] === r.id) { x = ix; z = iz; pick = inside; }
    cache.set(key, { x, z, ux: -dz / L, uz: dx / L, tile: pick });
  }
  // a sea lane leads to the coast it runs from
  for (const r of w.regions) for (const n of r.seaAdj) { const z = w.laneZone.get(r.id + '|' + n), p = z !== undefined ? cache.get(r.id + '|' + coastKey(z)) : undefined; if (p) cache.set(r.id + '|' + n, p); }
}

/** Map position of a region's sector (`sector` = neighbour id, a coast key, or -1 for the interior). A sea lane neighbour gives its coast. */
export function sectorPoint(w: World, region: number, sector: number): SectorPt {
  if (built !== w) build(w);
  const r = w.regions[region];
  if (sector < 0) return { x: r.cx + .35, z: r.cz + .32, ux: 1, uz: 0, tile: r.anchor };
  return cache.get(region + '|' + sector) ?? { x: r.cx, z: r.cz, ux: 1, uz: 0, tile: r.anchor };
}

/** Where a battle is fought on the map: on the border it comes over (the middle of the shared border), or the region anchor. */
export function battleAnchor(w: World, b: { region: number; from: number }): { x: number; z: number } {
  if (b.from >= 0 && (w.regions[b.region].adj.includes(b.from) || w.regions[b.region].sectors.includes(b.from))) { const p = sectorPoint(w, b.region, b.from); return { x: p.x, z: p.z }; }
  const r = w.regions[b.region]; return { x: r.cx, z: r.cz };
}
