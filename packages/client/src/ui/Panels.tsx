// Nation-wide panels on the left rail (design-command §5.2): Economy (supply, shells and manpower as ledgers, conscription,
// shell production, supply trouble), Navy (ports and fleets) and Intel (agents, scouts in the air, reports by age, and the
// borders we know too little about).
import {
  COST, FACTIONS, MANPOWER, SHELLS, borderLabel, buildWorld, groundUnits, hostileBorders, income, incomeTerms, poolGrowth, poolTerms, shellIncome, shellTerms,
  SHIP, activeSpies, type GameState, type Term,
} from '@riskrts/shared';
import { useSim, useUi } from '../game/store';
import { click } from './actions';
import { CloseIcon, Icon, SupplyIcon } from './icons';
import { menStr } from './format';
import { rendererRef } from './refs';
import { FleetList } from './Navy';

const MOB = ['Peacetime', 'Extended', 'Total'] as const;
const fmt = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + (Math.abs(v) >= 100 ? Math.round(Math.abs(v)).toLocaleString('en-GB') : String(Math.round(Math.abs(v) * 10) / 10));

function Ledger({ terms, total, unit }: { terms: Term[]; total: number; unit: string }) {
  return (
    <table className="ledger">
      <tbody>
        {terms.map((t, i) => <tr key={i} title={t.note}><td>{t.label}</td><td className={t.v < 0 ? 'neg' : ''}>{fmt(t.v)}</td></tr>)}
        <tr className="sum"><td>Per convoy</td><td>{fmt(total)} {unit}</td></tr>
      </tbody>
    </table>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  const ui = useUi.getState;
  return (
    <section id="panel" className="plate" aria-label={title}>
      <div className="pn-h"><h2>{title}</h2><button className="x" aria-label="Close panel" onClick={() => ui().setPanel(null)}><CloseIcon /></button></div>
      <div className="pn-body">{children}</div>
    </section>
  );
}
const go = (region: number, d = 26) => { click(); useUi.getState().select(region); rendererRef.current?.flyTo(region, d); };

// ---------------------------------------------------------------- economy

export function EconomyPanel() {
  const panel = useUi(s => s.panel); const sim = useSim();
  if (panel !== 'economy' || !sim) return null;
  const { g, me } = sim, f = g.factions[me], W = buildWorld(), ui = useUi.getState, mob = f.mob ?? 0;
  const mine = g.regions.filter(r => r.owner === me), cut = mine.filter(r => r.cut), thin = mine.filter(r => !r.cut && r.supplyQ === 1), strike = mine.filter(r => r.strike);
  const field = mine.reduce((s, r) => s + r.men.inf + r.men.mg + r.men.art + r.men.tank + r.men.plane, 0);
  return (
    <Shell title="Economy">
      <div className="lbl"><span>Supply · {f.supply} in hand</span><small>spent on recruits, works, buildings, scouting</small></div>
      <Ledger terms={incomeTerms(g, me)} total={income(g, me)} unit="supply" />
      <div className="lbl"><span>Shells · {Math.floor(f.shells ?? 0)} in stock</span><small>every gun shot draws on them</small></div>
      <Ledger terms={shellTerms(g, me)} total={shellIncome(g, me)} unit="shells" />
      <div className="it">
        <span className="ic"><Icon k="art" /></span>
        <div className="tx"><b>Buy shells</b><small>1 supply = {SHELLS.perSupply} shells</small></div>
        <div className="buys">
          <button className="buy" disabled={f.supply < 1} onClick={() => ui().order({ t: 'produce', kind: 'shells', n: 1 })}>+{SHELLS.perSupply} <SupplyIcon />1</button>
          <button className="buy five" disabled={f.supply < 5} aria-label={`Buy ${SHELLS.perSupply * 5} shells for 5 supply`} onClick={() => ui().order({ t: 'produce', kind: 'shells', n: 5 })}>×5</button>
        </div>
      </div>
      <div className="lbl"><span>Manpower · {menStr(f.men ?? 0)} in the pool</span><small>{menStr(field)} in the field · {menStr(f.wounded ?? 0)} wounded</small></div>
      <Ledger terms={poolTerms(g, me)} total={poolGrowth(g, me)} unit="men" />
      <div className="lv-row"><span className="lv-l" title={`Each level: +${Math.round(MANPOWER.mobGrowth * 100)} % age class and +${MANPOWER.mobWW} war weariness per convoy`}>Conscription</span>
        <div className="seg" role="group" aria-label="Conscription">
          {MOB.map((m, i) => <button key={m} aria-pressed={mob === i} onClick={() => { click(); ui().order({ t: 'mobilise', level: i }); }}>{m}</button>)}
        </div>
      </div>
      <p className="note">War weariness {Math.round(f.ww)} %. Wounded men come back to under-strength corps with the convoys.</p>
      <div className="lbl"><span>Supply lines</span><small>{mine.length - cut.length - thin.length} by rail · {thin.length} thin · {cut.length} cut off</small></div>
      {[...cut.map(r => [r, 'Cut off: no income, no recruits, the garrison wears down'] as const), ...strike.map(r => [r, 'On strike: pays nothing'] as const), ...thin.slice(0, 6).map(r => [r, 'Thin supply (no rail): shells cost half again'] as const)].map(([r, t]) => (
        <button key={r.id + t} className="sit-row" onClick={() => go(r.id)}><span><b>{W.regions[r.id].name}</b> <small>{t}</small></span><span className="go">Go</span></button>
      ))}
      {!cut.length && !strike.length && !thin.length && <p className="note">Every region is supplied by rail.</p>}
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
      <div className="lbl"><span>Ports · {ports.length}</span><small>ships docked</small></div>
      {ports.map(r => {
        const docked = g.ships.filter(s => s.owner === me && s.port === r.id && s.fleet < 0), kinds = [...new Set(docked.map(s => s.kind))];
        return (
          <button key={r.id} className="sit-row" onClick={() => { go(r.id); ui().setTab('build'); }}>
            <span><b>{W.regions[r.id].name}</b> <small>{docked.length ? kinds.map(k => `${docked.filter(s => s.kind === k).length} ${SHIP[k].many ?? SHIP[k].one}`).join(' · ') : 'no ships'}{r.portAt !== undefined && r.portAt > g.time ? ' · being built' : ''}</small></span><span className="go">Open</span>
          </button>
        );
      })}
      {!ports.length && <p className="note">No ports. Build one in a coastal region (its Build tab).</p>}
      <p className="note">Ships are built, and troops shipped or landed, from a port's Build tab. Click a fleet at sea to give it orders.</p>
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
      <div className="lbl"><span>Agents · {spies.length}/3</span></div>
      {spies.length ? spies.map(s => (
        <button key={s.id} className="sit-row" onClick={() => go(s.region)}><span><Icon k="spy" size={14} /> <b>{W.regions[s.region].name}</b> <small>{working.has(s.id) ? `reporting${(s.hot ?? -1) > g.day ? ' · exposed after sabotage' : ''}` : `on the way · ${Math.ceil(s.eta - g.time)} s`}</small></span><span className="go">Go</span></button>
      )) : <p className="note">No agents in the field. Send one from a foreign region's file or a border card ({COST.spy} supply).</p>}
      {scouts.length > 0 && <div className="lbl"><span>Scouts out</span></div>}
      {scouts.map(a => <div key={a.id} className="sit-row"><span><Icon k={a.scout === 'patrol' ? 'patrol' : 'recon'} size={14} /> <b>{a.scout === 'patrol' ? 'Patrol' : 'Flight'} → {W.regions[a.to].name}</b> <small>{Math.ceil((1 - a.t) * a.dur)} s</small></span></div>)}
      <div className="lbl"><span>Borders we know too little about</span><small>worst first</small></div>
      {blind.length ? blind.map(({ b, age }) => (
        <div key={b.region + '|' + b.sector} className="sit-row">
          <span><b>{W.regions[b.nb].name}</b> <small>{FACTIONS[b.foe]?.short ?? '?'} · facing {W.regions[b.region].name} · {age === Infinity ? 'no report' : `report ${age} days old`}</small></span>
          <button className="btn sm" disabled={sup < COST.patrol} title={`Cavalry patrol over this border · ${COST.patrol} supply`} onClick={() => ui().order({ t: 'patrol', from: b.region, to: b.nb })}>Patrol · {COST.patrol}</button>
        </div>
      )) : <p className="note">We have fresh reports on every hostile border.</p>}
      {reports.length > 0 && <div className="lbl"><span>Latest reports</span></div>}
      {reports.map(r => (
        <button key={r.id} className="sit-row" onClick={() => go(r.id)}><span><b>{W.regions[r.id].name}</b> <small>{FACTIONS[r.owner].short} · {g.day - (r.seen ?? g.day)} days old · {groundUnits(r.units)} formations seen{r.cs?.some(c => c.p >= 0) ? ` · corps on ${r.cs.filter(c => c.p >= 0).map(c => borderLabel(W, c.p)).slice(0, 2).join(', ')}` : ''}</small></span><span className="go">Go</span></button>
      ))}
    </Shell>
  );
}
