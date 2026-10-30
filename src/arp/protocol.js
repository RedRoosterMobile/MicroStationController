// microSTATION SysEx protocol: function codes, parameter ids, sentinel values and dump parsing.
import { unpack } from '../lib/midi.js';
export { encodeParamValue } from '../lib/midi.js';

// SysEx function codes (byte 6 of a message)
export const FN = {
  MODE_REQUEST: 0x12, MODE_DATA: 0x42,
  DATA_DUMP_REQUEST: 0x72, DATA_DUMP: 0x73,
  CURRENT_DUMP_REQUEST: 0x74, CURRENT_DUMP: 0x75,
  PARAM_CHANGE: 0x41,
  MODE_CHANGE: 0x4E,
  OBJECT_WRITE: 0x77, WRITE_RESULT: 0x24,
};
export const DUMP_PATTERN_NAME = 0x16;       // data-dump object: arp pattern name/length

// Parameter-change targets. Arp on/off, latch and tempo live under ARP_GLOBAL; each arp slot has its own id.
export const PARAM = { ARP_GLOBAL: 0x02, ARP_SLOT_A: 0x03, ARP_SLOT_B: 0x04 };
export const ARP_GLOBAL = { TEMPO: 0x00, ON: 0x01, LATCH: 0x02 };
export const ARP_SLOT = { PATTERN: 0x00, RESOLUTION: 0x01, OCTAVE: 0x02, GATE: 0x03, VELOCITY: 0x04, SWING: 0x05 };

// Special values stored in the gate / velocity fields
export const GATE_STEP = 0x65;
export const VEL_KEY = 0x80;
export const VEL_STEP = 0x81;

export const MODE_NAMES = { 0: 'Combination Play', 1: 'Combination Edit', 2: 'Program Play', 3: 'Program Edit', 4: 'Sequencer', 6: 'Global' };

// Byte offsets inside the current Program / Combination dump. The arp block starts at 620:
// A (or the Program's single arp) at 628, B at 640.
const OFFSET = { TEMPO: 620, ARP_FLAGS: 624, SLOT_A: 628, SLOT_B: 640 };
const MIN_DUMP_LENGTH = { combi: 652, prog: 640 };

const s8 = v => v > 127 ? v - 256 : v;
export const text = (bytes, from, n) => String.fromCharCode(...bytes.slice(from, from + n)).trim();

function parseSlot(o, base) {
  return {
    pattern: o[base] | (o[base + 1] << 8),
    octave: (o[base + 2] & 3) + 1,
    res: (o[base + 2] >> 2) & 7,
    gate: o[base + 4],
    vel: o[base + 5],
    swing: s8(o[base + 6]),
  };
}

export function parseCurrent(d, kind) {
  const o = unpack(d.slice(9, d.length - 1));
  if (o.length < MIN_DUMP_LENGTH[kind]) throw new Error('short dump: ' + o.length);
  const slots = kind === 'combi'
    ? { A: parseSlot(o, OFFSET.SLOT_A), B: parseSlot(o, OFFSET.SLOT_B) }
    : { P: parseSlot(o, OFFSET.SLOT_A) };
  return {
    kind,
    name: text(o, 0, 24),
    tempo: (o[OFFSET.TEMPO] | (o[OFFSET.TEMPO + 1] << 8)) / 100,
    arp: o[OFFSET.ARP_FLAGS] & 1,
    latch: (o[OFFSET.ARP_FLAGS] >> 1) & 1,
    slots,
  };
}
