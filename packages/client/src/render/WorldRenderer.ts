// Three.js world renderer: a Command & Conquer style top-down war map that zooms into painted, pixel-art ground and battlefields.
// Implements the contract in api.ts. It never mutates game state; it only reads session.state and drains visual effects.
import * as THREE from 'three';
import { AIR_RANGE, HW, buildWorld, carrierAt, carrierHops, fleetPos, hops, tileAtW, wrapDx, type Battle, type Fx, type GameState, type World } from '@riskrts/shared';
import type { Session } from '../game/session';
import { useUi } from '../game/store';
import { Sfx } from '../audio/sfx';
import type { CreateRenderer, PixelScale, RendererCallbacks, WorldRendererApi } from './api';
import { Ambient } from './ambient';
import { AIR_Y, BS, BattleView } from './battleView';
import { CameraRig, bandOf } from './camera';
import { CLOSE_PAINT, DynamicDraw } from './dynamic';
import { Trenches } from './trenches';
import { GroundDetail } from './detail';
import { F_BALL, F_DUST, F_FLAME, F_GLOW, F_HOT, F_THIN, FxSystem } from './fxSystem';
import { Sprites } from './sprites';
import { Input } from './input';
import { Labels } from './labels';
import { NetworkLayer } from './network';
import { MapBattles } from './mapBattle';
import { NavyDraw } from './navy';
import { Models } from './models';
import { MeshPools } from './meshPools';
import { Impostors } from './impostors';
import { K } from './palette';
import { Post } from './post';
import { LineBatch, Pool, litMaterial, uChrome } from './pools';
import { Terrain } from './terrain';
import { Water } from './water';
import { Shroud } from './shroud';
import { battleAnchor, sectorPoint } from '@riskrts/shared';
import { clamp, smooth } from './util';

