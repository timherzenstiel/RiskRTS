// Rules pages (design-command §5.5): one page per system, every number read from the same constants the simulation uses,
// so the pages never drift from the game.
import { useEffect, useState } from 'react';
import { WAR,
  AIR_RANGE, ASSEMBLE, ATTACK_RATIO, BUDGET_MAX, CORPS_CAP, COST, CUT_MORALE, CUT_WEAR, DENY_WEEKS, DIG_IN, FALLBACK_RATIO, MANPOWER, MAX_REQ, MAX_SPIES, MIN_ATTACK,
  MAX_TRENCH, MAX_SAND, MAX_WIRE, TRENCH_COST, STANCE_DEALT, STANCE_TAKEN, REPORT_FRESH, REPORT_OLD, RESERVE_REACH, SAFE_RATIO, SHELLS, STALE_DAYS, TICK_SECONDS, TRAITS, TRAIT_KEYS, GEN, OP, START_GENERALS, FACTIONS, BAD_TRAITS, WORK_MULT, WW_INCOME, XP_DMG, XP_MAX, CAP, DRAW, ECON, LEVY_COST, OVER, REPL, WOUNDED,
} from '@riskrts/shared';
import { useUi } from '../game/store';
import { Modal } from './Modal';
import { click } from './actions';
import { t, tx } from '../i18n';
import { rich } from './LangPicker';

const PAGES = ['Basics', 'Fronts', 'Corps', 'Commanders', 'Scouting', 'Supply & men'] as const;
const pct = (x: number) => `${Math.round(x * 100)} %`;

