// Sidebar build cameo: painted portrait (rendered from the 3D models), cost bottom-left, hotkey top-right,
// a lock line ("SEP 1916") when not yet available. Click buys one; Shift-click or the ×5 corner buys five.
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Icon, type IconKey } from './icons';
import { t } from '../i18n';

/** Painted cameo portraits in public/art/cameo; keys without one fall back to the line icon on a plate well. */
const ART: Partial<Record<IconKey, string>> = {
  mg: 'nest', art: 'gun',
  trench: 'trench', sand: 'trench', wire: 'wire', pill: 'nest', bunk: 'bunker', fort: 'gun',
  factory: 'house', barracks: 'house',
};
const base = import.meta.env.BASE_URL ?? '/';
/** Units have a portrait per nation (tools/bake/cameos.py); works and buildings share one. */
const PER_NATION = new Set<IconKey>(['inf', 'mg', 'art', 'tank', 'plane']);
export const cameoUrl = (k: IconKey, nation?: number) =>
  nation !== undefined && PER_NATION.has(k) ? `${base}art/cameo/${k}_${nation}.webp` : ART[k] ? `${base}art/cameo/${ART[k]}.webp` : null;

export interface CameoProps {
  k: IconKey;
  name: string;
  /** Cost line (bottom-left); a string such as "Built" or "Max" replaces the cost. */
  cost: ReactNode;
  hotkey?: string;
  /** Shown across the cameo when locked, e.g. "Sep 1916" or "Needs factory". */
  lock?: string;
  disabled?: boolean;
  /** Small pips (trench depth etc.) in the top-left. */
  pips?: string;
  /** Count badge (top-left), e.g. units already here. */
  count?: number;
  title: string;
  onBuy: (five: boolean) => void;
  /** What one purchase gives (e.g. "100 men · 100 rifles"), shown above the name. */
  gets?: ReactNode;
  /** Show a ×5 corner button. */
  five?: boolean;
  fiveDisabled?: boolean;
  national?: boolean;
  done?: boolean;
  /** Faction whose portrait to show for unit cameos. */
  nation?: number;
}

const Info = createContext<(t: string | null) => void>(() => {});

export function Cameo({ k, name, cost, gets, hotkey, lock, disabled, pips, count, title, onBuy, five, fiveDisabled, national, done, nation }: CameoProps) {
  const url = cameoUrl(k, nation); const say = useContext(Info); const line = `${name} · ${title}`;
  return (
    <div className={'cameo' + (lock ? ' locked' : '') + (done ? ' done' : '') + (national ? ' nat' : '')}
      onPointerEnter={() => say(line)} onPointerLeave={() => say(null)} onFocus={() => say(line)} onBlur={() => say(null)}>
      <button className="cm-b" disabled={disabled} title={title} aria-label={`${name}: ${title}`} onClick={e => onBuy(e.shiftKey)}>
        <span className="cm-art" aria-hidden="true">{url ? <img src={url} alt="" draggable={false} /> : <Icon k={k} />}</span>
        {hotkey && <kbd className="cm-k" title={t('Keyboard shortcut: {0}', hotkey)}>{t('key {0}', hotkey)}</kbd>}
        {pips && <span className="cm-p" aria-hidden="true">{pips}</span>}
        {count !== undefined && count > 0 && <span className="cm-n" title={t('{0} already in this region', count)}>{t('{0} here', count)}</span>}
        {lock && <span className="cm-lock">{lock}</span>}
        <span className="cm-f"><span className="cm-c">{cost}</span>{gets && <span className="cm-g">{gets}</span>}<span className="cm-nm">{name}</span></span>
      </button>
      {five && <button className="cm-5" disabled={fiveDisabled} aria-label={t('{0}: buy five', name)} title={t('Buy five at once (or Shift-click)')} onClick={() => onBuy(true)}>{t('buy 5')}</button>}
    </div>
  );
}

/** A 2-column cameo grid with an info line underneath that describes the cameo under the pointer (or in focus). */
export function CameoGrid({ children, label, hint }: { children: ReactNode; label: string; hint?: string }) {
  const [info, setInfo] = useState<string | null>(null);
  return (
    <Info.Provider value={setInfo}>
      <div className="cameos" role="group" aria-label={label}>{children}</div>
      <p className="cm-info" aria-live="polite">{info ?? hint ?? ''}</p>
    </Info.Provider>
  );
}
