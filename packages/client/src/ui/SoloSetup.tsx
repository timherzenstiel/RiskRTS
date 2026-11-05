import { useState } from 'react';
import { DEFAULT_SETTINGS, DIFFICULTIES, FACTIONS, type GameSettings } from '@riskrts/shared';
import { RulesPicker } from './Rules';
import { HostSession } from '../game/session';
import { useUi } from '../game/store';
import { Sfx } from '../audio/sfx';
import { click } from './actions';
import { NationCard } from './Nation';

export function SoloSetup() {
  const [pick, setPick] = useState(-1); const [diff, setDiff] = useState(1); const [rules, setRules] = useState<GameSettings>({ ...DEFAULT_SETTINGS });
  const begin = () => {
    if (pick < 0) return; Sfx.init();
    const s = new HostSession(pick, { humans: [pick], difficulty: diff, settings: rules });
    const ui = useUi.getState(); ui.startSession(s); ui.setOverlay('orders'); // pauses until the orders are read
  };
  return (
    <main className="screen">
      <div className="bgfx" aria-hidden="true" />
      <div className="sheet glass">
        <div><div className="kicker">Single player</div><h2>Choose your power</h2></div>
        <div className="picks" role="group" aria-label="Choose your power">
          {FACTIONS.map((f, i) => (
            <button key={f.key} className="pick" aria-pressed={pick === i} style={{ '--c': f.color } as React.CSSProperties} onClick={() => { Sfx.init(); Sfx.click(); setPick(i); }}>
              <i /><div><b>{f.name}</b><span>Capital: {f.capital}</span></div>
            </button>
          ))}
        </div>
        {pick >= 0 && <NationCard f={pick} />}
        <RulesPicker value={rules} onChange={p => setRules(r => ({ ...r, ...p }))} />
        <div className="row spread">
          <div><div className="lbl"><span>Difficulty · {DIFFICULTIES[diff].desc}</span></div>
            <div className="seg" role="group" aria-label="Difficulty">
              {DIFFICULTIES.map((d, i) => <button key={d.name} aria-pressed={diff === i} onClick={() => { click(); setDiff(i); }}>{d.name}</button>)}
            </div></div>
          <div className="row"><button className="btn" onClick={() => { click(); useUi.getState().setScreen('title'); }}>Back</button>
            <button className="btn primary" disabled={pick < 0} onClick={begin}>Begin the war</button></div>
        </div>
      </div>
    </main>
  );
}
