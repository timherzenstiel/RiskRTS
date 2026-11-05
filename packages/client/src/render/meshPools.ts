// Low-poly unit models from the Blender bake (public/art/units.glb, built by tools/bake/models.py), drawn as one dynamic
// InstancedMesh per model and refilled every frame like the box Pools. COLOR_0 alpha is the house-colour mask: masked paint
// takes the instance's faction tint (shaded by the painted value), the rest keeps its own colour.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { uChrome } from './pools';

export type MeshKey = 'soldier_aim' | 'soldier_kneel_aim' | 'soldier_throw' | 'soldier_prone' | 'soldier_dead' | 'soldier' | 'soldier_walk_a' | 'soldier_walk_b' | 'soldier_kneel' | 'soldier_lo' | 'soldier_kneel_lo' |
  'helm_brodie' | 'helm_adrian' | 'helm_cap' | 'helm_stahl' | 'helm_kabalak' |
  'mg' | 'art' | 'tank_mk4' | 'tank_ft' | 'tank_a7v' | 'plane' | 'prop' | 'mark_0' | 'mark_1' | 'mark_2' | 'mark_3' | 'mark_4' | 'mark_5' | 'mark_6' |
  'pill' | 'bunk' | 'factory' | 'barracks' | 'hangar' |
  'tree_broad' | 'tree_pine' | 'tree_palm' | 'tree_acacia' | 'shrub' | 'house_a' | 'house_b' | 'church' | 'house_ruin' | 'house_ruin_b';
const CAP: Record<MeshKey, number> = {
  soldier_aim: 3000, soldier_kneel_aim: 2500, soldier_throw: 800, soldier_prone: 3000, soldier_dead: 4000,
  soldier: 3000, soldier_walk_a: 3000, soldier_walk_b: 3000, soldier_kneel: 3000, soldier_lo: 14000, soldier_kneel_lo: 6000,
  helm_brodie: 6000, helm_adrian: 6000, helm_cap: 6000, helm_stahl: 12000, helm_kabalak: 6000,
  mg: 2500, art: 2500, tank_mk4: 800, tank_ft: 800, tank_a7v: 800, plane: 600, prop: 600,
  mark_0: 200, mark_1: 200, mark_2: 200, mark_3: 200, mark_4: 200, mark_5: 200, mark_6: 200,
  pill: 1500, bunk: 1000, factory: 200, barracks: 200, hangar: 200,
  tree_broad: 1, tree_pine: 1, tree_palm: 1, tree_acacia: 1, shrub: 1, house_a: 1, house_b: 1, church: 1, house_ruin: 1, house_ruin_b: 1,
};
/** Static scenery: placed once by the terrain (no per-frame pool). */
const STATIC = new Set<MeshKey>(['tree_broad', 'tree_pine', 'tree_palm', 'tree_acacia', 'shrub', 'house_a', 'house_b', 'church', 'house_ruin', 'house_ruin_b']);
/** Tank of each faction: Mark IV (Britain, Russia, Ottomans), Renault FT (France), A7V (Germany, Austria-Hungary). */
export const TANK_OF: MeshKey[] = ['tank_mk4', 'tank_ft', 'tank_mk4', 'tank_a7v', 'tank_a7v', 'tank_mk4', 'tank_ft'];
/** Headgear of each faction (index = faction id), as in models.ts. */
/** US troops wore the M1917, a copy of the British Brodie. */
export const HELM_OF: MeshKey[] = ['helm_brodie', 'helm_adrian', 'helm_cap', 'helm_stahl', 'helm_stahl', 'helm_kabalak', 'helm_brodie'];

/**
 * `war`: houses (1) and their ruins (2) read the terrain's war texture at the instance position: a house collapses away where the
 * ground is shelled and its ruin twin appears in its place, so towns along a front fall to ruins without rebuilding any mesh.
 */
