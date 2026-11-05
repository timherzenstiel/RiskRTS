// Title screen backdrop (design 3.5): a live render of the Western Front at dusk, slowly panning. An all-AI war runs behind
// it, fast-forwarded until the fronts have formed. Falls back to the still render (CSS) without WebGL or with reduced motion.
import { useEffect, useRef, useState } from 'react';
import { buildWorld, sectorPoint } from '@riskrts/shared';
import { HostSession } from '../game/session';
import { createWorldRenderer } from '../render/WorldRenderer';

export function TitleBackdrop() {
  const canvas = useRef<HTMLCanvasElement>(null), labels = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = canvas.current, lb = labels.current; if (!cv || !lb) return;
    let raf = 0, stop = false;
    let r: ReturnType<typeof createWorldRenderer> | null = null;
    try {
      const s = new HostSession(1, { humans: [], difficulty: 2, seed: 1914 });
      s.speed = 4; for (let i = 0; i < 420; i++) s.update(.25); s.speed = 1;
      r = createWorldRenderer(cv, lb, { onSelect() {}, onOrder() {}, onHover() {} });
      r.setSession(s); r.setQuality(1);
      const W = buildWorld(), fr = W.byName.France.id, de = W.byName.Germany.id, p = sectorPoint(W, fr, de);
      r.panTo(p.x, p.z); r.flyTo(fr, 26); r.panTo(p.x, p.z);
      let last = performance.now(), t = 0;
      const loop = (now: number) => {
        if (stop) return; raf = requestAnimationFrame(loop);
        const dt = Math.min(.1, (now - last) / 1000); last = now; t += dt;
        s.update(dt); r!.panTo(p.x + Math.sin(t * .05) * 4, p.z + Math.cos(t * .037) * 2); r!.frame(dt);
      };
      raf = requestAnimationFrame(loop); setLive(true);
    } catch { setLive(false); }
    return () => { stop = true; cancelAnimationFrame(raf); try { r?.dispose(); } catch { /* already gone */ } };
  }, []);
  return (
    <div className={'title-live' + (live ? ' on' : '')} aria-hidden="true">
      <canvas ref={canvas} />
      <div ref={labels} className="title-labels" />
      <div className="dusk" />
    </div>
  );
}
