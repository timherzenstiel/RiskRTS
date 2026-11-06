// Region card in the War Office sidebar: header, fronts, intelligence, garrison, works, and (for own regions) the Overview, Recruit
// and Build tabs. Border works live on the border card; nation-wide business in the left panels (design-command §5).
import { useState } from 'react';
import { WEATHER, TREATY_NAMES, railOpen, railsOf, weatherAt, activeSpies, techOn, treatyOf } from '@riskrts/shared';
import { AIR_RANGE, CONT, COST, DT, FACTIONS, FORMATION, STANCES, UNIT_TYPES, UT, battleCounts, buildWorld, hops, maxTrench, unitPower, worksAt, type Battle, type GameState, type Stance } from '@riskrts/shared';
import { useSim, useUi, dateStr, type Tab } from '../game/store';
import { click } from './actions';
import { Sfx } from '../audio/sfx';
import { CloseIcon, Icon, SupplyIcon } from './icons';
import { rendererRef } from './refs';
import { AirSection, AttackBudget, BuildTab, Feints, GoalPicker, ReconSection, RecruitTab, SharePicker, NeighbourRow, knownTroops, reportAge } from './DrawerTabs';
import { forceOf } from './garrison';
import { menOf, menStr, nm, strengthOf } from './format';
import { t, tx } from '../i18n';
import { FrontControls } from './FrontCard';
import { Briefing } from './Briefing';
import { DeployTab, corpsState, unitsLine } from './DeployTab';
import { borderLabel, groupName } from '@riskrts/shared';
import { CarrierRows, LandingRows, NavyTab } from './Navy';

const TABS: [Tab, string][] = [['over', 'Overview'], ['rec', 'Recruit'], ['build', 'Build']];
const roman = (n: number) => ['', 'I', 'II', 'III'][n] ?? '';

/** One line per front: where the attack comes from, who is left, morale, and (for the defender) a reserves button. */
function Fronts({ g, me, fronts, own }: { g: GameState; me: number; fronts: Battle[]; own: boolean }) {
  const W = buildWorld(), ui = useUi.getState;
  const mineF = fronts.filter(b => b.def === me || b.sides.includes(me));
  const [open, setOpen] = useState<number | null>(null);
  const shown = open ?? (mineF.length === 1 ? mineF[0].id : null);
  return (
    <div className="alert fronts">
      <span><b>{fronts.length > 1 ? t('{0} fronts', fronts.length) : t('Battle in progress')}</b></span>
      {fronts.map(b => {
        const cnt = battleCounts(b), mine = cnt.get(me)?.[0] ?? 0, foe = [...cnt].reduce((s, [f, c]) => s + (f === me ? 0 : c[0]), 0);
        const mor = b.mor?.[me], quiet = b.age - (b.lastJoin ?? 0) > 60;
        const where = tx(borderLabel(W, b.from)) + (b.amph !== undefined && (b.stage ?? 0) === 0 ? ' · ' + t('landing') : '');
        return (
          <div className="front" key={b.id}>
            <span className="fl"><b>{where}</b><small>{b.sides.includes(me) ? t('ours {0} · enemy {1}', mine, foe) : t('{0} engaged', foe + mine)}{mor !== undefined ? ' · ' + t('morale {0}%', Math.round(mor)) : ''}{quiet ? ' · ' + t('trench warfare') : ''}{b.tr ? ' · ' + t('trench {0}', roman(b.tr)) : ''}{b.wire > 0 ? ' · ' + t('wire') : ''}</small></span>
            {own && fronts.length > 1 && b.def === me && <button className="btn sm" title={t('Move about a third of the defenders of the other fronts here')} onClick={() => { click(); ui().order({ t: 'shift', region: b.region, battle: b.id }); }}>{t('Reserves')}</button>}
            {(b.def === me || b.sides.includes(me)) && mineF.length > 1 && <button className="btn sm" aria-expanded={shown === b.id} onClick={() => { click(); setOpen(shown === b.id ? -1 : b.id); }}>{t('Orders')}</button>}
            <button className="btn sm" onClick={() => { click(); rendererRef.current?.flyToBattle(b.id, 6); }}>{t('Watch')}</button>
            {shown === b.id && <FrontControls g={g} me={me} b={b} compact />}
          </div>
        );
      })}
    </div>
  );
}

