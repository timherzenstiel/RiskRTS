// One zoomed-in battlefield: a dithered pixel-art ground canvas (trenches, wire, craters, camps), static props, and per-agent display smoothing.
import * as THREE from 'three';
import { Rng, hash2, trenchX, vnoise, type Agent, type Battle, type UnitType } from '@riskrts/shared';
import type { Models } from './models';
import type { FxSystem } from './fxSystem';
import { K } from './palette';
import { clamp, hex3, seedOf, smooth } from './util';

/** World units per battle-local unit; the battlefield is BF_W x BF_H local units. */
export const BS = .11, BF_W = 48, BF_H = 34;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const MUD = ['#352c20', '#3f3424', '#4a3d2a', '#55462f', '#605136', '#6b5b3d'].map(hex3);
const GRASS = ['#43502c', '#4d5a32', '#586638', '#64723f', '#6f7d47'].map(hex3);

type PropKind = 'stump' | 'ruin' | 'crate' | 'barrel' | 'tent' | 'wagon' | 'tower' | 'dugout' | 'cross' | 'bag' | 'post' | 'bush' | 'hay' | 'fire';
interface Prop { k: PropKind; wx: number; wz: number; r: number; h: number }
interface Disp { x: number; z: number; deadAt: number }

export class BattleView {
  readonly mesh: THREE.Mesh;
  readonly cx: number; readonly cz: number; readonly y: number;
  readonly ax: number; readonly az: number; readonly px: number; readonly pz: number;
  private readonly cv: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private readonly props: Prop[] = [];
  private readonly disp: Disp[] = [];
  private readonly TW: number; private readonly TH: number; private readonly K2: number;
  private texDirty = false;
  /** Distant-view smoke timer. */
  puffT = 0; flareT = 3;

