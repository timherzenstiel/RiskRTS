// Procedural pixel-art ground for the close-up view, painted in the fragment shader of the smooth surface mesh (detail.ts).
// Command & Conquer / Red Alert 2 look: mottled olive grass worn down to bare earth, pebbles with a lit top-left and a shadow to the
// bottom-right, furrowed fields, dirt tracks with wheel ruts, winding rivers with muddy banks, cobbled towns and striated rock on slopes.
// Everything is snapped to a world-space pixel grid (uPx pixels per unit) so it reads as crisp pixel art at every zoom level.
import * as THREE from 'three';
import { COLS, ROWS, TS } from '@riskrts/shared';
import { facCol } from './palette';
import type { Terrain } from './terrain';
import { uNear } from './terrain';
import { COAST_GLSL } from './coast';
import { BORDER_GLSL } from './borderField';
import { TRENCH_GLSL } from './trenches';
import { uGOn, uGTex, loadGroundTextures } from './groundTex';

/** Pixel density of the painted ground (pixels per world unit), set from the zoom level each frame. */
export const uPx = { value: 128 };

const GLSL = /* glsl */ `
uniform sampler2D uNat, uInfo, uWar, uCoast; uniform vec2 uGrid; uniform float uTS, uPx, uNear; uniform vec3 uFac[8];
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
${COAST_GLSL}
uniform highp sampler2DArray uGTex; uniform float uGOn;
/** Painted texture layer L (groundTex.ts) at p, two scales and a rotation blended by macro noise so it never visibly repeats. */
const float GT_SCALE[6]=float[6](1.7,3.2,2.4,1.6,2.6,1.1);
vec3 gt(float L, vec2 p){
  p*=GT_SCALE[int(L)];
  vec3 a=texture(uGTex,vec3(p,L)).rgb;
  vec2 r=mat2(.8,-.6,.6,.8)*p*.83+vec2(.37,.11); vec3 b=texture(uGTex,vec3(r,L)).rgb;
  return mix(a,b,smoothstep(.35,.65,fbm(p*1.1+L*3.7)));
}
float lum(vec3 c){ return dot(c,vec3(.3,.59,.11)); }
vec3 groundPaint(vec3 wp, vec3 wn){
  vec2 hp=floor(wp.xz*uPx), p=wp.xz;
  float px=h1(hp);
  // smooth, rocky coastline (coast.ts): cut away the sea, paint a broken rock rim and wet sand along the edge
  float cs=coastSd(uCoast,tuv(p))+(fbm(p*9.)-.5)*.28+(n1(p*31.)-.5)*.08;
  if(cs>0.) discard;
  vec2 w=vec2(fbm(p*5.5),fbm(p*5.5+9.3))-.5, q=p+w*uTS*1.1;
  vec4 natC=texture2D(uNat,tuv(p)), infC=texture2D(uInfo,tuv(p));
  if(infC.r<.02) for(int k=0;k<8;k++){ vec2 q2=p+DIRS[k]*uTS*.75; vec4 ni=texture2D(uInfo,tuv(q2)); if(ni.r>.02){ infC=ni; natC=texture2D(uNat,tuv(q2)); break; } }
  vec4 nat=texture2D(uNat,tuv(q)), inf=texture2D(uInfo,tuv(q));
  if(inf.r<.02){ nat=natC; inf=infC; }
  float flC=floor(infC.g*255.+.5), flW=floor(inf.g*255.+.5), bio=floor(inf.r*255./20.+.5)-1.;
  bool field=bit(flW,1.), road=bit(flC,2.), city=bit(flW,4.), river=bit(flC,8.);
  bool green=bio>2.5&&bio<9.5&&bio!=4.; bool sandy=bio==4.||bio==10.; bool snowy=bio<1.5;
  vec3 c=dec(nat.rgb);
  float m=fbm(p*9.), m2=fbm(p*2.2+40.);
  c*=.8+.42*m;
  if(field){
    // per-tile field kind: pasture, crop rows or fresh ploughland
    vec2 ft=floor(q/uTS+uGrid*.5); float kind=h1(floor(ft/2.)+.37);
    float o=bit(flW,32.)?p.x:p.y, s=fract(o*30.+n1(p*3.)*.3);
    if(kind<.3){ c*=.9+.15*m; if(px>.85) c*=1.2; else if(px<.12) c*=.75; }
    else if(kind<.72){ c*=.93+.1*step(.5,s); if(px>.8&&step(.5,s)>.5) c*=1.18; }
    else { c=mix(c,vec3(.11,.08,.05),.3); c*=.85+.2*step(.45,s); c*=.94+.12*px; }
  } else if(green){
    float d=smoothstep(.55,.63,m2+(m-.5)*.3);
    c=mix(c,vec3(.12,.088,.055)*(.85+.5*m),d*.8);
    if(px>.86) c*=1.25; else if(px<.12) c*=.7;
  } else if(sandy){
    c*=.93+.07*sin((p.x*.6+p.y)*46.+m*9.); if(px>.9) c*=1.1;
  } else if(snowy){
    c=mix(c,vec3(.55,.6,.68),.25*(1.-m)); if(px>.93) c*=1.08;
  } else { if(px>.88) c*=1.15; else if(px<.1) c*=.78; }
  // painted textures: grass with worn dirt patches, fields, sand; tinted towards the biome colour so regions keep their character
  if(uGOn>0.&&!snowy){
    vec3 bc=dec(nat.rgb);
    float wd=smoothstep(.5,.66,m2+(m-.5)*.35)+(green?0.:.55);
    vec3 tg0=mix(gt(0.,p),gt(1.,p),clamp(wd,0.,1.)), tc=tg0;
    if(field){
      // patchwork: pasture, green or ripening crops, fresh ploughland; furrows turn from field to field
      float fk=h1(floor(floor(q/uTS+uGrid*.5)/2.)+.37); vec2 fp=bit(flW,32.)?p:p.yx;
      vec3 crop=mix(gt(0.,p),gt(5.,fp),.45);
      tc=fk<.35?gt(0.,p)*vec3(1.05,1.08,.9):fk<.55?crop*vec3(1.,1.12,.85):fk<.72?crop*vec3(1.45,1.3,.75):gt(5.,fp);
    } else if(sandy) tc=gt(4.,p);
    tc=mix(tc, tc*bc/max(.02,lum(bc))*lum(tc), field?.25:.4);
    c=mix(c,tc,uGOn);
  }
  if(city){
    vec3 pav=dec(vec3(.47,.44,.38))*(.85+.25*m);
    vec2 g=fract(p*vec2(26.,52.)+vec2(floor(p.y*52.)*.5,0.));
    pav*=(g.x<.12||g.y<.18)?.72:1.;
    c=mix(c,pav,.35*smoothstep(.45,.7,fbm(p*4.+3.)));
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
    if(d<.19){
      // water: deep blue in the channel, lighter over the shallows, ripples, glints and a thin foam line at the bank
      float k=d/.19; vec3 deep=dec(vec3(.17,.29,.37)), shal=dec(vec3(.33,.45,.46));
      c=mix(deep,shal,smoothstep(.35,1.,k))*(.88+.24*n1(p*vec2(38.,22.)+n1(p*9.)*2.));
      if(h1(floor(p*110.))>.988) c+=dec(vec3(.55));
      c=mix(c,dec(vec3(.66,.68,.6)),smoothstep(.82,.95,k)*smoothstep(.35,.7,n1(p*70.))*.7);
    }
    else if(d<.28){ float k=(d-.19)/.09; c=mix(dec(vec3(.27,.21,.14))*(.8+.3*m),c,smoothstep(.2,1.,k)); if(px>.86&&k>.3) c=dec(vec3(.33,.4,.2)); }
  }
  // rock faces on steep ground: orange-brown strata
  float slope=1.-wn.y;
  if(slope>.22){
    vec3 rock=mix(mix(dec(vec3(.55,.42,.29)),dec(vec3(.33,.27,.2)),n1(p*20.)),gt(3.,p),uGOn);
    rock*=.78+.32*step(.5,fract(wp.y*90.+m*1.5));
    c=mix(c,rock,smoothstep(.22,.4,slope));
  }
  { float sand=smoothstep(-.42,-.2,cs)*(1.-smoothstep(-.14,-.08,cs)); c=mix(c,mix(dec(vec3(.52,.45,.33))*(.8+.3*m),gt(4.,p),uGOn),sand*.6);
    float rim=smoothstep(-.13,-.05,cs); vec3 rk=mix(dec(vec3(.3,.26,.22)),dec(vec3(.55,.5,.42)),n1(p*60.)); float lit=n1(p*45.+vec2(.6,.6))-n1(p*45.);
    rk*=lit>.06?1.25:lit<-.06?.6:.9; c=mix(c,rk,rim*.9); }
  // ---- borders, trenches, wire and no-man's-land from the smooth region field (borderField.ts) ----
  vec2 bt=tuv(p); vec2 ids=bIds(bt); float myR=ids.x, nbR=ids.y;
  if(myR>=0.){
    float bd0=bDist(bt), bn=(n1(p*6.)-.5)*.05, bd=bd0+bn;
    float e=.02; vec2 gr=vec2(bDist(tuv(p+vec2(e,0.)))-bDist(tuv(p-vec2(e,0.))), bDist(tuv(p+vec2(0.,e)))-bDist(tuv(p-vec2(0.,e))));
    vec2 gd=length(gr)>1e-4?normalize(gr):vec2(0.,1.), tg=vec2(-gd.y,gd.x);
    const vec2 SUN=vec2(-.828,-.561);
    float myO=bOwner(myR);
    vec3 fcm=myO>=0.?uFac[int(myO)]:vec3(.5);
    c=mix(c,fcm*.8,.03+.3*(1.-uNear));
    if(nbR>=0.){
      vec4 tb=bTab(myR,nbR), to=bTab(nbR,myR); float lv=floor(tb.r*255./80.+.5), wire=floor(tb.b*255.+.5);
      // no-man's-land: churned mud and crater bowls on both sides of a fought-over border
      float dm=max(tb.g,to.g)*(1.-smoothstep(.15,1.5,bd+(fbm(p*2.5)-.5)*.9));
      if(dm>.01){
        c=mix(c,mix(dec(vec3(.37,.31,.23))*(.7+.45*m),gt(2.,p),uGOn),smoothstep(.05,.6,dm)*.9);
        for(int s=0;s<2;s++){
          float sc=s==0?6.5:17.; vec2 kg=p*sc+float(s)*7.7, ki=floor(kg), kf=fract(kg)-.5-(vec2(h1(ki+1.3),h1(ki+7.1))-.5)*.3;
          float kr=.2+.22*h1(ki+3.), rr=length(kf)/kr;
          if(h1(ki)<dm*dm*(s==0?.45:.5)&&rr<1.35){
            vec2 dir=kf/max(1e-4,length(kf));
            if(rr<1.){ float lit=dot(-dir,SUN)*smoothstep(.15,.9,rr); c=dec(vec3(.27,.22,.16))*(.8+.55*lit)*(.9+.2*m);
              if(h1(ki+9.)>.6&&rr<.42) c=mix(dec(vec3(.2,.23,.22)),dec(vec3(.4,.43,.4)),step(.8,n1(p*90.))); }
            else { float lit=dot(dir,SUN); c=mix(c,dec(vec3(.44,.37,.27))*(1.+.35*lit),.75*(1.35-rr)/.35); }
          }
        }
      }
      // owner line where powers meet, a faint dotted line between regions of one power
      float nbO=bOwner(nbR), lw=mix(.035,.09,1.-uNear);
      if(nbO!=myO){ if(myO>=0.&&bd<lw) c=mix(fcm,vec3(1.),.2)*(bd<lw*.5?1.:.7); }
      else if(bd<lw*.45&&fract(dot(p,tg)*14.)<.5) c=mix(c,vec3(.02),.4);
      // barbed wire belt between the border and the trench: pickets with shadows and criss-cross strands
      if(wire>.5&&bd>.13&&bd<.13+.07*wire){
        float al=dot(p,tg), ac=dot(p,gd);
        float st=min(abs(fract(al*55.+ac*30.)-.5),abs(fract(al*55.-ac*30.)-.5));
        if(st<.07&&n1(p*40.)>.25) c=mix(c,dec(vec3(.12,.11,.1)),.6);
        float pk=fract(al*18.)-.5, pd=bd-.13-.035*wire;
        if(abs(pk)<.06&&abs(pd)<.012) c=dec(vec3(.24,.18,.12));
        else if(pk>.06&&pk<.2&&abs(pd+.012)<.012) c*=.7;
      }
      // fire trench dug in along a held border: crenellated fire bays, parapet, lit and shaded walls, duckboards
      if(lv>.5){
        for(int L=0;L<2;L++){
          if(L==1&&lv<1.5) break;
          float D0=L==0?.42:1.12, hw=trHalf(L,lv);
          float zz=trZig(p,L), sv=bd0-D0-zz, a=abs(sv);
          // the trench itself is a mesh (trenches.ts): cut the ground out where it lies, darken the lip around it
          if(a<hw*.97) discard;
          if(a<hw+.11) c*=.8+.2*smoothstep(hw,hw+.11,a);
          // communication trenches back from the fire trench, at intervals
          if(L==0){ vec2 cc=floor(p*1.6); float pick=h1(cc+.5); vec2 cf=fract(p*1.6)-.5;
            float cx=abs(dot(cf,tg))/1.6*3.;
            if(pick>.55&&cx<.03&&bd>D0+hw&&bd<D0+(lv>1.5?1.12-.06:.75)) c=dec(vec3(.24,.18,.12))*(.75+.35*step(0.,dot(tg,SUN)*sign(dot(cf,tg))));
          }
        }
      }
    }
  }
  return c;
}`;

/** Lambert material whose diffuse colour is painted procedurally from the terrain's per-tile textures. */
export function groundMaterial(terrain: Terrain): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial(), B = terrain.border;
  loadGroundTextures();
  const fac = Array.from({ length: 8 }, (_, i) => (facCol[i] ?? new THREE.Color(1, 1, 1)).clone());
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uNat: { value: terrain.natTex }, uInfo: { value: terrain.infoTex }, uWar: { value: terrain.warTex }, uCoast: { value: terrain.coastTex }, uBDist: { value: B.distTex }, uBId: { value: B.idTex }, uBTab: { value: B.tableTex }, uGrid: { value: new THREE.Vector2(COLS, ROWS) }, uTS: { value: TS },
      uPx, uFac: { value: fac }, uNear, uGTex, uGOn,
    });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWP=(modelMatrix*vec4(transformed,1.)).xyz; vWN=normalize(mat3(modelMatrix)*objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + BORDER_GLSL(B.regions) + TRENCH_GLSL + GLSL)
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = groundPaint(vWP, normalize(vWN));');
  };
  return m;
}
