// Painted ground textures for the close-up view (grass, dirt, mud, rock, sand, field): tileable, pre-lit in the style of a 90s
// pre-rendered RTS, loaded from public/art/ground into one texture array. Until they arrive (or if they fail) the ground shader
// keeps its procedural colours, so `uGOn` fades them in.
import * as THREE from 'three';

export const GROUND_LAYERS = ['grass', 'dirt', 'mud', 'rock', 'sand', 'field', 'sandbags', 'planks'] as const;
const SIZE = 1024;

export const uGTex: { value: THREE.Texture } = { value: placeholder() };
export const uGOn = { value: 0 };

function placeholder() {
  const t = new THREE.DataArrayTexture(new Uint8Array(4 * GROUND_LAYERS.length).fill(128), 1, 1, GROUND_LAYERS.length);
  t.needsUpdate = true; return t;
}

let started = false;
/** Start loading the textures once; safe to call more than once. */
export function loadGroundTextures(base = `${import.meta.env.BASE_URL ?? '/'}art/ground/`) {
  if (started || typeof document === 'undefined') return; started = true;
  const cv = document.createElement('canvas'); cv.width = cv.height = SIZE;
  const cx = cv.getContext('2d', { willReadFrequently: true }); if (!cx) return;
  const data = new Uint8Array(SIZE * SIZE * 4 * GROUND_LAYERS.length);
  Promise.all(GROUND_LAYERS.map((n, i) => new Promise<void>((ok, bad) => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { cx.clearRect(0, 0, SIZE, SIZE); cx.drawImage(im, 0, 0, SIZE, SIZE); data.set(cx.getImageData(0, 0, SIZE, SIZE).data, i * SIZE * SIZE * 4); ok(); };
    im.onerror = () => bad(new Error('ground texture ' + n));
    im.src = `${base}${n}.webp`;
  }))).then(() => {
    const t = new THREE.DataArrayTexture(data, SIZE, SIZE, GROUND_LAYERS.length);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
    t.needsUpdate = true;
    const old = uGTex.value; uGTex.value = t; old.dispose();
    const t0 = performance.now(), fade = () => { uGOn.value = Math.min(1, (performance.now() - t0) / 400); if (uGOn.value < 1) requestAnimationFrame(fade); };
    fade();
  }).catch((e) => console.warn(e));
}
