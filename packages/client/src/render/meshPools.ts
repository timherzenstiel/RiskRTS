// Low-poly unit models from the Blender bake (public/art/units.glb, built by tools/bake/models.py), drawn as one dynamic
// InstancedMesh per model and refilled every frame like the box Pools. COLOR_0 alpha is the house-colour mask: masked paint
// takes the instance's faction tint (shaded by the painted value), the rest keeps its own colour.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { uChrome } from './pools';

export type MeshKey = 'soldier' | 'soldier_kneel' | 'helm_brodie' | 'helm_adrian' | 'helm_cap' | 'helm_stahl' | 'helm_kabalak' |
  'mg' | 'art' | 'tank' | 'plane' | 'prop' | 'pill' | 'bunk';
const CAP: Record<MeshKey, number> = {
  soldier: 14000, soldier_kneel: 6000, helm_brodie: 6000, helm_adrian: 6000, helm_cap: 6000, helm_stahl: 12000, helm_kabalak: 6000,
  mg: 2500, art: 2500, tank: 1500, plane: 800, prop: 800, pill: 1500, bunk: 1000,
};
/** Headgear of each faction (index = faction id), as in models.ts. */
export const HELM_OF: MeshKey[] = ['helm_brodie', 'helm_adrian', 'helm_cap', 'helm_stahl', 'helm_stahl', 'helm_kabalak'];

function unitMaterial(): THREE.MeshPhongMaterial {
  const m = new THREE.MeshPhongMaterial({ shininess: 30, specular: 0x404040, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uChrome = uChrome;
    // keep the vertex colour and the instance tint apart: the tint only applies where the house mask (alpha) is set
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTint;')
      .replace('#include <color_vertex>', '#include <color_vertex>\n  vColor = color;\n  #ifdef USE_INSTANCING_COLOR\n  vTint = instanceColor;\n  #else\n  vTint = vec3(1.);\n  #endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTint; uniform float uChrome;')
      .replace('#include <color_fragment>', `float _l = dot(vColor.rgb, vec3(.3,.59,.11));
  diffuseColor.rgb *= mix(vColor.rgb, vTint * clamp(_l * 4.2, .55, 1.35), vColor.a);
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
  push(x: number, y: number, z: number, face: number, s: number, c: THREE.Color, roll = 0) {
    if (this.n >= this.max) return;
    const i = this.n++, o = i * 16, M = this.M, co = Math.cos(face) * s, si = Math.sin(face) * s;
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
  private readonly mat = unitMaterial();
  ready = false;

  constructor(private readonly parent: THREE.Object3D, url = `${import.meta.env.BASE_URL ?? '/'}art/units.glb`) {
    new GLTFLoader().load(url, (gltf) => {
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        const key = (m.geometry.name || m.name) as MeshKey, name = (Object.keys(CAP) as MeshKey[]).find(k => k === key || k === m.name);
        if (!name || this.pools.has(name)) return;
        const geo = m.geometry.clone(); geo.applyMatrix4(m.matrixWorld);
        this.pools.set(name, new MeshPool(this.parent, geo, this.mat, CAP[name]));
      });
      this.ready = this.pools.has('soldier');
    }, undefined, (e) => console.warn('Unit models could not be loaded; drawing the box models', e));
  }

  has(k: MeshKey) { return this.ready && this.pools.has(k); }
  push(k: MeshKey, x: number, y: number, z: number, face: number, s: number, c: THREE.Color, roll = 0) { this.pools.get(k)?.push(x, y, z, face, s, c, roll); }
  begin() { for (const p of this.pools.values()) p.begin(); }
  end() { for (const p of this.pools.values()) p.end(); }
  dispose() { for (const p of this.pools.values()) { p.dispose(); p.mesh.geometry.dispose(); } this.mat.dispose(); }
}
