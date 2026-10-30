import { describe, expect, it } from 'vitest';
import { chooseKey, drumNote, roleOf } from './kits.js';

describe('roleOf', () => {
  it.each([
    ['BD-Tight', 'kick'], ['BD-Dry 3', 'kick'],
    ['SD-Full Room', 'snare'], ['SD-Rap 1', 'snare'],
    ['Side Stick', 'rim'], ['Rim Shot', 'rim'], ['Snare Rim', 'rim'],
    ['Hand Clap 2', 'clap'],
    ['Hi-Hat 1-Closed ff', 'hatC'], ['HiHat Closed', 'hatC'], ['Hi-Hat Pedal', 'hatP'], ['Hi-Hat 2-Open', 'hatO'],
    ['Crash Cymbal 1', 'crash'], ['Splash', 'crash'], ['China', 'crash'],
    ['Ride Cymbal', 'ride'],
    ['Tom Floor', 'tomLo'], ['Tom Lo', 'tomLo'], ['Tom Mid', 'tomMid'], ['Tom Hi', 'tomHi'],
  ])('%s → %s', (name, role) => expect(roleOf(name)).toBe(role));

  it('returns null for samples that are not a recognised drum', () => {
    for (const name of ['Cowbell', 'Conga Hi', 'Vox Hit', '']) expect(roleOf(name)).toBeNull();
  });
  it('only treats BD / SD as kick / snare at the start of the name', () => {
    expect(roleOf('Orch BD')).toBeNull();
    expect(roleOf('bd-soft')).toBe('kick');                  // case-insensitive
  });
});

describe('chooseKey', () => {
  it('picks the key closest to where GM puts the sound', () => {
    const names = { 36: 'BD-A', 40: 'BD-B', 30: 'BD-C' };
    expect(chooseKey('kick', { kick: [30, 40, 36] }, names)).toBe(36);   // GM kick is 36
    expect(chooseKey('kick', { kick: [30, 40] }, names)).toBe(40);       // 4 away beats 6 away
  });
  it('prefers an ordinary hit over a closer effect sample', () => {
    const names = { 38: 'SD-Reverse', 50: 'SD-Normal' };
    expect(chooseKey('snare', { snare: [38, 50] }, names)).toBe(50);     // 38 is at the anchor but is an effect
  });
  it('still uses an effect sample when it is the only one', () => {
    expect(chooseKey('snare', { snare: [38] }, { 38: 'SD-Reverse' })).toBe(38);
  });
  it('falls back to a related role when the kit has none', () => {
    const names = { 47: 'Tom Mid' };
    expect(chooseKey('tomHi', { tomMid: [47] }, names)).toBe(47);        // tomHi → tomMid
    expect(chooseKey('hatO', { hatC: [42] }, { 42: 'Hi-Hat Closed' })).toBe(42);
    expect(chooseKey('clap', { snare: [38] }, { 38: 'SD-Normal' })).toBe(38);
  });
  it('returns null when neither the role nor its fallbacks exist', () => {
    expect(chooseKey('kick', {}, {})).toBeNull();
    expect(chooseKey('hatP', { kick: [36] }, { 36: 'BD' })).toBeNull();
  });
});

describe('drumNote', () => {
  it('passes notes through for melodic tracks and GM drum kits', () => {
    expect(drumNote({ drums: false, bank: 4, program: 33 }, 40)).toBe(40);
    expect(drumNote({ drums: true, bank: 14, program: 0 }, 38)).toBe(38);
  });
  it('passes notes through for a keyboard kit whose layout is not learned yet', () => {
    expect(drumNote({ drums: true, bank: 3, program: 99 }, 38)).toBe(38);
  });
});
