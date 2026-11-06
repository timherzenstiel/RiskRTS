// Nation-wide panels on the left rail (design-command §5.2): Economy (Production, shells and manpower as ledgers, the war
// economy lever, conscription, supply trouble), Navy (ports and fleets) and Intel (agents, scouts in the air, reports by age, and the
// borders we know too little about).
import {
  ECON, FORMATION, OVER, REPL, WOUNDED, barrageWeeks, capacity, econOf, ledger, load,
  COST, FACTIONS, MANPOWER, borderLabel, buildWorld, groundUnits, hostileBorders, income, incomeTerms, poolGrowth, poolTerms, shellIncome, shellTerms,
  SHIP, activeSpies, type GameState, type Term,
} from '@riskrts/shared';
import { useSim, useUi } from '../game/store';
import { click } from './actions';
import { CloseIcon, Icon } from './icons';
import { capLines, cutReason } from './Logistics';
import { menStr, nm } from './format';
import { getLang, t, tx } from '../i18n';
import { tn } from './LangPicker';
import { rendererRef } from './refs';
import { FleetList } from './Navy';

const MOB = ['Peacetime', 'Extended', 'Total'] as const;
const fmt = (v: number) => { const de = getLang() === 'de'; return (v > 0 ? '+' : v < 0 ? '−' : '') + (Math.abs(v) >= 100 ? Math.round(Math.abs(v)).toLocaleString(de ? 'de-DE' : 'en-GB') : String(Math.round(Math.abs(v) * 10) / 10).replace('.', de ? ',' : '.')); };

