// Pause by vote in multiplayer (design-play §2, decided §10): the banner under the top strip while a call is open or the war
// stands still, and the button that calls a pause.
import { FACTIONS, VOTE, callsLeft, humansOf, votePaused } from '@riskrts/shared';
import { useSim, useUi } from '../game/store';
import { click } from './actions';
import { t, tx } from '../i18n';
import { tn } from './LangPicker';

const ui = useUi.getState;

/** Whether this game has votes: more than one human power, and the host has not switched them off. */
export function hasVotes(g: { factions: { alive: boolean; ai: boolean }[]; cfg: { vote?: boolean } }) {
  return g.cfg.vote !== false && g.factions.filter(f => f.alive && !f.ai).length > 1;
}

export function VoteBanner() {
  const sim = useSim(); if (!sim) return null;
  const { g, me } = sim, v = g.vote; if (!v) return null;
  const hum = humansOf(g), need = Math.floor(hum.length / 2) + 1, wall = g.wall ?? 0, mine = hum.includes(me);
  const who = v.by === me ? t('You') : tx(FACTIONS[v.by].name);
  if (votePaused(g)) return (
    <div id="vote" className="plate on" role="status">
      <span><b>{t('Paused by vote')}</b> · {tn('{0} asked for it', { raw: who })} · {Math.max(0, Math.ceil(v.on! - wall))} s</span>
      {mine && <button className="btn sm" onClick={() => { click(); ui().order({ t: 'pauseVote', yes: false }); }}>{v.by === me ? t('Resume') : t('Vote to resume')}</button>}
    </div>
  );
  const voted = v.yes.includes(me) || v.no.includes(me);
  return (
    <div id="vote" className="plate" role="alert">
      <span><b>{v.by === me ? t('You asked for a pause') : tn('{0} asks for a pause', { raw: who })}</b> · {t('{0} of {1} agree', v.yes.length, need)} · {Math.max(0, Math.ceil(v.ends - wall))} s</span>
      {mine && !voted && <>
        <button className="btn sm primary" onClick={() => { click(); ui().order({ t: 'pauseVote', yes: true }); }}>{t('Agree')}</button>
        <button className="btn sm" onClick={() => { click(); ui().order({ t: 'pauseVote', yes: false }); }}>{t('Refuse')}</button>
      </>}
    </div>
  );
}

/** "Ask for a pause" next to the speed controls, in games with votes. */
export function PauseCall() {
  const sim = useSim(); if (!sim || !hasVotes(sim.g) || sim.g.over) return null;
  const { g, me } = sim, left = callsLeft(g, me);
  if (!humansOf(g).includes(me)) return null;
  return (
    <button className="btn sm pause-call" disabled={!!g.vote || left <= 0} title={t('Ask the other players to stop the war for up to {0} seconds. {1} calls left this hour.', VOTE.pause, Math.max(0, left))}
      onClick={() => { click(); ui().order({ t: 'pauseCall' }); }}>{t('Ask for a pause')}</button>
  );
}
