// Three.js world renderer: a Command & Conquer style top-down war map that zooms into painted, pixel-art ground and battlefields.
// Implements the contract in api.ts. It never mutates game state; it only reads session.state and drains visual effects.
import * as THREE from 'three';
import { AIR_RANGE, buildWorld, hops, tileAtW, type Battle, type Fx, type GameState, type World } from '@riskrts/shared';
import type { Session } from '../game/session';
import { useUi } from '../game/store';
import { Sfx } from '../audio/sfx';
import type { CreateRenderer, RendererCallbacks, WorldRendererApi } from './api';
import { Ambient } from './ambient';
import { AIR_Y, BS, BattleView } from './battleView';
import { CameraRig } from './camera';
import { DynamicDraw } from './dynamic';
import { GroundDetail } from './detail';
import { F_GLOW, F_MAP, FxSystem } from './fxSystem';
import { Input } from './input';
import { Labels } from './labels';
import { Models } from './models';
import { K } from './palette';
import { Post } from './post';
import { LineBatch, Pool, litMaterial, uChrome } from './pools';
import { Terrain } from './terrain';
import { Water } from './water';
import { clamp, smooth } from './util';

type Quality = 0 | 1 | 2;
/** Render-buffer scale: Ultra = device pixels, High = CSS pixels, Chunky = half resolution. */
const QUAL_DIV = [() => 1 / Math.min(window.devicePixelRatio || 1, 2), () => 1, () => 2];
/** Battlefield ground pixels per local unit. */

class WorldRenderer implements WorldRendererApi {
  /** Not part of the API: handy for dev tooling and tests. */
  readonly debug: { rig: CameraRig; views: Map<number, BattleView>; stats: { cpuMs: number; frames: number }; renderer: THREE.WebGLRenderer; models?: Models; extra?: (m: Models, T: number) => void };

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly world: World;
  private readonly rig: CameraRig;
  private readonly terrain: Terrain;
  private readonly water: Water;
  private readonly lit: Pool; private readonly glow: Pool;
  private readonly detail: GroundDetail;
  private readonly lines: LineBatch;
  private readonly models: Models;
  private readonly fx = new FxSystem();
  private readonly ambient = new Ambient();
  private readonly dyn: DynamicDraw;
  private readonly post: Post;
  private readonly labels: Labels;
  private readonly input: Input;
  private readonly cleanup: (() => void)[] = [];