export const warUniforms = { uWarTex: { value: null as THREE.Texture | null }, uWarGrid: { value: new THREE.Vector4(1, 1, 1, 1) } };
function unitMaterial(war = 0): THREE.MeshPhongMaterial {
  const m = new THREE.MeshPhongMaterial({ shininess: 30, specular: 0x404040, vertexColors: true });
  if (war) m.customProgramCacheKey = () => 'war' + war;
  m.onBeforeCompile = (sh) => {
    if (war) {
      Object.assign(sh.uniforms, warUniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform sampler2D uWarTex; uniform vec4 uWarGrid;')
        .replace('#include <project_vertex>', `#include <project_vertex>
  #ifdef USE_INSTANCING
  { vec2 wp=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xz; vec2 t=(floor(wp/uWarGrid.z+uWarGrid.xy*.5)+.5)/uWarGrid.xy;
    float dmg=texture2D(uWarTex,t).g; bool ruined=dmg>.33;
    if(ruined != ${war === 2 ? 'true' : 'false'}) gl_Position=vec4(0.,0.,-2.,1.); }
  #endif`);
    }
    sh.uniforms.uChrome = uChrome;
    // keep the vertex colour and the instance tint apart: the tint only applies where the house mask (alpha) is set
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTint; varying vec3 vObj;')
      .replace('#include <color_vertex>', '#include <color_vertex>\n  vColor = color; vObj = position;\n  #ifdef USE_INSTANCING_COLOR\n  vTint = instanceColor;\n  #else\n  vTint = vec3(1.);\n  #endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vTint; varying vec3 vObj; uniform float uChrome;
float _gh(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
float _gn(vec3 p){ vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(_gh(i),_gh(i+vec3(1,0,0)),f.x),mix(_gh(i+vec3(0,1,0)),_gh(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(_gh(i+vec3(0,0,1)),_gh(i+vec3(1,0,1)),f.x),mix(_gh(i+vec3(0,1,1)),_gh(i+vec3(1,1,1)),f.x),f.y),f.z); }`)
      .replace('#include <color_fragment>', `float _l = dot(vColor.rgb, vec3(.3,.59,.11));
  diffuseColor.rgb *= mix(vColor.rgb, vTint * clamp(_l * 4.2, .55, 1.35), vColor.a);
  // painted grime: soft blotches and fine speckle in model space, darker low down (mud splashed up from the ground)
  float _g = _gn(vObj*90.)*.6 + _gn(vObj*260.)*.4;
  diffuseColor.rgb *= (.86 + .24*_g) * mix(.82, 1., smoothstep(.0, .05, vObj.y));
  diffuseColor.a = 1.;`)
      .replace('#include <specularmap_fragment>', 'float specularStrength = (1. - vColor.a) * smoothstep(.02,.2,dot(vColor.rgb,vec3(.33))) * uChrome * 2.;');
  };
  return m;
}

class MeshPool {
  readonly mesh: THREE.InstancedMesh;
  n = 0;
  private readonly M: Float32Array;
  private readonly C: Float32Array;
  constructor(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, readonly max: number) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false; this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1)); this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; parent.add(this.mesh);
    this.M = this.mesh.instanceMatrix.array as Float32Array; this.C = this.mesh.instanceColor!.array as Float32Array;
  }
  /** One instance at (x,y,z), turned by `face` about Y, uniform scale s, optional roll about the model's forward axis. */
  push(x: number, y: number, z: number, face: number, s: number, c: THREE.Color, roll = 0, pitch = 0) {
    if (this.n >= this.max) return;
    const i = this.n++, o = i * 16, M = this.M, co = Math.cos(face) * s, si = Math.sin(face) * s;
    if (pitch) {
      // R = RotY(face) * RotX(pitch) * s
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      M[o] = co; M[o + 1] = 0; M[o + 2] = -si; M[o + 3] = 0;
      M[o + 4] = sp * si; M[o + 5] = cp * s; M[o + 6] = sp * co; M[o + 7] = 0;
      M[o + 8] = cp * si; M[o + 9] = -sp * s; M[o + 10] = cp * co; M[o + 11] = 0;
      M[o + 12] = x; M[o + 13] = y; M[o + 14] = z; M[o + 15] = 1;
      const k = i * 3; this.C[k] = c.r; this.C[k + 1] = c.g; this.C[k + 2] = c.b;
      return;
    }
    if (roll) {
      const cr = Math.cos(roll), sr = Math.sin(roll);
      // R = RotY(face) * RotZ(roll) * s
      M[o] = co * cr; M[o + 1] = sr * s; M[o + 2] = -si * cr; M[o + 3] = 0;
      M[o + 4] = -co * sr; M[o + 5] = cr * s; M[o + 6] = si * sr; M[o + 7] = 0;
    } else {
      M[o] = co; M[o + 1] = 0; M[o + 2] = -si; M[o + 3] = 0;
      M[o + 4] = 0; M[o + 5] = s; M[o + 6] = 0; M[o + 7] = 0;
    }
    M[o + 8] = si; M[o + 9] = 0; M[o + 10] = co; M[o + 11] = 0;
    M[o + 12] = x; M[o + 13] = y; M[o + 14] = z; M[o + 15] = 1;
    const k = i * 3; this.C[k] = c.r; this.C[k + 1] = c.g; this.C[k + 2] = c.b;
  }
  begin() { this.n = 0; }
  end() { this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor!.needsUpdate = true; }
  dispose() { this.mesh.removeFromParent(); this.mesh.dispose(); }
}

export class MeshPools {
  private readonly pools = new Map<MeshKey, MeshPool>();
  readonly mat = unitMaterial();
  /** Houses that collapse into ruins on shelled ground, and the ruins that appear there. */
  readonly houseMat = unitMaterial(1); readonly ruinMat = unitMaterial(2);
  ready = false;
  private readonly geos = new Map<MeshKey, THREE.BufferGeometry>();
  /** Geometry of a model (for static instancing elsewhere, e.g. trees and houses in terrain.ts). */
  geometry(k: MeshKey) { return this.geos.get(k) ?? null; }

  constructor(private readonly parent: THREE.Object3D, url = `${import.meta.env.BASE_URL ?? '/'}art/units.glb`) {
    new GLTFLoader().load(url, (gltf) => {
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        const key = (m.geometry.name || m.name) as MeshKey, name = (Object.keys(CAP) as MeshKey[]).find(k => k === key || k === m.name);
        if (!name || this.pools.has(name)) return;
        const geo = m.geometry.clone(); geo.applyMatrix4(m.matrixWorld); this.geos.set(name, geo);
        if (!STATIC.has(name)) this.pools.set(name, new MeshPool(this.parent, geo, this.mat, CAP[name]));
      });
      this.ready = this.pools.has('soldier_lo');
    }, undefined, (e) => console.warn('Unit models could not be loaded; drawing the box models', e));
  }

  has(k: MeshKey) { return this.ready && this.pools.has(k); }
  push(k: MeshKey, x: number, y: number, z: number, face: number, s: number, c: THREE.Color, roll = 0, pitch = 0) { this.pools.get(k)?.push(x, y, z, face, s, c, roll, pitch); }
  begin() { for (const p of this.pools.values()) p.begin(); }
  end() { for (const p of this.pools.values()) p.end(); }
  dispose() { for (const p of this.pools.values()) p.dispose(); for (const g of this.geos.values()) g.dispose(); this.mat.dispose(); }
}
