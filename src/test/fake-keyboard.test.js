import { afterEach, describe, expect, it } from 'vitest';
import { encodeParamValue, ports, request, send, sysexHeader, unpack } from '../lib/midi.js';
import { MODE, createFakeKeyboard } from './fake-keyboard.js';

const H = sysexHeader(0);
let fake;
const setup = opts => { fake = createFakeKeyboard(opts).install(); return fake; };
afterEach(() => { ports.out = ports.inp = null; });

const askDump = async obj => unpack((await request([...H, 0x74, obj, 0xF7], d => d[6] === 0x75 && d[7] === obj)).slice(9, -1));
const setTrackSound = (i, bank, prog, modeByte = 0x04) =>
  send([...H, 0x41, modeByte, 0x00, 0x04 + i, 0x00, 0x00, ...encodeParamValue(prog | (bank << 7)), 0xF7]);

describe('fake keyboard: identity and mode', () => {
  it('answers the device inquiry with the manufacturer, channel and version', async () => {
    setup({ ch: 3 });
    const r = await request([0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7], d => d[3] === 0x06 && d[4] === 0x02);
    expect([r[2] & 0x0F, r[5], r[6], r[10], r[11], r[12]]).toEqual([3, 0x42, 0x0D, 1, 2, 3]);
  });
  it('reports its mode and follows a mode change', async () => {
    setup({ mode: MODE.PROG_PLAY });
    expect((await request([...H, 0x12, 0xF7], d => d[6] === 0x42))[7]).toBe(2);
    send([...H, 0x4E, MODE.SEQUENCER, 0xF7]);
    expect((await request([...H, 0x12, 0xF7], d => d[6] === 0x42))[7]).toBe(4);
  });
  it('can ignore the next request, then answers again', async () => {
    setup();
    fake.dropNext(1);
    await expect(request([...H, 0x12, 0xF7], d => d[6] === 0x42, 5)).rejects.toThrow('timeout');
    expect((await request([...H, 0x12, 0xF7], d => d[6] === 0x42))[7]).toBe(2);
  });
  it('can ignore every request', async () => {
    setup();
    fake.silent = true;
    await expect(request([...H, 0x12, 0xF7], d => d[6] === 0x42, 5)).rejects.toThrow('timeout');
  });
});

describe('fake keyboard: track sounds in Sequencer mode', () => {
  it('stores bank and program unchanged when set with prog | bank << 7', async () => {
    setup({ mode: MODE.SEQUENCER });
    for (const [i, bank, prog] of [[1, 1, 87], [2, 3, 20], [9, 14, 25], [3, 4, 33], [4, 0, 112]]) setTrackSound(i, bank, prog);
    expect(fake.tracks.map(t => [t.bank, t.prog]).filter((_, i) => [1, 2, 9, 3, 4].includes(i)))
      .toEqual([[1, 87], [3, 20], [4, 33], [0, 112], [14, 25]]);
  });
  it('shows the stored sound in the song timbre dump', async () => {
    setup({ mode: MODE.SEQUENCER });
    setTrackSound(15, 14, 16);
    const o = await askDump(2);
    expect([o[664 + 44 * 15], o[664 + 44 * 15 + 1]]).toEqual([16, 14]);
  });
  it('keeps the old bank but applies the program when the bank is out of range', () => {
    setup({ mode: MODE.SEQUENCER });
    setTrackSound(5, 3, 10);
    setTrackSound(5, 28, 77);                                  // what a bank << 8 encoding of g(d) looks like
    expect([fake.tracks[5].bank, fake.tracks[5].prog]).toEqual([3, 77]);
  });
  it('ignores parameter changes when the unit is not in Sequencer mode', () => {
    setup({ mode: MODE.PROG_PLAY });
    const before = JSON.stringify(fake.tracks);
    setTrackSound(5, 3, 10);
    expect(JSON.stringify(fake.tracks)).toBe(before);
  });
  it('takes bank select + program change only on tracks with Prog Chg on', () => {
    setup({ mode: MODE.SEQUENCER });
    fake.tracks[2].progChg = true;
    for (const c of [1, 2]) send([0xB0 | c, 0x00, 0x00]), send([0xB0 | c, 0x20, 3]), send([0xC0 | c, 40]);
    expect([fake.tracks[1].bank, fake.tracks[1].prog]).toEqual([4, 0]);     // filter off: unchanged
    expect([fake.tracks[2].bank, fake.tracks[2].prog]).toEqual([3, 40]);
  });
  it('resets every track to GM on GM System On (drums to the GM kit)', () => {
    setup({ mode: MODE.SEQUENCER });
    setTrackSound(2, 3, 20); setTrackSound(9, 3, 20);
    send([0xF0, 0x7E, 0x7F, 0x09, 0x01, 0xF7]);
    expect([fake.tracks[2].bank, fake.tracks[2].prog, fake.tracks[9].bank]).toEqual([4, 0, 14]);
  });
});

describe('fake keyboard: Program / Combination', () => {
  it('applies arp parameter changes and reports them in the dump', async () => {
    setup({ mode: MODE.PROG_PLAY });
    send([...H, 0x41, 0x02, 0x00, 0x02, 0x00, 0x00, ...encodeParamValue(14000), 0xF7]);   // tempo
    send([...H, 0x41, 0x02, 0x00, 0x02, 0x00, 0x01, ...encodeParamValue(1), 0xF7]);       // arp on
    send([...H, 0x41, 0x02, 0x00, 0x03, 0x00, 0x05, ...encodeParamValue(-50), 0xF7]);     // swing
    expect([fake.prog.tempo, fake.prog.arp, fake.prog.slots.P.swing]).toEqual([140, 1, -50]);
  });
  it('turns the arp off when the sound changes by bank select + program change', () => {
    setup({ mode: MODE.PROG_PLAY });
    fake.prog.arp = 1;
    send([0xB0, 0x00, 0x00]); send([0xB0, 0x20, 1]); send([0xC0, 5]);
    expect([fake.prog.bank, fake.prog.num, fake.prog.arp]).toEqual([1, 5, 0]);
  });
});

describe('fake keyboard: data dumps and saving', () => {
  it('describes a drum program with its kit number, and a normal program as not a drum', async () => {
    setup();
    fake.drumPrograms['3:20'] = { kitNo: 5 };
    const dump = async (bank, prog) => unpack((await request([...H, 0x72, 0x00, bank, 0x00, prog, 0xF7], d => d[6] === 0x73 && d[7] === 0x00)).slice(12, -1));
    const drum = await dump(3, 20), melodic = await dump(1, 87);
    expect([drum[640] & 7, drum[738] | (drum[739] << 8), melodic[640] & 7]).toEqual([2, 5, 0]);
  });
  it('reports the result of an object write', async () => {
    setup();
    const write = (combi, bank, num) => request([...H, 0x77, combi, bank, 0x00, num, 0xF7], d => d[6] === 0x24);
    expect((await write(0, 3, 127))[7]).toBe(0);
    expect((await write(1, 3, 5))[7]).toBe(3);                 // a Combination has banks A–C only
    fake.memoryProtect = true;
    expect((await write(0, 0, 0))[7]).toBe(2);
    expect(fake.written).toEqual([{ combi: false, bank: 3, num: 127 }]);
  });
});
