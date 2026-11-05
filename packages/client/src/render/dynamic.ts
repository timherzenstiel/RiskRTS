// Per-frame drawing of everything that changes: garrisons, buildings, defences, flags, marching armies, ships and flights.
// Everything is drawn at map scale: a soldier is about the height of a village house, a tank about a house long.
// All of it is pushed into instanced pools; nothing here allocates.
import { DEF_KINDS, HW, armyPos, groundUnits, mainOf, tileAtW, type GameState, type Units, type World } from '@riskrts/shared';
import type { CameraRig } from './camera';
import type { FxSystem } from './fxSystem';
import { F_DUST, F_MAP } from './fxSystem';
import type { Models } from './models';
import type { LineBatch } from './pools';
import { FLAGD, K, facCol } from './palette';
import { sectorPoint } from '@riskrts/shared';
import type { Terrain } from './terrain';
import { lerp } from './util';

/** Map scale of figures and vehicles (1 = battlefield model size). */
export const MAP_S = .5;
/** Map scale of buildings relative to their original model size. */
const BLD = .5;

export class DynamicDraw {
  private factT = 0; private holdT = 0;
  /** Highlighted sector while the fortify tab is open: [region, sector] or null. */
  marker: [number, number] | null = null;
  /** Map layer (0 all, 1 troops, 2 industry) and the selected region (its borders always show their front lines). */
  layer = 0; sel = -1;
  constructor(private readonly world: World, private readonly terrain: Terrain, private readonly m: Models, private readonly lines: LineBatch, private readonly fx: FxSystem) {}

  private hAt(x: number, z: number, fallback: number) { const i = tileAtW(x, z); return i >= 0 && this.world.land[i] ? this.terrain.tileH[i] : fallback; }

