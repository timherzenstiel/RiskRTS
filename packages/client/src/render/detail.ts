// Close-up ground, built only for the map chunks near the camera. Each chunk is
//  - a smooth surface mesh laid over the voxel tiles (half-tile vertices, ramps between height steps) painted by groundPaint.ts, and
//  - fine props made of small boxes: layered pines, round-crowned broadleaf trees, palms, acacias, boulders, bushes, hedgerows,
//    farmsteads, cattle, reeds, telegraph poles.
// Deterministic per tile, so every client sees the same land. Voxel trees in a drawn chunk are hidden (Terrain.coverTex).
import * as THREE from 'three';
import { COLS, HH, HW, N, ROWS, TS, hash2, tx, tz, type World } from '@riskrts/shared';
import { boxGeo } from './pools';
import { groundMaterial, uPx } from './groundPaint';
import { DCC, DCR, DETAIL_CH as CH, type Terrain } from './terrain';
import { col } from './util';

const C = {
  tuftT: ['#3a4f27', '#4b5f31', '#5a6b39'].map(col), tuftS: ['#7d744a', '#8c8252', '#6d6740'].map(col),
  rock: ['#7a7365', '#8d8576', '#625d53'].map(col), rockA: ['#8a6a48', '#9c7a52', '#6e5338'].map(col), snow: ['#dfe2dd', '#c7cdcb'].map(col),
  bush: ['#2c4224', '#36502b', '#304a28'].map(col), hedge: col('#2e4626'), wall: col('#bdb39a'), roof: col('#74392b'), barn: col('#6a2c21'),
  hay: col('#b7a256'), cow: col('#e2ddd2'), cow2: col('#4f3a2b'), pole: col('#43352a'), reed: col('#5f7640'), ice: col('#b9cbd0'), trunk: col('#3b2a1c'),
  pine: ['#1f3324', '#273d2a', '#2d4530'].map(col), leaf: ['#334a24', '#3d562a', '#46602f', '#2c421f'].map(col), jungle: ['#1f3d1b', '#28492a', '#2f5426'].map(col),
  acacia: ['#4f5a2a', '#5a6431'].map(col), palm: col('#3f5f2a'), tundra: col('#4a5240'), door: col('#232018'),
};

interface Chunk { ground: THREE.Mesh; props: THREE.InstancedMesh | null; last: number }

function tileIdx(x: number, z: number) {
  const c = Math.floor((x + HW) / TS), r = Math.floor((z + HH) / TS);
  return c < 0 || c >= COLS || r < 0 || r >= ROWS ? -1 : r * COLS + c;
}

export class GroundDetail {
  private readonly chunks = new Map<number, Chunk>();
  private readonly mat = new THREE.MeshLambertMaterial();
  private readonly gmat: THREE.MeshLambertMaterial;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private frame = 0;
  private readonly hasLand: Uint8Array;
  private readonly treesIn: number[][];
  private coverDirty = false;

  constructor(private readonly scene: THREE.Scene, private readonly world: World, private readonly terrain: Terrain) {
    this.hasLand = new Uint8Array(DCC * DCR);
    for (let i = 0; i < N; i++) if (world.land[i]) this.hasLand[this.chunkOf(i)] = 1;
    this.treesIn = Array.from({ length: DCC * DCR }, () => []);
    const T = terrain.treeRec;
    for (let k = 0; k < T.length; k += 7) { const i = tileIdx(T[k], T[k + 1]); if (i >= 0) this.treesIn[this.chunkOf(i)].push(k); }
    this.gmat = groundMaterial(terrain);
  }

  private chunkOf(i: number) { return Math.floor(((i / COLS) | 0) / CH) * DCC + Math.floor((i % COLS) / CH); }

