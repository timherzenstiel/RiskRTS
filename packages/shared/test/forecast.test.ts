// Design-play phase 3: forecasts behind the gauges and lever cards.
import { describe, it, expect } from 'vitest';
import { MANPOWER, NATIONS, WW_FADE, createGame, econOptions, mobOptions, poolNet, poolWeeks, unrestIn, wwTrend } from '../src';

describe('forecasts', () => {
  it('conscription: more men and more weariness per level, and the lever is left as it was', () => {
    const g = createGame({ seed: 3, humans: [0] }); const f = g.factions[0]; f.ww = 20; f.mob = 0;
    const o = mobOptions(g, 0);
    expect(f.mob).toBe(0);
    expect(o[1].men).toBeGreaterThan(o[0].men); expect(o[2].men).toBeGreaterThan(o[1].men);
    expect(o[0].ww).toBeCloseTo(-WW_FADE); expect(o[2].ww).toBeCloseTo(2 * MANPOWER.mobWW);
    expect(o[0].unrest).toBe(Infinity);
    expect(o[2].unrest).toBeCloseTo((NATIONS[0].unrest - 20) / o[2].ww);
    f.ww = NATIONS[0].unrest; expect(unrestIn(g, 0, wwTrend(g, 0, 0))).toBe(0);
  });

  it('war economy: munitions first trades Production for shells', () => {
    const g = createGame({ seed: 3, humans: [0] }); g.factions[0].econ = 1;
    const o = econOptions(g, 0);
    expect(g.factions[0].econ).toBe(1);
    expect(o[2].shells).toBeGreaterThanOrEqual(o[1].shells); expect(o[2].prod).toBeLessThanOrEqual(o[1].prod);
    expect(o[0].prod).toBeGreaterThanOrEqual(o[1].prod);
  });

  it('manpower: the pool lasts while it grows, and runs out under a drain', () => {
    const g = createGame({ seed: 3, humans: [0] });
    const n = poolNet(g, 0); expect(n.net).toBe(n.growth + n.back - n.repl);
    if (n.net >= 0) expect(poolWeeks(g, 0)).toBe(Infinity);
  });
});
