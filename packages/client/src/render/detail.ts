// Close-up ground detail, built only for the map chunks near the camera: grass tufts, rocks, bushes, hedgerows,
// furrowed fields, farmsteads, livestock, telegraph poles, reeds. Deterministic per tile, so every client sees the same land.
import * as THREE from 'three';
import { COLS, N, ROWS, TS, hash2, tx, tz, type World } from '@riskrts/shared';
import { boxGeo } from './pools';
import type { Terrain } from './terrain';
import { col } from './util';

const CH = 12; // tiles per chunk side
const CC = Math.ceil(COLS / CH), CR = Math.ceil(ROWS / CH);
const C = {
  tuftT: ['#3f5a2c', '#56703a', '#6c8445'].map(col), tuftS: ['#8f8a52', '#a39c5e', '#7d7a46'].map(col), tuftJ: ['#24481f', '#2f5a28', '#3b6b2f'].map(col),
  rock: ['#7d776b', '#948d7f', '#686358'].map(col), sand: ['#c2a466', '#b59658', '#d2b77a'].map(col), snow: ['#e6e9e4', '#cfd6d3'].map(col),
  bush: ['#2f4a26', '#3b5a2d', '#34502a'].map(col), hedge: col('#33502a'), soil: col('#5e4a30'), wall: col('#d7ccb0'), roof: col('#8e3b2b'), barn: col('#7a2f22'),
  hay: col('#cdb560'), water: col('#3d7088'), cow: col('#efeae0'), cow2: col('#5b4030'), pole: col('#4a3a2a'), reed: col('#6f8a48'), ice: col('#bfd3d8'), path: col('#9a8763'),
};

interface Chunk { mesh: THREE.InstancedMesh; key: number; last: number }

export class GroundDetail {
  private readonly chunks = new Map<number, Chunk>();
  private readonly mat = new THREE.MeshLambertMaterial();
  private readonly m4 = new THREE.Matrix4();
  private readonly tmp = new THREE.Color();
  private frame = 0;
  private hasLand: Uint8Array;

  constructor(private readonly scene: THREE.Scene, private readonly world: World, private readonly terrain: Terrain) {
    this.hasLand = new Uint8Array(CC * CR);
    for (let i = 0; i < N; i++) if (world.land[i]) this.hasLand[Math.floor(((i / COLS) | 0) / CH) * CC + Math.floor((i % COLS) / CH)] = 1;
  }

