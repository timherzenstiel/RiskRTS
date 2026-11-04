import * as THREE from 'three';

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const col = (hex: string) => new THREE.Color(hex);
export const hex3 = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Anything with a dispose() method; the renderer collects these to free GPU memory in one sweep. */
export interface Disposable { dispose(): void }

/** Holds GPU resources so a module can release them all in one call. */
export class DisposeBag {
  private items: Disposable[] = [];
  add<T extends Disposable>(x: T): T { this.items.push(x); return x; }
  disposeAll() { for (const i of this.items) i.dispose(); this.items.length = 0; }
}

/** Deterministic hash of an integer id to a 32 bit seed (used to seed per-battle decoration). */
export const seedOf = (id: number) => (Math.imul(id + 1, 2654435761) ^ 0x9e3779b9) >>> 0;
