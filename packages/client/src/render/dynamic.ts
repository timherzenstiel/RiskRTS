// Per-frame drawing of everything that changes: garrisons, buildings, defences, flags, marching armies, ships and flights.
// Everything is drawn at map scale: a soldier is about the height of a village house, a tank about a house long.
// All of it is pushed into instanced pools; nothing here allocates.
import * as THREE from 'three';
import { toBorderDist } from './borderField';
import { DEF_KINDS, HW, armyPos, coastThreat, corpsAtPost, groundUnits, mainOf, postUnits, tileAtW, type GameState, type Units, type World } from '@riskrts/shared';
import type { CameraRig } from './camera';
import type { FxSystem } from './fxSystem';
import { F_DUST, F_MAP } from './fxSystem';
import type { Models } from './models';
import type { LineBatch } from './pools';
import { FLAGD, K, facCol } from './palette';
import { battleAnchor, sectorPoint } from '@riskrts/shared';
import type { Terrain } from './terrain';
import { lerp } from './util';

/** Map scale of figures and vehicles (1 = battlefield model size). */
/** Below this camera distance the close-up ground paints trenches, wire and borders itself. */
export const CLOSE_PAINT = 15;
export const MAP_S = .5;
/** Map scale of buildings relative to their original model size. */
const BLD = .5;

/** Dark outline under the attack arrows, so a grey or purple arrow still reads on land of the same colour. */
const INK = new THREE.Color(.04, .035, .03);

/**
 * How much larger than life troop figures are drawn at camera distance `dist`: life size up close, growing with the distance
 * from the battle band outwards so a figure stays roughly a dozen pixels tall, capped where the map shows whole continents.
 */
export const unitScale = (dist: number) => Math.max(1, Math.min(11, dist / 6));
/** Formations spread less than their figures grow, so a corps stays a compact block. */
const spread = (k: number) => 1 + (k - 1) * .55;
/** Beyond this camera distance the map shows continents: no figures, the tokens carry the numbers. */
const UNIT_FAR = 105;

export class DynamicDraw {
  private factT = 0; private holdT = 0;
  /** Camera distance of the frame being drawn. */
  private dist = 99;
  /** Scale of troop figures for this frame (see unitScale). */
  private unitK = 1;
  /** Highlighted sector while the fortify tab is open: [region, sector] or null. */
  marker: [number, number] | null = null;
  /** Map layer (0 all, 1 troops, 2 industry) and the selected region (its borders always show their front lines). */
  layer = 0; sel = -1;
  constructor(private readonly world: World, private readonly terrain: Terrain, private readonly m: Models, private readonly lines: LineBatch, private readonly fx: FxSystem) {}

  private hAt(x: number, z: number, fallback: number) { const i = tileAtW(x, z); return i >= 0 && this.world.land[i] ? this.terrain.tileH[i] : fallback; }