  /** Garrison figures, flags, factories, barracks, airfields, trenches and fixed defences. */
  regions(g: GameState, rig: CameraRig, T: number) {
    const m = this.m, near = rig.dist < 26, cull = rig.dist * 3 + 8, S = MAP_S;
    for (const def of this.world.regions) {
      const t = g.regions[def.id], x = def.cx, z = def.cz;
      if (Math.abs(x - rig.tx) > cull || Math.abs(z - rig.tz) > cull) continue;
      const y = this.terrain.anchorH(def.id), f = t.owner;
      if (rig.dist < 45) this.defences(g, def.id, y, T);
      if (t.battle >= 0 && near) continue;
      // buildings stand on their own plots around the town, larger than the troops so they read at map zoom (larger still on the industry layer)
      const B = this.layer === 2 ? BLD * 1.9 : this.layer === 1 ? BLD * .9 : BLD * 1.5, O = this.layer === 2 ? 1.35 : 1.2, showB = this.layer !== 1;
      const P = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, c: typeof K.pole, pool?: Parameters<Models['part']>[11]) => m.part(x, y, z, 0, lx, ly * B, lz, sx * B, sy * B, sz * B, c, pool);
      if (t.capitalOf >= 0 && t.capitalOf === f) {
        P(-.12, .45, -.32, .035, .9, .035, K.pole); P(-.12, .91, -.32, .05, .03, .05, K.flash);
        for (let k = 0; k < 6; k++) { const w = Math.sin(T * 3 + k * .8 + def.id) * .012 * k / 5; m.part(x, y, z, 0, -.095 + k * .03, .4 * B / BLD, -.32 + w, .03 * B / BLD, .11 * B / BLD, .01, k % 2 ? facCol[f] : FLAGD[f]); }
      } else if (t.capitalOf >= 0) P(-.12, .3, -.32, .035, .6, .035, K.pole);
      if (t.factory && showB) {
        const fx = .5 * O + .1, fz = -.22 * O;
        P(fx, .15, fz, .5, .3, .38, K.brick);
        for (let k = 0; k < 3; k++) P(fx - .085 * B / BLD + k * .08 * B / BLD, .34, fz, .13, .07, .38, K.brick2);
        P(fx + .08 * B / BLD, .33, fz - .08 * B / BLD, .1, .66, .1, K.brick2); P(fx + .08 * B / BLD, .68, fz - .08 * B / BLD, .12, .04, .12, K.gun);
        for (let k = 0; k < 3; k++) P(fx - .075 * B / BLD + k * .075 * B / BLD, .16, fz + .095 * B / BLD, .07, .08, .01, K.flash, m.glowPool);
      }
      if (t.barracks && showB) {
        const bx = -.5 * O - .1, bz = -.18 * O;
        P(bx, .08, bz, .6, .16, .3, K.bar); P(bx, .19, bz, .64, .06, .34, K.roof); P(bx, .235, bz, .4, .04, .2, K.roof);
        for (let k = 0; k < 4; k++) P(bx - .11 * B / BLD + k * .075 * B / BLD, .09, bz + .076 * B / BLD, .05, .05, .01, K.flash, m.glowPool);
      }
      if (t.airfield && showB) m.airfield(x + .05, this.hAt(x + .05, z + .62 * O, y), z + .62 * O, Math.PI / 2, f, this.layer === 2 ? .95 : .8, t.battle >= 0 ? 0 : t.units.plane, T);
      if (rig.dist < 45) this.works(t, def.id, y);
      if (this.layer !== 2) this.frontLines(g, def.id, y, rig.dist);
      if (this.layer === 2) continue;
      // the main army in the middle, each corps at its border (a region in battle keeps only what is not fighting)
      if (t.battle < 0 || !near) this.garrison(x, y, z, f, t.fr ? mainOf(t) : t.units, S);
      if (t.fr) for (const [ks, c] of Object.entries(t.fr)) {
        const p = sectorPoint(this.world, def.id, +ks), dx = x - p.x, dz = z - p.z, L = Math.hypot(dx, dz) || 1, px = p.x + dx / L * .22, pz = p.z + dz / L * .22;
        this.garrison(px, this.hAt(px, pz, y), pz, f, c.u, S * .9, Math.atan2(-dx, -dz));
      }
    }
  }

  /**
   * Front lines along each border: a corps there draws a solid line in its colour, thicker the stronger it is, with teeth
   * facing the neighbour; an unmanned border facing a foreign power is dashed (only for the selected region, or up close).
   */
  private frontLines(g: GameState, rid: number, y0: number, dist: number) {
    const t = g.regions[rid], R = this.world.regions[rid], m = this.m, f = t.owner; if (f < 0) return;
    const close = dist < 60 || this.layer === 1 || rid === this.sel;
    for (const n of R.adj) {
      const c = t.fr?.[n], foe = g.regions[n].owner !== f;
      if (!c && !(foe && (rid === this.sel || (this.layer === 1 && g.viewer === f)))) continue;
      if (c && !close) continue;
      const p = sectorPoint(this.world, rid, n), face = Math.atan2(p.x - R.cx, p.z - R.cz), y = this.hAt(p.x, p.z, y0) + .03;
      const L = 1.5, zoom = Math.max(1, dist / 30);
      if (c) {
        const st = groundUnits(c.u), w = (.06 + .018 * Math.min(8, st)) * zoom, col = facCol[f];
        m.part(p.x, y, p.z, face, 0, 0, 0, L, .04, w, col, m.glowPool);
        // teeth towards the enemy, like the hatching of a trench map
        if (foe) for (let k = 0; k < 6; k++) m.part(p.x, y, p.z, face, -L / 2 + L * (k + .5) / 6, 0, w * .5 + .05 * zoom, .07 * zoom, .04, .1 * zoom, col, m.glowPool);
      } else for (let k = 0; k < 6; k++) m.part(p.x, y, p.z, face, -L / 2 + L * (k + .5) / 6, 0, 0, L / 12, .03, .05 * zoom, K.flare, m.glowPool);
    }
  }

  /** A small formation: up to 12 riflemen, then gun teams, field guns and tanks beside them. */
  private garrison(x: number, y: number, z: number, f: number, u: Units, S: number, face = 0) {
    const m = this.m, co = Math.cos(face), si = Math.sin(face);
    // local (lx along the line, lz forward) to world
    const at = (lx: number, lz: number): [number, number] => [x + lx * co + lz * si, z - lx * si + lz * co];
    const inf = u.inf ? Math.min(12, Math.max(1, Math.ceil(u.inf / 2))) : 0, cols = 4, sp = .055;
    for (let k = 0; k < inf; k++) { const cx = (k % cols) - (cols - 1) / 2, cz = Math.floor(k / cols); const [wx, wz] = at(cx * sp, .05 - cz * sp); m.soldier(wx, y, wz, face, f, S, false, 0); }
    for (let k = 0; k < Math.min(3, u.mg); k++) { const [wx, wz] = at(-.09 + k * .09, .12); m.unit('mg', wx, y, wz, face, f, S * .9, 0, 0); }
    for (let k = 0; k < Math.min(3, u.art); k++) { const [wx, wz] = at(-.28, -.02 - k * .1); m.unit('art', wx, y, wz, face + .35, f, S * .9, 0, 0); }
    for (let k = 0; k < Math.min(3, u.tank); k++) { const [wx, wz] = at(.3, -.02 - k * .13); m.unit('tank', wx, y, wz, face - .4, f, S * .9, 0, 0); }
  }

  /** Fixed defences stand on their border sector, facing the neighbour they guard. */
  private defences(g: GameState, rid: number, y0: number, T: number) {
    const t = g.regions[rid]; if (!t.defs.length) return;
    const W = this.world, R = W.regions[rid], m = this.m;
    const bySec = new Map<number, number>();
    for (const d of t.defs) {
      const n = t.defs.filter(o => o.s === d.s).length, k = bySec.get(d.s) ?? 0; bySec.set(d.s, k + 1);
      const p = sectorPoint(W, rid, d.s), off = (k - (n - 1) / 2) * .16 * (d.s < 0 ? 1.4 : 1);
      const x = p.x + p.ux * off, z = p.z + p.uz * off, y = this.hAt(x, z, y0);
      const face = d.s < 0 ? 0 : Math.atan2(x - R.cx, z - R.cz), hold = d.f !== t.owner;
      const S = .72 * (.75 + .25 * Math.max(.2, d.hp / 80));
      if (d.k === 'pill') m.pillbox(x, y, z, face, d.f, S, hold);
      else if (d.k === 'bunk') m.bunker(x, y, z, face, d.f, S * .8, hold);
      else if (d.k === 'fort') m.emplacement(x, y, z, face, d.f, S);
      else m.flak(x, y, z, face, d.f, S, 0);
      if (hold && Math.random() < .015) this.fx.spawn(x, y + .05, z, .01, .12, 0, 0, 2.5, .03, .12, K.smoke2, F_MAP);
    }
    void DEF_KINDS; void T;
  }

  /** Field works on each border: the trench line, sandbags on its parapet, wire belts in front, facing the neighbour. */
  private works(t: GameState['regions'][number], rid: number, y0: number) {
    const W = this.world, R = W.regions[rid], m = this.m;
    for (const [ks, w] of Object.entries(t.works)) {
      if (!w.tr && !w.sand && !w.wire) continue;
      const s = +ks, p = sectorPoint(W, rid, s), face = Math.atan2(p.x - R.cx, p.z - R.cz), ox = Math.sin(face), oz = Math.cos(face);
      const at = (d: number): [number, number, number] => { const x = p.x + ox * d, z = p.z + oz * d; return [x, this.hAt(x, z, y0), z]; };
      if (w.tr) { const [x, y, z] = at(.2); m.trenchLine(x, y, z, face, .7, w.tr, 1.4); }
      if (w.sand) { const [x, y, z] = at(.26); m.sandbags(x, y, z, face, .6, w.sand, 1.3); }
      if (w.wire) for (let k = 0; k < w.wire; k++) { const [x, y, z] = at(.36 + k * .08); m.wireBelt(x, y, z, face, .75, .8, 1.3); }
    }
  }

  /** Pulsing ring on the border sector picked in the fortify tab. */
  drawMarker(T: number) {
    if (!this.marker) return;
    const [rid, sec] = this.marker, p = sectorPoint(this.world, rid, sec), y = this.hAt(p.x, p.z, this.terrain.anchorH(rid)), r = .16 + Math.sin(T * 5) * .02;
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; this.m.part(p.x, y, p.z, -a, 0, .02, r, .045, .012, .012, K.flare, this.m.glowPool); }
  }

  /** Marching columns, ships carrying armies, aircraft in flight and their dashed route lines. */
  armies(g: GameState, T: number) {
    const m = this.m, S = MAP_S;
    for (const a of g.armies) {
      const [x, z] = armyPos(a), face = Math.atan2(a.dx, a.dz), c = Math.cos(face), s = Math.sin(face);
      if (a.air) {
        // a V formation: the lead aircraft, then pairs stepping back and out
        const y = Math.max(this.terrain.anchorH(a.from), this.terrain.anchorH(a.to)) + .9 + Math.sin(a.t * Math.PI) * .4, n = Math.min(9, Math.max(1, a.units.plane));
        for (let k = 0; k < n; k++) {
          const row = Math.ceil(k / 2), bx = row * (k % 2 ? -.15 : .15), bz = -row * .13;
          m.plane(x + bx * c + bz * s, y + Math.sin(T * 3 + k) * .012 - row * .015, z - bx * s + bz * c, face, facCol[a.owner], .75, a.owner);
        }
      } else if (a.sea) {
        // the transport, with escorts in line astern for larger forces
        const tot = a.units.inf + a.units.mg + a.units.art + a.units.tank, n = Math.min(4, 1 + Math.floor(tot / 10));
        for (let k = 0; k < n; k++) { const back = k * .55, side = k === 0 ? 0 : (k % 2 ? .3 : -.3); m.ship(x - s * back + c * side, z - c * back - s * side, face, facCol[a.owner], k === 0 ? 1.1 : .8, T + k * .7); }
      } else this.column(a, x, z, face, T);
      const fc = facCol[a.owner], rem = 1 - a.t, steps = Math.ceil(rem * Math.hypot(a.dx, a.dz) / .6), ly = a.air ? 1.2 : .62;
      for (let st = 0; st < steps; st++) {
        if (a.ret && st % 2) continue;
        const t0 = a.t + (st / steps) * rem, t1 = a.t + ((st + .5) / steps) * rem;
        let x0 = a.ax + a.dx * t0, x1 = a.ax + a.dx * t1;
        if (x0 < -HW) x0 += 2 * HW; if (x0 > HW) x0 -= 2 * HW; if (x1 < -HW) x1 += 2 * HW; if (x1 > HW) x1 -= 2 * HW;
        if (Math.abs(x1 - x0) < 5) this.lines.add(x0, ly, a.az + a.dz * t0, x1, ly, a.az + a.dz * t1, fc);
      }
    }
  }

  /**
   * A marching column, front to back: tanks in pairs, a block of riflemen three abreast, machine-gun teams, then towed guns.
   * Figures are roughly one per unit (capped), so a big army reads as a long column.
   */
  private column(a: GameState['armies'][number], x: number, z: number, face: number, T: number) {
    const m = this.m, S = MAP_S, u = a.units, c = Math.cos(face), s = Math.sin(face), f = a.owner;
    const y0 = lerp(this.terrain.anchorH(a.from), this.terrain.anchorH(a.to), a.t);
    const nT = Math.min(8, u.tank), nI = Math.min(45, u.inf), nM = Math.min(6, u.mg), nA = Math.min(5, u.art);
    const TS = .15, IS = .055, MS = .085, AS = .14;
    const len = Math.ceil(nT / 2) * TS + Math.ceil(nI / 3) * IS + Math.ceil(nM / 2) * MS + nA * AS;
    // a dust trail kicked up behind a column on the march (not for troops waiting at the start line or going by sea)
    if (!a.sea && !a.wait && a.t > 0 && a.t < 1 && Math.random() < .35 + nT * .05) {
      const r = Math.random(), bx = x - s * len * (.5 + r * .6), bz = z - c * len * (.5 + r * .6);
      this.fx.spawn(bx + (Math.random() - .5) * .08, y0 + .03, bz + (Math.random() - .5) * .08, (Math.random() - .5) * .03, .03, (Math.random() - .5) * .03, 0, 1.8, .05, .16, K.dust, F_DUST);
    }
    let fwd = len / 2;
    // one helper places a figure `fwd` along the march and `side` to the right, standing on the ground
    const P = (side: number) => { const px = x + s * fwd + c * side, pz = z + c * fwd - s * side; return [px, this.hAt(px, pz, y0), pz] as const; };
    for (let k = 0; k < nT; k += 2) {
      for (let j = 0; j < Math.min(2, nT - k); j++) { const [px, py, pz] = P(nT - k === 1 ? 0 : (j ? .07 : -.07)); m.unit('tank', px, py, pz, face, f, S * .9, 0, 0); }
      if (Math.random() < .02) { const [px, py, pz] = P(0); this.fx.spawn(px - s * .08, py + .05, pz - c * .08, 0, .08, 0, 0, 1.6, .02, .07, K.smoke2, F_MAP); }
      fwd -= TS;
    }
    for (let k = 0; k < nI; k++) {
      const col = k % 3, side = (col - 1) * .04 + Math.sin(k * 7.1) * .005;
      const [px, py, pz] = P(side); m.soldier(px, py, pz, face, f, S, false, T * 9 + k * 1.3);
      if (col === 2 || k === nI - 1) fwd -= IS;
    }
    for (let k = 0; k < nM; k++) { const [px, py, pz] = P(k % 2 ? .045 : -.045); m.unit('mg', px, py, pz, face, f, S * .9, T * 9 + k, 0); if (k % 2 || k === nM - 1) fwd -= MS; }
    for (let k = 0; k < nA; k++) { const [px, py, pz] = P(0); m.unit('art', px, py, pz, face, f, S * .9, 0, 0); fwd -= AS; }
  }

  /** Smoke from factory chimneys (a few puffs per second across the map). */
  factorySmoke(g: GameState, dt: number) {
    this.factT += dt; this.holdT += dt; if (this.factT < .5) return; this.factT -= .5;
    for (const def of this.world.regions) {
      const t = g.regions[def.id];
      if (t.factory && t.battle < 0 && Math.random() < .7) this.fx.spawn(def.cx + .58, this.terrain.anchorH(def.id) + .34, def.cz - .3, .03, .14, -.01, 0, 2.4, .05, .17, K.smoke, F_MAP);
    }
  }
}
