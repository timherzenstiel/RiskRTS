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
import { rendererRef } from './refs';

/** Map mode (design-command §1): political, fronts, forces, supply, intel. The same mode again goes back to the political map. */
export function LayerPicker() {
  const mode = useUi(s => s.mode), set = useUi.getState().setMode;
  return (
    <div className="seg layer-seg mode-seg" role="group" aria-label="Map mode">
      {MAP_MODES.map((m, i) => (
        <button key={m.name} aria-pressed={mode === i} title={`${m.name}: ${m.hint} (${m.key.toUpperCase()})`} onClick={() => { click(); set(mode === i && i ? 0 : i as MapMode); }}>{m.short}<kbd>{m.key.toUpperCase()}</kbd></button>
      ))}
    </div>
  );
}

/** Zoom bands: theatre, front, battle, close (keys Z X C V). Lights the band the camera is in. */
function ZoomPicker() {
  useSim(); // re-render with the game clock so the lit band follows the wheel
  const d = rendererRef.current?.cameraDistance() ?? 55, cur = bandOf(d);
  return (
    <div className="seg zoom-seg" role="group" aria-label="Zoom">
      {BANDS.map((b, i) => <button key={b.name} aria-pressed={cur === i} title={`${b.name} view (${b.key.toUpperCase()})`} onClick={() => { Sfx.clunk(); rendererRef.current?.zoomBand(i); }}>{b.name}<kbd>{b.key.toUpperCase()}</kbd></button>)}
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
    <div className={'gauge ' + state} role="img" aria-label={`Supply ${sup}, +${inc} per convoy, next convoy in ${next} seconds`}
      title={`Supply ${sup} · +${inc} per convoy · next convoy in ${next} s`}>
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
    <section className="idle" aria-label="War Office">
      <div className="dh" style={{ '--c': F.color } as React.CSSProperties}>
        <div className="dh-row"><small>War Office · +{income(g, me)} supply per convoy</small></div>
        <h2>{F.name}</h2>
        <div className="owner"><span>{mine.length} regions · {fronts.length} front{fronts.length === 1 ? '' : 's'}</span></div>
      </div>
      <div className="tb-body">
        {fronts.length > 0 && <div className="lbl"><span>Fronts</span></div>}
        {fronts.slice(0, 8).map(b => (
          <button key={b.id} className="it nb front-it" onClick={() => { click(); ui().select(b.region); rendererRef.current?.flyToBattle(b.id, 8); }}>
            <i className="dot" style={{ '--c': FACTIONS[g.regions[b.region].owner].color } as React.CSSProperties} />
            <span className="tx"><b>{W.regions[b.region].name}</b><small>{b.def === me ? 'Defending' : 'Attacking'}{b.from >= 0 ? ` · ${b.from >= 1000 ? 'on the ' + sectorName(W, b.from) : 'from ' + W.regions[b.from].name}` : ''}</small></span>
            <span className="go">Go</span>
          </button>
        ))}
        <FleetList />
        <button className="btn sm sit-open" onClick={() => { click(); ui().setPanel('situation'); }}>Situation: wars and borders</button>
        <p className="note">Select a region on the map to open its file: recruit, fortify, build, deploy and march.</p>
      </div>
    </section>
  );
}

export function Sidebar() {
  const sel = useUi(s => s.sel);
  return (
    <aside id="side" className={'plate' + (sel >= 0 ? ' open' : '')} aria-label="War Office">
      <div className="radar">
        <div className="crt"><Minimap /></div>
        <LayerPicker />
        <ZoomPicker />
      </div>
      <div className="side-body"><CorpsCard /><BorderCard />{sel >= 0 ? <Drawer /> : <Idle />}</div>
      <SupplyGauge />
    </aside>
  );
}
