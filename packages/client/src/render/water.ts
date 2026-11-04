// Pixel-quantised animated sea: depth from a coast distance field, foam rings along shores, sparkles and a faint grid.
import * as THREE from 'three';
import { COLS, HH, HW, N, ROWS, TS, type World } from '@riskrts/shared';

export class Water {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly tex: THREE.DataTexture;
  private readonly geo: THREE.PlaneGeometry;

  constructor(scene: THREE.Scene, world: World) {
    const coast = new Uint8Array(N).fill(20), q: number[] = [], nb = [0, 0, 0, 0];
    for (let i = 0; i < N; i++) if (world.land[i]) { coast[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], d = coast[i]; if (d >= 16) continue;
      const c = i % COLS; nb[0] = c > 0 ? i - 1 : -1; nb[1] = c < COLS - 1 ? i + 1 : -1; nb[2] = i >= COLS ? i - COLS : -1; nb[3] = i + COLS < N ? i + COLS : -1;
      for (const j of nb) if (j >= 0 && coast[j] > d + 1) { coast[j] = d + 1; q.push(j); }
    }
    this.tex = new THREE.DataTexture(coast, COLS, ROWS, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter; this.tex.needsUpdate = true;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCoast: { value: this.tex }, uSize: { value: new THREE.Vector2(COLS, ROWS) }, uTS: { value: TS } },
      vertexShader: `varying vec2 vMap; uniform vec2 uSize; uniform float uTS; void main(){ vec4 w=modelMatrix*vec4(position,1.); vMap=vec2(w.x/uTS+uSize.x*.5,w.z/uTS+uSize.y*.5); gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `varying vec2 vMap; uniform vec2 uSize; uniform float uTime, uTS; uniform sampler2D uCoast;
  float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
  void main(){
    vec3 deep=vec3(.035,.085,.13);
    vec2 wp=(vMap-uSize*.5)*uTS;
    if(vMap.x<0.||vMap.y<0.||vMap.x>uSize.x||vMap.y>uSize.y){ gl_FragColor=vec4(pow(deep*.6,vec3(2.2)),1.); return; }
    vec2 q=floor(wp*16.)/16.;
    float d=texture2D(uCoast,vMap/uSize).r*255.;
    vec3 c=mix(vec3(.26,.46,.46),vec3(.1,.22,.29),smoothstep(1.,6.,d)); c=mix(c,deep,smoothstep(5.,18.,d));
    float n=vn(q*2.2+vec2(uTime*.07,uTime*.05))*.6+vn(q*5.5+vec2(-uTime*.11,uTime*.09))*.4;
    c*=.9+.2*n;
    float w=sin((q.x*1.3+q.y*.8)*3.1+uTime*.9+n*6.)*.5+.5;
    c+=vec3(.04,.06,.06)*smoothstep(.9,1.,w)*(.5+n);
    float ring=sin(d*1.6-uTime*1.3+n*3.)*.5+.5;
    float foam=smoothstep(3.2,.5,d)*smoothstep(.62,.95,ring)*.9+smoothstep(1.3,.2,d)*.55;
    foam*=.65+.5*h21(floor(q*5.));
    c=mix(c,vec3(.86,.91,.87),clamp(foam,0.,.8));
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
