import * as THREE from 'three';

export const boxGeo = new THREE.BoxGeometry(1, 1, 1);

/** A dynamic InstancedMesh of unit boxes refilled every frame. All writes go straight into typed arrays. */
export class Pool {
  readonly mesh: THREE.InstancedMesh;
  n = 0;
  private readonly M: Float32Array;
  private readonly C: Float32Array;

  constructor(parent: THREE.Object3D, readonly max: number, mat: THREE.Material, shadow: boolean) {
    this.mesh = new THREE.InstancedMesh(boxGeo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    const ic = this.mesh.instanceColor!; ic.setUsage(THREE.DynamicDrawUsage);
    if (shadow) { this.mesh.castShadow = true; this.mesh.receiveShadow = true; }
    this.mesh.count = 0;
    parent.add(this.mesh);
    this.M = this.mesh.instanceMatrix.array as Float32Array;
    this.C = ic.array as Float32Array;
  }

  begin() { this.n = 0; }

  /** Push one box: centre (x,y,z), size (sx,sy,sz), yaw ry, colour c. */
  push(x: number, y: number, z: number, sx: number, sy: number, sz: number, ry: number, c: THREE.Color) {
    if (this.n >= this.max) return;
    const i = this.n++, o = i * 16, M = this.M, co = Math.cos(ry), si = Math.sin(ry);
    M[o] = co * sx; M[o + 1] = 0; M[o + 2] = -si * sx; M[o + 3] = 0;
    M[o + 4] = 0; M[o + 5] = sy; M[o + 6] = 0; M[o + 7] = 0;
    M[o + 8] = si * sz; M[o + 9] = 0; M[o + 10] = co * sz; M[o + 11] = 0;
    M[o + 12] = x; M[o + 13] = y; M[o + 14] = z; M[o + 15] = 1;
    const k = i * 3; this.C[k] = c.r; this.C[k + 1] = c.g; this.C[k + 2] = c.b;
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  dispose() { this.mesh.removeFromParent(); this.mesh.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

/** Dynamic line segments (army paths, tracers). */
export class LineBatch {
  readonly obj: THREE.LineSegments;
  n = 0;
  private readonly P: Float32Array;
  private readonly C: Float32Array;
  private readonly geo = new THREE.BufferGeometry();

  constructor(parent: THREE.Object3D, readonly max: number) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.P = (this.geo.attributes.position as THREE.BufferAttribute).array as Float32Array;
    this.C = (this.geo.attributes.color as THREE.BufferAttribute).array as Float32Array;
    this.obj = new THREE.LineSegments(this.geo, new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false }));
    this.obj.frustumCulled = false;
    parent.add(this.obj);
  }

  begin() { this.n = 0; }

  add(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: THREE.Color) {
    if (this.n >= this.max) return;
    const o = this.n++ * 6, P = this.P, C = this.C;
    P[o] = x0; P[o + 1] = y0; P[o + 2] = z0; P[o + 3] = x1; P[o + 4] = y1; P[o + 5] = z1;
    C[o] = C[o + 3] = c.r; C[o + 1] = C[o + 4] = c.g; C[o + 2] = C[o + 5] = c.b;
  }

  end() {
    this.geo.setDrawRange(0, this.n * 2);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() { this.obj.removeFromParent(); this.geo.dispose(); (this.obj.material as THREE.Material).dispose(); }
}
