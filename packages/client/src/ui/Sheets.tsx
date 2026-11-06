// Content of the in-game modals: sealed orders, field manual, menu, end of war.
import { CONT, FACTIONS, TICK_SECONDS, buildWorld, missionText, missionWants, totalUnits, type GameState } from '@riskrts/shared';
import { RadarMap } from './RadarMap';
import { cameoUrl } from './Cameo';
import { dateStr, useSim, useUi } from '../game/store';
import { Sfx } from '../audio/sfx';
import type { VoiceMode } from '../audio/voice';
import { click, quitToTitle } from './actions';
import { writeSave } from './storage';
import { Modal } from './Modal';
import { PIXEL_HINT, PIXEL_SCALES, type PixelScale } from '../render/api';
import { getLang, t, tx } from '../i18n';
import { LangPicker, rich } from './LangPicker';

const lc = (t: string) => t[0].toLowerCase() + t.slice(1);

function Progress({ g, me }: { g: GameState; me: number }) {
  const m = g.factions[me].mission; if (!m) return null;
  const mine = g.regions.filter(r => r.owner === me); const W = buildWorld();
  const span = (label: string, v: string | number) => <span key={label}>{label}<b>{v}</b></span>;
  if (m.type === 'conts' || m.type === 'conts1') {
    return <>{m.conts.map(k => { const ids = W.regions.filter(r => r.cont === k); return span(tx(CONT[k].name), `${ids.filter(r => g.regions[r.id].owner === me).length}/${ids.length}`); })}{m.type === 'conts1' && <span>{t('plus one more continent')}</span>}</>;
  }
  if (m.type === 'count') return span(t('Regions held'), `${mine.length}/${m.n}`);
  if (m.type === 'count2') return span(t('Garrisoned regions'), `${mine.filter(r => totalUnits(r.units) >= 2).length}/${m.n}`);
  if (m.type !== 'destroy') return null;
  return span(t('{0} regions left', FACTIONS[m.target].name), g.regions.filter(r => r.owner === m.target).length);
}

export function OrdersSheet({ onHelp }: { onHelp: () => void }) {
  const sim = useSim(); if (!sim) return null;
  const { g, me, session } = sim; const f = g.factions[me]; const first = g.time < 1;
  const [title, text] = f.mission ? missionText(f.mission) : ['Waiting for orders…', 'The War Office is still sealing your orders.'];
  const close = () => { click(); useUi.getState().setOverlay(null); };
  // briefing radar: the regions the orders want, arrows from the capital to the nearest of them
  const W = buildWorld(), want = f.mission ? g.regions.filter(r => r.owner !== me && missionWants(g, f, r.id)).map(r => r.id) : [];
  const cap = g.regions.find(r => r.capitalOf === me)?.id ?? -1, capR = cap >= 0 ? W.regions[cap] : null;
  const near = capR ? [...want].sort((a, b) => Math.hypot(W.regions[a].cx - capR.cx, W.regions[a].cz - capR.cz) - Math.hypot(W.regions[b].cx - capR.cx, W.regions[b].cz - capR.cz)).slice(0, 3) : [];
  return (
    <Modal label={t('Sealed orders')} onClose={close}>
      <div className="kicker">{tx(FACTIONS[me].name)} · {t('War Office · Mission briefing')}</div>
      <div className="brief-grid">
        <div className="brief-l">
          <RadarMap owners={g.regions.map(r => r.owner)} highlight={want} arrows={cap >= 0 ? near.map(t => [cap, t] as [number, number]) : []} width={460} height={230} label={t('Briefing map')} />
          <div className="officer"><img src={cameoUrl('inf', me)?.replace(/inf_(\d)/, 'officer_$1') ?? ''} alt="" /><small>{t('Chief of the General Staff')}</small></div>
        </div>
        <div className="orders"><span className="stamp">{t('SECRET')}</span><h2>{tx(title)}</h2><p className="lede typed" key={title}>{tx(text)}</p><div className="prog"><Progress g={g} me={me} /></div></div>
      </div>
      <p className="muted">{t('Every other power holds its own sealed orders. The first to complete them wins the war, so watch the scoreboard at the top of the screen.')}{session.kind === 'host' ? ' ' + t('The war keeps running while you read.') : ''}</p>
      <div className="row"><button className="btn primary" onClick={close}>{first ? t('Accept orders') : t('Back to the map')}</button>
        {first && <button className="btn" onClick={() => { click(); onHelp(); }}>{t('How to play')}</button>}</div>
    </Modal>
  );
}

