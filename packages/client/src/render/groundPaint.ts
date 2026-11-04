// Procedural pixel-art ground for the close-up view, painted in the fragment shader of the smooth surface mesh (detail.ts).
// Command & Conquer / Red Alert 2 look: mottled olive grass worn down to bare earth, pebbles with a lit top-left and a shadow to the
// bottom-right, furrowed fields, dirt tracks with wheel ruts, winding rivers with muddy banks, cobbled towns and striated rock on slopes.
// Everything is snapped to a world-space pixel grid (uPx pixels per unit) so it reads as crisp pixel art at every zoom level.
import * as THREE from 'three';
import { COLS, ROWS, TS } from '@riskrts/shared';
import { facCol } from './palette';
import type { Terrain } from './terrain';
import { uNear } from './terrain';

/** Pixel density of the painted ground (pixels per world unit), set from the zoom level each frame. */
export const uPx = { value: 128 };

const GLSL = /* glsl */ `
uniform sampler2D uNat, uInfo; uniform vec2 uGrid; uniform float uTS, uPx, uNear; uniform vec3 uFac[8];
varying vec3 vWP; varying vec3 vWN;
const vec2 DIRS[8] = vec2[8](vec2(1,0),vec2(-1,0),vec2(0,1),vec2(0,-1),vec2(1,1),vec2(-1,1),vec2(1,-1),vec2(-1,-1));
float h1(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float n1(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h1(i),h1(i+vec2(1,0)),f.x),mix(h1(i+vec2(0,1)),h1(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ return n1(p)*.5+n1(p*2.03+17.)*.27+n1(p*4.1+31.)*.15+n1(p*8.3+5.)*.08; }
vec2 tuv(vec2 w){ return (w/uTS+uGrid*.5)/uGrid; }
bool bit(float f,float b){ return mod(floor(f/b),2.)>.5; }
vec3 dec(vec3 c){ return pow(c,vec3(2.2)); }
float flagsAt(vec2 t){ return floor(texture2D(uInfo,(t+.5)/uGrid).g*255.+.5); }
/** Distance (in tiles) from local tile point f to the network (road or river) that joins tile t to its neighbours with flag b. */
float netDist(vec2 t, vec2 f, float b){
  float d=length(f); bool any=false;
  for(int k=0;k<8;k++){
    vec2 o=DIRS[k];
    if(!bit(flagsAt(t+o),b)) continue;
    if(k>3 && (bit(flagsAt(t+vec2(o.x,0.)),b) || bit(flagsAt(t+vec2(0.,o.y)),b))) continue;
    vec2 dn=normalize(o); float al=dot(f,dn);
    if(al>0.) d=min(d,abs(f.x*dn.y-f.y*dn.x));
    any=true;
  }
  return any?d:length(f)*.8;
}
vec3 groundPaint(vec3 wp, vec3 wn){
  vec2 hp=floor(wp.xz*uPx), p=(hp+.5)/uPx;
  float px=h1(hp);
  vec2 w=vec2(fbm(p*5.5),fbm(p*5.5+9.3))-.5, q=p+w*uTS*1.1;
  vec4 natC=texture2D(uNat,tuv(p)), infC=texture2D(uInfo,tuv(p));
  vec4 nat=texture2D(uNat,tuv(q)), inf=texture2D(uInfo,tuv(q));
  if(inf.r<.02){ nat=natC; inf=infC; }
  float flC=floor(infC.g*255.+.5), flW=floor(inf.g*255.+.5), bio=floor(inf.r*255./20.+.5)-1.;
  bool field=bit(flC,1.), road=bit(flC,2.), city=bit(flW,4.), river=bit(flC,8.);
  bool green=bio>2.5&&bio<9.5&&bio!=4.; bool sandy=bio==4.||bio==10.; bool snowy=bio<1.5;
  vec3 c=dec(field?natC.rgb:nat.rgb);
  float m=fbm(p*9.), m2=fbm(p*2.2+40.);
  c*=.8+.42*m;
  if(field){
    // per-tile field kind: pasture, crop rows or fresh ploughland
    vec2 ft=floor(p/uTS+uGrid*.5); float kind=h1(floor(ft/2.)+.37);
    float o=bit(flC,32.)?p.x:p.y, s=fract(o*30.+n1(p*3.)*.3);
    if(kind<.3){ c*=.9+.15*m; if(px>.85) c*=1.2; else if(px<.12) c*=.75; }
    else if(kind<.72){ c*=.86+.2*step(.5,s); if(px>.8&&step(.5,s)>.5) c*=1.18; }
    else { c=mix(c,vec3(.11,.08,.05),.45); c*=.72+.4*step(.45,s); c*=.94+.12*px; }
  } else if(green){
    float d=smoothstep(.55,.63,m2+(m-.5)*.3);
    c=mix(c,vec3(.12,.088,.055)*(.85+.5*m),d*.8);
    if(px>.86) c*=1.25; else if(px<.12) c*=.7;
  } else if(sandy){
    c*=.93+.07*sin((p.x*.6+p.y)*46.+m*9.); if(px>.9) c*=1.1;
  } else if(snowy){
    c=mix(c,vec3(.55,.6,.68),.25*(1.-m)); if(px>.93) c*=1.08;
  } else { if(px>.88) c*=1.15; else if(px<.1) c*=.78; }
  if(city){
    vec3 pav=dec(vec3(.47,.44,.38))*(.85+.25*m);
    vec2 g=fract(p*vec2(26.,52.)+vec2(floor(p.y*52.)*.5,0.));
    pav*=(g.x<.12||g.y<.18)?.72:1.;
    c=mix(c,pav,.85);
  }
  // pebbles: lit from the top-left, shadow to the bottom-right
  float dens=field||city?0.:bio==2.?.34:sandy?.2:(bio==7.||bio==8.||bio==3.)?.15:snowy?.04:.07;
  vec2 cg=p*34., ci=floor(cg), cf=fract(cg)-.5-(vec2(h1(ci),h1(ci+3.1))-.5)*.4;
  float pr=.12+.17*h1(ci+7.7);
  if(h1(ci+11.3)<dens){
    if(length(cf)<pr){ vec3 pc=mix(vec3(.16,.17,.19),vec3(.26,.21,.15),h1(ci+2.)); float sd=cf.x+cf.y; pc*=sd<-.05?1.6:(sd>.07?.62:1.); c=pc; }
    else if(length(cf-vec2(.08))<pr) c*=.62;
  }
  vec2 tc=p/uTS+uGrid*.5, t=floor(tc), f=tc-t-.5;
  f+=(vec2(n1(p*13.),n1(p*13.+5.))-.5)*.16;
  if(road){
    float d=netDist(t,f,2.);
    if(d<.16){
      // dirt road with a railway on a gravel bed down its middle
      vec3 dirt=dec(vec3(.45,.38,.27))*(.8+.35*m); c=mix(c,dirt,smoothstep(.16,.12,d)); if(abs(d-.1)<.02) c*=.68;
      if(d<.065){ c=dec(vec3(.4,.38,.34))*(.75+.4*px); if(fract((p.x-p.y)*uPx*.25)<.34) c=dec(vec3(.24,.17,.11)); }
      if(abs(d-.032)<.009) c=dec(vec3(.62,.62,.6))*(px>.5?1.:.8);
    }
  }
  if(river){
    float d=netDist(t,f,8.);
    if(d<.19){ c=vec3(.03,.05,.055)*(.9+.3*m); if(px>.95) c+=.05; if(d>.15) c=mix(c,vec3(.12,.13,.11),.6); }
    else if(d<.28){ c=mix(c,vec3(.06,.05,.035),.65); if(px>.8) c=dec(vec3(.33,.4,.2)); }
  }
  // rock faces on steep ground: orange-brown strata
  float slope=1.-wn.y;
  if(slope>.12){
    vec3 rock=mix(dec(vec3(.55,.42,.29)),dec(vec3(.33,.27,.2)),n1(p*20.));
    rock*=.78+.32*step(.5,fract(wp.y*90.+m*1.5));
    c=mix(c,rock,smoothstep(.12,.28,slope));
  }
  // ownership: a tint that fades as you zoom in, a solid line in the owner's colour where owners meet, a dark dashed line between regions
  vec2 g=tc-t-.5; float own=floor(natC.a*255.+.5), reg=floor(infC.b*255.+.5)+256.*floor(infC.a*255.+.5);
  vec3 fc=own>.5?uFac[int(own)-1]:vec3(.5);
  if(own>.5) c=mix(c,fc*.8,.06+.3*(1.-uNear));
  float eo=1., er=1.;
  for(int k=0;k<4;k++){
    vec2 o=DIRS[k], uv=(t+.5+o)/uGrid; vec4 ni=texture2D(uInfo,uv); if(ni.r<.02) continue;
    float nr=floor(ni.b*255.+.5)+256.*floor(ni.a*255.+.5); if(nr==reg) continue;
    float no=floor(texture2D(uNat,uv).a*255.+.5), e=.5-dot(g,o);
    if(no!=own) eo=min(eo,e); else er=min(er,e);
  }
  float lw=mix(.05,.11,1.-uNear);
  if(er<lw*.6 && fract((p.x+p.y)*9.)<.6) c=mix(c,vec3(.02),.55);
  if(own>.5 && eo<lw) c=mix(fc,vec3(1.),.15)*(eo<lw*.5?1.:.6);
  return c;
}`;

/** Lambert material whose diffuse colour is painted procedurally from the terrain's per-tile textures. */
export function groundMaterial(terrain: Terrain): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial();
  const fac = Array.from({ length: 8 }, (_, i) => (facCol[i] ?? new THREE.Color(1, 1, 1)).clone());
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uNat: { value: terrain.natTex }, uInfo: { value: terrain.infoTex }, uGrid: { value: new THREE.Vector2(COLS, ROWS) }, uTS: { value: TS },
      uPx, uFac: { value: fac }, uNear,
    });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWP=(modelMatrix*vec4(transformed,1.)).xyz; vWN=normalize(mat3(modelMatrix)*objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL)
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = groundPaint(vWP, normalize(vWN));');
  };
  return m;
}
