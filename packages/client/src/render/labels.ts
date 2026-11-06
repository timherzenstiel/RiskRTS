// DOM map labels (region markers, city names, army counts, battle buttons). The React stylesheet styles these class names.
import * as THREE from 'three';
import { FACTIONS, FORMATION, UNIT_TYPES, GROUND_TYPES, SHIP, armyPos, battleCounts, fleetPos, groundUnits, groupName, mainOf, seaControl, sectorPoint, totalUnits, type Army, type Battle, type Corps, type Fleet, type GameState, type SeaBattle, type Units, type World } from '@riskrts/shared';
import type { CameraRig } from './camera';
import type { CityInfo } from './terrain';
import { lerp } from './util';
import { battleAnchor } from '@riskrts/shared';
import { getLang, langVersion, t, tx } from '../i18n';

/** Formations of the main army as the viewer knows them: exact, "~n" across the border (the whole region), "n?" from an old report, "?" unknown. */
function garrisonLabel(r: GameState['regions'][number], merged = false) {
  const v = r.vis ?? 3, n = r.fr && !merged ? totalUnits(mainOf(r)) : totalUnits(r.units);
  if (v >= 3) return String(n);
  if (r.est) return r.est[1] > 0 ? `~${Math.max(1, Math.round((r.est[0] + r.est[1]) / 200))}` : '~0';
  if (v === 2) return `${n}?`;
  return '?';
}

interface RegionLabel { el: HTMLDivElement; n: HTMLSpanElement; nm: HTMLSpanElement; bd: HTMLSpanElement; pp: HTMLSpanElement; pips: string; badges: string; count: string; color: string; sel: boolean; tg: boolean; sm: boolean; names: boolean; shown: boolean; tf: string; st?: boolean }
interface CorpsLabel { el: HTMLDivElement; n: HTMLSpanElement; nm: HTMLSpanElement; key: string; shown: boolean; tf: string; seen: number }

