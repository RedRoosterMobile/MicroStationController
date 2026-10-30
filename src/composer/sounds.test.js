import { describe, expect, it } from 'vitest';
import { BANK_GM, BANK_GM_DRUMS, bankLsb, bankMsb, instrumentOptions, kbdByKey, parseSound, soundStr } from './sounds.js';

describe('parseSound', () => {
  it('parses keyboard program ids (bank letter + number)', () => {
    expect(parseSound('B74')).toEqual({ bank: 1, program: 74 });
    expect(parseSound('a0')).toEqual({ bank: 0, program: 0 });
    expect(parseSound('D127')).toEqual({ bank: 3, program: 127 });
  });
  it('parses GM programs and GM drum kits', () => {
    expect(parseSound('gm:33')).toEqual({ bank: BANK_GM, program: 33 });
    expect(parseSound('GM:0')).toEqual({ bank: BANK_GM, program: 0 });
    expect(parseSound('gmd:25')).toEqual({ bank: BANK_GM_DRUMS, program: 25 });
  });
  it('rejects out-of-range and malformed ids', () => {
    for (const bad of ['A128', 'E10', 'gm:128', 'gmd:200', 'gm:', 'B', '74', '', 'gm:1x', undefined, null]) {
      expect(parseSound(bad), String(bad)).toBeNull();
    }
  });
});

describe('soundStr', () => {
  it('formats the ids parseSound reads', () => {
    expect(soundStr({ bank: 1, program: 74 })).toBe('B74');
    expect(soundStr({ bank: BANK_GM, program: 33 })).toBe('gm:33');
    expect(soundStr({ bank: BANK_GM_DRUMS, program: 25 })).toBe('gmd:25');
  });
  it('round-trips with parseSound', () => {
    for (const id of ['A0', 'B87', 'C12', 'D20', 'gm:0', 'gm:127', 'gmd:0', 'gmd:56']) {
      const { bank, program } = parseSound(id);
      expect(soundStr({ bank, program })).toBe(id);
    }
  });
});

describe('bank select values (Bank Map KORG)', () => {
  it('maps user banks A–D to MSB 0 and LSB = bank', () => {
    for (const b of [0, 1, 2, 3]) expect([bankMsb(b), bankLsb(b)]).toEqual([0x00, b]);
  });
  it('maps the GM bank to MSB 121, LSB 0', () => expect([bankMsb(BANK_GM), bankLsb(BANK_GM)]).toEqual([0x79, 0]));
  it('maps the GM drum kit bank to MSB 120, LSB 0', () => expect([bankMsb(BANK_GM_DRUMS), bankLsb(BANK_GM_DRUMS)]).toEqual([0x78, 0]));
  it('maps g(1)…g(9) to MSB 121 with LSB 1…9', () => {
    expect([bankMsb(5), bankLsb(5)]).toEqual([0x79, 1]);
    expect([bankMsb(13), bankLsb(13)]).toEqual([0x79, 9]);
  });
});

describe('keyboard sound catalogue', () => {
  it('flags the drum kit programs as kits', () => {
    expect(kbdByKey.get('3:20')).toMatchObject({ name: 'PowerKit 2', kit: true, id: 'D20' });
    expect(kbdByKey.get('1:87')).toMatchObject({ name: 'Finger Bs1', kit: false, id: 'B87' });
  });
});

describe('instrumentOptions', () => {
  it('offers GM sounds and non-kit keyboard sounds for a melodic track, with the current one selected', () => {
    const html = instrumentOptions({ bank: BANK_GM, program: 33, drums: false });
    expect(html).toContain('<option value="4:33" selected>34. Fingered Bass</option>');
    expect(html).toContain('<optgroup label="GM · Bass">');
    expect(html).toContain('value="1:87"');
    expect(html).not.toContain('General MIDI kits');
    expect(html).not.toContain('value="3:20"');              // a drum kit program
    expect(html.match(/ selected>/g)).toHaveLength(1);
  });
  it('offers GM kits and keyboard kits for a drum track', () => {
    const html = instrumentOptions({ bank: 3, program: 20, drums: true });
    expect(html).toContain('<optgroup label="General MIDI kits">');
    expect(html).toContain('value="14:25"');                   // TR-808 Kit
    expect(html).toContain('<option value="3:20" selected>D20 PowerKit 2 (own key layout)</option>');
    expect(html).not.toContain('GM · Bass');
    expect(html).not.toContain('value="1:87"');
  });
});
