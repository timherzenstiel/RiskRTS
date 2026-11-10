// Command & Conquer style camera: orthographic, fixed steep pitch, no rotation. `dist` sets the zoom (visible height ~ dist * .69).
// The sun shines from the top-left of the screen, so shadows fall down and to the right like C&C sprites. Also drives the shadow frustum.
import * as THREE from 'three';
import { HH, HW } from '@riskrts/shared';
import { clamp, lerp, smooth } from './util';
import { GLOBE, R0, WRAP_K, ZEQ } from './globe';

/** Closest zoom: a few battalions fill the view (closer, the painted ground breaks into tiles). */
export const MIN_DIST = 7.5, MAX_DIST = 210;
/** The map starts rolling into a globe at GLOBE_A and is a closed globe from GLOBE_B (the Theatre band's resting zoom). */
export const GLOBE_A = 80, GLOBE_B = 150;

/** Zoom bands (design §2): what the world draws at each distance. `at` is where a band key flies to. */
export const BANDS = [
  { key: 'z', name: 'Theatre', min: 90, max: MAX_DIST, at: 150 },
  { key: 'x', name: 'Front', min: 30, max: 90, at: 55 },
  { key: 'c', name: 'Battle', min: 13, max: 30, at: 18 },
  { key: 'v', name: 'Close', min: MIN_DIST, max: 13, at: MIN_DIST },
] as const;
export type Band = 0 | 1 | 2 | 3;
export const bandOf = (dist: number): Band => dist >= 90 ? 0 : dist >= 30 ? 1 : dist >= 13 ? 2 : 3;
export const SUN_DIR = new THREE.Vector3(-.62, 1, -.42).normalize();
/** Camera elevation (radians above the horizon): steep three-quarter top-down view. */
export const PITCH = .8;
/** Half the visible height per unit of `dist` (matches the old 38-degree perspective at the focus). */
const HALF = .344;
const BACK = 160;
const TILT = Math.PI / 2 - PITCH, SIN_P = Math.sin(PITCH), COS_P = Math.cos(PITCH);

