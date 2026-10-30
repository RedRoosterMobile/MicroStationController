import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODE, powerKit2 } from '../test/fake-keyboard.js';

const settle = () => vi.runAllTimersAsync();
const kitTrack = (bank = 3, program = 20) => ({ ch: 10, drums: true, bank, program });

async function load(opts = {}) {
  vi.resetModules();
  const { createFakeKeyboard } = await import('../test/fake-keyboard.js');
  const fake = createFakeKeyboard({ mode: MODE.SEQUENCER, ...opts }).install();
  fake.drumPrograms['3:20'] = { kitNo: 5 };
  fake.kits[5] = powerKit2();
  const kits = await import('./kits.js');
  const state = await import('./state.js');
  const changed = vi.fn();
  state.onTracksChange(changed);
  return { fake, kits, changed };
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  vi.useRealTimers();
  const { ports } = await import('../lib/midi.js');
  ports.out = ports.inp = null;
});

describe('ensureKit', () => {
  it('learns a keyboard kit and describes it (the PowerKit 2 hint from the unit)', async () => {
    const { kits, changed } = await load();
    const t = kitTrack();
    const done = kits.ensureKit(t);
    await settle(); await done;
    expect(t.kitHint).toBe('Power Kit 2 (#5): kick C2 BD-Tight, snare F2 SD-Full Room, hat F#3 Hi-Hat 1-Closed ff');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('remaps GM drum notes onto the kit\'s own keys', async () => {
    const { kits } = await load();
    const t = kitTrack();
    const done = kits.ensureKit(t);
    await settle(); await done;
    const gm = n => kits.drumNote(t, n);
    expect([gm(35), gm(36)]).toEqual([36, 36]);                  // kicks → C2
    expect([gm(38), gm(40), gm(37), gm(39)]).toEqual([41, 41, 41, 41]);   // snares, and rim / clap falling back to the snare
    expect([gm(42), gm(44)]).toEqual([54, 54]);                  // closed and pedal hat → closed hat
    expect(gm(46)).toBe(55);                                     // open hat
    expect([gm(49), gm(57), gm(51)]).toEqual([49, 49, 49]);      // crashes, and the ride falling back to the crash
  });

  it('drops notes the kit has no sound for', async () => {
    const { kits } = await load();
    const t = kitTrack();
    const done = kits.ensureKit(t);
    await settle(); await done;
    expect(kits.drumNote(t, 45)).toBeNull();                     // this kit has no toms
  });

  it('remembers a learned kit: no further requests, and it survives in storage', async () => {
    const { fake, kits } = await load();
    const t = kitTrack();
    let done = kits.ensureKit(t);
    await settle(); await done;
    const requests = fake.sent.length;
    done = kits.ensureKit(kitTrack());
    await settle(); await done;
    expect(fake.sent.length).toBe(requests);
    expect(Object.keys(JSON.parse(localStorage.getItem('comp.kitmaps3')))).toEqual(['3:20']);
  });

  it('does nothing for GM drum kits and melodic tracks', async () => {
    const { fake, kits, changed } = await load();
    await kits.ensureKit({ ch: 10, drums: true, bank: 14, program: 25 });
    await kits.ensureKit({ ch: 2, drums: false, bank: 1, program: 87 });
    expect(fake.sent).toHaveLength(0);
    expect(changed).not.toHaveBeenCalled();
  });

  it('explains when the program is not a drum program', async () => {
    const { kits } = await load();
    const t = kitTrack(1, 87);                                   // a bass, marked as drums
    const done = kits.ensureKit(t);
    await settle(); await done;
    expect(t.kitHint).toBe('kit layout unknown: not a drum program');
  });

  it('explains when the keyboard does not answer, and leaves notes unmapped', async () => {
    const { fake, kits } = await load();
    fake.silent = true;
    const t = kitTrack();
    const done = kits.ensureKit(t);
    await settle(); await done;
    expect(t.kitHint).toBe('kit layout unknown: no reply from the keyboard');
    expect(kits.drumNote(t, 38)).toBe(38);
  });

  it('does nothing without a MIDI connection', async () => {
    const { kits } = await load();
    const { ports } = await import('../lib/midi.js');
    ports.out = null;
    const t = kitTrack();
    await kits.ensureKit(t);
    expect(t.kitHint).toBeUndefined();
  });
});