export function HelpSheet({ onBack }: { onBack: () => void }) {
  return (
    <Modal label={t('How to play')} narrow onClose={onBack}>
      <div className="kicker">{t('Field manual')}</div><h2>{t('How to play')}</h2>
      <dl className="keys">
        <dt>{t('Click · tap')}</dt><dd>{t('Select a region. Its file opens on the right: garrison, recruiting, building and march orders.')}</dd>
        <dt>{t('Right-click')}</dt><dd>{rich(t("With your region selected, right-click another region to march troops there: into an enemy region to attack, or into one of your own (further inland too) to move them. A move between your own regions takes idle troops from the centre and the quiet borders. The share picker in the region's Overview sets how many go. On a phone use <b>Overview → Pick a target on the map</b>. Click close to one of your borders inside the selected region to open its border card: fortify, scout across, send corps. Dashed sea lanes count as borders; troops sail across. Attacks run in phases: forming up, the march to the border, assembly, then the first line and the depth."))}</dd>
        <dt>{t('Corps · O')}</dt><dd>{rich(t('Click a corps marker on the map, or a corps in the Forces panel (<kbd>O</kbd>), to select it; Shift-click adds more. Then right-click: an own region or one of its borders moves the corps there, an enemy region next to it attacks. A corps holds at most 20 battalions and keeps its men, morale and experience (a star per battle won, +5 % damage each). Corps you have ordered are marked ✋; Auto leaves them alone.'))}</dd>
        <dt>{t('Armies · G')}</dt><dd>{rich(t('Select corps and press <b>Form army</b> on the corps card: a commander takes them and the regions they stand in as his front. He shifts his corps to the borders that need them and asks you (Staff panel, <kbd>G</kbd>) for men, trenches and wire, patrols, and permission to attack, to fall back or to send corps back he no longer needs, after a treaty or when a border is safe. Set his mandate, target, budget and standing approvals on the army card.'))}</dd>
        <dt>P · F · T · B · I</dt><dd>{t('Map modes: political, fronts (wars, battles and the balance on each of your borders), forces (corps, front lines, columns), supply (buildings, rails), intel (what you know). Press again for the political map.')}</dd>
        <dt>{t('Drag · wheel')}</dt><dd>{t('Pan and zoom (pinch on a phone).')} <kbd>Z</kbd> <kbd>X</kbd> <kbd>C</kbd> <kbd>V</kbd> {t('jump to the theatre, front, battle and close views at the cursor;')} <kbd>+</kbd> <kbd>−</kbd> {t('zoom in steps. Zoom close to a battle to watch it. Double-click a region to fly there. The minimap in the corner jumps anywhere.')}</dd>
        <dt>1 2 3 4</dt><dd>{t('Recruit one infantry battalion, MG company, field battery or tank platoon in the selected region.')}</dd>
        <dt>{t('Space · Esc')}</dt><dd>{t('Pause. Esc steps back: cancels a march, closes the scoreboard, clears the selected corps, deselects, then opens the menu.')}</dd>
      </dl>
      <p className="lede small">{t("Every {0} seconds a convoy arrives with supply for every region linked by your own land (or sea lanes between your regions) to your capital, a factory or your home territory, plus continent bonuses and +2 per factory. One infantry unit is a battalion of 100 men; losses thin formations out and wounded return with later convoys. Battles are fought on the border the attack comes over, against that border's trench, sandbags, wire and defences. You see rivals only across your borders, as an estimate: patrols, reconnaissance flights and spies tell you more. Heavy losses raise war weariness, which cuts income and morale; broken troops surrender.", TICK_SECONDS)}</p>
      <p className="lede small">{t('Every front has its own levers. Your guns fire light, heavy or not at all; each shot uses shells from the national stockpile (factories and the capital make more, or buy them with supply). Shells landing on a trench')} <b>{t('suppress')}</b>{t(' it: suppressed troops fire less and their machine guns fall silent. Attackers wait at the start line while the guns work; send them')} <b>{t('over the top')}</b>{t(' when the enemy is pinned down, or they go on their own after a while. Set a stance, reinforce a front straight from a neighbouring region, or withdraw. Every battle files an after-action report.')}</p>
      <div className="row"><button className="btn primary" onClick={() => { click(); onBack(); }}>{t('Back')}</button></div>
    </Modal>
  );
}

const VOICE_MODES: [VoiceMode, string, string][] = [
  ['off', 'Off', 'No spoken dispatches; signal cues still sound'],
  ['basic', 'Basic', "Your browser's built-in voice"],
  ['neural', 'Field telephone', 'A neural voice over a crackling field telephone. Downloads about 90 MB once.'],
];

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <div className="grp"><span>{t(label)}</span>
      <div className="seg" role="group" aria-label={t(label)}>
        <button aria-pressed={on} onClick={() => { Sfx.init(); set(true); }}>{t('On')}</button>
        <button aria-pressed={!on} onClick={() => { Sfx.init(); set(false); }}>{t('Off')}</button>
      </div></div>
  );
}

