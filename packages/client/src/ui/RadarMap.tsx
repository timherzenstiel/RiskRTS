// A small phosphor radar of the world for menus and briefings: owners' colours, highlighted regions that pulse, and
// animated arrows (dashes marching from one region to another). Draws from the shared world raster, no WebGL.
import { useEffect, useRef } from 'react';
import { COLS, FACTIONS, HH, HW, ROWS, buildWorld } from '@riskrts/shared';

const RGB = FACTIONS.map(f => [1, 3, 5].map(i => parseInt(f.color.slice(i, i + 2), 16)));

export interface RadarProps {
  owners: ArrayLike<number>;
  /** Regions to pulse (e.g. the chosen power, or mission targets). */
  highlight?: number[];
  /** Arrows between region ids. */
  arrows?: [number, number][];
  /** Crop to a lon/lat-free window in world units: [x0, z0, x1, z1]; whole world by default. */
  view?: [number, number, number, number];
  width?: number; height?: number;
  label?: string;
}

export function RadarMap({ owners, highlight = [], arrows = [], view, width = 420, height = 210, label = 'Map' }: RadarProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = Array.from(owners).join(',') + '|' + highlight.join(',') + '|' + arrows.join(';') + '|' + (view ?? []).join(',');
  useEffect(() => {
    const cv = ref.current, ctx = cv?.getContext('2d'); if (!cv || !ctx) return;
    const W = buildWorld(), [x0, z0, x1, z1] = view ?? [-HW, -HH, HW, HH];
    const c0 = Math.max(0, Math.floor((x0 + HW) / (2 * HW) * COLS)), c1 = Math.min(COLS, Math.ceil((x1 + HW) / (2 * HW) * COLS));
    const r0 = Math.max(0, Math.floor((z0 + HH) / (2 * HH) * ROWS)), r1 = Math.min(ROWS, Math.ceil((z1 + HH) / (2 * HH) * ROWS));
    const bw = c1 - c0, bh = r1 - r0, base = document.createElement('canvas'); base.width = bw; base.height = bh;
    const bg = base.getContext('2d')!, img = bg.createImageData(bw, bh), d = img.data, hl = new Set(highlight);
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) {
      const i = r * COLS + c, o = ((r - r0) * bw + (c - c0)) * 4;
      if (W.land[i]) {
        const t = W.terrOf[i], col = RGB[owners[t]] ?? [110, 110, 100], edge = W.borderNb[i] >= 0, k = (hl.has(t) ? 1 : .55) * (edge ? .6 : 1);
        d[o] = col[0] * k; d[o + 1] = col[1] * k; d[o + 2] = col[2] * k;
      } else { d[o] = 6; d[o + 1] = 16; d[o + 2] = 9; }
      d[o + 3] = 255;
    }
    bg.putImageData(img, 0, 0);
    const w2c = (x: number, z: number): [number, number] => [(x - x0) / (x1 - x0) * cv.width, (z - z0) / (z1 - z0) * cv.height];
    let raf = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      ctx.imageSmoothingEnabled = false; ctx.drawImage(base, 0, 0, cv.width, cv.height);
      // pulsing rings on highlighted regions
      const pulse = .5 + .5 * Math.sin(now / 320);
      ctx.lineWidth = 1.5;
      for (const id of highlight) { const R = W.regions[id], [x, y] = w2c(R.cx, R.cz); ctx.strokeStyle = `rgba(159,224,112,${.35 + .5 * pulse})`; ctx.beginPath(); ctx.arc(x, y, 4 + 5 * pulse, 0, 7); ctx.stroke(); }
      // arrows: marching dashes and a head
      for (const [a, b] of arrows) {
        const A = W.regions[a], B = W.regions[b], [ax, ay] = w2c(A.cx, A.cz), [bx, by] = w2c(B.cx, B.cz);
        const mx = (ax + bx) / 2 - (by - ay) * .18, my = (ay + by) / 2 + (bx - ax) * .18;
        ctx.strokeStyle = '#e0553f'; ctx.lineWidth = 2.2; ctx.setLineDash([7, 5]); ctx.lineDashOffset = -now / 40;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by); ctx.stroke(); ctx.setLineDash([]);
        const an = Math.atan2(by - my, bx - mx); ctx.fillStyle = '#e0553f'; ctx.beginPath();
        ctx.moveTo(bx, by); ctx.lineTo(bx - Math.cos(an - .45) * 10, by - Math.sin(an - .45) * 10); ctx.lineTo(bx - Math.cos(an + .45) * 10, by - Math.sin(an + .45) * 10); ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="crt radar-map"><canvas ref={ref} width={width} height={height} role="img" aria-label={label} /></div>;
}
