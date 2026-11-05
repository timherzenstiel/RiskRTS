// Painted heightfield terrain: one continuous, sun-lit surface over the whole map (tile-corner vertices, sloping into the sea at the
// coasts), plus trees, villages, cities, railways and sea lanes. Close to the camera detail.ts lays a finer painted surface on top.
// Everything static here is generated from the shared world raster with deterministic noise, so every client draws the same map.
import * as THREE from 'three';
import {
  CITIES, COLS, HH, HW, N, RIDGES, ROWS, Rng, SEA, TS, hash2, latOf, lonOf, tileAtLL, tileAtW, tx, tz, vnoise, worksAt, wxLon, wzLat, type GameState, type World,
} from '@riskrts/shared';
import { boxGeo } from './pools';
import { DisposeBag, clamp, col, lerp } from './util';
import { facCol } from './palette';
import { COAST_GLSL, coastTexture } from './coast';
import { borderField, type BorderField } from './borderField';
import type { MeshKey, MeshPools } from './meshPools';

/** Tiles per side of a close-up detail chunk (see detail.ts). */
export const DETAIL_CH = 12;
export const DCC = Math.ceil(COLS / DETAIL_CH), DCR = Math.ceil(ROWS / DETAIL_CH);
/** Tile flags in the info texture. */
export const FL_FIELD = 1, FL_ROAD = 2, FL_CITY = 4, FL_RIVER = 8, FL_COAST = 16, FL_FURROW = 32;

export interface CityInfo { name: string; size: number; x: number; z: number; tile: number }

const BIOME_KEYS = ['ice', 'snow', 'rock', 'tundra', 'desert', 'jungle', 'taiga', 'steppe', 'savanna', 'temperate', 'beach'] as const;
type Biome = typeof BIOME_KEYS[number];
// Earthy, desaturated C&C ground: olive grass, khaki steppe, dusty sand, grey rock.
const BIOME: Record<Biome, THREE.Color> = {
  ice: col('#bfc6c2'), snow: col('#d3d5cf'), rock: col('#7a7263'), tundra: col('#7b7d68'), desert: col('#b39563'), jungle: col('#3d5631'),
  taiga: col('#475840'), steppe: col('#8a8156'), savanna: col('#877c4c'), temperate: col('#5e6c3b'), beach: col('#b09c72'),
};
const TREEC: Partial<Record<Biome, THREE.Color[]>> = {
  taiga: ['#26392a', '#2e4232', '#223424'].map(col), temperate: ['#3c5229', '#475d2f', '#384b26', '#55652f'].map(col), jungle: ['#26461f', '#2d5027', '#203c1b'].map(col),
  savanna: ['#53592d', '#5d6332'].map(col), tundra: [col('#525a42')],
};
const TREE_P: Partial<Record<Biome, number>> = { taiga: .38, temperate: .22, jungle: .5, savanna: .07, tundra: .03 };
const FIELDC = ['#958646', '#66743a', '#735a3e', '#848446', '#5a6a35', '#9c8c52'].map(col);
const WALLS = ['#d8cfb8', '#cfc2a4', '#c9b99c', '#e2dccb'].map(col);
const ROOFS = ['#74392b', '#7d4a35', '#45474a', '#5a4434', '#66382b'].map(col);
const WHITE = col('#ffffff'), RED = col('#ff6b4a'), RIVERC = col('#38535a'), CITYC = col('#878272'), ROADC = col('#7a6a4c'), TRUNK = col('#3e2c1e');

function biomeKey(lon: number, lat: number, h: number): Biome {
  const al = Math.abs(lat);
  if (lon > -75 && lon < -12 && lat > 59) return 'ice';
  if (h > 1.12) return 'snow';
  if (h > .9) return 'rock';
  if (al > 68) return 'tundra';
  if ((lon > -17 && lon < 34 && lat > 15 && lat < 31) || (lon > 34 && lon < 60 && lat > 14 && lat < 31) || (lon > 48 && lon < 66 && lat > 25 && lat < 36) || (lon > 92 && lon < 112 && lat > 38 && lat < 46) ||
    (lon > 118 && lon < 142 && lat < -20 && lat > -31) || (lon > -117 && lon < -104 && lat > 26 && lat < 36) || (lon > 15 && lon < 26 && lat < -18 && lat > -28) || (lon > -75 && lon < -68 && lat < -15 && lat > -28) ||
    (lon > 55 && lon < 66 && lat > 38 && lat < 45)) return 'desert';
  if (al < 11) return 'jungle';
  if (lat > 55 || lat < -50) return 'taiga';
  if ((lon > 45 && lon < 90 && lat > 38 && lat < 52) || (lon > -112 && lon < -96 && lat > 34 && lat < 52) || (lon > -66 && lon < -58 && lat < -30 && lat > -40) || (lon > 30 && lon < 48 && lat > 45 && lat < 51)) return 'steppe';
  if (al < 24) return 'savanna';
  return 'temperate';
}

/** Per-tile terrain height (deterministic from ridges + noise). Not part of the shared world, so it is derived here. */
export function computeHeights(w: World): Float32Array {
  const h = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (!w.land[i]) continue;
    const c = i % COLS, r = (i / COLS) | 0, lon = lonOf(c), lat = latOf(r);
    let e = 0;
    for (const [x, y, rad, amp] of RIDGES) { const d2 = ((lon - x) ** 2 + (lat - y) ** 2) / (rad * rad); if (d2 < 9) e += amp * Math.exp(-d2); }
    const v = .3 + .15 * vnoise(c * .067, r * .067) + .06 * vnoise(c * .22, r * .22) + .025 * hash2(c, r) + .035 * vnoise(c * .7, r * .7) + Math.min(e, 1.15) * (.85 + .3 * vnoise(c * .27 + 7, r * .27));
    h[i] = Math.max(.24, Math.round(v / .04) * .04);
  }
  for (let i = 0; i < N; i++) if (w.river[i]) h[i] = Math.max(.2, h[i] - .07);
  return h;
}

const enc = (v: number) => Math.round(Math.pow(clamp(v, 0, 1), 1 / 2.2) * 255);
const nb4 = (i: number, out: number[]) => { const c = i % COLS; out[0] = c > 0 ? i - 1 : -1; out[1] = c < COLS - 1 ? i + 1 : -1; out[2] = i >= COLS ? i - COLS : -1; out[3] = i + COLS < N ? i + COLS : -1; return out; };

