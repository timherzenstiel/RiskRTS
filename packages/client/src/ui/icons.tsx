// Inline SVG icons (24x24, currentColor).
import type { ReactNode } from 'react';
import type { UnitType } from '@riskrts/shared';

const Svg = ({ children, size, className }: { children: ReactNode; size?: number; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width={size} height={size} className={className}>{children}</svg>
);

export type IconKey = UnitType | 'trench' | 'factory' | 'barracks';

export function Icon({ k, size, className }: { k: IconKey; size?: number; className?: string }) {
  let p: ReactNode;
  switch (k) {
    case 'inf': p = <><circle cx="10" cy="5.5" r="3" /><path d="M6 21l1.6-9.5h4.8L14 21h-2.2l-.9-5-.9 5z" /><path d="M14.5 9.5l7-3.2.6 1.4-6.6 3.4z" /></>; break;
    case 'mg': p = <><path d="M2 10h12v3.4H2z" /><path d="M14 10.6h8v1.8h-8z" /><path d="M6 13l-3 8h2.2l3-8zM10 13l3 8h2.2l-3-8z" /></>; break;
    case 'art': p = <><circle cx="8" cy="16.5" r="4.4" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M9 11.5L20.5 6l1 2.3L10.2 14z" /></>; break;
    case 'tank': p = <><rect x="2" y="14" width="20" height="6" rx="3" /><path d="M6 14l2-4.5h8L18 14z" /><path d="M12 10.5h9.5v2H12z" /></>; break;
    case 'trench': p = <path d="M2 19h5v-6h4v6h4v-6h4v6h3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />; break;
    case 'factory': p = <path d="M3 20V10l5 3V9l5 3V5h3v7h5v8z" />; break;
    case 'barracks': p = <path d="M3 20v-9l9-6 9 6v9zM10 20h4v-5h-4z" fillRule="evenodd" />; break;
  }
  return <Svg size={size} className={className}>{p}</Svg>;
}

export const CloseIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l16 16M20 4L4 20" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" /></svg>;
export const MenuIcon = () => <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" /></svg>;
export const PauseIcon = () => <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>;
export const SwordsIcon = ({ size = 14 }: { size?: number }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 4l16 16M20 4L4 20" /></svg>;
export const SupplyIcon = () => <i className="sup" aria-hidden="true" />;
