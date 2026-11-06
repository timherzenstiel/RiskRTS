// Diplomacy: treaties with each power, offers, notice, quick phrases; and the banner for offers waiting for our answer.
import { useState } from 'react';
import { DIPLO, FACTIONS, PHRASES, TREATY_NAMES, enemiesOf, treatyOf, type TreatyKind } from '@riskrts/shared';
import { dateStr, useSim, useUi } from '../game/store';
import { t, tx } from '../i18n';
import { tn } from './LangPicker';
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
    <Modal label={t('Diplomacy')} onClose={close}>
      <div className="kicker">{tx(FACTIONS[me].name)} · {t('Foreign Office')}</div><h2>{t('Diplomacy')}</h2>
      <p className="muted small">{t('Treaties stop attacks between the signatories. Attacking a partner breaks the treaty: +{0} war weariness and every power trusts you less. Sealed orders stay secret, so allies may still be rivals.', DIPLO.breakWW)}</p>
      <div className="dipl">
        {FACTIONS.map((F, i) => {
          if (i === me) return null;
          const f = g.factions[i], tr = treatyOf(g, me, i), pend = g.offers.find(o => o.from === me && o.to === i), trust = g.factions[i].trust?.[me];
          return (
            <div key={F.key} className={'dp' + (f.alive ? '' : ' dead')} style={{ '--c': F.color } as React.CSSProperties}>
              <div className="dn"><i className="dot" /><b>{tx(F.name)}</b>
                <small>{!f.alive ? t('Destroyed') : tr ? `${tx(TREATY_NAMES[tr.kind])}${tr.until !== undefined ? ` ${tn('until {0}', { raw: dateStr(tr.until) })}` : ''}${tr.ends !== undefined ? ` · ${tn('ends {0}', { raw: dateStr(tr.ends) })}` : ''}` : foes.has(i) ? `${t('At war')} · ${foes.get(i) === 1 ? t('1 front') : t('{0} fronts', foes.get(i))}` : t('No treaty')}{f.ai && trust !== undefined && trust < 1 ? ` · ${t('trusts us {0}%', Math.round(trust * 100))}` : ''}</small></div>
              {f.alive && (
                <div className="da">
                  {pend ? <span className="muted tiny">{t('Offer sent…')}</span> : KINDS.filter(k => !tr || (tr.kind !== k && k !== 'cease')).map(k => (
                    <button key={k} className="btn sm" title={t(KDESC[k])} onClick={() => send({ t: 'offer', to: i, kind: k })}>{t(`Offer ${TREATY_NAMES[k].toLowerCase()}`)}</button>
                  ))}
                  {tr && tr.kind !== 'cease' && tr.ends === undefined && <button className="btn sm danger" onClick={() => send({ t: 'cancel', to: i })}>{t('Give notice')}</button>}
                  <button className="btn sm" aria-pressed={to === i} onClick={() => { click(); setTo(to === i ? -1 : i); }}>{t('Message')}</button>
                </div>
              )}
              {to === i && <div className="phr">{PHRASES.map((p, k) => <button key={k} className="btn sm" onClick={() => { send({ t: 'say', to: i, p: k }); setTo(-1); }}>{tx(p)}</button>)}</div>}
            </div>
          );
        })}
      </div>
      <div className="row"><button className="btn primary" onClick={close}>{t('Back to the map')}</button>
        <button className="btn" onClick={() => setTo(to === -2 ? -1 : -2)}>{t('Message all powers')}</button></div>
      {to === -2 && <div className="phr">{PHRASES.map((p, k) => <button key={k} className="btn sm" onClick={() => { send({ t: 'say', to: -1, p: k }); setTo(-1); }}>{tx(p)}</button>)}</div>}
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
          <span><span><b>{tx(FACTIONS[o.from].name)}</b> {t(`offers a ${TREATY_NAMES[o.kind].toLowerCase()}`)} · {Math.max(0, Math.ceil(o.exp - g.time))} s</span><small>{t(KDESC[o.kind])}</small></span>
          <button className="btn sm primary" onClick={() => { click(); ui().order({ t: 'answer', id: o.id, yes: true }); }}>{t('Accept')}</button>
          <button className="btn sm" onClick={() => { click(); ui().order({ t: 'answer', id: o.id, yes: false }); }}>{t('Decline')}</button>
        </div>
      ))}
    </div>
  );
}
