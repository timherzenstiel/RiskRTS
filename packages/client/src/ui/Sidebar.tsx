// The War Office sidebar, docked on the right: radar (minimap) with the map layers under it, the selected region's
// file (header, tabs, cameo grids), and a supply gauge along the inner edge. On phones it becomes a bottom tray.
import { FleetList } from './Navy';
import { FACTIONS, TICK_SECONDS, buildWorld, convoyIn, income, sectorName } from '@riskrts/shared';
import { MAP_MODES, useSim, useUi, type MapMode } from '../game/store';
import { BANDS, bandOf } from '../render/camera';
import { click } from './actions';
import { Sfx } from '../audio/sfx';
import { Drawer } from './Drawer';
import { Minimap } from './Minimap';
import { BorderCard } from './Situation';
import { CorpsCard } from './Forces';
import { ArmyCard } from './Staff';
import { rendererRef } from './refs';
import { getLang, t, tx } from '../i18n';

/** Zoom band names (render/camera) in the interface language. */
const bandName = (i: number, n: string) => getLang() === 'de' ? ['Übersicht', 'Front', 'Gefecht', 'Nah'][i] ?? n : n;
/** Short map mode labels (game/store MAP_MODES) in the interface language. */
const modeShort = (i: number, n: string) => getLang() === 'de' ? ['Pol.', 'Fronten', 'Truppen', 'Nachsch.', 'Aufkl.'][i] ?? n : n;

/** Map mode (design-command §1): political, fronts, forces, supply, intel. The same mode again goes back to the political map. */
export function LayerPicker() {
  const mode = useUi(s => s.mode), set = useUi.getState().setMode;
  return (
    <div className="seg layer-seg mode-seg" role="group" aria-label={t('Map mode')}>
      {MAP_MODES.map((m, i) => (
        <button key={m.name} aria-pressed={mode === i} title={`${t(m.name)}: ${t(m.hint)} (${m.key.toUpperCase()})`} onClick={() => { click(); set(mode === i && i ? 0 : i as MapMode); }}>{modeShort(i, m.short)}<kbd>{m.key.toUpperCase()}</kbd></button>
      ))}
    </div>
  );
}

/** Zoom bands: theatre, front, battle, close (keys Z X C V). Lights the band the camera is in. */
function ZoomPicker() {
  useSim(); // re-render with the game clock so the lit band follows the wheel
  const d = rendererRef.current?.cameraDistance() ?? 55, cur = bandOf(d);
  return (
    <div className="seg zoom-seg" role="group" aria-label={t('Zoom')}>
      {BANDS.map((b, i) => <button key={b.name} aria-pressed={cur === i} title={t('{0} view ({1})', bandName(i, b.name), b.key.toUpperCase())} onClick={() => { Sfx.clunk(); rendererRef.current?.zoomBand(i); }}>{bandName(i, b.name)}<kbd>{b.key.toUpperCase()}</kbd></button>)}
    </div>
  );
}

/** Supply income against what the war burns, drawn like the power bar of the old RTS sidebars. */
function SupplyGauge() {
  const sim = useSim(); if (!sim) return null;
  const { g, me } = sim, inc = income(g, me), sup = g.factions[me].supply;
  const fill = Math.min(1, sup / Math.max(20, inc * 4)), next = Math.max(0, convoyIn(g));
  const state = inc <= 0 ? 'bad' : sup < inc ? 'low' : '';
  return (
    <div className={'gauge ' + state} role="img" aria-label={t('Supply {0}, +{1} per convoy, next convoy in {2} seconds', sup, inc, next)}
      title={t('Supply {0} · +{1} per convoy · next convoy in {2} s', sup, inc, next)}>
      <i className="g-fill" style={{ height: `${(fill * 100).toFixed(1)}%` }} />
      <i className="g-conv" style={{ bottom: `${(g.supplyT / TICK_SECONDS * 100).toFixed(1)}%` }} />
    </div>
  );
}

/** Shown in the sidebar when no region is selected: the nation, its fronts and a pointer to the map. */
function Idle() {
  const sim = useSim(); if (!sim) return null;
  const { g, me } = sim, W = buildWorld(), F = FACTIONS[me];
  const mine = g.regions.filter(r => r.owner === me);
  const fronts = g.battles.filter(b => !b.ended && (b.def === me || b.sides.includes(me)));
  const ui = useUi.getState;
  return (
    <section className="idle" aria-label={t('War Office')}>
      <div className="dh" style={{ '--c': F.color } as React.CSSProperties}>
        <div className="dh-row"><small>{t('War Office · +{0} supply per convoy', income(g, me))}</small></div>
        <h2>{tx(F.name)}</h2>
        <div className="owner"><span>{t('{0} regions', mine.length)} · {fronts.length === 1 ? t('{0} front', fronts.length) : t('{0} fronts', fronts.length)}</span></div>
      </div>
      <div className="tb-body">
        {fronts.length > 0 && <div className="lbl"><span>{t('Fronts')}</span></div>}
        {fronts.slice(0, 8).map(b => (
          <button key={b.id} className="it nb front-it" onClick={() => { click(); ui().select(b.region); rendererRef.current?.flyToBattle(b.id, 8); }}>
            <i className="dot" style={{ '--c': FACTIONS[g.regions[b.region].owner].color } as React.CSSProperties} />
            <span className="tx"><b>{tx(W.regions[b.region].name)}</b><small>{b.def === me ? t('Defending') : t('Attacking')}{b.from >= 0 ? ' · ' + (b.from >= 1000 ? t('on the {0}', sectorName(W, b.from)) : t('from {0}', W.regions[b.from].name)) : ''}</small></span>
            <span className="go">{t('Go')}</span>
          </button>
        ))}
        <FleetList />
        <button className="btn sm sit-open" onClick={() => { click(); ui().setPanel('situation'); }}>{t('Situation: wars and borders')}</button>
        <p className="note">{t('Select a region on the map to open its file: recruit, fortify, build, deploy and march.')}</p>
      </div>
    </section>
  );
}

export function Sidebar() {
  const sel = useUi(s => s.sel);
  return (
    <aside id="side" className={'plate' + (sel >= 0 ? ' open' : '')} aria-label={t('War Office')}>
      <div className="radar">
        <div className="crt"><Minimap /></div>
        <LayerPicker />
        <ZoomPicker />
      </div>
      <div className="side-body"><ArmyCard /><CorpsCard /><BorderCard />{sel >= 0 ? <Drawer /> : <Idle />}</div>
      <SupplyGauge />
    </aside>
  );
}
