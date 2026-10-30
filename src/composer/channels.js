// The keyboard's global MIDI channel (for SysEx) and the preferred drum channel.
import { $ } from '../lib/dom.js';
import { sysexHeader } from '../lib/midi.js';
import { store } from '../lib/store.js';

export const gch = () => +$('gch').value;
export const hdr = () => sysexHeader(gch());
export const preferredDrumChannel = () => +$('dch').value;

// Move drum tracks to the preferred channel; whoever sits there swaps to the drum track's old channel.
export function applyDrumChannel(song) {
  const want = preferredDrumChannel();
  for (const d of song.tracks.filter(t => t.drums && t.ch !== want)) {
    const other = song.tracks.find(t => t !== d && t.ch === want);
    if (other) other.ch = d.ch;
    d.ch = want;
  }
}

// `onDrumChannelChange` runs after the user picks a different drum channel.
export function initChannels(onDrumChannelChange) {
  for (let i = 0; i < 16; i++) $('gch').add(new Option(i + 1, i));
  $('gch').value = store.get('comp.gch', 0);
  $('gch').onchange = () => store.set('comp.gch', gch());

  for (let i = 1; i <= 16; i++) $('dch').add(new Option(i, i));
  $('dch').value = store.get('comp.dch', 10);
  $('dch').onchange = () => { store.set('comp.dch', preferredDrumChannel()); onDrumChannelChange(); };
}