  constructor(private readonly scene: THREE.Scene, readonly battle: Battle, cx: number, cz: number, y: number, private readonly ppm: number) {
    this.cx = cx; this.cz = cz; this.y = y; this.ax = battle.ax; this.az = battle.az; this.px = -battle.az; this.pz = battle.ax;
    this.K2 = ppm / 4; this.TW = BF_W * ppm; this.TH = BF_H * ppm;
    const rng = new Rng(seedOf(battle.id));
    this.cv = document.createElement('canvas'); this.cv.width = this.TW; this.cv.height = this.TH;
    this.g = this.cv.getContext('2d', { willReadFrequently: false })!;
    this.paintGround(rng);
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.magFilter = THREE.NearestFilter; this.tex.minFilter = THREE.LinearMipmapLinearFilter; this.tex.generateMipmaps = true; this.tex.anisotropy = 8; this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshLambertMaterial({ map: this.tex, transparent: true, alphaTest: .5, opacity: 0 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(BF_W * BS, BF_H * BS).rotateX(-Math.PI / 2), mat);
    this.mesh.rotation.y = Math.atan2(-this.az, this.ax); this.mesh.position.set(cx, y, cz); this.mesh.renderOrder = 2; this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.makeProps(rng);
  }

  private px_(lx: number) { return Math.round((lx + BF_W / 2) * this.ppm); }
  private py_(lz: number) { return Math.round((lz + BF_H / 2) * this.ppm); }

  private paintGround(rng: Rng) {
    const { TW, TH, K2, g, ppm } = this;
    const img = g.createImageData(TW, TH), d = img.data, seed = Math.floor(rng.next() * 999);
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      const lx = x / ppm - BF_W / 2, n = vnoise(x * .06 * 8 / ppm + seed, y * .06 * 8 / ppm) * .5 + vnoise(x * .25 * 8 / ppm, y * .25 * 8 / ppm + seed) * .3 + hash2(x + seed, y) * .2;
      const gr = smooth(-2, -10, lx) + (lx > 17 ? smooth(17, 23, lx) * .8 : 0);
      const pal = (hash2(x, y + seed) * .8 + n * .2 < gr) ? GRASS : MUD; let p = pal[Math.min(pal.length - 1, Math.floor(n * pal.length))];
      const mud = vnoise(x * .05 * 8 / ppm + 9, y * .05 * 8 / ppm + seed) > .62 && pal === MUD; if (mud) p = [p[0] * .78, p[1] * .8, p[2] * .82];
      const e = Math.min(x, TW - 1 - x, y, TH - 1 - y) / (16 * K2), th = (BAYER[(y & 3) * 4 + (x & 3)] + .5) / 16;
      const o = (y * TW + x) * 4; d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2]; d[o + 3] = e > th ? 255 : 0;
    }
    g.putImageData(img, 0, 0);
    const R = () => rng.next();
    // grass tufts, pebbles and puddles
    for (let k = 0; k < 1200 * K2 / 2; k++) { const x = Math.floor(R() * TW * .38) + 10, y = Math.floor(R() * (TH - 20)) + 10; g.fillStyle = R() < .5 ? '#86975a' : '#34401f'; g.fillRect(x, y, 1, R() < .5 ? 2 : 3); }
    for (let k = 0; k < 500 * K2 / 2; k++) { const x = Math.floor(TW * .3 + R() * TW * .65), y = Math.floor(R() * (TH - 20)) + 10; g.fillStyle = R() < .5 ? '#7f6e4d' : '#2c2217'; g.fillRect(x, y, 1 + (R() < .3 ? 1 : 0), 1); }
    for (let k = 0; k < 7; k++) {
      const x = TW * .3 + R() * TW * .6, y = 14 * K2 + R() * (TH - 28 * K2), rx = (4 + R() * 7) * K2, ry = (2 + R() * 3) * K2;
      for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) { if ((dx / rx) ** 2 + (dy / ry) ** 2 > 1) continue; g.fillStyle = dy < 0 && dx < 0 ? '#6d8582' : '#3b4a48'; g.fillRect(Math.round(x + dx), Math.round(y + dy), 1, 1); }
    }
    // wheel ruts behind the line
    for (const z of [-10, -2, 7]) { const y = this.py_(z); g.fillStyle = '#211a12'; g.fillRect(this.px_(-14), y - K2, this.px_(trenchX(z)) - this.px_(-14), 3 * K2); g.fillStyle = '#4d3d28'; g.fillRect(this.px_(-14), y + 2 * K2, this.px_(trenchX(z)) - this.px_(-14), 1); }
    // front trench with duckboards, firing step and parapet
    for (let y = 14 * K2; y < TH - 14 * K2; y++) {
      const z = y / ppm - BF_H / 2, px = this.px_(trenchX(z)), w = 3.2 * K2;
      g.fillStyle = '#171109'; g.fillRect(px - w, y, w * 2 + 1, 1);
      g.fillStyle = '#241b11'; g.fillRect(px - w, y, 2, 1); g.fillRect(px + w - 1, y, 2, 1);
      if ((y >> 1) % 3 === 0) { g.fillStyle = '#8a7550'; g.fillRect(px - w * .55, y, w * 1.1, 1); }
      g.fillStyle = ((y >> 2) % 2) ? '#a99568' : '#8d7d55'; g.fillRect(px + w + 1, y, 2 * K2, 1);
      g.fillStyle = ((y >> 2) % 2) ? '#8d7d55' : '#77683f'; g.fillRect(px - w - 2 * K2 - 1, y, 2 * K2, 1);
    }
    // communication trenches running back from the front line
    for (const z of [-8, 0, 8]) {
      const y0 = this.py_(z), x0 = this.px_(-9), x1 = this.px_(trenchX(z));
      g.fillStyle = '#1b140b'; g.fillRect(x0, y0 - K2, x1 - x0, 2 * K2 + 1); g.fillStyle = '#8d7d55'; g.fillRect(x0, y0 - 2 * K2, x1 - x0, 1); g.fillRect(x0, y0 + K2 + 1, x1 - x0, 1);
    }
    // barbed wire: two belts with posts and barbs
    for (const wl of [6.5, 8.5]) {
      const px = this.px_(wl);
      for (let y = 14 * K2; y < TH - 14 * K2; y++) {
        const o = Math.round(Math.sin(y * .5 + wl) * 1.6 * K2 / 2); g.fillStyle = (y % 2) ? '#a7a79d' : '#5e5e57'; g.fillRect(px + o, y, 1, 1);
        if (y % 5 === 0) { g.fillStyle = '#c3c3b8'; g.fillRect(px + o - 1, y, 3, 1); }
      }
      for (let y = 14 * K2; y < TH - 14 * K2; y += 8 * K2) { g.fillStyle = '#2a2118'; g.fillRect(px - 1, y, 2, 3); }
    }
    // rear area: dirt lane
    g.fillStyle = 'rgba(60,46,30,.5)'; g.fillRect(this.px_(-16), this.py_(-1), this.px_(-3) - this.px_(-16), 4 * K2);
    for (let k = 0; k < 40; k++) this.crater((4 + R() * 17 + BF_W / 2) * ppm, (R() * 27 - 13.5 + BF_H / 2) * ppm, (2 + R() * 4) * K2, R() < .35);
  }

  /** Stamp a pixel-art shell crater at canvas pixel (px,py). */
  private crater(px: number, py: number, r: number, wet: boolean) {
    const g = this.g; px = Math.round(px); py = Math.round(py); const R = Math.ceil(r + 2);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dy) * (1 + .12 * Math.sin(Math.atan2(dy, dx) * 3 + px)); if (d > r + 1.4) continue;
      let c: string;
      if (d < r * .55) c = wet ? (dy < 0 && dx < 0 && d < r * .3 ? '#6d8582' : '#3b4a48') : '#1d160e';
      else if (d < r - .4) c = wet ? '#2f3b39' : '#2e2418';
      else if (d < r + .5) c = dx + dy < 0 ? '#8a7650' : '#5b4a31';
      else c = '#6a5a3c';
      g.fillStyle = c; g.fillRect(px + dx, py + dy, 1, 1);
    }
  }

  /** Add an explosion crater at battle-local (x,z) (world-aligned offsets from the battle centre). */
  addCrater(x: number, z: number, s: number) {
    const lx = x * this.ax + z * this.az, lz = x * this.px + z * this.pz;
    if (Math.abs(lx) < 21 && Math.abs(lz) < 14) { this.crater(this.px_(lx), this.py_(lz), (2.5 + Math.random() * 2 * s) * this.ppm / 4, false); this.texDirty = true; }
  }

  /** Pre-scar the ground of a battle that has been going on for a while so late arrivals see its history. */
  scarForAge(age: number) {
    const n = Math.min(40, Math.floor(age / 5)), rng = new Rng(seedOf(this.battle.id) ^ 0xabc);
    for (let k = 0; k < n; k++) this.crater(this.px_(-6 + rng.next() * 30), this.py_((rng.next() - .5) * 26), (2 + rng.next() * 3) * this.K2, rng.next() < .25);
    if (n) this.texDirty = true;
  }

  private makeProps(rng: Rng) {
    const R = () => rng.next(), add = (k: PropKind, lx: number, lz: number, r: number, h = 0) => {
      this.props.push({ k, wx: this.cx + (this.ax * lx + this.px * lz) * BS, wz: this.cz + (this.az * lx + this.pz * lz) * BS, r, h });
    };
    const fy = Math.atan2(this.ax, this.az);
    for (let k = 0; k < 14; k++) add('stump', 4 + R() * 16, (R() - .5) * 26, R() * 6, .08 + R() * .1);
    for (let k = 0; k < 4; k++) add('ruin', -6 - R() * 12, (R() - .5) * 24, R() * 6);
    for (let k = 0; k < 6; k++) add('crate', -1 - R() * 3, (R() - .5) * 24, R() * 6);
    for (let k = 0; k < 4; k++) add('barrel', -2 - R() * 4, (R() - .5) * 24, R() * 6);
    for (let k = 0; k < 3; k++) add('tent', -13 - R() * 4, -10 + k * 9 + R() * 2, (R() - .5) * .5);
    for (let k = 0; k < 2; k++) add('wagon', -11 - R() * 3, -5 + k * 10 + R() * 2, 1.57 + (R() - .5) * .4);
    add('tower', -8, (R() - .5) * 14, R() * 3);
    for (let k = 0; k < 3; k++) add('dugout', -3.5, -8 + k * 8 + R() * 2, 0);
    for (let k = 0; k < 6; k++) add('cross', -9 - R() * 6, (R() - .5) * 24, R() * .4);
    for (let k = 0; k < 10; k++) add('bush', -18 + R() * 12, (R() - .5) * 28, R() * 6);
    for (let k = 0; k < 4; k++) add('hay', -20 + R() * 8, (R() - .5) * 28, R() * 6);
    add('fire', -14, 4 + R() * 4, 0);
    for (let z = -13; z <= 13; z += .6) add('bag', trenchX(z) + 1.05, z, fy);
    for (let z = -13; z <= 13; z += 1.6) { add('post', 6.5, z, 0); add('post', 8.5, z + .8, 0); }
  }

  /** Smooth displayed agent positions towards the simulation's (host ticks at 20 Hz, guests receive ~10 Hz snapshots). */
  syncAgents(agents: Agent[], dt: number, rate: number, now: number) {
    const k = 1 - Math.exp(-dt * rate);
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]; let d = this.disp[i];
      if (!d) { this.disp[i] = d = { x: a.x, z: a.z, deadAt: -1 }; }
      else {
        const dx = a.x - d.x, dz = a.z - d.z;
        if (dx * dx + dz * dz > 36) { d.x = a.x; d.z = a.z; } else { d.x += dx * k; d.z += dz * k; }
      }
      if (a.dead) { if (d.deadAt < 0) d.deadAt = now; } else d.deadAt = -1;
    }
    this.disp.length = agents.length;
  }

  /** Draw static props into the lit pool. */
  drawProps(m: Models) {
    const y = this.y, fy = Math.atan2(this.ax, this.az), p = m.part.bind(m);
    for (const q of this.props) {
      const wx = q.wx, wz = q.wz;
      switch (q.k) {
        case 'stump': p(wx, y, wz, q.r, 0, q.h / 2, 0, .025, q.h, .025, K.stump); p(wx, y, wz, q.r, .02, q.h * .7, 0, .04, .01, .01, K.stump); break;
        case 'ruin': p(wx, y, wz, q.r, 0, .05, 0, .24, .1, .03, K.stone); p(wx, y, wz, q.r, -.08, .12, 0, .08, .06, .03, K.stone); p(wx, y, wz, q.r, .1, .025, .08, .03, .05, .16, K.stone); p(wx, y, wz, q.r, .04, .01, .06, .06, .02, .04, K.stone); break;
        case 'crate': p(wx, y, wz, q.r, 0, .02, 0, .05, .04, .04, K.crate); break;
        case 'bag': p(wx, y, wz, fy, 0, .016, 0, .08, .03, .045, K.sand); p(wx, y, wz, fy, .02, .045, 0, .07, .028, .04, K.sand2); break;
        case 'post': p(wx, y, wz, 0, 0, .03, 0, .012, .06, .012, K.stump); p(wx, y, wz, 0, 0, .062, 0, .03, .006, .006, K.gun); break;
        case 'tent': p(wx, y, wz, q.r, 0, .022, 0, .14, .044, .2, K.canvas); p(wx, y, wz, q.r, 0, .058, 0, .1, .03, .19, K.canvas); p(wx, y, wz, q.r, 0, .082, 0, .05, .02, .18, K.canvas2); p(wx, y, wz, q.r, 0, .1, 0, .01, .016, .2, K.beam); break;
        case 'wagon':
          p(wx, y, wz, q.r, 0, .05, 0, .12, .03, .26, K.beam); p(wx, y, wz, q.r, 0, .085, 0, .1, .04, .22, K.canvas); p(wx, y, wz, q.r, 0, .115, 0, .07, .025, .2, K.canvas2);
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) p(wx, y, wz, q.r, sx * .07, .034, sz * .08, .012, .07, .07, K.stump);
          p(wx, y, wz, q.r, 0, .04, .17, .01, .01, .1, K.beam); break;
        case 'tower':
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) p(wx, y, wz, q.r, sx * .04, .12, sz * .04, .012, .24, .012, K.beam);
          p(wx, y, wz, q.r, 0, .24, 0, .11, .012, .11, K.beam); p(wx, y, wz, q.r, 0, .27, 0, .1, .04, .012, K.beam); p(wx, y, wz, q.r, 0, .30, 0, .13, .014, .13, K.roof); p(wx, y, wz, q.r, 0, .2, 0, .01, .012, .1, K.beam); break;
        case 'dugout':
          p(wx, y, wz, q.r, 0, .03, 0, .2, .06, .14, K.beam); p(wx, y, wz, q.r, 0, .065, 0, .22, .02, .16, K.sand2); p(wx, y, wz, q.r, 0, .045, .075, .06, .05, .012, K.gun);
          for (let s = -2; s <= 2; s++) p(wx, y, wz, q.r, s * .04, .012, .1, .04, .024, .03, K.sand); break;
        case 'barrel': p(wx, y, wz, q.r, 0, .022, 0, .03, .044, .03, K.wood); p(wx, y, wz, q.r, 0, .0215, 0, .033, .006, .033, K.gun); break;
        case 'cross': p(wx, y, wz, q.r, 0, .03, 0, .01, .06, .01, K.stone); p(wx, y, wz, q.r, 0, .045, 0, .034, .01, .01, K.stone); break;
        case 'bush': p(wx, y, wz, q.r, 0, .014, 0, .07, .028, .06, K.bush); p(wx, y, wz, q.r, .01, .034, .005, .045, .02, .04, K.bush); break;
        case 'hay': p(wx, y, wz, q.r, 0, .025, 0, .08, .05, .06, K.hay); p(wx, y, wz, q.r, 0, .058, 0, .06, .016, .05, K.hay); break;
        case 'fire': p(wx, y, wz, 0, 0, .006, 0, .08, .012, .08, K.stump); break;
      }
    }
  }

  /** Draw all agents (with smoothing applied) into the pools. */
  drawAgents(m: Models, fx: FxSystem, agents: Agent[], simTime: number, now: number) {
    const y = this.y;
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i], d = this.disp[i]; if (!d) continue;
      const wx = this.cx + d.x * BS, wz = this.cz + d.z * BS;
      if (a.dead) {
        if (d.deadAt < 0 || now - d.deadAt > 40) continue;
        if (a.dieT > 0 && simTime - a.dieT > 40) continue;
        if (a.type === 'tank') { m.unit('tank', wx, y, wz, a.face, a.f, 1, 0, 0); if (Math.random() < .04) fx.spawn(wx, y + .15, wz, .02, .15, 0, 0, 2, .04, .15, K.smoke2); }
        else m.corpse(wx, y, wz, a.face, a.f);
        continue;
      }
      m.unit(a.type as UnitType, wx, y, wz, a.face, a.f, 1, a.moving ? a.phase : 0, clamp(1 - (simTime - a.fireT) * 4, 0, 1));
    }
  }

  /** Craters stamped since the last upload become visible here. */
  flush() { if (this.texDirty) { this.tex.needsUpdate = true; this.texDirty = false; } }

  /** Fade the ground in as the camera descends. */
  setOpacity(o: number) {
    const mat = this.mesh.material as THREE.MeshLambertMaterial; mat.opacity = o; this.mesh.visible = o > .02;
  }

  dispose() {
    this.scene.remove(this.mesh); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.tex.dispose();
  }
}
