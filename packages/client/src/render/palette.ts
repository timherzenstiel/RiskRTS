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
};

const mix = (a: string, b: string, t: number) => col(a).lerp(col(b), t);
/** Per-faction colour sets (index = faction id). */
export const facCol = FACTIONS.map((f) => col(f.color));
export const UNI = facCol.map((c) => c.clone().lerp(col('#7d7454'), 0.18));
export const UNI2 = UNI.map((c) => c.clone().multiplyScalar(0.82));
export const HELM = facCol.map((c) => c.clone().multiplyScalar(0.55));
export const TANKC = facCol.map((c) => c.clone().lerp(col('#6b6a52'), 0.45));
export const TANKD = TANKC.map((c) => c.clone().multiplyScalar(0.7));
export const DEADC = facCol.map((c) => c.clone().multiplyScalar(0.35));
export const FLAGD = facCol.map((c) => c.clone().multiplyScalar(0.85));
export { mix };
