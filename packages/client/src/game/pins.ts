// Envelope pins of the Inbox on the map (design-play §2): the UI fills the list, the label layer draws it every frame, and a
// click on a pin opens that item. Kept apart so the renderer does not depend on the React interface.
export interface Pin { key: string; region: number; sector?: number; urg: 0 | 1 | 2; title: string }
export const pins: { items: Pin[]; onClick?: (key: string, region: number) => void } = { items: [] };
