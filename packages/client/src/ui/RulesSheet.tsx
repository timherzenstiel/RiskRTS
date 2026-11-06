// Rules pages (design-command §5.5): one page per system, every number read from the same constants the simulation uses,
// so the pages never drift from the game.
import { useState } from 'react';
import {
  AIR_RANGE, ASSEMBLE, ATTACK_RATIO, BUDGET_MAX, CORPS_CAP, COST, CUT_MORALE, CUT_WEAR, DENY_WEEKS, DIG_IN, FALLBACK_RATIO, MANPOWER, MAX_REQ, MAX_SPIES, MIN_ATTACK,
  REPORT_FRESH, REPORT_OLD, RESERVE_REACH, SAFE_RATIO, SHELLS, STALE_DAYS, TICK_SECONDS, TRAITS, TRAIT_KEYS, GEN, START_GENERALS, FACTIONS, BAD_TRAITS, WORK_MULT, WW_INCOME, XP_DMG, XP_MAX, CAP, DRAW, ECON, LEVY_COST, OVER, REPL, WOUNDED,
} from '@riskrts/shared';
import { useUi } from '../game/store';
import { Modal } from './Modal';
import { click } from './actions';
import { t, tx } from '../i18n';
import { rich } from './LangPicker';

const PAGES = ['Fronts', 'Corps', 'Commanders', 'Scouting', 'Supply & men'] as const;
const pct = (x: number) => `${Math.round(x * 100)} %`;