/** Shared uniform: 0 = full faction colouring (strategic view), 1 = natural terrain with coloured borders only (close-up). */
export const uNear = { value: 0 };

/** Tiles per side of a far-ground chunk. */
const FAR_CH = 40;

/** Far-ground material: region colours (linear-filtered, so borders read as painted), brush noise, rock on steep slopes,
 *  wet sand where the land runs into the sea. Fragments under a drawn close-up chunk are discarded (detail.ts paints there). */
function farMaterial(strat: THREE.DataTexture, nat: THREE.DataTexture, cover: THREE.DataTexture, war: THREE.DataTexture, coast: THREE.DataTexture) {
  const m = new THREE.MeshLambertMaterial();
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uStrat: { value: strat }, uNatL: { value: nat }, uCover: { value: cover }, uWar: { value: war }, uCoast: { value: coast }, uNear, uGrid: { value: new THREE.Vector2(COLS, ROWS) } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWP=(modelMatrix*vec4(transformed,1.)).xyz; vWN=normalize(mat3(modelMatrix)*objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D uStrat, uNatL, uCover, uWar, uCoast; uniform float uNear; uniform vec2 uGrid; varying vec3 vWP; varying vec3 vWN;
float fh(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float fn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(fh(i),fh(i+vec2(1,0)),f.x),mix(fh(i+vec2(0,1)),fh(i+vec2(1,1)),f.x),f.y); }
float fb(vec2 p){ return fn(p)*.5+fn(p*2.07+13.)*.28+fn(p*4.3+29.)*.14+fn(p*8.9+3.)*.08; }
${COAST_GLSL}`)
      .replace('void main() {', `void main() {
  vec2 _cc=floor((vWP.xz+vec2(${HW.toFixed(4)},${HH.toFixed(4)}))/${(DETAIL_CH * TS).toFixed(5)});
  if(uNear>.01 && texture2D(uCover,(_cc+.5)/vec2(${DCC}.,${DCR}.)).r>.5) discard;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  vec2 _t=(vWP.xz/${TS.toFixed(6)}+uGrid*.5)/uGrid;
  // smooth coastline: cut the land along the coast field, crinkled by noise into a rocky edge
  float _cs=coastSd(uCoast,_t)+(fb(vWP.xz*9.)-.5)*.28+(fn(vWP.xz*31.)-.5)*.08;
  if(_cs>0.) discard;
  vec2 _w=vec2(fb(vWP.xz*1.7),fb(vWP.xz*1.7+7.1))-.5;
  vec3 _s=pow(texture2D(uStrat,_t+_w*.0009).rgb,vec3(2.2)), _n=pow(texture2D(uNatL,_t+_w*.0012).rgb,vec3(2.2));
  vec3 _c=mix(_s,_n,uNear);
  float _m=fb(vWP.xz*3.1), _m2=fb(vWP.xz*15.);
  _c*=(.86+.34*_m+.14*(_m2-.5))*mix(1.38,1.,uNear);
  float _sl=1.-normalize(vWN).y;
  vec3 _rock=mix(vec3(.21,.15,.095),vec3(.105,.085,.065),fn(vWP.xz*22.))*(.8+.3*step(.5,fract(vWP.y*60.+_m*2.)));
  _c=mix(_c,mix(_rock,_c,.35*(1.-uNear)),smoothstep(.2,.5,_sl));
  // war damage: churned no-man's-land and shell craters where a border has been fought over
  float _dm=texture2D(uWar,_t).g;
  if(_dm>.01){
    _c=mix(_c,vec3(.085,.07,.05)*(.75+.5*_m2),smoothstep(.0,.6,_dm)*.8);
    vec2 _cg=vWP.xz*7.,_ci=floor(_cg),_cf=fract(_cg)-.5; float _cr=.18+.2*fh(_ci+3.);
    if(fh(_ci)<_dm*.7&&length(_cf)<_cr) _c*=length(_cf+vec2(.06))<_cr?.55:1.25;
  }
  // the shore: wet sand a little inland, then a dark broken rock rim at the water's edge (lit top-left)
  float _sand=smoothstep(-.42,-.2,_cs)*(1.-smoothstep(-.14,-.08,_cs));
  _c=mix(_c,vec3(.24,.2,.14)*(.8+.3*_m2),_sand*.55);
  float _rim=smoothstep(-.13,-.05,_cs);
  vec3 _rk=mix(vec3(.12,.1,.085),vec3(.3,.26,.21),fn(vWP.xz*40.)); _rk*=.75+.5*step(.55,fn(vWP.xz*26.+3.));
  _c=mix(_c,_rk,_rim*.9);
  float _wet=smoothstep(.235,.15,vWP.y);
  _c=mix(_c,vec3(.2,.17,.12)*(.75+.35*_m2),_wet*.45);
  _c*=mix(.55,1.,smoothstep(.04,.18,vWP.y));
  diffuseColor.rgb=_c;`);
  };
  return m;
}

export class Terrain {
  readonly tileH: Float32Array;
  readonly cities: CityInfo[] = [];
  /** Highest terrain around each region's anchor; battlefields are laid at this height. */
  readonly groundY: number[];
  readonly railMat: THREE.LineBasicMaterial;
  private readonly laneMat: THREE.LineDashedMaterial;
  private readonly bag = new DisposeBag();
  readonly instOf = new Int32Array(N).fill(-1);
  readonly biome = new Uint8Array(N);
  readonly baseCol: Float32Array;
  /** Close-up ground data, one texel per tile. nat: natural colour (sRGB, with hover/selection) + owner + 1 in alpha (0 = none). */
  readonly natTex: THREE.DataTexture;
  /** info: r = (biome + 1) * 20 (0 = sea), g = tile flags, b/a = region id low/high byte. */
  readonly infoTex: THREE.DataTexture;
  /** One byte per detail chunk: 1 while the close-up layer draws that chunk (voxel trees there are hidden). */
  readonly coverData = new Uint8Array(DCC * DCR);
  readonly coverTex: THREE.DataTexture;
  /** Every tree on the map: x, z, y, scale, biome, colour index, region (stride 7). */
  readonly treeRec: number[] = [];
  private readonly natData: Uint8Array<ArrayBuffer>;
  readonly cityT = new Uint8Array(N);
  readonly roadT = new Uint8Array(N);
  readonly fieldT = new Uint8Array(N);
  readonly coastT = new Uint8Array(N);
  /** Linear-filtered copies for the far ground: strategic (owner-tinted) and natural colour per tile; sea tiles next to the
   *  coast repeat their land neighbour so the coast does not bleed to black. */
  private readonly stratData: Uint8Array<ArrayBuffer>;
  private readonly natLData: Uint8Array<ArrayBuffer>;
  private readonly stratTex: THREE.DataTexture;
  private readonly natLTex: THREE.DataTexture;
  /** Sea tiles that copy a land tile's colours (land tile -> sea tiles). */
  private readonly shoreOf = new Map<number, number[]>();
  private readonly farMeshes: THREE.Mesh[] = [];
  /** War texture, one texel per tile: r = trench depth on a held border (0-3, x80), g = shell damage (0-255). */
  readonly warData = new Uint8Array(N * 4);
  readonly warTex: THREE.DataTexture;
  private warKey = '';
  private readonly nearBorder = new Map<string, Int32Array>();
  /** Signed distance to the smooth coastline (coast.ts), shared by the ground shaders and the water. */
  readonly coastTex: THREE.DataTexture;
  /** Smooth region borders, owners, trench levels and damage per border for the close-up ground (borderField.ts). */
  readonly border: BorderField;
  /** Village and town houses (x, y, z, width, height, depth, wall colour) and churches (x, y, z, size), for the modelled scenery. */
  private readonly homes: [number, number, number, number, number, number, THREE.Color][] = [];
  private readonly churches: [number, number, number, number][] = [];
  /** Modelled trees and houses (built once the baked models load), chunked so off-screen chunks are culled. */
  private readonly sceneryMeshes: THREE.InstancedMesh[] = [];
  private sceneryOn = false;
  hasScenery = false;
  private readonly treeMesh: THREE.InstancedMesh;
  private readonly houseMesh: THREE.InstancedMesh;
  private readonly treeBase: Float32Array;
  private readonly treesOf: Int32Array[];
  private readonly objects: THREE.Object3D[] = [];

  constructor(private readonly scene: THREE.Scene, private readonly world: World) {
    const { land, river, terrOf, borderNb } = world;
    this.tileH = computeHeights(world);
    const tileH = this.tileH, rng = new Rng(1914);
    const landIdx: number[] = [];
    for (let i = 0; i < N; i++) if (land[i]) { this.instOf[i] = landIdx.length; landIdx.push(i); }

    const m4 = new THREE.Matrix4();
    // base biome colours, beaches and patchwork fields
    const coastLand = this.coastT, NB = [0, 0, 0, 0];
    for (const i of landIdx) { nb4(i, NB); for (const j of NB) if (j >= 0 && !land[j]) coastLand[i] = 1; }
    const fieldT = this.fieldT, tmp = new THREE.Color();
    this.baseCol = new Float32Array(landIdx.length * 3);
    landIdx.forEach((i, k) => {
      const c = i % COLS, r = (i / COLS) | 0, lon = lonOf(c), lat = latOf(r);
      let key = biomeKey(lon, lat, tileH[i]);
      if (coastLand[i] && tileH[i] < .4 && key !== 'ice' && key !== 'tundra' && hash2(i, 3) < .55) key = 'beach';
      this.biome[i] = BIOME_KEYS.indexOf(key);
      tmp.copy(BIOME[key]); const j = .93 + hash2(i, 7) * .1;
      let done = false;
      if ((key === 'temperate' || key === 'steppe') && tileH[i] < .55 && !river[i]) {
        const fv = vnoise(c * .06 + 11, r * .06 + 5);
        if (fv > .68) { const id = Math.floor(vnoise(c * .19 + 3, r * .19) * 6), st = ((id & 1 ? r : c) % 2) ? 1 : .92; fieldT[i] = 1; tmp.copy(FIELDC[id % 6]).multiplyScalar(st * (.96 + hash2(i, 9) * .07)); done = true; }
      }
      if (!done) tmp.multiplyScalar(j);
      this.baseCol[k * 3] = tmp.r; this.baseCol[k * 3 + 1] = tmp.g; this.baseCol[k * 3 + 2] = tmp.b;
    });

    // close-up ground textures
    this.natData = new Uint8Array(N * 4);
    this.natTex = this.bag.add(new THREE.DataTexture(this.natData, COLS, ROWS, THREE.RGBAFormat, THREE.UnsignedByteType));
    const info = new Uint8Array(N * 4);
    for (const i of landIdx) {
      const c = i % COLS, r = (i / COLS) | 0;
      info[i * 4] = (this.biome[i] + 1) * 20;
      info[i * 4 + 1] = (fieldT[i] ? FL_FIELD : 0) | (river[i] ? FL_RIVER : 0) | (coastLand[i] ? FL_COAST : 0) | (Math.floor(vnoise(c * .19 + 3, r * .19) * 6) & 1 ? FL_FURROW : 0);
      info[i * 4 + 2] = terrOf[i] & 255; info[i * 4 + 3] = terrOf[i] >> 8;
    }
    this.infoTex = this.bag.add(new THREE.DataTexture(info, COLS, ROWS, THREE.RGBAFormat, THREE.UnsignedByteType));
    for (const t of [this.natTex, this.infoTex]) { t.magFilter = t.minFilter = THREE.NearestFilter; t.needsUpdate = true; }

    // trees
    const treeData: number[] = [], treeBaseL: number[] = [], treeRegion: number[] = [];
    const addPart = (rid: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, c: THREE.Color) => { treeData.push(x, y, z, sx, sy, sz); treeBaseL.push(c.r, c.g, c.b); treeRegion.push(rid); };
    for (const i of landIdx) {
      if (river[i] || fieldT[i]) continue;
      const k = BIOME_KEYS[this.biome[i]], p = (TREE_P[k] ?? 0) * .85;
      if (!p) continue;
      for (let n = 0; n < 2; n++) {
        if (rng.next() > p) continue;
        const x = tx(i % COLS) + (rng.next() - .5) * TS * .8, z = tz((i / COLS) | 0) + (rng.next() - .5) * TS * .8, y = tileH[i], t = terrOf[i];
        const cc = TREEC[k]!, ci = Math.floor(rng.next() * cc.length), c = cc[ci], s = .8 + rng.next() * .5;
        this.treeRec.push(x, z, y, s, this.biome[i], ci, t);
        if (k === 'taiga') { addPart(t, x, y + .025 * s, z, .02, .05 * s, .02, TRUNK); addPart(t, x, y + .08 * s, z, .11 * s, .06 * s, .11 * s, c); addPart(t, x, y + .135 * s, z, .075 * s, .05 * s, .075 * s, c); addPart(t, x, y + .18 * s, z, .035 * s, .04 * s, .035 * s, c); }
        else if (k === 'jungle') { addPart(t, x, y + .045 * s, z, .03, .09 * s, .03, TRUNK); addPart(t, x, y + .12 * s, z, .17 * s, .07 * s, .17 * s, c); addPart(t, x, y + .17 * s, z, .1 * s, .04 * s, .1 * s, c); }
        else if (k === 'savanna') { addPart(t, x, y + .04 * s, z, .02, .08 * s, .02, TRUNK); addPart(t, x, y + .09 * s, z, .17 * s, .03 * s, .17 * s, c); }
        else if (k === 'tundra') addPart(t, x, y + .02, z, .06 * s, .04 * s, .06 * s, c);
        else { addPart(t, x, y + .03 * s, z, .025, .06 * s, .025, TRUNK); addPart(t, x, y + .1 * s, z, .13 * s, .1 * s, .13 * s, c); addPart(t, x, y + .165 * s, z, .08 * s, .04 * s, .08 * s, c); }
      }
      // low scrub between the trees: adds close-up texture
      if ((k === 'temperate' || k === 'steppe' || k === 'savanna') && rng.next() < .16) {
        const x = tx(i % COLS) + (rng.next() - .5) * TS * .8, z = tz((i / COLS) | 0) + (rng.next() - .5) * TS * .8, s = .7 + rng.next() * .6;
        addPart(terrOf[i], x, tileH[i] + .012 * s, z, .05 * s, .024 * s, .05 * s, k === 'steppe' ? ROOFS[3].clone().lerp(BIOME.steppe, .6) : TREEC.temperate![2]);
      }
    }
    this.treeBase = new Float32Array(treeBaseL);
    this.coverTex = this.bag.add(new THREE.DataTexture(this.coverData, DCC, DCR, THREE.RedFormat, THREE.UnsignedByteType));
    this.coverTex.needsUpdate = true;

    // far ground: linear colour textures + heightfield chunks
    this.stratData = new Uint8Array(N * 4); this.natLData = new Uint8Array(N * 4);
    this.stratTex = this.bag.add(new THREE.DataTexture(this.stratData, COLS, ROWS, THREE.RGBAFormat, THREE.UnsignedByteType));
    this.natLTex = this.bag.add(new THREE.DataTexture(this.natLData, COLS, ROWS, THREE.RGBAFormat, THREE.UnsignedByteType));
    for (const t of [this.stratTex, this.natLTex]) { t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; }
    {
      // sea tiles up to two tiles out take the colour of the nearest land tile
      const src = new Int32Array(N).fill(-1), q: number[] = [];
      for (const i of landIdx) { src[i] = i; q.push(i); }
      const depth = new Uint8Array(N);
      for (let h = 0; h < q.length; h++) { const i = q[h]; if (depth[i] >= 2) continue; nb4(i, NB); for (const j of NB) if (j >= 0 && src[j] < 0) { src[j] = src[i]; depth[j] = depth[i] + 1; q.push(j); } }
      for (let i = 0; i < N; i++) if (!land[i] && src[i] >= 0) { let l = this.shoreOf.get(src[i]); if (!l) this.shoreOf.set(src[i], l = []); l.push(i); }
    }
    this.warTex = this.bag.add(new THREE.DataTexture(this.warData, COLS, ROWS, THREE.RGBAFormat, THREE.UnsignedByteType));
    this.warTex.magFilter = this.warTex.minFilter = THREE.LinearFilter; this.warTex.needsUpdate = true;
    this.coastTex = this.bag.add(coastTexture(world));
    this.border = borderField(world);
    for (const t of [this.border.distTex, this.border.idTex, this.border.tableTex]) this.bag.add(t);
    const farMat = this.bag.add(farMaterial(this.stratTex, this.natLTex, this.coverTex, this.warTex, this.coastTex));
    this.buildFarGround(farMat);
    const treeMat = this.bag.add(new THREE.MeshLambertMaterial()), coverTex = this.coverTex;
    // voxel trees give way to the detailed close-up trees wherever the detail layer is drawn
    treeMat.onBeforeCompile = (sh) => {
      sh.uniforms.uCover = { value: coverTex }; sh.uniforms.uNear = uNear;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vTW;').replace('#include <begin_vertex>', '#include <begin_vertex>\n  vTW=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uCover; uniform float uNear; varying vec2 vTW;')
        .replace('void main() {', `void main() {
  vec2 _cc=floor((vTW+vec2(${HW.toFixed(4)},${HH.toFixed(4)}))/${(DETAIL_CH * TS).toFixed(5)});
  if(texture2D(uCover,(_cc+.5)/vec2(${DCC}.,${DCR}.)).r>.5) discard;`);
    };
    this.treeMesh = new THREE.InstancedMesh(boxGeo, treeMat, Math.max(1, treeRegion.length));
    this.treeMesh.frustumCulled = false; this.treeMesh.castShadow = this.treeMesh.receiveShadow = true;
    const perRegion: number[][] = world.regions.map(() => []);
    for (let k = 0; k < treeRegion.length; k++) {
      m4.makeScale(treeData[k * 6 + 3], treeData[k * 6 + 4], treeData[k * 6 + 5]); m4.setPosition(treeData[k * 6], treeData[k * 6 + 1], treeData[k * 6 + 2]);
      this.treeMesh.setMatrixAt(k, m4); tmp.setRGB(this.treeBase[k * 3], this.treeBase[k * 3 + 1], this.treeBase[k * 3 + 2]); this.treeMesh.setColorAt(k, tmp);
      perRegion[treeRegion[k]].push(k);
    }
    if (!treeRegion.length) this.treeMesh.setColorAt(0, WHITE);
    this.treesOf = perRegion.map((a) => Int32Array.from(a));
    this.add(this.treeMesh);

    // cities and villages
    const houses: [number, number, number, number, number, number, THREE.Color][] = [];
    for (const [name, lon, lat, size] of CITIES) {
      const ci = tileAtLL(lon, lat); if (ci < 0 || !land[ci]) continue;
      const cx = wxLon(lon), cz = wzLat(lat); this.cities.push({ name, size, x: cx, z: cz, tile: ci });
      const n = size === 3 ? 240 : size === 2 ? 110 : 30, R = size === 3 ? .4 : size === 2 ? .28 : .16;
      for (let k = 0; k < n; k++) {
        const a = rng.next() * 6.283, r = Math.sqrt(rng.next()) * R, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const ti = tileAtW(x, z); if (ti < 0 || !land[ti]) continue;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const j = ti + dr * COLS + dc; if (j >= 0 && j < N && land[j]) this.cityT[j] = 1; }
        const y = tileH[ti], w = .05 + rng.next() * .05, d = .05 + rng.next() * .05, h = .04 + rng.next() * .05 + (size === 3 && r < .12 ? .05 : 0), rot = rng.next() < .5, ww = rot ? d : w, dd = rot ? w : d;
        if (this.homes.some(([hx, , hz, hw, , hd]) => Math.abs(hx - x) < (hw + ww) / 2 + .012 && Math.abs(hz - z) < (hd + dd) / 2 + .012)) continue;
        const wc = WALLS[Math.floor(rng.next() * 4)]; houses.push([x, y + h / 2, z, ww, h, dd, wc]); this.homes.push([x, y, z, ww, h, dd, wc]);
        const rc = ROOFS[Math.floor(rng.next() * 5)]; houses.push([x, y + h + .008, z, ww + .012, .016, dd + .012, rc]); houses.push([x, y + h + .022, z, ww * .55, .014, dd + .006, rc]);
      }
      if (size >= 2) { const y = tileH[ci]; houses.push([cx, y + .12, cz, .045, .24, .045, WALLS[3]]); houses.push([cx, y + .27, cz, .024, .07, .024, ROOFS[2]]); this.churches.push([cx, y, cz, size]); }
      if (size === 3) { const y = tileH[ci]; houses.push([cx + .1, y + .05, cz + .08, .16, .1, .1, WALLS[1]]); houses.push([cx + .1, y + .12, cz + .08, .06, .05, .06, col('#5f7a6e')]); }
    }
    for (const t of world.regions) {
      const cnt = Math.min(18, Math.floor(t.tiles.length / 200));
      for (let k = 0; k < cnt; k++) {
        const i = t.tiles[Math.floor(rng.next() * t.tiles.length)], kk = BIOME_KEYS[this.biome[i]];
        if (river[i] || this.cityT[i] || tileH[i] > .6 || !(kk === 'temperate' || kk === 'steppe' || kk === 'savanna' || kk === 'taiga')) continue;
        const cx = tx(i % COLS), cz = tz((i / COLS) | 0), n = 3 + Math.floor(rng.next() * 5);
        for (let q = 0; q < n; q++) {
          const a = rng.next() * 6.283, r = Math.sqrt(rng.next()) * .11, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, ti = tileAtW(x, z); if (ti < 0 || !land[ti] || river[ti]) continue;
          const y = tileH[ti], w = .04 + rng.next() * .03, d = .04 + rng.next() * .035, h = .03 + rng.next() * .03, rot = rng.next() < .5, ww = rot ? d : w, dd = rot ? w : d;
          if (this.homes.some(([hx, , hz, hw, , hd]) => Math.abs(hx - x) < (hw + ww) / 2 + .012 && Math.abs(hz - z) < (hd + dd) / 2 + .012)) continue;
          const wc = WALLS[Math.floor(rng.next() * 4)]; houses.push([x, y + h / 2, z, ww, h, dd, wc]); this.homes.push([x, y, z, ww, h, dd, wc]); const rc = ROOFS[Math.floor(rng.next() * 5)];
          houses.push([x, y + h + .007, z, ww + .01, .013, dd + .01, rc]); houses.push([x, y + h + .018, z, ww * .5, .011, dd + .004, rc]);
        }
        if (rng.next() < .45) { const y = tileH[i]; houses.push([cx + .07, y + .05, cz - .06, .018, .1, .018, WALLS[3]]); houses.push([cx + .07, y + .11, cz - .06, .02, .025, .02, ROOFS[2]]); }
      }
    }
    // farmsteads in the fields: a farmhouse and a timber barn (modelled scenery)
    for (const i of landIdx) {
      if (!fieldT[i] || this.cityT[i] || hash2(i, 91) > .03) continue;
      const x = tx(i % COLS) + (hash2(i, 92) - .5) * TS * .5, z = tz((i / COLS) | 0) + (hash2(i, 93) - .5) * TS * .5, y = tileH[i];
      this.homes.push([x, y, z, .055, .04, .045, WALLS[Math.floor(hash2(i, 94) * 4)]]);
      this.homes.push([x + .075, y, z + .01, .06, .045, .042, col('#8a6a48')]);
      houses.push([x, y + .02, z, .055, .04, .045, WALLS[0]]); houses.push([x + .075, y + .022, z + .01, .06, .045, .042, col('#6a2c21')]);
    }
    // railways and the roads that follow them
    const rpts: number[] = [], rcols: number[] = [], RAIL = col('#2b2722'), TIE = col('#6b5a40'), pairs = new Set<string>();
    const hAt = (x: number, z: number) => { const i = tileAtW(x, z); return (i >= 0 && land[i]) ? tileH[i] : -1; };
    for (const a of this.cities) {
      const near = this.cities.filter((b) => b !== a).map((b) => [b, Math.hypot(b.x - a.x, b.z - a.z)] as const).filter(([, d]) => d < 9).sort((p, q) => p[1] - q[1]).slice(0, 3);
      for (const [b, d] of near) {
        const key = [a.name, b.name].sort().join('|'); if (pairs.has(key)) continue;
        const n = Math.ceil(d / .08); let ok = true;
        for (let s = 0; s <= n; s++) if (hAt(lerp(a.x, b.x, s / n), lerp(a.z, b.z, s / n)) < 0) { ok = false; break; }
        if (!ok) continue;
        pairs.add(key); const ux = (b.x - a.x) / d, uz = (b.z - a.z) / d;
        for (let s = 0; s < n; s++) {
          const x0 = lerp(a.x, b.x, s / n), z0 = lerp(a.z, b.z, s / n), x1 = lerp(a.x, b.x, (s + 1) / n), z1 = lerp(a.z, b.z, (s + 1) / n);
          const y0 = this.surfaceAt(x0, z0) + .008, y1 = this.surfaceAt(x1, z1) + .008;
          rpts.push(x0, y0, z0, x1, y1, z1); rcols.push(RAIL.r, RAIL.g, RAIL.b, RAIL.r, RAIL.g, RAIL.b);
          if (s % 2 === 0) { rpts.push(x0 - uz * .035, y0, z0 + ux * .035, x0 + uz * .035, y0, z0 - ux * .035); rcols.push(TIE.r, TIE.g, TIE.b, TIE.r, TIE.g, TIE.b); }
          const ti = tileAtW(x0, z0); if (ti >= 0 && !river[ti]) this.roadT[ti] = 1;
        }
      }
    }
    for (const i of landIdx) info[i * 4 + 1] |= (this.roadT[i] ? FL_ROAD : 0) | (this.cityT[i] ? FL_CITY : 0);
    this.infoTex.needsUpdate = true;
    const rg = this.bag.add(new THREE.BufferGeometry());
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rpts, 3)); rg.setAttribute('color', new THREE.Float32BufferAttribute(rcols, 3));
    this.railMat = this.bag.add(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true }));
    this.add(new THREE.LineSegments(rg, this.railMat));

    this.houseMesh = new THREE.InstancedMesh(boxGeo, this.bag.add(new THREE.MeshLambertMaterial()), Math.max(1, houses.length));
    this.houseMesh.frustumCulled = false; this.houseMesh.castShadow = this.houseMesh.receiveShadow = true;
    houses.forEach(([x, y, z, sx, sy, sz, c], k) => { m4.makeScale(sx, sy, sz); m4.setPosition(x, y, z); this.houseMesh.setMatrixAt(k, m4); this.houseMesh.setColorAt(k, c); });
    this.add(this.houseMesh);

    // sea lanes
    const lp: number[] = [], y = .5;
    for (const [a, b] of SEA) {
      const A = world.byName[a], B = world.byName[b];
      if (Math.abs(B.cx - A.cx) > HW) { const ex = A.cx < 0 ? -HW : HW; lp.push(A.cx, y, A.cz, ex, y, (A.cz + B.cz) / 2, -ex, y, (A.cz + B.cz) / 2, B.cx, y, B.cz); }
      else lp.push(A.cx, y, A.cz, B.cx, y, B.cz);
    }
    const lg = this.bag.add(new THREE.BufferGeometry()); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    this.laneMat = this.bag.add(new THREE.LineDashedMaterial({ color: 0xb8c0a4, dashSize: .6, gapSize: .5, transparent: true, opacity: .5 }));
    const lines = new THREE.LineSegments(lg, this.laneMat);
    lines.computeLineDistances(); this.add(lines);

    // battlefield height per region
    this.groundY = world.regions.map((t) => {
      let m = 0; const R = 10, c0 = t.anchor % COLS, r0 = (t.anchor / COLS) | 0;
      for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) { const rr = r0 + dr, cc = c0 + dc; if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue; const i = rr * COLS + cc; if (land[i]) m = Math.max(m, tileH[i]); }
      return Math.max(m, .3) + .02;
    });
    void borderNb;
  }

  private add(o: THREE.Object3D) { this.scene.add(o); this.objects.push(o); }

  /** Swap the box trees and houses for the baked models (trees by biome, houses by size), in culled chunks. */
  useModels(mp: MeshPools) {
    if (this.hasScenery) return; this.hasScenery = true;
    const groups = new Map<string, { key: MeshKey; m: number[]; c: number[] }>();
    const put = (key: MeshKey, x: number, z: number, mat: THREE.Matrix4, c: THREE.Color) => {
      const ck = key + ':' + Math.floor((x + HW) / (FAR_CH * TS)) + ':' + Math.floor((z + HH) / (FAR_CH * TS));
      let g = groups.get(ck); if (!g) groups.set(ck, g = { key, m: [], c: [] });
      g.m.push(...mat.elements); g.c.push(c.r, c.g, c.b);
    };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3(), tc = new THREE.Color();
    const R = this.treeRec;
    for (let k = 0; k < R.length; k += 7) {
      const x = R[k], z = R[k + 1], y = this.surfaceAt(x, z), s = R[k + 3], bio = BIOME_KEYS[R[k + 4]], ci = R[k + 5], h = hash2(k, 31);
      const key: MeshKey = bio === 'taiga' ? 'tree_pine' : bio === 'jungle' ? (h < .35 ? 'tree_palm' : 'tree_broad') : bio === 'savanna' ? 'tree_acacia' : bio === 'tundra' ? 'shrub' : (h < .25 ? 'tree_pine' : 'tree_broad');
      const cc = (TREEC[bio] ?? TREEC.temperate!)[ci % (TREEC[bio] ?? TREEC.temperate!).length];
      const size = key === 'shrub' ? .2 * s : key === 'tree_pine' ? .17 * s : .18 * s;
      q.setFromAxisAngle(up, h * 6.283); m4.compose(v.set(x, y - .004, z), q, sc.set(size, size * (.9 + hash2(k, 7) * .25), size));
      put(key, x, z, m4, tc.copy(cc).multiplyScalar(1.15));
    }
    for (const [x, y, z, w, h, d, wc] of this.homes) {
      const big = h > .07, key: MeshKey = big ? 'house_b' : 'house_a', yaw = w >= d ? 0 : Math.PI / 2;
      // height follows the footprint (a cottage is about as tall as it is wide, a townhouse a little taller), not the box height
      const s0 = (w + d) / 2, sy = s0 * (big ? .95 : .78);
      q.setFromAxisAngle(up, yaw); m4.compose(v.set(x, this.surfaceAt(x, z) - .002, z), q, sc.set(yaw ? d : w, sy, yaw ? w : d));
      put(key, x, z, m4, tc.copy(wc));
    }
    for (const [x, y, z, size] of this.churches) {
      q.setFromAxisAngle(up, 0); const S = size === 3 ? .16 : .12; m4.compose(v.set(x, y, z), q, sc.set(S, S * 1.1, S));
      put('church', x, z, m4, tc.setRGB(1, 1, 1));
    }
    for (const g of groups.values()) {
      const geo = mp.geometry(g.key); if (!geo) continue;
      const n = g.c.length / 3, im = new THREE.InstancedMesh(geo, mp.mat, n);
      im.instanceMatrix.array.set(g.m); im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(g.c), 3);
      im.castShadow = im.receiveShadow = true; im.computeBoundingSphere(); im.visible = false;
      this.sceneryMeshes.push(im); this.add(im);
    }
  }

  /** Heightfield chunks over every tile that is land or touches land; corners with no land sink under the sea (shore slope). */
  private buildFarGround(mat: THREE.Material) {
    const land = this.world.land, G = FAR_CH + 1;
    const near = (c: number, r: number) => { for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = (c + dc + COLS) % COLS; if (rr >= 0 && rr < ROWS && land[rr * COLS + cc]) return true; } return false; };
    for (let r0 = 0; r0 < ROWS; r0 += FAR_CH) for (let c0 = 0; c0 < COLS; c0 += FAR_CH) {
      const idx = new Int32Array(G * G).fill(-1), pos: number[] = [], ind: number[] = [];
      const vert = (lx: number, ly: number) => {
        const o = ly * G + lx; if (idx[o] >= 0) return idx[o];
        const gx = 2 * (c0 + lx), gy = 2 * (r0 + ly), h = this.vtxH(gx, gy); idx[o] = pos.length / 3;
        pos.push(gx * TS / 2 - HW, h < 0 ? .24 : h, gy * TS / 2 - HH); return idx[o];
      };
      for (let r = r0; r < Math.min(ROWS, r0 + FAR_CH); r++) for (let c = c0; c < Math.min(COLS, c0 + FAR_CH); c++) {
        if (!near(c, r)) continue;
        const lx = c - c0, ly = r - r0, a = vert(lx, ly), b = vert(lx + 1, ly), d = vert(lx, ly + 1), e = vert(lx + 1, ly + 1);
        ind.push(a, d, b, b, d, e);
      }
      if (!ind.length) continue;
      const geo = this.bag.add(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(ind); geo.computeVertexNormals(); geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = mesh.castShadow = true;
      this.farMeshes.push(mesh); this.add(mesh);
    }
  }

  /** Height of the smooth close-up surface at half-tile grid point (gx, gy) (tile c centre = 2c+1); -1 where no land touches it.
   *  Every vertex takes the highest land tile it touches, so the surface always covers the voxel tiles beneath it. */
  vtxH(gx: number, gy: number): number {
    const H = this.tileH, land = this.world.land;
    const c0 = gx & 1 ? (gx - 1) >> 1 : (gx >> 1) - 1, c1 = gx & 1 ? c0 : c0 + 1;
    const r0 = gy & 1 ? (gy - 1) >> 1 : (gy >> 1) - 1, r1 = gy & 1 ? r0 : r0 + 1;
    let m = 0, k = 0;
    for (let r = r0; r <= r1; r++) {
      if (r < 0 || r >= ROWS) continue;
      for (let c = c0; c <= c1; c++) { const i = r * COLS + ((c + COLS) % COLS); if (land[i]) { m += H[i]; k++; } }
    }
    return k ? m / k + .003 : -1;
  }

  /** Height of the close-up ground surface at a world position (falls back to the tile top off the surface). */
  surfaceAt(x: number, z: number): number {
    const gx = (x + HW) / TS * 2, gy = (z + HH) / TS * 2, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const a = this.vtxH(ix, iy), b = this.vtxH(ix + 1, iy), c = this.vtxH(ix, iy + 1), d = this.vtxH(ix + 1, iy + 1);
    if (a < 0 || b < 0 || c < 0 || d < 0) { const i = tileAtW(x, z); return i >= 0 && this.world.land[i] ? this.tileH[i] : Math.max(a, b, c, d, 0); }
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  }

  /** Terrain height at the anchor tile of a region (used for flags, buildings and figures). */
  anchorH(rid: number) { return this.tileH[this.world.regions[rid].anchor]; }

  /**
   * Recolour one region. `hl`: 0 none, 1 hover, 2 selected, 3 valid attack target. `owners` is the current owner of every region
   * (needed for border shading against neighbours).
   */
  paintRegion(rid: number, owners: ArrayLike<number>, hl: 0 | 1 | 2 | 3) {
    const reg = this.world.regions[rid], owner = owners[rid], fc = facCol[owner] ?? WHITE;
    { const B = this.border; B.table[(B.regions * B.regions + rid) * 4] = owner >= 0 ? owner + 1 : 0; }
    const { river, borderNb } = this.world;
    const base = this.baseCol, SD = this.stratData, LD = this.natLData;
    const hlC = hl === 2 ? WHITE : hl === 1 ? WHITE : hl === 3 ? RED : null, hlA = hl === 2 ? .26 : hl === 1 ? .12 : hl === 3 ? .15 : 0;
    for (const i of reg.tiles) {
      const k = this.instOf[i] * 3;
      let nr = base[k], ng = base[k + 1], nbb = base[k + 2];
      // strategic view: rivers fill their tile; close-up: grassy banks, the detail layer draws the channel
      let r = nr, g = ng, b = nbb;
      if (river[i]) { r += (RIVERC.r - r) * .72; g += (RIVERC.g - g) * .72; b += (RIVERC.b - b) * .72; nr *= .9; ng *= .95; nbb *= .9; }
      else if (this.cityT[i]) { nr += (CITYC.r - nr) * .35; ng += (CITYC.g - ng) * .35; nbb += (CITYC.b - nbb) * .35; r = nr; g = ng; b = nbb; }
      else if (this.roadT[i]) { nr += (ROADC.r - nr) * .3; ng += (ROADC.g - ng) * .3; nbb += (ROADC.b - nbb) * .3; r = nr; g = ng; b = nbb; }
      r += (fc.r - r) * .46; g += (fc.g - g) * .46; b += (fc.b - b) * .46;
      // close-up: natural ground with a light owner tint
      const nb = borderNb[i];
      let pr = nr, pg = ng, pb = nbb;
      if (nb >= 0) { const m = owners[nb] === owner ? .8 : .52; r = fc.r * m; g = fc.g * m; b = fc.b * m; if (owners[nb] !== owner) { nr = r; ng = g; nbb = b; } }
      if (hlC) { r += (hlC.r - r) * hlA; g += (hlC.g - g) * hlA; b += (hlC.b - b) * hlA; nr += (hlC.r - nr) * hlA; ng += (hlC.g - ng) * hlA; nbb += (hlC.b - nbb) * hlA; pr += (hlC.r - pr) * hlA; pg += (hlC.g - pg) * hlA; pb += (hlC.b - pb) * hlA; }
      const o = i * 4, D = this.natData; D[o] = enc(pr); D[o + 1] = enc(pg); D[o + 2] = enc(pb); D[o + 3] = owner >= 0 ? owner + 1 : 0;
      const sr = enc(r), sg = enc(g), sb = enc(b), lr = enc(nr), lg = enc(ng), lb = enc(nbb);
      SD[o] = sr; SD[o + 1] = sg; SD[o + 2] = sb; SD[o + 3] = 255; LD[o] = lr; LD[o + 1] = lg; LD[o + 2] = lb; LD[o + 3] = 255;
      const sea = this.shoreOf.get(i);
      if (sea) for (const j of sea) { const q = j * 4; SD[q] = sr; SD[q + 1] = sg; SD[q + 2] = sb; SD[q + 3] = 255; LD[q] = lr; LD[q + 1] = lg; LD[q + 2] = lb; LD[q + 3] = 255; }
    }
    const T = this.treeMesh.instanceColor?.array as Float32Array | undefined;
    if (T) {
      const hi = hl === 2 ? .25 : hl === 1 ? .1 : 0, tb = this.treeBase;
      for (const k of this.treesOf[rid]) {
        let r = tb[k * 3], g = tb[k * 3 + 1], b = tb[k * 3 + 2];
        r += (fc.r - r) * .16; g += (fc.g - g) * .16; b += (fc.b - b) * .16;
        if (hi) { r += (1 - r) * hi; g += (1 - g) * hi; b += (1 - b) * hi; }
        T[k * 3] = r; T[k * 3 + 1] = g; T[k * 3 + 2] = b;
      }
    }
  }

  /** Tiles of `rid` within three tiles of its border with `n`, as (tile, depth) pairs. */
  private borderBand(rid: number, n: number): Int32Array {
    const key = rid + '|' + n; let b = this.nearBorder.get(key); if (b) return b;
    const { terrOf, borderNb, land } = this.world, out: number[] = [], seen = new Set<number>(), q: number[] = [];
    for (const i of this.world.regions[rid].tiles) if (borderNb[i] === n) { q.push(i, 0); seen.add(i); }
    for (let h = 0; h < q.length; h += 2) {
      const i = q[h], d = q[h + 1]; out.push(i, d); if (d >= 3) continue; const c = i % COLS;
      for (const j of [c > 0 ? i - 1 : -1, c < COLS - 1 ? i + 1 : -1, i - COLS, i + COLS]) if (j >= 0 && j < N && land[j] && terrOf[j] === rid && !seen.has(j)) { seen.add(j); q.push(j, d + 1); }
    }
    b = Int32Array.from(out); this.nearBorder.set(key, b); return b;
  }

  /** Trenches along held borders and shell damage (RegionState.cr) into the war texture; cheap when nothing changed. */
  setWar(g: GameState | null) {
    if (!g) return;
    let key = '';
    for (const r of g.regions) {
      if (r.cr) for (const n in r.cr) key += r.id + ':' + n + '=' + (r.cr[n] >> 3) + ',';
      for (const n of this.world.regions[r.id].adj) { const w = worksAt(r, n), c = r.fr?.[n] ? 1 : 0; if (w.tr || c || w.wire) key += r.id + '>' + n + '=' + Math.max(w.tr, c) + '/' + w.wire + ','; }
    }
    if (key === this.warKey) return;
    this.warKey = key; const D = this.warData; D.fill(0);
    const B = this.border, TB = B.table, NR = B.regions; TB.fill(0, 0, NR * NR * 4);
    for (const r of g.regions) for (const n of this.world.regions[r.id].adj) {
      const lvl = Math.max(worksAt(r, n).tr, r.fr?.[n] ? 1 : 0), dmg = Math.min(1, (r.cr?.[n] ?? 0) / 150);
      if (!lvl && dmg <= 0 && !worksAt(r, n).wire) continue;
      if (n < NR) { const o = (r.id * NR + n) * 4; TB[o] = lvl * 80; TB[o + 1] = Math.round(dmg * 255); TB[o + 2] = worksAt(r, n).wire; }
      const band = this.borderBand(r.id, n);
      for (let k = 0; k < band.length; k += 2) {
        const o = band[k] * 4, d = band[k + 1];
        if (lvl && d === 0) D[o] = Math.max(D[o], lvl * 80);
        if (dmg > 0) D[o + 1] = Math.max(D[o + 1], Math.round(dmg * 255 * (1 - d / 4)));
      }
    }
    this.warTex.needsUpdate = true; B.tableTex.needsUpdate = true;
  }

  /** Call after one or more paintRegion calls. */
  commitColors() {
    this.stratTex.needsUpdate = true; this.natLTex.needsUpdate = true; this.natTex.needsUpdate = true; this.border.tableTex.needsUpdate = true;
    if (this.treeMesh.instanceColor) this.treeMesh.instanceColor.needsUpdate = true;
  }

  setCameraDistance(dist: number) {
    // modelled trees and houses up to the front band; the light box versions further out
    const on = this.hasScenery && dist < 40;
    if (on !== this.sceneryOn) { this.sceneryOn = on; for (const m of this.sceneryMeshes) m.visible = on; this.treeMesh.visible = !on; this.houseMesh.visible = !on; }
    uNear.value = 1 - clamp((dist - 9) / 14, 0, 1);
    // line railways on the strategic map; up close the painted ground draws them (groundPaint.ts)
    const o = (1 - clamp((dist - 22) / 18, 0, 1)) * clamp((dist - 13) / 4, 0, 1);
    this.railMat.opacity = o * o * (3 - 2 * o); this.railMat.visible = this.railMat.opacity > .02;
    this.laneMat.opacity = .5 * clamp((dist - 8) / 6, 0, 1); this.laneMat.visible = this.laneMat.opacity > .02;
  }

  dispose() {
    for (const o of this.objects) o.removeFromParent();
    this.treeMesh.dispose(); this.houseMesh.dispose();
    this.bag.disposeAll();
  }
}
