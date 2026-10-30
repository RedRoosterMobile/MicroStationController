import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODE, powerKit2 } from '../test/fake-keyboard.js';

const el = id => document.getElementById(id);
const settle = () => vi.runAllTimersAsync();

// The sounds from the Funk song that went wrong on the unit: a B-bank bass, A-bank guitar, a D-bank drum kit, GM sounds.
const track = (ch, bank, program, drums = false) => ({ ch, name: `T${ch}`, bank, program, drums, vol: 100, notes: [] });
const funkSong = () => ({ tracks: [track(10, 3, 20, true), track(2, 1, 87), track(3, 1, 40), track(4, 0, 47), track(5, 4, 33), track(6, 14, 25, true)] });
const expectedSounds = [[3, 20, 9], [1, 87, 1], [1, 40, 2], [0, 47, 3], [4, 33, 4], [14, 25, 5]];     // bank, program, track index

async function load(opts = {}) {
  vi.resetModules();
  const { createFakeKeyboard } = await import('../test/fake-keyboard.js');
  const fake = createFakeKeyboard({ mode: MODE.SEQUENCER, ...opts }).install();
  fake.drumPrograms['3:20'] = { kitNo: 5 };
  fake.kits[5] = powerKit2();
  const routing = await import('./routing.js');
  const { composer } = await import('./state.js');
  routing.initRouting();
  composer.song = funkSong();
  return { fake, routing };
}
const soundsOf = (fake, idx) => idx.map(i => [fake.tracks[i].bank, fake.tracks[i].prog]);

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  vi.useRealTimers();
  const { ports } = await import('../lib/midi.js');
  ports.out = ports.inp = null;
});

describe('pushSetup with "Set sounds via SysEx"', () => {
  it('puts every track\'s bank and program on the keyboard unchanged', async () => {
    const { fake, routing } = await load();
    el('sx').checked = true;
    routing.pushSetup();
    await settle();
    expect(soundsOf(fake, [9, 1, 2, 3, 4, 5])).toEqual(expectedSounds.map(([bank, prog]) => [bank, prog]));
  });

  it('addresses the track that matches the channel (channel n = track n)', async () => {
    const { fake, routing } = await load();
    el('sx').checked = true;
    routing.pushSetup();
    await settle();
    expect(fake.tracks[0].bank).toBe(4);                        // track 1 untouched: still its GM default
    expect(fake.tracks[6].bank).toBe(4);
  });

  it('does not touch the tracks when the keyboard is not in Sequencer mode', async () => {
    const { fake, routing } = await load({ mode: MODE.PROG_PLAY });
    el('sx').checked = true;
    const before = JSON.stringify(fake.tracks);
    routing.pushSetup();
    await settle();
    expect(JSON.stringify(fake.tracks)).toBe(before);
  });
});

describe('pushSetup with bank select + program change (SysEx box unticked)', () => {
  it('leaves the sounds alone while the tracks\' Prog Chg filter is off (the keyboard default)', async () => {
    const { fake, routing } = await load();
    el('bank').checked = true;
    const before = JSON.stringify(fake.tracks);
    routing.pushSetup();
    await settle();
    expect(JSON.stringify(fake.tracks)).toBe(before);           // why the bass kept its old sound
  });

  it('sets the sounds when Prog Chg is on for the tracks', async () => {
    const { fake, routing } = await load();
    el('bank').checked = true;
    fake.tracks.forEach(t => { t.progChg = true; });
    routing.pushSetup();
    await settle();
    expect(soundsOf(fake, [9, 1, 2, 3, 4, 5])).toEqual(expectedSounds.map(([bank, prog]) => [bank, prog]));
  });

  it('sends only a program change when "Send bank select" is off, keeping the track\'s bank', async () => {
    const { fake, routing } = await load();
    el('bank').checked = false;
    fake.tracks.forEach(t => { t.progChg = true; });
    routing.pushSetup();
    await settle();
    expect(soundsOf(fake, [1, 2])).toEqual([[4, 87], [4, 40]]);   // programs changed, bank still GM
  });
});

describe('pushSetup and drum kits', () => {
  it('learns the layout of a keyboard drum kit while setting up the tracks', async () => {
    const { fake, routing } = await load();
    el('sx').checked = true;
    const { composer } = await import('./state.js');
    routing.pushSetup();
    await settle();
    expect(composer.song.tracks[0].kitHint).toBe('Power Kit 2 (#5): kick C2 BD-Tight, snare F2 SD-Full Room, hat F#3 Hi-Hat 1-Closed ff');
    expect(composer.song.tracks[5].kitHint).toBeUndefined();     // a GM kit needs no remapping
    expect(fake.sent.filter(m => m[6] === 0x72)).toHaveLength(2);   // one program dump + one kit dump, only for the keyboard kit
  });
});