  /** Garrison figures, flags, factories, barracks, airfields, trenches and fixed defences. */
  regions(g: GameState, rig: CameraRig, T: number) {
    const m = this.m, near = rig.dist < 26, cull = rig.dist * 3 + 8; this.dist = rig.dist;
    // troops keep about the same size on screen from the battle band outwards, so a corps reads as a block of men at front zoom
    const UK = this.unitK = unitScale(rig.dist), S = MAP_S * UK;
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
      if (t.factory && showB && m.mesh?.has('factory')) m.mesh.push('factory', x + .5 * O + .1, y, z - .22 * O, 0, B * 1.05, facCol[f] ?? K.pole);
      else if (t.factory && showB) {
        const fx = .5 * O + .1, fz = -.22 * O;
        P(fx, .15, fz, .5, .3, .38, K.brick);
        for (let k = 0; k < 3; k++) P(fx - .085 * B / BLD + k * .08 * B / BLD, .34, fz, .13, .07, .38, K.brick2);
        P(fx + .08 * B / BLD, .33, fz - .08 * B / BLD, .1, .66, .1, K.brick2); P(fx + .08 * B / BLD, .68, fz - .08 * B / BLD, .12, .04, .12, K.gun);
        for (let k = 0; k < 3; k++) P(fx - .075 * B / BLD + k * .075 * B / BLD, .16, fz + .095 * B / BLD, .07, .08, .01, K.flash, m.glowPool);
      }
      if (t.barracks && showB && m.mesh?.has('barracks')) m.mesh.push('barracks', x - .5 * O - .1, y, z - .18 * O, 0, B * 1.05, facCol[f] ?? K.pole);
      else if (t.barracks && showB) {
        const bx = -.5 * O - .1, bz = -.18 * O;
        P(bx, .08, bz, .6, .16, .3, K.bar); P(bx, .19, bz, .64, .06, .34, K.roof); P(bx, .235, bz, .4, .04, .2, K.roof);
        for (let k = 0; k < 4; k++) P(bx - .11 * B / BLD + k * .075 * B / BLD, .09, bz + .076 * B / BLD, .05, .05, .01, K.flash, m.glowPool);
      }
      if (t.airfield && showB) m.airfield(x + .05, this.hAt(x + .05, z + .62 * O, y), z + .62 * O, Math.PI / 2, f, this.layer === 2 ? .95 : .8, t.battle >= 0 ? 0 : t.units.plane, T);
      // up close the painted ground digs the trenches, parapets and wire in along the whole border (groundPaint.ts)
      if (rig.dist < 45 && rig.dist >= CLOSE_PAINT) this.works(t, def.id, y);
      else if (rig.dist < CLOSE_PAINT) this.works(t, def.id, y, true);
      if (this.layer !== 2) this.frontLines(g, def.id, y, rig.dist);
      if (this.layer === 2) continue;
      // the main army in the middle, each corps at its border (a region in battle keeps only what is not fighting)
      if (rig.dist > UNIT_FAR) continue;
      if (t.battle < 0 || !near) this.garrison(x, y, z, f, t.cs ? mainOf(t) : t.units, S, 0, UK);
      if (t.cs) for (const ks of new Set(t.cs.filter(c => c.p >= 0).map(c => c.p))) {
        const p = sectorPoint(this.world, def.id, ks), dx = x - p.x, dz = z - p.z, L = Math.hypot(dx, dz) || 1, back = Math.min(L * .45, .22 * spread(UK)), px = p.x + dx / L * back, pz = p.z + dz / L * back;
        this.garrison(px, this.hAt(px, pz, y), pz, f, postUnits(t, ks), S * .9, Math.atan2(-dx, -dz), UK);
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
    for (const n of R.sectors) {
      const c = corpsAtPost(t, n).length ? { u: postUnits(t, n) } : undefined, foe = n >= 1000 ? coastThreat(g, f, n - 1000) > 0 : g.regions[n].owner !== f;
      if (!c && !(foe && (rid === this.sel || (this.layer === 1 && g.viewer === f)))) continue;
      if (c && !close) continue;
      // up close the dug-in trench shows the front; the staff-map bar would cover the troops
      if (dist < CLOSE_PAINT) continue;
      const p = sectorPoint(this.world, rid, n), face = Math.atan2(p.x - R.cx, p.z - R.cz), y = this.hAt(p.x, p.z, y0) + .03;
      const L = 1.5, zoom = Math.max(1, dist / 30);
      if (c) {
        const st = groundUnits(c.u), w = (.06 + .018 * Math.min(8, st)) * zoom, col = facCol[f];
        m.part(p.x, y, p.z, face, 0, 0, 0, L, .04, w, col, m.glowPool);
        // teeth towards the enemy, like the hatching of a trench map
        if (foe) for (let k = 0; k < 6; k++) m.part(p.x, y, p.z, face, -L / 2 + L * (k + .5) / 6, 0, w * .5 + .05 * zoom, .07 * zoom, .04, .1 * zoom, col, m.glowPool);
      } else for (let k = 0; k < 6; k++) m.part(p.x, y, p.z, face, -L / 2 + L * (k + .5) / 6, 0, 0, L / 12, .03, .05 * zoom, K.flare, m.glowPool);
    }
    // a foothold: the attacker holds this border's first line, so their front bulges into the region (design 4a)
    for (const b of g.battles) {
      if (b.ended || b.region !== rid || b.stage !== 3 || b.from < 0) continue;
      const p = sectorPoint(this.world, rid, b.from), col = facCol[b.attacker], zoom = Math.max(1, dist / 30);
      const ix = R.cx - p.x, iz = R.cz - p.z, il = Math.hypot(ix, iz) || 1, nx = ix / il, nz = iz / il, depth = Math.min(.8, il * .4);
      const pts: [number, number][] = [];
      for (let k = 0; k <= 10; k++) { const t = k / 10 * 2 - 1, bow = depth * Math.cos(t * Math.PI / 2); pts.push([p.x + p.ux * t * 1.1 + nx * bow, p.z + p.uz * t * 1.1 + nz * bow]); }
      for (let k = 0; k < 10; k++) {
        const [x0, z0] = pts[k], [x1, z1] = pts[k + 1], mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, len = Math.hypot(x1 - x0, z1 - z0), fc = Math.atan2(x1 - x0, z1 - z0);
        const y = this.hAt(mx, mz, y0) + .035;
        m.part(mx, y, mz, fc, 0, 0, 0, .07 * zoom, .04, len, col, m.glowPool);
        if (k % 2 === 0) m.part(mx + nx * .05 * zoom, y, mz + nz * .05 * zoom, fc, 0, 0, 0, .1 * zoom, .04, .06 * zoom, col, m.glowPool); // teeth into the depth
      }
    }
  }

  /** A small formation: up to 12 riflemen, then gun teams, field guns and tanks beside them. */
  /**
   * A group of troops at its post. `k` is the zoom scale of the figures (1 up close): further out the formation is drawn with
   * fewer, larger figures on a plate in the owner's colour, so it reads as that power's troops (design-optimize §5.4).
   */
  private garrison(x: number, y: number, z: number, f: number, u: Units, S: number, face = 0, k = 1) {
    const m = this.m, co = Math.cos(face), si = Math.sin(face), far = k > 1.35, sk = spread(k);
    // local (lx along the line, lz forward) to world
    const at = (lx: number, lz: number): [number, number] => [x + lx * sk * co + lz * sk * si, z - lx * sk * si + lz * sk * co];
    const inf = u.inf ? Math.min(far ? 6 : 12, Math.max(far ? 2 : 1, far ? u.inf : Math.ceil(u.inf / 2))) : 0, cols = far ? 3 : 4, sp = .055, heavy = far ? 2 : 3;
    const nM = Math.min(heavy, u.mg), nA = Math.min(heavy, u.art), nT = Math.min(heavy, u.tank);
    if (far && f >= 0 && inf + nM + nA + nT > 0) {
      // the plate: a dark rim, then the owner's colour (ours brighter), lying on the ground under the formation
      const w = (.22 + (nA ? .16 : 0) + (nT ? .18 : 0)) * sk, d = (.12 + Math.ceil(inf / cols) * sp + (nM ? .06 : 0)) * sk, cx = ((nT ? .09 : 0) - (nA ? .08 : 0)) * sk, cz = .03 * sk;
      const px = x + cx * co + cz * si, pz = z - cx * si + cz * co, own = f === this.me;
      m.part(px, y + .012, pz, face, 0, 0, 0, w + .05 * sk, .012, d + .05 * sk, INK, m.glowPool);
      m.part(px, y + .02, pz, face, 0, 0, 0, w, .012, d, own ? facCol[f] : this.dimCol(f), m.glowPool);
    }
    for (let i = 0; i < inf; i++) { const cx = (i % cols) - (cols - 1) / 2, cz = Math.floor(i / cols); const [wx, wz] = at(cx * sp, .05 - cz * sp); m.soldier(wx, y, wz, face, f, S, false, 0); }
    for (let i = 0; i < nM; i++) { const [wx, wz] = at(-.09 + i * .09, .12); m.unit('mg', wx, y, wz, face, f, S * .9, 0, 0); }
    for (let i = 0; i < nA; i++) { const [wx, wz] = at(-.28, -.02 - i * .1); m.unit('art', wx, y, wz, face + .35, f, S * .9, 0, 0); }
    for (let i = 0; i < nT; i++) { const [wx, wz] = at(.3, -.02 - i * .13); m.unit('tank', wx, y, wz, face - .4, f, S * .9, 0, 0); }
  }

  /** Fixed defences stand on their border sector, facing the neighbour they guard. */
  private defences(g: GameState, rid: number, y0: number, T: number) {
    const t = g.regions[rid]; if (!t.defs.length) return;
    const W = this.world, R = W.regions[rid], m = this.m;
    const bySec = new Map<number, number>();
    for (const d of t.defs) {
      const n = t.defs.filter(o => o.s === d.s).length, k = bySec.get(d.s) ?? 0; bySec.set(d.s, k + 1);
      const p = sectorPoint(W, rid, d.s), off = (k - (n - 1) / 2) * (this.dist < CLOSE_PAINT ? .3 : .16) * (d.s < 0 ? 1.4 : 1);
      let x = p.x + p.ux * off, z = p.z + p.uz * off;
      // up close, border defences stand just behind the fire trench the ground digs along that border
      if (d.s >= 0 && this.dist < CLOSE_PAINT) [x, z] = toBorderDist(this.terrain.border, x, z, .78);
      const y = this.hAt(x, z, y0);
      const face = d.s < 0 ? 0 : Math.atan2(x - R.cx, z - R.cz), hold = d.f !== t.owner;
      const S = (this.dist < CLOSE_PAINT ? .46 : .72) * (.75 + .25 * Math.max(.2, d.hp / 80));
      if (d.k === 'pill') m.pillbox(x, y, z, face, d.f, S, hold);
      else if (d.k === 'bunk') m.bunker(x, y, z, face, d.f, S * .8, hold);
      else if (d.k === 'fort') m.emplacement(x, y, z, face, d.f, S);
      else m.flak(x, y, z, face, d.f, S, 0);
      if (hold && Math.random() < .015) this.fx.spawn(x, y + .05, z, .01, .12, 0, 0, 2.5, .03, .12, K.smoke2, F_MAP);
    }
    void DEF_KINDS; void T;
  }

  /** Field works on each border: the trench line, sandbags on its parapet, wire belts in front, facing the neighbour. */
  private works(t: GameState['regions'][number], rid: number, y0: number, coastsOnly = false) {
    const W = this.world, R = W.regions[rid], m = this.m;
    for (const [ks, w] of Object.entries(t.works)) {
      if (!w.tr && !w.sand && !w.wire) continue;
      // the close-up ground paints land borders itself; coasts are drawn here at every zoom
      if (coastsOnly && +ks < 1000) continue;
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
    this.dtA = Math.max(0, Math.min(.1, T - this.lastT)); this.lastT = T;
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
      this.route(a, T);
    }
  }

  /**
   * The route ahead of a moving army, C&C style: chevrons in its colour marching along the ground (or at altitude for aircraft)
   * from the column to the destination, which gets a pulsing ring. Your own routes glow; others' are dimmer. A retreat is gapped.
   */
  private route(a: GameState["armies"][number], T: number) {
    const m = this.m, own = a.owner === this.me, len = Math.hypot(a.dx, a.dz), rem = (1 - a.t) * len;
    if (rem < .05) return;
    const face = Math.atan2(a.dx, a.dz), ux = a.dx / len, uz = a.dz / len;
    const col = own ? facCol[a.owner] : this.dimCol(a.owner), K2 = this.zoomK, SP = .32 * K2, L = .12 * K2, W = .03 * K2;
    const groundY = (x: number, z: number) => a.air ? 1.2 : Math.max(.34, this.hAt(x, z, .2) + .1);
    const wrap = (x: number) => x < -HW ? x + 2 * HW : x > HW ? x - 2 * HW : x;
    const x0 = a.ax + a.dx * a.t, z0 = a.az + a.dz * a.t, phase = (T * .45 * K2) % SP;
    const n = Math.min(60, Math.floor(rem / SP));
    for (let k = 0; k <= n; k++) {
      if (a.ret && k % 2) continue;
      const d = .2 * K2 + k * SP + phase; if (d > rem - .06) break;
      const x = wrap(x0 + ux * d), z = z0 + uz * d, y = groundY(x, z);
      for (const sgn of [-1, 1]) m.part(x, y, z, face + Math.PI + sgn * .75, 0, 0, L / 2, W, .01, L, col, m.glowPool);
    }
    // destination: a pulsing ring of ticks
    const tx = wrap(a.ax + a.dx), tz = a.az + a.dz, ty = groundY(tx, tz), r = (.14 + Math.sin(T * 4) * .02) * K2;
    for (let k = 0; k < 10; k++) { const an = k / 10 * Math.PI * 2; m.part(tx, ty, tz, -an, 0, 0, r, .05 * K2, .01, .02 * K2, col, m.glowPool); }
  }
  /**
   * Attack arrows: every battle you can see gets a broad arrow in the attacker's colour, from the region it attacks out of to the
   * contested border, so the map says who attacks whom at a glance. Fights you are in are bright; other powers' wars are dimmer.
   * Hidden close in, where the battlefield itself shows the fight.
   */
  fronts(g: GameState, T: number, dist: number) {
    if (dist < 13) return;
    const m = this.m, W = this.world, K2 = this.zoomK;
    for (const b of g.battles) {
      if (b.ended || b.attacker < 0) continue;
      const end = battleAnchor(W, b), mine = b.sides.includes(this.me) || b.def === this.me;
      let sx: number, sz: number;
      if (b.from >= 0 && b.from < W.regions.length && W.regions[b.region].adj.includes(b.from)) { const R = W.regions[b.from]; sx = R.cx; sz = R.cz; }
      else { const L = 3.2 * K2; sx = end.x + b.ax * L; sz = end.z + b.az * L; }
      // the shortest way round the date line
      let dx = sx - end.x; if (dx > HW) dx -= 2 * HW; else if (dx < -HW) dx += 2 * HW;
      const dz = sz - end.z, full = Math.hypot(dx, dz); if (full < .05) continue;
      const ux = -dx / full, uz = -dz / full, face = Math.atan2(ux, uz);
      // start a little out of the source region, stop just short of the border
      const len = Math.min(full * .8, 6 * K2), head = Math.min(.55 * K2, len * .4), x0 = end.x - ux * len, z0 = end.z - uz * len;
      const col = mine ? facCol[b.attacker] : this.dimCol(b.attacker), w = (mine ? .2 : .14) * K2, pulse = (T * .6) % 1;
      const yAt = (x: number, z: number) => Math.max(.36, this.hAt(x, z, .2) + .14);
      const wrap = (x: number) => x < -HW ? x + 2 * HW : x > HW ? x - 2 * HW : x;
      // shaft in short pieces (so it follows the ground and the globe), with a bright band running towards the target
      const shaft = len - head, n = Math.max(2, Math.ceil(shaft / (.25 * K2))), seg = shaft / n;
      for (let k = 0; k < n; k++) {
        const d = (k + .5) * seg, x = wrap(x0 + ux * d), z = z0 + uz * d, f = k / n, lit = Math.abs(f - pulse) < .12;
        const y = yAt(x, z), ww = w * (.55 + .45 * f);
        m.part(x, y - .006, z, face, 0, 0, 0, ww + .07 * K2, .012, seg * 1.02, INK, m.glowPool);
        m.part(x, y, z, face, 0, 0, 0, ww, .012, seg * 1.02, lit ? this.hiCol(b.attacker) : col, m.glowPool);
      }
      // head: stacked bars narrowing to the point
      for (let k = 0; k < 6; k++) {
        const d = shaft + (k + .5) * head / 6, x = wrap(x0 + ux * d), z = z0 + uz * d;
        const y = yAt(x, z), ww = w * 2.6 * (1 - k / 6);
        m.part(x, y - .006, z, face, 0, 0, 0, ww + .07 * K2, .012, head / 6 * 1.05 + (k === 5 ? .05 * K2 : 0), INK, m.glowPool);
        m.part(x, y, z, face, 0, 0, 0, ww, .012, head / 6 * 1.05, col, m.glowPool);
      }
    }
  }
  private readonly hiC = new Map<number, THREE.Color>();
  private hiCol(f: number) { let c = this.hiC.get(f); if (!c) { c = facCol[f].clone().lerp(new THREE.Color(1, 1, 1), .45); this.hiC.set(f, c); } return c; }
  private readonly dimC = new Map<number, THREE.Color>();
  private dimCol(f: number) { let c = this.dimC.get(f); if (!c) { c = facCol[f].clone().multiplyScalar(.75); this.dimC.set(f, c); } return c; }
  /** The local player (set by the renderer each frame; -1 when spectating). */
  me = -1;
  /** Size factor for route marks so they stay readable when zoomed out (set from the camera distance). */
  zoomK = 1;
  private lastT = 0;
  private dtA = 0;

  /**
   * A marching column, front to back: tanks in pairs, a block of riflemen three abreast, machine-gun teams, then towed guns.
   * Figures are roughly one per unit (capped), so a big army reads as a long column.
   */
  private column(a: GameState['armies'][number], x: number, z: number, face: number, T: number) {
    // on the march the figures grow with the zoom like garrisons do, and the column thins out so it keeps its length on screen
    const zk = this.unitK, far = zk > 1.35, m = this.m, S = MAP_S * zk, u = a.units, c = Math.cos(face), s = Math.sin(face), f = a.owner;
    const y0 = lerp(this.terrain.anchorH(a.from), this.terrain.anchorH(a.to), a.t);
    const nT = Math.min(far ? 2 : 8, u.tank), nI = Math.min(far ? 9 : 45, far ? u.inf * 2 : u.inf), nM = Math.min(far ? 2 : 6, u.mg), nA = Math.min(far ? 2 : 5, u.art);
    const sk = spread(zk), TS = .15 * sk, IS = .07 * sk, MS = .085 * sk, AS = .14 * sk;
    const len = Math.ceil(nT / 2) * TS + Math.ceil(nI / 3) * IS + Math.ceil(nM / 2) * MS + nA * AS;
    // dust kicked up on the march (not for troops waiting at the start line or going by sea): vehicles leave a thin trail
    // behind them, boots only the odd faint puff. Per second, so it doesn't depend on the frame rate.
    const veh = nT + nA * .5, rate = (veh > 0 ? Math.min(3, .8 + veh * .35) : nI > 0 ? .5 : 0) * (far ? 2.2 : 1);
    if (!a.sea && !a.wait && a.t > 0 && a.t < 1 && Math.random() < rate * this.dtA) {
      const r = Math.random(), bx = x - s * len * (.5 + r * .3), bz = z - c * len * (.5 + r * .3), big = veh > 0;
      this.fx.spawn(bx + (Math.random() - .5) * .05, y0 + .02, bz + (Math.random() - .5) * .05, (Math.random() - .5) * .02, .015, (Math.random() - .5) * .02, 0, (big ? 1.1 : .8) * (far ? 1.6 : 1), .03 * zk, (big ? .08 : .05) * zk, K.dust, F_DUST);
    }
    let fwd = len / 2;
    // one helper places a figure `fwd` along the march and `side` to the right, standing on the ground
    const P = (side: number) => { const px = x + s * fwd + c * side, pz = z + c * fwd - s * side; return [px, this.hAt(px, pz, y0), pz] as const; };
    for (let k = 0; k < nT; k += 2) {
      for (let j = 0; j < Math.min(2, nT - k); j++) { const [px, py, pz] = P(nT - k === 1 ? 0 : (j ? .07 : -.07) * sk); m.unit('tank', px, py, pz, face, f, S * .9, 0, 0); }
      if (Math.random() < .02) { const [px, py, pz] = P(0); this.fx.spawn(px - s * .08, py + .05, pz - c * .08, 0, .08, 0, 0, 1.6, .02, .07, K.smoke2, F_MAP); }
      fwd -= TS;
    }
    for (let k = 0; k < nI; k++) {
      const col = k % 3, side = ((col - 1) * .04 + Math.sin(k * 7.1) * .005) * sk;
      const [px, py, pz] = P(side); m.soldier(px, py, pz, face, f, S, false, T * 9 + k * 1.3);
      if (col === 2 || k === nI - 1) fwd -= IS;
    }
    for (let k = 0; k < nM; k++) { const [px, py, pz] = P((k % 2 ? .045 : -.045) * sk); m.unit('mg', px, py, pz, face, f, S * .9, T * 9 + k, 0); if (k % 2 || k === nM - 1) fwd -= MS; }
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