export function MenuSheet({ onHelp }: { onHelp: () => void }) {
  const sim = useSim(); const { quality, sound, radio, tips, log, look, voiceState } = useUi();
  if (!sim) return null;
  const { session, g } = sim; const ui = useUi.getState;
  const close = () => { click(); ui().setOverlay(null); };
  return (
    <Modal label={t('Menu')} narrow onClose={close}>
      <div className="kicker">{session.kind === 'local' ? t('Paused') : session.kind === 'host' ? t('Hosting · the war goes on') : t('Menu · the war goes on')}</div><h2>{t('Menu')}</h2>
      <div className="menu">
        <button className="btn primary wide" onClick={close}>{t('Resume')}</button>
        <div className="row">
          <button className="btn" onClick={() => { click(); ui().setOverlay('orders'); }}>{t('Sealed orders')}</button>
          <button className="btn" onClick={() => { click(); ui().setOverlay('reports'); }}>{t('Battle reports')}</button>
          <button className="btn" onClick={() => { click(); onHelp(); }}>{t('How to play')}</button>
          {session.kind === 'local' && !g.over && <button className="btn" onClick={() => { click(); ui().say(writeSave(session) ? 'Game saved.' : 'Saving is not available here.'); }}>{t('Save game')}</button>}
        </div>
        <div className="grp"><span>{t('Language')}</span><LangPicker /></div>
        <div className="grp"><span>{t('Pixel scale')}</span>
          <div className="seg" role="group" aria-label={t('Pixel scale')}>
            {PIXEL_SCALES.map((l, i) => <button key={l} title={t(PIXEL_HINT[i])} aria-pressed={quality === i} onClick={() => { click(); ui().setQuality(i as PixelScale); }}>{t(l)}</button>)}
          </div></div>
        <div className="grp"><span>{t('Look')}</span>
          <div className="seg" role="group" aria-label={t('Visual style')}>
            {['Tiberian', 'Red Alert'].map((l, i) => <button key={l} aria-pressed={look === i} onClick={() => { click(); ui().setLook(i as 0 | 1); }}>{l}</button>)}
          </div></div>
        <Toggle label="Sound" on={sound} set={v => ui().setSound(v)} />
        <div className="grp"><span>{t('Radio voice')}</span>
          <div className="seg" role="group" aria-label={t('Radio voice')}>
            {VOICE_MODES.map(([m, l, hint]) => <button key={m} title={t(hint)} aria-pressed={radio === m} onClick={() => { Sfx.init(); ui().setRadio(m); }}>{t(l)}</button>)}
          </div></div>
        {radio === 'neural' && voiceState.state !== 'ready' && <small className="muted">{voiceState.state === 'error' ? t('Field telephone voice could not load: using the basic voice.') : voiceState.state === 'loading' ? t('Loading field telephone voice… {0}% (about 90 MB, once)', Math.round(voiceState.p * 100)) : t('The field telephone voice loads with the first sound (about 90 MB, once).')}</small>}
        <Toggle label="Tips" on={tips} set={v => ui().setTips(v)} />
        <button className="btn wide" onClick={() => { click(); quitToTitle(); }}>{session.kind === 'local' ? t('Save and quit to title') : session.kind === 'host' ? t('End game for everyone and quit') : t('Leave the game')}</button>
        <small>{t('Recent events')}</small>
        <div className="hist">{log.length ? log.slice(0, 10).map(l => <div key={l.id} className={l.cls}><time>{l.day}</time>{tx(l.text)}</div>) : <div>{t('Nothing yet.')}</div>}</div>
      </div>
    </Modal>
  );
}

export function EndSheet() {
  const sim = useSim(); if (!sim) return null;
  const { g, me } = sim; const won = g.winner === me; const winner = g.winner !== null ? g.factions[g.winner] : null;
  // English lower-cases the mission title after the colon; German keeps its nouns capitalised (t() translates the title)
  const wm = winner?.mission ? (getLang() === 'en' ? lc(missionText(winner.mission)[0]) : missionText(winner.mission)[0]) : null;
  const who = g.winner === null ? '' : FACTIONS[g.winner].the[0].toUpperCase() + FACTIONS[g.winner].the.slice(1);
  const text = g.winner === null ? t('Every human power has been destroyed. The war is lost.')
    : won ? (wm ? t('Your sealed orders are fulfilled: {0}.', wm) : t('Your sealed orders are fulfilled.'))
    : wm ? t('{0} has fulfilled its sealed orders: {1}.', who, wm) : t('{0} has fulfilled its sealed orders.', who);
  return (
    <Modal label={won ? t('Victory') : t('Defeat')} narrow onClose={() => useUi.getState().setOverlay(null)}>
      <div className="kicker">{dateStr(g.day)}</div>
      <h1 style={{ color: won ? 'var(--accent)' : 'var(--danger)' }}>{won ? t('Victory') : t('Defeat')}</h1>
      <p className="lede">{text}</p>
      <div className="stats">
        <div><small>{t('Regions held')}</small><b>{g.regions.filter(r => r.owner === me).length}</b></div>
        <div><small>{t('Battles won / lost')}</small><b>{g.stats.won[me] ?? 0} / {g.stats.lost[me] ?? 0}</b></div>
        <div><small>{t('Days of war')}</small><b>{Math.round(g.day)}</b></div>
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => { click(); quitToTitle(sim.session.kind === 'local' ? 'solo' : undefined); }}>{sim.session.kind === 'local' ? t('Start a new war') : t('Back to title')}</button>
        <button className="btn" onClick={() => { click(); useUi.getState().setOverlay(null); }}>{t('Look at the map')}</button>
      </div>
    </Modal>
  );
}
