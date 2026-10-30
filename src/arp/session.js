// Shared mutable state of the arp page, plus a change notification the UI subscribes to.
export const session = {
  ch: 0,                 // MIDI channel of the connected unit (0-based)
  state: null,           // last parsed Program / Combination, or null when not in a playable mode
  activeSlot: 'P',       // which arp slot the pattern controls address ('P', or 'A' / 'B' in a Combination)
  curSound: null,        // raw index of the selected sound, if known (bank * 128 + number)
  modeLabel: '–',        // "Keyboard mode: …" text
};

const listeners = [];
export const onSessionChange = fn => listeners.push(fn);
export const notifySessionChange = () => listeners.forEach(fn => fn());