/** Touch screens have no right-click: march on a region picked on the map. */
function PickTarget({ region }: { region: { battle: number; units: { inf: number; mg: number; art: number; tank: number; plane: number } } }) {
  const orderMode = useUi(s => s.orderMode); const kind = useUi(s => s.orderKind), active = orderMode && kind === 'march';
  const ground = region.units.inf + region.units.mg + region.units.art + region.units.tank;
  return (
    <button className="btn sm wide pick-target" aria-pressed={active} disabled={region.battle >= 0 || ground < 2}
      onClick={() => { click(); const u = useUi.getState(); if (active) u.cancelOrder(); else u.beginOrder('march'); }}>
      {active ? t('Cancel · pick a target on the map') : t('Pick a target on the map')}
    </button>
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
  const borders = !own ? wr.sectors.map(n => ({ n, w: worksAt(r, n), d: r.defs.filter(d => d.s === n && d.f === r.owner) })).filter(x => x.w.tr || x.w.sand || x.w.wire || x.d.length) : [];

  return (
    <section id="drawer" aria-label={t('{0} region file', wr.name)}>
      <div className="dh" style={{ '--c': F.color } as React.CSSProperties}>
        <div className="dh-row"><small>{tx(CONT[wr.cont].name)} · {t('bonus +{0}', CONT[wr.cont].bonus)}</small>
          <button className="x" aria-label={t('Close region file')} onClick={() => ui().select(-1)}><CloseIcon /></button></div>
        <h2>{nm(wr.name)}</h2>
        <div className="owner"><span>{nm(F.name)}</span>{r.capitalOf >= 0 && <span className="badge">{r.capitalOf === r.owner ? t('Capital') : t('Captured capital')}</span>}
          {(() => { const w = weatherAt(sel, g.day); return w ? <span className={'badge wx w' + w}>{tx(WEATHER[w])}</span> : null; })()}</div>
      </div>
      {fronts.length > 0 && <Fronts g={g} me={me} fronts={fronts} own={own} />}
      {holdF && (
        <div className="alert hold"><span><b>{t('Contested')}</b> · {nHold === 1 ? t('{0} {1} defence still holds out', nHold, holdF.short) : t('{0} {1} defences still hold out', nHold, holdF.short)}{own ? '. ' + t('No supply, recruiting or building until they fall') : r.contested === me ? '. ' + t('Our men fight on') : ''}.</span>
          {own && r.battle < 0 && <button className="btn sm" onClick={() => { click(); ui().assault(sel); }}>{t('Storm holdouts')}</button>}</div>
      )}
      {own && r.strike && <div className="alert hold"><span><b>{t('On strike')}</b> · {t('the war-weary workers have downed tools. No supply, shells or recruits from here until the war weariness eases.')}</span></div>}
      {own && r.cut && <div className="alert hold"><span><b>{t('Cut off')}</b> · {t('no route through our regions to the capital, a factory or home territory. No income or recruiting; the garrison loses strength and morale every convoy.')}</span></div>}
      {!own && (
        <div className={'intel v' + vis}>
          <span><b>{vis >= 3 ? (r.spied ? t('Our agent reports') : t('In full view')) : vis === 2 ? t('Reconnaissance report') : vis === 1 ? t('Observed across the border') : t('No intelligence')}</b>
            {' · '}{vis === 2 && r.seen !== undefined ? `${(dateStr(r.seen))} (${reportAge(g, r, true)})` : knownTroops(r, false)}</span>
          {vis < 3 && <small>{vis === 1 ? t('Buildings and the defences of other borders are unknown.') : t('Send a patrol, a reconnaissance flight or a spy.')}</small>}
        </div>
      )}
      <div className="gar">
        {UNIT_TYPES.map(k => <div className="gt" key={k} title={`${tx(UT[k].name)} · ${tx(FORMATION[k].kit)}`}><Icon k={k} /><b>{known ? gar[k] : '?'}</b><small>{tx(UT[k].short)}</small></div>)}
      </div>
      <div className="works">
        {own || known ? (
          <>
            <span className={'wk' + (r.factory ? '' : ' off')}>{t('Factory')}</span>
            <span className={'wk' + (r.barracks ? '' : ' off')}>{t('Barracks')}</span>
            <span className={'wk' + (r.airfield ? '' : ' off')}>{t('Airfield')}</span>
          </>
        ) : <span className="wk off">{t('Buildings unknown')}</span>}
        {own && <span className={'wk' + (r.supplyQ === 2 ? '' : ' off')} title={t('Full supply: an unbroken rail line to the capital, a factory or home territory. Thin supply (land or sea only): shells cost half again, half the wounded return.')}>{r.cut ? t('Cut off') : r.supplyQ === 1 ? t('Thin supply') : t('Full supply')}</span>}
        {(() => { const rl = railsOf(g, sel); return rl.length ? <span className="wk rail" title={rl.map(([n, o]) => `${nm(W.regions[n].name)}${o ? '' : ' ' + t('(cut)')}`).join(', ')}>{t('Rail · {0}', rl.length)}{rl.some(x => !x[1]) ? ' ' + t('({0} cut)', rl.filter(x => !x[1]).length) : ''}</span> : <span className="wk off">{t('No railway')}</span>; })()}
        <span className={'wk' + (maxTrench(r) ? '' : ' off')}>{maxTrench(r) ? t('Trench up to {0}', roman(maxTrench(r))) : own || vis >= 3 ? t('No trench') : t('No trench seen')}</span>
        {(() => { const n = r.defs.filter(d => d.f === r.owner).length; return <span className={'wk' + (n ? '' : ' off')}>{n === 1 ? t('{0} defence', n) : t('{0} defences', n)}{!own && vis < 3 ? ' ' + t('known') : ''}</span>; })()}
      </div>
      {(own || known) && (
        <div className="works str-row">
          <span className="str">{t('Men')} <b>{menStr(menOf(men))}</b></span>
          <span className="str">{t('Strength')} <b>{Math.round(str * 100)}%</b></span>
          {own && <span className="str">{t('Morale')} <b>{Math.round(r.mor)}%</b></span>}
          <span className="str">{t('strength|Power')} <b>{Math.round(unitPower(gar) * (.3 + .7 * str) + defPow)}</b></span>
        </div>
      )}
      {own && (
        <div className="stance-row">
          <span className="lv-l" title={t('How the garrison fights when attacked; armies marching out take the stance with them')}>{t('Stance')}</span>
          <div className="seg" role="group" aria-label={t('Garrison stance')}>
            {STANCES.map((n, i) => <button key={n} aria-pressed={(r.stance ?? 0) === i} title={tx(n)} onClick={() => { click(); ui().order({ t: 'stance', region: sel, s: i as Stance }); }}>{[t('Balanced'), t('Aggressive'), t('Defensive'), t('Hold')][i]}</button>)}
          </div>
        </div>
      )}
      {!own && r.cs && r.cs.length > 0 && (
        <div className="pad borders corps-seen">
          {r.cs.map(c => (
            <small key={c.id}><b>{c.p < 0 ? t('{0} in the centre:', c.n > 0 ? groupName(r.owner, 1, c.n) : 'Troops') : t('{0} on the {1}:', c.n > 0 ? groupName(r.owner, 1, c.n) : 'Troops', borderLabel(W, c.p).replace(' border', '') + (c.p >= 1000 ? '' : ' border'))}</b> {c.est ? t('est. {0}–{1} men', menStr(c.est[0]), menStr(c.est[1])) : unitsLine(c.u)}{(c.ord ?? 0) >= 1 ? ' · ' + t('massing for an attack') : c.n > 0 ? ` · ${corpsState(g, c)}` : ''}</small>
          ))}
        </div>
      )}
      {borders.length > 0 && (
        <div className="pad borders">
          {borders.map(({ n, w, d }) => (
            <small key={n}><b>{n >= 1000 ? t('On the {0}:', borderLabel(W, n)) : t('Facing {0}:', W.regions[n].name)}</b> {[w.tr ? t('trench {0}', roman(w.tr)) : '', w.sand ? t('sandbags') : '', w.wire ? t('wire {0}', roman(w.wire)) : '', ...d.map(x => tx(DT[x.k].name))].filter(Boolean).join(', ')}</small>
          ))}
        </div>
      )}

      {own ? (
        <>
          <div className="tabs" role="tablist" aria-label={t('Region')}>
            {TABS.map(([k, l]) => <button key={k} role="tab" className="tab" aria-selected={tab === k} onClick={() => { Sfx.clunk(); ui().setTab(k); }}>{t(l)}</button>)}
          </div>
          <div className="tb-body" role="tabpanel">
            {tab === 'over' && (
              <>
                <DeployTab region={r} id={sel} />
                <div className="lbl"><span>{t('Operations from {0}', wr.name)}</span></div>
                <AttackBudget />
                <GoalPicker />
                <PickTarget region={r} />
                <p className="note">{t('With nothing but this region selected, right-click a neighbour to march the share above there, or attack it (the troops form up, move to the border, assemble and go in). With corps selected, right-click moves or attacks with them.')}</p>
                <AirSection region={r} id={sel} />
                <ReconSection region={r} id={sel} />
                <Feints region={r} id={sel} />
              </>
            )}
            {tab === 'rec' && <RecruitTab region={r} id={sel} />}
            {tab === 'build' && (
              <>
                <BuildTab region={r} id={sel} />
                {wr.zones.length > 0 && <><div className="lbl"><span>{t('Harbour')}</span></div><NavyTab region={r} id={sel} /></>}
              </>
            )}
          </div>
        </>
      ) : (
        <div className="tb-body">
          {(myNb.length > 0 || airBases.length > 0) && <><AttackBudget /><SharePicker /></>}
          {myNb.length > 0 && <Briefing g={g} me={me} target={sel} from={myNb} />}
          {myNb.length > 0 && <div className="lbl"><span>{t('Attack from')}</span></div>}
          {(() => { const tr = treatyOf(g, me, r.owner); return tr ? <p className="note budget full">{t('{0} with {1}. Attacking breaks it: war weariness and lost trust.', TREATY_NAMES[tr.kind], F.name)}</p> : null; })()}
          {myNb.map(i => <NeighbourRow key={i} from={i} to={sel} list={i} brk={!!treatyOf(g, me, r.owner)} label={treatyOf(g, me, r.owner) ? 'Break treaty' : 'Attack'} />)}
          <LandingRows target={sel} />
          <CarrierRows target={sel} />
          {airBases.length > 0 && <div className="lbl"><span>{t('Air strike from')}</span></div>}
          {airBases.map(x => (
            <div className="it nb" key={x.id}>
              <i className="dot" style={{ '--c': FACTIONS[me].color } as React.CSSProperties} />
              <div className="tx"><b>{nm(W.regions[x.id].name)}</b><small>{x.units.plane === 1 ? t('{0} squadron', 1) : t('{0} squadrons', x.units.plane)} · {hops(x.id, sel) > 1 ? t('{0} borders away', hops(x.id, sel)) : t('{0} border away', hops(x.id, sel))}</small></div>
              <button className="buy atk" onClick={() => treatyOf(g, me, r.owner) ? ui().order({ t: 'air', from: x.id, to: sel, frac: useUi.getState().sendFrac, brk: true }) : ui().air(x.id, sel)}>{treatyOf(g, me, r.owner) ? t('Break & strike') : t('Strike')}</button>
              {r.factory && techOn(g, me, 'bomb') && <button className="buy plain" title={t('Bomb the factory: no supply, shells or tanks from it for three convoys')} onClick={() => ui().order({ t: 'air', from: x.id, to: sel, frac: useUi.getState().sendFrac, factory: true })}>{t('Factory')}</button>}
              {techOn(g, me, 'railAir') && railsOf(g, sel).some(([n]) => railOpen(g, sel, n)) && <button className="buy plain" title={t('Bomb the railways of this region: they stay cut for two convoys')} onClick={() => ui().order({ t: 'air', from: x.id, to: sel, frac: useUi.getState().sendFrac, rail: true })}>{t('Rails')}</button>}
            </div>
          ))}
          <div className="lbl"><span>{t('Reconnaissance')} · {reportAge(g, r)}</span></div>
          {myNb.map(i => (
            <div className="it nb" key={'p' + i}>
              <span className="ic"><Icon k="patrol" size={18} /></span>
              <div className="tx"><b>{t('Cavalry patrol from {0}', W.regions[i].name)}</b><small>{t('Troops here and the defences of that border')}</small></div>
              <button className="buy plain" disabled={supply < COST.patrol} onClick={() => ui().order({ t: 'patrol', from: i, to: sel })}><SupplyIcon />{COST.patrol}</button>
            </div>
          ))}
          {recBases.slice(0, 3).map(x => (
            <div className="it nb" key={'r' + x.id}>
              <span className="ic"><Icon k="recon" size={18} /></span>
              <div className="tx"><b>{t('Recon flight from {0}', W.regions[x.id].name)}</b><small>{t('Troops, buildings and every border · anti-air may shoot it down')}</small></div>
              <button className="buy plain" disabled={supply < COST.recon} onClick={() => ui().order({ t: 'recon', from: x.id, to: sel })}><SupplyIcon />{COST.recon}</button>
            </div>
          ))}
          <div className="it nb">
            <span className="ic"><Icon k="spy" size={18} /></span>
            <div className="tx"><b>{spyHere ? (spyHere.eta > g.time ? t('Our agent is on the way') : t('Our agent works here')) : t('Send a spy from the capital')}</b>
              <small>{spyHere ? t('Reports everything until unmasked') : capital ? t('Watches everything here until caught · {0}/3 agents in the field', spies.length) : t('Our capital has fallen: no spies can be trained')}</small></div>
            {!spyHere && <button className="buy plain" disabled={!capital || supply < COST.spy || spies.length >= 3} onClick={() => ui().order({ t: 'spy', to: sel })}><SupplyIcon />{COST.spy}</button>}
          </div>
          {spyHere && activeSpies(g, me).some(s => s.region === sel) && railsOf(g, sel).filter(([, o]) => o).map(([n]) => (
            <div className="it nb" key={'sab' + n}>
              <span className="ic"><Icon k="spy" size={18} /></span>
              <div className="tx"><b>{t('Sabotage the line to {0}', W.regions[n].name)}</b><small>{t('Cut for three convoys · our agent is twice as likely to be caught for a while')}</small></div>
              <button className="buy atk" onClick={() => ui().order({ t: 'sabotage', region: sel, to: n })}>{t('Blow up')}</button>
            </div>
          ))}
          {!myNb.length && !airBases.length && <p className="note">{t('None of your regions border {0}. Infantry and tanks need a direct border (or a sea lane); aircraft reach two borders.', wr.name)}</p>}
        </div>
      )}
    </section>
  );
}
