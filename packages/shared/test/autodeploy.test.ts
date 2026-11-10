// Auto deployment hands out whole formations (design-optimize §3.1): nothing is lost to rounding, every land border is manned as
// far as the troops reach, and coasts draw troops only when ships are off them.
import { describe, it, expect } from 'vitest';
import { COAST_SHARE, MAIN_SHARE, buildWorld, coastKey, corpsIn, createGame, deployTargets, depotOf, emptyUnits, groundUnits, type Units } from '../src';

const W = buildWorld();
const u = (inf: number, mg = 0, art = 0, tank = 0): Units => ({ ...emptyUnits(), inf, mg, art, tank });
const sum = (t: Units[]) => t.reduce((n, x) => n + groundUnits(x), 0);

describe('auto deployment', () => {
  it('sends out about 70 % of a mixed garrison instead of rounding every share down', () => {
    // 6 infantry, 2 MG companies and a battery on three borders: the old per-type floor placed 1 of 9
    const t = deployTargets(u(6, 2, 1), [10, 11, 12], [3.25, 1.75, 1.75]);
    expect(sum(t)).toBe(Math.round(9 * (1 - MAIN_SHARE)));
    for (const x of t) expect(x.inf).toBeGreaterThanOrEqual(1);
    // the heavy weapons stand on the most threatened border
    expect(t[0].art).toBe(1);
    expect(groundUnits(t[0])).toBeGreaterThanOrEqual(groundUnits(t[1]));
  });

  it('mans every land border before any gets a second formation, and keeps one formation at the centre', () => {
    const t = deployTargets(u(6), [10, 11, 12, 13], [9, 1, 1, 1]);
    expect(t.every(x => groundUnits(x) >= 1)).toBe(true);
    expect(sum(t)).toBeLessThanOrEqual(5);
    // too few for every border: the most threatened ones first, never more than one each, one stays behind
    const few = deployTargets(u(3), [10, 11, 12, 13], [1, 4, 2, 3]);
    expect(few.map(groundUnits)).toEqual([0, 1, 0, 1]);
    expect(sum(deployTargets(u(1), [10], [1]))).toBe(0);
    expect(sum(deployTargets(u(2), [10], [1]))).toBe(1);
  });

  it('never hands out more of a type than there is', () => {
    for (const a of [u(1, 3, 2), u(0, 2, 2), u(5, 0, 0, 3), u(20, 6, 4, 2)]) {
      const t = deployTargets(a, [10, 11, coastKey(0)], [2, 1, .5]);
      for (const k of ['inf', 'mg', 'art', 'tank'] as const) expect(t.reduce((n, x) => n + x[k], 0)).toBeLessThanOrEqual(a[k]);
      expect(sum(t)).toBeLessThan(groundUnits(a));
    }
  });

  it('coasts take a small share while only ships cruise off them, and their full share when a landing is coming', () => {
    const quiet = deployTargets(u(20), [10, coastKey(0), coastKey(1)], [2, 1.5, 1.5]);
    expect(groundUnits(quiet[1]) + groundUnits(quiet[2])).toBeLessThanOrEqual(Math.ceil(14 * COAST_SHARE));
    const landing = deployTargets(u(20), [10, coastKey(0)], [2, 6]);
    expect(groundUnits(landing[1])).toBeGreaterThan(groundUnits(landing[0]));
  });

  it('at the start of a war most troops of the border regions stand on borders, and no coast is manned against a port alone', () => {
    let tot = 0, dep = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const g = createGame({ seed, humans: [0] });
      for (const r of g.regions) {
        const foes = W.regions[r.id].land.filter(n => g.regions[n].owner !== r.owner); if (!foes.length) continue;
        const n = groundUnits(r.units), d = groundUnits(depotOf(r).u); tot += n; dep += d;
        // enough troops for every border and a reserve: no land border without a corps
        if (n >= foes.length + 2) for (const s of foes) expect(corpsIn(r).some(c => c.p === s), `${W.regions[r.id].name} leaves ${W.regions[s].name} open (seed ${seed})`).toBe(true);
        expect(d).toBeGreaterThanOrEqual(1);
        expect(corpsIn(r).some(c => c.p >= 1000)).toBe(false);
      }
    }
    expect(dep / tot).toBeLessThan(.45);
  });
});
