// Right-hand region file: header, garrison, works, and (for own regions) Recruit / Build / March tabs.
import { CONT, FACTIONS, UNIT_TYPES, UT, battleCounts, buildWorld, unitPower } from '@riskrts/shared';
import { useSim, useUi, type Tab } from '../game/store';
import { click } from './actions';
import { CloseIcon, Icon } from './icons';
import { rendererRef } from './refs';
import { BuildTab, MarchTab, RecruitTab, SharePicker, NeighbourRow } from './DrawerTabs';
import { garrisonOf } from './garrison';

const TABS: [Tab, string][] = [['rec', 'Recruit'], ['build', 'Build'], ['march', 'March']];

export function Drawer() {
  const sim = useSim(); const sel = useUi(s => s.sel); const tab = useUi(s => s.tab);
  if (!sim || sel < 0) return null;
  const { g, me } = sim; const W = buildWorld(); const wr = W.regions[sel]; const r = g.regions[sel];
  const own = r.owner === me; const F = FACTIONS[r.owner]; const ui = useUi.getState;
  const gar = garrisonOf(g, r);
  const myNb = wr.adj.filter(i => g.regions[i].owner === me);
  const battle = r.battle >= 0 ? g.battles.find(b => b.id === r.battle) : undefined;
  const engaged = battle ? [...battleCounts(battle).values()].reduce((s, [a]) => s + a, 0) : 0;

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
      <div className="gar">
        {UNIT_TYPES.map(k => <div className="gt" key={k} title={UT[k].name}><Icon k={k} /><b>{gar[k]}</b><small>{UT[k].short}</small></div>)}
      </div>
      <div className="works">
        <span className={'wk' + (r.trench ? '' : ' off')}>{r.trench ? `Trench ${'I'.repeat(r.trench)}` : 'No trench'}</span>
        <span className={'wk' + (r.factory ? '' : ' off')}>Factory</span>
        <span className={'wk' + (r.barracks ? '' : ' off')}>Barracks</span>
        <span className="str">Strength <b>{Math.round(unitPower(gar) * (1 + .3 * r.trench))}</b></span>
      </div>

      {own ? (
        <>
          <div className="tabs" role="tablist" aria-label="Orders">
            {TABS.map(([k, l]) => <button key={k} role="tab" className="tab" aria-selected={tab === k} onClick={() => { click(); ui().setTab(k); }}>{l}</button>)}
          </div>
          <div className="tb-body" role="tabpanel">
            {tab === 'rec' && <RecruitTab region={r} id={sel} />}
            {tab === 'build' && <BuildTab region={r} id={sel} />}
            {tab === 'march' && <MarchTab region={r} id={sel} />}
          </div>
        </>
      ) : myNb.length ? (
        <div className="tb-body">
          <SharePicker />
          <div className="lbl"><span>Attack from</span></div>
          {myNb.map(i => <NeighbourRow key={i} from={i} to={sel} list={i} label="Attack" />)}
        </div>
      ) : (
        <div className="pad"><p className="note" style={{ margin: 0 }}>None of your regions border {wr.name}. Take a neighbouring region first, or look for a sea lane.</p></div>
      )}
    </aside>
  );
}

