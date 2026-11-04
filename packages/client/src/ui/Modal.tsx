// Accessible modal shell: scrim + dialog, focuses the primary action, keeps Tab inside, restores focus on close.
import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ label, narrow, children, onClose }: { label: string; narrow?: boolean; children: ReactNode; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null; const el = ref.current;
    (el?.querySelector<HTMLElement>('.primary') ?? el?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
    return () => { if (prev && document.contains(prev)) prev.focus({ preventScroll: true }); };
  }, []);
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !ref.current) return;
    const f = [...ref.current.querySelectorAll<HTMLElement>('button:not(:disabled),input,a[href],[tabindex="0"]')]; if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div className="scrim" onKeyDown={trap} onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div ref={ref} className={'sheet glass' + (narrow ? ' narrow' : '')} role="dialog" aria-modal="true" aria-label={label}>{children}</div>
    </div>
  );
}
