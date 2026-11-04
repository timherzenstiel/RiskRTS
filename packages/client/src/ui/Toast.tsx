import { useEffect } from 'react';
import { useUi } from '../game/store';

export function Toast() {
  const toast = useUi(s => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useUi.setState(s => (s.toast?.id === toast.id ? { toast: null } : s)), 3400);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return <div key={toast.id} id="toast" className="glass in" role="status">{toast.text}</div>;
}
