import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { COLS, buildWorld } from '../src';

// The real-border map (tools/borders) must keep exactly the land contacts the regions had before, because corps are
// keyed by neighbour (RegionState.fr) and saves would otherwise point at borders that no longer exist.
const ref: Record<string, string[]> = JSON.parse(readFileSync(new URL('../../../tools/borders/adjacency.json', import.meta.url), 'utf8')).land;

describe('real region borders', () => {
  const W = buildWorld();
  it('keeps every region on land', () => {
    for (const r of W.regions) expect(r.tiles.length, r.name).toBeGreaterThan(20);
    for (const r of W.regions) expect(W.terrOf[r.anchor], r.name).toBe(r.id);
  });
  it('has exactly the land contacts of the previous map', () => {
    const touch = new Map<string, Set<string>>(W.regions.map(r => [r.name, new Set<string>()]));
    for (let i = 0; i < W.land.length; i++) {
      if (!W.land[i]) continue; const c = i % COLS;
      for (const j of [c < COLS - 1 ? i + 1 : -1, i + COLS < W.land.length ? i + COLS : -1]) {
        if (j < 0 || !W.land[j] || W.terrOf[j] === W.terrOf[i]) continue;
        const a = W.regions[W.terrOf[i]].name, b = W.regions[W.terrOf[j]].name; touch.get(a)!.add(b); touch.get(b)!.add(a);
      }
    }
    for (const r of W.regions) expect([...touch.get(r.name)!].sort(), r.name).toEqual(ref[r.name]);
  });
  it('keeps the neighbour lists (land + sea lanes) used by corps and saves', () => {
    for (const r of W.regions) {
      const want = new Set([...ref[r.name], ...r.seaAdj.map(n => W.regions[n].name)]);
      expect(r.adj.map(n => W.regions[n].name).sort(), r.name).toEqual([...want].sort());
    }
  });
});