export function RulesSheet() {
  const [page, setPage] = useState<number>(0);
  const close = () => { click(); useUi.getState().setOverlay(null); };
  // opened at a section of the Basics (from the guided war): scroll it into view once
  useEffect(() => { const at = useUi.getState().rulesAt; if (!at) return; useUi.setState({ rulesAt: null }); setPage(0); setTimeout(() => document.getElementById(at)?.scrollIntoView({ block: 'start' }), 50); }, []);
  return (
    <Modal label={t('Rules')} onClose={close}>
      <div className="kicker">{t('Field service regulations')}</div><h2>{t('Rules')}</h2>
      <div className="seg rules-tabs" role="tablist" aria-label={t('Rules pages')}>
        {PAGES.map((p, i) => <button key={p} role="tab" aria-selected={page === i} aria-pressed={page === i} onClick={() => { click(); setPage(i); }}>{t(p)}</button>)}
      </div>
      <div className="rules-page">
        {page === 0 && <>
          <p className="rules-lead">{t('The ideas behind every order, in plain words. The other pages hold the exact numbers.')}</p>
          <h3 id="b-map">{t('Regions and borders')}</h3>
          <p>{t('The map is made of regions. Each region has a centre and a post on every border with a neighbour (and on each coast). Click a region to select it: the command bar at the top of the sidebar then lists what you can do there, each with its key. Click a border line or its chip on the map to open the border card: the forces on both sides of that border and what you can do there.')}</p>
          <h3 id="b-reserve">{t('Reserve and corps')}</h3>
          <p>{rich(t('New battalions arrive by themselves in their region\'s <b>reserve</b>, after a week of training (Recruit… (R), or the keys 1–5 with a region selected). The reserve stays at the region\'s centre: it counts for the region\'s defence, but it cannot be sent anywhere as a unit.'))}</p>
          <p>{rich(t('<b>Form corps from reserve</b> (J) puts the whole reserve of the selected region into one corps, up to {0} battalions; anything beyond that waits for the next click. A corps can be moved, dug in, sent to attack and handed to a commander, and it keeps its men, morale and experience wherever it goes.', CORPS_CAP))}</p>
          <h3 id="b-move">{t('Moving corps')}</h3>
          <p>{rich(t('Select a corps (in the Forces panel, or click it on the map), press <b>Move</b> (M) and click a border or one of your regions on the map; right-clicking the target does the same. Or open a border card and use <b>Send corps…</b>: it lists the corps that can reach that border, each with a Send button. Corps march over the map and take time to arrive. Move troops (M) on a selected region sends a share of its troops to a neighbouring region.'))}</p>
          <h3 id="b-dig">{t('Digging in and fortifying')}</h3>
          <p>{rich(t('<b>Dig in</b> (H) on a corps at a border adds one trench level on that border. It costs Production ({0}), takes effect at once, and goes up to {1} levels. A corps that holds a border for {2} s also digs one level deeper by itself.', TRENCH_COST.join(' / '), MAX_TRENCH, DIG_IN))}</p>
          <p>{rich(t('<b>Fortify…</b> in the border card adds more: sandbags (up to {0} rows) and barbed wire (up to {1} belts, which also slows attackers down while they cut through it), and fixed defences such as MG nests and bunkers. Field works only help the defenders, and they belong to the border: they stay when the corps leaves.', MAX_SAND, MAX_WIRE))}</p>
          <table className="ledger"><tbody>
            <tr><td>{t('Each trench level')}</td><td>+{pct(WORK_MULT.trench)} {t('defence')}</td></tr>
            <tr><td>{t('Each sandbag row')}</td><td>+{pct(WORK_MULT.sand)} {t('defence')}</td></tr>
            <tr><td>{t('Each wire belt')}</td><td>+{pct(WORK_MULT.wire)} {t('defence')}</td></tr>
          </tbody></table>
          <h3 id="b-attack">{t('Attacking')}</h3>
          <p>{rich(t('Select corps, press <b>Attack</b> (K) and click an enemy region across a border, or use Attack across in the border card. The corps first assemble on the border ({0} s), then the battle begins. The first fight is for the enemy\'s first line on that border; once it falls you can carry the attack on into the depth of the region and take it.', ASSEMBLE))}</p>
          <h3 id="b-battle">{t('In a battle')}</h3>
          <p>{t('A battle opens its card with both sides\' strength and the levers that are yours to pull:')}</p>
          <table className="ledger"><tbody>
            <tr><td>{t('Barrage')}</td><td>{t('Hold fire saves shells and hides your strength; steady fire uses about one shell per battery every 10 s; a heavy barrage gives 80 % more fire and suppression for twice the shells.')}</td></tr>
            <tr><td>{t('Over the top')}</td><td>{t('The attackers leave the start line now instead of waiting.')}</td></tr>
            <tr><td>{t('Stance · Aggressive')}</td><td>{t('+{0} damage dealt, +{1} losses', pct(STANCE_DEALT[1] - 1), pct(STANCE_TAKEN[1] - 1))}</td></tr>
            <tr><td>{t('Stance · Defensive')}</td><td>{t('−{0} losses, never counter-attacks', pct(1 - STANCE_TAKEN[2]))}</td></tr>
            <tr><td>{t('Stance · Hold')}</td><td>{t('No retreat; morale falls 50 % faster')}</td></tr>
            <tr><td>{t('Reinforce · Withdraw')}</td><td>{t('Send half the troops of a neighbouring region in, or fall back.')}</td></tr>
          </tbody></table>
          <h3 id="b-cmd">{t('Commanders and requests')}</h3>
          <p>{rich(t('<b>Hand to a commander</b> (L) forms an army from corps on a front. The commander then moves his corps along that front by himself and asks you for what he may not decide: more men, field works, a patrol, an attack. His requests arrive in the <b>Inbox</b> of the Staff panel; grant or refuse each. His mandate (Hold, Defend, Attack) sets how much he does alone; on Attack he plans operations and sends you the plan to approve. Every army needs a general, and you have only a few.'))}</p>
          <h3 id="b-econ">{t('Production, shells and men')}</h3>
          <p>{rich(t('Every week ({0} s) your regions with a route home pay <b>Production</b> (top bar). You spend it on recruits, buildings, field works and scouting. <b>Shells</b> are made from part of your factory output; your guns use them in every battle, more on a heavy barrage. <b>Men</b> come from the manpower pool of your home regions; part of the casualties come back to it.', TICK_SECONDS))}</p>
          <h3 id="b-supply">{t('Supply')}</h3>
          <p>{rich(t('Each region can feed only so many battalions. A region over its capacity costs its troops morale every week and gets no replacements; far over, they lose men. The <b>Supply</b> map mode (B) shows it: red regions are over capacity. Move corps out, or raise the capacity with depots and rail links.'))}</p>
          <h3 id="b-home">{t('Home front')}</h3>
          <p>{t('War weariness shows how tired your nation is of the war. Losses, conscription and broken treaties raise it; quiet weeks let it fade. It cuts Production and morale, and very high it brings strikes and uprisings.')}</p>
          <h3 id="b-time">{t('Time')}</h3>
          <p>{t('A week is {0} s. The space bar pauses; the buttons at the top right set the speed. The game also pauses by itself for the events your difficulty picks (change them in the Inbox panel). Most orders can be given while paused.', TICK_SECONDS)}</p>
        </>}
        {page === 1 && <>
          <h3>{t('Who is at war')}</h3>
          <p>{t('Every power is at war with every other power it has no treaty with. A ceasefire, non-aggression pact or alliance ends that until it lapses or is broken.')}</p>
          <h3>{t('Difficulty')}</h3>
          <p>{t('Recruit: two more generals, requests never lapse, the game pauses for everything, and the computer powers attack only on good odds and one place at a time. Officer: a fair fight; requests lapse after 3 weeks. Marshal: one general fewer, requests lapse after a week, no auto-pause, forecasts only as ranges, and the computer powers attack on thinner odds and feint more often.')}</p>
          <h3>{t('War aims, war score and peace')}</h3>
          <p>{t('A war between two powers begins with their first battle. Each side then picks one war aim of three: take a region of theirs, lose no region to them for {0} weeks, or raise the war score. A reached aim pays out (Production or less war weariness) and counts for the war score; a missed one costs {1} war weariness. Then a new aim is chosen. Once scouted by an agent in their land, the enemy\'s aim shows in the Situation panel.', WAR.weeks.hold, WAR.missWW)}</p>
          <p>{t('The war score counts regions taken ({0} each), men lost against men killed (up to {1}) and aims reached ({2} each, at most two). After {3} weeks of war, a side ahead by {4} or more gets peace terms: the loser pays Production, and from {5} also cedes a region. Both sides must agree. Peace is never forced, but refusing costs war weariness ({6} for the loser, {7} for the winner). A peace becomes a non-aggression pact.', WAR.region, WAR.men, WAR.aim, WAR.minDays / 7, WAR.offerAt, WAR.cedeAt, WAR.refuseLoser, WAR.refuseWinner)}</p>
          <p>{t('Every week the newspaper reports the big events: our own paper our wars (in its own way), the wire service the other wars we can see. It and the cards for the big moments can be switched off in the Reports.')}</p>
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
        {page === 2 && <>
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
        {page === 3 && <>
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
          <h3>{t('Operations')}</h3>
          <p>{t('On the Attack mandate a commander does not ask for permission to attack: he offers an operation plan with the forces, the barrage, the odds and the expected losses. If the odds are below {0}, he also names your free corps nearby that would improve them. Once approved, the army gathers (up to {1} weeks for extra corps), fires the barrage and attacks by itself. You can still work the battle\'s levers at any moment. A result card compares plan and outcome; the general gains a star if the objective is taken and loses one if not.', `${Math.round(OP.aim * 100)} %`, OP.gatherWeeks)}</p>
          <h3>{t('Traits')}</h3>
          <table className="ledger"><tbody>{TRAIT_KEYS.map(k => <tr key={k}><td>{tx(TRAITS[k].name)}{BAD_TRAITS.includes(k) ? ' ' + t('(bad)') : ''}</td><td>{tx(TRAITS[k].desc)}</td></tr>)}</tbody></table>
        </>}
        {page === 4 && <>
          <table className="ledger"><tbody>
            <tr><td>{t('Cavalry patrol · one border')}</td><td>{t('{0} Production', COST.patrol)}</td></tr>
            <tr><td>{t('Reconnaissance flight · up to {0} borders, needs an airfield', AIR_RANGE)}</td><td>{t('{0} Production', COST.recon)}</td></tr>
            <tr><td>{t('Spy · anywhere, reports every week until caught (max {0})', MAX_SPIES)}</td><td>{t('{0} Production', COST.spy)}</td></tr>
            <tr><td>{t('Decoy march')}</td><td>{t('{0} Production', COST.decoy)}</td></tr>
          </tbody></table>
          <p>{t('Patrols are caught more often by MG nests, bunkers and wire on the border they cross; flights by anti-air guns. Commanders ask for a look when a border is not safe and the report is older than {0} days.', REPORT_OLD)}</p>
        </>}
        {page === 5 && <>
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
