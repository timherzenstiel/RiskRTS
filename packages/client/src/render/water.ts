// Finely pixel-quantised animated sea: depth from a coast distance field, foam rings along shores, sparkles and a faint grid.
import * as THREE from 'three';
import { COLS, HH, HW, ROWS, TS, type World } from '@riskrts/shared';
import { GLOBE_GLSL, WRAP_K, Z_NORTH_POLE, Z_SOUTH_POLE, uGlobe } from './globe';
import { SUN_DIR } from './camera';
void COLS; void ROWS;

export class Water {
  readonly mesh: THREE.Mesh;
  /** The wide flat sea round the map, only in the flat view. */
  private readonly outer: THREE.Mesh;
  private readonly outerGeo: THREE.PlaneGeometry;
  /** One map width of sea running far past the poles, under the sheet: on a half-rolled globe it fills the polar caps the
   *  map sheet does not reach yet (past a pole it folds into the pole point). */
  private readonly polar: THREE.Mesh;
  private readonly polarGeo: THREE.PlaneGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly tex: THREE.DataTexture;
  private readonly geo: THREE.PlaneGeometry;

  constructor(scene: THREE.Scene, world: World, coast: THREE.DataTexture) {
    void world;
    this.tex = coast;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCoast: { value: this.tex }, uSize: { value: new THREE.Vector2(COLS, ROWS) }, uTS: { value: TS }, uGlobe, uSun: { value: SUN_DIR } },
      vertexShader: `${GLOBE_GLSL}
  varying vec2 vMap; varying vec3 vN; varying float vFace; uniform vec2 uSize; uniform float uTS;
  void main(){ vec4 w=modelMatrix*vec4(position,1.); vMap=vec2(w.x/uTS+uSize.x*.5,w.z/uTS+uSize.y*.5);
    mat3 F; float f; vec3 b=globeBend(w.xyz,F,f); vN=F[1]; vFace=f; gl_Position=projectionMatrix*viewMatrix*vec4(b,1.); }`,
      fragmentShader: `varying vec2 vMap; varying vec3 vN; varying float vFace; uniform vec2 uSize; uniform float uTime, uTS; uniform sampler2D uCoast; uniform vec3 uGlobe, uSun;
  float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
  void main(){
    vec3 deep=vec3(.06,.12,.19);
    vec2 wp=(vMap-uSize*.5)*uTS;
    float gk=uGlobe.y;
    // on the globe: lit from the sun like the land, with a thin blue haze at the rim
    float sh=mix(1., .5+.75*max(dot(normalize(vN),uSun),0.), gk), rim=gk*pow(1.-clamp(vFace,0.,1.),3.)*.55;
    if(vMap.x<0.||vMap.y<0.||vMap.x>uSize.x||vMap.y>uSize.y){
      // past the map's rows: polar sea, pack ice and the Antarctic ice sheet (only seen on the globe)
      float lat=84.-vMap.y*.5, n=vn(wp*1.3)*.5+vn(wp*5.)*.5;
      vec3 c=deep*mix(.6,1.,gk);
      float ice=gk*max(smoothstep(86.5,88.5,lat+n*2.), smoothstep(-63.,-66.,lat-n*3.));
      c=mix(c, vec3(.48,.53,.58)*(.82+.25*n), ice);
      c=c*sh+vec3(.16,.3,.5)*rim;
      gl_FragColor=vec4(pow(c,vec3(2.2)),1.); return; }
    vec2 q=floor(wp*48.)/48.;
    float d=max(0.,(texture2D(uCoast,vMap/uSize).r*255.-40.)/12.);
    vec3 c=mix(vec3(.24,.36,.42),vec3(.12,.22,.31),smoothstep(.3,4.,d)); c=mix(c,deep,smoothstep(5.,18.,d));
    float n=vn(q*1.6+vec2(uTime*.07,uTime*.05))*.6+vn(q*4.+vec2(-uTime*.11,uTime*.09))*.4;
    c*=.93+.14*n;
    float w=sin((q.x*1.3+q.y*.8)*3.1+uTime*.9+n*6.)*.5+.5;
    c+=vec3(.04,.06,.06)*smoothstep(.9,1.,w)*(.5+n);
    float ring=sin(d*1.6-uTime*1.3+n*3.)*.5+.5;
    float foam=smoothstep(.9,.2,d)*smoothstep(.8,.98,ring)*.28+smoothstep(.22,.03,d)*.45;
    foam*=.65+.5*vn(q*7.);
    c=mix(c,vec3(.66,.68,.6),clamp(foam,0.,.6));
    if(h21(floor(wp*26.)+floor(uTime*1.4))>.994&&n>.5) c+=.4;
    vec2 g=abs(fract(wp/6.+.5)-.5)*6.; if(min(g.x,g.y)<.018) c+=vec3(.025,.035,.03);
    c=c*sh+vec3(.16,.3,.5)*rim;
    gl_FragColor=vec4(pow(c,vec3(2.2)),1.);
  }`,
    });
    // pole to pole and all the way round, finely divided so it bends smoothly onto the globe
    const zh = Z_SOUTH_POLE - Z_NORTH_POLE;
    this.geo = new THREE.PlaneGeometry(HW * 2, zh, 360, 120).rotateX(-Math.PI / 2).translate(0, 0, (Z_SOUTH_POLE + Z_NORTH_POLE) / 2);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.position.y = .12; this.mesh.frustumCulled = false;
    this.outerGeo = new THREE.PlaneGeometry(HW * 6, HH * 8).rotateX(-Math.PI / 2);
    this.outer = new THREE.Mesh(this.outerGeo, this.mat); this.outer.position.y = .1;
    this.polarGeo = new THREE.PlaneGeometry(HW * 2, HH * 8, 180, 200).rotateX(-Math.PI / 2);
    this.polar = new THREE.Mesh(this.polarGeo, this.mat); this.polar.position.y = .1; this.polar.frustumCulled = false;
    scene.add(this.mesh, this.outer, this.polar);
    void HH;
  }

  setTime(t: number) { this.mat.uniforms.uTime.value = t; const k = uGlobe.value.y; this.outer.visible = k <= WRAP_K; this.polar.visible = k > WRAP_K && k < .999; }

  dispose() { this.mesh.removeFromParent(); this.outer.removeFromParent(); this.polar.removeFromParent(); this.geo.dispose(); this.outerGeo.dispose(); this.polarGeo.dispose(); this.mat.dispose(); }
}
