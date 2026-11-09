import { useMemo, useState } from 'react';
import { DEFAULT_SETTINGS, DIFFICULTIES, FACTIONS, NATIONS, TUT, createGame, type GameSettings } from '@riskrts/shared';
import { RadarMap } from './RadarMap';
import { cameoUrl } from './Cameo';
import { Flag } from './Flag';
import { RulesPicker } from './Rules';
import { HostSession } from '../game/session';
import { useUi } from '../game/store';
import { Sfx } from '../audio/sfx';
import { click } from './actions';
import { NationCard } from './Nation';
import { t, tx } from '../i18n';

/** What a difficulty changes, in one line (design-play §7). */
export function diffLine(i: number): string {
  const d = DIFFICULTIES[i];
  return [
    d.gen ? t('generals {0}{1}', d.gen > 0 ? '+' : '−', Math.abs(d.gen)) : t('generals as usual'),
    d.expire === null ? t('requests never lapse') : t('requests lapse after {0} wk', d.expire),
    d.pause === 'all' ? t('pauses for everything') : d.pause === 'urgent' ? t('pauses for urgent requests and attacks') : t('no auto-pause'),
    d.exact ? t('exact forecasts') : t('forecasts as ranges'),
  ].join(' · ');
}

export function SoloSetup() {
  const [pick, setPick] = useState(-1); const [diff, setDiff] = useState(1); const [rules, setRules] = useState<GameSettings>({ ...DEFAULT_SETTINGS });
  const begin = (guided = false) => {
    if (pick < 0 && !guided) return; Sfx.init();
    const d = guided ? 0 : diff, me = guided ? TUT.me : pick;
    const s = new HostSession(me, guided ? { humans: [me], difficulty: d, seed: TUT.seed, guided: true } : { humans: [me], difficulty: d, settings: rules });
    const ui = useUi.getState();
    // the auto-pause defaults come with the difficulty (design-play §7); the Inbox panel changes them
    const p = DIFFICULTIES[d].pause; ui.setAutoPause({ urgent: p !== 'off', attacked: p !== 'off', lost: p === 'all', won: p === 'all' });
    ui.startSession(s); ui.setOverlay('orders'); // pauses until the orders are read
  };
  // the map of August 1914, for the order-of-battle radar
  const owners = useMemo(() => createGame({ seed: 1914, humans: [0], difficulty: 1 }).regions.map(r => r.owner), []);
  const mine = pick >= 0 ? owners.map((o, i) => o === pick ? i : -1).filter(i => i >= 0) : [];
  return (
    <main className="screen">
      <div className="bgfx" aria-hidden="true" />
      <div className="sheet glass oob">
        <div className="row spread"><div><div className="kicker">{t('Single player · order of battle')}</div><h2>{t('Choose your power')}</h2></div>
          <button className="btn guided" onClick={() => { click(); begin(true); }} title={t('Play {0} through six short stages that teach the game one system at a time. The other powers hold back until the first battle.', FACTIONS[TUT.me].name)}>
            <b>{t('First war (guided)')}</b><small>{t('{0} · six stages · Recruit', tx(FACTIONS[TUT.me].short))}</small></button></div>
        <div className="oob-grid">
          <RadarMap owners={owners} highlight={mine} label={t('The world in August 1914')} />
          <div className="ncards" role="group" aria-label={t('Choose your power')}>
            {FACTIONS.map((f, i) => (
              <button key={f.key} className="ncard" aria-pressed={pick === i} style={{ '--c': f.color } as React.CSSProperties} onClick={() => { Sfx.init(); Sfx.clunk(); setPick(i); }}>
                <img src={cameoUrl('inf', i) ?? ''} alt="" draggable={false} />
                <Flag f={i} />
                <b>{tx(f.name)}</b>
                <span className="stamp good">{tx(NATIONS[i].strengths[0]?.name)}</span>
                <span className="stamp bad">{tx(NATIONS[i].weaknesses[0]?.name)}</span>
              </button>
            ))}
          </div>
        </div>
        {pick >= 0 && <NationCard f={pick} />}
        <RulesPicker value={rules} onChange={p => setRules(r => ({ ...r, ...p }))} />
        <div className="row spread">
          <div><div className="lbl"><span>{t('Difficulty · {0}', DIFFICULTIES[diff].desc)}</span></div>
            <div className="seg" role="group" aria-label={t('Difficulty')}>
              {DIFFICULTIES.map((d, i) => <button key={d.name} aria-pressed={diff === i} onClick={() => { click(); setDiff(i); }}>{t('difficulty|' + d.name)}</button>)}
            </div><small className="diff-det">{diffLine(diff)}</small></div>
          <div className="row"><button className="btn" onClick={() => { click(); useUi.getState().setScreen('title'); }}>{t('Back')}</button>
            <button className="btn primary" disabled={pick < 0} onClick={() => begin()}>{t('Begin the war')}</button></div>
        </div>
      </div>
    </main>
  );
}
