// One zoomed-in battle: per-agent display smoothing and drawing. Troops stand on the real terrain; there is no painted battlefield.
import { isDef, type Agent, type Battle, type UnitType } from '@riskrts/shared';
import type { Models } from './models';
import { F_FLAME, F_HOT, type FxSystem } from './fxSystem';
import { K, facCol } from './palette';
import { clamp } from './util';

/** World units per battle-local unit; the battlefield is BF_W x BF_H local units. */
export const BS = .11, BF_W = 48, BF_H = 34;
/** Model scale of troops on the battlefield: a soldier is a fraction of a tent, a tank about a wagon. */
export const US = .42;
/** Height aircraft fly at over a battlefield (world units). */
export const AIR_Y = .34;

interface Disp { x: number; z: number; deadAt: number }

export class BattleView {
  readonly cx: number; readonly cz: number; readonly y: number;
  private readonly disp: Disp[] = [];
  /** Whether the battle is close enough to draw its troops. */
  visible = false;
  /** Distant-view smoke timer. */
  puffT = 0; flareT = 3;

  /** `h` gives the ground height at a world position; `y` is the height at the battle centre. */
  constructor(readonly battle: Battle, cx: number, cz: number, private readonly h: (x: number, z: number) => number) {
    this.cx = cx; this.cz = cz; this.y = h(cx, cz);
  }

  /** Ground height at a world position. */
  groundAt(x: number, z: number) { return this.h(x, z); }

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

  /** Draw all agents (with smoothing applied) into the pools. */
  drawAgents(m: Models, fx: FxSystem, agents: Agent[], simTime: number, now: number) {
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i], d = this.disp[i]; if (!d || a.out) continue;
      const wx = this.cx + d.x * BS, wz = this.cz + d.z * BS, y = this.h(wx, wz), recoil = clamp(1 - (simTime - a.fireT) * 4, 0, 1);
      if (a.dead) {
        if (d.deadAt < 0 || now - d.deadAt > 40) continue;
        if (a.dieT > 0 && simTime - a.dieT > 40) continue;
        if (a.type === 'plane') { const t = Math.min(1, (now - d.deadAt) / 1.2); if (t < 1) m.plane(wx, y + AIR_Y * (1 - t), wz, a.face + t * 3, K.smoke2, .45); else m.part(wx, y, wz, a.face, 0, .01, 0, .1, .02, .05, K.smoke2); if (t < 1 && Math.random() < .5) fx.spawn(wx, y + AIR_Y * (1 - t), wz, 0, .05, 0, 0, 1.2, .02, .08, K.smoke2); continue; }
        if (isDef(a.type)) { m.part(wx, y, wz, a.face, 0, .015, 0, .12, .03, .1, K.concrete2); m.part(wx, y, wz, a.face + .7, .03, .03, .02, .05, .03, .04, K.concrete); if (Math.random() < .03) fx.spawn(wx, y + .05, wz, .01, .12, 0, 0, 2, .03, .1, K.smoke2); continue; }
        if (a.type === 'tank') {
          m.unit('tank', wx, y, wz, a.face, a.f, US, 0, 0);
          const burning = now - d.deadAt < 25;
          if (burning && Math.random() < .3) fx.spawn(wx + (Math.random() - .5) * .03, y + .04, wz + (Math.random() - .5) * .03, 0, .05, 0, 0, .45 + Math.random() * .3, .025, .045, K.fire, F_FLAME);
          if (Math.random() < (burning ? .12 : .04)) fx.spawn(wx, y + .08, wz, .02, .12, 0, 0, 2.4, .025, .1, burning ? K.flakpuff : K.smoke2, burning ? F_HOT : 0);
        }
        else m.corpse(wx, y, wz, a.face, a.f, US);
        continue;
      }
      switch (a.type) {
        case 'plane': m.plane(wx, y + AIR_Y + Math.sin(now * 2 + i) * .01, wz, a.face, facCol[a.f] ?? K.wing, .45, a.f); break;
        case 'pill': m.pillbox(wx, y, wz, a.face, a.f, .6); break;
        case 'bunk': m.bunker(wx, y, wz, a.face, a.f, .7); break;
        case 'fort': m.emplacement(wx, y, wz, a.face, a.f, .6, recoil); break;
        case 'flak': m.flak(wx, y, wz, a.face, a.f, .55, recoil); break;
        default: m.unit(a.type as UnitType, wx, y, wz, a.face, a.f, US, a.moving ? a.phase : 0, recoil);
      }
    }
  }

  /** The defended border's field works: the trench line, sandbags on it, and what is left of the wire in front. */
  drawWorks(m: Models, b: Battle) {
    if (!b.tr && !b.sand && !(b.wire > 0)) return;
    const ax = b.ax, az = b.az, px = -az, pz = ax, face = Math.atan2(ax, az), seg = 3;
    for (let lat = -13; lat < 13; lat += seg) {
      const t = 1.8 + ((Math.floor((lat + seg / 2 + 40) / 3)) % 2 ? .6 : -.6), c = lat + seg / 2;
      const at = (along: number) => { const x = this.cx + (ax * along + px * c) * BS, z = this.cz + (az * along + pz * c) * BS; return [x, this.h(x, z), z] as const; };
      if (b.tr) { const [x, y, z] = at(t); m.trenchLine(x, y, z, face, seg * BS, b.tr, .7); }
      if (b.sand) { const [x, y, z] = at(t + .5); m.sandbags(x, y, z, face, seg * BS, b.sand, .7); }
      if (b.wire > 0 && b.wire0 > 0) {
        const left = b.wire / b.wire0, belts = Math.ceil(b.wire0 / 30);
        for (let k = 0; k < belts; k++) if (((c * 7 + k * 13) % 10 + 10) % 10 / 10 < left) { const [x, y, z] = at(t + 3 + k * 1.6); m.wireBelt(x, y, z, face, seg * BS, left, .7); }
      }
    }
  }

  /** Show or hide the battle's troops as the camera moves. */
  setOpacity(o: number) { this.visible = o > .02; }

  dispose() { this.disp.length = 0; }
}
