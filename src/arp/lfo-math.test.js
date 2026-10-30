import { afterEach, describe, expect, it, vi } from 'vitest';
import { WAVES, advanceLfo } from './lfo-math.js';

const lfo = (over = {}) => ({ shape: 'sine', pol: 'bi', depth: 100, phase: 0, hold: 0, ...over });

describe('WAVES', () => {
  const at = (shape, ps) => ps.map(p => +WAVES[shape](p).toFixed(6));
  it('sine', () => expect(at('sine', [0, 0.25, 0.5, 0.75])).toEqual([0, 1, 0, -1]));
  it('triangle', () => expect(at('tri', [0, 0.25, 0.5, 0.75, 1])).toEqual([0, 1, 0, -1, 0]));
  it('saw ramps up then wraps down at half phase', () => expect(at('saw', [0, 0.25, 0.4999, 0.5, 0.75])).toEqual([0, 0.5, 0.9998, -1, -0.5]));
  it('square', () => expect(at('square', [0, 0.49, 0.5, 0.99])).toEqual([1, 1, -1, -1]));
  it('stays within -1…+1', () => {
    for (const shape of Object.keys(WAVES)) {
      for (let p = 0; p < 1; p += 0.01) expect(Math.abs(WAVES[shape](p))).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('advanceLfo', () => {
  afterEach(() => vi.restoreAllMocks());

  it('advances the phase by dt × cycles per second', () => {
    const l = lfo();
    advanceLfo(l, 0.1, 2);
    expect(l.phase).toBeCloseTo(0.2);
  });
  it('returns the waveform value at the new phase', () => {
    expect(advanceLfo(lfo(), 0.25, 1)).toBeCloseTo(1);           // sine at 0.25
  });
  it('wraps the phase after a full cycle', () => {
    const l = lfo({ phase: 0.9 });
    advanceLfo(l, 0.25, 1);
    expect(l.phase).toBeCloseTo(0.15);
  });
  it('scales by depth', () => {
    expect(advanceLfo(lfo({ depth: 50 }), 0.25, 1)).toBeCloseTo(0.5);
    expect(advanceLfo(lfo({ depth: 0 }), 0.25, 1)).toBeCloseTo(0);
  });
  it('maps to 0…+1 for "+ only" and -1…0 for "− only"', () => {
    expect(advanceLfo(lfo({ pol: 'up' }), 0.25, 1)).toBeCloseTo(1);     // sine peak
    expect(advanceLfo(lfo({ pol: 'up' }), 0.75, 1)).toBeCloseTo(0);     // sine trough
    expect(advanceLfo(lfo({ pol: 'dn' }), 0.25, 1)).toBeCloseTo(-1);
    expect(advanceLfo(lfo({ pol: 'dn' }), 0.75, 1)).toBeCloseTo(0);
  });
  it('holds a random value for the whole cycle and draws a new one on wrap', () => {
    const rnd = vi.spyOn(Math, 'random').mockReturnValueOnce(0.75).mockReturnValueOnce(0.25);
    const l = lfo({ shape: 'rand', hold: -0.3 });
    expect(advanceLfo(l, 0.1, 1)).toBeCloseTo(-0.3);                    // no wrap yet: old value held
    expect(advanceLfo(l, 0.1, 1)).toBeCloseTo(-0.3);
    expect(advanceLfo(l, 0.9, 1)).toBeCloseTo(0.5);                     // wrapped: 0.75 → +0.5
    expect(advanceLfo(l, 1, 1)).toBeCloseTo(-0.5);                      // wrapped again: 0.25 → -0.5
    expect(rnd).toHaveBeenCalledTimes(2);
  });
});
