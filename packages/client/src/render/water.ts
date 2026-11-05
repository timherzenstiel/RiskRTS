// Pixel-quantised animated sea: depth from a coast distance field, foam rings along shores, sparkles and a faint grid.
import * as THREE from 'three';
import { COLS, HH, HW, ROWS, TS, type World } from '@riskrts/shared';

export class Water {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly tex: THREE.DataTexture;
  private readonly geo: THREE.PlaneGeometry;

  constructor(scene: THREE.Scene, world: World) {
    // Smooth coast distance (in tiles) at 3x the tile resolution: the land mask is bilinearly smoothed (rounding the tile
    // corners) and a two-pass chamfer transform measures the distance, so depth bands and foam rings follow the coast in curves.
    const SS = 3, CW = COLS * SS, CH = ROWS * SS, D = new Float32Array(CW * CH), INF = 1e6;
    const L = (c: number, r: number) => (c >= 0 && c < COLS && r >= 0 && r < ROWS && world.land[r * COLS + c]) ? 1 : 0;
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      const fx = (x + .5) / SS - .5, fy = (y + .5) / SS - .5, c0 = Math.floor(fx), r0 = Math.floor(fy), tx = fx - c0, ty = fy - r0;
      const v = (L(c0, r0) * (1 - tx) + L(c0 + 1, r0) * tx) * (1 - ty) + (L(c0, r0 + 1) * (1 - tx) + L(c0 + 1, r0 + 1) * tx) * ty;
      D[y * CW + x] = v >= .5 ? 0 : INF;
    }
    const d1 = 1, d2 = Math.SQRT2;
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      const i = y * CW + x; let v = D[i]; if (!v) continue;
      if (x > 0) v = Math.min(v, D[i - 1] + d1);
      if (y > 0) { v = Math.min(v, D[i - CW] + d1); if (x > 0) v = Math.min(v, D[i - CW - 1] + d2); if (x < CW - 1) v = Math.min(v, D[i - CW + 1] + d2); }
      D[i] = v;
    }
    for (let y = CH - 1; y >= 0; y--) for (let x = CW - 1; x >= 0; x--) {
      const i = y * CW + x; let v = D[i]; if (!v) continue;
      if (x < CW - 1) v = Math.min(v, D[i + 1] + d1);
      if (y < CH - 1) { v = Math.min(v, D[i + CW] + d1); if (x < CW - 1) v = Math.min(v, D[i + CW + 1] + d2); if (x > 0) v = Math.min(v, D[i + CW - 1] + d2); }
      D[i] = v;
    }
    const coast = new Uint8Array(CW * CH);
    for (let i = 0; i < CW * CH; i++) coast[i] = Math.min(255, Math.round(D[i] / SS * 12));
    this.tex = new THREE.DataTexture(coast, CW, CH, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter; this.tex.needsUpdate = true;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCoast: { value: this.tex }, uSize: { value: new THREE.Vector2(COLS, ROWS) }, uTS: { value: TS } },
      vertexShader: `varying vec2 vMap; uniform vec2 uSize; uniform float uTS; void main(){ vec4 w=modelMatrix*vec4(position,1.); vMap=vec2(w.x/uTS+uSize.x*.5,w.z/uTS+uSize.y*.5); gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `varying vec2 vMap; uniform vec2 uSize; uniform float uTime, uTS; uniform sampler2D uCoast;
  float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
  void main(){
    vec3 deep=vec3(.075,.11,.135);
    vec2 wp=(vMap-uSize*.5)*uTS;
    if(vMap.x<0.||vMap.y<0.||vMap.x>uSize.x||vMap.y>uSize.y){ gl_FragColor=vec4(pow(deep*.6,vec3(2.2)),1.); return; }
    vec2 q=floor(wp*16.)/16.;
    float d=texture2D(uCoast,vMap/uSize).r*255./12.;
    vec3 c=mix(vec3(.2,.29,.28),vec3(.13,.21,.24),smoothstep(.3,4.,d)); c=mix(c,deep,smoothstep(5.,18.,d));
    float n=vn(q*2.2+vec2(uTime*.07,uTime*.05))*.6+vn(q*5.5+vec2(-uTime*.11,uTime*.09))*.4;
    c*=.9+.2*n;
    float w=sin((q.x*1.3+q.y*.8)*3.1+uTime*.9+n*6.)*.5+.5;
    c+=vec3(.04,.06,.06)*smoothstep(.9,1.,w)*(.5+n);
    float ring=sin(d*1.6-uTime*1.3+n*3.)*.5+.5;
    float foam=smoothstep(.9,.2,d)*smoothstep(.8,.98,ring)*.28+smoothstep(.22,.03,d)*.45;
    foam*=.65+.5*h21(floor(q*5.));
    c=mix(c,vec3(.66,.68,.6),clamp(foam,0.,.6));
    if(h21(floor(wp*26.)+floor(uTime*1.4))>.994&&n>.5) c+=.4;
    vec2 g=abs(fract(wp/6.+.5)-.5)*6.; if(min(g.x,g.y)<.018) c+=vec3(.025,.035,.03);
    gl_FragColor=vec4(pow(c,vec3(2.2)),1.);
  }`,
    });
    this.geo = new THREE.PlaneGeometry(HW * 6, HH * 8).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.position.y = .12;
    scene.add(this.mesh);
  }

  setTime(t: number) { this.mat.uniforms.uTime.value = t; }

  dispose() { this.mesh.removeFromParent(); this.geo.dispose(); this.mat.dispose(); this.tex.dispose(); }
}
