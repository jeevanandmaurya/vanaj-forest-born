// The HUD's icons, drawn here as small line pictures in one style, so there is nothing to download and they stay sharp at any size.
const P = {
  heart: '<path class="f" d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.4 4 4.5 7 4.5c2 0 3.7 1 5 3 1.3-2 3-3 5-3 3 0 5.4 2.9 4.2 6.6-1.7 4.8-9.2 9.4-9.2 9.4z"/>',
  bolt: '<path class="f" d="M13 2 5 14h6l-1 8 8-12h-6z"/>',
  food: '<path class="f" d="M14.5 3.5a6 6 0 0 1 6 6c0 3.3-2.7 6-6 6-1 0-2-.3-2.8-.7L8.5 18a2.4 2.4 0 1 1-2.9 2.6A2.4 2.4 0 1 1 6 16l3.2-3.2a6 6 0 0 1 5.3-9.3z"/>',
  water: '<path class="f" d="M12 2.5s7 7.3 7 12a7 7 0 0 1-14 0c0-4.7 7-12 7-12z"/>',
  bag: '<path d="M8.5 7.5C8 4.5 9.6 3 12 3s4 1.5 3.5 4.5"/><path d="M6.5 7.5h11c2 3 3 6 3 8.5 0 3.5-3.5 5-8.5 5s-8.5-1.5-8.5-5c0-2.5 1-5.5 3-8.500z"/><path d="M9.5 12.500h5"/>',
  map: '<path d="M3 6l6-2.5 6 2.5 6-2.500v15l-6 2.5-6-2.5-6 2.500z"/><path d="M9 3.500v15M15 6v15"/>',
  notes: '<path d="M4.5 4.500A2.5 2.5 0 0 1 7 2h13v17H7a2.5 2.5 0 0 0-2.5 2.500z"/><path d="M8.5 7h7.500M8.5 11h5"/>',
  menu: '<path class="f" d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
  jump: '<path d="M5 12.500l7-7 7 7M5 19.500l7-7 7 7"/>',
  strike: '<path class="f" d="M12 2l2 6 6-2-3 6 5 3-6 1 1 6-5-4-5 4 1-6-6-1 5-3-3-6 6 2z"/>',
  aim: '<circle cx="12" cy="12" r="7"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>',
  shield: '<path d="M12 2.500l8 3v6c0 5-3.5 8.8-8 10.5-4.5-1.7-8-5.5-8-10.500v-6z"/>',
  use: '<path d="M8 12.500V6a1.5 1.5 0 0 1 3 0v5M11 11V4.500a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v6M17 9a1.5 1.5 0 0 1 3 0v6c0 4-2.5 7-7 7-3 0-4.5-1-6-3l-3.3-5a1.6 1.6 0 0 1 2.6-1.900L8 15"/>',
  crouch: '<circle class="f" cx="14.5" cy="4.5" r="2.5"/><path d="M12.5 9L8 14l5 2 1 5.500M8 14l-3 6M12.5 9l5.5 3.5"/>',
  call: '<path class="f" d="M3 9.500v5h4l6 5v-15l-6 5z"/><path d="M16.5 8.500a5 5 0 0 1 0 7M19 5.500a9.5 9.5 0 0 1 0 13"/>',
  climb: '<path d="M12 22V3M7.5 7.500L12 3l4.5 4.500M9 12.500h6M9 17.500h6"/>',
  sun: '<circle class="f" cx="12" cy="12" r="4.5"/><path d="M12 2v2.500M12 19.500V22M2 12h2.500M19.5 12H22M4.9 4.900l1.8 1.800M17.3 17.300l1.8 1.800M4.9 19.100l1.8-1.800M17.3 6.700l1.8-1.8"/>',
  moon: '<path class="f" d="M20 14.500A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.500z"/>',
  goal: '<path class="f" d="M12 3l7 9-7 9-7-9z"/>',
  fist: '<path d="M7 10.500V8a1.5 1.5 0 0 1 3 0v2.500M10 10V6.500a1.5 1.5 0 0 1 3 0V10M13 10V7a1.5 1.5 0 0 1 3 0v3M16 10.500V8.500a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6.5 7S6 18.5 6 15v-2.500c0-1.5 1-2.5 2.5-2.500H12a1.8 1.8 0 0 1 0 3.600h-2"/>',
  bleed: '<path class="f" d="M9 3s4.5 4.7 4.5 7.800a4.5 4.5 0 0 1-9 0C4.5 7.7 9 3 9 3z"/><path class="f" d="M17 12s3 3.2 3 5.300a3 3 0 0 1-6 0c0-2.1 3-5.3 3-5.300z"/>',
  sick: '<circle cx="12" cy="12" r="9"/><path d="M8 9.500h.01M16 9.500h.01M7.5 16c1.2-1.5 2.3-1.5 3 0 .7 1.5 2.3 1.5 3 0 .7-1.5 1.8-1.5 3 0"/>',
  drunk: '<circle class="f" cx="12" cy="6" r="3"/><circle class="f" cx="17.7" cy="10.2" r="3"/><circle class="f" cx="15.5" cy="17" r="3"/><circle class="f" cx="8.5" cy="17" r="3"/><circle class="f" cx="6.3" cy="10.2" r="3"/>',
  tired: '<path class="f" d="M13 2 5 14h6l-1 8 8-12h-6z"/><path d="M3 3l18 18"/>',
  cold: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M12 6L9.5 3.500M12 6l2.5-2.500M12 18l-2.5 2.500M12 18l2.5 2.5"/>',
  look: '<path d="M5 12l3.5-3.500M5 12l3.5 3.500M5 12h14M19 12l-3.5-3.500M19 12l-3.5 3.5"/>',
  move: '<circle cx="12" cy="12" r="8.5"/><circle class="f" cx="12" cy="12" r="3.5"/>',
};
export const icon = (k) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${P[k] || ''}</svg>`;
// the picture for a word used in the lessons' list of controls on a phone
const WORD = { aim: 'aim', block: 'shield', strike: 'strike', jump: 'jump', grab: 'jump', use: 'use', bag: 'bag', map: 'map', notes: 'notes', crouch: 'crouch', call: 'call', climb: 'climb', stick: 'move', look: 'look', drag: 'look', swipe: 'look' };
export const wordIcon = (w) => (WORD[w.toLowerCase()] ? icon(WORD[w.toLowerCase()]) : null);