export function RulesSheet() {
  const [page, setPage] = useState<number>(0);
  const close = () => { click(); useUi.getState().setOverlay(null); };
  return (
    <Modal label={t('Rules')} onClose={close}>
      <div className="kicker">{t('Field service regulations')}</div><h2>{t('Rules')}</h2>
      <div className="seg rules-tabs" role="tablist" aria-label={t('Rules pages')}>
        {PAGES.map((p, i) => <button key={p} role="tab" aria-selected={page === i} aria-pressed={page === i} onClick={() => { click(); setPage(i); }}>{t(p)}</button>)}
      </div>
      <div className="rules-page">
        {page === 0 && <>
          <h3>{t('Who is at war')}</h3>
          <p>{t('Every power is at war with every other power it has no treaty with. A ceasefire, non-aggression pact or alliance ends that until it lapses or is broken.')}</p>
          <h3>{t('The balance on a border')}</h3>
          <p>{rich(t('Each chip in Fronts mode compares <b>ours</b> – the corps on that border, plus half of what stands at the centre if it can get there within {0} s – with <b>theirs</b> – what we know of the corps across and half their centre, plus columns marching in.', RESERVE_REACH))}</p>
          <table className="ledger"><tbody>
            <tr><td>{t('Each trench level')}</td><td>+{pct(WORK_MULT.trench)}</td></tr>
            <tr><td>{t('Each sandbag row')}</td><td>+{pct(WORK_MULT.sand)}</td></tr>
            <tr><td>{t('Each wire belt')}</td><td>+{pct(WORK_MULT.wire)}</td></tr>
          </tbody></table>
          <p>{t('Our power times the works, plus the fixed defences, over theirs: green from 1.5×, khaki from 0.8×, amber from 0.5×, red below or when they mass for an attack.')}</p>
          <h3>{t('What we know')}</h3>
          <p>{t('Across our own borders we see an estimate in men. A patrol, flight or spy brings an exact report, which counts as old after {0} days.', STALE_DAYS)}</p>
        </>}
        {page === 1 && <>
          <h3>{t('Corps')}</h3>
          <p>{rich(t('A corps holds at most <b>{0} battalions</b>; larger forces are several corps on one post (the centre, a border or a coast). It keeps its own men, morale and experience while it marches, sails and fights. Battalions in no corps are the region\'s depot.', CORPS_CAP))}</p>
          <table className="ledger"><tbody>
            <tr><td>{t('Experience per battle won')}</td><td>{t('+1 star (max {0})', XP_MAX)}</td></tr>
            <tr><td>{t('Damage per star')}</td><td>+{pct(XP_DMG)}</td></tr>
            <tr><td>{t('Assembling before an attack')}</td><td>{ASSEMBLE} s</td></tr>
            <tr><td>{t('Holding a border this long digs one trench level deeper')}</td><td>{DIG_IN} s</td></tr>
          </tbody></table>
          <h3>{t('Who moves them')}</h3>
          <p>{rich(t('Regions on <b>Auto</b> arrange their reserve and the corps they raised themselves. Corps you move, attack with, split, merge or form are yours (✋): Auto leaves them alone. Corps in an army are moved by its commander unless you take one by hand.'))}</p>
        </>}
        {page === 2 && <>
          <h3>{t('Armies and commanders')}</h3>
          <p>{t('An army holds a front (a list of your regions). Its commander shifts his corps to the borders that need them – from quiet, peaceful or safe posts (safe: {0}× our strength) and from his reserve – by himself. Everything else he asks you for, at most {1} requests at a time; a denied request rests for {2} weeks.', SAFE_RATIO, MAX_REQ, DENY_WEEKS)}</p>
          <table className="ledger"><tbody>
            <tr><td>{t('Proposes an attack from')}</td><td>{t('{0}× ours to theirs, {1}+ battalions', ATTACK_RATIO, MIN_ATTACK)}</td></tr>
            <tr><td>{t('Asks to fall back below')}</td><td>{t('{0}×', FALLBACK_RATIO)}</td></tr>
            <tr><td>{t('Report needed before an attack')}</td><td>{t('≤ {0} days old', REPORT_FRESH)}</td></tr>
            <tr><td>{t('Front budget')}</td><td>{t('up to {0} of income', pct(BUDGET_MAX))}</td></tr>
          </tbody></table>
          <p>{t('No attack starts and no corps leaves the front without your answer. "Approves by himself" (not for attacks) and the budget let him do the small things himself.')}</p>
          <h3>{t('Generals')}</h3>
          <p>{t('Every army needs a general, and you have only so many. One more comes with each new war year and another for every {0} battles your armies win. A general whose headquarters region falls is captured; a replacement comes {1} weeks later.', GEN.wins, GEN.lostWeeks)}</p>
          <table className="ledger"><tbody>
            <tr><td>{t('Generals at the start')}</td><td>{START_GENERALS.map((n, f) => `${tx(FACTIONS[f].short)} ${n}`).join(' · ')}</td></tr>
            <tr><td>{t('Stars')}</td><td>{t('one for every 3 battles won on his front; at three he loses a bad trait or gains a new one')}</td></tr>
            <tr><td>{t('Relieving a general')}</td><td>{t('+{0} war weariness, his corps −{1} morale, morale below {2} % for {3} weeks', GEN.relieveWw, GEN.relieveMor, Math.round(GEN.shakenMor * 100), GEN.shakenWeeks)}</td></tr>
          </tbody></table>
          <h3>{t('Traits')}</h3>
          <table className="ledger"><tbody>{TRAIT_KEYS.map(k => <tr key={k}><td>{tx(TRAITS[k].name)}{BAD_TRAITS.includes(k) ? ' ' + t('(bad)') : ''}</td><td>{tx(TRAITS[k].desc)}</td></tr>)}</tbody></table>
        </>}
        {page === 3 && <>
          <table className="ledger"><tbody>
            <tr><td>{t('Cavalry patrol · one border')}</td><td>{t('{0} Production', COST.patrol)}</td></tr>
            <tr><td>{t('Reconnaissance flight · up to {0} borders, needs an airfield', AIR_RANGE)}</td><td>{t('{0} Production', COST.recon)}</td></tr>
            <tr><td>{t('Spy · anywhere, reports every week until caught (max {0})', MAX_SPIES)}</td><td>{t('{0} Production', COST.spy)}</td></tr>
            <tr><td>{t('Decoy march')}</td><td>{t('{0} Production', COST.decoy)}</td></tr>
          </tbody></table>
          <p>{t('Patrols are caught more often by MG nests, bunkers and wire on the border they cross; flights by anti-air guns. Commanders ask for a look when a border is not safe and the report is older than {0} days.', REPORT_OLD)}</p>
        </>}
        {page === 4 && <>
          <h3>{t('The week')}</h3>
          <p>{rich(t('Every {0} s is a week: Production, shells and new men arrive. Regions pay only with a route home – own land (or a sea lane between own regions) to the capital, a factory or home territory. Rail all the way is a <b>Rail</b> route, otherwise <b>Road</b>; none is <b>Cut off</b>.', TICK_SECONDS))}</p>
          <h3>{t('Supply capacity')}</h3>
          <p>{t('Each region can feed only so many battalions a week. Load is what its battalions draw, those fighting in its battles included.')}</p>
          <table className="ledger"><tbody>
            <tr><td>{t('Draw · infantry, MG, squadron')}</td><td>{DRAW.inf}</td></tr>
            <tr><td>{t('Draw · battery, tank')}</td><td>{DRAW.art}</td></tr>
            <tr><td>{t('Capacity · Rail route / Road route / cut off')}</td><td>{CAP.rail} / {CAP.road} / 0</td></tr>
            <tr><td>{t('Each depot in the region (capital, factory, harbour)')}</td><td>+{CAP.depot}</td></tr>
            <tr><td>{t('Each own rail link into the region, from the 2nd')}</td><td>+{CAP.link}</td></tr>
            <tr><td>{t('Mud / winter (Siberians) / heat')}</td><td>−20 % / −30 % (−15 %) / −15 %</td></tr>
            <tr><td>{t('Over capacity · morale a week')}</td><td>{t('−{0}, no replacements, shells ×{1}', OVER.morale, OVER.shells)}</td></tr>
            <tr><td>{t('Over {0} · men lost a week', pct(OVER.far))}</td><td>{pct(OVER.farWear)}</td></tr>
            <tr><td>{t('Cut off · strength / morale lost a week')}</td><td>{pct(CUT_WEAR)} / {CUT_MORALE}</td></tr>
          </tbody></table>
          <h3>{t('rules|Men')}</h3>
          <p>{t('The manpower pool → training → corps. Casualties partly come back to the pool; under-strength corps are refilled from it.')}</p>
          <table className="ledger"><tbody>
            <tr><td>{t('Age class per home region')}</td><td>{t('{0} men a week', MANPOWER.growth)}</td></tr>
            <tr><td>{t('Each conscription level')}</td><td>{t('+{0} men, +{1} weariness', pct(MANPOWER.mobGrowth), MANPOWER.mobWW)}</td></tr>
            <tr><td>{t('Training')}</td><td>{t('1 week (barracks: to the next week)')}</td></tr>
            <tr><td>{t('Emergency levies · only in a region under attack')}</td><td>{t('at once, {0}× the cost', LEVY_COST)}</td></tr>
            <tr><td>{t('Replacements · a week, per corps, front line first')}</td><td>{t('up to {0} of full strength', pct(REPL.share))}</td></tr>
            <tr><td>{t('Casualties back to the pool')}</td><td>{t('{0} after {1} weeks', pct(WOUNDED.share), WOUNDED.days / 7)}</td></tr>
          </tbody></table>
          <h3>{t('Production and shells')}</h3>
          <table className="ledger"><tbody>
            {ECON.map(e => <tr key={e.name}><td>{t('War economy · {0}', e.name)}</td><td>{t('{0} of factory output to shells', pct(e.shells))}</td></tr>)}
            <tr><td>{t('War weariness: Production lost per point')}</td><td>{pct(WW_INCOME / 100)}</td></tr>
          </tbody></table>
          <p>{t('The Economy panel shows each of these numbers as a ledger for your nation.')}</p>
        </>}
      </div>
      <div className="row"><button className="btn primary" onClick={close}>{t('Back to the map')}</button></div>
    </Modal>
  );
}
