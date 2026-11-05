// Sidebar radar (minimap): territory colours, battle pings, army dots, selection ring and the camera's viewport. Click/drag pans.
import { useEffect, useRef } from 'react';
import { COLS, FACTIONS, HH, HW, ROWS, armyPos, buildWorld } from '@riskrts/shared';
import { useUi } from '../game/store';
import { rendererRef } from './refs';

const MW = COLS / 2, MH = ROWS / 2; // base raster sampled at stride 2
const RGB = FACTIONS.map(f => [1, 3, 5].map(i => parseInt(f.color.slice(i, i + 2), 16)));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current; const ctx = cv?.getContext('2d'); const sess = useUi.getState().session;
    if (!cv || !ctx || !sess) return;
    const W = buildWorld();
    const base = document.createElement('canvas'); base.width = MW; base.height = MH;
    let key = '', raf = 0, last = 0;
    const w2m = (x: number, z: number): [number, number] => [(x + HW) / (2 * HW) * cv.width, (z + HH) / (2 * HH) * cv.height];

    const rebuild = (owners: number[]) => {
      const g = base.getContext('2d'); if (!g) return;
      const img = g.createImageData(MW, MH), d = img.data;
      for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
        const i = y * 2 * COLS + x * 2, o = (y * MW + x) * 4;
        if (W.land[i]) { const c = RGB[owners[W.terrOf[i]]] ?? [120, 120, 120], b = W.borderNb[i] >= 0 ? .5 : .82; d[o] = c[0] * b; d[o + 1] = c[1] * b; d[o + 2] = c[2] * b; }
        else { d[o] = 7; d[o + 1] = 17; d[o + 2] = 10; }
        d[o + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    };

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 66) return; last = now;
      const g = sess.state, ui = useUi.getState(), k = cv.width / 260;
      const owners = g.regions.map(r => r.owner), nk = owners.join('');
      if (nk !== key) { key = nk; rebuild(owners); }
      ctx.imageSmoothingEnabled = true; ctx.drawImage(base, 0, 0, cv.width, cv.height);
      for (const b of g.battles) {
        if (b.ended) continue; const r = W.regions[b.region]; const [x, y] = w2m(r.cx, r.cz), rad = (4 + 2 * Math.sin(now / 260)) * k;
        ctx.fillStyle = 'rgba(240,112,92,.35)'; ctx.beginPath(); ctx.arc(x, y, rad * 1.6, 0, 7); ctx.fill();
        ctx.fillStyle = '#f0705c'; ctx.beginPath(); ctx.arc(x, y, 2.4 * k, 0, 7); ctx.fill();
      }
      for (const a of g.armies) {
        const [wx, wz] = armyPos(a), [x, y] = w2m(wx, wz);
        ctx.fillStyle = '#fff'; ctx.fillRect(x - 2 * k, y - 2 * k, 4 * k, 4 * k); ctx.fillStyle = FACTIONS[a.owner].color; ctx.fillRect(x - 1.2 * k, y - 1.2 * k, 2.4 * k, 2.4 * k);
      }
      if (ui.sel >= 0) { const r = W.regions[ui.sel], [x, y] = w2m(r.cx, r.cz); ctx.strokeStyle = '#9fe070'; ctx.lineWidth = 1.5 * k; ctx.beginPath(); ctx.arc(x, y, 6 * k, 0, 7); ctx.stroke(); }
      const poly = rendererRef.current?.viewPolygon();
      if (poly && poly.length) {
        // the camera's view as green corner brackets on the phosphor screen
        const pts = poly.map(([wx, wz]) => w2m(clamp(wx, -HW, HW), clamp(wz, -HH, HH)));
        ctx.strokeStyle = 'rgba(159,224,112,.35)'; ctx.lineWidth = 1 * k; ctx.beginPath();
        pts.forEach(([x, y], i) => { if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); ctx.stroke();
        ctx.strokeStyle = '#9fe070'; ctx.lineWidth = 2 * k; ctx.beginPath();
        pts.forEach(([x, y], i) => {
          const [px, py] = pts[(i + pts.length - 1) % pts.length], [nx, ny] = pts[(i + 1) % pts.length], f = .22;
          ctx.moveTo(x + (px - x) * f, y + (py - y) * f); ctx.lineTo(x, y); ctx.lineTo(x + (nx - x) * f, y + (ny - y) * f);
        });
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const down = useRef(false);
  const go = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    rendererRef.current?.panTo(((e.clientX - r.left) / r.width * 2 - 1) * HW, ((e.clientY - r.top) / r.height * 2 - 1) * HH);
  };
  return (
    <div className="mini">
      <canvas ref={ref} id="mini" width={520} height={204} aria-label="Minimap. Click or drag to move the camera."
        onPointerDown={e => { down.current = true; e.currentTarget.setPointerCapture(e.pointerId); go(e); }}
        onPointerMove={e => { if (down.current) go(e); }}
        onPointerUp={() => { down.current = false; }} onPointerCancel={() => { down.current = false; }} />
    </div>
  );
}
