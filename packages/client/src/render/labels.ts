// DOM map labels (region markers, city names, army counts, battle buttons). The React stylesheet styles these class names.
import * as THREE from 'three';
import { FACTIONS, armyPos, battleCounts, totalUnits, type Army, type Battle, type GameState, type World } from '@riskrts/shared';
import type { CameraRig } from './camera';
import type { CityInfo } from './terrain';
import { lerp } from './util';
import { battleAnchor } from './sectors';

/** Formations in a region as the viewer knows them: exact, "~n" across the border, "n?" from an old report, "?" unknown. */
function garrisonLabel(r: GameState['regions'][number]) {
  const v = r.vis ?? 3, n = totalUnits(r.units);
  if (v >= 3) return String(n);
  if (r.est) return r.est[1] > 0 ? `~${Math.max(1, Math.round((r.est[0] + r.est[1]) / 200))}` : '~0';
  if (v === 2) return `${n}?`;
  return '?';
}

interface RegionLabel { el: HTMLDivElement; n: HTMLSpanElement; nm: HTMLSpanElement; count: string; color: string; sel: boolean; tg: boolean; sm: boolean; names: boolean; shown: boolean; tf: string; st?: boolean }
interface CityLabel { el: HTMLDivElement; shown: boolean; tf: string }
interface ArmyLabel { el: HTMLDivElement; n: HTMLSpanElement; count: string; shown: boolean; tf: string; seen: number }
interface BattleLabel { el: HTMLButtonElement; text: HTMLSpanElement; label: string; shown: boolean; tf: string; seen: number; nextText: number }

export interface LabelContext {
  g: GameState | null; cam: CameraRig; w: number; h: number; sel: number; hover: number;
  isTarget(id: number): boolean; anchorH(id: number): number; groundY(id: number): number; armyH(a: Army): [number, number]; frame: number; now: number;
}

const v3 = new THREE.Vector3(), P = { x: 0, y: 0, z: 0 };

export class Labels {
  private readonly regions: RegionLabel[];
  private readonly cityLabels: CityLabel[];
  private readonly armies = new Map<number, ArmyLabel>();
  private readonly battles = new Map<number, BattleLabel>();

  constructor(private readonly root: HTMLElement, private readonly world: World, private readonly cities: CityInfo[], private readonly cityH: (c: CityInfo) => number,
    private readonly onBattleClick: (regionId: number, battleId: number) => void) {
    this.regions = world.regions.map((r) => {
      const el = document.createElement('div'); el.className = 'tl'; el.innerHTML = '<span class="n"></span><span class="nm"></span>';
      const n = el.firstChild as HTMLSpanElement, nm = el.lastChild as HTMLSpanElement; nm.textContent = r.name; root.appendChild(el);
      return { el, n, nm, count: '', color: '', sel: false, tg: false, sm: false, names: true, shown: true, tf: '' };
    });
    this.cityLabels = cities.map((c) => {
      const el = document.createElement('div'); el.className = 'cl c' + c.size; el.textContent = c.name; root.appendChild(el);
      return { el, shown: true, tf: '' };
    });
  }

  private place(l: { el: HTMLElement; shown: boolean; tf: string }, ctx: LabelContext, x: number, y: number, z: number) {
    ctx.cam.project(x, y, z, ctx.w, ctx.h, P, v3);
    if (P.z > 1 || P.x < -80 || P.x > ctx.w + 80 || P.y < -40 || P.y > ctx.h + 40) { this.hide(l); return; }
    if (!l.shown) { l.el.style.display = ''; l.shown = true; }
    const tf = `translate(${P.x | 0}px,${P.y | 0}px) translate(-50%,-100%)`;
    if (tf !== l.tf) { l.tf = tf; l.el.style.transform = tf; }
  }
  private hide(l: { el: HTMLElement; shown: boolean }) { if (l.shown) { l.el.style.display = 'none'; l.shown = false; } }