  /** Show detail around (x,z) when the camera is close. `ppu` = screen pixels per world unit. Builds at most one chunk per frame. */
  update(x: number, z: number, dist: number, aspect: number, ppu: number) {
    this.frame++;
    uPx.value = Math.min(256, Math.max(32, 2 ** Math.floor(Math.log2(Math.max(1, ppu / 1.6)))));
    if (dist < 16) {
      const RX = dist * .36 * aspect + 1.2, RZ = dist * .4 + 1.2, span = CH * TS;
      const c0 = Math.floor((x - RX + HW) / span), c1 = Math.floor((x + RX + HW) / span);
      const r0 = Math.max(0, Math.floor((z - RZ + HH) / span)), r1 = Math.min(DCR - 1, Math.floor((z + RZ + HH) / span));
      let built = 0;
      const want: [number, number][] = [];
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const cw = ((c % DCC) + DCC) % DCC, k = r * DCC + cw; if (!this.hasLand[k]) continue; want.push([k, Math.hypot(c - (c0 + c1) / 2, r - (r0 + r1) / 2)]); }
      want.sort((a, b) => a[1] - b[1]);
      for (const [k] of want) {
        const ch = this.chunks.get(k);
        if (ch) { ch.last = this.frame; this.show(k, ch, true); continue; }
        if (built++ >= 1) continue;
        const nc = this.build(k); nc.last = this.frame; this.chunks.set(k, nc); this.show(k, nc, true);
      }
    }
    for (const [k, ch] of this.chunks) {
      if (ch.last !== this.frame) this.show(k, ch, false);
      if (this.frame - ch.last > 900 || (this.chunks.size > 90 && ch.last !== this.frame)) { this.free(ch); this.chunks.delete(k); }
    }
    if (this.coverDirty) { this.terrain.coverTex.needsUpdate = true; this.coverDirty = false; }
  }

  /** Build every chunk in view at once (dev tooling: screenshots). */
  buildAll(x: number, z: number, dist: number, aspect: number, ppu: number) { for (let n = 0; n < 80; n++) this.update(x, z, dist, aspect, ppu); }

  private show(k: number, ch: Chunk, on: boolean) {
    if (ch.ground.visible === on) return;
    ch.ground.visible = on; if (ch.props) ch.props.visible = on;
    this.terrain.coverData[k] = on ? 255 : 0; this.coverDirty = true;
  }

  private free(ch: Chunk) {
    this.scene.remove(ch.ground); ch.ground.geometry.dispose();
    if (ch.props) { this.scene.remove(ch.props); ch.props.dispose(); }
  }

  private build(k: number): Chunk { return { ground: this.buildGround(k), props: this.buildProps(k), last: 0 }; }

  /** Smooth surface over the chunk's land tiles: 2x2 quads per tile, vertices shared so normals are smooth. */
  private buildGround(k: number): THREE.Mesh {
    const land = this.world.land, T = this.terrain, cr = Math.floor(k / DCC), cc = k % DCC, G = 2 * CH + 1;
    const gx0 = cc * CH * 2, gy0 = cr * CH * 2, idx = new Int32Array(G * G).fill(-1), pos: number[] = [], ind: number[] = [];
    const vert = (lx: number, ly: number) => {
      const o = ly * G + lx; if (idx[o] >= 0) return idx[o];
      const gx = gx0 + lx, gy = gy0 + ly; idx[o] = pos.length / 3;
      pos.push(gx * TS / 2 - HW, T.vtxH(gx, gy), gy * TS / 2 - HH); return idx[o];
    };
    for (let r = cr * CH; r < Math.min(ROWS, cr * CH + CH); r++) for (let c = cc * CH; c < Math.min(COLS, cc * CH + CH); c++) {
      if (!land[r * COLS + c]) continue;
      const lx = (c - cc * CH) * 2, ly = (r - cr * CH) * 2;
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const a = vert(lx + sx, ly + sy), b = vert(lx + sx + 1, ly + sy), d = vert(lx + sx, ly + sy + 1), e = vert(lx + sx + 1, ly + sy + 1);
        ind.push(a, d, b, b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(ind); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.gmat);
    mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.visible = false;
    this.scene.add(mesh);
    return mesh;
  }

  private buildProps(k: number): THREE.InstancedMesh | null {
    const { land, river, terrOf } = this.world, T = this.terrain, H = T.tileH, out: number[] = [];
    const cr = Math.floor(k / DCC), cc = k % DCC;
    const yAt = (x: number, z: number) => T.surfaceAt(x, z);
    /** Box whose base sits at height y. */
    const add = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: THREE.Color, yaw = 0) => out.push(x, y + sy / 2, z, sx, sy, sz, c.r, c.g, c.b, yaw);
    const shade = (c: THREE.Color, f: number) => new THREE.Color(c.r * f, c.g * f, c.b * f);
    const pick = <V,>(a: V[], h: number) => a[Math.floor(h * a.length) % a.length];

    // ---- trees (at the positions of the strategic view's voxel trees), each with a smaller companion or two
    const tree = (x: number, z: number, s: number, bio: number, ci: number, h: number) => {
      const y = yAt(x, z), yaw = h * 6.28;
      // biomes: 3 tundra 5 jungle 6 taiga 8 savanna 9 temperate
      if (bio === 6 || (bio === 9 && h < .3)) { // layered pine
        const c = pick(C.pine, ci / 3 + h * .3); add(x, y, z, .014 * s, .04 * s, .014 * s, C.trunk);
        for (let t = 0; t < 5; t++) {
          const w = .12 * s * (1 - t * .18), ty = y + (.028 + t * .028) * s;
          add(x, ty, z, w, .03 * s, w, shade(c, t % 2 ? 1.12 : .86), yaw + (t % 2) * .785);
          add(x - w * .18, ty + .012 * s, z - w * .18, w * .45, .022 * s, w * .45, shade(c, 1.45), yaw);
        }
        add(x, y + .165 * s, z, .016 * s, .035 * s, .016 * s, shade(c, 1.2));
      } else if (bio === 5 && h < .35) { // palm
        add(x, y, z, .012 * s, .13 * s, .012 * s, C.trunk, yaw);
        for (let t = 0; t < 4; t++) add(x, y + .125 * s, z, .15 * s, .008 * s, .028 * s, shade(C.palm, t % 2 ? 1.2 : .9), yaw + t * .785);
      } else if (bio === 8) { // acacia
        const c = pick(C.acacia, h); add(x, y, z, .012 * s, .075 * s, .012 * s, C.trunk);
        add(x, y + .07 * s, z, .17 * s, .022 * s, .14 * s, c, yaw); add(x - .015 * s, y + .088 * s, z - .015 * s, .1 * s, .014 * s, .08 * s, shade(c, 1.3), yaw);
      } else if (bio === 3) { // tundra shrub
        add(x, y, z, .05 * s, .03 * s, .05 * s, C.tundra, yaw); add(x - .01, y + .02 * s, z - .01, .03 * s, .02 * s, .03 * s, shade(C.tundra, 1.3), yaw);
      } else { // broadleaf: a round crown of overlapping blobs, lit from the top-left
        const base = bio === 5 ? pick(C.jungle, ci / 3) : pick(C.leaf, ci / 4 + h * .2), big = bio === 5 ? 1.25 : 1;
        add(x, y, z, .018 * s, .07 * s, .018 * s, C.trunk);
        const B: [number, number, number, number][] = [[0, .085, 0, .11], [-.04, .1, -.03, .075], [.045, .08, .02, .08], [-.02, .075, .05, .075], [.03, .11, -.04, .065], [.01, .125, .005, .07], [-.025, .135, -.02, .045]];
        for (let n = 0; n < B.length; n++) {
          const [ox, oy, oz, w] = B[n], f = Math.min(1.45, Math.max(.7, 1 + (-ox - oz) * 3.5 + (oy - .1) * 4));
          add(x + ox * s * big, y + (oy - w * .4) * s * big, z + oz * s * big, w * s * big, w * .8 * s * big, w * s * big, shade(base, f), yaw + n * .6);
        }
      }
    };
    const TR = T.treeRec;
    if (!T.hasScenery) for (const t of this.treesIn[k]) {
      const x = TR[t], z = TR[t + 1], s = TR[t + 3], bio = TR[t + 4], ci = TR[t + 5], h = hash2(t, 77);
      tree(x, z, s, bio, ci, h);
      for (let n = 0; n < 2; n++) {
        if (hash2(t, 80 + n) > .55) continue;
        const a = hash2(t, 90 + n) * 6.28, d = .07 + hash2(t, 95 + n) * .06, x2 = x + Math.cos(a) * d, z2 = z + Math.sin(a) * d, i2 = tileIdx(x2, z2);
        if (i2 < 0 || !land[i2] || river[i2] || T.fieldT[i2] || T.cityT[i2] || T.roadT[i2]) continue;
        tree(x2, z2, s * (.55 + hash2(t, 99 + n) * .3), bio, ci, hash2(t, 101 + n));
      }
    }

    // ---- per-tile props
    for (let r = cr * CH; r < Math.min(ROWS, cr * CH + CH); r++) for (let c = cc * CH; c < Math.min(COLS, cc * CH + CH); c++) {
      const i = r * COLS + c; if (!land[i]) continue;
      const x0 = tx(c), z0 = tz(r), bio = T.biome[i], hs = (n: number) => hash2(i * 7 + n, n * 13 + 5);
      const jx = (n: number) => x0 + (hs(n) - .5) * TS * .9, jz = (n: number) => z0 + (hs(n + 50) - .5) * TS * .9;
      const at = (n: number) => yAt(jx(n), jz(n));
      const boulder = (n: number, size: number, arid: boolean) => {
        const x = jx(n), z = jz(n), y = yAt(x, z), base = arid ? pick(C.rockA, hs(n + 1)) : pick(C.rock, hs(n + 1)), yaw = hs(n + 2) * 3;
        add(x, y - .004, z, size, size * .6, size * .85, shade(base, .8), yaw);
        add(x - size * .12, y + size * .25, z - size * .1, size * .65, size * .4, size * .55, shade(base, 1.25), yaw);
        if (hs(n + 3) < .5) add(x + size * .5, y - .003, z + size * .2, size * .45, size * .35, size * .4, base, yaw + 1);
      };
      // biomes: 0 ice 1 snow 2 rock 3 tundra 4 desert 5 jungle 6 taiga 7 steppe 8 savanna 9 temperate 10 beach
      if (river[i]) {
        for (let n = 0; n < 7; n++) if (hs(n) < .5) { const x = jx(n), z = jz(n); add(x, yAt(x, z), z, .005, .025 + hs(n + 9) * .02, .005, C.reed, hs(n + 4) * 3); }
        continue;
      }
      if (T.cityT[i]) continue;
      if (T.fieldT[i]) {
        // hedgerows where the field meets other ground
        const L = c > 0 && land[i - 1] && !T.fieldT[i - 1] && !river[i - 1], Rr = c < COLS - 1 && land[i + 1] && !T.fieldT[i + 1] && !river[i + 1];
        const U = i >= COLS && land[i - COLS] && !T.fieldT[i - COLS], D = i + COLS < N && land[i + COLS] && !T.fieldT[i + COLS];
        const hedge = (x: number, z: number, along: boolean) => { for (let n = 0; n < 6; n++) { const t = (n + .5) / 6 - .5, hx = along ? x + t * TS : x, hz = along ? z : z + t * TS; add(hx, yAt(hx, hz), hz, along ? .06 : .022, .022 + hash2(i, n) * .012, along ? .022 : .06, shade(C.hedge, .85 + hash2(n, i) * .35)); } };
        if (L) hedge(x0 - TS / 2 + .012, z0, false); if (Rr) hedge(x0 + TS / 2 - .012, z0, false);
        if (U) hedge(x0, z0 - TS / 2 + .012, true); if (D) hedge(x0, z0 + TS / 2 - .012, true);
        if (hs(3) < .035) { // farmstead
          const fx = jx(4), fz = jz(4), h = yAt(fx, fz);
          add(fx, h, fz, .055, .035, .045, C.wall); add(fx, h + .035, fz - .011, .062, .012, .026, shade(C.roof, 1.2)); add(fx, h + .035, fz + .011, .062, .012, .026, shade(C.roof, .8)); add(fx, h + .047, fz, .062, .006, .008, C.roof);
          add(fx - .012, h, fz + .023, .012, .02, .003, C.trunk); add(fx + .015, h + .016, fz + .023, .01, .008, .003, C.door);
          add(fx + .07, h, fz + .01, .06, .045, .04, C.barn); add(fx + .07, h + .045, fz + .01, .066, .012, .046, shade(C.roof, .9));
          add(fx - .05, h, fz + .05, .025, .02, .02, C.hay); add(fx - .02, h, fz + .06, .02, .018, .018, shade(C.hay, .85));
        } else if (hs(5) < .25) for (let n = 0; n < 3; n++) { const x = jx(5) + n * .02, z = jz(5) + (n % 2) * .015; add(x, yAt(x, z), z, .014, .012, .014, shade(C.hay, .9 + n * .08)); }
        continue;
      }
      if (T.roadT[i] && hs(2) < .35) { const px = x0 + .11, pz = z0 + .11, h = yAt(px, pz); add(px, h, pz, .005, .055, .005, C.pole); add(px, h + .048, pz, .022, .004, .004, C.pole); }
      if (bio === 0) { for (let n = 0; n < 2; n++) if (hs(n) < .5) add(jx(n), at(n), jz(n), .03 + hs(n + 3) * .04, .01 + hs(n + 4) * .02, .03, C.ice, hs(n + 5) * 3); continue; }
      if (bio === 1) { for (let n = 0; n < 3; n++) if (hs(n) < .55) add(jx(n), at(n), jz(n), .02 + hs(n + 3) * .04, .012 + hs(n + 4) * .02, .02 + hs(n + 5) * .03, pick(C.snow, hs(n + 6)), hs(n + 7) * 3); continue; }
      if (bio === 2) { for (let n = 0; n < 3; n++) if (hs(n) < .6) boulder(n, .03 + hs(n + 3) * .035, false); continue; }
      if (bio === 4 || bio === 10) {
        if (hs(1) < .3) boulder(1, .025 + hs(2) * .03, true);
        if (bio === 4 && hs(7) < .08) { const x = jx(7), z = jz(7); add(x, yAt(x, z), z, .025, .016, .025, shade(C.acacia[0], .8)); }
        continue;
      }
      const arid = bio === 7 || bio === 8, tufts = arid ? C.tuftS : C.tuftT;
      for (let n = 0; n < 3; n++) if (hs(n) < .6) { const x = jx(n), z = jz(n); add(x, yAt(x, z), z, .008, .01 + hs(n + 20) * .01, .008, pick(tufts, hs(n + 30)), hs(n + 31) * 3); }
      if (hs(40) < (bio === 5 ? .45 : .2)) { // bush clump
        const x = jx(40), z = jz(40), y = yAt(x, z), b = pick(C.bush, hs(43)), w = .03 + hs(41) * .02;
        add(x, y, z, w, w * .6, w, shade(b, .85), hs(42) * 3); add(x - w * .2, y + w * .3, z - w * .2, w * .65, w * .45, w * .65, shade(b, 1.3), hs(44) * 3);
        if (hs(45) < .6) add(x + w * .55, y, z + w * .2, w * .6, w * .45, w * .6, b, hs(46) * 3);
      }
      if ((H[i] > .5 || arid) && hs(47) < (arid ? .2 : .3)) boulder(47, .02 + hs(48) * .03, arid);
      // grazing cattle on temperate pasture
      if (bio === 9 && hs(60) < .03) for (let n = 0; n < 3; n++) {
        const cx2 = jx(61 + n), cz2 = jz(61 + n), cc2 = hs(70 + n) < .6 ? C.cow : C.cow2, yaw = hs(80 + n) * 6.28, h = yAt(cx2, cz2), sn = Math.sin(yaw), cs = Math.cos(yaw);
        add(cx2, h + .005, cz2, .011, .009, .02, cc2, yaw); add(cx2 + sn * .012, h + .009, cz2 + cs * .012, .007, .007, .008, cc2, yaw);
        for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(cx2 + cs * lx * .003 + sn * lz * .007, h, cz2 - sn * lx * .003 + cs * lz * .007, .002, .006, .002, C.cow2, yaw);
      }
      // scree where the ground steps down sharply
      if (c < COLS - 1 && land[i + 1] && terrOf[i + 1] === terrOf[i] && H[i] - H[i + 1] > .07) boulder(90, .02, arid);
    }
    const n = out.length / 10; if (!n) return null;
    const mesh = new THREE.InstancedMesh(boxGeo, this.mat, n);
    mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = true; mesh.visible = false;
    const cl = new THREE.Color();
    for (let q = 0; q < n; q++) {
      const o = q * 10;
      this.q.setFromAxisAngle(this.up, out[o + 9]); this.v.set(out[o], out[o + 1], out[o + 2]); this.sc.set(out[o + 3], out[o + 4], out[o + 5]);
      this.m4.compose(this.v, this.q, this.sc); mesh.setMatrixAt(q, this.m4); cl.setRGB(out[o + 6], out[o + 7], out[o + 8]); mesh.setColorAt(q, cl);
    }
    this.scene.add(mesh);
    return mesh;
  }

  dispose() {
    for (const ch of this.chunks.values()) this.free(ch);
    this.chunks.clear(); this.mat.dispose(); this.gmat.dispose();
    this.terrain.coverData.fill(0);
  }
}
