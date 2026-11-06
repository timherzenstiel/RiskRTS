// Interface language switch (title screen footer and the in-game menu).
import { Fragment, type ReactNode } from 'react';
import { LANGS, setLang, t, useLang } from '../i18n';
import { click } from './actions';

export function LangPicker({ className = '' }: { className?: string }) {
  const lang = useLang();
  return (
    <div className={'seg lang ' + className} role="group" aria-label={t('Language')}>
      {LANGS.map(l => <button key={l.id} lang={l.id} aria-pressed={lang === l.id} onClick={() => { click(); setLang(l.id); }}>{l.label}</button>)}
    </div>
  );
}

/** Like t(), but values wrapped as { raw } go in untouched: player names, room codes, dates already in the interface language. */
export function tn(tpl: string, ...args: (string | number | null | undefined | { raw: string })[]): string {
  const raws: string[] = [];
  const out = t(tpl, ...args.map(a => (a !== null && typeof a === 'object' ? String.fromCharCode(raws.push(a.raw)) : a)));
  return raws.length ? out.replace(/[\u0001-\u001f]/g, c => raws[c.charCodeAt(0) - 1] ?? c) : out;
}

/** Render a translated sentence that carries <b>…</b> or <kbd>…</kbd> markup, so the German can place it where it reads naturally. */
export function rich(s: string): ReactNode {
  const out: ReactNode[] = []; let last = 0, k = 0;
  for (const m of s.matchAll(/<(b|kbd)>(.*?)<\/\1>/g)) {
    if (m.index! > last) out.push(s.slice(last, m.index));
    out.push(m[1] === 'b' ? <b key={k++}>{m[2]}</b> : <kbd key={k++}>{m[2]}</kbd>);
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return <Fragment>{out}</Fragment>;
}
