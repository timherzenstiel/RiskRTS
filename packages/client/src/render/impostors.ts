// Far-zoom infantry as pre-rendered sprite cards (design 1.2, tools/bake/sprites.py): each soldier is one instanced quad in the
// camera plane, cut from an atlas of every nation x 8 facings x 3 frames rendered with the game's camera pitch and sun. With the
// orthographic camera a card of `span` world units centred `cy` above the feet matches the baked projection exactly.
import * as THREE from 'three';
import { GLOBE_GLSL, uGlobe } from './globe';

interface AtlasInfo { cell: number; span: number; cy: number; facings: number; frames: number; rows: number }

export class Impostors {
  ready = false;
  private n = 0;
  private readonly max: number;
  private mesh: THREE.Mesh | null = null;
  private geo: THREE.InstancedBufferGeometry | null = null;
  private mat: THREE.ShaderMaterial | null = null;
  private P!: Float32Array; private C!: Float32Array;
  private info!: AtlasInfo;

  constructor(private readonly parent: THREE.Object3D, max = 30000, base = `${import.meta.env.BASE_URL ?? '/'}art/sprites/`) {
    this.max = max;
    fetch(base + 'atlas.json').then(r => r.json()).then((info: AtlasInfo) => {
      this.info = info;
      new THREE.TextureLoader().load(base + 'infantry.webp', (tex) => { tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; this.build(tex); });
    }).catch((e) => console.warn('Infantry sprites could not be loaded; drawing meshes', e));
  }

  private build(tex: THREE.Texture) {
    const I = this.info, cols = I.facings * I.frames;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.P = new Float32Array(this.max * 4); this.C = new Float32Array(this.max * 2);
    const ip = new THREE.InstancedBufferAttribute(this.P, 4).setUsage(THREE.DynamicDrawUsage), ic = new THREE.InstancedBufferAttribute(this.C, 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', ip); geo.setAttribute('iCell', ic); geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: tex }, uGrid: { value: new THREE.Vector2(cols, I.rows) }, uSpan: { value: I.span }, uCy: { value: I.cy }, uGlobe },
      vertexShader: `${GLOBE_GLSL}
attribute vec4 iPos; attribute vec2 iCell; uniform vec2 uGrid; uniform float uSpan, uCy; varying vec2 vUv;
  void main(){
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float s = iPos.w * uSpan;
    vec3 w = iPos.xyz + vec3(0., uCy * iPos.w, 0.) + right * position.x * s + up * position.y * s;
    vUv = (iCell + vec2(position.x + .5, .5 - position.y)) / uGrid; vUv.y = 1. - vUv.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(globeP(w), 1.);
  }`,
      fragmentShader: `uniform sampler2D uMap; varying vec2 vUv;
  void main(){ vec4 c = texture2D(uMap, vUv); if (c.a < .5) discard; gl_FragColor = vec4(c.rgb, 1.); }`,
    });
    const mesh = new THREE.Mesh(geo, this.mat); mesh.frustumCulled = false; mesh.renderOrder = 2;
    this.parent.add(mesh); this.mesh = mesh; this.geo = geo; this.ready = true;
  }

  begin() { this.n = 0; }

  /** One soldier of faction `f` at (x,y,z) facing `face`, model scale S; frame 0 standing, 1/2 stride. */
  push(x: number, y: number, z: number, face: number, f: number, S: number, frame: number) {
    if (!this.ready || this.n >= this.max || f < 0 || f >= this.info.rows) return;
    const I = this.info, k = ((Math.round(face / (Math.PI * 2 / I.facings)) % I.facings) + I.facings) % I.facings, i = this.n++;
    this.P[i * 4] = x; this.P[i * 4 + 1] = y; this.P[i * 4 + 2] = z; this.P[i * 4 + 3] = S;
    this.C[i * 2] = k * I.frames + frame; this.C[i * 2 + 1] = f;
  }

  end() {
    if (!this.geo) return;
    this.geo.instanceCount = this.n;
    (this.geo.attributes.iPos as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.geo.attributes.iCell as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  dispose() { this.mesh?.removeFromParent(); this.geo?.dispose(); this.mat?.dispose(); (this.mat?.uniforms.uMap.value as THREE.Texture | undefined)?.dispose(); }
}