  /** Show detail around (x,z) when the camera is close. Builds at most one new chunk per frame. */
  update(x: number, z: number, dist: number) {
    this.frame++;
    const show = dist < 24;
    if (show) {
      const R = dist * .9 + 3, span = CH * TS;
      const c0 = Math.floor((x - R + COLS * TS / 2) / span), c1 = Math.floor((x + R + COLS * TS / 2) / span);
      const r0 = Math.max(0, Math.floor((z - R * .8 + ROWS * TS / 2) / span)), r1 = Math.min(CR - 1, Math.floor((z + R * .6 + ROWS * TS / 2) / span));
      let built = 0;
      const want: [number, number][] = [];
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const cw = ((c % CC) + CC) % CC, k = r * CC + cw; if (!this.hasLand[k]) continue; want.push([k, Math.hypot(c - (c0 + c1) / 2, r - (r0 + r1) / 2)]); }
      want.sort((a, b) => a[1] - b[1]);
      for (const [k] of want) {
        const ch = this.chunks.get(k);
        if (ch) { ch.last = this.frame; ch.mesh.visible = true; continue; }
        if (built++ >= 1) continue;
        const mesh = this.build(k); if (mesh) this.chunks.set(k, { mesh, key: k, last: this.frame });
      }
    }
    for (const [k, ch] of this.chunks) {
      if (ch.last !== this.frame) ch.mesh.visible = false;
      if (this.frame - ch.last > 600 || (this.chunks.size > 60 && ch.last !== this.frame)) { this.scene.remove(ch.mesh); ch.mesh.dispose(); this.chunks.delete(k); }
    }
  }

  private build(k: number): THREE.InstancedMesh | null {
    const { land, river, terrOf } = this.world, T = this.terrain, H = T.tileH, out: number[] = [];
    const cr = Math.floor(k / CC), cc = k % CC;
    const add = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: THREE.Color) => out.push(x, y + sy / 2, z, sx, sy, sz, c.r, c.g, c.b);
    const pick = <T,>(a: T[], h: number) => a[Math.floor(h * a.length) % a.length];
    for (let r = cr * CH; r < Math.min(ROWS, cr * CH + CH); r++) for (let c = cc * CH; c < Math.min(COLS, cc * CH + CH); c++) {
      const i = r * COLS + c; if (!land[i]) continue;
      const x0 = tx(c), z0 = tz(r), h = H[i], bio = T.biome[i], hs = (n: number) => hash2(i * 7 + n, n * 13 + 5);
      const jx = (n: number) => x0 + (hs(n) - .5) * TS * .9, jz = (n: number) => z0 + (hs(n + 50) - .5) * TS * .9;
      // biomes: 0 ice 1 snow 2 rock 3 tundra 4 desert 5 jungle 6 taiga 7 steppe 8 savanna 9 temperate 10 beach
      if (river[i]) {
        // a winding channel joining neighbouring river tiles, with reeds on the banks
        const w = .1, wy = h, links = [c > 0 && river[i - 1] ? [-1, 0] : null, c < COLS - 1 && river[i + 1] ? [1, 0] : null, i >= COLS && river[i - COLS] ? [0, -1] : null, i + COLS < N && river[i + COLS] ? [0, 1] : null,
          c > 0 && i >= COLS && river[i - COLS - 1] && !river[i - 1] && !river[i - COLS] ? [-1, -1] : null, c < COLS - 1 && i >= COLS && river[i - COLS + 1] && !river[i + 1] && !river[i - COLS] ? [1, -1] : null,
          c > 0 && i + COLS < N && river[i + COLS - 1] && !river[i - 1] && !river[i + COLS] ? [-1, 1] : null, c < COLS - 1 && i + COLS < N && river[i + COLS + 1] && !river[i + 1] && !river[i + COLS] ? [1, 1] : null];
        let lk = 0;
        add(x0, wy, z0, w * 1.15, .006, w * 1.15, C.water);
        for (const l of links) {
          if (!l) continue; lk++;
          const [dx, dz] = l, len = Math.hypot(dx, dz) * TS / 2, mx = x0 + dx * TS / 4, mz = z0 + dz * TS / 4;
          if (dx && dz) { const n = 4; for (let q = 0; q < n; q++) { const t = (q + .5) / n; add(x0 + dx * TS / 2 * t, wy, z0 + dz * TS / 2 * t, w, .006, w, C.water); } }
          else add(mx, wy, mz, dx ? len + .01 : w, .006, dz ? len + .01 : w, C.water);
        }
        if (!lk) add(x0, wy, z0, w * 1.8, .006, w * 1.4, C.water);
        for (let n = 0; n < 5; n++) if (hs(n) < .55) add(jx(n), h, jz(n), .008, .03 + hs(n + 9) * .02, .008, C.reed);
        for (let n = 0; n < 3; n++) if (hs(n + 20) < .6) add(jx(n + 20), h, jz(n + 20), .01, .014, .01, pick(C.tuftT, hs(n + 30)));
        continue;
      }
      if (T.cityT[i]) { if (hs(1) < .3) add(jx(1), h, jz(1), .03, .004, .03, C.path); continue; }
      if (T.fieldT[i]) {
        const vert = ((Math.floor(c / 3) + Math.floor(r / 3)) & 1) === 1, bk = T.instOf[i] * 3, soil = this.tmp.setRGB(T.baseCol[bk] * .86, T.baseCol[bk + 1] * .84, T.baseCol[bk + 2] * .82).clone();
        for (let n = -1; n <= 1; n++) { const o = n * TS * .28; if (vert) add(x0 + o, h, z0, .01, .003, TS * .9, soil); else add(x0, h, z0 + o, TS * .9, .003, .01, soil); }
        // hedgerows where the field meets other ground
        const L = c > 0 && land[i - 1] && !T.fieldT[i - 1] && !river[i - 1], Rr = c < COLS - 1 && land[i + 1] && !T.fieldT[i + 1] && !river[i + 1];
        const U = i >= COLS && land[i - COLS] && !T.fieldT[i - COLS], D = i + COLS < N && land[i + COLS] && !T.fieldT[i + COLS];
        if (L) add(x0 - TS / 2 + .01, h, z0, .02, .03, TS, C.hedge); if (Rr) add(x0 + TS / 2 - .01, h, z0, .02, .03, TS, C.hedge);
        if (U) add(x0, h, z0 - TS / 2 + .01, TS, .03, .02, C.hedge); if (D) add(x0, h, z0 + TS / 2 - .01, TS, .03, .02, C.hedge);
        if (hs(3) < .035) { // farmstead
          const fx = jx(4), fz = jz(4); add(fx, h, fz, .055, .035, .045, C.wall); add(fx, h + .035, fz, .062, .012, .05, C.roof); add(fx, h + .047, fz, .03, .01, .05, C.roof);
          add(fx + .07, h, fz + .01, .06, .045, .04, C.barn); add(fx + .07, h + .045, fz + .01, .066, .012, .046, C.roof);
          add(fx - .05, h, fz + .05, .025, .02, .02, C.hay); add(fx - .02, h, fz + .06, .02, .018, .018, C.hay);
        } else if (hs(5) < .2) add(jx(5), h, jz(5), .02, .015, .018, C.hay);
        continue;
      }
      if (T.roadT[i] && hs(2) < .35) { add(x0 + .1, h, z0 + .1, .005, .055, .005, C.pole); add(x0 + .1, h + .05, z0 + .1, .02, .004, .004, C.pole); }
      if (bio === 0) { for (let n = 0; n < 2; n++) if (hs(n) < .5) add(jx(n), h, jz(n), .03 + hs(n + 3) * .04, .01 + hs(n + 4) * .02, .03, C.ice); continue; }
      if (bio === 1 || bio === 2) { for (let n = 0; n < 3; n++) if (hs(n) < .55) add(jx(n), h, jz(n), .02 + hs(n + 3) * .04, .015 + hs(n + 4) * .03, .02 + hs(n + 5) * .03, bio === 1 ? pick(C.snow, hs(n + 6)) : pick(C.rock, hs(n + 6))); continue; }
      if (bio === 4 || bio === 10) {
        if (hs(0) < .5) add(jx(0), h, jz(0), TS * .6, .003, .01, pick(C.sand, hs(9)));
        if (hs(1) < .2) add(jx(1), h, jz(1), .02 + hs(2) * .02, .012 + hs(3) * .015, .02, pick(C.rock, hs(4)));
        if (bio === 4 && hs(7) < .05) add(jx(7), h, jz(7), .025, .02, .025, C.bush[0]);
        continue;
      }
      const tufts = bio === 5 ? C.tuftJ : bio === 7 || bio === 8 ? C.tuftS : C.tuftT, nT = bio === 5 ? 6 : bio === 3 ? 2 : 4;
      for (let n = 0; n < nT; n++) if (hs(n) < .75) add(jx(n), h, jz(n), .01, .012 + hs(n + 20) * .014, .01, pick(tufts, hs(n + 30)));
      if (hs(40) < (bio === 5 ? .4 : .16)) add(jx(40), h, jz(40), .035 + hs(41) * .02, .022 + hs(42) * .015, .035, pick(C.bush, hs(43)));
      if (h > .55 && hs(44) < .35) add(jx(44), h, jz(44), .025 + hs(45) * .03, .015 + hs(46) * .02, .025, pick(C.rock, hs(47)));
      // grazing cattle on temperate pasture next to fields
      if (bio === 9 && hs(60) < .03) for (let n = 0; n < 3; n++) { const cx2 = jx(61 + n), cz2 = jz(61 + n), cc2 = hs(70 + n) < .6 ? C.cow : C.cow2, f = hs(80 + n) < .5; add(cx2, h + .004, cz2, f ? .018 : .01, .009, f ? .01 : .018, cc2); }
      // cliff rubble where the ground steps down sharply
      if (c < COLS - 1 && land[i + 1] && terrOf[i + 1] === terrOf[i] && H[i] - H[i + 1] > .07) add(x0 + TS / 2, H[i + 1], z0 + (hs(90) - .5) * .2, .03, .03, .04, pick(C.rock, hs(91)));
    }
    const n = out.length / 9; if (!n) return null;
    const mesh = new THREE.InstancedMesh(boxGeo, this.mat, n);
    mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false;
    const cl = new THREE.Color();
    for (let q = 0; q < n; q++) {
      const o = q * 9; this.m4.makeScale(out[o + 3], out[o + 4], out[o + 5]); this.m4.setPosition(out[o], out[o + 1], out[o + 2]);
      mesh.setMatrixAt(q, this.m4); cl.setRGB(out[o + 6], out[o + 7], out[o + 8]); mesh.setColorAt(q, cl);
    }
    this.scene.add(mesh);
    return mesh;
  }

  dispose() { for (const ch of this.chunks.values()) { this.scene.remove(ch.mesh); ch.mesh.dispose(); } this.chunks.clear(); this.mat.dispose(); }
}
