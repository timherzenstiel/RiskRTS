// The classic shroud (design §1.4): fog of war drawn over the map from each region's visibility.
//  - own / full view (3): clear
//  - observed across the border (1): ground visible under a 50 % ordered-dither shadow
//  - scouted, the report is stale (2): the same shadow with a sepia wash
//  - unknown (0): a near-black shroud (the coast still shows faintly) with a soft, noise-eroded ragged edge
// A single plane hovers above everything on the map (terrain, trees, towns, troops) and samples a per-tile visibility texture,
// shifted along the fixed camera pitch so the shroud lines up with the ground under it. Open sea next to a region takes its value.
import * as THREE from 'three';
import { COLS, HH, HW, N, ROWS, TS, type GameState, type World } from '@riskrts/shared';
import { PITCH } from './camera';

const H = 2.2;              // plane height
const GROUND = .38;         // typical ground height the shift is computed for
const REACH = 3;            // sea tiles out from the coast that follow the region's fog

export class Shroud {
  readonly mesh: THREE.Mesh;
  private readonly data = new Uint8Array(N);
  private readonly tex: THREE.DataTexture;
  private readonly mat: THREE.ShaderMaterial;
  private readonly geo: THREE.PlaneGeometry;
  /** Tiles that follow each region (its land plus nearby sea). */
  private readonly tilesOf: Int32Array[];
  private readonly cur: Int8Array;

  constructor(scene: THREE.Scene, world: World) {
    const src = new Int32Array(N).fill(-1), depth = new Uint8Array(N), q: number[] = [];
    for (let i = 0; i < N; i++) if (world.land[i]) { src[i] = world.terrOf[i]; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h]; if (depth[i] >= REACH) continue; const c = i % COLS;
      for (const j of [c > 0 ? i - 1 : -1, c < COLS - 1 ? i + 1 : -1, i >= COLS ? i - COLS : -1, i + COLS < N ? i + COLS : -1])
        if (j >= 0 && src[j] < 0) { src[j] = src[i]; depth[j] = depth[i] + 1; q.push(j); }
    }
    const lists: number[][] = world.regions.map(() => []);
    for (let i = 0; i < N; i++) if (src[i] >= 0) lists[src[i]].push(i);
    this.tilesOf = lists.map(l => Int32Array.from(l));
    this.cur = new Int8Array(world.regions.length).fill(-1);
    this.data.fill(255);
    this.tex = new THREE.DataTexture(this.data, COLS, ROWS, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter; this.tex.needsUpdate = true;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: { uVis: { value: this.tex }, uGrid: { value: new THREE.Vector2(COLS, ROWS) }, uShift: { value: (H - GROUND) / Math.tan(PITCH) }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vXZ; void main(){ vec4 w=modelMatrix*vec4(position,1.); vXZ=w.xz; gl_Position=projectionMatrix*viewMatrix*w; }',
      fragmentShader: `varying vec2 vXZ; uniform sampler2D uVis; uniform vec2 uGrid; uniform float uShift, uTime;
  float h1(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float n1(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h1(i),h1(i+vec2(1,0)),f.x),mix(h1(i+vec2(0,1)),h1(i+vec2(1,1)),f.x),f.y); }
  float fbm(vec2 p){ return n1(p)*.5+n1(p*2.1+7.)*.26+n1(p*4.3+3.)*.14+n1(p*9.1+1.)*.1; }
  void main(){
    vec2 g=vec2(vXZ.x, vXZ.y-uShift);
    // domain warp of about a tile, so tile edges never show as blocks up close
    vec2 wq=vec2(fbm(g*1.7),fbm(g*1.7+11.3))-.5;
    vec2 t=((g+wq*${(TS * 2.2).toFixed(4)})/${TS.toFixed(6)}+uGrid*.5)/uGrid;
    if(t.x<0.||t.y<0.||t.x>1.||t.y>1.) discard;
    float v=texture2D(uVis,t).r*3.;
    float n=fbm(g*2.3+uTime*.02)-.5;
    float black=1.-smoothstep(.3,.62,v+n*.55);
    float dim=1.-smoothstep(2.2,2.85,v+n*.35);
    float stale=smoothstep(1.4,1.9,v)*(1.-smoothstep(2.4,2.8,v));
    vec2 fc=floor(gl_FragCoord.xy); float ck=mod(fc.x+fc.y,2.);
    vec3 col=mix(vec3(0.),vec3(.16,.11,.05),stale);
    float a=max(black*.84, dim*(.22+.3*ck));
    // ragged rim: a thin darker fringe just outside the black
    a=max(a, (1.-smoothstep(.62,.9,v+n*.55))*.55*ck);
    if(a<.01) discard;
    gl_FragColor=vec4(mix(col,vec3(0.),black),a);
  }`,
    });
    this.geo = new THREE.PlaneGeometry(HW * 2, HH * 2 + 4).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.position.set(0, H, (H - GROUND) / Math.tan(PITCH));
    this.mesh.renderOrder = 50; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Refresh the visibility texture for regions whose visibility changed. */
  update(g: GameState | null, t: number) {
    this.mat.uniforms.uTime.value = t;
    if (!g) return;
    let dirty = false;
    for (let r = 0; r < this.cur.length; r++) {
      const v = (g.regions[r]?.vis ?? 3) as number;
      if (v === this.cur[r]) continue;
      this.cur[r] = v; dirty = true;
      const val = Math.round(v * 85);
      for (const i of this.tilesOf[r]) this.data[i] = val;
    }
    if (dirty) this.tex.needsUpdate = true;
  }

  dispose() { this.mesh.removeFromParent(); this.geo.dispose(); this.mat.dispose(); this.tex.dispose(); }
}
