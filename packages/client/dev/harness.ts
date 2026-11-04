// Throw-away harness for the world renderer (not part of the production build). Exposes window.__h for Playwright.
import { buildWorld } from '@riskrts/shared';
import { HostSession } from '../src/game/session';
import { useUi } from '../src/game/store';
import { createWorldRenderer } from '../src/render/WorldRenderer';
import { facCol } from '../src/render/palette';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const labels = document.getElementById('labels') as HTMLElement;
const hud = document.getElementById('hud') as HTMLElement;
const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

const session = new HostSession(0, { humans: [0], difficulty: 1 });
const ui = () => useUi.getState();
const r = createWorldRenderer(canvas, labels, {
  onSelect: (id) => ui().select(id),
  onOrder: (id) => { const s = ui().sel; if (s >= 0 && id >= 0) ui().march(s, id); else ui().cancelOrder(); },
  onHover: (id) => ui().setHover(id),
});
useUi.setState({ session, screen: 'game' });
r.setSession(session);

let last = performance.now(), frames = 0, auto = new URLSearchParams(location.search).has('auto');
function loop(now: number) {
  requestAnimationFrame(loop);
  if (!auto) return;
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  session.update(dt); r.frame(dt); frames++;
  const dbg = (r as unknown as { debug: { stats: { cpuMs: number } } }).debug;
  hud.textContent = `t=${session.state.time.toFixed(0)}s battles=${session.state.battles.length} dist=${r.cameraDistance().toFixed(1)} cpu=${dbg.stats.cpuMs.toFixed(1)}ms`;
}
requestAnimationFrame(loop);

const h = {
  r, session, ui, errors,
  get frames() { return frames; },
  set auto(v: boolean) { auto = v; last = performance.now(); },
  /** Simulate `sec` seconds of game time without rendering. */
  sim(sec: number) { for (let t = 0; t < sec; t += .25) session.update(.25); session.drainFx(); },
  /** Render n frames manually (needed when auto is off). */
  renderFrames(n: number, dt = .033) { for (let i = 0; i < n; i++) { session.update(dt); r.frame(dt); frames++; } },
  world: buildWorld(),
  id(name: string) { return buildWorld().byName[name].id; },
  /** Jump the camera (no easing) to a region (or x,z) at a distance and render `n` frames. */
  snap(target: number | [number, number], dist: number, n = 2) {
    const d = (r as unknown as { debug: { rig: { gx: number; gz: number; tx: number; tz: number; dist: number; gdist: number } } }).debug.rig;
    const [x, z] = typeof target === 'number' ? [buildWorld().regions[target].cx, buildWorld().regions[target].cz] : target;
    d.gx = d.tx = x; d.gz = d.tz = z; d.gdist = d.dist = dist; this.renderFrames(1); (r as unknown as { warmDetail(): void }).warmDetail(); this.renderFrames(n);
  },
  /** Draw every unit type for every faction in rows around (x,z) at battle scale (S). Pass null to clear. */
  showcase(at: [number, number] | null, S = .42, ships: [number, number] | null = null) {
    const dbg = (r as unknown as { debug: { extra?: (m: unknown, T: number) => void } }).debug;
    if (!at) { dbg.extra = undefined; return; }
    const ter = (r as unknown as { terrain: { surfaceAt(x: number, z: number): number } }).terrain;
    type M = { soldier(...a: unknown[]): void; unit(...a: unknown[]): void; corpse(...a: unknown[]): void; plane(...a: unknown[]): void; ship(...a: unknown[]): void };
    dbg.extra = (m0, T) => {
      const m = m0 as M;
      for (let f = 0; f < 6; f++) {
        const z = at[1] + (f - 2.5) * .2;
        const X = (i: number) => at[0] + (i - 3.5) * .17;
        const Y = (i: number) => ter.surfaceAt(X(i), z);
        m.soldier(X(0) - .03, Y(0), z, .5, f, S, false, 0); m.soldier(X(0) + .03, Y(0), z, -.3, f, S, false, T * 9);
        m.soldier(X(1), Y(1), z, .6, f, S, true, 0);
        m.unit('mg', X(2), Y(2), z, .6, f, S, 0, 0);
        m.unit('art', X(3), Y(3), z, .6, f, S, 0, 0);
        m.unit('tank', X(4.3), Y(4), z, .6, f, S, 0, 0);
        m.plane(X(5.6), Y(5) + .035, z, .6, facCol[f], S * .9, f);
        m.corpse(X(6.6), Y(6), z, .6, f, S);
      }
      if (ships) for (let f = 0; f < 7; f++) m.ship(ships[0] + (f % 4) * .55, ships[1] + Math.floor(f / 4) * .7, .6, facCol[f % 6], 1.1, T, f === 6);
    };
  },
  firstBattle() { return session.state.battles.find((b) => !b.ended) ?? null; },
  dbg: () => (r as unknown as { debug: { rig: { tx: number; tz: number; dist: number; gx: number; gz: number; gdist: number }; views: Map<number, unknown>; stats: { cpuMs: number } } }).debug,
};
(window as unknown as { __h: typeof h }).__h = h;
