// The 3D world: a canvas + a labels layer owned by the renderer, driven by one requestAnimationFrame loop.
import { useEffect, useRef } from 'react';
import { buildWorld } from '@riskrts/shared';
import { createWorldRenderer } from '../render/WorldRenderer';
import type { WorldRendererApi } from '../render/api';
import { useUi } from '../game/store';
import { rendererRef } from './refs';

export function Stage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const session = useUi(s => s.session);
  const quality = useUi(s => s.quality);
  const qualityRef = useRef(quality); qualityRef.current = quality;

  useEffect(() => {
    const canvas = canvasRef.current, labels = labelsRef.current;
    if (!canvas || !labels || !session) return;
    const ui = useUi.getState;
    ui().clearFatal();
    let renderer: WorldRendererApi;
    try {
      renderer = createWorldRenderer(canvas, labels, {
        onSelect: (id) => ui().select(id < 0 ? -1 : id),
        onOrder: (id) => {
          const { sel, session: s, orderMode, orderKind } = ui();
          if (!s || id < 0) { ui().say('Pick a region to march on.'); return; }
          if (orderMode && orderKind === 'air' && sel >= 0) { if (id === sel) { ui().say('Pick a different region as the target.'); return; } ui().air(sel, id); return; }
          if (sel < 0 || s.state.regions[sel].owner !== s.me) { ui().say('Select one of your own regions first, then right-click a neighbour.'); ui().cancelOrder(); return; }
          if (!buildWorld().regions[sel].adj.includes(id)) { ui().say(id === sel ? 'Pick a different region as the target.' : `${buildWorld().regions[id].name} does not border ${buildWorld().regions[sel].name}. Infantry and tanks need a direct border; aircraft reach two borders.`); return; }
          ui().march(sel, id);
        },
        onHover: (id) => ui().setHover(id),
      });
      renderer.setSession(session);
      renderer.setQuality(qualityRef.current);
    } catch (e) {
      console.error('Renderer failed to start', e);
      useUi.setState({ fatal: e instanceof Error ? e.message : String(e) });
      return;
    }
    rendererRef.current = renderer;

    let raf = 0, last = performance.now(), acc = 0, errors = 0, stopped = false;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(.25, Math.max(0, (now - last) / 1000)); last = now;
      try {
        session.update(dt);
        renderer.frame(dt);
        acc += dt;
        if (acc >= .2) { acc = 0; ui().pump(); session.setWatch(renderer.watchedBattles()); }
      } catch (e) {
        console.error('Frame error', e);
        if (++errors > 5 && !stopped) { stopped = true; cancelAnimationFrame(raf); useUi.setState({ fatal: e instanceof Error ? e.message : String(e) }); }
      }
    };
    raf = requestAnimationFrame(loop);
    // Browsers pause requestAnimationFrame in hidden tabs. A host must keep simulating so guests are not frozen.
    const bg = setInterval(() => {
      if (!document.hidden || session.kind === 'guest') return;
      const now = performance.now(); let left = Math.min(5, (now - last) / 1000); last = now;
      while (left > 1e-3) { const d = Math.min(.25, left); session.update(d); left -= d; }
      ui().pump();
    }, 500);

    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(canvas);
    return () => {
      cancelAnimationFrame(raf); clearInterval(bg);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      ro?.disconnect();
      if (rendererRef.current === renderer) rendererRef.current = null;
      try { renderer.dispose(); } catch (e) { console.error(e); }
    };
  }, [session]);

  useEffect(() => { rendererRef.current?.setQuality(quality); }, [quality]);

  return (
    <div className="stage">
      {/* The renderer toggles its own classes on the canvas (smooth / order / drag), so React must not manage className. */}
      <canvas ref={canvasRef} id="view" aria-label="World map of 1914" />
      <div ref={labelsRef} id="labels" aria-hidden="true" />
    </div>
  );
}
