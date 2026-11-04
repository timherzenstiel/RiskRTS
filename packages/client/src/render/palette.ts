import { FACTIONS } from '@riskrts/shared';
import { col } from './util';

/** Shared colour constants for models, particles and props. */
export const K = {
  puttee: col('#3a3326'), boot: col('#231c14'), skin: col('#d8b18c'), belt: col('#3d2e1f'), pack: col('#5b5238'), wood: col('#4a3424'),
  steel: col('#b8bcc0'), gun: col('#2f302c'), jacket: col('#45473f'), olive: col('#5c5b3b'), track: col('#353430'), brick: col('#7c4b37'),
  brick2: col('#5a382b'), roof: col('#4b4636'), bar: col('#6f6a4c'), pole: col('#2b2a24'), sand: col('#a08f63'), sand2: col('#8a7a52'),
  smoke: col('#8b8b84'), smoke2: col('#5c5c57'), dirt: col('#5d4b33'), fire: col('#ffb347'), flash: col('#ffe08a'), tracer: col('#ffd27a'),
  flare: col('#fff3c4'), hull: col('#2d3033'), deck: col('#8a7a5c'), super: col('#d9d4c4'), funnel: col('#a8432e'), stone: col('#8c867a'),
  stump: col('#3a2c20'), crate: col('#7a6040'), cloud: col('#eef1ec'), cloud2: col('#d7dcd6'), wing: col('#cfc6a4'), khaki: col('#b09a6a'),
  canvas: col('#cfc6a2'), canvas2: col('#a99f7e'), red: col('#8c2f26'), beam: col('#6b5236'), bush: col('#3d5530'), hay: col('#c9b45f'),
  white: col('#ffffff'), spark: col('#ffd9a0'),
  wheel: col('#6e6b62'), trackHi: col('#4b4842'), rivet: col('#26251f'), hatch: col('#3a3b36'), exhaust: col('#2a2724'),
  brass: col('#b08d3c'), leather: col('#5a3b22'), bayo: col('#d6d9dc'), eye: col('#1a1512'), stache: col('#4a3020'), mud: col('#4a3a26'),
  tyre: col('#26241f'), tarp: col('#56583f'), prop: col('#6b4a2a'), glass: col('#33454c'), cream: col('#d8d0bc'), blk: col('#161514'),
  rRed: col('#b8352b'), rBlue: col('#2f4f9a'), rWhite: col('#e8e6dc'), navy: col('#666b6f'), navy2: col('#474c50'), navy3: col('#848a8d'),
  navy4: col('#a2a7a8'), merch: col('#3b3530'), plank: col('#6f6248'),
  concrete: col('#a29e92'), concrete2: col('#7f7b70'), slit: col('#171612'), runway: col('#8f8b7c'), runway2: col('#d8d3c0'), hangar: col('#6d6a5c'), flakpuff: col('#2b2a28'), dust: col('#9a8660'),
};

const mix = (a: string, b: string, t: number) => col(a).lerp(col(b), t);
/** Per-faction colour sets (index = faction id). */
export const facCol = FACTIONS.map((f) => col(f.color));
export const UNI = facCol.map((c) => c.clone().lerp(col('#7d7454'), 0.18));
export const UNI2 = UNI.map((c) => c.clone().multiplyScalar(0.82));
export const HELM = facCol.map((c) => c.clone().multiplyScalar(0.55));
/** Vehicle paint: faction colour weathered toward drab, with a lit top panel (TANKL) and shaded sides (TANKD), C&C style. */
export const TANKC = facCol.map((c) => c.clone().lerp(col('#6b6a52'), 0.3));
export const TANKD = TANKC.map((c) => c.clone().multiplyScalar(0.66));
export const TANKL = TANKC.map((c) => c.clone().lerp(col('#e8e2cc'), 0.22));
export const DEADC = facCol.map((c) => c.clone().multiplyScalar(0.35));
export const FLAGD = facCol.map((c) => c.clone().multiplyScalar(0.85));
export { mix };