type Quality = PixelScale;
/** Render-buffer scale: Ultra = device pixels, High = CSS pixels, Chunky = half resolution. */
const QUAL_DIV = [() => 1 / Math.min(window.devicePixelRatio || 1, 2), () => 1, () => 1 / .75, () => 2];
/** Classic (0.75×) is upscaled with filtering: a 4:3 nearest stretch gives uneven pixel rows. */
const QUAL_SMOOTH = [true, false, true, false];
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
  private readonly shroud: Shroud;
  private readonly meshes: MeshPools;
  private readonly impostors: Impostors;
  private cursorCls = '';
  private readonly lit: Pool; private readonly glow: Pool;
  private readonly detail: GroundDetail;
  private readonly trenches: Trenches;
  private readonly lines: LineBatch;
  private readonly sprites: Sprites;
  private readonly models: Models;
  private readonly fx = new FxSystem();
  private readonly ambient = new Ambient();
  private readonly dyn: DynamicDraw;
  private readonly war: MapBattles;
  private readonly navy: NavyDraw;
  /** Sea zone and world point under the last pointer pick (-1 on land). */
  private pickZone = -1; private pickX = 0; private pickZ = 0;
  private lastDt = 0;
  private readonly net: NetworkLayer;
  /** True when a battle's close-up troops are on screen (map-scale fighting is drawn otherwise). */
  private readonly isClose = (b: Battle) => { const v = this.views.get(b.id); return !!v && v.visible; };
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
      this.water = new Water(this.scene, this.world, this.terrain.coastTex);
      this.shroud = new Shroud(this.scene, this.world);
      this.lit = new Pool(this.scene, 120000, litMaterial(), true);
      this.glow = new Pool(this.scene, 5000, new THREE.MeshBasicMaterial({ toneMapped: false }), false);
      this.detail = new GroundDetail(this.scene, this.world, this.terrain);
      this.trenches = new Trenches(this.scene, this.terrain);
      this.lines = new LineBatch(this.scene, 8000);
      this.sprites = new Sprites(this.scene);
      this.models = new Models(this.lit, this.glow);
      this.meshes = new MeshPools(this.scene); this.models.mesh = this.meshes;
      this.impostors = new Impostors(this.scene); this.models.sprites = this.impostors;
      this.dyn = new DynamicDraw(this.world, this.terrain, this.models, this.lines, this.fx);
      this.net = new NetworkLayer(this.world, this.terrain);
      this.war = new MapBattles(this.world, this.terrain, this.models, this.fx);
      this.navy = new NavyDraw(this.world, this.terrain, this.models, this.fx);
      this.post = new Post(renderer, this.scene, this.rig.camera);
    } catch (e) {
      renderer.dispose();
      throw new Error(`Could not set up the 3D renderer: ${e instanceof Error ? e.message : String(e)}`);
    }
    const R = this.world.regions.length;
    this.curOwner = new Int16Array(R).fill(-2); this.curHl = new Int8Array(R).fill(-1); this.dirty = new Uint8Array(R);
    this.rig.snap();

    this.labels = new Labels(labelsEl, this.world, this.terrain.cities, (c) => this.terrain.tileH[c.tile], (id, bid) => { this.flyToBattle(bid, 6); cb.onSelect(id); },
      (id) => { cb.onSelect(id); const u = useUi.getState(), st = this.session?.state; if (st && st.regions[id].owner === this.session!.me) u.setTab('deploy'); },
      (fleet) => useUi.getState().selectFleet(fleet), (sea) => { useUi.getState().selectSea(sea); this.flyToSea(sea); });
    this.labelCtx = {
      g: null, cam: this.rig, w: 1, h: 1, sel: -1, hover: -1, frame: 0, now: 0, me: -1,
      isTarget: (id) => this.isTarget(id), anchorH: (id) => this.terrain.anchorH(id), groundY: (id) => this.terrain.groundY[id],
      armyH: (a) => { this.armyTuple[0] = this.terrain.anchorH(a.from); this.armyTuple[1] = this.terrain.anchorH(a.to); return this.armyTuple; },
    };

    this.input = new Input({
      canvas, rig: this.rig, regionAt: (x, y) => this.regionAt(x, y), orderMode: () => useUi.getState().orderMode,
      onSelect: (id) => { if (id < 0 && this.pickSea()) return; if (!this.pickSector(id)) cb.onSelect(id); }, onOrder: (id) => cb.onOrder(id, id < 0 ? this.pickZone : undefined),
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
    this.views.clear(); this.war.clear(); this.fx.clear();
    this.curOwner.fill(-2); this.curHl.fill(-1);
  }

  resize() {
    const cw = this.canvas.clientWidth || window.innerWidth, ch = this.canvas.clientHeight || window.innerHeight;
    this.vw = Math.max(1, cw); this.vh = Math.max(1, ch);
    const f = QUAL_DIV[this.quality](), w = Math.max(1, Math.floor(this.vw / f)), h = Math.max(1, Math.floor(this.vh / f));
    this.renderer.setSize(w, h, false); this.post.setSize(w, h); this.rig.setAspect(this.vw / this.vh);
  }

  setQuality(q: Quality) { this.quality = q; this.canvas.classList.toggle('smooth', QUAL_SMOOTH[q]); this.resize(); }

  /** Fly to a region; zoomed in close on a region at war, fly to its (first) front instead. */
  flyTo(regionId: number, distance?: number) {
    const r = this.world.regions[regionId]; if (!r) return;
    const b = distance !== undefined && distance <= 8 ? this.session?.state.battles.find(x => x.region === regionId && !x.ended) : undefined;
    if (b) { this.flyToBattle(b.id, distance); return; }
    this.rig.flyTo(r.cx, r.cz, distance);
  }
  /** In the Fortify tab, a tap near one of the selected region's borders picks that border instead of selecting a region. */
  private pickSector(id: number): boolean {
    const ui = useUi.getState(), sel = ui.sel, g = this.session?.state;
    if (!g || sel < 0 || ui.tab !== 'fort' || g.regions[sel]?.owner !== this.session!.me) return false;
    if (id !== sel && id >= 0 && !this.world.regions[sel].adj.includes(id)) return false;
    const x = this.tmpV.x, z = this.tmpV.z; let best = -2, bd = .7 * .7;
    for (const s of [...this.world.regions[sel].sectors, -1]) { const p = sectorPoint(this.world, sel, s), d = wrapDx(x, p.x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
    if (best < -1) return false;
    ui.setFortMarker([sel, best]); Sfx.click(); return true;
  }

  /** A click on the water picks the nearest fleet or naval battle under the pointer. */
  private pickSea(): boolean {
    const g = this.session?.state; if (!g) return false;
    const x = this.pickX, z = this.pickZ, r = Math.max(.8, this.rig.dist * .03), ui = useUi.getState();
    for (const b of g.seaBattles ?? []) if (!b.ended && Math.hypot(wrapDx(x, b.x), z - b.z) < Math.max(3, r)) { ui.selectSea(b.id); return true; }
    let best = -1, bd = r * r;
    for (const fl of g.fleets) { if (!fl.path.length || fl.sea !== undefined) continue; const p = fleetPos(fl), d = wrapDx(x, p.x) ** 2 + (z - p.z) ** 2; if (d < bd) { bd = d; best = fl.id; } }
    if (best >= 0) { ui.selectFleet(best); return true; }
    if (ui.fleet >= 0 || ui.seaSel >= 0) { ui.selectFleet(-1); return true; }
    return false;
  }

  /** Fly to a naval battle. */
  flyToSea(id: number, distance = 9) { const b = this.session?.state.seaBattles?.find(x => x.id === id); if (b) this.rig.flyTo(b.x, b.z, distance); }
  flyToPoint(x: number, z: number, distance?: number) { this.rig.flyTo(x, z, distance); }

  /** Fly to one front (battle). */
  flyToBattle(id: number, distance = 6) {
    const b = this.session?.state.battles.find(x => x.id === id); if (!b) return;
    const p = battleAnchor(this.world, b); this.rig.flyTo(p.x, p.z, distance);
  }
  panTo(x: number, z: number) { this.rig.flyTo(x, z); }
  viewPolygon() { return this.rig.viewPolygon(); }
  cameraDistance() { return this.rig.dist; }

  battleInFocus(): number | null {
    const g = this.session?.state; if (!g || this.rig.dist >= 30) return null;
    let best: number | null = null, bd = 15;
    for (const b of g.battles) { if (b.ended) continue; const d = this.distTo(b); if (d < bd) { bd = d; best = b.id; } }
    return best;
  }

  zoomBand(b: number) { this.input.zoomBand(b); }

  watchedBattles(): number[] {
    const g = this.session?.state, out: number[] = []; if (!g || this.rig.dist >= 40) return out;
    for (const b of g.battles) if (!b.ended && this.distTo(b) < 22) out.push(b.id);
    return out;
  }

  frame(dtReal: number) {
    if (this.disposed) return;
    const t0 = performance.now();
    const dt = clamp(dtReal, 0, .05), ui = useUi.getState(), s = this.session, g = s ? s.state : null; this.lastDt = dt;
    this.now += dt; this.frameNo++;
    if (ui.quality !== this.lastStoreQ) { this.lastStoreQ = ui.quality; if (ui.quality !== this.quality) this.setQuality(ui.quality); }
    { // context cursor: attack / march / air / no-go while giving orders, spade while fortifying, binoculars over unknown land
      let c = '';
      const me = s?.me ?? -1, hov = ui.hover, sel = ui.sel, rs = g && hov >= 0 ? g.regions[hov] : null;
      if (ui.orderMode && ui.orderKind === 'station') c = 'c-move';
      else if (ui.orderMode && ui.orderKind === 'cvair') c = 'c-air';
      else if (ui.orderMode && (ui.orderKind === 'ship' || ui.orderKind === 'landing')) c = !rs || !this.world.regions[hov].zones.length ? 'c-no' : ui.orderKind === 'ship' ? (rs.owner === me ? 'c-move' : 'c-no') : rs.owner !== me ? 'c-atk' : 'c-no';
      else if (ui.orderMode) c = ui.orderKind === 'air' ? 'c-air' : !rs ? 'c-no' : sel >= 0 && !this.world.regions[sel].adj.includes(hov) ? 'c-no' : rs.owner === me ? 'c-move' : 'c-atk';
      else if (ui.tab === 'fort' && sel >= 0 && g?.regions[sel].owner === me) c = 'c-fort';
      else if (rs && rs.owner !== me && (rs.vis ?? 3) < 2) c = 'c-scout';
      if (c !== this.cursorCls) { if (this.cursorCls) this.canvas.classList.remove(this.cursorCls); if (c) this.canvas.classList.add(c); this.cursorCls = c; }
      if (ui.orderMode !== this.orderCursor) { this.orderCursor = ui.orderMode; this.canvas.classList.toggle('order', ui.orderMode); }
    }

    const [px, pz] = this.input.pan();
    this.rig.update(dt, px, pz);
    if (!this.terrain.hasScenery && this.meshes.ready) this.terrain.useModels(this.meshes);
    this.terrain.setCameraDistance(this.rig.dist);
    this.detail.update(this.rig.tx, this.rig.tz, this.rig.dist, this.vw / this.vh, this.ppu());
    this.dyn.marker = ui.fortMarker; this.dyn.layer = ui.layer; this.labels.setLayer(ui.layer); this.labels.setBand(bandOf(this.rig.dist)); this.dyn.sel = ui.sel;

    this.syncPaint(g, ui.sel, ui.hover);
    this.shroud.update(g, this.now);
    if (this.frameNo % 30 === 0 || this.frameNo < 3) { this.terrain.setWar(g); this.trenches.update(g); }
    this.trenches.setVisible(this.rig.dist < CLOSE_PAINT + 1);
    const speed = s ? s.speed : 1, fdt = dt * (speed > 0 ? Math.min(speed, 4) : .5);
    this.updateBattles(g, dt, fdt);
    if (s) this.processFx(s);
    this.fx.update(fdt); this.ambient.update(fdt, this.fx);
    if (g) { this.dyn.factorySmoke(g, fdt); this.net.weather(this.fx, g, this.rig, dt); }

    this.drawScene(g, this.now);
    this.water.setTime(this.now);
    this.post.tune(this.rig.dist, ui.look, this.now); uChrome.value = ui.look ? .75 : .3;
    this.post.render();

    const c = this.labelCtx; c.g = g; c.w = this.vw; c.h = this.vh; c.sel = ui.sel; c.hover = ui.hover; c.frame = this.frameNo; c.now = this.now; c.me = s && !(s.kind === "guest" && (s as unknown as { spectator?: boolean }).spectator) ? s.me : -1;
    this.dyn.me = c.me; this.dyn.zoomK = Math.max(1, this.rig.dist / 10);
    this.labels.update(c);
    let active = 0; if (g) for (const b of g.battles) if (!b.ended) active++;
    const hh = .344 * this.rig.dist;
    Sfx.listen(this.rig.tx, this.rig.tz, this.rig.dist, hh, hh * this.vw / Math.max(1, this.vh), HW);
    Sfx.level(active, this.rig.dist);
    this.engineSound(g, hh, hh * this.vw / Math.max(1, this.vh));
    this.debug.stats.cpuMs = performance.now() - t0; this.debug.stats.frames = this.frameNo;
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const f of this.cleanup) f(); this.cleanup.length = 0;
    this.input.dispose(); this.labels.dispose();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.terrain.dispose(); this.water.dispose(); this.shroud.dispose(); this.meshes.dispose(); this.impostors.dispose(); this.lit.dispose(); this.glow.dispose(); this.detail.dispose(); this.trenches.dispose(); this.lines.dispose(); this.sprites.dispose();
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

  private distTo(b: Battle) { const p = battleAnchor(this.world, b); return Math.hypot(p.x - this.rig.tx, p.z - this.rig.tz); }

  private regionAt(cx: number, cy: number): number {
    if (!this.rig.screenToWorld(cx, cy, this.canvas.getBoundingClientRect(), this.tmpV)) return -1;
    const i = tileAtW(this.tmpV.x, this.tmpV.z);
    this.pickX = this.tmpV.x; this.pickZ = this.tmpV.z; this.pickZone = i >= 0 && !this.world.land[i] ? this.world.zoneOf[i] : -1;
    return (i >= 0 && this.world.land[i]) ? this.world.terrOf[i] : -1;
  }

  private isTarget(id: number): boolean {
    const g = this.session?.state, ui = useUi.getState(), sel = ui.sel; if (!g || sel < 0) return false;
    const s = g.regions[sel]; if (!s || s.owner !== this.session!.me) return false;
    if (ui.orderMode && ui.orderKind === 'air') return id !== sel && hops(sel, id, AIR_RANGE) <= AIR_RANGE;
    if (ui.orderMode && ui.orderKind === 'ship') return id !== sel && g.regions[id].owner === s.owner && this.world.regions[id].zones.length > 0;
    if (ui.orderMode && ui.orderKind === 'landing') return g.regions[id].owner !== s.owner && this.world.regions[id].zones.length > 0;
    if (ui.orderMode && ui.orderKind === 'cvair') { const cv = g.ships.find(x => x.id === ui.orderArg); const at = cv ? carrierAt(g, cv) : null; return !!at && g.regions[id].owner !== s.owner && carrierHops(at.zone, id) <= AIR_RANGE; }
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
      const at = battleAnchor(this.world, b), d = this.distTo(b), vis = rig.dist < 30 && d < 15;
      let view = this.views.get(b.id);
      if (!view && vis && created < 1) {
        created++;
        view = new BattleView(b, at.x, at.z, (x, z) => this.terrain.surfaceAt(x, z)); this.views.set(b.id, view);
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
    }
    this.war.update(g, rig, fdt, this.isClose);
  }

  private battleAmbience(v: BattleView, dt: number) {
    const fx = this.fx;
    v.flareT -= dt;
    if (v.flareT <= 0) {
      v.flareT = 4 + Math.random() * 5;
      fx.spawn(v.cx + (Math.random() - .3) * 20 * BS, v.y + .1, v.cz + (Math.random() - .5) * 24 * BS, (Math.random() - .5) * .1, 1.4, (Math.random() - .5) * .1, .9, 2.6, .04, .03, K.flare, F_GLOW);
    }
    // battlefield haze: dust and drifting smoke hanging over the fight
    if (Math.random() < dt * 2.5) fx.spawn(v.cx + (Math.random() - .5) * 36 * BS, v.y + .06, v.cz + (Math.random() - .5) * 26 * BS, .04, .03, .02, 0, 6, .14, .42, Math.random() < .5 ? K.smoke2 : K.dust, F_THIN);
  }

  /** Tanks and aircraft near the middle of the screen drive the engine beds (count and average stereo position). */
  private engineSound(g: GameState | null, hh: number, hw: number) {
    let tanks = 0, tp = 0, planes = 0, pp = 0;
    if (g) {
      const rig = this.rig, near = (x: number, z: number) => Math.abs(wrapDx(rig.tx, x)) < hw * 1.1 && Math.abs(z - rig.tz) < hh * 1.1;
      for (const b of g.battles) {
        const v = this.views.get(b.id); if (!v || b.ended || !this.visible.has(b.id)) continue;
        for (const a of b.agents) {
          if (a.dead || a.out || (a.type !== 'tank' && a.type !== 'plane')) continue;
          const x = v.cx + a.x * BS, z = v.cz + a.z * BS; if (!near(x, z)) continue;
          const p = wrapDx(rig.tx, x) / hw; if (a.type === 'tank') { tanks++; tp += p; } else { planes++; pp += p; }
        }
      }
      // squadrons in the air between regions, heard when they cross the view
      if (rig.dist < 60) for (const a of g.armies) {
        if (!a.air) continue; const x = a.ax + a.dx * a.t, z = a.az + a.dz * a.t; if (!near(x, z)) continue;
        const n = Math.min(4, a.units.plane || 1) * .6; planes += n; pp += wrapDx(rig.tx, x) / hw * n;
      }
    }
    Sfx.engines(tanks, tanks ? tp / tanks : 0, planes, planes ? pp / planes : 0);
  }

  /** Turn simulation effects into particles, tracers, craters and sounds. Effects of battles that are not on screen are dropped. */
  private processFx(s: Session) {
    const list = s.drainFx();
    for (const f of list) {
      if (!('b' in f)) { this.navy.effect(f); continue; }
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
      Sfx.flak(wx, wz);
      fx.spawn(wx, wy, wz, 0, 0, 0, 0, .1, .03, .06, K.flash, F_GLOW); fx.spawn(wx, wy, wz, (Math.random() - .5) * .02, .01, 0, 0, 2.2, .04, .1, K.flakpuff, F_HOT);
    } else if (f.k === 'shot') {
      const y = fy(f.x0, f.z0), y1 = fy(f.x1, f.z1), fromAir = f.type === 'plane', toAir = !!f.air && !fromAir;
      const x0 = v.cx + f.x0 * BS, z0 = v.cz + f.z0 * BS, x1 = v.cx + f.x1 * BS, z1 = v.cz + f.z1 * BS;
      const ys = fromAir ? y + AIR_Y : y + (f.type === 'tank' ? .035 : f.type === 'mg' || f.type === 'pill' || f.type === 'bunk' ? .025 : .05), ye = f.air ? y + AIR_Y : y1 + .04;
      fx.tracer(x0, ys, z0, x1, ye, z1, f.type === 'mg' || f.type === 'pill' || f.type === 'bunk' ? .025 : .035);
      if (toAir || fromAir) { if (Math.random() < .5) Sfx.shot(f.type, x0, z0, toAir); fx.spawn(x0, ys, z0, 0, 0, 0, 0, .05, .012, .01, K.flash, F_GLOW); return; }
      Sfx.shot(f.type, x0, z0);
      if (Math.random() < .6) fx.spawn(x0, ys, z0, 0, 0, 0, 0, .06, .015, .01, K.flash, F_GLOW);
      if (Math.random() < .2) fx.spawn(x0, y + .05, z0, 0, .05, 0, 0, 1.1, .015, .045, K.smoke, F_THIN);
      if (f.hit) {
        fx.spawn(x1, y1 + .04, z1, (Math.random() - .5) * .2, .3, (Math.random() - .5) * .2, 3, .22, .012, .008, K.dirt, 0, y1);
        if (Math.random() < .5) fx.spawn(x1, y1 + .02, z1, (Math.random() - .5) * .04, .04, (Math.random() - .5) * .04, 0, .9, .012, .04, K.dust, F_DUST);
      }
    } else if (f.k === 'fire') {
      const wx = v.cx + f.x * BS, wz = v.cz + f.z * BS, y = fy(f.x, f.z);
      const sp = this.session ? Math.max(.25, Math.min(this.session.speed, 4)) : 1;
      Sfx.gun(wx, wz, f.tx !== undefined ? v.cx + f.tx * BS : undefined, f.tz !== undefined ? v.cz + f.tz * BS : undefined, (f.fl ?? 0) / sp);
      fx.spawn(wx, y + .05, wz, 0, .1, 0, 0, .1, .04, .07, K.flash, F_GLOW);
      fx.spawn(wx, y + .06, wz, 0, .08, 0, 0, 1.6, .03, .11, K.smoke, F_HOT);
      for (let i = 0; i < 3; i++) { const an = Math.random() * 6.28; fx.spawn(wx, y + .02, wz, Math.cos(an) * .12, .02, Math.sin(an) * .12, 0, 1.4, .03, .09, K.dust, F_DUST); }
    } else if (f.k === 'bomb') {
      this.navy.bombard(v.cx + f.x * BS, v.cz + f.z * BS, v.cx + f.tx * BS, v.cz + f.tz * BS, fy(f.tx, f.tz), f.fl);
    } else if (f.k === 'boom') {
      const s = f.s * .65, wx = v.cx + f.x * BS, wz = v.cz + f.z * BS, y = fy(f.x, f.z);
      Sfx.boom(wx, wz, s);
      this.blast(wx, y, wz, s, 1);
    }
  }

  /** A volumetric explosion: flash, rolling fireball, flame licks, flying clods, an outward dust ring, a hot smoke column and a crater. */
  private blast(wx: number, y: number, wz: number, s: number, k: number) {
    const fx = this.fx, R = Math.random;
    fx.spawn(wx, y + .04, wz, 0, 0, 0, 0, .12, .22 * s * k, .4 * s * k, K.flash, F_GLOW);
    fx.spawn(wx, y + .06, wz, 0, .14 * k, 0, 0, .75, .12 * s * k, .28 * s * k, K.fire, F_BALL);
    for (let i = 0; i < 3; i++) fx.spawn(wx + (R() - .5) * .06 * s * k, y + .03, wz + (R() - .5) * .06 * s * k, 0, .1 * k, 0, 0, .5 + R() * .4, .07 * s * k, .13 * s * k, K.fire, F_FLAME);
    for (let i = 0; i < 10; i++) { const an = R() * 6.28, sp = .3 + R() * .6; fx.spawn(wx, y + .03, wz, Math.cos(an) * sp * s * Math.min(k, 1.6), (1 + R()) * s * Math.min(k, 1.6), Math.sin(an) * sp * s * Math.min(k, 1.6), 4, .8, .025 * k, .02 * k, R() < .5 ? K.dirt : K.boot, 0, y); }
    for (let i = 0; i < 8; i++) { const an = i / 8 * 6.28 + R() * .5, sp = (.18 + R() * .1) * s * k; fx.spawn(wx, y + .03, wz, Math.cos(an) * sp, .015, Math.sin(an) * sp, 0, 1.6 + R(), .06 * s * k, .2 * s * k, K.dust, F_DUST); }
    for (let i = 0; i < 4; i++) fx.spawn(wx + (R() - .5) * .08 * k, y + .1, wz + (R() - .5) * .08 * k, .02 * k, (.16 + R() * .1) * k, (R() - .5) * .04, 0, 2.4 + R() * 1.4, .09 * s * k, .3 * s * k, i ? K.smoke : K.smoke2, F_HOT);
    fx.decal(wx, y, wz, (.05 + R() * .03) * s * k + .02, 60, R() < .5 ? 1 : 0);
  }

  private drawScene(g: GameState | null, T: number) {
    const { lit, glow, lines, rig, sprites } = this;
    lit.begin(); glow.begin(); lines.begin(); sprites.begin(); this.meshes.begin(); this.impostors.begin();
    const near = rig.dist < 26;
    // fine model detail (rivets, faces, spokes, markings) only where it can be seen
    this.models.hi = rig.dist < 7; this.models.hiMesh = rig.dist < 12; this.models.t = T;
    if (g) {
      this.dyn.regions(g, rig, T); this.dyn.armies(g, T); this.war.draw(g, T, this.isClose, sprites);
      this.navy.me = this.dyn.me; this.navy.zoomK = this.dyn.zoomK; this.navy.fleet = useUi.getState().fleet; this.navy.draw(g, rig, T, this.lastDt);
      this.net.draw(lines, g, this.session?.me ?? -1, rig);
      for (const b of g.battles) {
        const v = this.views.get(b.id); if (!v || !v.visible) continue;
        v.drawWorks(this.models, b); v.drawAgents(this.models, this.fx, b.agents, g.time, this.now);
      }
    }
    this.ambient.drawShips(this.models, T);
    this.dyn.drawMarker(T);
    this.debug.extra?.(this.models, T);
    this.fx.draw(sprites, near); this.fx.drawTracers(lines);
    lit.end(); glow.end(); lines.end(); sprites.end(rig.camera, T); this.meshes.end(); this.impostors.end();
  }
}

export const createWorldRenderer: CreateRenderer = (canvas, labels, cb) => new WorldRenderer(canvas, labels, cb);
