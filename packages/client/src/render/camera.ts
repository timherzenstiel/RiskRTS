// Command & Conquer style camera: orthographic, fixed steep pitch, no rotation. `dist` sets the zoom (visible height ~ dist * .69).
// The sun shines from the top-left of the screen, so shadows fall down and to the right like C&C sprites. Also drives the shadow frustum.
import * as THREE from 'three';
import { HH, HW } from '@riskrts/shared';
import { clamp, lerp } from './util';

export const MIN_DIST = 1.1, MAX_DIST = 170;
export const SUN_DIR = new THREE.Vector3(-.62, 1, -.42).normalize();
/** Camera elevation (radians above the horizon): steep three-quarter top-down view. */
export const PITCH = .8;
/** Half the visible height per unit of `dist` (matches the old 38-degree perspective at the focus). */
const HALF = .344;
const BACK = 160;

export class CameraRig {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, BACK * 2 + 60);
  readonly sun = new THREE.DirectionalLight(0xf6e8c8, 2.9);
  readonly hemi = new THREE.HemisphereLight(0xd2d0c2, 0x3a3226, 1.05);
  private aspect = 1;
  /** Current (smoothed) and goal focus/distance. */
  tx = 12; tz = -16; dist = 70; gx = 12; gz = -16; gdist = 70;
  private readonly ray = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -.5);
  private readonly ndc = new THREE.Vector2();
  private readonly hit = new THREE.Vector3();
  private shadowSize: number;

  constructor(scene: THREE.Scene, shadowMapSize: number) {
    this.shadowSize = shadowMapSize;
    scene.add(this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize); this.sun.shadow.bias = -.0004;
  }

  setAspect(aspect: number) { this.aspect = aspect; }

  /** Advance towards the goal. `pan` is a unit-ish keyboard vector (x right, z down). */
  update(dt: number, panX: number, panZ: number) {
    const sp = this.dist * .9 * dt;
    this.gx = clamp(this.gx + panX * sp, -HW, HW); this.gz = clamp(this.gz + panZ * sp, -HH, HH);
    const k = 1 - Math.exp(-dt * 7);
    this.tx = lerp(this.tx, this.gx, k); this.tz = lerp(this.tz, this.gz, k); this.dist = lerp(this.dist, this.gdist, k);
    const cam = this.camera, hh = this.dist * HALF, hw = hh * this.aspect;
    cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh; cam.updateProjectionMatrix();
    cam.position.set(this.tx, .5 + BACK * Math.sin(PITCH), this.tz + BACK * Math.cos(PITCH));
    cam.lookAt(this.tx, .5, this.tz); cam.updateMatrixWorld();
    const S = clamp(this.dist * .8, 3, 95), sc = this.sun.shadow.camera, texel = 2 * S / this.shadowSize;
    const fx = Math.round(this.tx / texel) * texel, fz = Math.round(this.tz / texel) * texel;
    sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S; sc.near = 1; sc.far = 140; sc.updateProjectionMatrix();
    this.sun.target.position.set(fx, 0, fz); this.sun.position.set(fx + SUN_DIR.x * 70, SUN_DIR.y * 70, fz + SUN_DIR.z * 70); this.sun.target.updateMatrixWorld();
    this.sun.shadow.normalBias = texel * 1.2;
  }

  flyTo(x: number, z: number, d?: number) { this.gx = clamp(x, -HW, HW); this.gz = clamp(z, -HH, HH); if (d) this.gdist = clamp(d, MIN_DIST, MAX_DIST); }
  /** Snap with no easing (first frame). */
  snap() { this.tx = this.gx; this.tz = this.gz; this.dist = this.gdist; }

  /** Intersect a client-space point with the ground plane. Returns false if the ray misses (above the horizon). */
  screenToWorld(clientX: number, clientY: number, rect: DOMRect, out: THREE.Vector3): boolean {
    this.ndc.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return false;
    out.copy(this.hit); return true;
  }

  /** World-space corners of the visible map for the minimap, or null if the horizon is visible. */
  viewPolygon(): [number, number][] | null {
    const out: [number, number][] = [];
    for (const [nx, ny] of [[-1, 1], [1, 1], [1, -1], [-1, -1]] as const) {
      this.ndc.set(nx, ny); this.ray.setFromCamera(this.ndc, this.camera);
      if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return null;
      out.push([clamp(this.hit.x, -HW * 1.2, HW * 1.2), clamp(this.hit.z, -HH * 1.4, HH * 1.4)]);
    }
    return out;
  }

  /** World -> CSS pixels. Returns depth in z (>1 means behind the far plane). */
  project(x: number, y: number, z: number, w: number, h: number, out: { x: number; y: number; z: number }, v: THREE.Vector3) {
    v.set(x, y, z).project(this.camera); out.x = (v.x + 1) / 2 * w; out.y = (1 - v.y) / 2 * h; out.z = v.z;
  }

  dispose() { this.sun.shadow.map?.dispose(); }
}
