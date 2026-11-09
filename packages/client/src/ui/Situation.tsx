// Seeing the situation (design-command §1, §5): the left rail of panels, the Situation panel (our wars, borders in danger,
// other wars), the border card opened from a balance chip, and the alerts queue.
import { OVER, capacity, load, worksAt, type RegionState, AIR_RANGE, COST, FACTIONS, TREATY_NAMES, activeSpies, borderBalance, borderLabel, buildWorld, corpsAtPost, groundUnits, groupName, hops, hostileBorders, income, marchEta, techOn, treatyOf, type Balance, type Battle, type GameState } from '@riskrts/shared';
import { useSim, useUi, type Overlay, type Panel } from '../game/store';
import { click } from './actions';
import { Sfx } from '../audio/sfx';
import { CloseIcon, HandshakeIcon, Icon, SwordsIcon } from './icons';
import { menOf, menStr, nm } from './format';
import { t, tx } from '../i18n';
import { rich, tn } from './LangPicker';
import { rendererRef } from './refs';
import { inboxOf } from './Inbox';
import { FortGrid } from './DrawerTabs';
import { cutReason } from './Logistics';
import { FrontsList } from './Generals';
import { WarStory } from './Story';
import { unlocked } from './Tutorial';

const roman = (n: number) => ['', 'I', 'II', 'III'][n] ?? '';
const rng = (a: [number, number]) => a[0] === a[1] ? String(a[0]) : `~${a[0]}–${a[1]}`;
const DANGER = ['Safe', 'Even', 'Weaker', 'In danger'] as const;
const dangerOf = (b: Balance): string => b.danger < 0 ? 'Unknown' : b.massing ? 'Massing' : DANGER[b.danger as 0 | 1 | 2 | 3];
/** Worst first: massing and red borders, then the lowest ratio; unknown borders after the known weak ones. */
const byDanger = (a: Balance, b: Balance) => (b.danger === -1 ? 1.5 : b.danger) - (a.danger === -1 ? 1.5 : a.danger) || (a.ratio ?? 1) - (b.ratio ?? 1);

function openBorder(b: { region: number; sector: number }) {
  click(); useUi.getState().selectBorder(b.region, b.sector);
  rendererRef.current?.flyTo(b.region, 22);
}

// ---------------------------------------------------------------- left rail

const RailIcon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

