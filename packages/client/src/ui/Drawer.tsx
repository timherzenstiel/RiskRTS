// Right-hand region file: header, fronts, intelligence, garrison, works, and (for own regions) Recruit / Build / Fortify / March tabs.
import { AIR_RANGE, CONT, COST, DT, FACTIONS, FORMATION, UNIT_TYPES, UT, battleCounts, buildWorld, hops, maxTrench, unitPower, worksAt, type Battle, type GameState } from '@riskrts/shared';
import { useSim, useUi, dateStr, type Tab } from '../game/store';
import { click } from './actions';
import { CloseIcon, Icon, SupplyIcon } from './icons';
import { rendererRef } from './refs';
import { AttackBudget, BuildTab, FortifyTab, MarchTab, RecruitTab, SharePicker, NeighbourRow, knownTroops, reportAge } from './DrawerTabs';
import { forceOf } from './garrison';
import { menOf, menStr, strengthOf } from './format';

const TABS: [Tab, string][] = [['rec', 'Recruit'], ['build', 'Build'], ['fort', 'Fortify'], ['march', 'March']];
const roman = (n: number) => ['', 'I', 'II', 'III'][n] ?? '';

/** One line per front: where the attack comes from, who is left, morale, and (for the defender) a reserves button. */
function Fronts({ g, me, fronts, own }: { g: GameState; me: number; fronts: Battle[]; own: boolean }) {
  const W = buildWorld(), ui = useUi.getState;
  return (
    <div className="alert fronts">
      <span><b>{fronts.length > 1 ? `${fronts.length} fronts` : 'Battle in progress'}</b></span>
      {fronts.map(b => {
        const cnt = battleCounts(b), mine = cnt.get(me)?.[0] ?? 0, foe = [...cnt].reduce((s, [f, c]) => s + (f === me ? 0 : c[0]), 0);
        const mor = b.mor?.[me], quiet = b.age - (b.lastJoin ?? 0) > 60;
        const where = b.from >= 0 ? `${W.regions[b.from].name} border` : 'Inside the region';
        return (
          <div className="front" key={b.id}>
            <span className="fl"><b>{where}</b><small>{b.sides.includes(me) ? `ours ${mine} · enemy ${foe}` : `${foe + mine} engaged`}{mor !== undefined ? ` · morale ${Math.round(mor)}%` : ''}{quiet ? ' · trench warfare' : ''}{b.tr ? ` · trench ${roman(b.tr)}` : ''}{b.wire > 0 ? ' · wire' : ''}</small></span>
            {own && fronts.length > 1 && b.def === me && <button className="btn sm" title="Move about a third of the defenders of the other fronts here" onClick={() => { click(); ui().order({ t: 'shift', region: b.region, battle: b.id }); }}>Reserves</button>}
            <button className="btn sm" onClick={() => { click(); rendererRef.current?.flyToBattle(b.id, 6); }}>Watch</button>
          </div>
        );
      })}
    </div>
  );
}

