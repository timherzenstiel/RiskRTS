// Test helpers for the phased offensives. Battle tests set up garrisons by hand; these place them on the borders the way a
// region deploys itself, so a test can open a front straight away instead of waiting minutes for troops to form up and march.
import { FORMATION, GROUND_TYPES, emptyUnits, frontsOf, groundUnits, step, type Battle, type Corps, type GameState, type Order, type Units } from '../src';

/** Replace the corps of region `rid`: [post, battalions, other fields] each, at full strength, holding. */
export function setCs(g: GameState, rid: number, list: [number, Partial<Units>, Partial<Corps>?][]): Corps[] {
  const R = g.regions[rid];
  const cs = list.map(([p, u, o]): Corps => {
    const uu = { ...emptyUnits(), ...u, plane: 0 }, m = emptyUnits();
    for (const k of GROUND_TYPES) m[k] = uu[k] * FORMATION[k].men;
    return { id: g.nextId++, n: 90 + rid, p, u: uu, m, mor: R.mor, since: g.time, ord: 0, ...o };
  });
  R.cs = cs.length ? cs : undefined;
  return cs;
}

/** Put all ground formations of region `r` on its border with `toward` (manual deployment, holding). */
export function man(g: GameState, r: number, toward: number) {
  const R = g.regions[r]; R.deploy = 1;
  const u = { ...R.units, plane: 0 };
  setCs(g, r, groundUnits(u) ? [[toward, u]] : []);
}

/**
 * Attack from A across the border into B at once: a share `frac` of A's ground troops stands assembled on that border with
 * the order `goal`; the defenders of B (unless `keepDefence`) stand on their side of it. Returns null or an error text.
 */
export function strike(g: GameState, f: number, A: number, B: number, frac = 1, goal: Order = 2, keepDefence = false): string | null {
  const a = g.regions[A];
  if (!keepDefence && g.regions[B].owner !== f) man(g, B, A);
  a.deploy = 1;
  const u = emptyUnits(); let n = 0;
  for (const k of GROUND_TYPES) { u[k] = Math.round(a.units[k] * Math.max(0, Math.min(1, frac))); n += u[k]; }
  if (!n) for (const k of GROUND_TYPES) if (a.units[k]) { u[k] = 1; break; }
  setCs(g, A, [[B, u, { n: 80 + A, ord: goal, ready: g.time }]]);
  return null;
}

/** Strike and run until the front opens. */
export function openFront(g: GameState, f: number, A: number, B: number, frac = 1, goal: Order = 2, keepDefence = false): Battle {
  const e = strike(g, f, A, B, frac, goal, keepDefence); if (e) throw new Error(e);
  for (let i = 0; i < 20 * 60 && !frontsOf(g, B).length; i++) step(g, .05);
  const b = frontsOf(g, B)[0]; if (!b) throw new Error('no front opened');
  return b;
}
