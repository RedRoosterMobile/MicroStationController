// A fake microSTATION for tests: answers the SysEx requests the pages send and reacts to parameter changes,
// mode changes, control changes and program changes. It models behaviour observed on the real unit:
//  - a track's sound is set with value = prog | bank << 7; a bank outside 0–16 is ignored (the program still changes)
//  - parameter changes only apply in the matching mode (Sequencer = 4, Program = 2/3, Combination = 0/1)
//  - bank select + program change only reach a track whose MIDI "Prog Chg" filter is on (off by default)
//  - changing the sound turns the arpeggiator off
import SAMPLE_NAMES from '../../drumsamples.json';
import SOUNDS from '../../sounds.json';
import { listen, ports } from '../lib/midi.js';
import { pack } from '../test-helpers.js';

const MODE = { COMBI_PLAY: 0, COMBI_EDIT: 1, PROG_PLAY: 2, PROG_EDIT: 3, SEQUENCER: 4, GLOBAL: 6 };
const HEADER_LENGTH = 6;
const ARP_BLOCK = { TEMPO: 620, FLAGS: 624, SLOT_A: 628, SLOT_B: 640 };
const TRACK_BASE = 664, TRACK_SIZE = 44;
const KIT_KEY_BASE = 24, KIT_KEY_SIZE = 68;
const GM_BANK = 4, GM_DRUM_BANK = 14;

const blankSlot = () => ({ pattern: 0, octave: 1, res: 3, gate: 80, vel: 100, swing: 0 });
const blankSound = slots => ({ bank: 0, num: 0, name: 'Init', tempo: 120, arp: 0, latch: 0, slots });

function bankFromSelect(msb, lsb) {                           // Bank Map KORG
  if (msb === 0x00) return lsb <= 3 ? lsb : null;
  if (msb === 0x79) return lsb === 0 ? GM_BANK : lsb <= 9 ? GM_BANK + lsb : null;
  if (msb === 0x78) return GM_DRUM_BANK;
  return null;
}

const nameBytes = (o, name) => { for (let i = 0; i < 24; i++) o[i] = name.charCodeAt(i) || 0x20; };

