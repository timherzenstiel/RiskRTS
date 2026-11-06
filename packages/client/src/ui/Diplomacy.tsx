// Diplomacy: treaties with each power, offers, notice, quick phrases; and the banner for offers waiting for our answer.
import { useState } from 'react';
import { DIPLO, FACTIONS, PHRASES, TREATY_NAMES, dateStr, enemiesOf, treatyOf, type TreatyKind } from '@riskrts/shared';
import { useSim, useUi } from '../game/store';
import { click } from './actions';
import { Modal } from './Modal';

const KINDS: TreatyKind[] = ['cease', 'nap', 'ally'];
const KDESC: Record<TreatyKind, string> = {
  cease: `No attacks for ten weeks; running battles between you stop.`,
  nap: 'No attacks until one side gives three weeks\' notice.',
  ally: 'Shared vision, and supply lines may run through each other\'s regions.',
};

export function DiplomacySheet() {
  const sim = useSim(); const [to, setTo] = useState(-1);
  if (!sim) return null;
  const { g, me } = sim, ui = useUi.getState, foes = enemiesOf(g, me);
  const close = () => { click(); ui().setOverlay(null); };
  const send = (cmd: Parameters<ReturnType<typeof useUi.getState>['order']>[0]) => { click(); ui().order(cmd); };
  return (
    <Modal label="Diplomacy" onClose={close}>
      <div className="kicker">{FACTIONS[me].name} · Foreign Office</div><h2>Diplomacy</h2>
      <p className="muted small">Treaties stop attacks between the signatories. Attacking a partner breaks the treaty: +{DIPLO.breakWW} war weariness and every power trusts you less. Sealed orders stay secret, so allies may still be rivals.</p>
      <div className="dipl">
        {FACTIONS.map((F, i) => {
          if (i === me) return null;
          const f = g.factions[i], t = treatyOf(g, me, i), pend = g.offers.find(o => o.from === me && o.to === i), trust = g.factions[i].trust?.[me];
          return (
            <div key={F.key} className={'dp' + (f.alive ? '' : ' dead')} style={{ '--c': F.color } as React.CSSProperties}>
              <div className="dn"><i className="dot" /><b>{F.name}</b>
                <small>{!f.alive ? 'Destroyed' : t ? `${TREATY_NAMES[t.kind]}${t.until !== undefined ? ` until ${dateStr(t.until)}` : ''}${t.ends !== undefined ? ` · ends ${dateStr(t.ends)}` : ''}` : foes.has(i) ? `At war · ${foes.get(i)} front${foes.get(i) === 1 ? '' : 's'}` : 'No treaty'}{f.ai && trust !== undefined && trust < 1 ? ` · trusts us ${Math.round(trust * 100)}%` : ''}</small></div>
              {f.alive && (
                <div className="da">
                  {pend ? <span className="muted tiny">Offer sent…</span> : KINDS.filter(k => !t || (t.kind !== k && k !== 'cease')).map(k => (
                    <button key={k} className="btn sm" title={KDESC[k]} onClick={() => send({ t: 'offer', to: i, kind: k })}>Offer {TREATY_NAMES[k].toLowerCase()}</button>
                  ))}
                  {t && t.kind !== 'cease' && t.ends === undefined && <button className="btn sm danger" onClick={() => send({ t: 'cancel', to: i })}>Give notice</button>}
                  <button className="btn sm" aria-pressed={to === i} onClick={() => { click(); setTo(to === i ? -1 : i); }}>Message</button>
                </div>
              )}
              {to === i && <div className="phr">{PHRASES.map((p, k) => <button key={k} className="btn sm" onClick={() => { send({ t: 'say', to: i, p: k }); setTo(-1); }}>{p}</button>)}</div>}
            </div>
          );
        })}
      </div>
      <div className="row"><button className="btn primary" onClick={close}>Back to the map</button>
        <button className="btn" onClick={() => setTo(to === -2 ? -1 : -2)}>Message all powers</button></div>
      {to === -2 && <div className="phr">{PHRASES.map((p, k) => <button key={k} className="btn sm" onClick={() => { send({ t: 'say', to: -1, p: k }); setTo(-1); }}>{p}</button>)}</div>}
    </Modal>
  );
}

/** Offers waiting for our answer, with a countdown. */
export function OfferBanner() {
  const sim = useSim(); if (!sim) return null;
  const { g, me } = sim, ui = useUi.getState;
  const offers = (g.offers ?? []).filter(o => o.to === me);
  if (!offers.length) return null;
  return (
    <div className="offers" role="alert">
      {offers.map(o => (
        <div key={o.id} className="glass offer" style={{ '--c': FACTIONS[o.from].color } as React.CSSProperties}>
          <span><span><b>{FACTIONS[o.from].name}</b> offers a {TREATY_NAMES[o.kind].toLowerCase()} · {Math.max(0, Math.ceil(o.exp - g.time))} s</span><small>{KDESC[o.kind]}</small></span>
          <button className="btn sm primary" onClick={() => { click(); ui().order({ t: 'answer', id: o.id, yes: true }); }}>Accept</button>
          <button className="btn sm" onClick={() => { click(); ui().order({ t: 'answer', id: o.id, yes: false }); }}>Decline</button>
        </div>
      ))}
    </div>
  );
}
