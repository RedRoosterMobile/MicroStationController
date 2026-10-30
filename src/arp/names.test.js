import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODE } from '../test/fake-keyboard.js';

const el = id => document.getElementById(id);

async function load() {
  vi.resetModules();
  const { createFakeKeyboard } = await import('../test/fake-keyboard.js');
  const fake = createFakeKeyboard({ mode: MODE.PROG_PLAY }).install();
  const patterns = await import('./patterns.js');
  const names = await import('./names.js');
  const { onSessionChange } = await import('./session.js');
  const changed = vi.fn();
  onSessionChange(changed);
  names.initNames();
  // the unit's names: the factory ones, except two that were edited
  fake.patternNames = Array.from({ length: 640 }, (_, u) => ({ name: patterns.patternInfo(5 + u).name, length: 16 }));
  fake.patternNames[0].name = 'My Strum';
  fake.patternNames[7].name = 'My Bass';
  return { fake, patterns, changed };
}
const runNames = async () => { const p = el('names').onclick(); await vi.runAllTimersAsync(); await p; };

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  vi.useRealTimers();
  const { ports } = await import('../lib/midi.js');
  ports.out = ports.inp = null;
});

describe('read names from unit', () => {
  it('reads all 640 names, saves them, and reports how many factory slots were edited', async () => {
    const { fake, patterns, changed } = await load();
    await runNames();
    expect(fake.sent.filter(m => m[6] === 0x72)).toHaveLength(640);
    expect(el('namesstat').textContent).toBe('Read 640 names from the unit. 2 of the 512 factory slots differ from the factory list.');
    expect(patterns.patternInfo(5)).toMatchObject({ name: 'My Strum', edited: true });
    expect(Object.keys(JSON.parse(localStorage.getItem('arp.unitNames')))).toHaveLength(640);
    expect(changed).toHaveBeenCalled();                          // the page redraws afterwards
  });

  it('marks the placeholder user slots as empty', async () => {
    const { fake, patterns } = await load();
    fake.patternNames[515] = { name: 'ArpeggioPattern0516', length: 16 };       // U515 blank on the unit
    await runNames();
    expect(patterns.patternInfo(5 + 515).empty).toBe(true);
  });

  it('shows the button again when it is done', async () => {
    await load();
    await runNames();
    expect(el('names').style.display).toBe('');
    expect(el('namescancel').style.display).toBe('none');
  });

  it('saves nothing and says where it stopped when the keyboard stops answering', async () => {
    const { fake } = await load();
    const original = fake.receive;
    let requests = 0;
    fake.receive = bytes => { if (bytes[6] === 0x72 && ++requests > 300) fake.silent = true; original(bytes); };
    await runNames();
    expect(el('namesstat').textContent).toBe('Stopped at 300/640: timeout. Nothing saved.');
    expect(localStorage.getItem('arp.unitNames')).toBeNull();
  });

  it('can be cancelled part way, saving nothing', async () => {
    const { fake } = await load();
    const original = fake.receive;
    let requests = 0;
    fake.receive = bytes => { if (bytes[6] === 0x72 && ++requests === 50) el('namescancel').onclick(); original(bytes); };
    await runNames();
    expect(el('namesstat').textContent).toMatch(/^Cancelled at \d+\/640 \(nothing saved\)\.$/);
    expect(localStorage.getItem('arp.unitNames')).toBeNull();
  });
});
