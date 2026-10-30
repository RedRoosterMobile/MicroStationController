// Keyboard drum kits: learn which key plays what, then remap GM drum notes onto the kit's own keys.
import SAMPLE_NAMES from '../../drumsamples.json';
import { ports, request as midiRequest, unpack } from '../lib/midi.js';
import { store } from '../lib/store.js';
import { hdr } from './channels.js';
import { notifyTracksChange } from './state.js';

const request = (bytes, match, ms = 2500) => midiRequest(bytes, match, ms, 'no reply from the keyboard');

// What each GM drum note stands for, and how to recognise that in a drum sample's name.
const GM_ROLE = { 35: 'kick', 36: 'kick', 37: 'rim', 38: 'snare', 39: 'clap', 40: 'snare', 41: 'tomLo', 42: 'hatC', 43: 'tomLo', 44: 'hatP', 45: 'tomLo', 46: 'hatO', 47: 'tomMid', 48: 'tomMid', 49: 'crash', 50: 'tomHi', 51: 'ride', 53: 'ride', 57: 'crash', 59: 'ride' };
const ROLE_FALLBACK = { tomLo: ['tomMid', 'tomHi'], tomMid: ['tomLo', 'tomHi'], tomHi: ['tomMid', 'tomLo'], hatP: ['hatC'], hatO: ['hatC'], crash: ['ride'], ride: ['crash'], rim: ['snare'], clap: ['snare'] };
const GM_ANCHOR = { kick: 36, snare: 38, rim: 37, clap: 39, tomLo: 43, tomMid: 47, tomHi: 50, hatC: 42, hatP: 44, hatO: 46, crash: 49, ride: 51 };
// Ordinary hits beat effects (reverse, roll, flam, ghost, rim, gated...) when picking a key for a role.
const ODD_SAMPLE = /Reverse|Roll|Flam|Ghost|Rim|Side|Gated|Buzz|Lo-?Fi|Distort|Noise|Filter|Pitch|Tail|Hit \d|Sweep|Delay|Echo|Pad|Synth/i;
const ODD_PENALTY = 60;

function roleOf(name) {
  if (/^BD/i.test(name)) return 'kick';
  if (/^SD/i.test(name)) return 'snare';
  if (/Side ?stick|Rim ?shot|Rim$/i.test(name)) return 'rim';
  if (/Clap/i.test(name)) return 'clap';
  if (/Hi-?Hat/i.test(name)) return /Pedal/i.test(name) ? 'hatP' : /Open/i.test(name) ? 'hatO' : 'hatC';
  if (/Crash|Splash|China/i.test(name)) return 'crash';
  if (/Ride/i.test(name)) return 'ride';
  if (/^Tom/i.test(name)) return /Floor|Lo/i.test(name) ? 'tomLo' : /Mid/i.test(name) ? 'tomMid' : 'tomHi';
  return null;
}

const kitMaps = new Map(Object.entries(store.get('comp.kitmaps3', {})));   // "bank:prog" -> { kit, map: { gmNote: kitKey }, kick, snare, hat, ... }
const kitKey = t => t.bank + ':' + t.program;

// Read the program (which drum kit it uses), then that kit's per-key sample numbers, from the keyboard.
async function learnKit(bank, prog) {
  const key = bank + ':' + prog;
  if (kitMaps.has(key)) return kitMaps.get(key);
  const programDump = await request([...hdr(), 0x72, 0x00, bank, 0x00, prog, 0xF7], d => d[6] === 0x73 && d[7] === 0x00);
  const po = unpack(programDump.slice(12, programDump.length - 1));
  if ((po[640] & 7) !== 2) throw new Error('not a drum program');
  const kitNo = po[738] | (po[739] << 8);
  const kitDump = await request([...hdr(), 0x72, 0x04, 0x00, 0x00, kitNo & 0x1F, 0xF7], d => d[6] === 0x73 && d[7] === 0x04);
  const ko = unpack(kitDump.slice(12, kitDump.length - 1));
  const kitName = String.fromCharCode(...ko.slice(0, 24)).replace(/[^\x20-\x7E]/g, '').trim();

  const keysByRole = {}, sampleNames = {};
  for (let k = 0; k < 128; k++) {
    const b = 24 + 68 * k;
    if (ko[b] !== 1) continue;                            // key has no drum sample
    const name = SAMPLE_NAMES[(ko[b + 1] ? 's' : 'm') + (ko[b + 2] | (ko[b + 3] << 8))];
    if (!name) continue;
    sampleNames[k] = name;
    const role = roleOf(name);
    if (role) (keysByRole[role] ??= []).push(k);
  }
  // the key closest to where GM would put the sound, falling back to related roles (e.g. a missing tom → another tom)
  const pickKey = role => {
    for (const r of [role, ...(ROLE_FALLBACK[role] ?? [])]) {
      const keys = keysByRole[r];
      if (!keys?.length) continue;
      const score = k => Math.abs(k - GM_ANCHOR[r]) + (ODD_SAMPLE.test(sampleNames[k]) ? ODD_PENALTY : 0);
      return keys.reduce((a, b) => score(b) < score(a) ? b : a);
    }
    return null;
  };
  const map = {};
  for (const [gmNote, role] of Object.entries(GM_ROLE)) { const k = pickKey(role); if (k !== null) map[gmNote] = k; }
  const found = Object.fromEntries(Object.keys(GM_ANCHOR).map(r => [r, pickKey(r)]));
  const sampleOf = k => k === null ? null : sampleNames[k];
  const info = {
    kit: `${kitName} (#${kitNo})`, map,
    kick: found.kick, snare: found.snare, hat: found.hatC,
    kickN: sampleOf(found.kick), snareN: sampleOf(found.snare), hatN: sampleOf(found.hatC),
  };
  kitMaps.set(key, info);
  store.set('comp.kitmaps3', Object.fromEntries(kitMaps));
  return info;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = n => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);

// The note to actually send for a GM drum note on this track (null = this kit has nothing for it).
export function drumNote(t, n) {
  if (!t.drums || t.bank >= 4) return n;
  const info = kitMaps.get(kitKey(t));
  return info ? (info.map[n] ?? null) : n;
}

export function describeKit(t) {
  const i = kitMaps.get(kitKey(t));
  if (!i) return '';
  const f = (k, n) => k === null ? '–' : `${noteName(k)} ${n}`;
  return `${i.kit}: kick ${f(i.kick, i.kickN)}, snare ${f(i.snare, i.snareN)}, hat ${f(i.hat, i.hatN)}`;
}

// Learn the layout for a keyboard drum track (no-op for GM kits or without a connection), then refresh the track list.
export async function ensureKit(t) {
  if (!t.drums || t.bank >= 4 || !ports.out || !ports.inp) return;
  try { await learnKit(t.bank, t.program); t.kitHint = describeKit(t); }
  catch (e) { t.kitHint = 'kit layout unknown: ' + e.message; }
  notifyTracksChange();
}