export function createFakeKeyboard({ mode = MODE.PROG_PLAY, ch = 0 } = {}) {
  const fake = {
    ch, mode,
    prog: blankSound({ P: blankSlot() }),
    combi: blankSound({ A: blankSlot(), B: blankSlot() }),
    tracks: Array.from({ length: 16 }, (_, i) => ({ prog: 0, bank: i === 9 ? GM_DRUM_BANK : GM_BANK, ch: i, status: 1, vol: 100, progChg: false })),
    drumPrograms: {},                                            // 'bank:num' -> { kitNo }
    kits: {},                                                    // kitNo -> { name, keys: { key: 'm123' | 's45' } }
    patternNames: Array.from({ length: 640 }, (_, i) => ({ name: `Pattern ${i}`, length: 16 })),
    memoryProtect: false,
    arpOffOnSoundChange: true,
    written: [],                                                 // object write requests that succeeded
    sent: [],                                                    // everything received from the page
    droppedRequests: 0,                                          // number of upcoming requests to ignore
    silent: false,                                               // ignore every request
    pendingBank: {},                                             // channel -> { msb, lsb } received since the last program change
  };

  const input = {};
  fake.out = { send: bytes => fake.receive([...bytes]) };
  fake.install = () => { ports.out = fake.out; listen(input); return fake; };
  fake.dropNext = n => { fake.droppedRequests = n; return fake; };

  const header = () => [0xF0, 0x42, 0x30 | fake.ch, 0x00, 0x01, 0x0D];
  const reply = bytes => queueMicrotask(() => input.onmidimessage?.({ data: bytes }));
  const answer = bytes => {                                      // replies to requests can be dropped or silenced
    if (fake.silent) return;
    if (fake.droppedRequests > 0) { fake.droppedRequests--; return; }
    reply(bytes);
  };

  const kind = () => [MODE.COMBI_PLAY, MODE.COMBI_EDIT].includes(fake.mode) ? 'combi' : [MODE.PROG_PLAY, MODE.PROG_EDIT].includes(fake.mode) ? 'prog' : null;
  const modeMatches = byte => byte === fake.mode || (fake.mode === MODE.PROG_EDIT && byte === 2) || (fake.mode === MODE.COMBI_EDIT && byte === 0);

  // ---- sounds ----
  function selectSound(sound, kindName, bank, num) {
    const list = SOUNDS[kindName === 'combi' ? 'combis' : 'programs'];
    const hit = list.find(s => s.bank === 'ABCD'[bank] && s.num === num);
    Object.assign(sound, { bank, num, name: hit?.name ?? 'Init' });
    if (fake.arpOffOnSoundChange) sound.arp = 0;
  }

  // ---- dumps ----
  function writeSlot(o, base, s) {
    o[base] = s.pattern & 0xFF; o[base + 1] = s.pattern >> 8;
    o[base + 2] = (s.res << 2) | (s.octave - 1);
    o[base + 4] = s.gate; o[base + 5] = s.vel; o[base + 6] = s.swing & 0xFF;
  }
  function currentDump(obj) {
    const o = new Array(obj === 2 ? 1400 : 700).fill(0);
    if (obj === 2) {
      fake.tracks.forEach((t, i) => {
        const b = TRACK_BASE + TRACK_SIZE * i;
        o[b] = t.prog; o[b + 1] = t.bank; o[b + 2] = t.ch | (t.status << 5); o[b + 5] = t.vol;
      });
    } else {
      const s = obj === 1 ? fake.combi : fake.prog;
      nameBytes(o, s.name);
      o[ARP_BLOCK.TEMPO] = Math.round(s.tempo * 100) & 0xFF; o[ARP_BLOCK.TEMPO + 1] = Math.round(s.tempo * 100) >> 8;
      o[ARP_BLOCK.FLAGS] = s.arp | (s.latch << 1);
      writeSlot(o, ARP_BLOCK.SLOT_A, s.slots.P ?? s.slots.A);
      if (s.slots.B) writeSlot(o, ARP_BLOCK.SLOT_B, s.slots.B);
    }
    return [...header(), 0x75, obj, 0x00, ...pack(o), 0xF7];
  }
  function dataDump(req) {
    const obj = req[7], echo = [req[8], req[9], req[10]];
    let o = [];
    if (obj === 0x00) {                                          // a Program: only the drum flag and kit number matter here
      o = new Array(800).fill(0);
      const drum = fake.drumPrograms[`${req[8]}:${req[10]}`];
      if (drum) { o[640] = 2; o[738] = drum.kitNo & 0xFF; o[739] = drum.kitNo >> 8; }
    } else if (obj === 0x04) {                                   // a drum kit: 128 keys of sample info
      const kit = fake.kits[req[10]];
      o = new Array(KIT_KEY_BASE + KIT_KEY_SIZE * 128).fill(0);
      nameBytes(o, kit?.name ?? 'Kit');
      for (const [key, id] of Object.entries(kit?.keys ?? {})) {
        const b = KIT_KEY_BASE + KIT_KEY_SIZE * key, n = +id.slice(1);
        o[b] = 1; o[b + 1] = id[0] === 's' ? 1 : 0; o[b + 2] = n & 0xFF; o[b + 3] = n >> 8;
      }
    } else if (obj === 0x16) {                                   // an arpeggio pattern: name and length
      const p = fake.patternNames[req[9] * 128 + req[10]];
      o = new Array(32).fill(0);
      nameBytes(o, p?.name ?? '');
      o[25] = p?.length ?? 0;
    } else return null;
    return [...header(), 0x73, obj, ...echo, 0x00, ...pack(o), 0xF7];
  }

  // ---- parameter changes ----
  function parameterChange(m) {
    const [modeByte, id, sub] = [m[7], m[9], m[11]];
    const value = (((m[12] & 0x0F) << 28) | (m[13] << 21) | (m[14] << 14) | (m[15] << 7) | m[16]) | 0;   // signed 32-bit
    if (!modeMatches(modeByte)) return;                          // ignored outside the matching mode
    if (fake.mode === MODE.SEQUENCER) {
      const t = fake.tracks[id - 0x04];                          // observed: track i is parameter id 0x04 + i, sub 0 = program select
      if (!t || sub !== 0) return;
      const bank = value >> 7;
      if (bank >= 0 && bank <= 16) t.bank = bank;
      t.prog = value & 127;
      return;
    }
    const s = kind() === 'combi' ? fake.combi : fake.prog;
    if (id === 0x02) {
      if (sub === 0) s.tempo = value / 100;
      else if (sub === 1) s.arp = value;
      else if (sub === 2) s.latch = value;
      return;
    }
    const slot = s.slots[id === 0x04 ? 'B' : kind() === 'combi' ? 'A' : 'P'];
    if (!slot) return;
    const fields = ['pattern', 'res', 'octave', 'gate', 'vel', 'swing'];
    slot[fields[sub]] = fields[sub] === 'octave' ? value + 1 : value;
  }

  // ---- channel messages ----
  // A bank select only takes effect with the next program change; without one the current bank is kept.
  function channelMessage(bytes) {
    const [status, d1, d2] = bytes, channel = status & 0x0F;
    const pending = fake.pendingBank[channel] ??= { msb: null, lsb: null };
    if ((status & 0xF0) === 0xB0 && d1 === 0x00) pending.msb = d2;
    else if ((status & 0xF0) === 0xB0 && d1 === 0x20) pending.lsb = d2;
    else if ((status & 0xF0) === 0xC0) {
      const bank = pending.msb === null ? null : bankFromSelect(pending.msb, pending.lsb ?? 0);
      delete fake.pendingBank[channel];
      if (fake.mode === MODE.SEQUENCER) {
        for (const t of fake.tracks) if (t.ch === channel && t.progChg) { t.prog = d1; if (bank !== null) t.bank = bank; }
      } else if (channel === fake.ch && kind()) {
        const sound = kind() === 'combi' ? fake.combi : fake.prog;
        selectSound(sound, kind(), bank ?? sound.bank, d1);
      }
    }
  }

  // ---- everything the page sends ----
  fake.receive = bytes => {
    fake.sent.push(bytes);
    if (bytes[0] !== 0xF0) { channelMessage(bytes); return; }
    if (bytes[1] === 0x7E) {                                     // universal: identity request, GM System On
      if (bytes[3] === 0x06) answer([0xF0, 0x7E, fake.ch, 0x06, 0x02, 0x42, 0x0D, 0, 0, 0, 1, 2, 3, 0xF7]);
      else if (bytes[3] === 0x09 && fake.mode === MODE.SEQUENCER) fake.tracks.forEach((t, i) => Object.assign(t, { prog: 0, bank: i === 9 ? GM_DRUM_BANK : GM_BANK, vol: 100 }));
      return;
    }
    if (bytes[1] !== 0x42) return;
    switch (bytes[6]) {
      case 0x12: answer([...header(), 0x42, fake.mode, 0xF7]); break;
      case 0x74: answer(currentDump(bytes[7])); break;
      case 0x72: { const d = dataDump(bytes); if (d) answer(d); break; }
      case 0x41: parameterChange(bytes); break;
      case 0x4E: fake.mode = bytes[7]; break;
      case 0x77: {                                                // object write: result 0 ok, 2 protected, 3 bad destination
        const [combi, bank, num] = [bytes[7], bytes[8], bytes[10]];
        const bad = bank > (combi ? 2 : 3) || num > 127;
        const result = fake.memoryProtect ? 2 : bad ? 3 : 0;
        if (result === 0) fake.written.push({ combi: !!combi, bank, num });
        answer([...header(), 0x24, result, 0xF7]);
        break;
      }
    }
  };
  return fake;
}

export { MODE, GM_BANK, GM_DRUM_BANK };

// The sample id ('m24', 's13', …) of the drum sample with this exact name.
const sampleId = name => Object.entries(SAMPLE_NAMES).find(([, n]) => n === name)[0];

// "PowerKit 2" as seen on the unit: kick C2, snare F2, closed hat F#3, open hat G3, crash C#3 (no toms, no ride).
export const powerKit2 = () => ({
  name: 'Power Kit 2',
  keys: { 36: sampleId('BD-Tight'), 41: sampleId('SD-Full Room'), 54: sampleId('Hi-Hat 1-Closed ff'), 55: sampleId('Hi-Hat 1-Open ff'), 49: sampleId('Crash Cymbal 2') },
});
