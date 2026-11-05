// National flags of the six powers as they flew in 1914, drawn as small SVGs (3:2).
//  GB Union Flag · FR tricolore · RU white-blue-red civil flag · DE black-white-red Reichsflagge ·
//  AH the Austro-Hungarian civil ensign (Austrian red-white-red beside Hungarian red-white-green) · OT red with crescent and star ·
//  US the 48-star flag (1912-1959).

export function Flag({ f, className }: { f: number; className?: string }) {
  const p = { viewBox: '0 0 30 20', className: 'flag ' + (className ?? ''), 'aria-hidden': true as const };
  switch (f) {
    case 0: return (
      <svg {...p}><clipPath id="uj"><rect width="30" height="20" /></clipPath><g clipPath="url(#uj)">
        <rect width="30" height="20" fill="#012169" />
        <path d="M0 0L30 20M30 0L0 20" stroke="#fff" strokeWidth="4" />
        <path d="M0 0L30 20M30 0L0 20" stroke="#c8102e" strokeWidth="1.4" />
        <path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6" />
        <path d="M15 0v20M0 10h30" stroke="#c8102e" strokeWidth="3.4" /></g></svg>);
    case 1: return (<svg {...p}><rect width="10" height="20" fill="#002395" /><rect x="10" width="10" height="20" fill="#fff" /><rect x="20" width="10" height="20" fill="#ed2939" /></svg>);
    case 2: return (<svg {...p}><rect width="30" height="7" fill="#fff" /><rect y="6.67" width="30" height="6.67" fill="#0039a6" /><rect y="13.33" width="30" height="6.67" fill="#d52b1e" /></svg>);
    case 3: return (<svg {...p}><rect width="30" height="7" fill="#111" /><rect y="6.67" width="30" height="6.67" fill="#fff" /><rect y="13.33" width="30" height="6.67" fill="#dd0000" /></svg>);
    case 4: return (
      <svg {...p}><rect width="15" height="20" fill="#ed2939" /><rect y="6.67" width="15" height="6.67" fill="#fff" />
        <rect x="15" width="15" height="20" fill="#fff" /><rect x="15" width="15" height="6.67" fill="#ce2939" /><rect x="15" y="13.33" width="15" height="6.67" fill="#477050" /></svg>);
    case 5: return (
      <svg {...p}><rect width="30" height="20" fill="#e30a17" />
        <circle cx="12.5" cy="10" r="5" fill="#fff" /><circle cx="13.8" cy="10" r="4" fill="#e30a17" />
        <path d="M16.20 10.00L17.83 9.44L17.86 7.72L18.89 9.10L20.54 8.59L19.55 10.00L20.54 11.41L18.89 10.90L17.86 12.28L17.83 10.56z" fill="#fff" /></svg>);
    case 6: return (
      <svg {...p}><rect y="0.000" width="30" height="1.538" fill="#b22234" /><rect y="1.538" width="30" height="1.538" fill="#fff" /><rect y="3.077" width="30" height="1.538" fill="#b22234" /><rect y="4.615" width="30" height="1.538" fill="#fff" /><rect y="6.154" width="30" height="1.538" fill="#b22234" /><rect y="7.692" width="30" height="1.538" fill="#fff" /><rect y="9.231" width="30" height="1.538" fill="#b22234" /><rect y="10.769" width="30" height="1.538" fill="#fff" /><rect y="12.308" width="30" height="1.538" fill="#b22234" /><rect y="13.846" width="30" height="1.538" fill="#fff" /><rect y="15.385" width="30" height="1.538" fill="#b22234" /><rect y="16.923" width="30" height="1.538" fill="#fff" /><rect y="18.462" width="30" height="1.538" fill="#b22234" />
        <rect width="12" height="10.769" fill="#3c3b6e" /><g fill="#fff"><circle cx="1.05" cy="1.00" r=".38" /><circle cx="2.55" cy="1.00" r=".38" /><circle cx="4.05" cy="1.00" r=".38" /><circle cx="5.55" cy="1.00" r=".38" /><circle cx="7.05" cy="1.00" r=".38" /><circle cx="8.55" cy="1.00" r=".38" /><circle cx="10.05" cy="1.00" r=".38" /><circle cx="11.55" cy="1.00" r=".38" /><circle cx="1.05" cy="2.60" r=".38" /><circle cx="2.55" cy="2.60" r=".38" /><circle cx="4.05" cy="2.60" r=".38" /><circle cx="5.55" cy="2.60" r=".38" /><circle cx="7.05" cy="2.60" r=".38" /><circle cx="8.55" cy="2.60" r=".38" /><circle cx="10.05" cy="2.60" r=".38" /><circle cx="11.55" cy="2.60" r=".38" /><circle cx="1.05" cy="4.20" r=".38" /><circle cx="2.55" cy="4.20" r=".38" /><circle cx="4.05" cy="4.20" r=".38" /><circle cx="5.55" cy="4.20" r=".38" /><circle cx="7.05" cy="4.20" r=".38" /><circle cx="8.55" cy="4.20" r=".38" /><circle cx="10.05" cy="4.20" r=".38" /><circle cx="11.55" cy="4.20" r=".38" /><circle cx="1.05" cy="5.80" r=".38" /><circle cx="2.55" cy="5.80" r=".38" /><circle cx="4.05" cy="5.80" r=".38" /><circle cx="5.55" cy="5.80" r=".38" /><circle cx="7.05" cy="5.80" r=".38" /><circle cx="8.55" cy="5.80" r=".38" /><circle cx="10.05" cy="5.80" r=".38" /><circle cx="11.55" cy="5.80" r=".38" /><circle cx="1.05" cy="7.40" r=".38" /><circle cx="2.55" cy="7.40" r=".38" /><circle cx="4.05" cy="7.40" r=".38" /><circle cx="5.55" cy="7.40" r=".38" /><circle cx="7.05" cy="7.40" r=".38" /><circle cx="8.55" cy="7.40" r=".38" /><circle cx="10.05" cy="7.40" r=".38" /><circle cx="11.55" cy="7.40" r=".38" /><circle cx="1.05" cy="9.00" r=".38" /><circle cx="2.55" cy="9.00" r=".38" /><circle cx="4.05" cy="9.00" r=".38" /><circle cx="5.55" cy="9.00" r=".38" /><circle cx="7.05" cy="9.00" r=".38" /><circle cx="8.55" cy="9.00" r=".38" /><circle cx="10.05" cy="9.00" r=".38" /><circle cx="11.55" cy="9.00" r=".38" /></g></svg>);
    default: return null;
  }
}
