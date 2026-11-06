// Theatre-zoom globe: past the Front band the flat map rolls up into a sphere. The map is equirectangular (half a degree per
// tile, lat 84..-57), so x/z map straight to longitude/latitude. Every vertex is bent on the GPU (the project_vertex chunk is
// patched once for all built-in materials; the few raw shader materials call globeBend themselves), so terrain, units, water
// and borders all stay the real 3D scene. Shadow passes never get the uniform, so they render flat, which is what the flat
// world-space shadow lookups expect. The same maths runs in JS for picking and for placing the HTML labels.
//
// Bend: curvature k (0 flat .. 1 closed globe), radius R = R0 / k with R0 = HW / pi (the map spans exactly 360 degrees).
// lon = (x - focusX) / R, lat = (zEq - z) / R. The sphere is turned so the focus sits on top, then tipped towards the camera by
// k * (90 deg - pitch), and placed so the focus point does not move: at k = 1 the camera looks straight at the globe.
import * as THREE from 'three';
import { HH, HW, wzLat } from '@riskrts/shared';

export const R0 = HW / Math.PI;
export const ZEQ = wzLat(0);
/** Camera pitch (kept in sync with camera.ts). */
const PITCH = .8;
const TILT = Math.PI / 2 - PITCH;
/** Plain object (not a Vector3) so three's uniform cloning shares it by reference across every built-in material: x, z focus; y = k. */
export const GLOBE = { x: 0, y: 0, z: 0 };
/** Curvature from which the map wraps round the focus (below it a seam triangle would still show above the sea). */
export const WRAP_K = .02;
export const uGlobe = { value: GLOBE };

export const GLOBE_GLSL = /* glsl */`
uniform vec3 uGlobe;
// bends a flat world point onto the globe; F turns flat world directions (x east, y up, z south) into the bent frame; face = facing the camera
vec3 globeBend(vec3 p, out mat3 F, out float face){
  float k=uGlobe.y;
  if(k<.001){ F=mat3(1.); face=1.; return p; }
  // past a little curvature the map wraps round the focus, so its seam sits on the far side of the globe
  float dx=p.x-uGlobe.x; if(k>${WRAP_K}) dx-=${(2*HW).toFixed(4)}*floor((dx+${HW.toFixed(4)})/${(2*HW).toFixed(4)});
  float R=${R0.toFixed(5)}/k, lon=dx/R, lat=clamp((${ZEQ.toFixed(5)}-p.z)/R,-1.5707963,1.5707963), latF=(${ZEQ.toFixed(5)}-uGlobe.z)/R;
  float ct=k*${TILT.toFixed(5)}, th=latF-1.5707963+ct, c=cos(th), s=sin(th);
  float cl=cos(lat), sl=sin(lat), co=cos(lon), so=sin(lon);
  vec3 d=vec3(cl*so, sl, cl*co), e=vec3(co, 0., -so), n=vec3(-sl*so, cl, -sl*co);
  mat3 Rx=mat3(1.,0.,0., 0.,c,s, 0.,-s,c);
  d=Rx*d; e=Rx*e; n=Rx*n;
  F=mat3(e, d, -n);
  face=dot(d, vec3(0., ${Math.sin(PITCH).toFixed(5)}, ${Math.cos(PITCH).toFixed(5)}));
  vec3 cv=vec3(0., cos(ct), sin(ct));
  return vec3(uGlobe.x, .5, uGlobe.z)+(R+p.y)*d-(R+.5)*cv;
}
// dx of p from the focus after the wrap (shroud seam test)
float globeDx(float x){ float dx=x-uGlobe.x; if(uGlobe.y>${WRAP_K}) dx-=${(2*HW).toFixed(4)}*floor((dx+${HW.toFixed(4)})/${(2*HW).toFixed(4)}); return dx; }
vec3 globeP(vec3 p){ mat3 F; float f; return globeBend(p, F, f); }
`;

