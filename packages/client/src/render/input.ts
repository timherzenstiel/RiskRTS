// Mouse, touch and keyboard input for the map. Space/Escape/1-4 belong to the React app and are deliberately not handled here.
import * as THREE from 'three';
import { CameraRig, MAX_DIST, MIN_DIST } from './camera';
import { clamp } from './util';

export interface InputHost {
  canvas: HTMLCanvasElement;
  rig: CameraRig;
  /** Region under a client-space point, or -1 (water / off map). */
  regionAt(clientX: number, clientY: number): number;
  orderMode(): boolean;
  onSelect(id: number): void;
  onOrder(id: number): void;
  onHover(id: number): void;
  onDoubleClick(id: number): void;
}

const PAN_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

export class Input {
  private readonly keys = new Set<string>();
  private readonly ptrs = new Map<number, { x: number; y: number }>();
  private down: { x: number; y: number; b: number } | null = null;
  private dragging = false;
  private pinch = 0;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly cleanup: (() => void)[] = [];

  constructor(private readonly h: InputHost) {
    const c = h.canvas, on = <K extends keyof HTMLElementEventMap>(t: HTMLElement, ev: K, fn: (e: HTMLElementEventMap[K]) => void, opt?: AddEventListenerOptions) => {
      t.addEventListener(ev, fn as EventListener, opt); this.cleanup.push(() => t.removeEventListener(ev, fn as EventListener, opt));
    };
    const onWin = <K extends keyof WindowEventMap>(ev: K, fn: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(ev, fn as EventListener); this.cleanup.push(() => window.removeEventListener(ev, fn as EventListener));
    };
    on(c, 'contextmenu', (e) => e.preventDefault());
    on(c, 'pointerdown', (e) => {
      try { c.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.ptrs.size === 1) { this.down = { x: e.clientX, y: e.clientY, b: e.button }; this.dragging = false; }
      if (this.ptrs.size === 2) { const [p, q] = [...this.ptrs.values()]; this.pinch = Math.hypot(p.x - q.x, p.y - q.y); this.dragging = true; }
    });
    on(c, 'pointermove', (e) => this.move(e));
    on(c, 'pointerup', (e) => this.end(e));
    on(c, 'pointercancel', (e) => { this.ptrs.delete(e.pointerId); if (!this.ptrs.size) { this.down = null; this.dragging = false; c.classList.remove('drag'); } });
    on(c, 'pointerleave', (e) => { if (e.pointerType === 'mouse' && !this.ptrs.size) h.onHover(-1); });
    on(c, 'dblclick', (e) => { const id = h.regionAt(e.clientX, e.clientY); if (id >= 0) h.onDoubleClick(id); });
    on(c, 'wheel', (e) => {
      e.preventDefault();
      const rig = h.rig, f = Math.exp(clamp(e.deltaY, -120, 120) * .0018), ok = rig.screenToWorld(e.clientX, e.clientY, c.getBoundingClientRect(), this.a);
      const nd = clamp(rig.gdist * f, MIN_DIST, MAX_DIST), ff = nd / rig.gdist; rig.gdist = nd;
      if (ok) { rig.gx = this.a.x + (rig.gx - this.a.x) * ff; rig.gz = this.a.z + (rig.gz - this.a.z) * ff; }
    }, { passive: false });
    onWin('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || this.typing()) return;
      const k = e.key.toLowerCase(); if (PAN_KEYS.has(k)) this.keys.add(k);
    });
    onWin('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    onWin('blur', () => this.keys.clear());
  }

  private typing() {
    const el = document.activeElement as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  }

  /** Keyboard pan direction. */
  pan(): [number, number] {
    const k = this.keys;
    return [(k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0), (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0)];
  }

  private move(e: PointerEvent) {
    const h = this.h, c = h.canvas, prev = this.ptrs.get(e.pointerId);
    if (!prev) { if (e.pointerType === 'mouse') h.onHover(h.regionAt(e.clientX, e.clientY)); return; }
    const cur = { x: e.clientX, y: e.clientY };
    if (this.ptrs.size === 2) {
      this.ptrs.set(e.pointerId, cur); const [p, q] = [...this.ptrs.values()], d = Math.hypot(p.x - q.x, p.y - q.y);
      if (this.pinch > 0 && d > 0) h.rig.gdist = clamp(h.rig.gdist * this.pinch / d, MIN_DIST, MAX_DIST);
      this.pinch = d; return;
    }
    if (this.down && (this.down.b === 0 || this.down.b === 1)) {
      if (!this.dragging && Math.hypot(cur.x - this.down.x, cur.y - this.down.y) > 6) { this.dragging = true; c.classList.add('drag'); }
      if (this.dragging) {
        const r = c.getBoundingClientRect();
        if (h.rig.screenToWorld(prev.x, prev.y, r, this.a) && h.rig.screenToWorld(cur.x, cur.y, r, this.b)) {
          const dx = this.a.x - this.b.x, dz = this.a.z - this.b.z; h.rig.gx += dx; h.rig.gz += dz; h.rig.tx += dx; h.rig.tz += dz;
        }
      }
    }
    this.ptrs.set(e.pointerId, cur);
  }

  private end(e: PointerEvent) {
    const h = this.h;
    if (!this.ptrs.has(e.pointerId)) return;
    if (this.ptrs.size === 1 && this.down && !this.dragging) {
      const id = h.regionAt(e.clientX, e.clientY);
      if (this.down.b === 2 || (this.down.b === 0 && h.orderMode())) h.onOrder(id); else if (this.down.b === 0) h.onSelect(id);
    }
    this.ptrs.delete(e.pointerId);
    if (!this.ptrs.size) { this.down = null; this.dragging = false; h.canvas.classList.remove('drag'); }
  }

  dispose() { for (const f of this.cleanup) f(); this.cleanup.length = 0; this.keys.clear(); this.ptrs.clear(); }
}
