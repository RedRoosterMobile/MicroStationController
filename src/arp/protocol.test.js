import { describe, expect, it } from 'vitest';
import { pack } from '../test-helpers.js';
import { ARP_SLOT, FN, GATE_STEP, PARAM, VEL_KEY, VEL_STEP, parseCurrent } from './protocol.js';

// A current-Program / Combination dump: 9 header bytes, packed body, F7.
const dump = body => [0xF0, 0x42, 0x30, 0x00, 0x01, 0x0D, FN.CURRENT_DUMP, 0, 0, ...pack(body), 0xF7];

function blankBody(length) {
  const o = new Array(length).fill(0);
  [...'Test Sound'].forEach((ch, i) => { o[i] = ch.charCodeAt(0); });
  o.fill(0x20, 10, 24);                                  // names are space padded
  return o;
}
function setSlot(o, base, { pattern, octave, res, gate, vel, swing }) {
  o[base] = pattern & 0xFF; o[base + 1] = pattern >> 8;
  o[base + 2] = (res << 2) | (octave - 1);
  o[base + 4] = gate; o[base + 5] = vel; o[base + 6] = swing & 0xFF;
}

describe('parseCurrent', () => {
  it('parses a Program: name, tempo, arp flags and the single slot', () => {
    const o = blankBody(700);
    o[620] = 12000 & 0xFF; o[621] = 12000 >> 8;          // 120.00 BPM
    o[624] = 0b11;
    setSlot(o, 628, { pattern: 300, octave: 2, res: 3, gate: 80, vel: 100, swing: 0 });
    const p = parseCurrent(dump(o), 'prog');
    expect(p).toEqual({
      kind: 'prog', name: 'Test Sound', tempo: 120, arp: 1, latch: 1,
      slots: { P: { pattern: 300, octave: 2, res: 3, gate: 80, vel: 100, swing: 0 } },
    });
  });

  it('parses tempo with hundredths and the arp / latch bits independently', () => {
    const o = blankBody(700);
    o[620] = 12345 & 0xFF; o[621] = 12345 >> 8;
    o[624] = 0b10;                                       // latch on, arp off
    const p = parseCurrent(dump(o), 'prog');
    expect(p.tempo).toBe(123.45);
    expect([p.arp, p.latch]).toEqual([0, 1]);
  });

  it('parses both arp slots of a Combination', () => {
    const o = blankBody(700);
    setSlot(o, 628, { pattern: 1, octave: 1, res: 0, gate: 10, vel: 20, swing: 5 });
    setSlot(o, 640, { pattern: 516, octave: 4, res: 5, gate: 90, vel: 127, swing: 0 });
    const p = parseCurrent(dump(o), 'combi');
    expect(Object.keys(p.slots)).toEqual(['A', 'B']);
    expect(p.slots.A).toMatchObject({ pattern: 1, octave: 1, res: 0 });
    expect(p.slots.B).toMatchObject({ pattern: 516, octave: 4, res: 5, gate: 90, vel: 127 });
  });

  it('reads negative swing as signed and keeps the special gate / velocity values', () => {
    const o = blankBody(700);
    setSlot(o, 628, { pattern: 0, octave: 1, res: 1, gate: GATE_STEP, vel: VEL_KEY, swing: -100 });
    expect(parseCurrent(dump(o), 'prog').slots.P).toMatchObject({ gate: 0x65, vel: 0x80, swing: -100 });
    setSlot(o, 628, { pattern: 0, octave: 1, res: 1, gate: 0, vel: VEL_STEP, swing: 100 });
    expect(parseCurrent(dump(o), 'prog').slots.P).toMatchObject({ vel: 0x81, swing: 100 });
  });

  it('decodes the 2-bit octave and 3-bit resolution fields', () => {
    for (const [octave, res] of [[1, 0], [2, 7], [3, 4], [4, 5]]) {
      const o = blankBody(700);
      setSlot(o, 628, { pattern: 0, octave, res, gate: 0, vel: 1, swing: 0 });
      expect(parseCurrent(dump(o), 'prog').slots.P).toMatchObject({ octave, res });
    }
  });

  it('rejects dumps that are too short for the kind', () => {
    expect(() => parseCurrent(dump(new Array(600).fill(0)), 'prog')).toThrow(/short dump/);
    expect(() => parseCurrent(dump(new Array(645).fill(0)), 'combi')).toThrow(/short dump/);
  });
});

describe('protocol constants', () => {
  it('keeps the parameter ids and sub ids the unit expects', () => {
    expect(PARAM).toEqual({ ARP_GLOBAL: 0x02, ARP_SLOT_A: 0x03, ARP_SLOT_B: 0x04 });
    expect(ARP_SLOT).toEqual({ PATTERN: 0, RESOLUTION: 1, OCTAVE: 2, GATE: 3, VELOCITY: 4, SWING: 5 });
    expect(FN.PARAM_CHANGE).toBe(0x41);
  });
});