function Ledger({ terms, total, unit }: { terms: Term[]; total: number; unit: string }) {
  return (
    <table className="ledger">
      <tbody>
        {terms.map((t, i) => <tr key={i} title={t.note}><td>{t.label}</td><td className={t.v < 0 ? 'neg' : ''}>{fmt(t.v)}</td></tr>)}
        <tr className="sum"><td>Per week</td><td>{fmt(total)} {unit}</td></tr>
      </tbody>
    </table>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  const ui = useUi.getState;
  return (
    <section id="panel" className="plate" aria-label={t(title)}>
      <div className="pn-h"><h2>{t(title)}</h2><button className="x" aria-label={t('Close panel')} onClick={() => ui().setPanel(null)}><CloseIcon /></button></div>
      <div className="pn-body">{children}</div>
    </section>
  );
}
const go = (region: number, d = 26) => { click(); useUi.getState().select(region); rendererRef.current?.flyTo(region, d); };

// ---------------------------------------------------------------- economy

export function EconomyPanel() {
  const panel = useUi(s => s.panel); const sim = useSim();
  if (panel !== 'economy' || !sim) return null;
  const { g, me } = sim, f = g.factions[me], W = buildWorld(), ui = useUi.getState, mob = f.mob ?? 0, econ = econOf(f);
  const mine = g.regions.filter(r => r.owner === me), cut = mine.filter(r => r.cut), road = mine.filter(r => !r.cut && r.supplyQ === 1), strike = mine.filter(r => r.strike);
  const loads = mine.filter(r => !r.cut).map(r => ({ r, l: load(g, r), c: capacity(g, r) })).filter(x => x.l > x.c * .8).sort((a, z) => z.l / Math.max(1, z.c) - a.l / Math.max(1, a.c));
  const field = mine.reduce((s, r) => s + r.men.inf + r.men.mg + r.men.art + r.men.tank + r.men.plane, 0);
  const training = mine.reduce((s, r) => s + (r.train ?? []).reduce((a, t) => a + FORMATION[t.k].men, 0), 0);
  const L = ledger(g, me), wk = barrageWeeks(g, me);
  const sum = (t: Term[]) => t.reduce((s, x) => s + x.v, 0);
  return (
    <Shell title="Economy">
      <div className="lbl"><span>Production · {f.supply} in hand</span><small>spent on recruits, works, buildings, scouting</small></div>
      <Ledger terms={incomeTerms(g, me)} total={income(g, me)} unit="Production" />
      <div className="lbl"><span>Shells · {Math.floor(f.shells ?? 0)} in stock</span><small>{isFinite(wk) ? `~${wk < 10 ? Math.round(wk * 10) / 10 : Math.round(wk)} weeks of light barrage` : 'no batteries'}</small></div>
      <Ledger terms={shellTerms(g, me)} total={shellIncome(g, me)} unit="shells" />
      <div className="lv-row"><span className="lv-l" title={ECON.map(e => `${e.name}: ${Math.round(e.shells * 100)} % of factory output goes to shells`).join('\n')}>War economy</span>
        <div className="seg" role="group" aria-label="War economy">
          {ECON.map((e, i) => <button key={e.name} aria-pressed={econ === i} onClick={() => { click(); ui().order({ t: 'econ', level: i }); }}>{e.name}</button>)}
        </div>
      </div>
      <p className="note">{Math.round(ECON[econ].shells * 100)} % of what the factories make goes to the shell works; the rest is Production. The capital and the base output make shells either way.</p>
      <div className="lbl"><span>Men · {menStr(f.men ?? 0)} in the pool</span><small>{menStr(field)} field · {menStr(training)} training · {menStr(f.wounded ?? 0)} wounded</small></div>
      <table className="ledger two">
        <thead><tr><td /><td>last week</td><td>next week</td></tr></thead>
        <tbody>
          {L.next.map((t, i) => <tr key={t.label} title={t.note}><td>{t.label}</td><td className={(L.last?.[i].v ?? 0) < 0 ? 'neg' : ''}>{L.last ? fmt(L.last[i].v) : '–'}</td><td className={t.v < 0 ? 'neg' : ''}>{t.note && !t.v ? '–' : fmt(t.v)}</td></tr>)}
          <tr className="sum"><td>Change</td><td>{L.last ? fmt(sum(L.last)) : '–'}</td><td>{fmt(sum(L.next))}</td></tr>
        </tbody>
      </table>
      <p className="note" title={poolTerms(g, me).map(t => `${t.label}  ${fmt(t.v)}`).join('\n')}>Recruits train for a week. Each week under-strength corps in supplied regions under their capacity take up to {Math.round(REPL.share * 100)} % of their full strength from the pool – the front line first. {Math.round(WOUNDED.share * 100)} % of the casualties come back to the pool after {WOUNDED.days / 7} weeks.</p>
      <div className="lv-row"><span className="lv-l" title={`Each level: +${Math.round(MANPOWER.mobGrowth * 100)} % age class and +${MANPOWER.mobWW} war weariness per week`}>Conscription</span>
        <div className="seg" role="group" aria-label="Conscription">
          {MOB.map((m, i) => <button key={m} aria-pressed={mob === i} onClick={() => { click(); ui().order({ t: 'mobilise', level: i }); }}>{m}</button>)}
        </div>
      </div>
      <p className="note">{mob ? `+${mob * Math.round(MANPOWER.mobGrowth * 100)} % age class, +${mob * MANPOWER.mobWW} war weariness a week. ` : ''}War weariness {Math.round(f.ww)} %.</p>
      <div className="lbl"><span>Supply</span><small>{mine.length - cut.length - road.length} by rail · {road.length} by road · {cut.length} cut off</small></div>
      {cut.map(r => <button key={'c' + r.id} className="sit-row" onClick={() => go(r.id)}><span><b>{W.regions[r.id].name}</b> <small>Cut off: {cutReason(g, r)}</small></span><span className="go">Go</span></button>)}
      {loads.slice(0, 8).map(({ r, l, c }) => <button key={'l' + r.id} className="sit-row" title={capLines(g, r)} onClick={() => go(r.id)}><span><b>{W.regions[r.id].name}</b> <small>{l > c * OVER.far ? 'Far over capacity: men fall sick' : l > c ? 'Over capacity: no replacements, morale falls' : 'Near capacity'} · {l} / {c}</small></span><span className="go">Go</span></button>)}
      {strike.map(r => <button key={'s' + r.id} className="sit-row" onClick={() => go(r.id)}><span><b>{W.regions[r.id].name}</b> <small>On strike: pays nothing</small></span><span className="go">Go</span></button>)}
      {!cut.length && !strike.length && !loads.length && <p className="note">Every region is supplied and under its capacity.</p>}
      <p className="note">A railway, a factory, a harbour or the capital raise what a region can feed; mud, winter and heat lower it.</p>
    </Shell>
  );
}

// ---------------------------------------------------------------- navy

export function NavyPanel() {
  const panel = useUi(s => s.panel); const sim = useSim();
  if (panel !== 'navy' || !sim) return null;
  const { g, me } = sim, W = buildWorld(), ui = useUi.getState;
  const ports = g.regions.filter(r => r.owner === me && r.port);
  return (
    <Shell title="Navy">
      <FleetList />
      <div className="lbl"><span>{t('Ports · {0}', ports.length)}</span><small>{t('ships docked')}</small></div>
      {ports.map(r => {
        const docked = g.ships.filter(s => s.owner === me && s.port === r.id && s.fleet < 0), kinds = [...new Set(docked.map(s => s.kind))];
        return (
          <button key={r.id} className="sit-row" onClick={() => { go(r.id); ui().setTab('build'); }}>
            <span><b>{nm(W.regions[r.id].name)}</b> <small>{docked.length ? kinds.map(k => `${docked.filter(s => s.kind === k).length} ${tx(SHIP[k].many ?? SHIP[k].one)}`).join(' · ') : t('no ships')}{r.portAt !== undefined && r.portAt > g.time ? ' · ' + t('being built') : ''}</small></span><span className="go">{t('Open')}</span>
          </button>
        );
      })}
      {!ports.length && <p className="note">{t('No ports. Build one in a coastal region (its Build tab).')}</p>}
      <p className="note">{t('Ships are built, and troops shipped or landed, from a port\'s Build tab. Click a fleet at sea to give it orders.')}</p>
    </Shell>
  );
}

// ---------------------------------------------------------------- intel

export function IntelPanel() {
  const panel = useUi(s => s.panel); const sim = useSim();
  if (panel !== 'intel' || !sim) return null;
  const { g, me } = sim, W = buildWorld(), ui = useUi.getState, sup = g.factions[me].supply;
  const spies = g.spies.filter(s => s.f === me), working = new Set(activeSpies(g, me).map(s => s.id));
  const scouts = g.armies.filter(a => a.owner === me && a.scout);
  // our borders with the oldest or no report on what is across, worst danger first
  const blind = hostileBorders(g, me).filter(b => b.nb >= 0 && (b.know <= 1 || (b.day !== undefined && g.day - b.day > 14)))
    .map(b => ({ b, age: g.regions[b.nb].seen === undefined ? Infinity : g.day - g.regions[b.nb].seen! }))
    .sort((x, y) => (y.b.danger - x.b.danger) || (y.age - x.age)).slice(0, 8);
  const reports = g.regions.filter(r => r.owner !== me && r.owner >= 0 && r.seen !== undefined).sort((a, b) => (b.seen ?? 0) - (a.seen ?? 0)).slice(0, 10);
  return (
    <Shell title="Intel">
      <div className="lbl"><span>{t('Agents · {0}/3', spies.length)}</span></div>
      {spies.length ? spies.map(s => (
        <button key={s.id} className="sit-row" onClick={() => go(s.region)}><span><Icon k="spy" size={14} /> <b>{W.regions[s.region].name}</b> <small>{working.has(s.id) ? `reporting${(s.hot ?? -1) > g.day ? ' · exposed after sabotage' : ''}` : `on the way · ${Math.ceil(s.eta - g.time)} s`}</small></span><span className="go">Go</span></button>
      )) : <p className="note">No agents in the field. Send one from a foreign region's file or a border card ({COST.spy} Production).</p>}
      {scouts.length > 0 && <div className="lbl"><span>Scouts out</span></div>}
      {scouts.map(a => <div key={a.id} className="sit-row"><span><Icon k={a.scout === 'patrol' ? 'patrol' : 'recon'} size={14} /> <b>{a.scout === 'patrol' ? 'Patrol' : 'Flight'} → {W.regions[a.to].name}</b> <small>{Math.ceil((1 - a.t) * a.dur)} s</small></span></div>)}
      <div className="lbl"><span>Borders we know too little about</span><small>worst first</small></div>
      {blind.length ? blind.map(({ b, age }) => (
        <div key={b.region + '|' + b.sector} className="sit-row">
          <span><b>{W.regions[b.nb].name}</b> <small>{FACTIONS[b.foe]?.short ?? '?'} · facing {W.regions[b.region].name} · {age === Infinity ? 'no report' : `report ${age} days old`}</small></span>
          <button className="btn sm" disabled={sup < COST.patrol} title={`Cavalry patrol over this border · ${COST.patrol} Production`} onClick={() => ui().order({ t: 'patrol', from: b.region, to: b.nb })}>Patrol · {COST.patrol}</button>
        </div>
      )) : <p className="note">{t('We have fresh reports on every hostile border.')}</p>}
      {reports.length > 0 && <div className="lbl"><span>{t('Latest reports')}</span></div>}
      {reports.map(r => (
        <button key={r.id} className="sit-row" onClick={() => go(r.id)}><span><b>{nm(W.regions[r.id].name)}</b> <small>{nm(FACTIONS[r.owner].short)} · {t('{0} days old', g.day - (r.seen ?? g.day))} · {t('{0} formations seen', groundUnits(r.units))}{r.cs?.some(c => c.p >= 0) ? ' · ' + tn('corps on {0}', { raw: r.cs.filter(c => c.p >= 0).map(c => tx(borderLabel(W, c.p))).slice(0, 2).join(', ') }) : ''}</small></span><span className="go">{t('Go')}</span></button>
      ))}
    </Shell>
  );
}
