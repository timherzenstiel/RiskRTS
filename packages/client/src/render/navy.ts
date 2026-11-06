// The navy on the map: harbours and the ships lying in them, fleets at sea (in line astern, with their route over the water),
// assault fleets offshore, and naval battles drawn ship by ship where they are fought: battle lines with turrets trained on the
// target, muzzle flashes and tall shell splashes, hits that burn, magazine explosions, ships listing and going down, torpedo
// tracks, and searchlights at night. Shore bombardment flashes offshore and lands as heavy bursts on the coast.
import * as THREE from 'three';
import { HW, SHIP, coastKey, fleetPos, pathAt, seaHeading, seaWorld, tilePos, wrapDx, zoneAt, type Fleet, type Fx, type GameState, type SeaBattle, type Ship, type World } from '@riskrts/shared';
import type { CameraRig } from './camera';
import type { FxSystem } from './fxSystem';
import { F_BALL, F_FLAME, F_GLOW, F_HOT, F_THIN } from './fxSystem';
import type { Models } from './models';
import { K, facCol } from './palette';
import type { Terrain } from './terrain';
import { Sfx } from '../audio/sfx';

/** Map scale of ships at sea and in port (a dreadnought is about a third of a region's town wide). */
const SHIP_S = .9;
/** Ships in a naval battle are drawn smaller, so a battle line fits the battle area. */
const BATTLE_S = .6;
const R = Math.random;

interface Pending { t: number; x: number; z: number; hit: boolean; big: boolean; y?: number; bomb?: boolean }

export class NavyDraw {
  /** The local player (-1 spectating), selected fleet, zoom factor for route marks. */
  me = -1; fleet = -1; zoomK = 1;
  private readonly pending: Pending[] = [];
  private now = 0;
  private smokeT = 0;
  constructor(private readonly world: World, private readonly terrain: Terrain, private readonly m: Models, private readonly fx: FxSystem) {}

  /** Coast point of a region's harbour: the coast with the longest shore. */
  harbourAt(region: number) {
    // the coast nearest the region's town (where the capital or main city lies)
    const R0 = this.world.regions[region]; let z = R0.zones[0], bd = 1e9;
    for (const k of R0.zones) { const c = R0.coast[k], d = wrapDx(R0.cx, c.x) ** 2 + (R0.cz - c.z) ** 2 - Math.min(40, c.n) * .02; if (d < bd) { bd = d; z = k; } }
    return z === undefined ? null : { zone: z, c: R0.coast[z] };
  }

