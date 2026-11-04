// Right-hand region file: header, garrison, works, and (for own regions) Recruit / Build / March tabs.
import { AIR_RANGE, CONT, DT, FACTIONS, UNIT_TYPES, UT, battleCounts, buildWorld, hops, unitPower } from '@riskrts/shared';
import { useSim, useUi, type Tab } from '../game/store';
import { click } from './actions';
import { CloseIcon, Icon } from './icons';
import { rendererRef } from './refs';
import { AttackBudget, BuildTab, FortifyTab, MarchTab, RecruitTab, SharePicker, NeighbourRow } from './DrawerTabs';
import { garrisonOf } from './garrison';

const TABS: [Tab, string][] = [['rec', 'Recruit'], ['build', 'Build'], ['fort', 'Fortify'], ['march', 'March']];

export function Drawer() {
  const sim = useSim(); const sel = useUi(s => s.sel); const tab = useUi(s => s.tab);
  if (!sim || sel < 0) return null;
  const { g, me } = sim; const W = buildWorld(); const wr = W.regions[sel]; const r = g.regions[sel];
  const own = r.owner === me; const F = FACTIONS[r.owner]; const ui = useUi.getState;
  const gar = garrisonOf(g, r);
  const myNb = wr.adj.filter(i => g.regions[i].owner === me);
  const battle = r.battle >= 0 ? g.battles.find(b => b.id === r.battle) : undefined;
  const engaged = battle ? [...battleCounts(battle).values()].reduce((s, [a]) => s + a, 0) : 0;
  const defPow = r.defs.filter(d => d.f === r.owner).reduce((s, d) => s + DT[d.k].power * d.hp / DT[d.k].hp, 0);
  const holdF = r.contested >= 0 ? FACTIONS[r.contested] : null, nHold = r.defs.filter(d => d.f !== r.owner).length;
  const airBases = g.regions.filter(x => x.owner === me && x.units.plane > 0 && x.battle < 0 && hops(x.id, sel, AIR_RANGE) <= AIR_RANGE && x.id !== sel);

  return (
    <aside id="drawer" className="glass" aria-label={`${wr.name} region file`}>
      <div className="dh" style={{ '--c': F.color } as React.CSSProperties}>
        <div className="dh-row"><small>{CONT[wr.cont].name} · bonus +{CONT[wr.cont].bonus}</small>
          <button className="x" aria-label="Close region file" onClick={() => ui().select(-1)}><CloseIcon /></button></div>
        <h2>{wr.name}</h2>
        <div className="owner"><span>{F.name}</span>{r.capitalOf >= 0 && <span className="badge">{r.capitalOf === r.owner ? 'Capital' : 'Captured capital'}</span>}</div>
      </div>
      {battle && (
        <div className="alert"><span><b>Battle in progress</b> · {engaged} engaged</span>
          <button className="btn sm" onClick={() => { click(); rendererRef.current?.flyTo(sel, 6); }}>Watch</button></div>
      )}
      {holdF && (
        <div className="alert hold"><span><b>Contested</b> · {nHold} {holdF.short} defence{nHold === 1 ? '' : 's'} still hold{nHold === 1 ? 's' : ''} out{own ? '. No supply, recruiting or building until they fall' : r.contested === me ? '. Our men fight on' : ''}.</span>
          {own && r.battle < 0 && <button className="btn sm" onClick={() => { click(); ui().assault(sel); }}>Storm holdouts</button>}</div>
      )}
      <div className="gar">
        {UNIT_TYPES.map(k => <div className="gt" key={k} title={UT[k].name}><Icon k={k} /><b>{gar[k]}</b><small>{UT[k].short}</small></div>)}
      </div>
      <div className="works">
        <span className={'wk' + (r.trench ? '' : ' off')}>{r.trench ? `Trench ${'I'.repeat(r.trench)}` : 'No trench'}</span>
        <span className={'wk' + (r.factory ? '' : ' off')}>Factory</span>
        <span className={'wk' + (r.barracks ? '' : ' off')}>Barracks</span>
        <span className={'wk' + (r.airfield ? '' : ' off')}>Airfield</span>
        <span className={'wk' + (r.defs.length ? '' : ' off')}>{r.defs.filter(d => d.f === r.owner).length} defences</span>
        <span className="str">Strength <b>{Math.round(unitPower(gar) * (1 + .3 * r.trench) + defPow)}</b></span>
      </div>

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
      ) : myNb.length || airBases.length ? (
        <div className="tb-body">
          <AttackBudget />
          <SharePicker />
          {myNb.length > 0 && <div className="lbl"><span>Attack from</span></div>}
          {myNb.map(i => <NeighbourRow key={i} from={i} to={sel} list={i} label="Attack" />)}
          {airBases.length > 0 && <div className="lbl"><span>Air strike from</span></div>}
          {airBases.map(x => (
            <div className="it nb" key={x.id}>
              <i className="dot" style={{ '--c': FACTIONS[me].color } as React.CSSProperties} />
              <div className="tx"><b>{W.regions[x.id].name}</b><small>{x.units.plane} aircraft · {hops(x.id, sel)} border{hops(x.id, sel) > 1 ? 's' : ''} away</small></div>
              <button className="buy atk" onClick={() => ui().air(x.id, sel)}>Strike</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="pad"><p className="note" style={{ margin: 0 }}>None of your regions border {wr.name}. Infantry and tanks need a direct border (or a sea lane); aircraft reach two borders.</p></div>
      )}
    </aside>
  );
}

