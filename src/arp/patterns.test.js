import { afterEach, describe, expect, it } from 'vitest';
import { countEditedFactorySlots, patternInfo, patternLabel, setUnitNames } from './patterns.js';

afterEach(() => setUnitNames({}));

describe('patternInfo', () => {
  it('describes the presets P0–P4', () => {
    expect(patternInfo(0)).toEqual({ raw: 0, slot: 'P0', name: 'UP', empty: false, length: null, edited: false });
    expect(patternInfo(4).slot).toBe('P4');
  });
  it('describes factory user patterns by U number (raw = 5 + U)', () => {
    expect(patternInfo(5)).toMatchObject({ slot: 'U000', name: 'Gt-1 Strum', length: 16, empty: false, edited: false });
    expect(patternInfo(516)).toMatchObject({ slot: 'U511', name: 'Dr-Timpani Roll', length: 24 });
  });
  it('treats U512–U639 as empty when the unit has not been read', () => {
    expect(patternInfo(517)).toMatchObject({ slot: 'U512', name: '(empty user slot)', empty: true, length: null });
    expect(patternInfo(644)).toMatchObject({ slot: 'U639', empty: true });
  });

  it('uses the name and length read from the unit, and flags a changed factory name as edited', () => {
    setUnitNames({ 0: { name: 'My Strum', length: 32 }, 1: { name: patternInfo(6).name, length: 16 } });
    expect(patternInfo(5)).toMatchObject({ name: 'My Strum', length: 32, edited: true });
    expect(patternInfo(6).edited).toBe(false);                       // same name as the factory list
  });
  it('shows a user pattern the unit has in a slot beyond the factory list', () => {
    setUnitNames({ 520: { name: 'Home Made', length: 8 } });
    expect(patternInfo(525)).toMatchObject({ slot: 'U520', name: 'Home Made', length: 8, empty: false, edited: false });
  });
  it('treats the unit\'s placeholder names as empty slots', () => {
    setUnitNames({ 3: { name: 'ArpeggioPattern0004', length: 16 } });
    expect(patternInfo(8)).toMatchObject({ empty: true, name: '(empty user slot)', length: null });
  });
});

describe('patternLabel', () => {
  it('joins slot and name', () => expect(patternLabel(0)).toBe('P0 UP'));
});

describe('countEditedFactorySlots', () => {
  it('counts factory slots (U000–U511) whose name differs from the factory list', () => {
    const names = { 0: { name: 'Changed' }, 1: { name: patternInfo(6).name }, 2: { name: 'Changed too' }, 520: { name: 'Beyond factory' } };
    expect(countEditedFactorySlots(names)).toBe(2);
  });
  it('is zero for an empty read', () => expect(countEditedFactorySlots({})).toBe(0));
});