const PROJECT = /* glsl */`
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
if ( uGlobe.y > .001 ) {
  mat3 gF; float gFace;
  vec3 gW = globeBend( ( modelMatrix * mvPosition ).xyz, gF, gFace );
  mvPosition = viewMatrix * vec4( gW, 1.0 );
  #ifdef GLOBE_VN
  vNormal = normalize( mat3( viewMatrix ) * ( gF * ( transformedNormal * mat3( viewMatrix ) ) ) );
  #endif
} else mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

let installed = false;
/** Patch three's shader chunks once, before any material compiles. */
export function installGlobe() {
  if (installed) return; installed = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.common = C.common + '\n' + GLOBE_GLSL;
  C.project_vertex = PROJECT;
  C.normal_pars_vertex = C.normal_pars_vertex.replace('#ifndef FLAT_SHADED', '#ifndef FLAT_SHADED\n#define GLOBE_VN');
  // every built-in material except the shadow depth passes shares the one uniform object
  for (const [name, lib] of Object.entries(THREE.ShaderLib)) if (name !== 'depth' && name !== 'distance') (lib.uniforms as Record<string, THREE.IUniform>).uGlobe = uGlobe;
}
installGlobe();

/** Starfield and atmosphere behind the globe; both fade in with k and face the camera. */
export class GlobeBackdrop {
  private readonly stars: THREE.Points;
  private readonly halo: THREE.Mesh;
  private readonly haloMat: THREE.ShaderMaterial;
  private readonly starMat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    const n = 2600, p = new Float32Array(n * 3), s = new Float32Array(n);
    let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) { p[i * 3] = (r() - .5) * 2; p[i * 3 + 1] = (r() - .5) * 2; p[i * 3 + 2] = 0; s[i] = r() ** 6; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(p, 3)); sg.setAttribute('aS', new THREE.BufferAttribute(s, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 }, uScale: { value: new THREE.Vector2(1, 1) } }, transparent: true, depthWrite: false, toneMapped: false,
      vertexShader: 'attribute float aS; uniform vec2 uScale; varying float vS; void main(){ vS=aS; gl_Position=vec4(position.xy,.9999,1.); gl_PointSize=1.+aS*2.2; }',
      fragmentShader: 'uniform float uA; varying float vS; void main(){ gl_FragColor=vec4(vec3(.75,.8,.95)*(.35+vS*1.6),uA); }',
    });
    this.stars = new THREE.Points(sg, this.starMat); this.stars.frustumCulled = false; this.stars.renderOrder = -10;
    this.haloMat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 }, uIn: { value: .8 } }, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vP; void main(){ vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `uniform float uA, uIn; varying vec2 vP;
  void main(){ float r=length(vP)*2.; if(r>1.) discard;
    float g=r<uIn ? 0. : pow(1.-(r-uIn)/(1.-uIn), 2.2);
    gl_FragColor=vec4(vec3(.35,.6,1.)*g*uA*.9, 1.); }`,
    });
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.haloMat); this.halo.frustumCulled = false; this.halo.renderOrder = -5;
    scene.add(this.stars, this.halo);
  }

  update(cam: THREE.OrthographicCamera, k: number, focusX: number, focusZ: number) {
    const on = k > .02;
    this.stars.visible = this.halo.visible = on; if (!on) return;
    this.starMat.uniforms.uA.value = smoothK(k, .25, 1);
    // halo: a camera-facing disc at the globe centre, just larger than the sphere; the front hemisphere hides its middle
    const R = R0 / k, ct = k * TILT, Rs = R + .5;
    this.halo.position.set(focusX, .5 - Rs * Math.cos(ct), focusZ - Rs * Math.sin(ct));
    this.halo.quaternion.copy(cam.quaternion);
    const out = Rs * 1.13; this.halo.scale.set(out * 2, out * 2, 1);
    this.haloMat.uniforms.uIn.value = Rs / out * .985;
    this.haloMat.uniforms.uA.value = smoothK(k, .55, 1);
  }

  dispose() { this.stars.removeFromParent(); this.halo.removeFromParent(); this.stars.geometry.dispose(); this.halo.geometry.dispose(); this.starMat.dispose(); this.haloMat.dispose(); }
}
const smoothK = (k: number, a: number, b: number) => { const t = Math.min(1, Math.max(0, (k - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Latitude edges of the map in world z: the water sheet runs on to the poles so the globe closes. */
export const Z_NORTH_POLE = wzLat(90), Z_SOUTH_POLE = wzLat(-90);
void HH;
