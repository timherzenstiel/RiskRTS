import { useState } from 'react';
import { useUi, type Overlay } from '../game/store';
import { EndSheet, HelpSheet, MenuSheet, OrdersSheet } from './Sheets';
import { ReportsSheet } from './Reports';
import { NationSheet } from './Nation';
import { CalendarSheet, DoctrineSheet } from './Calendar';
import { DiplomacySheet } from './Diplomacy';

/** Renders whichever modal the store says is open. Help remembers where it was opened from. */
export function Overlays() {
  const overlay = useUi(s => s.overlay); const [helpFrom, setHelpFrom] = useState<Overlay>('orders');
  const openHelp = (from: Overlay) => () => { setHelpFrom(from); useUi.setState({ overlay: 'help' }); };
  const backFromHelp = () => useUi.getState().setOverlay(helpFrom);
  switch (overlay) {
    case 'orders': return <OrdersSheet onHelp={openHelp('orders')} />;
    case 'menu': return <MenuSheet onHelp={openHelp('menu')} />;
    case 'help': return <HelpSheet onBack={backFromHelp} />;
    case 'end': return <EndSheet />;
    case 'reports': return <ReportsSheet />;
    case 'nation': return <NationSheet />;
    case 'calendar': return <CalendarSheet />;
    case 'doctrine': return <DoctrineSheet />;
    case 'diplomacy': return <DiplomacySheet />;
    default: return null;
  }
}
