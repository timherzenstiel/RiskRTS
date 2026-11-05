// Inline SVG icons (24x24, currentColor).
import type { ReactNode } from 'react';
import type { UnitType } from '@riskrts/shared';

const Svg = ({ children, size, className }: { children: ReactNode; size?: number; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width={size} height={size} className={className}>{children}</svg>
);

export type IconKey = UnitType | 'trench' | 'factory' | 'barracks' | 'airfield' | 'pill' | 'fort' | 'flak' | 'bunk' | 'sand' | 'wire' | 'patrol' | 'recon' | 'spy';

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
    case 'plane': p = <><path d="M2 10.5h20v2.2H2zM3 15h18v1.8H3z" /><path d="M10 6h3v14h-3z" /><path d="M8 18.5h7V20H8z" /></>; break;
    case 'airfield': p = <><path d="M2 19h20v2H2z" /><path d="M4 17V9.5C4 7 6 5 8.5 5h0C11 5 13 7 13 9.5V17z" /><path d="M15 17V11h6v6z" /></>; break;
    case 'pill': p = <><path d="M3 18v-5.5C3 9 7 6 12 6s9 3 9 6.5V18z" /><path d="M7 12h10v1.8H7z" fill="#000" fillOpacity=".55" /></>; break;
    case 'fort': p = <><path d="M2 19c0-3 2-5 4-5h12c2 0 4 2 4 5z" /><path d="M10 12l11-6 .9 1.8L11.5 14z" /></>; break;
    case 'bunk': p = <><path d="M1 19c1-4 4-7 11-7s10 3 11 7z" /><path d="M5 15h14v4H5z" /><path d="M7.5 16h3v1.2h-3zM13.5 16h3v1.2h-3z" fill="#000" fillOpacity=".55" /></>; break;
    case 'sand': p = <><rect x="2" y="15" width="6.4" height="4" rx="1.6" /><rect x="8.8" y="15" width="6.4" height="4" rx="1.6" /><rect x="15.6" y="15" width="6.4" height="4" rx="1.6" /><rect x="5.4" y="10.6" width="6.4" height="4" rx="1.6" /><rect x="12.2" y="10.6" width="6.4" height="4" rx="1.6" /></>; break;
    case 'wire': p = <><path d="M4 21V7M12 21V7M20 21V7" stroke="currentColor" strokeWidth="2" /><path d="M2 10l4 3 4-3 4 3 4-3 4 3M2 16l4 3 4-3 4 3 4-3 4 3" fill="none" stroke="currentColor" strokeWidth="1.4" /></>; break;
    case 'patrol': p = <><path d="M4 13c1-3 4-4 7-4h4l3-3 1 1-1.5 3c1.5 1 2.5 2 2.5 4v1h-2l-1-2-1 2v4h-2v-4h-5l-1 4H6l.5-4.5L4 15z" /><circle cx="11" cy="5" r="2" /></>; break;
    case 'recon': p = <><path d="M2 10.5h20v2.2H2z" /><path d="M10 6h3v11h-3z" /><circle cx="11.5" cy="19.5" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></>; break;
    case 'spy': p = <><path d="M5 9h14l-1.5-4.5h-11z" /><path d="M3 9.5h18v1.8H3z" /><circle cx="8" cy="15" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="16" cy="15" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M10.5 14.6h3v1.2h-3z" /><path d="M8 20c2 1.5 6 1.5 8 0" fill="none" stroke="currentColor" strokeWidth="1.6" /></>; break;
    case 'flak': p = <><path d="M4 20h16v-2H4z" /><path d="M8 18l2-5h4l2 5z" /><path d="M11 13L17.5 3l1.7 1-6.3 10z" /></>; break;
  }
  return <Svg size={size} className={className}>{p}</Svg>;
}

export const CloseIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l16 16M20 4L4 20" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" /></svg>;
export const MenuIcon = () => <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" /></svg>;
export const PauseIcon = () => <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>;
export const SwordsIcon = ({ size = 14 }: { size?: number }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 4l16 16M20 4L4 20" /></svg>;
export const SupplyIcon = () => <i className="sup" aria-hidden="true" />;
export const HandshakeIcon = () => <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M2 11l4-4 4 2 3-2 4 1 5 4" /><path d="M6 7l-1 7 5 5c1 1 2 1 3 0l5-5" /><path d="M10 14l2 2M12 12l2 2M14 10.5l2 2" /></svg>;