  private session: Session | null = null;
  private quality: Quality = 1;
  private lastStoreQ: Quality | -1 = -1;
  private vw = 1; private vh = 1;
  private now = 0; private frameNo = 0;
  private lastHover = -2;
  private orderCursor = false;
  private readonly views = new Map<number, BattleView>();
  private readonly byId = new Map<number, Battle>();
  private readonly visible = new Set<number>();
  private readonly puff = new Map<number, number>();
  private readonly curOwner: Int16Array; private readonly curHl: Int8Array; private readonly dirty: Uint8Array;
  private readonly tmpV = new THREE.Vector3();
  private readonly armyTuple: [number, number] = [0, 0];
  private readonly labelCtx: Parameters<Labels['update']>[0];
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement, labelsEl: HTMLElement, private readonly cb: RendererCallbacks) {
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }); }
    catch (e) { throw new Error(`WebGL is not available, so the world map cannot be drawn (${e instanceof Error ? e.message : String(e)}). Try enabling hardware acceleration or another browser.`); }
    this.renderer = renderer;
    if (!renderer.getContext()) throw new Error('WebGL context could not be created.');
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    const SM = renderer.capabilities.maxTextureSize >= 4096 ? 4096 : 2048;
    this.scene.background = new THREE.Color('#050505');

    try {
      this.world = buildWorld();
      this.rig = new CameraRig(this.scene, SM);
      this.terrain = new Terrain(this.scene, this.world);
      this.water = new Water(this.scene, this.world);
      this.lit = new Pool(this.scene, 120000, litMaterial(), true);
      this.glow = new Pool(this.scene, 5000, new THREE.MeshBasicMaterial({ toneMapped: false }), false);
      this.detail = new GroundDetail(this.scene, this.world, this.terrain);
      this.lines = new LineBatch(this.scene, 8000);
      this.models = new Models(this.lit, this.glow);
      this.dyn = new DynamicDraw(this.world, this.terrain, this.models, this.lines, this.fx);
      this.post = new Post(renderer, this.scene, this.rig.camera);
    } catch (e) {
      renderer.dispose();
      throw new Error(`Could not set up the 3D renderer: ${e instanceof Error ? e.message : String(e)}`);
    }
    const R = this.world.regions.length;
    this.curOwner = new Int16Array(R).fill(-2); this.curHl = new Int8Array(R).fill(-1); this.dirty = new Uint8Array(R);
    this.rig.snap();

    this.labels = new Labels(labelsEl, this.world, this.terrain.cities, (c) => this.terrain.tileH[c.tile], (id) => { this.flyTo(id, 6); cb.onSelect(id); });
    this.labelCtx = {
      g: null, cam: this.rig, w: 1, h: 1, sel: -1, hover: -1, frame: 0, now: 0,
      isTarget: (id) => this.isTarget(id), anchorH: (id) => this.terrain.anchorH(id), groundY: (id) => this.terrain.groundY[id],
      armyH: (a) => { this.armyTuple[0] = this.terrain.anchorH(a.from); this.armyTuple[1] = this.terrain.anchorH(a.to); return this.armyTuple; },
    };

    this.input = new Input({
      canvas, rig: this.rig, regionAt: (x, y) => this.regionAt(x, y), orderMode: () => useUi.getState().orderMode,
      onSelect: (id) => cb.onSelect(id), onOrder: (id) => cb.onOrder(id),
      onHover: (id) => { if (id !== this.lastHover) { this.lastHover = id; cb.onHover(id); } },
      onDoubleClick: (id) => { const b = this.session?.state.regions[id].battle ?? -1; this.flyTo(id, b >= 0 ? 6 : Math.min(this.rig.gdist, 24)); },
    });

    const onResize = () => this.resize();
    window.addEventListener('resize', onResize); this.cleanup.push(() => window.removeEventListener('resize', onResize));
    if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(onResize); ro.observe(canvas); this.cleanup.push(() => ro.disconnect()); }
    const lost = (e: Event) => { e.preventDefault(); console.warn('WebGL context lost'); };
    canvas.addEventListener('webglcontextlost', lost); this.cleanup.push(() => canvas.removeEventListener('webglcontextlost', lost));

    this.debug = { rig: this.rig, views: this.views, stats: { cpuMs: 0, frames: 0 }, renderer };
      this.debug.models = this.models;
    const q = useUi.getState().quality; this.lastStoreQ = q; this.setQuality(q);
  }

  // ---------------------------------------------------------------- API

  setSession(s: Session) {
    this.session = s;
    for (const v of this.views.values()) v.dispose();
    this.views.clear(); this.puff.clear(); this.fx.clear();
    this.curOwner.fill(-2); this.curHl.fill(-1);
  }

  resize() {
    const cw = this.canvas.clientWidth || window.innerWidth, ch = this.canvas.clientHeight || window.innerHeight;
    this.vw = Math.max(1, cw); this.vh = Math.max(1, ch);
    const f = QUAL_DIV[this.quality](), w = Math.max(1, Math.floor(this.vw / f)), h = Math.max(1, Math.floor(this.vh / f));
    this.renderer.setSize(w, h, false); this.post.setSize(w, h); this.rig.setAspect(this.vw / this.vh);
  }

  setQuality(q: Quality) { this.quality = q; this.canvas.classList.toggle('smooth', q === 0); this.resize(); }

  flyTo(regionId: number, distance?: number) { const r = this.world.regions[regionId]; if (r) this.rig.flyTo(r.cx, r.cz, distance); }
  panTo(x: number, z: number) { this.rig.flyTo(x, z); }
  viewPolygon() { return this.rig.viewPolygon(); }
  cameraDistance() { return this.rig.dist; }

  battleInFocus(): number | null {
    const g = this.session?.state; if (!g || this.rig.dist >= 30) return null;
    let best: number | null = null, bd = 15;
    for (const b of g.battles) { if (b.ended) continue; const d = this.distTo(b); if (d < bd) { bd = d; best = b.id; } }
    return best;
  }

  watchedBattles(): number[] {
    const g = this.session?.state, out: number[] = []; if (!g || this.rig.dist >= 40) return out;
    for (const b of g.battles) if (!b.ended && this.distTo(b) < 22) out.push(b.id);
    return out;
  }

  frame(dtReal: number) {
    if (this.disposed) return;
    const t0 = performance.now();
    const dt = clamp(dtReal, 0, .05), ui = useUi.getState(), s = this.session, g = s ? s.state : null;
    this.now += dt; this.frameNo++;
    if (ui.quality !== this.lastStoreQ) { this.lastStoreQ = ui.quality; if (ui.quality !== this.quality) this.setQuality(ui.quality); }
    if (ui.orderMode !== this.orderCursor) { this.orderCursor = ui.orderMode; this.canvas.classList.toggle('order', ui.orderMode); }

    const [px, pz] = this.input.pan();
    this.rig.update(dt, px, pz);
    this.terrain.setCameraDistance(this.rig.dist);
    this.detail.update(this.rig.tx, this.rig.tz, this.rig.dist, this.vw / this.vh, this.ppu());
    this.dyn.marker = ui.fortMarker;

    this.syncPaint(g, ui.sel, ui.hover);
    const speed = s ? s.speed : 1, fdt = dt * (speed > 0 ? Math.min(speed, 4) : .5);
    this.updateBattles(g, dt, fdt);
    if (s) this.processFx(s);
    this.fx.update(fdt); this.ambient.update(fdt, this.fx);
    if (g) this.dyn.factorySmoke(g, fdt);

    this.drawScene(g, this.now);
    this.water.setTime(this.now);
    this.post.tune(this.rig.dist, ui.look, this.now); uChrome.value = ui.look ? .75 : .3;
    this.post.render();

    const c = this.labelCtx; c.g = g; c.w = this.vw; c.h = this.vh; c.sel = ui.sel; c.hover = ui.hover; c.frame = this.frameNo; c.now = this.now;
    this.labels.update(c);
    let active = 0; if (g) for (const b of g.battles) if (!b.ended) active++;
    Sfx.level(active, this.rig.dist);
    this.debug.stats.cpuMs = performance.now() - t0; this.debug.stats.frames = this.frameNo;
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const f of this.cleanup) f(); this.cleanup.length = 0;
    this.input.dispose(); this.labels.dispose();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.terrain.dispose(); this.water.dispose(); this.lit.dispose(); this.glow.dispose(); this.detail.dispose(); this.lines.dispose();
    this.post.dispose(); this.rig.dispose();
    this.canvas.classList.remove('order', 'drag', 'smooth');
    // The context is deliberately not force-lost: the page may mount a new renderer on the same canvas.
    this.renderer.dispose();
  }

  // ---------------------------------------------------------------- helpers

  /** Render-buffer pixels per world unit at the current zoom. */
  private ppu() { return this.canvas.height / (2 * .344 * this.rig.dist); }

  /** Dev tooling: build all close-up ground in view now instead of one chunk per frame. */
  warmDetail() { this.detail.buildAll(this.rig.tx, this.rig.tz, this.rig.dist, this.vw / this.vh, this.ppu()); }

  private distTo(b: Battle) { const r = this.world.regions[b.region]; return Math.hypot(r.cx - this.rig.tx, r.cz - this.rig.tz); }

  private regionAt(cx: number, cy: number): number {
    if (!this.rig.screenToWorld(cx, cy, this.canvas.getBoundingClientRect(), this.tmpV)) return -1;
    const i = tileAtW(this.tmpV.x, this.tmpV.z);
    return (i >= 0 && this.world.land[i]) ? this.world.terrOf[i] : -1;
  }

  private isTarget(id: number): boolean {
    const g = this.session?.state, ui = useUi.getState(), sel = ui.sel; if (!g || sel < 0) return false;
    const s = g.regions[sel]; if (!s || s.owner !== this.session!.me) return false;
    if (ui.orderMode && ui.orderKind === 'air') return id !== sel && hops(sel, id, AIR_RANGE) <= AIR_RANGE;
    return this.world.regions[sel].adj.includes(id) && g.regions[id].owner !== s.owner;
  }

  /** Repaint only regions whose owner / highlight state changed since the last frame. */
  private syncPaint(g: GameState | null, sel: number, hover: number) {
    const regs = this.world.regions, d = this.dirty; let any = false;
    for (let i = 0; i < regs.length; i++) {
      const owner = g ? g.regions[i].owner : -1;
      if (owner !== this.curOwner[i]) { this.curOwner[i] = owner; d[i] = 1; for (const j of regs[i].adj) d[j] = 1; any = true; }
      const hl = i === sel ? 2 : i === hover ? 1 : this.isTarget(i) ? 3 : 0;
      if (hl !== this.curHl[i]) { this.curHl[i] = hl; d[i] = 1; any = true; }
    }
    if (!any) return;
    for (let i = 0; i < regs.length; i++) if (d[i]) { d[i] = 0; this.terrain.paintRegion(i, this.curOwner, Math.max(0, this.curHl[i]) as 0 | 1 | 2 | 3); }
    this.terrain.commitColors();
  }

  /** Create / fade / destroy battlefield views, smooth agent positions, and emit distant smoke for battles that are far away. */
  private updateBattles(g: GameState | null, dt: number, fdt: number) {
    this.visible.clear(); this.byId.clear();
    if (!g) return;
    const rig = this.rig, rate = this.session && this.session.kind === 'guest' ? 9 : 16;
    let created = 0;
    for (const b of g.battles) this.byId.set(b.id, b);
    for (const [id, v] of this.views) if (!this.byId.has(id)) { v.dispose(); this.views.delete(id); }
    for (const b of g.battles) {
      const def = this.world.regions[b.region], d = this.distTo(b), vis = rig.dist < 30 && d < 15;
      let view = this.views.get(b.id);
      if (!view && vis && created < 1) {
        created++;
        view = new BattleView(b, def.cx, def.cz, (x, z) => this.terrain.surfaceAt(x, z)); this.views.set(b.id, view);
      }
      if (view) {
        if (rig.dist > 40 || d > 24) { view.dispose(); this.views.delete(b.id); view = undefined; }
        else {
          view.setOpacity(d < 16 ? 1 - smooth(16, 26, rig.dist) : 0);
          view.syncAgents(b.agents, dt, rate, this.now);
          if (vis) this.visible.add(b.id);
          if (vis && !b.ended) this.battleAmbience(view, fdt);
        }
      }
      if (!view || !this.visible.has(b.id)) { if (!b.ended) this.distantBattle(b, fdt); }
    }
    for (const id of this.puff.keys()) if (!this.byId.has(id)) this.puff.delete(id);
  }

  private battleAmbience(v: BattleView, dt: number) {
    const fx = this.fx;
    v.flareT -= dt;
    if (v.flareT <= 0) {
      v.flareT = 4 + Math.random() * 5;
      fx.spawn(v.cx + (Math.random() - .3) * 20 * BS, v.y + .1, v.cz + (Math.random() - .5) * 24 * BS, (Math.random() - .5) * .1, 1.4, (Math.random() - .5) * .1, .9, 2.6, .04, .03, K.flare, F_GLOW);
    }
    if (Math.random() < dt * 2) fx.spawn(v.cx + (Math.random() - .5) * 36 * BS, v.y + .05, v.cz + (Math.random() - .5) * 26 * BS, .04, .05, .02, 0, 5, .1, .35, K.smoke2);
  }

  private distantBattle(b: Battle, dt: number) {
    const t = (this.puff.get(b.id) ?? 0) - dt;
    if (t > 0) { this.puff.set(b.id, t); return; }
    this.puff.set(b.id, .22 + Math.random() * .2);
    const r = this.world.regions[b.region], y = this.terrain.groundY[b.region];
    if (Math.random() < .3) Sfx.rumble(Math.max(0, 1 - this.rig.dist / 150));
    const an = Math.random() * 6.28, rr = Math.random() * 1.4;
    this.fx.spawn(r.cx + Math.cos(an) * rr, y + .3, r.cz + Math.sin(an) * rr, 0, .35, 0, 0, 2, .2 + Math.random() * .12, .45, Math.random() < .5 ? K.smoke : K.smoke2, F_MAP);
    if (Math.random() < .5) this.fx.spawn(r.cx + (Math.random() - .5) * 2, y + .4, r.cz + (Math.random() - .5) * 2, 0, 0, 0, 0, .18, .28, .4, K.fire, F_GLOW | F_MAP);
  }

  /** Turn simulation effects into particles, tracers, craters and sounds. Effects of battles that are not on screen are dropped. */
  private processFx(s: Session) {
    const list = s.drainFx();
    for (const f of list) {
      if (!this.visible.has(f.b)) continue;
      const v = this.views.get(f.b); if (!v) continue;
      this.spawnFx(v, f);
    }
  }

  private spawnFx(v: BattleView, f: Fx) {
    const fx = this.fx;
    const fy = (x: number, z: number) => v.groundAt(v.cx + x * BS, v.cz + z * BS);
    if (f.k === 'flak') {
      const y = v.y;
      const wx = v.cx + f.x * BS, wz = v.cz + f.z * BS, wy = y + AIR_Y + (Math.random() - .3) * .08;
      Sfx.shot(.5);
      fx.spawn(wx, wy, wz, 0, 0, 0, 0, .1, .02, .05, K.flash, F_GLOW); fx.spawn(wx, wy, wz, (Math.random() - .5) * .02, .01, 0, 0, 1.6, .03, .07, K.flakpuff);
    } else if (f.k === 'shot') {
      const y = fy(f.x0, f.z0), y1 = fy(f.x1, f.z1), fromAir = f.type === 'plane', toAir = !!f.air && !fromAir;
      const x0 = v.cx + f.x0 * BS, z0 = v.cz + f.z0 * BS, x1 = v.cx + f.x1 * BS, z1 = v.cz + f.z1 * BS;
      const ys = fromAir ? y + AIR_Y : y + (f.type === 'tank' ? .035 : f.type === 'mg' || f.type === 'pill' ? .025 : .05), ye = f.air ? y + AIR_Y : y1 + .04;
      fx.tracer(x0, ys, z0, x1, ye, z1, f.type === 'mg' || f.type === 'pill' ? .025 : .035);
      if (toAir || fromAir) { if (Math.random() < .5) Sfx.shot(1.1); fx.spawn(x0, ys, z0, 0, 0, 0, 0, .05, .012, .01, K.flash, F_GLOW); return; }
      Sfx.shot(f.type === 'mg' ? 1.3 : .8);
      if (Math.random() < .6) fx.spawn(x0, ys, z0, 0, 0, 0, 0, .06, .015, .01, K.flash, F_GLOW);
      if (Math.random() < .15) fx.spawn(x0, y + .06, z0, 0, .05, 0, 0, .9, .01, .03, K.smoke);
      if (f.hit) fx.spawn(x1, y1 + .04, z1, (Math.random() - .5) * .2, .3, (Math.random() - .5) * .2, 3, .22, .01, .006, K.dirt, 0, y1);
    } else if (f.k === 'fire') {
      const wx = v.cx + f.x * BS, wz = v.cz + f.z * BS, y = fy(f.x, f.z);
      Sfx.cannon();
      fx.spawn(wx, y + .05, wz, 0, .1, 0, 0, .1, .035, .06, K.flash, F_GLOW); fx.spawn(wx, y + .05, wz, 0, .07, 0, 0, 1.2, .025, .08, K.smoke);
    } else {
      const s = f.s * .65, wx = v.cx + f.x * BS, wz = v.cz + f.z * BS, y = fy(f.x, f.z);
      Sfx.boom(s);
      fx.spawn(wx, y + .05, wz, 0, 0, 0, 0, .16, .16 * s, .28 * s, K.fire, F_GLOW); fx.spawn(wx, y + .03, wz, 0, 0, 0, 0, .08, .3 * s, .34 * s, K.flash, F_GLOW);
      for (let i = 0; i < 10; i++) { const an = Math.random() * 6.28, sp = .3 + Math.random() * .6; fx.spawn(wx, y + .03, wz, Math.cos(an) * sp * s, (1 + Math.random()) * s, Math.sin(an) * sp * s, 4, .8, .03, .025, Math.random() < .5 ? K.dirt : K.boot, 0, y); }
      for (let i = 0; i < 4; i++) fx.spawn(wx + (Math.random() - .5) * .1, y + .08, wz + (Math.random() - .5) * .1, (Math.random() - .5) * .05, .18, (Math.random() - .5) * .05, 0, 1.8 + Math.random(), .08 * s, .22 * s, Math.random() < .5 ? K.smoke : K.smoke2);
    }
  }

  private drawScene(g: GameState | null, T: number) {
    const { lit, glow, lines, rig } = this;
    lit.begin(); glow.begin(); lines.begin();
    const near = rig.dist < 26;
    // fine model detail (rivets, faces, spokes, markings) only where it can be seen
    this.models.hi = rig.dist < 7; this.models.t = T;
    if (g) {
      this.dyn.regions(g, rig, T); this.dyn.armies(g, T);
      for (const b of g.battles) {
        const v = this.views.get(b.id); if (!v || !v.visible) continue;
        v.drawAgents(this.models, this.fx, b.agents, g.time, this.now);
      }
    }
    this.ambient.drawShips(this.models, T);
    this.dyn.drawMarker(T);
    this.debug.extra?.(this.models, T);
    this.fx.draw(lit, glow, near); this.fx.drawTracers(lines);
    lit.end(); glow.end(); lines.end();
  }
}

export const createWorldRenderer: CreateRenderer = (canvas, labels, cb) => new WorldRenderer(canvas, labels, cb);
