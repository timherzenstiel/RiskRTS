// Rules pages (design-command §5.5): one page per system, every number read from the same constants the simulation uses,
// so the pages never drift from the game.
import { useState } from 'react';
import {
  AIR_RANGE, ASSEMBLE, ATTACK_RATIO, BUDGET_MAX, CORPS_CAP, COST, CUT_MORALE, CUT_WEAR, DENY_WEEKS, DIG_IN, FALLBACK_RATIO, MANPOWER, MAX_REQ, MAX_SPIES, MIN_ATTACK,
  REPORT_FRESH, REPORT_OLD, RESERVE_REACH, SAFE_RATIO, SHELLS, STALE_DAYS, TICK_SECONDS, TRAITS, TRAIT_KEYS, WORK_MULT, WOUNDED_SHARE, WW_INCOME, XP_DMG, XP_MAX,
} from '@riskrts/shared';
import { useUi } from '../game/store';
import { Modal } from './Modal';
import { click } from './actions';

const PAGES = ['Fronts', 'Corps', 'Commanders', 'Scouting', 'Supply & men'] as const;
const pct = (x: number) => `${Math.round(x * 100)} %`;

export function RulesSheet() {
  const [page, setPage] = useState<number>(0);
  const close = () => { click(); useUi.getState().setOverlay(null); };
  return (
    <Modal label="Rules" onClose={close}>
      <div className="kicker">Field service regulations</div><h2>Rules</h2>
      <div className="seg rules-tabs" role="tablist" aria-label="Rules pages">
        {PAGES.map((p, i) => <button key={p} role="tab" aria-selected={page === i} aria-pressed={page === i} onClick={() => { click(); setPage(i); }}>{p}</button>)}
      </div>
      <div className="rules-page">
        {page === 0 && <>
          <h3>Who is at war</h3>
          <p>Every power is at war with every other power it has no treaty with. A ceasefire, non-aggression pact or alliance ends that until it lapses or is broken.</p>
          <h3>The balance on a border</h3>
          <p>Each chip in Fronts mode compares <b>ours</b> – the corps on that border, plus half of what stands at the centre if it can get there within {RESERVE_REACH} s – with <b>theirs</b> – what we know of the corps across and half their centre, plus columns marching in.</p>
          <table className="ledger"><tbody>
            <tr><td>Each trench level</td><td>+{pct(WORK_MULT.trench)}</td></tr>
            <tr><td>Each sandbag row</td><td>+{pct(WORK_MULT.sand)}</td></tr>
            <tr><td>Each wire belt</td><td>+{pct(WORK_MULT.wire)}</td></tr>
          </tbody></table>
          <p>Our power times the works, plus the fixed defences, over theirs: green from 1.5×, khaki from 0.8×, amber from 0.5×, red below or when they mass for an attack.</p>
          <h3>What we know</h3>
          <p>Across our own borders we see an estimate in men. A patrol, flight or spy brings an exact report, which counts as old after {STALE_DAYS} days.</p>
        </>}
        {page === 1 && <>
          <h3>Corps</h3>
          <p>A corps holds at most <b>{CORPS_CAP} battalions</b>; larger forces are several corps on one post (the centre, a border or a coast). It keeps its own men, morale and experience while it marches, sails and fights. Battalions in no corps are the region's depot.</p>
          <table className="ledger"><tbody>
            <tr><td>Experience per battle won</td><td>+1 star (max {XP_MAX})</td></tr>
            <tr><td>Damage per star</td><td>+{pct(XP_DMG)}</td></tr>
            <tr><td>Assembling before an attack</td><td>{ASSEMBLE} s</td></tr>
            <tr><td>Holding a border this long digs one trench level deeper</td><td>{DIG_IN} s</td></tr>
          </tbody></table>
          <h3>Who moves them</h3>
          <p>Regions on <b>Auto</b> arrange their depot and the corps they raised themselves. Corps you move, attack with, split, merge or form are yours (✋): Auto leaves them alone. Corps in an army are moved by its commander unless you take one by hand.</p>
        </>}
        {page === 2 && <>
          <h3>Armies and commanders</h3>
          <p>An army holds a front (a list of your regions). Its commander shifts his corps to the borders that need them – from quiet, peaceful or safe posts (safe: {SAFE_RATIO}× our strength) and from his reserve – by himself. Everything else he asks you for, at most {MAX_REQ} requests at a time; a denied request rests for {DENY_WEEKS} weeks.</p>
          <table className="ledger"><tbody>
            <tr><td>Proposes an attack from</td><td>{ATTACK_RATIO}× ours to theirs, {MIN_ATTACK}+ battalions</td></tr>
            <tr><td>Asks to fall back below</td><td>{FALLBACK_RATIO}×</td></tr>
            <tr><td>Report needed before an attack</td><td>≤ {REPORT_FRESH} days old</td></tr>
            <tr><td>Front budget</td><td>up to {pct(BUDGET_MAX)} of income</td></tr>
          </tbody></table>
          <p>No attack starts and no corps leaves the front without your answer. Standing approvals (not for attacks) and the budget let him do the small things himself.</p>
          <h3>Traits</h3>
          <table className="ledger"><tbody>{TRAIT_KEYS.map(k => <tr key={k}><td>{TRAITS[k].name}</td><td>{TRAITS[k].desc}</td></tr>)}</tbody></table>
        </>}
        {page === 3 && <>
          <table className="ledger"><tbody>
            <tr><td>Cavalry patrol · one border</td><td>{COST.patrol} supply</td></tr>
            <tr><td>Reconnaissance flight · up to {AIR_RANGE} borders, needs an airfield</td><td>{COST.recon} supply</td></tr>
            <tr><td>Spy · anywhere, reports every week until caught (max {MAX_SPIES})</td><td>{COST.spy} supply</td></tr>
            <tr><td>Decoy march</td><td>{COST.decoy} supply</td></tr>
          </tbody></table>
          <p>Patrols are caught more often by MG nests, bunkers and wire on the border they cross; flights by anti-air guns. Commanders ask for a look when a border is not safe and the report is older than {REPORT_OLD} days.</p>
        </>}
        {page === 4 && <>
          <h3>Convoys</h3>
          <p>Every {TICK_SECONDS} s (a week) supply, shells and new men arrive. Regions pay only with a route home – own land (or a sea lane between own regions) to the capital, a factory or home territory.</p>
          <table className="ledger"><tbody>
            <tr><td>Cut off: strength lost per convoy</td><td>{pct(CUT_WEAR)}</td></tr>
            <tr><td>Cut off: morale lost per convoy</td><td>{CUT_MORALE}</td></tr>
            <tr><td>War weariness: income lost per point</td><td>{pct(WW_INCOME / 100)}</td></tr>
            <tr><td>Shells per supply</td><td>{SHELLS.perSupply}</td></tr>
            <tr><td>Age class per home region</td><td>{MANPOWER.growth} men</td></tr>
            <tr><td>Each conscription level</td><td>+{pct(MANPOWER.mobGrowth)} men, +{MANPOWER.mobWW} weariness</td></tr>
            <tr><td>Casualties who come back wounded</td><td>{pct(WOUNDED_SHARE)}</td></tr>
          </tbody></table>
          <p>The Economy panel shows each of these numbers as a ledger for your nation.</p>
        </>}
      </div>
      <div className="row"><button className="btn primary" onClick={close}>Back to the map</button></div>
    </Modal>
  );
}