  draw(g: GameState, rig: CameraRig, T: number, dt: number) {
    this.now += dt;
    const cull = rig.dist * 1.6 + 6, near = (x: number, z: number) => Math.abs(wrapDx(rig.tx, x)) < cull && Math.abs(z - rig.tz) < cull;
    // harbours and the ships in them
    if (rig.dist < 70) for (const r of g.regions) {
      if (!r.port) continue;
      const h = this.harbourAt(r.id); if (!h) continue;
      const { c } = h; if (!near(c.x, c.z)) continue;
      const dx = wrapDx(c.x, c.wx), dz = c.wz - c.z, L = Math.hypot(dx, dz) || 1, face = Math.atan2(dx / L, dz / L);
      const y = Math.max(.12, this.terrain.tileH[c.tile] ?? .12);
      this.m.harbour(c.x + dx / L * .05, y, c.z + dz / L * .05, face + Math.PI, .9, r.portAt !== undefined && r.portAt > g.time);
      const ships = g.ships.filter(s => s.port === r.id && s.fleet < 0 && (s.ready ?? 0) <= g.time);
      ships.sort((a, b) => order(a) - order(b));
      ships.slice(0, 8).forEach((s, i) => {
        const row = Math.floor(i / 4), col = i % 4, along = (col - 1.5) * .34, out = .35 + row * .3;
        const px = c.wx + dx / L * out + (-dz / L) * along, pz = c.wz + dz / L * out + (dx / L) * along;
        this.shipModel(s, px, pz, face + Math.PI / 2, SHIP_S * .85, T, 0);
      });
    }
    // fleets at sea
    for (const fl of g.fleets) {
      if (fl.sea !== undefined || !fl.path.length) continue;
      const p = fleetPos(fl); if (!near(p.x, p.z)) continue;
      const ships = fl.ships.map(id => g.ships.find(s => s.id === id)).filter((s): s is Ship => !!s).sort((a, b) => order(a) - order(b));
      const moving = fl.state === 'sail' || (fl.state === 'muster' && fl.d < fl.len);
      let hd = p.hd;
      if (!moving) { const end = pathAt(fl.path, fl.len); hd = end.hd; }
      // stationed fleets steam slowly round their station
      let ox = 0, oz = 0;
      if (fl.state === 'stationed') { const a = T * .05 + fl.id; ox = Math.cos(a) * .6; oz = Math.sin(a) * .6; hd = a + Math.PI; }
      const sf = Math.sin(hd), cf = Math.cos(hd);
      ships.slice(0, 10).forEach((s, i) => {
        const back = i * .36 * SHIP_S, side = i === 0 ? 0 : (i % 2 ? .12 : -.12);
        const x = p.x + ox - sf * back + cf * side, z = p.z + oz - cf * back - sf * side;
        this.shipModel(s, x, z, hd, SHIP_S, T + i * .7, 0);
        if (moving && R() < dt * 1.5) this.fx.spawn(x - sf * .06, .3, z - cf * .06, -sf * .08, .1, -cf * .08, 0, 2, .04, .13, s.kind === 'trans' ? K.smoke2 : K.smoke, F_THIN);
      });
      if (fl.owner === this.me || fl.id === this.fleet) this.route(fl, T);
      if (fl.state === 'offshore' || fl.state === 'beach' || fl.state === 'unload') this.ring(p.x, p.z, facCol[fl.owner], T, fl.state === 'offshore' ? 1.2 : .9);
      if (fl.id === this.fleet) this.ring(p.x + ox, p.z + oz, K.flash, T, .7);
    }
    // naval battles
    for (const b of g.seaBattles ?? []) if (near(b.x, b.z)) this.battle(g, b, T, dt);
    // shells and splashes still in the air
    for (let i = this.pending.length - 1; i >= 0; i--) { const p = this.pending[i]; if (p.t > this.now) continue; this.pending.splice(i, 1); this.land(p); }
  }

  private shipModel(s: Ship, x: number, z: number, face: number, S: number, T: number, sink: number, aim?: number) {
    const band = facCol[s.owner] ?? K.funnel;
    if (s.kind === 'bb') this.m.ship(x, z, face, band, S, T, false, aim, sink);
    else if (s.kind === 'carrier') this.m.carrier(x, z, face, band, S, T, s.planes ?? 0, sink);
    else if (s.kind === 'land') this.m.lighters(x, z, face, band, S * .55, T, 3, sink);
    else this.m.ship(x, z, face, band, S * .85, T, true, undefined, sink);
  }

  /** Chevrons along the rest of an own fleet's route, over the water. */
  private route(fl: Fleet, T: number) {
    const K2 = this.zoomK, SP = .4 * K2, col = facCol[fl.owner];
    const rem = fl.len - fl.d; if (rem < .1 || (fl.state !== 'sail' && fl.state !== 'muster')) return;
    const phase = (T * .5 * K2) % SP, n = Math.min(80, Math.floor(rem / SP));
    for (let k = 1; k <= n; k++) {
      const d = fl.d + k * SP - phase; if (d > fl.len - .05) break;
      const p = pathAt(fl.path, d);
      for (const sgn of [-1, 1]) this.m.part(p.x, .14, p.z, p.hd + Math.PI + sgn * .75, 0, 0, .06 * K2, .028 * K2, .01, .12 * K2, col, this.m.glowPool);
    }
    const e = pathAt(fl.path, fl.len); this.ring(e.x, e.z, col, T, .5);
  }

