// Content of the in-game modals: sealed orders, field manual, menu, end of war.
import { CONT, FACTIONS, TICK_SECONDS, buildWorld, missionText, missionWants, totalUnits, type GameState } from '@riskrts/shared';
import { RadarMap } from './RadarMap';
import { cameoUrl } from './Cameo';
import { dateStr, useSim, useUi } from '../game/store';
import { Sfx } from '../audio/sfx';
import { click, quitToTitle } from './actions';
import { writeSave } from './storage';
import { Modal } from './Modal';
import { PIXEL_HINT, PIXEL_SCALES, type PixelScale } from '../render/api';

const lc = (t: string) => t[0].toLowerCase() + t.slice(1);

function Progress({ g, me }: { g: GameState; me: number }) {
  const m = g.factions[me].mission; if (!m) return null;
  const mine = g.regions.filter(r => r.owner === me); const W = buildWorld();
  const span = (label: string, v: string | number) => <span key={label}>{label}<b>{v}</b></span>;
  if (m.type === 'conts' || m.type === 'conts1') {
    return <>{m.conts.map(k => { const ids = W.regions.filter(r => r.cont === k); return span(CONT[k].name, `${ids.filter(r => g.regions[r.id].owner === me).length}/${ids.length}`); })}{m.type === 'conts1' && <span>plus one more continent</span>}</>;
  }
  if (m.type === 'count') return span('Regions held', `${mine.length}/${m.n}`);
  if (m.type === 'count2') return span('Garrisoned regions', `${mine.filter(r => totalUnits(r.units) >= 2).length}/${m.n}`);
  if (m.type !== 'destroy') return null;
  return span(`${FACTIONS[m.target].name} regions left`, g.regions.filter(r => r.owner === m.target).length);
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
    <Modal label="Sealed orders" onClose={close}>
      <div className="kicker">{FACTIONS[me].name} · War Office · Mission briefing</div>
      <div className="brief-grid">
        <div className="brief-l">
          <RadarMap owners={g.regions.map(r => r.owner)} highlight={want} arrows={cap >= 0 ? near.map(t => [cap, t] as [number, number]) : []} width={460} height={230} label="Briefing map" />
          <div className="officer"><img src={cameoUrl('inf', me)?.replace(/inf_(\d)/, 'officer_$1') ?? ''} alt="" /><small>Chief of the General Staff</small></div>
        </div>
        <div className="orders"><span className="stamp">SECRET</span><h2>{title}</h2><p className="lede typed" key={title}>{text}</p><div className="prog"><Progress g={g} me={me} /></div></div>
      </div>
      <p className="muted">Every other power holds its own sealed orders. The first to complete them wins the war, so watch the scoreboard at the top of the screen.{session.kind === 'host' ? ' The war keeps running while you read.' : ''}</p>
      <div className="row"><button className="btn primary" onClick={close}>{first ? 'Accept orders' : 'Back to the map'}</button>
        {first && <button className="btn" onClick={() => { click(); onHelp(); }}>How to play</button>}</div>
    </Modal>
  );
}

export function HelpSheet({ onBack }: { onBack: () => void }) {
  return (
    <Modal label="How to play" narrow onClose={onBack}>
      <div className="kicker">Field manual</div><h2>How to play</h2>
      <dl className="keys">
        <dt>Click · tap</dt><dd>Select a region. Its file opens on the right: garrison, recruiting, building and march orders.</dd>
        <dt>Right-click</dt><dd>With your region selected, right-click another region to march troops there: into an enemy region to attack, or into one of your own (further inland too) to move them. A move between your own regions takes idle troops from the centre and the quiet borders. The share picker in the March tab sets how many go. On a phone use <b>March → Pick a target on the map</b>. Dashed sea lanes count as borders; troops sail across. Attacks run in phases: forming up, the march to the border, assembly, then the first line and the depth.</dd>
        <dt>P · F · T · B · I</dt><dd>Map modes: political, fronts (wars, battles and the balance on each of your borders), forces (corps, front lines, columns), supply (buildings, rails), intel (what you know). Press again for the political map.</dd>
        <dt>Drag · wheel</dt><dd>Pan and zoom (pinch on a phone). <kbd>Z</kbd> <kbd>X</kbd> <kbd>C</kbd> <kbd>V</kbd> jump to the theatre, front, battle and close views at the cursor; <kbd>+</kbd> <kbd>−</kbd> zoom in steps. Zoom close to a battle to watch it. Double-click a region to fly there. The minimap in the corner jumps anywhere.</dd>
        <dt>1 2 3 4</dt><dd>Recruit one infantry battalion, MG company, field battery or tank platoon in the selected region.</dd>
        <dt>Space · Esc</dt><dd>Pause. Esc steps back: cancels a march, closes the scoreboard, deselects, then opens the menu.</dd>
      </dl>
      <p className="lede small">Every {TICK_SECONDS} seconds a convoy arrives with supply for every region linked by your own land (or sea lanes between your regions) to your capital, a factory or your home territory, plus continent bonuses and +2 per factory. One infantry unit is a battalion of 100 men; losses thin formations out and wounded return with later convoys. Battles are fought on the border the attack comes over, against that border's trench, sandbags, wire and defences. You see rivals only across your borders, as an estimate: patrols, reconnaissance flights and spies tell you more. Heavy losses raise war weariness, which cuts income and morale; broken troops surrender.</p>
      <p className="lede small">Every front has its own levers. Your guns fire light, heavy or not at all; each shot uses shells from the national stockpile (factories and the capital make more, or buy them with supply). Shells landing on a trench <b>suppress</b> it: suppressed troops fire less and their machine guns fall silent. Attackers wait at the start line while the guns work; send them <b>over the top</b> when the enemy is pinned down, or they go on their own after a while. Set a stance, reinforce a front straight from a neighbouring region, or withdraw. Every battle files an after-action report.</p>
      <div className="row"><button className="btn primary" onClick={() => { click(); onBack(); }}>Back</button></div>
    </Modal>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <div className="grp"><span>{label}</span>
      <div className="seg" role="group" aria-label={label}>
        <button aria-pressed={on} onClick={() => { Sfx.init(); set(true); }}>On</button>
        <button aria-pressed={!on} onClick={() => { Sfx.init(); set(false); }}>Off</button>
      </div></div>
  );
}