/** Map symbols of the unit types (staff-map style): a crossed box for infantry, a ringed dot for MGs, a dot for guns, an oval for tanks. */
const SYM: Record<string, string> = {
  inf: '<svg viewBox="0 0 16 12" aria-hidden="true"><rect x="1" y="1" width="14" height="10" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M1 1l14 10M15 1L1 11" stroke="currentColor" stroke-width="1.4"/></svg>',
  mg: '<svg viewBox="0 0 16 12" aria-hidden="true"><rect x="1" y="1" width="14" height="10" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="6" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="6" r=".9" fill="currentColor"/></svg>',
  art: '<svg viewBox="0 0 16 12" aria-hidden="true"><rect x="1" y="1" width="14" height="10" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="6" r="2.2" fill="currentColor"/></svg>',
  tank: '<svg viewBox="0 0 16 12" aria-hidden="true"><rect x="1" y="1" width="14" height="10" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="3.5" y="3.5" width="9" height="5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
};
/** The symbol of the type a group has most of (infantry when it is empty). */
function symOf(u: Units) { let best: string = 'inf', n = 0; for (const k of GROUND_TYPES) if (u[k] > n) { n = u[k]; best = k; } return SYM[best]; }
/** Building badges on the region label: capital, factory, barracks, airfield. */
const BADGE_EN: Record<string, string> = {
  cap: '<i class="b cap" title="Capital"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 .8l1.5 3.3 3.6.4-2.7 2.4.8 3.6L6 8.7 2.8 10.5l.8-3.6L.9 4.5l3.6-.4z" fill="currentColor"/></svg></i>',
  fac: '<i class="b fac" title="Factory"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 11V5l3 2V5l3 2V2h2v9z" fill="currentColor"/></svg></i>',
  bar: '<i class="b bar" title="Barracks"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6l5-4 5 4v5H1z M4 11V8h4v3" fill="currentColor"/></svg></i>',
  port: '<i class="b port" title="Port"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.2a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zM5.4 3.8h1.2v5.6c1.4-.2 2.5-1 3-2.2l-1-.4 2-1.4.4 2.4-.9-.4C9.4 9.4 7.9 10.8 6 10.8S2.6 9.4 1.9 7.4l-.9.4.4-2.4 2 1.4-1 .4c.5 1.2 1.6 2 3 2.2z" fill="currentColor"/></svg></i>',
  air: '<i class="b air" title="Airfield"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1v4L1 7v1.3l5-1.3v2.5L4.5 10.5V11.5L6 11l1.5.5v-1L6 9.5V7l5 1.3V7L6 5z" fill="currentColor"/></svg></i>',
};
let badgeLv = -1, BADGE = BADGE_EN;
/** The badges with their tooltips in the current language. */
function badgeSet() {
  if (badgeLv !== langVersion()) {
    badgeLv = langVersion();
    BADGE = Object.fromEntries(Object.entries(BADGE_EN).map(([k, h]) => [k, h.replace(/title="([^"]*)"/, (_, x: string) => `title="${t(x)}"`)]));
  }
  return BADGE;
}
interface CityLabel { el: HTMLDivElement; shown: boolean; tf: string }
interface ZoneLabel { el: HTMLDivElement; shown: boolean; tf: string; c: string }
interface FleetLabel { el: HTMLDivElement; n: HTMLSpanElement; text: string; shown: boolean; tf: string; seen: number }
/** A ship symbol for fleet markers. */
const SHIP_SYM = '<svg viewBox="0 0 16 10" aria-hidden="true"><path d="M1 6h14l-2 3H3z M5 3h6v3H5z M7 1h1.6v2H7z" fill="currentColor"/></svg>';
interface ArmyLabel { el: HTMLDivElement; n: HTMLSpanElement; count: string; shown: boolean; tf: string; seen: number }
interface BattleLabel { el: HTMLButtonElement; text: HTMLSpanElement; label: string; shown: boolean; tf: string; seen: number; nextText: number; aria: () => string }

export interface LabelContext {
  g: GameState | null; cam: CameraRig; w: number; h: number; sel: number; hover: number;
  /** Faction of the viewer (-1 spectator). */
  me: number;
  isTarget(id: number): boolean; anchorH(id: number): number; groundY(id: number): number; armyH(a: Army): [number, number]; frame: number; now: number;
}

const v3 = new THREE.Vector3(), P = { x: 0, y: 0, z: 0 };

export class Labels {
  private readonly regions: RegionLabel[];
  private readonly cityLabels: CityLabel[];
  private readonly armies = new Map<number, ArmyLabel>();
  private readonly battles = new Map<number, BattleLabel>();
  private readonly corps = new Map<string, CorpsLabel>();
  private readonly zones: ZoneLabel[];
  private readonly fleets = new Map<number, FleetLabel>();
  private readonly seas = new Map<number, BattleLabel>();
  private layer = 0;
  private lv = langVersion();
  private readonly brackets: HTMLDivElement[] = [];
  private band = -1;
  /** Zoom band (camera.ts): the theatre band merges each region's corps into one marker and drops city names. */
  setBand(b: number) { if (b === this.band) return; this.band = b; for (let k = 0; k < 4; k++) this.root.classList.toggle('band' + k, k === b); }
  /** Map layer: 0 everything, 1 troops, 2 industry (set as a class on the label layer; the stylesheet does the rest). */
  setLayer(l: number) { if (l === this.layer) return; this.layer = l; this.root.classList.toggle('ly1', l === 1); this.root.classList.toggle('ly2', l === 2); }

  constructor(private readonly root: HTMLElement, private readonly world: World, private readonly cities: CityInfo[], private readonly cityH: (c: CityInfo) => number,
    private readonly onBattleClick: (regionId: number, battleId: number) => void,
    private readonly onCorpsClick: (regionId: number, post: number) => void = () => {},
    private readonly onFleetClick: (fleet: number) => void = () => {}, private readonly onSeaClick: (id: number) => void = () => {}) {
    this.zones = world.zones.map(z => { const el = document.createElement('div'); el.className = 'zl'; el.textContent = tx(z.short).toUpperCase(); root.appendChild(el); return { el, shown: true, tf: '', c: '' }; });
    this.regions = world.regions.map((r) => {
      const el = document.createElement('div'); el.className = 'tl'; el.innerHTML = '<span class="n"></span><span class="pp"></span><span class="bd"></span><span class="nm"></span>';
      const n = el.children[0] as HTMLSpanElement, pp = el.children[1] as HTMLSpanElement, bd = el.children[2] as HTMLSpanElement, nm = el.children[3] as HTMLSpanElement; nm.textContent = tx(r.name); root.appendChild(el);
      return { el, n, nm, bd, pp, pips: '', badges: '', count: '', color: '', sel: false, tg: false, sm: false, names: true, shown: true, tf: '' };
    });
    this.cityLabels = cities.map((c) => {
      const el = document.createElement('div'); el.className = 'cl c' + c.size; el.textContent = tx(c.name); root.appendChild(el);
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

  /** The language changed: rewrite the fixed names and make every cached text build anew. */
  private relabel() {
    this.zones.forEach((l, z) => { l.el.textContent = tx(this.world.zones[z].short).toUpperCase(); });
    this.regions.forEach((l, i) => { l.nm.textContent = tx(this.world.regions[i].name); l.badges = ''; l.count = ''; });
    this.cityLabels.forEach((l, i) => { l.el.textContent = tx(this.cities[i].name); });
    for (const l of this.armies.values()) l.count = '';
    for (const l of this.fleets.values()) l.text = '';
    for (const l of this.corps.values()) { l.key = ''; l.el.title = t('Open the deployment of this region'); }
    for (const l of [...this.battles.values(), ...this.seas.values()]) { l.label = ''; l.nextText = 0; l.el.setAttribute('aria-label', l.aria()); }
  }

  update(ctx: LabelContext) {
    if (this.lv !== langVersion()) { this.lv = langVersion(); this.relabel(); }
    const { g, cam } = ctx, dist = cam.dist, showNames = dist < 40, sm = dist > 95;
    this.regions.forEach((l, i) => {
      const def = this.world.regions[i], rs = g?.regions[i];
      if (!rs || rs.battle >= 0) { this.hide(l); return; }
      const color = FACTIONS[rs.owner]?.color ?? '#888';
      if (color !== l.color) { l.color = color; l.el.style.setProperty('--c', color); }
      const s = garrisonLabel(rs, this.band === 0); if (s !== l.count) { l.count = s; l.n.textContent = s; }
      const names = showNames || i === ctx.sel || i === ctx.hover; if (names !== l.names) { l.names = names; l.nm.style.display = names ? '' : 'none'; }
      const isSel = i === ctx.sel, tg = ctx.isTarget(i);
      if (isSel !== l.sel) { l.sel = isSel; l.el.classList.toggle('sel', isSel); }
      if (tg !== l.tg) { l.tg = tg; l.el.classList.toggle('tg', tg); }
      if (sm !== l.sm) { l.sm = sm; l.el.classList.toggle('sm', sm); }
      const st = !!rs.strike; if (st !== !!l.st) { l.st = st; l.el.classList.toggle('st', st); }
      const known = (rs.vis ?? 3) >= 2;
      const BADGE = badgeSet();
      const badges = (rs.capitalOf >= 0 ? BADGE.cap : '') + (known && rs.factory ? BADGE.fac : '') + (known && rs.barracks ? BADGE.bar : '') + (known && rs.airfield ? BADGE.air : '') + (rs.port ? BADGE.port : '');
      if (badges !== l.badges) { l.badges = badges; l.bd.innerHTML = badges; }
      // strength and morale pips on your own garrisons when zoomed in (design 3.4): green -> amber -> red
      let pips = '';
      if (rs.owner === ctx.me && dist < 60) {
        let men = 0, full = 0; for (const k of UNIT_TYPES) { men += rs.men[k] ?? 0; full += rs.units[k] * FORMATION[k].men; }
        const st = full ? Math.min(1, men / full) : 0, mo = Math.min(1, (rs.mor ?? 0) / 100);
        if (full) pips = `<i class="ps" style="--v:${st.toFixed(2)};--h:${Math.round(st * 110)}"></i><i class="pm" style="--v:${mo.toFixed(2)};--h:${Math.round(mo * 110)}"></i>`;
      }
      if (pips !== l.pips) { l.pips = pips; l.pp.innerHTML = pips; }
      this.place(l, ctx, def.cx, ctx.anchorH(i) + 1.05, def.cz);
    });
    this.cities.forEach((c, i) => {
      const l = this.cityLabels[i], lim = c.size === 3 ? 30 : c.size === 2 ? 20 : 11;
      if (dist > lim || Math.hypot(c.x - cam.tx, c.z - cam.tz) > dist * 1.4) { this.hide(l); return; }
      this.place(l, ctx, c.x, this.cityH(c) + .36, c.z);
    });
    // sea zones: names on the water in the colour of the power that holds them
    if (g) {
      const ctrl = seaControl(g).ctrl;
      this.zones.forEach((l, z) => {
        if (dist < 22 || dist > 160) { this.hide(l); return; }
        const Z = this.world.zones[z], c = ctrl[z] >= 0 ? FACTIONS[ctrl[z]].color : '';
        if (c !== l.c) { l.c = c; l.el.style.setProperty('--c', c || 'rgba(220,230,235,.55)'); l.el.classList.toggle('held', !!c); }
        this.place(l, ctx, Z.x, .2, Z.z);
      });
    }
    if (!g) return;

    // fleets at sea: a ship marker with its ships, and for own fleets where they are bound and when they arrive
    if (dist < 140) for (const fl of g.fleets) {
      if (fl.sea !== undefined || !fl.path.length) continue;
      let l = this.fleets.get(fl.id);
      if (!l) {
        const el = document.createElement('div'); el.className = 'tl fm'; el.style.setProperty('--c', FACTIONS[fl.owner]?.color ?? '#888'); el.innerHTML = '<span class="n"></span>';
        const id = fl.id; el.style.pointerEvents = 'auto'; el.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.onFleetClick(id); });
        this.root.appendChild(el); l = { el, n: el.firstChild as HTMLSpanElement, text: '', shown: true, tf: '', seen: 0 }; this.fleets.set(fl.id, l);
      }
      l.seen = ctx.frame;
      const ft = fleetText(g, fl, fl.owner === ctx.me);
      if (ft !== l.text) { l.text = ft; l.n.innerHTML = SHIP_SYM + ft; l.el.classList.toggle('off', fl.state === 'offshore'); l.el.classList.toggle('stn', fl.state === 'stationed'); }
      const p = fleetPos(fl); this.place(l, ctx, p.x, .7, p.z);
    }
    for (const [id, l] of this.fleets) if (l.seen !== ctx.frame) { l.el.remove(); this.fleets.delete(id); }
    // naval battles: a button like the land battles'
    for (const b of g.seaBattles ?? []) {
      if (b.ended) continue;
      let l = this.seas.get(b.id);
      if (!l) l = this.makeSea(b);
      l.seen = ctx.frame;
      if (dist < 12) { this.hide(l); continue; }
      if (ctx.now >= l.nextText) {
        l.nextText = ctx.now + .25;
        const n = [0, 1].map(s => b.agents.filter(a => !a.dead && !a.out && a.kind !== 'pl' && b.sides[s].includes(a.f)).length);
        const s = `${tx(this.world.zones[b.zone].short)} · ${n[0]} ${getLang() === 'de' ? 'gg.' : 'v'} ${n[1]}`; if (s !== l.label) { l.label = s; l.text.textContent = s; }
      }
      this.place(l, ctx, b.x, 1.1, b.z);
    }
    for (const [id, l] of this.seas) if (l.seen !== ctx.frame) { l.el.remove(); this.seas.delete(id); }

    // armies on the march
    for (const a of g.armies) {
      let l = this.armies.get(a.id);
      if (!l) {
        const el = document.createElement('div'); el.className = 'tl ar'; el.style.setProperty('--c', FACTIONS[a.owner]?.color ?? '#888'); el.innerHTML = '<span class="n"></span>';
        this.root.appendChild(el); l = { el, n: el.firstChild as HTMLSpanElement, count: '', shown: true, tf: '', seen: 0 }; this.armies.set(a.id, l);
      }
      l.seen = ctx.frame;
      // a column forming up for an offensive shows how long it still needs
      const s = a.scout ? (a.scout === 'patrol' ? t('Pat') : t('Rec')) : a.decoy ? t('Feint') : a.wait ? `${totalUnits(a.units)} · ${Math.ceil(a.wait)}s` : a.owner === ctx.me ? `${totalUnits(a.units)} → ${Math.max(1, Math.ceil((1 - a.t) * a.dur))}s` : String(totalUnits(a.units)); if (s !== l.count) { l.count = s; l.n.textContent = s; l.el.classList.toggle('form', !!a.wait); l.el.classList.toggle('atk', (a.ord ?? 0) >= 1); }
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
        const stage = b.goal === undefined ? '' : ' · ' + t(['1st line', 'consolidating', 'depth', 'foothold'][b.stage ?? 0]);
        // who attacks whom: "Germany → Verdun"; your own fights stand out (red when you defend, gold when you attack)
        const who = b.attacker === ctx.me ? t('You') : FACTIONS[b.attacker] ? t('{0}', FACTIONS[b.attacker].short) : '?';
        const s = `${who} → ${tx(rname)} · ${alive}${stage}`; if (s !== l.label) { l.label = s; l.text.textContent = s; }
        const cls = 'bm' + (b.def === ctx.me ? ' def' : b.sides.includes(ctx.me) ? ' atk' : ' oth');
        if (l.el.className !== cls) { l.el.className = cls; l.el.style.setProperty('--c', FACTIONS[b.attacker]?.color ?? '#888'); }
      }
      const at = battleAnchor(this.world, b);
      this.place(l, ctx, at.x, ctx.groundY(b.region) + 1.2, at.z);
    }
    for (const [id, l] of this.battles) if (l.seen !== ctx.frame) { l.el.remove(); this.battles.delete(id); }

    // corps on the borders: a marker at each one's post
    if (dist < 120) for (const r of g.regions) {
      if (!r.fr) continue;
      for (const [ks, c] of Object.entries(r.fr)) {
        const post = +ks, key = r.id + '|' + post;
        let l = this.corps.get(key);
        if (!l) {
          const el = document.createElement('div'); el.className = 'tl cp'; el.innerHTML = '<span class="n"></span><span class="nm"></span>';
          const rid = r.id; el.style.pointerEvents = 'auto'; el.title = t('Open the deployment of this region');
          el.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.onCorpsClick(rid, post); });
          this.root.appendChild(el); l = { el, n: el.children[0] as HTMLSpanElement, nm: el.children[1] as HTMLSpanElement, key: '', shown: true, tf: '', seen: 0 }; this.corps.set(key, l);
        }
        l.seen = ctx.frame;
        this.corpsText(l, g, r.owner, c, dist < 32 || r.id === ctx.sel);
        const p = sectorPoint(this.world, r.id, post);
        this.place(l, ctx, p.x, ctx.anchorH(r.id) + .55, p.z);
      }
    }
    for (const [k, l] of this.corps) if (l.seen !== ctx.frame) { l.el.remove(); this.corps.delete(k); }

    // selection brackets around the selected region's main army and corps, battle and close bands (design 3.4)
    let nb = 0;
    if (ctx.sel >= 0 && dist < 30) {
      const R = this.world.regions[ctx.sel], rs = g.regions[ctx.sel], ppu = ctx.h / (dist * .688);
      const spots: [number, number, number][] = [[R.cx, R.cz, .55]];
      if (rs.fr) for (const ks of Object.keys(rs.fr)) { const p = sectorPoint(this.world, ctx.sel, +ks); spots.push([p.x, p.z, .4]); }
      for (const [x, z, r] of spots) {
        let el = this.brackets[nb]; if (!el) { el = document.createElement('div'); el.className = 'brk'; this.root.appendChild(el); this.brackets.push(el); }
        ctx.cam.project(x, ctx.anchorH(ctx.sel) + .02, z, ctx.w, ctx.h, P, v3);
        const px = Math.max(26, Math.min(220, r * 2 * ppu));
        el.style.display = ''; el.style.width = el.style.height = px + 'px'; el.style.transform = `translate(${(P.x - px / 2).toFixed(1)}px,${(P.y - px * .6).toFixed(1)}px)`;
        nb++;
      }
    }
    for (let k = nb; k < this.brackets.length; k++) this.brackets[k].style.display = 'none';
  }

  /** Text and state classes of a corps marker: symbol, battalions (or the estimate), name up close, holding / assembling / attacking. */
  private corpsText(l: CorpsLabel, g: GameState, f: number, c: Corps, named: boolean) {
    const n = groundUnits(c.u), est = c.est ? `~${Math.max(1, Math.round((c.est[0] + c.est[1]) / 200))}` : String(n);
    const ord = c.ord ?? 0, left = ord >= 1 ? Math.max(0, (c.ready ?? 0) - g.time) : 0;
    const dug = ord === 0 && c.since !== undefined && g.time - c.since >= 40;
    const state = ord >= 1 ? (left > 0 && !c.now ? 'asm' : 'atk') : dug ? 'dug' : 'hold';
    const name = named && c.n > 0 ? groupName(f, 1, c.n, true) : '';
    const key = f + state + est + name + (left > 0 ? Math.ceil(left) : '') + symOf(c.u).length + (c.u.art ? 'a' : '') + (c.u.tank ? 't' : '') + (c.u.mg ? 'm' : '');
    if (key === l.key) return;
    l.key = key;
    l.el.style.setProperty('--c', FACTIONS[f]?.color ?? '#888');
    l.el.className = 'tl cp ' + state;
    l.n.innerHTML = symOf(c.u) + '<b>' + est + '</b>' + (state === 'asm' ? `<em>${Math.ceil(left)}s</em>` : '');
    l.nm.textContent = name; l.nm.style.display = name ? '' : 'none';
  }

  private makeSea(b: SeaBattle): BattleLabel {
    const aria = () => t('Watch the naval battle in the {0}', this.world.zones[b.zone].name);
    const el = document.createElement('button'); el.className = 'bm sea'; el.type = 'button'; el.style.pointerEvents = 'auto'; el.setAttribute('aria-label', aria());
    el.innerHTML = SHIP_SYM + '<span></span>';
    el.addEventListener('click', () => this.onSeaClick(b.id));
    this.root.appendChild(el);
    const l: BattleLabel = { el, text: el.lastChild as HTMLSpanElement, label: '', shown: true, tf: '', seen: 0, nextText: 0, aria };
    this.seas.set(b.id, l); return l;
  }

  private makeBattle(b: Battle, rname: string): BattleLabel {
    const aria = () => t('Watch the battle of {0}', rname);
    const el = document.createElement('button'); el.className = 'bm'; el.type = 'button'; el.style.pointerEvents = 'auto'; el.setAttribute('aria-label', aria());
    el.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" shape-rendering="crispEdges"><path d="M1 1h2v1h1v1h1v1h1v1h1v1h-1v1h-1v-1h-1v-1h-1v-1h-1v-1h-1zM13 1h-2v1h-1v1h-1v1h-1v1h-1v1h1v1h1v-1h1v-1h1v-1h1v-1h1zM2 10h2v2h-2zM10 10h2v2h-2zM4 9h1v1h-1zM9 9h1v1h-1z" fill="currentColor"/></svg><span></span>';
    el.addEventListener('click', () => this.onBattleClick(b.region, b.id));
    this.root.appendChild(el);
    const l: BattleLabel = { el, text: el.lastChild as HTMLSpanElement, label: '', shown: true, tf: '', seen: 0, nextText: 0, aria };
    this.battles.set(b.id, l); return l;
  }

  dispose() {
    for (const l of this.regions) l.el.remove();
    for (const l of this.cityLabels) l.el.remove();
    for (const l of this.armies.values()) l.el.remove();
    for (const l of this.battles.values()) l.el.remove();
    for (const l of this.corps.values()) l.el.remove();
    for (const l of this.zones) l.el.remove();
    for (const l of this.fleets.values()) l.el.remove();
    for (const l of this.seas.values()) l.el.remove();
    this.armies.clear(); this.battles.clear(); this.corps.clear(); this.fleets.clear(); this.seas.clear();
  }
}

/** "2 BB" for warships, "3 TRN · 6 btl → 24s" for an own convoy, "~10 btl" offshore. */
function fleetText(g: GameState, fl: Fleet, own: boolean) {
  const ships = fl.ships.map(id => g.ships.find(s => s.id === id)).filter(Boolean) as { kind: keyof typeof SHIP }[];
  const n = (k: keyof typeof SHIP) => ships.filter(s => s.kind === k).length;
  const parts = (['bb', 'carrier', 'land', 'trans'] as const).map(k => n(k) ? `${n(k)} ${tx(SHIP[k].short)}` : '').filter(Boolean);
  const cargo = groundUnits(fl.cargo);
  let s = parts.join(' ') + (cargo ? ` · ${own ? '' : '~'}${cargo} ${t('btl')}` : '');
  if (own) {
    const left = fl.state === 'sail' ? (fl.len - fl.d) / Math.max(.01, fl.v) : fl.state === 'stationed' ? 0 : fl.t;
    if (left > 1) s += ` · ${Math.ceil(left)}s`;
  }
  if (fl.state === 'offshore') s += ' · ' + (fl.storm ? t('storm') : t('offshore'));
  return s;
}