  private ring(x: number, z: number, c: THREE.Color, T: number, r0: number) {
    const r = (r0 + Math.sin(T * 4) * .05) * this.zoomK;
    for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; this.m.part(x, .14, z, -a, 0, 0, r, .06 * this.zoomK, .01, .02 * this.zoomK, c, this.m.glowPool); }
  }

  /** One naval battle: every ship at its agent position. */
  private battle(g: GameState, b: SeaBattle, T: number, dt: number) {
    const night = b.age >= b.night && !b.ended;
    this.smokeT -= dt;
    const puff = this.smokeT <= 0; if (puff) this.smokeT = .25;
    for (const a of b.agents) {
      if (a.out) continue;
      const p = seaWorld(b, a.x, a.z), hd = seaHeading(b, a.hd), band = facCol[a.f] ?? K.funnel;
      const since = a.dead ? g.time - (a.dieT || g.time) : 0;
      if (a.dead && since > 14) continue;
      const sink = a.dead ? Math.min(.2, since * .016) : 0;
      if (a.kind === 'pl') { if (!a.dead) this.m.plane(p.x, .55 + Math.sin(T * 2 + a.id) * .03, p.z, hd, band, .55, a.f); continue; }
      if (a.kind === 'dn') this.m.ship(p.x, p.z, hd, band, BATTLE_S, T + a.id, false, a.dead ? undefined : a.aim, sink);
      else if (a.kind === 'dd') this.m.destroyer(p.x, p.z, hd, band, BATTLE_S * .75, T + a.id, sink);
      else if (a.kind === 'cv') this.m.carrier(p.x, p.z, hd, band, BATTLE_S, T + a.id, 0, sink);
      else if (a.kind === 'tr') this.m.ship(p.x, p.z, hd, band, BATTLE_S * .8, T + a.id, true, undefined, sink);
      else this.m.lighters(p.x, p.z, hd, band, BATTLE_S * .5, T + a.id, 3, sink);
      // funnel smoke, fires and the oil slick of the sunk
      if (puff && !a.dead) this.fx.spawn(p.x - Math.sin(hd) * .05, .3, p.z - Math.cos(hd) * .05, -Math.sin(hd) * .06, .1, -Math.cos(hd) * .06, 0, 2.6, .05, .16, K.smoke, F_THIN);
      if (puff && (a.fire > 0 || (a.dead && since < 10))) { this.fx.spawn(p.x, .2, p.z, (R() - .5) * .02, .14, (R() - .5) * .02, 0, 3, .08, .3, K.smoke2, F_HOT); this.fx.spawn(p.x, .16, p.z, 0, .05, 0, 0, .5, .05, .09, K.fire, F_FLAME); }
      if (a.dead && since < 1 && R() < .3) this.fx.decal(p.x, .12, p.z, .25, 30, 1);
      // muzzle flashes of a salvo
      if (!a.dead && g.time - a.fireT < .12 && (a.kind === 'dn' || a.kind === 'dd')) {
        const tb = hd + a.aim, fx = p.x + Math.sin(tb) * .14, fz = p.z + Math.cos(tb) * .14;
        this.fx.spawn(fx, .2, fz, 0, 0, 0, 0, .08, .1, .16, K.flash, F_GLOW);
      }
      // searchlights sweeping at night
      if (night && !a.dead && (a.kind === 'dn' || a.kind === 'cv')) {
        const sw = hd + a.aim + Math.sin(T * .7 + a.id) * .4;
        for (let k = 1; k <= 6; k++) this.m.part(p.x, .3 - k * .02, p.z, sw, 0, 0, k * .3, .02 + k * .015, .004, .3, K.flare, this.m.glowPool);
      }
    }
    // torpedo tracks
    for (const t of b.torps) { const p = seaWorld(b, t.x, t.z), hd = seaHeading(b, t.hd); this.m.part(p.x, .125, p.z, hd, 0, 0, -.12, .012, .004, .24, K.cloud2, this.m.glowPool); }
    // star shells over the night action
    if (night && R() < dt * .8) { const p = seaWorld(b, (R() - .5) * 30, (R() - .5) * 20); this.fx.spawn(p.x, 1.2, p.z, 0, -.08, 0, .05, 3.2, .05, .04, K.flare, F_GLOW); }
  }

  /** Naval effects from the simulation (world units). */
  effect(f: Fx) {
    if (f.k === 'nfire') {
      this.fx.spawn(f.x0, .22, f.z0, 0, .05, 0, 0, 1.4, .05, .14, K.smoke, F_HOT);
      if (f.big) Sfx.gun(f.x0, f.z0, f.x1, f.z1, f.fl);
      this.pending.push({ t: this.now + f.fl, x: f.x1, z: f.z1, hit: f.hit, big: f.big });
    } else if (f.k === 'nboom') {
      const s = f.big;
      Sfx.boom(f.x, f.z, s);
      this.fx.spawn(f.x, .2, f.z, 0, 0, 0, 0, .15, .2 * s, .5 * s, K.flash, F_GLOW);
      this.fx.spawn(f.x, .22, f.z, 0, .15 * s, 0, 0, .9, .14 * s, .35 * s, K.fire, F_BALL);
      // a magazine going up: a towering column of black smoke
      for (let i = 0; i < (s >= 3 ? 10 : 3); i++) this.fx.spawn(f.x + (R() - .5) * .1, .3, f.z + (R() - .5) * .1, (R() - .5) * .03, (.25 + R() * .3) * (s >= 3 ? 1.6 : 1), (R() - .5) * .03, 0, 4 + R() * 3, .1 * s, .45 * s, i % 2 ? K.smoke2 : K.smoke, F_HOT);
      for (let i = 0; i < 8; i++) { const an = R() * 6.28; this.fx.spawn(f.x, .2, f.z, Math.cos(an) * .4, .6 + R() * .6, Math.sin(an) * .4, 3, .9, .03, .02, K.spark, F_GLOW, .12); }
    }
  }

  /** Shore bombardment: the flash of a broadside offshore, the heavy burst landing on the coast after the shell's flight. */
  bombard(x0: number, z0: number, x1: number, z1: number, y1: number, fl: number) {
    this.fx.spawn(x0, .22, z0, 0, 0, 0, 0, .1, .14, .24, K.flash, F_GLOW);
    this.fx.spawn(x0, .24, z0, 0, .06, 0, 0, 1.6, .06, .18, K.smoke, F_HOT);
    Sfx.gun(x0, z0, x1, z1, fl);
    this.pending.push({ t: this.now + fl, x: x1, z: z1, hit: true, big: true, y: y1, bomb: true });
  }

  /** A shell lands: a tall white splash in the sea, or a hit (flash, fire, smoke); a heavy burst ashore. */
  private land(p: Pending) {
    if (p.bomb) {
      const y = p.y ?? .2;
      this.fx.spawn(p.x, y + .04, p.z, 0, 0, 0, 0, .14, .2, .45, K.flash, F_GLOW);
      this.fx.spawn(p.x, y + .06, p.z, 0, .2, 0, 0, .8, .16, .4, K.fire, F_BALL);
      for (let i = 0; i < 4; i++) this.fx.spawn(p.x + (R() - .5) * .1, y + .1, p.z + (R() - .5) * .1, .02, .2 + R() * .1, 0, 0, 3, .12, .4, i ? K.smoke : K.smoke2, F_HOT);
      for (let i = 0; i < 10; i++) { const an = R() * 6.28, sp = .4 + R() * .6; this.fx.spawn(p.x, y + .03, p.z, Math.cos(an) * sp, 1 + R(), Math.sin(an) * sp, 4, .8, .03, .02, K.dirt, 0, y); }
      this.fx.decal(p.x, y, p.z, .12, 60, 1);
      Sfx.boom(p.x, p.z, 1.4);
      return;
    }
    if (p.hit) {
      this.fx.spawn(p.x, .2, p.z, 0, 0, 0, 0, .1, .1, .22, K.flash, F_GLOW);
      this.fx.spawn(p.x, .2, p.z, 0, .08, 0, 0, .6, .06, .16, K.fire, F_FLAME);
      this.fx.spawn(p.x, .24, p.z, 0, .12, 0, 0, 2.4, .06, .22, K.smoke2, F_HOT);
    } else {
      // the tall white column of a heavy shell falling short (two or three side by side for a salvo)
      const s = p.big ? 1 : .5;
      for (let k = 0; k < 6; k++) this.fx.spawn(p.x + (R() - .5) * .04, .13, p.z + (R() - .5) * .04, (R() - .5) * .03, (.6 + R() * .5) * s, (R() - .5) * .03, 1.2, 1.1 + R() * .4, .03 * s, .07 * s, K.cloud, 0, .12);
      this.fx.spawn(p.x, .13, p.z, 0, .02, 0, 0, 1.2, .05 * s, .2 * s, K.cloud2, F_THIN);
    }
  }
}

const order = (s: Ship) => s.kind === 'bb' ? 0 : s.kind === 'carrier' ? 1 : s.kind === 'land' ? 2 : 3;
export { coastKey, tilePos, zoneAt, HW, SHIP };
