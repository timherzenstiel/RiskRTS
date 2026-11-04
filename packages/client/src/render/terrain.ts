// Instanced voxel terrain: one box per land tile, plus trees, villages, cities, railways and sea lanes.
// Everything static here is generated from the shared world raster with deterministic noise, so every client draws the same map.
import * as THREE from 'three';
import {
  CITIES, COLS, HH, HW, N, RIDGES, ROWS, Rng, SEA, TS, hash2, latOf, lonOf, tileAtLL, tileAtW, tx, tz, vnoise, wxLon, wzLat, type World,
} from '@riskrts/shared';
import { boxGeo } from './pools';
import { DisposeBag, clamp, col, lerp } from './util';
import { facCol } from './palette';

export interface CityInfo { name: string; size: number; x: number; z: number; tile: number }

const BIOME_KEYS = ['ice', 'snow', 'rock', 'tundra', 'desert', 'jungle', 'taiga', 'steppe', 'savanna', 'temperate', 'beach'] as const;
type Biome = typeof BIOME_KEYS[number];
const BIOME: Record<Biome, THREE.Color> = {
  ice: col('#d4ddda'), snow: col('#eceee8'), rock: col('#8d8576'), tundra: col('#909a7d'), desert: col('#cfb070'), jungle: col('#3f6c3b'),
  taiga: col('#4d6a46'), steppe: col('#a9a268'), savanna: col('#a09d58'), temperate: col('#70904d'), beach: col('#d8c48e'),
};
const TREEC: Partial<Record<Biome, THREE.Color[]>> = {
  taiga: ['#2c4630', '#34503a', '#284028'].map(col), temperate: ['#4c6f36', '#5a7c3c', '#45652f', '#6b8a3a'].map(col), jungle: ['#2b5628', '#336230', '#24481f'].map(col),
  savanna: ['#626f35', '#6d7a3c'].map(col), tundra: [col('#5e6a4c')],
};
const TREE_P: Partial<Record<Biome, number>> = { taiga: .38, temperate: .22, jungle: .5, savanna: .07, tundra: .03 };
const FIELDC = ['#b9ac5c', '#7f9f4b', '#8d7050', '#a5b45c', '#6e9046', '#c2b66a'].map(col);
const WALLS = ['#d2c8ac', '#c4b796', '#b8a988', '#d9d4bf'].map(col);
const ROOFS = ['#8e3b2b', '#9c4a33', '#4b4f55', '#6a4436', '#7a3a2c'].map(col);
const WHITE = col('#ffffff'), RED = col('#ff6b4a'), RIVERC = col('#3f7590'), CITYC = col('#a39a86'), ROADC = col('#8a7a58'), TRUNK = col('#4a3424');

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

const nb4 = (i: number, out: number[]) => { const c = i % COLS; out[0] = c > 0 ? i - 1 : -1; out[1] = c < COLS - 1 ? i + 1 : -1; out[2] = i >= COLS ? i - COLS : -1; out[3] = i + COLS < N ? i + COLS : -1; return out; };

/** Shared uniform: 0 = full faction colouring (strategic view), 1 = natural terrain with coloured borders only (close-up). */
export const uNear = { value: 0 };