export class CameraRig {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, BACK * 2 + 60);
  readonly sun = new THREE.DirectionalLight(0xf6e8c8, 2.9);
  readonly hemi = new THREE.HemisphereLight(0xd8d6c8, 0x463c2c, 1.3);
  private aspect = 1;
  /** Current (smoothed) and goal focus/distance. */
  tx = 12; tz = -16; dist = 70; gx = 12; gz = -16; gdist = 70;
  private readonly ray = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -.5);
  private readonly ndc = new THREE.Vector2();
  private readonly hit = new THREE.Vector3();
  private shadowSize: number;
  /** Globe curvature: 0 flat .. 1 closed globe (see globe.ts). */
  k = 0;
  private readonly sph = new THREE.Vector3();

  constructor(scene: THREE.Scene, shadowMapSize: number) {
    this.shadowSize = shadowMapSize;
    scene.add(this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize); this.sun.shadow.bias = -.0004;
  }

  setAspect(aspect: number) { this.aspect = aspect; }

  /** Advance towards the goal. `pan` is a unit-ish keyboard vector (x right, z down). */
  update(dt: number, panX: number, panZ: number) {
    const sp = this.dist * .9 * dt;
    const gk = smooth(GLOBE_A, GLOBE_B, this.gdist);
    this.gx += panX * sp; this.gz = clamp(this.gz + panZ * sp, -HH, HH);
    if (gk > .2 || this.k > .2) {
      // a (mostly) closed globe spins freely round: wrap east-west, carrying the eased focus along
      if (this.gx > HW) { this.gx -= 2 * HW; this.tx -= 2 * HW; } else if (this.gx < -HW) { this.gx += 2 * HW; this.tx += 2 * HW; }
    } else this.gx = clamp(this.gx, -HW, HW);
    // keep the flat view on the map: the visible ground half-height is hh / sin(pitch); a map smaller than the view stays centred
    if (gk < .05) { const vz = this.gdist * HALF / Math.sin(PITCH), lim = HH + 2 - vz; this.gz = lim > 0 ? clamp(this.gz, -lim - .5, lim + .5) : 0; }
    const e = 1 - Math.exp(-dt * 7);
    this.tx = lerp(this.tx, this.gx, e); this.tz = lerp(this.tz, this.gz, e); this.dist = lerp(this.dist, this.gdist, e);
    this.k = smooth(GLOBE_A, GLOBE_B, this.dist); if (this.k < .001) this.k = 0;
    GLOBE.x = this.tx; GLOBE.y = this.k; GLOBE.z = this.tz;
    const cam = this.camera, hh = this.dist * HALF, hw = hh * this.aspect;
    cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh; cam.updateProjectionMatrix();
    cam.position.set(this.tx, .5 + BACK * Math.sin(PITCH), this.tz + BACK * Math.cos(PITCH));
    cam.lookAt(this.tx, .5, this.tz); cam.updateMatrixWorld();
    const S = clamp(this.dist * .8, 3, 120), sc = this.sun.shadow.camera, texel = 2 * S / this.shadowSize;
    const fx = Math.round(this.tx / texel) * texel, fz = Math.round(this.tz / texel) * texel;
    sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S; sc.near = 1; sc.far = 200; sc.updateProjectionMatrix();
    this.sun.target.position.set(fx, 0, fz); this.sun.position.set(fx + SUN_DIR.x * 70, SUN_DIR.y * 70, fz + SUN_DIR.z * 70); this.sun.target.updateMatrixWorld();
    this.sun.shadow.normalBias = texel * 1.2;
  }

  flyTo(x: number, z: number, d?: number) {
    x = clamp(x, -HW, HW);
    // on the globe, spin the short way round
    if (this.k > .2) { if (x - this.gx > HW) x -= 2 * HW; else if (x - this.gx < -HW) x += 2 * HW; }
    this.gx = x; this.gz = clamp(z, -HH, HH); if (d) this.gdist = clamp(d, MIN_DIST, MAX_DIST);
  }
  /** Snap with no easing (first frame). */
  snap() { this.tx = this.gx; this.tz = this.gz; this.dist = this.gdist; this.k = smooth(GLOBE_A, GLOBE_B, this.dist); GLOBE.x = this.tx; GLOBE.y = this.k; GLOBE.z = this.tz; }

  /** Bend a flat world point onto the globe (mirror of globeBend in globe.ts). Returns how squarely it faces the camera (-1..1). */
  bend(x: number, y: number, z: number, out: THREE.Vector3): number {
    const k = this.k; if (k < .001) { out.set(x, y, z); return 1; }
    let ddx = x - this.tx; if (k > WRAP_K) ddx -= 2 * HW * Math.floor((ddx + HW) / (2 * HW));
    const R = R0 / k, lon = ddx / R, lat = clamp((ZEQ - z) / R, -Math.PI / 2, Math.PI / 2), latF = (ZEQ - this.tz) / R, ct = k * TILT, th = latF - Math.PI / 2 + ct;
    const c = Math.cos(th), s = Math.sin(th), cl = Math.cos(lat), dx = cl * Math.sin(lon), dy0 = Math.sin(lat), dz0 = cl * Math.cos(lon);
    const dy = dy0 * c - dz0 * s, dz = dy0 * s + dz0 * c, cy = Math.cos(ct), cz = Math.sin(ct);
    out.set(this.tx + (R + y) * dx, .5 + (R + y) * dy - (R + .5) * cy, this.tz + (R + y) * dz - (R + .5) * cz);
    return dy * SIN_P + dz * COS_P;
  }

  /** Intersect a client-space point with the ground plane. Returns false if the ray misses (above the horizon). */
  screenToWorld(clientX: number, clientY: number, rect: DOMRect, out: THREE.Vector3): boolean {
    this.ndc.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    if (this.k >= .001) return this.globeHit(out);
    if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return false;
    out.copy(this.hit); return true;
  }

  /** Ray against the globe sphere (at ground level y = .5), then back to flat map coordinates. False off the globe or in the gap of a half-rolled map. */
  private globeHit(out: THREE.Vector3): boolean {
    const k = this.k, R = R0 / k, Rs = R + .5, ct = k * TILT, c = this.sph.set(this.tx, .5 - Rs * Math.cos(ct), this.tz - Rs * Math.sin(ct));
    if (!this.ray.ray.intersectSphere(new THREE.Sphere(c, Rs), this.hit)) return false;
    const vx = (this.hit.x - c.x) / Rs, vy = (this.hit.y - c.y) / Rs, vz = (this.hit.z - c.z) / Rs;
    const th = (ZEQ - this.tz) / R - Math.PI / 2 + ct, co = Math.cos(th), si = Math.sin(th);
    const dy = vy * co + vz * si, dz = -vy * si + vz * co;
    const lat = Math.asin(clamp(dy, -1, 1)), lon = Math.atan2(vx, dz);
    const ddx = lon * R, z = ZEQ - lat * R;
    // the map sheet spans one map width round the focus (all the way round once closed); the rest is the gap
    if (k > WRAP_K ? Math.abs(ddx) > HW + 1e-3 : this.tx + ddx < -HW - 1e-3 || this.tx + ddx > HW + 1e-3) return false;
    let x = this.tx + ddx; if (x > HW) x -= 2 * HW; else if (x < -HW) x += 2 * HW;
    out.set(x, .5, z); return true;
  }

  /** World-space corners of the visible map for the minimap, or null if the horizon is visible. */
  viewPolygon(): [number, number][] | null {
    const out: [number, number][] = [];
    if (this.k >= .001) {
      // on the globe: the front hemisphere around the focus
      const R = R0 / this.k, w = Math.min(HW, R * Math.PI / 2), h = Math.min(HH * 1.4, R * Math.PI / 2);
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) out.push([clamp(this.tx + sx * w, -HW * 1.2, HW * 1.2), clamp(this.tz + sz * h, -HH * 1.4, HH * 1.4)]);
      return out;
    }
    for (const [nx, ny] of [[-1, 1], [1, 1], [1, -1], [-1, -1]] as const) {
      this.ndc.set(nx, ny); this.ray.setFromCamera(this.ndc, this.camera);
      if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return null;
      out.push([clamp(this.hit.x, -HW * 1.2, HW * 1.2), clamp(this.hit.z, -HH * 1.4, HH * 1.4)]);
    }
    return out;
  }

  /** World -> CSS pixels. Returns depth in z (>1 means behind the far plane). */
  project(x: number, y: number, z: number, w: number, h: number, out: { x: number; y: number; z: number }, v: THREE.Vector3) {
    const f = this.bend(x, y, z, v);
    v.project(this.camera); out.x = (v.x + 1) / 2 * w; out.y = (1 - v.y) / 2 * h; out.z = f < .22 ? 2 : v.z;
  }

  dispose() { this.sun.shadow.map?.dispose(); }
}
