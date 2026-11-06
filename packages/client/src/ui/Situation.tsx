// Seeing the situation (design-command §1, §5): the left rail of panels, the Situation panel (our wars, borders in danger,
// other wars), the border card opened from a balance chip, and the alerts queue.
import { AIR_RANGE, COST, FACTIONS, TREATY_NAMES, activeSpies, borderBalance, borderLabel, buildWorld, corpsAtPost, groundUnits, groupName, hops, hostileBorders, income, marchEta, techOn, treatyOf, type Balance, type Battle, type GameState } from '@riskrts/shared';
import { useSim, useUi, type Overlay, type Panel } from '../game/store';
import { click } from './actions';
import { Sfx } from '../audio/sfx';
import { CloseIcon, HandshakeIcon, Icon, SwordsIcon } from './icons';
import { menOf, menStr } from './format';
import { rendererRef } from './refs';
import { reqText, staffBadge } from './Staff';
import { FortGrid } from './DrawerTabs';
import { useState } from 'react';

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
  const danger = hostileBorders(sim.g, sim.me).filter(b => b.danger === 3).length, staff = staffBadge(sim.g, sim.me);
  const p = (k: Panel, label: string, icon: React.ReactNode, badge?: number, what = 'borders in danger', calm = false) => (
    <button className={'rb' + (panel === k ? ' on' : '')} aria-pressed={panel === k} title={label} onClick={() => { Sfx.clunk(); ui().setPanel(panel === k ? null : k); }}>
      {icon}<span>{label}</span>{badge ? <em className={'rbadge' + (calm ? ' calm' : '')} aria-label={`${badge} ${what}`}>{badge}</em> : null}
    </button>
  );
  const o = (k: Overlay, label: string, icon: React.ReactNode, title: string) => (
    <button className={'rb' + (overlay === k ? ' on' : '')} title={title} onClick={() => { Sfx.clunk(); ui().setOverlay(k); }}>{icon}<span>{label}</span></button>
  );
  return (
    <nav id="rail" className="plate" aria-label="War Office panels">
      {p('situation', 'Situation', <SwordsIcon size={22} />, danger)}
      {p('staff', 'Staff', <RailIcon d="M4 6h16v12H4zM4 6l8 6 8-6" />, staff.n, 'requests waiting', !staff.crit)}
      {p('forces', 'Forces', <RailIcon d="M4 10l8-5 8 5M4 15l8-5 8 5M4 20l8-5 8 5" />)}
      {p('economy', 'Economy', <RailIcon d="M4 20V10M10 20V4M16 20v-8M22 20H2" />)}
      {p('navy', 'Navy', <RailIcon d="M12 3v14M7 8h10M4 14c2 4 5 6 8 6s6-2 8-6" />)}
      {p('intel', 'Intel', <RailIcon d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z" />)}
      {o('nation', 'Nation', <RailIcon d="M4 20V8l8-5 8 5v12M9 20v-6h6v6" />, 'Nation: manpower, conscription, national strengths and weaknesses')}
      {o('reports', 'Reports', <RailIcon d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7" />, 'After-action reports of the last battles')}
      {o('diplomacy', 'Diplo', <HandshakeIcon />, 'Diplomacy: treaties and messages')}
      {o('rules', 'Rules', <RailIcon d="M5 4h11l3 3v13H5zM9 9h7M9 13h7M9 17h4" />, 'Rules: how fronts, corps, commanders, scouting and supply work, with the numbers')}
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
  const W = buildWorld(), stage = b.goal === undefined ? '' : [' · first line', ' · consolidating', ' · depth', ' · foothold'][b.stage ?? 0];
  const who = b.attacker === me ? 'We attack' : b.def === me ? 'We defend' : `${FACTIONS[b.attacker].short} attacks`;
  return (
    <button className="sit-row" onClick={() => { click(); useUi.getState().select(b.region); rendererRef.current?.flyToBattle(b.id, 8); }}>
      <span><b>{W.regions[b.region].name}</b> <small>{who}{b.from >= 0 ? ` · ${borderLabel(W, b.from)}` : ''}{stage}</small></span><span className="go">Go</span>
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
    <section id="panel" className="plate" aria-label="Situation">
      <div className="pn-h"><h2>Situation</h2><button className="x" aria-label="Close panel" onClick={() => ui().setPanel(null)}><CloseIcon /></button></div>
      <div className="pn-body">
        <div className="lbl"><span>Our wars</span><small>{wars.filter(w => !w.treaty).length} at war · {g.battles.filter(b => !b.ended && b.sides.includes(me)).length} battles</small></div>
        {wars.map(w => (
          <div key={w.f} className={'war' + (w.treaty ? ' peace' : '')} style={{ '--c': FACTIONS[w.f].color } as React.CSSProperties}>
            <div className="war-h"><i className="dot" /><b>{FACTIONS[w.f].name}</b><span className={'tag' + (w.treaty ? '' : ' red')}>{w.treaty ?? 'War'}</span></div>
            <div className="war-n">
              <span><small>Battles</small><b>{w.battles.length}</b></span>
              <span><small>Their regions</small><b>{w.regions}</b></span>
              <span title="Men lost in the battles between us that are still on record"><small>Men lost · us : them</small><b>{menStr(w.lostUs)} : {menStr(w.lostThem)}</b></span>
            </div>
            {w.battles.map(b => <BattleRow key={b.id} g={g} me={me} b={b} />)}
          </div>
        ))}
        <div className="lbl"><span>Borders to watch</span><small>ours : theirs</small></div>
        {worst.length ? worst.map(b => (
          <button key={b.region + '|' + b.sector} className={'sit-row bdr d' + (b.danger < 0 ? 'u' : b.danger) + (b.massing ? ' mass' : '')} onClick={() => openBorder(b)}>
            <span><b>{W.regions[b.region].name} · {b.nb >= 0 ? W.regions[b.nb].name : borderLabel(W, b.sector)}</b><small>{dangerOf(b)}{b.know === 2 && b.day !== undefined ? ' · old report' : b.know === 1 ? ' · estimate' : ''}</small></span>
            <span className="lcdn">{b.own.btl[0] + b.own.reserve[0]} : {b.know ? rng([b.their.btl[0] + b.their.reserve[0], b.their.btl[1] + b.their.reserve[1]]) : '?'}{b.their.incoming ? ` +${b.their.incoming}` : ''}</span>
          </button>
        )) : <p className="note">No border of ours is weaker than what we know is across it.</p>}
        {others.length > 0 && <div className="lbl"><span>Other wars we can see</span></div>}
        {others.slice(0, 8).map(b => (
          <button key={b.id} className="sit-row" onClick={() => { click(); rendererRef.current?.flyToBattle(b.id, 10); }}>
            <span><i className="dot" style={{ '--c': FACTIONS[b.attacker].color } as React.CSSProperties} /> <b>{FACTIONS[b.attacker].short} → {FACTIONS[b.def]?.short ?? '?'}</b> <small>{W.regions[b.region].name}</small></span><span className="go">Go</span>
          </button>
        ))}
        <p className="note">Press <kbd>F</kbd> for the Fronts map: war borders glow in both powers' colours and every border of ours shows a chip – our battalions against what we know is across.</p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- border card

export function BorderCard() {
  const border = useUi(s => s.border); const sel = useUi(s => s.sel); const sim = useSim();
  const [open, setOpen] = useState<'' | 'fort' | 'send' | 'scout'>('');
  if (!sim || !border || border[0] !== sel) return null;
  const { g, me } = sim, W = buildWorld(), ui = useUi.getState, [rid, sec] = border, r = g.regions[rid];
  if (r.owner !== me) return null;
  const b = borderBalance(g, rid, sec), foe = b.foe >= 0 ? FACTIONS[b.foe] : null;
  const works = (s: Balance['own']) => [s.trench ? `Trench ${roman(s.trench)}` : '', s.sand ? `sandbags ${roman(s.sand)}` : '', s.wire ? `wire ${roman(s.wire)}` : '', s.defs ? `${s.defs} defence${s.defs > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') || 'No works';
  const theirCorps = b.nb >= 0 ? corpsAtPost(g.regions[b.nb], rid)[0] : undefined, ours = corpsAtPost(r, sec);
  const supply = g.factions[me].supply;
  return (
    <section className={'bcard d' + (b.danger < 0 ? 'u' : b.danger) + (b.massing ? ' mass' : '')} aria-label="Border">
      <div className="bc-h">
        <div><small>Border · {dangerOf(b)}</small><h3>{W.regions[rid].name} ↔ {b.nb >= 0 ? W.regions[b.nb].name : borderLabel(W, sec)}</h3></div>
        <button className="x" aria-label="Close border" onClick={() => ui().closeBorder()}><CloseIcon /></button>
      </div>
      <div className="bc-cols">
        <div className="bc-side" style={{ '--c': FACTIONS[me].color } as React.CSSProperties}>
          <small>Ours</small>
          <b className="lcdn">{b.own.btl[0] + b.own.reserve[0]} btl</b>
          <span>{b.own.btl[0]} on the border{b.own.reserve[0] ? ` · ${b.own.reserve[0]} reserve nearby` : ''}{b.own.incoming ? ` · ${b.own.incoming} on the way` : ''}</span>
          <span>{works(b.own)}</span>
          {ours.length > 0 && <span className="bc-corps">{ours.map(c => <button key={c.id} className="lnk" title="Select this corps" onClick={() => { click(); ui().selectCorps([c.id], false, rid); }}>{groupName(me, 1, c.n)} · {groundUnits(c.u)}</button>)}</span>}
        </div>
        <div className="bc-side" style={{ '--c': foe?.color ?? '#7fb4d8' } as React.CSSProperties}>
          <small>Theirs{b.know === 1 ? ' · estimate' : b.know === 2 ? ' · old report' : b.know === 0 ? ' · unknown' : ''}</small>
          <b className="lcdn">{b.know ? `${rng([b.their.btl[0] + b.their.reserve[0], b.their.btl[1] + b.their.reserve[1]])} btl` : '?'}</b>
          <span>{b.know ? `${rng(b.their.btl)} on the border${b.their.reserve[1] ? ` · ${rng(b.their.reserve)} behind` : ''}` : 'Send a patrol to find out'}{b.their.incoming ? ` · +${b.their.incoming} marching in` : ''}</span>
          <span>{b.know ? works(b.their) : 'Works unknown'}</span>
          {theirCorps && theirCorps.n > 0 && <span>{groupName(b.foe, 1, theirCorps.n)}{(theirCorps.ord ?? 0) >= 1 ? ' · assembling to attack' : ''}</span>}
        </div>
      </div>
      {b.massing && <p className="note budget full">Troops across this border are assembling for an attack.</p>}
      <div className="bc-acts">
        <button className="btn sm" aria-pressed={open === 'send'} onClick={() => { click(); setOpen(open === 'send' ? '' : 'send'); }}>Send corps…</button>
        <button className="btn sm" aria-pressed={open === 'fort'} onClick={() => { click(); setOpen(open === 'fort' ? '' : 'fort'); }}>Fortify…</button>
        {b.nb >= 0 && <button className="btn sm" aria-pressed={open === 'scout'} onClick={() => { click(); setOpen(open === 'scout' ? '' : 'scout'); }}><Icon k="patrol" size={14} /> Scout…</button>}
        {b.nb >= 0 && b.foe !== me && <button className="btn sm danger" disabled={groundUnits(r.units) < 2 || r.battle >= 0} title="Quick attack from this region over this border, with the share and goal set in the region's Overview" onClick={() => ui().march(rid, b.nb, !!treatyOf(g, me, b.foe) || undefined)}>Attack</button>}
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
  if (!list.length) return <p className="note">No corps of ours can reach this border over land. Form one from a depot (Forces panel).</p>;
  return (
    <div className="bc-send">
      {list.slice(0, 5).map(x => (
        <div key={x.id} className="it nb">
          <div className="tx"><b>{groupName(me, 1, x.n)} · {x.btl} btl</b><small>{W.regions[x.r].name} · {Math.round(x.eta)} s{x.army !== undefined ? ' · leaves its army\'s orders' : ''}</small></div>
          <button className="buy plain" onClick={() => ui().order({ t: 'moveCorps', region: x.r, id: x.id, to: rid, toPost: sec })}>Send</button>
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
      <p className="note">{(g.regions[nb].vis ?? 0) >= 3 ? 'We see it in full.' : seen !== undefined ? `Our last report is ${g.day - seen} days old.` : 'We have no report on it.'}</p>
      <div className="it nb"><div className="tx"><b>Cavalry patrol</b><small>Troops across and the defences of this border · may be caught</small></div>
        <button className="buy plain" disabled={sup < COST.patrol} onClick={() => ui().order({ t: 'patrol', from: rid, to: nb })}>{COST.patrol}</button></div>
      {air && <div className="it nb"><div className="tx"><b>Reconnaissance flight</b><small>From {W.regions[air.id].name}: troops, buildings, every border · anti-air may shoot it down</small></div>
        <button className="buy plain" disabled={sup < COST.recon} onClick={() => ui().order({ t: 'recon', from: air.id, to: nb })}>{COST.recon}</button></div>}
      <div className="it nb"><div className="tx"><b>{here ? (activeSpies(g, me).some(s => s.region === nb) ? 'Our agent works there' : 'Our agent is on the way') : 'Spy from the capital'}</b><small>{here ? 'Reports everything until unmasked' : `${spies.length}/3 agents in the field`}</small></div>
        {!here && <button className="buy plain" disabled={!cap || sup < COST.spy || spies.length >= 3} onClick={() => ui().order({ t: 'spy', to: nb })}>{COST.spy}</button>}</div>
    </div>
  );
}

// ---------------------------------------------------------------- alerts

interface Alert { key: string; level: 0 | 1 | 2; title: string; text: string; act: string; go: () => void }

function alertsOf(g: GameState, me: number): Alert[] {
  const W = buildWorld(), out: Alert[] = [], f = g.factions[me];
  for (const b of g.battles) if (!b.ended && b.def === me && b.attacker !== me) out.push({
    key: 'atk' + b.id, level: 2, title: `${W.regions[b.region].name} under attack`, text: `${FACTIONS[b.attacker]?.name ?? 'The enemy'} attacks ${b.from >= 0 ? borderLabel(W, b.from) : ''}`.trim(), act: 'Go',
    go: () => { useUi.getState().select(b.region); rendererRef.current?.flyToBattle(b.id, 8); },
  });
  for (const b of hostileBorders(g, me)) if (b.massing || b.danger === 3) out.push({
    key: 'bd' + b.region + '|' + b.sector, level: b.massing ? 2 : 1, title: `${b.massing ? 'Massing at' : 'Weak border:'} ${W.regions[b.region].name} – ${b.nb >= 0 ? W.regions[b.nb].name : borderLabel(W, b.sector)}`,
    text: `ours ${b.own.btl[0] + b.own.reserve[0]} : theirs ${b.know ? rng([b.their.btl[0] + b.their.reserve[0], b.their.btl[1] + b.their.reserve[1]]) : '?'}`, act: 'Open', go: () => openBorder(b),
  });
  for (const r of g.regions) if (r.owner === me && r.cut) out.push({
    key: 'cut' + r.id, level: 1, title: `${W.regions[r.id].name} is cut off`, text: 'No route home: no income or recruits, the garrison wears down', act: 'Show',
    go: () => { useUi.getState().select(r.id); useUi.getState().setMode(3); rendererRef.current?.flyTo(r.id, 30); },
  });
  for (const q of (g.requests ?? []).filter(q => q.owner === me && q.urg === 2)) { const t = reqText(g, me, q); out.push({ key: 'rq' + q.id, level: 2, title: `Staff: ${t.title}`, text: t.why, act: 'Staff', go: () => useUi.getState().setPanel('staff') }); }
  if ((f.men ?? 0) < 300) out.push({ key: 'men', level: 1, title: 'Manpower nearly gone', text: `${Math.floor(f.men ?? 0)} men left in the pool`, act: 'Nation', go: () => useUi.getState().setOverlay('nation') });
  const inc = income(g, me);
  if (f.supply > Math.max(30, inc * 4)) out.push({ key: 'idle', level: 0, title: `${f.supply} supply unspent`, text: 'Recruit, fortify or build', act: 'Capital', go: () => { const c = g.regions.find(r => r.capitalOf === me && r.owner === me); if (c) { useUi.getState().select(c.id); useUi.getState().setTab('rec'); rendererRef.current?.flyTo(c.id, 30); } } });
  return out.sort((a, b) => b.level - a.level);
}

export function Alerts() {
  const sim = useSim(); const dismissed = useUi(s => s.dismissed);
  if (!sim || sim.g.over) return null;
  const { g, me } = sim, ui = useUi.getState;
  const list = alertsOf(g, me).filter(a => (dismissed[a.key] ?? -1) < g.time).slice(0, 4);
  if (!list.length) return null;
  return (
    <div id="alerts" aria-label="Alerts" aria-live="polite">
      {list.map(a => (
        <div key={a.key} className={'alert-i plate l' + a.level}>
          <span className="at"><b>{a.title}</b><small>{a.text}</small></span>
          <button className="btn sm" onClick={() => { click(); a.go(); }}>{a.act}</button>
          <button className="x" aria-label="Dismiss" title="Dismiss for a minute" onClick={() => ui().dismiss(a.key, g.time + 60)}><CloseIcon /></button>
        </div>
      ))}
    </div>
  );
}