function detailMaterial(tex: THREE.DataTexture, strength: number) {
  const m = new THREE.MeshLambertMaterial();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: tex }; sh.uniforms.uNear = uNear;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aNat; varying vec3 vWP; varying vec3 vWN; varying vec3 vNat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vec4 _w = modelMatrix * instanceMatrix * vec4(transformed,1.0); vWP=_w.xyz; vWN=normalize(mat3(instanceMatrix)*objectNormal); vNat=aNat;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uDetail; uniform float uNear; varying vec3 vWP; varying vec3 vWN; varying vec3 vNat;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  diffuseColor.rgb = mix(diffuseColor.rgb, vNat, uNear);
  vec3 _an=abs(vWN); float _n;
  if(_an.y>.5){ _n=texture2D(uDetail,vWP.xz*.5).r; diffuseColor.rgb*=${(1 - strength).toFixed(2)}+${(2 * strength).toFixed(2)}*_n; }
  else { vec2 _uv=_an.x>.5?vWP.zy:vWP.xy; _n=texture2D(uDetail,_uv*.5+.37).r; float _st=step(.5,fract(vWP.y*10.)); diffuseColor.rgb*=(.74+.2*_n)*(.95+.05*_st)*mix(.7,1.,clamp(vWP.y*2.,0.,1.)); }`);
  };
  return m;
}

function makeDetailTex() {
  const S = 64, d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = vnoise(x * .22, y * .22) * .55 + hash2(x * 3 + 1, y * 7) * .45, v = Math.floor(clamp(n, 0, 1) * 255), o = (y * S + x) * 4;
    d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
}

export class Terrain {
  readonly tileH: Float32Array;
  readonly cities: CityInfo[] = [];
  /** Highest terrain around each region's anchor; battlefields are laid at this height. */
  readonly groundY: number[];
  readonly railMat: THREE.LineBasicMaterial;
  private readonly bag = new DisposeBag();
  readonly instOf = new Int32Array(N).fill(-1);
  readonly biome = new Uint8Array(N);
  readonly baseCol: Float32Array;
  readonly cityT = new Uint8Array(N);
  readonly roadT = new Uint8Array(N);
  readonly fieldT = new Uint8Array(N);
  readonly coastT = new Uint8Array(N);
  private readonly natAttr: THREE.InstancedBufferAttribute;
  private readonly tileMesh: THREE.InstancedMesh;
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

    // voxel tiles
    const detail = this.bag.add(makeDetailTex());
    const tm = this.bag.add(detailMaterial(detail, .16));
    this.tileMesh = new THREE.InstancedMesh(boxGeo, tm, landIdx.length);
    this.tileMesh.frustumCulled = false; this.tileMesh.castShadow = this.tileMesh.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    for (const i of landIdx) { const h = tileH[i]; m4.makeScale(TS, h, TS); m4.setPosition(tx(i % COLS), h / 2, tz((i / COLS) | 0)); this.tileMesh.setMatrixAt(this.instOf[i], m4); }
    this.tileMesh.setColorAt(0, WHITE);
    this.natAttr = new THREE.InstancedBufferAttribute(new Float32Array(landIdx.length * 3).fill(1), 3);
    this.tileMesh.geometry = boxGeo.clone(); this.bag.add(this.tileMesh.geometry);
    this.tileMesh.geometry.setAttribute('aNat', this.natAttr);
    this.add(this.tileMesh);

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
        if (fv > .5) { const id = Math.floor(vnoise(c * .19 + 3, r * .19) * 6), st = ((id & 1 ? r : c) % 2) ? 1 : .92; fieldT[i] = 1; tmp.copy(FIELDC[id % 6]).multiplyScalar(st * (.96 + hash2(i, 9) * .07)); done = true; }
      }
      if (!done) tmp.multiplyScalar(j);
      this.baseCol[k * 3] = tmp.r; this.baseCol[k * 3 + 1] = tmp.g; this.baseCol[k * 3 + 2] = tmp.b;
    });

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
        const cc = TREEC[k]!, c = cc[Math.floor(rng.next() * cc.length)], s = .8 + rng.next() * .5;
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
    this.treeMesh = new THREE.InstancedMesh(boxGeo, this.bag.add(new THREE.MeshLambertMaterial()), Math.max(1, treeRegion.length));
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
      const n = size === 3 ? 96 : size === 2 ? 50 : 18, R = size === 3 ? .44 : size === 2 ? .31 : .17;
      for (let k = 0; k < n; k++) {
        const a = rng.next() * 6.283, r = Math.sqrt(rng.next()) * R, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const ti = tileAtW(x, z); if (ti < 0 || !land[ti]) continue;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const j = ti + dr * COLS + dc; if (j >= 0 && j < N && land[j]) this.cityT[j] = 1; }
        const y = tileH[ti], w = .05 + rng.next() * .05, d = .05 + rng.next() * .05, h = .04 + rng.next() * .05 + (size === 3 && r < .12 ? .05 : 0), rot = rng.next() < .5, ww = rot ? d : w, dd = rot ? w : d;
        houses.push([x, y + h / 2, z, ww, h, dd, WALLS[Math.floor(rng.next() * 4)]]);
        const rc = ROOFS[Math.floor(rng.next() * 5)]; houses.push([x, y + h + .008, z, ww + .012, .016, dd + .012, rc]); houses.push([x, y + h + .022, z, ww * .55, .014, dd + .006, rc]);
      }
      if (size >= 2) { const y = tileH[ci]; houses.push([cx, y + .12, cz, .045, .24, .045, WALLS[3]]); houses.push([cx, y + .27, cz, .024, .07, .024, ROOFS[2]]); }
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
          houses.push([x, y + h / 2, z, ww, h, dd, WALLS[Math.floor(rng.next() * 4)]]); const rc = ROOFS[Math.floor(rng.next() * 5)];
          houses.push([x, y + h + .007, z, ww + .01, .013, dd + .01, rc]); houses.push([x, y + h + .018, z, ww * .5, .011, dd + .004, rc]);
        }
        if (rng.next() < .45) { const y = tileH[i]; houses.push([cx + .07, y + .05, cz - .06, .018, .1, .018, WALLS[3]]); houses.push([cx + .07, y + .11, cz - .06, .02, .025, .02, ROOFS[2]]); }
      }
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
          const y0 = hAt(x0, z0) + .012, y1 = hAt(x1, z1) + .012;
          rpts.push(x0, y0, z0, x1, y1, z1); rcols.push(RAIL.r, RAIL.g, RAIL.b, RAIL.r, RAIL.g, RAIL.b);
          if (s % 2 === 0) { rpts.push(x0 - uz * .035, y0, z0 + ux * .035, x0 + uz * .035, y0, z0 - ux * .035); rcols.push(TIE.r, TIE.g, TIE.b, TIE.r, TIE.g, TIE.b); }
          const ti = tileAtW(x0, z0); if (ti >= 0 && !river[ti]) this.roadT[ti] = 1;
        }
      }
    }
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
    const lines = new THREE.LineSegments(lg, this.bag.add(new THREE.LineDashedMaterial({ color: 0xb8c0a4, dashSize: .6, gapSize: .5, transparent: true, opacity: .5 })));
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

  /** Terrain height at the anchor tile of a region (used for flags, buildings and figures). */
  anchorH(rid: number) { return this.tileH[this.world.regions[rid].anchor]; }

  /**
   * Recolour one region. `hl`: 0 none, 1 hover, 2 selected, 3 valid attack target. `owners` is the current owner of every region
   * (needed for border shading against neighbours).
   */
  paintRegion(rid: number, owners: ArrayLike<number>, hl: 0 | 1 | 2 | 3) {
    const reg = this.world.regions[rid], owner = owners[rid], fc = facCol[owner] ?? WHITE;
    const { river, borderNb } = this.world;
    const A = this.tileMesh.instanceColor!.array as Float32Array, base = this.baseCol, NA = this.natAttr.array as Float32Array;
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
      nr += (fc.r - nr) * .1; ng += (fc.g - ng) * .1; nbb += (fc.b - nbb) * .1;
      const nb = borderNb[i];
      if (nb >= 0) { const m = owners[nb] === owner ? .8 : .52; r = fc.r * m; g = fc.g * m; b = fc.b * m; if (owners[nb] !== owner) { nr = r; ng = g; nbb = b; } }
      if (hlC) { r += (hlC.r - r) * hlA; g += (hlC.g - g) * hlA; b += (hlC.b - b) * hlA; nr += (hlC.r - nr) * hlA; ng += (hlC.g - ng) * hlA; nbb += (hlC.b - nbb) * hlA; }
      A[k] = r; A[k + 1] = g; A[k + 2] = b; NA[k] = nr; NA[k + 1] = ng; NA[k + 2] = nbb;
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

  /** Call after one or more paintRegion calls. */
  commitColors() {
    this.tileMesh.instanceColor!.needsUpdate = true; this.natAttr.needsUpdate = true;
    if (this.treeMesh.instanceColor) this.treeMesh.instanceColor.needsUpdate = true;
  }

  setCameraDistance(dist: number) {
    uNear.value = 1 - clamp((dist - 9) / 14, 0, 1);
    const o = 1 - clamp((dist - 22) / 18, 0, 1);
    this.railMat.opacity = o * o * (3 - 2 * o); this.railMat.visible = this.railMat.opacity > .02;
  }

  dispose() {
    for (const o of this.objects) o.removeFromParent();
    this.tileMesh.dispose(); this.treeMesh.dispose(); this.houseMesh.dispose();
    this.bag.disposeAll();
  }
}
