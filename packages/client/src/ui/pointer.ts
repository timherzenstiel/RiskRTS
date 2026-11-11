// Where the pointer last went down (client pixels): cards that answer a click on the map open there.
let ptr = { x: 0, y: 0 };
if (typeof window !== 'undefined') window.addEventListener('pointerdown', (e) => { ptr = { x: e.clientX, y: e.clientY }; }, true);
export const lastPointer = () => ptr;
