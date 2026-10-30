// Standard MIDI File export (format 1: a tempo track plus one track per song track).
import { $ } from '../lib/dom.js';
import { clampInt } from '../lib/util.js';
import { drumNote } from './kits.js';
import { bankLsb, bankMsb } from './sounds.js';
import { composer } from './state.js';

const PPQ = 480;
const u32 = n => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const u16 = n => [(n >> 8) & 255, n & 255];
function vlq(n) { const b = [n & 0x7F]; while ((n >>= 7)) b.unshift((n & 0x7F) | 0x80); return b; }

// `events` are { t: ticks, o: order at equal ticks, d: bytes }; returns an MTrk chunk.
function trackChunk(events) {
  events.sort((a, b) => a.t - b.t || a.o - b.o);
  const data = [];
  let last = 0;
  for (const e of events) { data.push(...vlq(e.t - last), ...e.d); last = e.t; }
  data.push(0, 0xFF, 0x2F, 0);                          // end of track
  return [0x4D, 0x54, 0x72, 0x6B, ...u32(data.length), ...data];
}

function songTrackEvents(t) {
  const c = t.ch - 1;
  const events = [
    { t: 0, o: 0, d: [0xB0 | c, 0, bankMsb(t.bank)] }, { t: 0, o: 0, d: [0xB0 | c, 32, bankLsb(t.bank)] },
    { t: 0, o: 0, d: [0xC0 | c, t.program] }, { t: 0, o: 0, d: [0xB0 | c, 7, t.vol] },
  ];
  for (const [start, dur, n, vel] of t.notes) {
    const key = drumNote(t, n);
    if (key === null) continue;
    events.push({ t: Math.round(start * PPQ), o: 1, d: [0x90 | c, key, clampInt(vel ?? 90, 1, 127)] });
    events.push({ t: Math.round((start + Math.max(0.05, dur)) * PPQ) - 1, o: 0, d: [0x80 | c, key, 0] });
  }
  return events;
}

function songToMidi(song) {
  const mpq = Math.round(60e6 / song.tempo);            // microseconds per quarter note
  const chunks = [trackChunk([{ t: 0, o: 0, d: [0xFF, 0x51, 3, (mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255] }])];
  for (const t of song.tracks) chunks.push(trackChunk(songTrackEvents(t)));
  return new Uint8Array([0x4D, 0x54, 0x68, 0x64, ...u32(6), ...u16(1), ...u16(chunks.length), ...u16(PPQ), ...chunks.flat()]);
}

function download() {
  const { song } = composer;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([songToMidi(song)], { type: 'audio/midi' }));
  a.download = (song.title || 'song').replace(/[^\w-]+/g, '_') + '.mid';
  a.click();
}

export function initMidiExport() { $('dl').onclick = download; }
