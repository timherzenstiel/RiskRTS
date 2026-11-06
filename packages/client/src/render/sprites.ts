// Volumetric-looking effects without boxes: camera-facing sprites shaded from a baked "cauliflower" puff atlas.
//  - Smoke & dust: each puff carries a normal map baked from a cluster of spheres, lit by the real sun direction,
//    so it has a bright sunlit side, a shaded underside and lumpy billows. Puffs erode into wisps as they age and
//    can glow from inside (fresh explosion smoke lit by its own fire).
//  - Fire: additive flame tongues and fireballs driven by scrolling noise through a black-body colour ramp (feeds bloom).
//  - Decals: scorched craters lying flat on the ground, optionally with glowing embers.
// All three are instanced quads refilled every frame; smoke is depth-sorted back to front.
import * as THREE from 'three';
import { SUN_DIR } from './camera';
import { GLOBE_GLSL, uGlobe } from './globe';

const CELL = 128, ATLAS = CELL * 2, NOISE = 64;

// ---------------------------------------------------------------- baked textures

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

/** Tileable value-noise fbm (period NOISE) in 0..1. */
function makeNoise(): Float32Array {
  const R = rng(91), out = new Float32Array(NOISE * NOISE);
  let amp = .5, tot = 0;
  for (let per = 4; per <= 32; per *= 2) {
    const lat = Float32Array.from({ length: per * per }, () => R());
    for (let y = 0; y < NOISE; y++) for (let x = 0; x < NOISE; x++) {
      const fx = x / NOISE * per, fy = y / NOISE * per, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const L = (i: number, j: number) => lat[((j % per + per) % per) * per + ((i % per + per) % per)];
      const a = L(ix, iy) + (L(ix + 1, iy) - L(ix, iy)) * sx, b = L(ix, iy + 1) + (L(ix + 1, iy + 1) - L(ix, iy + 1)) * sx;
      out[y * NOISE + x] += (a + (b - a) * sy) * amp;
    }
    tot += amp; amp *= .5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

function noiseTexture(n: Float32Array) {
  const d = new Uint8Array(NOISE * NOISE * 4);
  for (let i = 0; i < n.length; i++) { const v = Math.round(n[i] * 255); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(d, NOISE, NOISE, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

/** 2x2 atlas of billowing puffs: RGB = normal (view facing), A = density. Each puff is a cluster of spheres plus fine noise. */
function puffTexture(noise: Float32Array) {
  const d = new Uint8Array(ATLAS * ATLAS * 4), h = new Float32Array(CELL * CELL);
  const nz = (x: number, y: number) => noise[(((y | 0) % NOISE + NOISE) % NOISE) * NOISE + (((x | 0) % NOISE + NOISE) % NOISE)];
  for (let cell = 0; cell < 4; cell++) {
    const R = rng(1000 + cell * 77), balls: [number, number, number][] = [];
    const nb = 7 + Math.floor(R() * 4);
    for (let i = 0; i < nb; i++) {
      const a = R() * 6.283, rr = i === 0 ? 0 : .12 + R() * .38, cx = Math.cos(a) * rr, cy = Math.sin(a) * rr * .85 - .04;
      balls.push([cx, cy, Math.min(.95 - Math.hypot(cx, cy), i === 0 ? .55 : .22 + R() * .26)]);
    }
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const px = (x + .5) / CELL * 2 - 1, py = (y + .5) / CELL * 2 - 1;
      let m = 0;
      for (const [cx, cy, r] of balls) { const q = r * r - (px - cx) ** 2 - (py - cy) ** 2; if (q > 0) m = Math.max(m, Math.sqrt(q)); }
      const det = nz(x * .9 + cell * 17, y * .9) * .55 + nz(x * 2.1 + 5, y * 2.1 + cell * 9) * .45;
      h[y * CELL + x] = m > 0 ? m + (det - .5) * .14 : 0;
    }
    const ox = (cell % 2) * CELL, oy = Math.floor(cell / 2) * CELL, st = 2 / CELL;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const H = (i: number, j: number) => h[Math.min(CELL - 1, Math.max(0, j)) * CELL + Math.min(CELL - 1, Math.max(0, i))];
      const v = H(x, y), gx = (H(x + 1, y) - H(x - 1, y)) / (2 * st), gy = (H(x, y + 1) - H(x, y - 1)) / (2 * st);
      let nx = -gx, ny = -gy, nzz = 1; const l = Math.hypot(nx, ny, nzz); nx /= l; ny /= l; nzz /= l;
      const det = nz(x * 1.3 + cell * 31, y * 1.3 + 11);
      const dens = v <= 0 ? 0 : Math.min(1, Math.max(0, (v / .5) * (.7 + det * .5)));
      const o = ((oy + y) * ATLAS + ox + x) * 4;
      d[o] = Math.round((nx * .5 + .5) * 255); d[o + 1] = Math.round((ny * .5 + .5) * 255); d[o + 2] = Math.round((nzz * .5 + .5) * 255);
      d[o + 3] = Math.round(dens * 255);
    }
  }
  const t = new THREE.DataTexture(d, ATLAS, ATLAS, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- shaders

const HEAD = `${GLOBE_GLSL}
attribute vec3 iPos; attribute vec2 iSize; attribute vec4 iCol; attribute vec4 iMisc;
varying vec2 vP; varying vec4 vCol; varying vec4 vMisc;`;

/** Camera-facing quad; pushed toward the camera by half its size so puffs sitting on the ground are not cut by it. */
const BILLBOARD = `${HEAD}
void main(){
  vP=position.xy; vCol=iCol; vMisc=iMisc;
  float c=cos(iMisc.x), s=sin(iMisc.x);
  vec2 q=position.xy*iSize; q=vec2(c*q.x-s*q.y, s*q.x+c*q.y);
  vec4 mv=viewMatrix*vec4(globeP((modelMatrix*vec4(iPos,1.)).xyz),1.);
  mv.xy+=q; mv.z+=max(iSize.x,iSize.y)*.5;
  gl_Position=projectionMatrix*mv;
}`;

/** Quad lying flat on the ground (decals). */
const FLAT = `${HEAD}
void main(){
  vP=position.xy; vCol=iCol; vMisc=iMisc;
  float c=cos(iMisc.x), s=sin(iMisc.x);
  vec2 q=position.xy*iSize; q=vec2(c*q.x-s*q.y, s*q.x+c*q.y);
  gl_Position=projectionMatrix*viewMatrix*vec4(globeP(iPos+vec3(q.x,0.,-q.y)),1.);
}`;

const ATLAS_UV = `vec2 cellUv(vec2 p, float seed){ float cell=floor(fract(seed)*4.); return ((p+.5)*.96+.02+vec2(mod(cell,2.),floor(cell/2.)))*.5; }`;

const SMOKE_FRAG = `uniform sampler2D uPuff; uniform vec3 uSunV, uSunC, uAmbC, uHeatC;
varying vec2 vP; varying vec4 vCol; varying vec4 vMisc;
${ATLAS_UV}
void main(){
  vec4 t=texture2D(uPuff, cellUv(vP, vMisc.y));
  float age=vMisc.z, heat=vMisc.w;
  // erode into wisps with age: only the densest billows survive
  float thr=age*age*.7;
  float a=smoothstep(thr, thr+.3+age*.15, t.a)*vCol.a;
  if(a<.004) discard;
  vec3 n=t.xyz*2.-1.;
  float c=cos(vMisc.x), s=sin(vMisc.x); n.xy=vec2(c*n.x-s*n.y, s*n.x+c*n.y); n=normalize(n);
  float lam=clamp(dot(n,uSunV)*.6+.4,0.,1.);
  // thin edges let light through, thick cores self-shadow
  float thick=smoothstep(.2,1.,t.a);
  vec3 col=vCol.rgb*(uAmbC*(.8+.2*n.y)*(1.-thick*.25) + uSunC*lam*lam*(1.-thick*.15));
  // fire inside fresh smoke: the core glows from within, strongest underneath
  float h=heat*smoothstep(.15,.85,t.a)*(1.2-n.y*.4);
  col=mix(col, uHeatC*(1.+h*2.5), clamp(h,0.,1.));
  gl_FragColor=vec4(col*a, a);
}`;

const FIRE_FRAG = `uniform sampler2D uPuff, uNoise; uniform float uTime;
varying vec2 vP; varying vec4 vCol; varying vec4 vMisc;
${ATLAS_UV}
vec3 ramp(float f){
  vec3 c=mix(vec3(.45,.04,.0), vec3(1.,.36,.04), smoothstep(0.,.4,f));
  c=mix(c, vec3(1.,.76,.3), smoothstep(.4,.75,f));
  return mix(c, vec3(1.,.97,.86), smoothstep(.78,1.,f));
}
void main(){
  vec2 p=vP*2.; float kind=vMisc.w, age=vMisc.z, sd=vMisc.y*7.31;
  float r2=dot(p,p);
  if(kind<.5){
    // glow: muzzle flash, spark, ember, tracer round
    float g=exp(-r2*4.5);
    if(g<.01) discard;
    vec3 c=vCol.rgb*g*2.2 + vec3(1.,.95,.85)*exp(-r2*18.)*1.2;
    gl_FragColor=vec4(c*vCol.a, 0.); return;
  }
  float f;
  if(kind<1.5){
    // flame tongue: noise rising through a teardrop that narrows to the top
    float y=p.y*.5+.5;
    float n=texture2D(uNoise, vec2(vP.x*.7+sd, vP.y*.55-uTime*1.25+sd*.37)).r*.62
          + texture2D(uNoise, vec2(vP.x*1.7-sd, vP.y*1.35-uTime*2.3)).r*.38;
    float w=mix(.95,.18,y);
    float sh=1.-length(vec2(p.x/w, (p.y+.35)*.72));
    f=clamp((sh+(n-.5)*1.25-y*.2)*2.,0.,1.);
  } else {
    // fireball: a billowing puff burning out from the edges inward
    vec4 t=texture2D(uPuff, cellUv(vP, vMisc.y));
    float n=texture2D(uNoise, vP*.8+vec2(sd, -uTime*.6)).r;
    f=clamp((t.a*1.25+(n-.5)*.8-age*1.05)*1.7,0.,1.);
  }
  if(f<.01) discard;
  vec3 c=ramp(f)*f*2.3*vCol.a*mix(vec3(1.), vCol.rgb*1.3, .2);
  gl_FragColor=vec4(c, 0.);
}`;

const DECAL_FRAG = `uniform sampler2D uPuff, uNoise; uniform float uTime;
varying vec2 vP; varying vec4 vCol; varying vec4 vMisc;
${ATLAS_UV}
void main(){
  vec4 t=texture2D(uPuff, cellUv(vP, vMisc.y));
  float n=texture2D(uNoise, vP*1.4+vMisc.y*5.).r, n2=texture2D(uNoise, vP*3.1-vMisc.y*3.).r;
  float d=t.a*.9+(n-.5)*.45+(1.-length(vP*2.))*.25;
  float a=smoothstep(.06,.3,d)*vCol.a;
  if(a<.004) discard;
  // ash rim, charred centre, a dark lip where the crater wall faces away from the sun
  vec3 c=mix(vCol.rgb*1.7, vCol.rgb*.45, smoothstep(.25,.75,d));
  c*=.85+n2*.3;
  // glowing embers in a burning crater
  float e=vMisc.z*smoothstep(.45,.85,d)*smoothstep(.55,.8,n2)*(.75+.25*sin(uTime*7.+n*20.));
  gl_FragColor=vec4(c*a+vec3(1.,.3,.04)*e*1.5*a, a);
}`;

// ---------------------------------------------------------------- batches

class SpriteBatch {
  n = 0;
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly attrs: THREE.InstancedBufferAttribute[];
  // staging (unsorted) data
  private readonly P: Float32Array; private readonly S: Float32Array; private readonly C: Float32Array; private readonly M: Float32Array;
  private readonly key: Float32Array; private readonly idx: Uint32Array;

  constructor(parent: THREE.Object3D, readonly max: number, mat: THREE.ShaderMaterial, order: number, private readonly sort: boolean) {
    const q = new THREE.PlaneGeometry(1, 1);
    this.geo.index = q.index; this.geo.setAttribute('position', q.attributes.position);
    const mk = (name: string, k: number) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * k), k); a.setUsage(THREE.DynamicDrawUsage); this.geo.setAttribute(name, a); return a; };
    this.attrs = [mk('iPos', 3), mk('iSize', 2), mk('iCol', 4), mk('iMisc', 4)];
    this.P = new Float32Array(max * 3); this.S = new Float32Array(max * 2); this.C = new Float32Array(max * 4); this.M = new Float32Array(max * 4);
    this.key = new Float32Array(max); this.idx = new Uint32Array(max);
    this.geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = order;
    parent.add(this.mesh);
  }

  begin() { this.n = 0; }

  push(x: number, y: number, z: number, w: number, h: number, c: THREE.Color, a: number, rot: number, seed: number, age: number, extra: number) {
    if (this.n >= this.max || !(a > 0) || !Number.isFinite(x + y + z + w + h + a + rot + seed + age + extra)) return;
    const i = this.n++;
    this.P[i * 3] = x; this.P[i * 3 + 1] = y; this.P[i * 3 + 2] = z;
    this.S[i * 2] = w; this.S[i * 2 + 1] = h;
    this.C[i * 4] = c.r; this.C[i * 4 + 1] = c.g; this.C[i * 4 + 2] = c.b; this.C[i * 4 + 3] = a;
    this.M[i * 4] = rot; this.M[i * 4 + 1] = seed; this.M[i * 4 + 2] = age; this.M[i * 4 + 3] = extra;
  }

  /** Upload; when sorting, far sprites go first so nearer smoke covers them. `fwd` is the camera's view direction. */
  end(fwd: THREE.Vector3) {
    const n = this.n, [aP, aS, aC, aM] = this.attrs;
    const P = aP.array as Float32Array, S = aS.array as Float32Array, C = aC.array as Float32Array, M = aM.array as Float32Array;
    const idx = this.idx;
    for (let i = 0; i < n; i++) idx[i] = i;
    if (this.sort && n > 1) {
      const key = this.key;
      for (let i = 0; i < n; i++) key[i] = this.P[i * 3] * fwd.x + this.P[i * 3 + 1] * fwd.y + this.P[i * 3 + 2] * fwd.z;
      idx.subarray(0, n).sort((a, b) => key[b] - key[a]);
    }
    for (let j = 0; j < n; j++) {
      const i = idx[j];
      P[j * 3] = this.P[i * 3]; P[j * 3 + 1] = this.P[i * 3 + 1]; P[j * 3 + 2] = this.P[i * 3 + 2];
      S[j * 2] = this.S[i * 2]; S[j * 2 + 1] = this.S[i * 2 + 1];
      C[j * 4] = this.C[i * 4]; C[j * 4 + 1] = this.C[i * 4 + 1]; C[j * 4 + 2] = this.C[i * 4 + 2]; C[j * 4 + 3] = this.C[i * 4 + 3];
      M[j * 4] = this.M[i * 4]; M[j * 4 + 1] = this.M[i * 4 + 1]; M[j * 4 + 2] = this.M[i * 4 + 2]; M[j * 4 + 3] = this.M[i * 4 + 3];
    }
    for (const a of this.attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
    this.geo.instanceCount = n;
  }

  dispose() { this.mesh.removeFromParent(); this.geo.dispose(); }
}

/** Fire kinds (the last argument of `fire`). */
export const GLOW = 0, FLAME = 1, FIREBALL = 2;

export class Sprites {
  readonly smoke: SpriteBatch;
  readonly fireB: SpriteBatch;
  readonly decals: SpriteBatch;
  private readonly mats: THREE.ShaderMaterial[];
  private readonly tex: THREE.Texture[];
  private readonly uni = {
    uPuff: { value: null as THREE.Texture | null }, uNoise: { value: null as THREE.Texture | null }, uTime: { value: 0 },
    uSunV: { value: new THREE.Vector3() }, uSunC: { value: new THREE.Color(1.02, .93, .78) }, uAmbC: { value: new THREE.Color(.5, .5, .49) },
    uHeatC: { value: new THREE.Color(1, .4, .09) }, uGlobe,
  };
  private readonly fwd = new THREE.Vector3();

  constructor(parent: THREE.Object3D) {
    const n = makeNoise(), puff = puffTexture(n), noise = noiseTexture(n);
    this.uni.uPuff.value = puff; this.uni.uNoise.value = noise; this.tex = [puff, noise];
    const premul = (frag: string, vert = BILLBOARD, extra: Partial<THREE.ShaderMaterialParameters> = {}) => new THREE.ShaderMaterial({
      uniforms: this.uni, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, toneMapped: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      ...extra,
    });
    const decal = premul(DECAL_FRAG, FLAT, { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const fire = premul(FIRE_FRAG, BILLBOARD, { blendDst: THREE.OneFactor, blendDstAlpha: THREE.OneFactor });
    const smoke = premul(SMOKE_FRAG);
    this.mats = [decal, fire, smoke];
    this.decals = new SpriteBatch(parent, 1500, decal, 1, false);
    this.fireB = new SpriteBatch(parent, 4000, fire, 2, false);
    this.smoke = new SpriteBatch(parent, 5000, smoke, 3, true);
  }

  begin() { this.smoke.begin(); this.fireB.begin(); this.decals.begin(); }

  /** A lit puff of smoke or dust. `age` 0..1 erodes it into wisps; `heat` 0..1 makes it glow from inside. */
  puff(x: number, y: number, z: number, d: number, c: THREE.Color, a: number, rot: number, seed: number, age: number, heat = 0) {
    this.smoke.push(x, y, z, d, d, c, a, rot, seed, age, heat);
  }
  /** Additive fire: GLOW (flash/spark), FLAME (tongue, w x h) or FIREBALL. */
  fire(x: number, y: number, z: number, w: number, h: number, c: THREE.Color, a: number, seed: number, age: number, kind: number, rot = 0) {
    this.fireB.push(x, y, z, w, h, c, a, rot, seed, age, kind);
  }
  /** A scorch mark lying on the ground; `burn` 0..1 shows glowing embers. */
  decal(x: number, y: number, z: number, w: number, h: number, c: THREE.Color, a: number, rot: number, seed: number, burn = 0) {
    this.decals.push(x, y + .004, z, w, h, c, a, rot, seed, burn, 0);
  }

  end(camera: THREE.Camera, time: number) {
    camera.getWorldDirection(this.fwd);
    this.uni.uTime.value = time;
    this.uni.uSunV.value.copy(SUN_DIR).transformDirection(camera.matrixWorldInverse);
    this.smoke.end(this.fwd); this.fireB.end(this.fwd); this.decals.end(this.fwd);
  }

  dispose() {
    this.smoke.dispose(); this.fireB.dispose(); this.decals.dispose();
    for (const m of this.mats) m.dispose(); for (const t of this.tex) t.dispose();
  }
}