export function Drawer() {
  const sim = useSim(); const sel = useUi(s => s.sel); const tab = useUi(s => s.tab);
  if (!sim || sel < 0) return null;
  const { g, me } = sim; const W = buildWorld(); const wr = W.regions[sel]; const r = g.regions[sel];
  const own = r.owner === me; const F = FACTIONS[r.owner]; const ui = useUi.getState;
  const vis = own ? 3 : r.vis ?? 3, known = vis >= 3 || vis === 2;
  const { u: gar, m: men } = forceOf(g, r);
  const myNb = wr.adj.filter(i => g.regions[i].owner === me);
  const fronts = g.battles.filter(b => b.region === sel && !b.ended);
  const defPow = r.defs.filter(d => d.f === r.owner).reduce((s, d) => s + DT[d.k].power * d.hp / DT[d.k].hp, 0);
  const holdF = r.contested >= 0 ? FACTIONS[r.contested] : null, nHold = r.defs.filter(d => d.f !== r.owner).length;
  const airBases = g.regions.filter(x => x.owner === me && x.units.plane > 0 && x.battle < 0 && hops(x.id, sel, AIR_RANGE) <= AIR_RANGE && x.id !== sel);
  const recBases = g.regions.filter(x => x.owner === me && x.airfield && x.contested < 0 && hops(x.id, sel, AIR_RANGE) <= AIR_RANGE && x.id !== sel);
  const capital = g.regions.find(x => x.capitalOf === me && x.owner === me), supply = g.factions[me].supply;
  const spies = g.spies.filter(s => s.f === me), spyHere = spies.find(s => s.region === sel);
  const str = strengthOf(gar, men);
  // what is known of the defences, border by border (for foreign regions)
  const borders = !own ? wr.adj.map(n => ({ n, w: worksAt(r, n), d: r.defs.filter(d => d.s === n && d.f === r.owner) })).filter(x => x.w.tr || x.w.sand || x.w.wire || x.d.length) : [];

  return (
    <aside id="drawer" className="glass" aria-label={`${wr.name} region file`}>
      <div className="dh" style={{ '--c': F.color } as React.CSSProperties}>
        <div className="dh-row"><small>{CONT[wr.cont].name} · bonus +{CONT[wr.cont].bonus}</small>
          <button className="x" aria-label="Close region file" onClick={() => ui().select(-1)}><CloseIcon /></button></div>
        <h2>{wr.name}</h2>
        <div className="owner"><span>{F.name}</span>{r.capitalOf >= 0 && <span className="badge">{r.capitalOf === r.owner ? 'Capital' : 'Captured capital'}</span>}</div>
      </div>
      {fronts.length > 0 && <Fronts g={g} me={me} fronts={fronts} own={own} />}
      {holdF && (
        <div className="alert hold"><span><b>Contested</b> · {nHold} {holdF.short} defence{nHold === 1 ? '' : 's'} still hold{nHold === 1 ? 's' : ''} out{own ? '. No supply, recruiting or building until they fall' : r.contested === me ? '. Our men fight on' : ''}.</span>
          {own && r.battle < 0 && <button className="btn sm" onClick={() => { click(); ui().assault(sel); }}>Storm holdouts</button>}</div>
      )}
      {own && r.cut && <div className="alert hold"><span><b>Cut off</b> · no route through our regions to the capital, a factory or home territory. No income or recruiting; the garrison loses strength and morale every convoy.</span></div>}
      {!own && (
        <div className={'intel v' + vis}>
          <span><b>{vis >= 3 ? (r.spied ? 'Our agent reports' : 'In full view') : vis === 2 ? 'Reconnaissance report' : vis === 1 ? 'Observed across the border' : 'No intelligence'}</b>
            {' · '}{vis === 2 && r.seen !== undefined ? `${dateStr(r.seen)} (${reportAge(g, r).replace('report: ', '')})` : knownTroops(r, false)}</span>
          {vis < 3 && <small>{vis === 1 ? 'Buildings and the defences of other borders are unknown.' : 'Send a patrol, a reconnaissance flight or a spy.'}</small>}
        </div>
      )}
      <div className="gar">
        {UNIT_TYPES.map(k => <div className="gt" key={k} title={`${UT[k].name} · ${FORMATION[k].kit}`}><Icon k={k} /><b>{known ? gar[k] : '?'}</b><small>{UT[k].short}</small></div>)}
      </div>
      <div className="works">
        {own || known ? (
          <>
            <span className={'wk' + (r.factory ? '' : ' off')}>Factory</span>
            <span className={'wk' + (r.barracks ? '' : ' off')}>Barracks</span>
            <span className={'wk' + (r.airfield ? '' : ' off')}>Airfield</span>
          </>
        ) : <span className="wk off">Buildings unknown</span>}
        <span className={'wk' + (maxTrench(r) ? '' : ' off')}>{maxTrench(r) ? `Trench up to ${roman(maxTrench(r))}` : own || vis >= 3 ? 'No trench' : 'No trench seen'}</span>
        {(() => { const n = r.defs.filter(d => d.f === r.owner).length; return <span className={'wk' + (n ? '' : ' off')}>{n} defence{n === 1 ? '' : 's'}{!own && vis < 3 ? ' known' : ''}</span>; })()}
      </div>
      {(own || known) && (
        <div className="works str-row">
          <span className="str">Men <b>{menStr(menOf(men))}</b></span>
          <span className="str">Strength <b>{Math.round(str * 100)}%</b></span>
          {own && <span className="str">Morale <b>{Math.round(r.mor)}%</b></span>}
          <span className="str">Power <b>{Math.round(unitPower(gar) * (.3 + .7 * str) + defPow)}</b></span>
        </div>
      )}
      {borders.length > 0 && (
        <div className="pad borders">
          {borders.map(({ n, w, d }) => (
            <small key={n}><b>Facing {W.regions[n].name}:</b> {[w.tr ? `trench ${roman(w.tr)}` : '', w.sand ? 'sandbags' : '', w.wire ? `wire ${roman(w.wire)}` : '', ...d.map(x => DT[x.k].name)].filter(Boolean).join(', ')}</small>
          ))}
        </div>
      )}

      {own ? (
        <>
          <div className="tabs" role="tablist" aria-label="Orders">
            {TABS.map(([k, l]) => <button key={k} role="tab" className="tab" aria-selected={tab === k} onClick={() => { click(); ui().setTab(k); }}>{l}</button>)}
          </div>
          <div className="tb-body" role="tabpanel">
            {tab === 'rec' && <RecruitTab region={r} id={sel} />}
            {tab === 'build' && <BuildTab region={r} id={sel} />}
            {tab === 'fort' && <FortifyTab region={r} id={sel} />}
            {tab === 'march' && <MarchTab region={r} id={sel} />}
          </div>
        </>
      ) : (
        <div className="tb-body">
          {(myNb.length > 0 || airBases.length > 0) && <><AttackBudget /><SharePicker /></>}
          {myNb.length > 0 && <div className="lbl"><span>Attack from</span></div>}
          {myNb.map(i => <NeighbourRow key={i} from={i} to={sel} list={i} label="Attack" />)}
          {airBases.length > 0 && <div className="lbl"><span>Air strike from</span></div>}
          {airBases.map(x => (
            <div className="it nb" key={x.id}>
              <i className="dot" style={{ '--c': FACTIONS[me].color } as React.CSSProperties} />
              <div className="tx"><b>{W.regions[x.id].name}</b><small>{x.units.plane} squadron{x.units.plane === 1 ? '' : 's'} · {hops(x.id, sel)} border{hops(x.id, sel) > 1 ? 's' : ''} away</small></div>
              <button className="buy atk" onClick={() => ui().air(x.id, sel)}>Strike</button>
            </div>
          ))}
          <div className="lbl"><span>Reconnaissance · {reportAge(g, r)}</span></div>
          {myNb.map(i => (
            <div className="it nb" key={'p' + i}>
              <span className="ic"><Icon k="patrol" size={18} /></span>
              <div className="tx"><b>Cavalry patrol from {W.regions[i].name}</b><small>Troops here and the defences of that border</small></div>
              <button className="buy plain" disabled={supply < COST.patrol} onClick={() => ui().order({ t: 'patrol', from: i, to: sel })}><SupplyIcon />{COST.patrol}</button>
            </div>
          ))}
          {recBases.slice(0, 3).map(x => (
            <div className="it nb" key={'r' + x.id}>
              <span className="ic"><Icon k="recon" size={18} /></span>
              <div className="tx"><b>Recon flight from {W.regions[x.id].name}</b><small>Troops, buildings and every border · anti-air may shoot it down</small></div>
              <button className="buy plain" disabled={supply < COST.recon} onClick={() => ui().order({ t: 'recon', from: x.id, to: sel })}><SupplyIcon />{COST.recon}</button>
            </div>
          ))}
          <div className="it nb">
            <span className="ic"><Icon k="spy" size={18} /></span>
            <div className="tx"><b>{spyHere ? (spyHere.eta > g.time ? 'Our agent is on the way' : 'Our agent works here') : 'Send a spy from the capital'}</b>
              <small>{spyHere ? 'Reports everything until unmasked' : capital ? `Watches everything here until caught · ${spies.length}/3 agents in the field` : 'Our capital has fallen: no spies can be trained'}</small></div>
            {!spyHere && <button className="buy plain" disabled={!capital || supply < COST.spy || spies.length >= 3} onClick={() => ui().order({ t: 'spy', to: sel })}><SupplyIcon />{COST.spy}</button>}
          </div>
          {!myNb.length && !airBases.length && <p className="note">None of your regions border {wr.name}. Infantry and tanks need a direct border (or a sea lane); aircraft reach two borders.</p>}
        </div>
      )}
    </aside>
  );
}