export function MenuSheet({ onHelp }: { onHelp: () => void }) {
  const sim = useSim(); const { quality, sound, radio, tips, log, look } = useUi();
  if (!sim) return null;
  const { session, g } = sim; const ui = useUi.getState;
  const close = () => { click(); ui().setOverlay(null); };
  return (
    <Modal label="Menu" narrow onClose={close}>
      <div className="kicker">{session.kind === 'local' ? 'Paused' : session.kind === 'host' ? 'Hosting · the war goes on' : 'Menu · the war goes on'}</div><h2>Menu</h2>
      <div className="menu">
        <button className="btn primary wide" onClick={close}>Resume</button>
        <div className="row">
          <button className="btn" onClick={() => { click(); ui().setOverlay('orders'); }}>Sealed orders</button>
          <button className="btn" onClick={() => { click(); ui().setOverlay('reports'); }}>Battle reports</button>
          <button className="btn" onClick={() => { click(); onHelp(); }}>How to play</button>
          {session.kind === 'local' && !g.over && <button className="btn" onClick={() => { click(); ui().say(writeSave(session) ? 'Game saved.' : 'Saving is not available here.'); }}>Save game</button>}
        </div>
        <div className="grp"><span>Pixel scale</span>
          <div className="seg" role="group" aria-label="Pixel scale">
            {PIXEL_SCALES.map((l, i) => <button key={l} title={PIXEL_HINT[i]} aria-pressed={quality === i} onClick={() => { click(); ui().setQuality(i as PixelScale); }}>{l}</button>)}
          </div></div>
        <div className="grp"><span>Look</span>
          <div className="seg" role="group" aria-label="Visual style">
            {['Tiberian', 'Red Alert'].map((l, i) => <button key={l} aria-pressed={look === i} onClick={() => { click(); ui().setLook(i as 0 | 1); }}>{l}</button>)}
          </div></div>
        <Toggle label="Sound" on={sound} set={v => ui().setSound(v)} />
        <Toggle label="Radio voice" on={radio} set={v => ui().setRadio(v)} />
        <Toggle label="Tips" on={tips} set={v => ui().setTips(v)} />
        <button className="btn wide" onClick={() => { click(); quitToTitle(); }}>{session.kind === 'local' ? 'Save and quit to title' : session.kind === 'host' ? 'End game for everyone and quit' : 'Leave the game'}</button>
        <small>Recent events</small>
        <div className="hist">{log.length ? log.slice(0, 10).map(l => <div key={l.id} className={l.cls}><time>{l.day}</time>{l.text}</div>) : <div>Nothing yet.</div>}</div>
      </div>
    </Modal>
  );
}

export function EndSheet() {
  const sim = useSim(); if (!sim) return null;
  const { g, me } = sim; const won = g.winner === me; const winner = g.winner !== null ? g.factions[g.winner] : null;
  const wm = winner?.mission ? lc(missionText(winner.mission)[0]) : null;
  const text = g.winner === null ? 'Every human power has been destroyed. The war is lost.'
    : won ? `Your sealed orders are fulfilled${wm ? `: ${wm}` : ''}.` : `${FACTIONS[g.winner].the[0].toUpperCase() + FACTIONS[g.winner].the.slice(1)} has fulfilled its sealed orders${wm ? `: ${wm}` : ''}.`;
  return (
    <Modal label={won ? 'Victory' : 'Defeat'} narrow onClose={() => useUi.getState().setOverlay(null)}>
      <div className="kicker">{dateStr(g.day)}</div>
      <h1 style={{ color: won ? 'var(--accent)' : 'var(--danger)' }}>{won ? 'Victory' : 'Defeat'}</h1>
      <p className="lede">{text}</p>
      <div className="stats">
        <div><small>Regions held</small><b>{g.regions.filter(r => r.owner === me).length}</b></div>
        <div><small>Battles won / lost</small><b>{g.stats.won[me] ?? 0} / {g.stats.lost[me] ?? 0}</b></div>
        <div><small>Days of war</small><b>{Math.round(g.day)}</b></div>
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => { click(); quitToTitle(sim.session.kind === 'local' ? 'solo' : undefined); }}>{sim.session.kind === 'local' ? 'Start a new war' : 'Back to title'}</button>
        <button className="btn" onClick={() => { click(); useUi.getState().setOverlay(null); }}>Look at the map</button>
      </div>
    </Modal>
  );
}
