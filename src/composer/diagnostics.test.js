import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODE } from '../test/fake-keyboard.js';

const el = id => document.getElementById(id);

async function load(opts = {}) {
  vi.resetModules();                                          // fresh module state (saved method, learned kits) for every test
  const { createFakeKeyboard } = await import('../test/fake-keyboard.js');
  const fake = createFakeKeyboard({ mode: MODE.SEQUENCER, ...opts }).install();
  (await import('./diagnostics.js')).initDiagnostics();
  return fake;
}
// Click a button whose handler is async and wait for it, advancing the fake clock through its sleeps.
async function click(id) {
  const done = el(id).onclick();
  await vi.runAllTimersAsync();
  await done;
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  vi.useRealTimers();
  const { ports } = await import('../lib/midi.js');
  ports.out = ports.inp = null;
});

describe('self-test sound routing', () => {
  it('picks the SysEx method when the keyboard ignores bank select / program change, and ticks the checkbox', async () => {
    await load();
    await click('selftest');
    const out = el('trackinfo').textContent;
    expect(out).toMatch(/^sx7: sent bank 14 prog 16, track 16 now bank 14 prog 16 → OK$/m);
    expect(out).toMatch(/^cc: sent bank 4 prog 24, track 16 now bank 14 prog 16 → no$/m);
    expect(out).toContain('Using "sx7" from now on.');
    expect(el('sx').checked).toBe(true);
    expect(localStorage.getItem('comp.method')).toBe('"sx7"');
    expect(localStorage.getItem('comp.sx')).toBe('true');
  });

  it('reports every bank stored exactly as sent', async () => {
    await load();
    await click('selftest');
    const mapping = el('trackinfo').textContent.split('\n').filter(l => /^ {2}bank \d+ → /.test(l));
    expect(mapping).toHaveLength(6);
    expect(mapping.join('\n')).not.toContain('differs');
  });

  it('is not fooled by a bank that is already set from an earlier run', async () => {
    // Regression: a leftover bank 14 made a wrong encoding look like it worked.
    const fake = await load();
    Object.assign(fake.tracks[15], { bank: 14, prog: 16 });
    await click('selftest');
    expect(el('trackinfo').textContent).toMatch(/^sx7: sent bank 4 prog 24, track 16 now bank 4 prog 24 → OK$/m);
  });

  it('also accepts bank select + program change when the track\'s Prog Chg is on, but still prefers SysEx', async () => {
    const fake = await load();
    fake.tracks[15].progChg = true;
    await click('selftest');
    const out = el('trackinfo').textContent;
    expect(out).toMatch(/^sx7: .*→ OK$/m);
    expect(out).toMatch(/^cc: .*→ OK$/m);
    expect(out).toContain('Using "sx7" from now on.');
  });

  it('says so, and changes nothing, when the keyboard is not in Sequencer mode', async () => {
    await load({ mode: MODE.PROG_PLAY });
    await click('selftest');
    const out = el('trackinfo').textContent;
    expect(out).toMatch(/^sx7: .*→ no$/m);
    expect(out).toContain('Neither method changed the bank.');
    expect(el('sx').checked).toBe(false);
    expect(localStorage.getItem('comp.method')).toBeNull();
  });

  it('reports a failure when the keyboard does not answer', async () => {
    const fake = await load();
    fake.silent = true;
    await click('selftest');
    expect(el('trackinfo').textContent).toContain('Self-test failed: no reply');
  });
});

describe('read keyboard tracks', () => {
  it('lists every track\'s program, bank, channel, status and volume', async () => {
    const fake = await load();
    Object.assign(fake.tracks[1], { prog: 87, bank: 1, vol: 93 });
    await click('readtracks');
    const lines = el('trackinfo').textContent.split('\n');
    expect(lines).toHaveLength(16);
    expect(lines[1]).toBe('Track 2: prog 87, bank 1, MIDI ch 1 (0-based; 16=global), status INT, vol 93');
    expect(lines[9]).toContain('bank 14');                      // the drum track starts on the GM kit bank
  });
  it('explains a missing reply', async () => {
    const fake = await load();
    fake.silent = true;
    await click('readtracks');
    expect(el('trackinfo').textContent).toMatch(/^Read failed: no reply \(is the keyboard in Sequencer mode/);
  });
});
