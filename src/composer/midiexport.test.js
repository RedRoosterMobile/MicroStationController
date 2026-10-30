import { describe, expect, it } from 'vitest';
import { songToMidi } from './midiexport.js';

// Minimal SMF reader: returns { format, ntrks, ppq, tracks: [[{ tick, bytes }]] }.
function readMidi(bytes) {
  let pos = 0;
  const u32 = () => (bytes[pos++] * 2 ** 24) + (bytes[pos++] << 16) + (bytes[pos++] << 8) + bytes[pos++];
  const u16 = () => (bytes[pos++] << 8) | bytes[pos++];
  const tag = () => String.fromCharCode(...bytes.slice(pos, pos += 4));
  expect(tag()).toBe('MThd');
  expect(u32()).toBe(6);
  const format = u16(), ntrks = u16(), ppq = u16();
  const tracks = [];
  for (let t = 0; t < ntrks; t++) {
    expect(tag()).toBe('MTrk');
    const end = u32() + pos, events = [];
    let tick = 0;
    while (pos < end) {
      let delta = 0, b;
      do { b = bytes[pos++]; delta = (delta << 7) | (b & 0x7F); } while (b & 0x80);
      tick += delta;
      const start = pos;
      if (bytes[pos] === 0xFF) pos += 3 + bytes[pos + 2];          // meta: FF type len data
      else pos += (bytes[pos] & 0xF0) === 0xC0 ? 2 : 3;
      events.push({ tick, bytes: [...bytes.slice(start, pos)] });
    }
    tracks.push(events);
  }
  expect(pos).toBe(bytes.length);
  return { format, ntrks, ppq, tracks };
}

const song = (tracks, tempo = 120) => ({ title: 'T', tempo, beats: 4, tracks });
const bass = { ch: 2, drums: false, bank: 4, program: 33, vol: 90, notes: [[1, 0.5, 40, 100]] };

describe('songToMidi', () => {
  it('writes a format 1 file with a tempo track plus one track per song track', () => {
    const m = readMidi(songToMidi(song([bass, { ...bass, ch: 3 }])));
    expect([m.format, m.ntrks, m.ppq]).toEqual([1, 3, 480]);
  });

  it('encodes the tempo as microseconds per quarter note', () => {
    const { tracks } = readMidi(songToMidi(song([bass], 120)));
    expect(tracks[0][0]).toEqual({ tick: 0, bytes: [0xFF, 0x51, 3, 0x07, 0xA1, 0x20] });   // 500000 µs
    expect(readMidi(songToMidi(song([bass], 100))).tracks[0][0].bytes.slice(3))
      .toEqual([0x09, 0x27, 0xC0]);                                                       // 600000 µs
  });

  it('starts each track with bank select, program change and volume on its channel', () => {
    const { tracks } = readMidi(songToMidi(song([bass])));
    expect(tracks[1].slice(0, 4).map(e => e.bytes)).toEqual([
      [0xB1, 0, 0x79], [0xB1, 32, 0], [0xC1, 33], [0xB1, 7, 90],
    ]);
  });

  it('uses the GM drum bank select for kit tracks', () => {
    const drums = { ch: 10, drums: true, bank: 14, program: 25, vol: 100, notes: [] };
    const { tracks } = readMidi(songToMidi(song([drums])));
    expect(tracks[1].slice(0, 3).map(e => e.bytes)).toEqual([[0xB9, 0, 0x78], [0xB9, 32, 0], [0xC9, 25]]);
  });

  it('places note on at the start tick and note off just before the end tick', () => {
    const { tracks } = readMidi(songToMidi(song([bass])));
    const notes = tracks[1].filter(e => (e.bytes[0] & 0xF0) === 0x90 || (e.bytes[0] & 0xF0) === 0x80);
    expect(notes).toEqual([
      { tick: 480, bytes: [0x91, 40, 100] },
      { tick: 719, bytes: [0x81, 40, 0] },                   // 1.5 beats - 1 tick
    ]);
  });

  it('clamps velocity, defaults a missing one, and enforces a minimum note length', () => {
    const t = { ...bass, notes: [[0, 1, 60, 300], [1, 1, 61, 0], [2, 1, 62], [3, 0, 63, 80]] };
    const { tracks } = readMidi(songToMidi(song([t])));
    const ons = tracks[1].filter(e => (e.bytes[0] & 0xF0) === 0x90).map(e => e.bytes[2]);
    expect(ons).toEqual([127, 1, 90, 80]);
    const off = tracks[1].find(e => e.bytes[0] === 0x81 && e.bytes[1] === 63);
    expect(off.tick).toBe(3 * 480 + Math.round(0.05 * 480) - 1);
  });

  it('keeps events ordered by time, with note offs before note ons at the same tick', () => {
    const t = { ...bass, notes: [[0, 1, 60, 100], [1, 1, 62, 100]] };      // 2nd note starts where the 1st ends
    const ticks = readMidi(songToMidi(song([t]))).tracks[1].map(e => e.tick);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });

  it('writes an end-of-track marker for every track', () => {
    for (const events of readMidi(songToMidi(song([bass]))).tracks) {
      expect(events.at(-1).bytes).toEqual([0xFF, 0x2F, 0]);
    }
  });

  it('encodes large delta times as variable-length quantities', () => {
    const t = { ...bass, notes: [[400, 1, 60, 100]] };                    // tick 192000 needs a 3-byte VLQ
    const { tracks } = readMidi(songToMidi(song([t], 120)));
    expect(tracks[1].find(e => e.bytes[0] === 0x91).tick).toBe(192000);
  });
});