  update(ctx: LabelContext) {
    const { g, cam } = ctx, dist = cam.dist, showNames = dist < 40, sm = dist > 95;
    this.regions.forEach((l, i) => {
      const def = this.world.regions[i], rs = g?.regions[i];
      if (!rs || rs.battle >= 0) { this.hide(l); return; }
      const color = FACTIONS[rs.owner]?.color ?? '#888';
      if (color !== l.color) { l.color = color; l.el.style.setProperty('--c', color); }
      const s = garrisonLabel(rs); if (s !== l.count) { l.count = s; l.n.textContent = s; }
      const names = showNames || i === ctx.sel || i === ctx.hover; if (names !== l.names) { l.names = names; l.nm.style.display = names ? '' : 'none'; }
      const isSel = i === ctx.sel, tg = ctx.isTarget(i);
      if (isSel !== l.sel) { l.sel = isSel; l.el.classList.toggle('sel', isSel); }
      if (tg !== l.tg) { l.tg = tg; l.el.classList.toggle('tg', tg); }
      if (sm !== l.sm) { l.sm = sm; l.el.classList.toggle('sm', sm); }
      const st = !!rs.strike; if (st !== !!l.st) { l.st = st; l.el.classList.toggle('st', st); }
      this.place(l, ctx, def.cx, ctx.anchorH(i) + 1.05, def.cz);
    });
    this.cities.forEach((c, i) => {
      const l = this.cityLabels[i], lim = c.size === 3 ? 30 : c.size === 2 ? 20 : 11;
      if (dist > lim || Math.hypot(c.x - cam.tx, c.z - cam.tz) > dist * 1.4) { this.hide(l); return; }
      this.place(l, ctx, c.x, this.cityH(c) + .36, c.z);
    });
    if (!g) return;

    // armies on the march
    for (const a of g.armies) {
      let l = this.armies.get(a.id);
      if (!l) {
        const el = document.createElement('div'); el.className = 'tl ar'; el.style.setProperty('--c', FACTIONS[a.owner]?.color ?? '#888'); el.innerHTML = '<span class="n"></span>';
        this.root.appendChild(el); l = { el, n: el.firstChild as HTMLSpanElement, count: '', shown: true, tf: '', seen: 0 }; this.armies.set(a.id, l);
      }
      l.seen = ctx.frame;
      const s = a.scout ? (a.scout === 'patrol' ? 'Pat' : 'Rec') : a.decoy ? 'Feint' : String(totalUnits(a.units)); if (s !== l.count) { l.count = s; l.n.textContent = s; }
      const [x, z] = armyPos(a), [y0, y1] = ctx.armyH(a);
      this.place(l, ctx, x, lerp(y0, y1, a.t) + Math.sin(a.t * Math.PI) * .4 + .85, z);
    }
    for (const [id, l] of this.armies) if (l.seen !== ctx.frame) { l.el.remove(); this.armies.delete(id); }

    // battle buttons
    for (const b of g.battles) {
      if (b.ended) continue;
      let l = this.battles.get(b.id);
      const rname = this.world.regions[b.region].name;
      if (!l) l = this.makeBattle(b, rname);
      l.seen = ctx.frame;
      if (dist < 20) { this.hide(l); continue; }
      if (ctx.now >= l.nextText) {
        l.nextText = ctx.now + .25;
        let alive = 0; for (const [, c] of battleCounts(b)) alive += c[0];
        const t = `${rname} · ${alive}`; if (t !== l.label) { l.label = t; l.text.textContent = t; }
      }
      const at = battleAnchor(this.world, b);
      this.place(l, ctx, at.x, ctx.groundY(b.region) + 1.2, at.z);
    }
    for (const [id, l] of this.battles) if (l.seen !== ctx.frame) { l.el.remove(); this.battles.delete(id); }
  }

  private makeBattle(b: Battle, rname: string): BattleLabel {
    const el = document.createElement('button'); el.className = 'bm'; el.type = 'button'; el.style.pointerEvents = 'auto'; el.setAttribute('aria-label', `Watch the battle of ${rname}`);
    el.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" shape-rendering="crispEdges"><path d="M1 1h2v1h1v1h1v1h1v1h1v1h-1v1h-1v-1h-1v-1h-1v-1h-1v-1h-1zM13 1h-2v1h-1v1h-1v1h-1v1h-1v1h1v1h1v-1h1v-1h1v-1h1v-1h1zM2 10h2v2h-2zM10 10h2v2h-2zM4 9h1v1h-1zM9 9h1v1h-1z" fill="currentColor"/></svg><span></span>';
    el.addEventListener('click', () => this.onBattleClick(b.region, b.id));
    this.root.appendChild(el);
    const l: BattleLabel = { el, text: el.lastChild as HTMLSpanElement, label: '', shown: true, tf: '', seen: 0, nextText: 0 };
    this.battles.set(b.id, l); return l;
  }

  dispose() {
    for (const l of this.regions) l.el.remove();
    for (const l of this.cityLabels) l.el.remove();
    for (const l of this.armies.values()) l.el.remove();
    for (const l of this.battles.values()) l.el.remove();
    this.armies.clear(); this.battles.clear();
  }
}
