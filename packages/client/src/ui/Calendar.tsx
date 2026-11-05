// The war calendar: what arrives when for this power, rushing one development a year, and the doctrine choice each war year.
import { DOCTRINES, FACTIONS, RUSH, TECH, dateOf, doctrineDef, doctrinesOf, favouriteDoctrine, monthStr, techDayFor, techOn } from '@riskrts/shared';
import { useSim, useUi } from '../game/store';
import { click } from './actions';
import { Modal } from './Modal';
import { SupplyIcon } from './icons';

export function CalendarSheet() {
  const sim = useSim(); if (!sim) return null;
  const { g, me } = sim, f = g.factions[me], ui = useUi.getState, y = dateOf(g.day).y;
  const close = () => { click(); ui().setOverlay(null); };
  const canRush = f.rushY !== y && f.supply >= RUSH.cost;
  return (
    <Modal label="War calendar" onClose={close}>
      <div className="kicker">{FACTIONS[me].name} · General Staff</div><h2>War calendar</h2>
      <p className="muted small">New weapons and methods arrive with the calendar. Once a war year you can rush one development by six months for {RUSH.cost} supply{f.rushY === y ? ' (used this year)' : ''}.</p>
      <div className="cal">
        {TECH.map(t => {
          const d = techDayFor(me, t.key, f.rushed), on = techOn(g, me, t.key);
          return (
            <div key={t.key} className={'cr' + (on ? ' on' : '')}>
              <span className="cd">{on ? 'In service' : monthStr(d)}</span>
              <span className="ct"><b>{t.name}{f.rushed?.includes(t.key) ? ' · rushed' : ''}</b><small>{t.desc}</small></span>
              {!on && !f.rushed?.includes(t.key) && <button className="buy plain" disabled={!canRush} title={canRush ? 'Bring forward by six months' : f.rushY === y ? 'One rush per war year' : 'Not enough supply'} onClick={() => { click(); ui().order({ t: 'rush', tech: t.key }); }}>Rush <SupplyIcon />{RUSH.cost}</button>}
            </div>
          );
        })}
      </div>
      <div className="lbl"><span>Doctrines adopted</span></div>
      <div className="docs-all">
        {FACTIONS.map((F, i) => (
          <div key={F.key} className={i === me ? 'me' : ''}><i className="dot" style={{ '--c': F.color } as React.CSSProperties} /><b>{F.short}</b>
            <span>{(g.factions[i].doctrines ?? []).map(k => doctrineDef(k).name).join(' · ') || '–'}</span></div>
        ))}
      </div>
      <div className="row"><button className="btn primary" onClick={close}>Back to the map</button></div>
    </Modal>
  );
}

export function DoctrineSheet() {
  const sim = useSim(); if (!sim) return null;
  const { g, me } = sim, f = g.factions[me], ui = useUi.getState;
  const year = f.docOffer; if (!year) return null;
  const left = Math.max(0, Math.ceil((f.docDue ?? g.time) - g.time)), fav = favouriteDoctrine(me, year);
  const pick = (k: typeof fav) => { click(); ui().order({ t: 'doctrine', doc: k }); ui().setOverlay(null); };
  return (
    <Modal label={`Doctrine for ${year}`} onClose={() => ui().setOverlay(null)}>
      <div className="kicker">{year} · General Staff conference</div><h2>Choose this year's doctrine</h2>
      <p className="muted small">One doctrine per war year, kept for the rest of the war. If no choice is made within {left} s, the War Office takes the one it favours.</p>
      <div className="fuse" role="img" aria-label={`${left} seconds left`}><i style={{ width: `${Math.min(100, left / 60 * 100)}%` }} /><b>{left}s</b></div>
      <div className="doctrines desk">
        {doctrinesOf(year).map((d, i) => (
          <button key={d.key} className="doc dossier" style={{ '--tilt': `${(i - 1) * 2.2}deg` } as React.CSSProperties} onClick={() => pick(d.key)}>
            <span className="tab">File {year}/{i + 1}</span>
            <b>{d.name}{d.key === fav ? <span className="badge">Favoured</span> : null}</b><small>{d.desc}</small>
          </button>
        ))}
      </div>
      {(f.doctrines?.length ?? 0) > 0 && <p className="muted tiny">Adopted so far: {f.doctrines!.map(k => DOCTRINES.find(d => d.key === k)!.name).join(', ')}.</p>}
    </Modal>
  );
}
