// Orders by clicking the map: a point on a border belongs to that border anywhere along it, not only near its middle.
import { describe, it, expect } from 'vitest';
import { COLS, N, buildWorld, sectorAt, sectorPoint, tx, tz, wrapDx } from '../src';

const W = buildWorld();
/** The old rule: the sector whose middle is nearest, if nearer than 0.8 × the way to the centre. */
function byMiddle(region: number, x: number, z: number): number {
  const R = W.regions[region]; let best = -1, bd = Math.hypot(wrapDx(x, R.cx), z - R.cz) * .8;
  for (const s of R.sectors) { const p = sectorPoint(W, region, s), d = Math.hypot(wrapDx(x, p.x), z - p.z); if (d < bd) { bd = d; best = s; } }
  return best;
}

describe('sectorAt', () => {
  it('gives every tile on a land border to one of the borders it touches, never to the centre', () => {
    let tiles = 0, missed = 0;
    for (let i = 0; i < N; i++) {
      if (!W.land[i]) continue; const a = W.terrOf[i], c = i % COLS; if (a < 0) continue;
      const nb = [c > 0 ? i - 1 : -1, c < COLS - 1 ? i + 1 : -1, i - COLS, i + COLS].filter(j => j >= 0 && j < N && W.land[j] && W.terrOf[j] !== a && W.terrOf[j] >= 0 && W.regions[a].land.includes(W.terrOf[j])).map(j => W.terrOf[j]);
      if (!nb.length) continue;
      tiles++;
      const x = tx(c), z = tz((i / COLS) | 0);
      expect(nb, `tile ${i} of ${W.regions[a].name}`).toContain(sectorAt(W, a, x, z));
      if (!nb.includes(byMiddle(a, x, z))) missed++;
    }
    expect(tiles).toBeGreaterThan(500);
    // the rule it replaces sent a large share of these clicks to the centre or to another border
    console.log(`border tiles ${tiles}, missed by the old rule ${missed} (${Math.round(100 * missed / tiles)} %)`);
    expect(missed / tiles).toBeGreaterThan(.2);
  });

  it('keeps the centre for points near the centre', () => {
    for (const r of W.regions) expect(sectorAt(W, r.id, r.cx, r.cz)).toBe(-1);
  });
});