/** Panels and national sheets, one button each, down the left edge of the map. */
export function LeftRail() {
  const panel = useUi(s => s.panel), overlay = useUi(s => s.overlay), ui = useUi.getState;
  const sim = useSim(); if (!sim) return null;
  const danger = hostileBorders(sim.g, sim.me).filter(b => b.danger === 3).length, inbox = inboxOf(sim.g, sim.me), staff = { n: inbox.length, crit: inbox.some(x => x.urg > 0) };
  const p = (k: Panel, label: string, icon: React.ReactNode, badge?: number, what = '{0} borders in danger', calm = false, title = label, pulse = false) => !unlocked(sim.g, k ?? '') ? null : (
    <button data-panel={k} className={'rb' + (panel === k ? ' on' : '') + (pulse ? ' pulse' : '')} aria-pressed={panel === k} title={t(title)} onClick={() => { Sfx.clunk(); ui().setPanel(panel === k ? null : k); }}>
      {icon}<span>{t(label)}</span>{badge ? <em className={'rbadge' + (calm ? ' calm' : '')} aria-label={t(what, badge)}>{badge}</em> : null}
    </button>
  );
  const o = (k: Overlay, label: string, icon: React.ReactNode, title: string) => !unlocked(sim.g, k ?? '') ? null : (
    <button data-panel={k} className={'rb' + (overlay === k ? ' on' : '')} title={t(title)} onClick={() => { Sfx.clunk(); ui().setOverlay(k); }}>{icon}<span>{t(label)}</span></button>
  );
  return (
    <nav id="rail" className="plate" aria-label={t('War Office panels')}>
      {p('situation', 'Situation', <SwordsIcon size={22} />, danger)}
      {p('staff', 'Inbox', <RailIcon d="M4 6h16v12H4zM4 6l8 6 8-6" />, staff.n, '{0} decisions waiting', !staff.crit, 'Inbox: every decision waiting for you (G)', staff.crit && panel !== 'staff')}
      {p('forces', 'Forces', <RailIcon d="M4 10l8-5 8 5M4 15l8-5 8 5M4 20l8-5 8 5" />, 0, undefined, false, 'Forces: your corps and armies (O)')}
      {p('economy', 'Economy', <RailIcon d="M4 20V10M10 20V4M16 20v-8M22 20H2" />, 0, undefined, false, 'Economy: Production, shells, men, conscription and the nation')}
      {p('navy', 'Navy', <RailIcon d="M12 3v14M7 8h10M4 14c2 4 5 6 8 6s6-2 8-6" />)}
      {p('intel', 'Intel', <RailIcon d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z" />)}
      {o('reports', 'Reports', <RailIcon d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7" />, 'After-action reports of the last battles')}
      {o('diplomacy', 'Diplo', <HandshakeIcon />, 'Diplomacy: treaties and messages')}
      {o('rules', 'Rules', <RailIcon d="M5 4h11l3 3v13H5zM9 9h7M9 13h7M9 17h4" />, 'Rules: how fronts, corps, commanders, scouting, supply and men work, with the numbers')}
      {o('calendar', 'Calendar', <RailIcon d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4" />, 'War calendar: unlocks, rushes and doctrines')}
    </nav>
  );
}

// ---------------------------------------------------------------- situation panel

interface War { f: number; treaty: string | null; battles: Battle[]; lostUs: number; lostThem: number; regions: number }

function warsOf(g: GameState, me: number): War[] {
  const out: War[] = [];
  for (const F of g.factions) {
    if (F.id === me || !F.alive) continue;
    const t = treatyOf(g, me, F.id);
    const battles = g.battles.filter(b => !b.ended && b.sides.includes(me) && b.sides.includes(F.id));
    let lostUs = 0, lostThem = 0;
    for (const r of g.reports ?? []) {
      const us = r.sides.find(s => s.f === me), them = r.sides.find(s => s.f === F.id);
      if (us && them) { lostUs += menOf(us.lost); lostThem += menOf(them.lost); }
    }
    for (const b of battles) { lostUs += b.lost?.[me] ?? 0; lostThem += b.lost?.[F.id] ?? 0; }
    out.push({ f: F.id, treaty: t ? TREATY_NAMES[t.kind] : null, battles, lostUs, lostThem, regions: g.regions.filter(r => r.owner === F.id).length });
  }
  // fighting wars first, then wars without battles, then treaties
  return out.sort((a, b) => (a.treaty ? 1 : 0) - (b.treaty ? 1 : 0) || b.battles.length - a.battles.length || b.lostUs - a.lostUs);
}

function BattleRow({ g, me, b }: { g: GameState; me: number; b: Battle }) {
  const W = buildWorld(), stage = b.goal === undefined ? '' : ' · ' + t(['first line', 'consolidating', 'depth', 'foothold'][b.stage ?? 0]);
  const who = b.attacker === me ? t('We attack') : b.def === me ? t('We defend') : t('{0} attacks', FACTIONS[b.attacker].short);
  return (
    <button className="sit-row" onClick={() => { click(); useUi.getState().select(b.region); rendererRef.current?.flyToBattle(b.id, 8); }}>
      <span><b>{nm(W.regions[b.region].name)}</b> <small>{who}{b.from >= 0 ? ` · ${tx(borderLabel(W, b.from))}` : ''}{stage}</small></span><span className="go">{t('Go')}</span>
    </button>
  );
}

export function SituationPanel() {
  const panel = useUi(s => s.panel); const sim = useSim();
  if (panel !== 'situation' || !sim) return null;
  const { g, me } = sim, W = buildWorld(), ui = useUi.getState;
  const wars = warsOf(g, me);
  const borders = hostileBorders(g, me).sort(byDanger);
  const worst = borders.filter(b => b.danger >= 2 || b.danger === -1).slice(0, 6);
  const others = g.battles.filter(b => !b.ended && !b.sides.includes(me));
  return (
    <section id="panel" className="plate" aria-label={t('Situation')}>
      <div className="pn-h"><h2>{t('Situation')}</h2><button className="x" aria-label={t('Close panel')} onClick={() => ui().setPanel(null)}><CloseIcon /></button></div>
      <p className="pn-sub">{t('Your wars and the borders that need you. Click a row to go there.')}</p>
      <div className="pn-body">
        <FrontsList g={g} me={me} />
        <div className="lbl"><span>{t('Our wars')}</span><small>{t('{0} at war · {1} battles', wars.filter(w => !w.treaty).length, g.battles.filter(b => !b.ended && b.sides.includes(me)).length)}</small></div>
        {wars.map(w => (
          <div key={w.f} className={'war' + (w.treaty ? ' peace' : '')} style={{ '--c': FACTIONS[w.f].color } as React.CSSProperties}>
            <div className="war-h"><i className="dot" /><b>{nm(FACTIONS[w.f].name)}</b><span className={'tag' + (w.treaty ? '' : ' red')}>{w.treaty ? tx(w.treaty) : t('War')}</span></div>
            <div className="war-n">
              <span><small>{t('Battles')}</small><b>{w.battles.length}</b></span>
              <span><small>{t('Their regions')}</small><b>{w.regions}</b></span>
              <span title={t('Men lost in the battles between us that are still on record')}><small>{t('Men lost · us : them')}</small><b>{menStr(w.lostUs)} : {menStr(w.lostThem)}</b></span>
            </div>
            {!w.treaty && <WarStory g={g} me={me} foe={w.f} />}
            {w.battles.map(b => <BattleRow key={b.id} g={g} me={me} b={b} />)}
          </div>
        ))}
        <div className="lbl"><span>{t('Borders to watch')}</span><small>{t('ours : theirs')}</small></div>
        {worst.length ? worst.map(b => (
          <button key={b.region + '|' + b.sector} className={'sit-row bdr d' + (b.danger < 0 ? 'u' : b.danger) + (b.massing ? ' mass' : '')} onClick={() => openBorder(b)}>
            <span><b>{nm(W.regions[b.region].name)} · {b.nb >= 0 ? nm(W.regions[b.nb].name) : tx(borderLabel(W, b.sector))}</b><small>{t(dangerOf(b))}{b.know === 2 && b.day !== undefined ? ' · ' + t('old report') : b.know === 1 ? ' · ' + t('estimate') : ''}</small></span>
            <span className="lcdn">{b.own.btl[0] + b.own.reserve[0]} : {b.know ? rng([b.their.btl[0] + b.their.reserve[0], b.their.btl[1] + b.their.reserve[1]]) : '?'}{b.their.incoming ? ` +${b.their.incoming}` : ''}</span>
          </button>
        )) : <p className="note">{t('No border of ours is weaker than what we know is across it.')}</p>}
        {others.length > 0 && <div className="lbl"><span>{t('Other wars we can see')}</span></div>}
        {others.slice(0, 8).map(b => (
          <button key={b.id} className="sit-row" onClick={() => { click(); rendererRef.current?.flyToBattle(b.id, 10); }}>
            <span><i className="dot" style={{ '--c': FACTIONS[b.attacker].color } as React.CSSProperties} /> <b>{nm(FACTIONS[b.attacker].short)} → {FACTIONS[b.def] ? nm(FACTIONS[b.def].short) : '?'}</b> <small>{nm(W.regions[b.region].name)}</small></span><span className="go">{t('Go')}</span>
          </button>
        ))}
        <p className="note">{rich(t('Press <kbd>F</kbd> for the Fronts map: war borders glow in both powers\' colours and every border of ours shows a chip – our battalions against what we know is across.'))}</p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- border card

export function BorderCard() {
  const border = useUi(s => s.border); const sel = useUi(s => s.sel); const open = useUi(s => s.borderTool); const sim = useSim();
  const setOpen = useUi.getState().setBorderTool;
  if (!sim || !border || border[0] !== sel) return null;
  const { g, me } = sim, W = buildWorld(), ui = useUi.getState, [rid, sec] = border, r = g.regions[rid];
  if (r.owner !== me) return null;
  const b = borderBalance(g, rid, sec), foe = b.foe >= 0 ? FACTIONS[b.foe] : null;
  const works = (s: Balance['own']) => [s.trench ? tn('Trench {0}', { raw: roman(s.trench) }) : '', s.sand ? tn('sandbags {0}', { raw: roman(s.sand) }) : '', s.wire ? tn('wire {0}', { raw: roman(s.wire) }) : '', s.defs ? t(s.defs > 1 ? '{0} defences' : '{0} defence', s.defs) : ''].filter(Boolean).join(' · ') || t('No works');
  const theirCorps = b.nb >= 0 ? corpsAtPost(g.regions[b.nb], rid)[0] : undefined, ours = corpsAtPost(r, sec);
  const supply = g.factions[me].supply;
  return (
    <section className={'bcard d' + (b.danger < 0 ? 'u' : b.danger) + (b.massing ? ' mass' : '')} aria-label={t('Border')}>
      <div className="bc-h">
        <div><small>{t('Border · {0}', dangerOf(b))}</small><h3>{nm(W.regions[rid].name)} ↔ {b.nb >= 0 ? nm(W.regions[b.nb].name) : tx(borderLabel(W, sec))}</h3></div>
        <button className="x" aria-label={t('Close border')} onClick={() => ui().closeBorder()}><CloseIcon /></button>
      </div>
      <div className="bc-cols">
        <div className="bc-side" style={{ '--c': FACTIONS[me].color } as React.CSSProperties}>
          <small>{t('Ours')}</small>
          <b className="lcdn">{t('{0} btl', b.own.btl[0] + b.own.reserve[0])}</b>
          <span>{t('{0} on the border', b.own.btl[0])}{b.own.reserve[0] ? ' · ' + t('{0} reserve nearby', b.own.reserve[0]) : ''}{b.own.incoming ? ' · ' + t('{0} on the way', b.own.incoming) : ''}</span>
          <span>{works(b.own)}</span>
          {ours.length > 0 && <span className="bc-corps">{ours.map(c => <button key={c.id} className="lnk" title={t('Select this corps')} onClick={() => { click(); ui().selectCorps([c.id], false, rid); }}>{groupName(me, 1, c.n)} · {groundUnits(c.u)}</button>)}</span>}
        </div>
        <div className="bc-side" style={{ '--c': foe?.color ?? '#7fb4d8' } as React.CSSProperties}>
          <small>{t('Theirs')}{b.know === 1 ? ' · ' + t('estimate') : b.know === 2 ? ' · ' + t('old report') : b.know === 0 ? ' · ' + t('unknown') : ''}</small>
          <b className="lcdn">{b.know ? tn('{0} btl', { raw: rng([b.their.btl[0] + b.their.reserve[0], b.their.btl[1] + b.their.reserve[1]]) }) : '?'}</b>
          <span>{b.know ? `${tn('{0} on the border', { raw: rng(b.their.btl) })}${b.their.reserve[1] ? ' · ' + tn('{0} behind', { raw: rng(b.their.reserve) }) : ''}` : t('Send a patrol to find out')}{b.their.incoming ? ' · ' + t('+{0} marching in', b.their.incoming) : ''}</span>
          <span>{b.know ? works(b.their) : t('Works unknown')}</span>
          {theirCorps && theirCorps.n > 0 && <span>{groupName(b.foe, 1, theirCorps.n)}{(theirCorps.ord ?? 0) >= 1 ? ' · ' + t('assembling to attack') : ''}</span>}
        </div>
      </div>
      {b.massing && <p className="note budget full">{t('Troops across this border are assembling for an attack.')}</p>}
      <div className="bc-acts">
        <button className="btn sm" aria-pressed={open === 'send'} onClick={() => { click(); setOpen(open === 'send' ? '' : 'send'); }}>{t('Send corps…')}</button>
        <button className="btn sm" aria-pressed={open === 'fort'} onClick={() => { click(); setOpen(open === 'fort' ? '' : 'fort'); }}>{t('Fortify…')}</button>
        {b.nb >= 0 && <button className="btn sm" aria-pressed={open === 'scout'} onClick={() => { click(); setOpen(open === 'scout' ? '' : 'scout'); }}><Icon k="patrol" size={14} /> {t('Scout…')}</button>}
        {b.nb >= 0 && b.foe !== me && <button className="btn sm danger" disabled={groundUnits(r.units) < 2 || r.battle >= 0} title={t('Quick attack from this region over this border, with the share and goal set in the region\'s Overview')} onClick={() => ui().march(rid, b.nb, !!treatyOf(g, me, b.foe) || undefined)}>{t('Attack')}</button>}
      </div>
      {open === 'fort' && <FortGrid region={r} id={rid} sector={sec} />}
      {open === 'send' && <SendCorps g={g} me={me} rid={rid} sec={sec} />}
      {open === 'scout' && b.nb >= 0 && <ScoutAcross g={g} me={me} rid={rid} nb={b.nb} />}
    </section>
  );
}

/** The nearest corps of ours that could come to this border (idle, not already there), with how long they need. */
function SendCorps({ g, me, rid, sec }: { g: GameState; me: number; rid: number; sec: number }) {
  const W = buildWorld(), ui = useUi.getState;
  const list: { r: number; id: number; n: number; btl: number; eta: number; army?: number }[] = [];
  for (const r of g.regions) {
    if (r.owner !== me || !r.cs) continue;
    for (const c of r.cs) {
      if ((c.ord ?? 0) >= 1 || (r.id === rid && c.p === sec)) continue;
      if (r.id !== rid && groundUnits(c.u) >= groundUnits(r.units)) continue;
      const eta = marchEta(g, me, r.id, c.p, rid, sec); if (eta === null) continue;
      list.push({ r: r.id, id: c.id, n: c.n, btl: groundUnits(c.u), eta, army: c.army });
    }
  }
  list.sort((a, z) => a.eta - z.eta);
  if (!list.length) return <p className="note">{t('No corps of ours can reach this border over land. Form one from a region\'s reserve (Forces panel).')}</p>;
  return (
    <div className="bc-send">
      {list.slice(0, 5).map(x => (
        <div key={x.id} className="it nb">
          <div className="tx"><b>{groupName(me, 1, x.n)} · {t('{0} btl', x.btl)}</b><small>{nm(W.regions[x.r].name)} · {Math.round(x.eta)} s{x.army !== undefined ? ' · ' + t('leaves its army\'s orders') : ''}</small></div>
          <button className="buy plain" onClick={() => ui().order({ t: 'moveCorps', region: x.r, id: x.id, to: rid, toPost: sec })}>{t('Send')}</button>
        </div>
      ))}
    </div>
  );
}

/** Patrol over this border, a flight from an airfield in reach, or a spy into the region across. */
function ScoutAcross({ g, me, rid, nb }: { g: GameState; me: number; rid: number; nb: number }) {
  const W = buildWorld(), ui = useUi.getState, sup = g.factions[me].supply;
  const air = techOn(g, me, 'air') ? g.regions.find(r => r.owner === me && r.airfield && r.contested < 0 && hops(r.id, nb, AIR_RANGE) <= AIR_RANGE) : undefined;
  const spies = g.spies.filter(s => s.f === me), here = spies.find(s => s.region === nb), cap = g.regions.find(r => r.capitalOf === me && r.owner === me);
  const seen = g.regions[nb].seen;
  return (
    <div className="bc-send">
      <p className="note">{(g.regions[nb].vis ?? 0) >= 3 ? t('We see it in full.') : seen !== undefined ? t('Our last report is {0} days old.', g.day - seen) : t('We have no report on it.')}</p>
      <div className="it nb"><div className="tx"><b>{t('Cavalry patrol')}</b><small>{t('Troops across and the defences of this border · may be caught')}</small></div>
        <button className="buy plain" disabled={sup < COST.patrol} onClick={() => ui().order({ t: 'patrol', from: rid, to: nb })}>{COST.patrol}</button></div>
      {air && <div className="it nb"><div className="tx"><b>{t('Reconnaissance flight')}</b><small>{t('From {0}: troops, buildings, every border · anti-air may shoot it down', W.regions[air.id].name)}</small></div>
        <button className="buy plain" disabled={sup < COST.recon} onClick={() => ui().order({ t: 'recon', from: air.id, to: nb })}>{COST.recon}</button></div>}
      <div className="it nb"><div className="tx"><b>{here ? (activeSpies(g, me).some(s => s.region === nb) ? t('Our agent works there') : t('Our agent is on the way')) : t('Spy from the capital')}</b><small>{here ? t('Reports everything until unmasked') : t('{0}/3 agents in the field', spies.length)}</small></div>
        {!here && <button className="buy plain" disabled={!cap || sup < COST.spy || spies.length >= 3} onClick={() => ui().order({ t: 'spy', to: nb })}>{COST.spy}</button>}</div>
    </div>
  );
}

// ---------------------------------------------------------------- borders list (region Overview)

/** Every border and coast of an own region, one row each: who is across, the balance where it matters, the works, and a
 *  Fortify button that opens the border card with its works (design-play §1). */
export function BordersList({ r }: { r: RegionState }) {
  const sim = useSim(); const border = useUi(s => s.border);
  if (!sim) return null;
  const { g, me } = sim, W = buildWorld(), ui = useUi.getState, wr = W.regions[r.id];
  const hostile = new Map(hostileBorders(g, me).filter(b => b.region === r.id).map(b => [b.sector, b]));
  const rows = [...wr.land.map(n => ({ s: n, name: nm(W.regions[n].name), owner: g.regions[n].owner })), ...wr.zones.map(z => ({ s: 1000 + z, name: t('Coast · {0}', W.zones[z].name), owner: -1 }))];
  const rank = (x: { s: number; owner: number }) => { const b = hostile.get(x.s); return b ? 10 + (b.danger < 0 ? 1.5 : b.danger) : x.owner === me ? 0 : x.owner >= 0 ? 2 : 1; };
  rows.sort((a, b) => rank(b) - rank(a));
  return (
    <div id="borders-list" className="blist">
      <div className="lbl"><span>{t('Borders')}</span><small>{t('ours : theirs')}</small></div>
      {rows.map(x => {
        const b = hostile.get(x.s), w = worksAt(r, x.s), defs = r.defs.filter(d => d.s === x.s && d.f === r.owner).length;
        const F = x.owner >= 0 ? FACTIONS[x.owner] : null, tr = x.owner >= 0 && x.owner !== me ? treatyOf(g, me, x.owner) : undefined;
        const state = b ? t(dangerOf(b)) : x.owner === me ? t('our region') : tr ? tx(TREATY_NAMES[tr.kind]) : x.s >= 1000 ? t('coast') : x.owner >= 0 ? t('quiet') : '';
        const on = border && border[0] === r.id && border[1] === x.s;
        const workTxt = [w.tr ? tn('Trench {0}', { raw: roman(w.tr) }) : '', w.sand ? t('sandbags') : '', w.wire ? t('wire') : '', defs ? t(defs > 1 ? '{0} defences' : '{0} defence', defs) : ''].filter(Boolean).join(' · ');
        return (
          <div key={x.s} className={'bl-row' + (b ? ' d' + (b.danger < 0 ? 'u' : b.danger) + (b.massing ? ' mass' : '') : '') + (on ? ' on' : '')}>
            <button className="bl-main" onClick={() => openBorder({ region: r.id, sector: x.s })}>
              <i className="dot" style={{ '--c': F?.color ?? '#7fb4d8' } as React.CSSProperties} />
              <span className="tx"><b>{x.name}</b><small>{state}{workTxt ? ' · ' + workTxt : ''}</small></span>
              {b && <span className="lcdn bl-bal">{b.own.btl[0] + b.own.reserve[0]} : {b.know ? rng([b.their.btl[0] + b.their.reserve[0], b.their.btl[1] + b.their.reserve[1]]) : '?'}</span>}
            </button>
            {x.owner !== me && <button className="btn sm" onClick={() => { click(); ui().selectBorder(r.id, x.s, 'fort'); rendererRef.current?.flyTo(r.id, 22); }}>{t('Fortify')}</button>}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- alerts

interface Alert { key: string; level: 0 | 1 | 2; title: string; text: string; act: string; go: () => void }

function alertsOf(g: GameState, me: number): Alert[] {
  const W = buildWorld(), out: Alert[] = [], f = g.factions[me];
  for (const b of g.battles) if (!b.ended && b.def === me && b.attacker !== me) out.push({
    key: 'atk' + b.id, level: 2, title: t('{0} under attack', W.regions[b.region].name), text: b.from >= 0 ? t('{0} attacks {1}', FACTIONS[b.attacker]?.name ?? 'The enemy', borderLabel(W, b.from)) : t('{0} attacks', FACTIONS[b.attacker]?.name ?? 'The enemy'), act: t('Go'),
    go: () => { useUi.getState().select(b.region); rendererRef.current?.flyToBattle(b.id, 8); },
  });
  for (const b of hostileBorders(g, me)) if (b.massing || b.danger === 3) out.push({
    key: 'bd' + b.region + '|' + b.sector, level: b.massing ? 2 : 1, title: t(b.massing ? 'Massing at {0} – {1}' : 'Weak border: {0} – {1}', W.regions[b.region].name, b.nb >= 0 ? W.regions[b.nb].name : borderLabel(W, b.sector)),
    text: tn('ours {0} : theirs {1}', b.own.btl[0] + b.own.reserve[0], { raw: b.know ? rng([b.their.btl[0] + b.their.reserve[0], b.their.btl[1] + b.their.reserve[1]]) : '?' }), act: t('Open'), go: () => openBorder(b),
  });
  for (const r of g.regions) if (r.owner === me && r.cut) out.push({
    key: 'cut' + r.id, level: 1, title: t('{0} is cut off', W.regions[r.id].name), text: tn('{0}: no Production, recruits or replacements, the garrison wears down', { raw: cutReason(g, r)[0].toUpperCase() + cutReason(g, r).slice(1) }), act: t('Show'),
    go: () => { useUi.getState().select(r.id); useUi.getState().setMode(3); rendererRef.current?.flyTo(r.id, 30); },
  });
  // over supply capacity: only where it bites (troops would go hungry), worst first
  for (const r of g.regions) if (r.owner === me && !r.cut) { const l = load(g, r), c = capacity(g, r); if (l > c) out.push({
    key: 'cap' + r.id, level: l > c * OVER.far ? 1 : 0, title: t('{0} over its supply capacity', W.regions[r.id].name), text: t(l > c * OVER.far ? '{0} / {1} · men fall sick and hungry: move troops out or lay a railway' : '{0} / {1} · no replacements, morale falls: move troops out or lay a railway', l, c), act: t('Show'),
    go: () => { useUi.getState().select(r.id); useUi.getState().setMode(3); rendererRef.current?.flyTo(r.id, 30); },
  }); }
  if ((f.men ?? 0) < 300) out.push({ key: 'men', level: 1, title: t('Manpower nearly gone'), text: t('{0} men left in the pool: no recruits, no replacements', Math.floor(f.men ?? 0)), act: t('Economy'), go: () => useUi.getState().setPanel('economy') });
  const inc = income(g, me);
  if (f.supply > Math.max(30, inc * 4)) out.push({ key: 'idle', level: 0, title: t('{0} Production unspent', f.supply), text: t('Recruit, fortify or build'), act: t('Capital'), go: () => { const c = g.regions.find(r => r.capitalOf === me && r.owner === me); if (c) { useUi.getState().select(c.id); useUi.getState().setTab('rec'); rendererRef.current?.flyTo(c.id, 30); } } });
  return out.sort((a, b) => b.level - a.level);
}

export function Alerts() {
  const sim = useSim(); const dismissed = useUi(s => s.dismissed);
  if (!sim || sim.g.over) return null;
  const { g, me } = sim, ui = useUi.getState;
  const list = alertsOf(g, me).filter(a => (dismissed[a.key] ?? -1) < g.time).slice(0, 4);
  if (!list.length) return null;
  return (
    <div id="alerts" aria-label={t('Alerts')} aria-live="polite">
      {list.map(a => (
        <div key={a.key} className={'alert-i plate l' + a.level}>
          <span className="at"><b>{a.title}</b><small>{a.text}</small></span>
          <button className="btn sm" onClick={() => { click(); a.go(); }}>{a.act}</button>
          <button className="x" aria-label={t('Dismiss')} title={t('Dismiss for a minute')} onClick={() => ui().dismiss(a.key, g.time + 60)}><CloseIcon /></button>
        </div>
      ))}
    </div>
  );
}
