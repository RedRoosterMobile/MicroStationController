import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODE } from '../test/fake-keyboard.js';

const settle = () => vi.runAllTimersAsync();
const banner = () => document.getElementById('banner').textContent;

async function load(opts = {}) {
  vi.resetModules();
  const { createFakeKeyboard } = await import('../test/fake-keyboard.js');
  const fake = createFakeKeyboard({ mode: MODE.PROG_PLAY, ...opts }).install();
  const device = await import('./device.js');
  const { session, onSessionChange } = await import('./session.js');
  const protocol = await import('./protocol.js');
  const changed = vi.fn();
  onSessionChange(changed);
  return { fake, device, session, protocol, changed };
}
async function run(promise) { const p = promise.catch(e => e); await settle(); return p; }

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  vi.useRealTimers();
  const { ports } = await import('../lib/midi.js');
  ports.out = ports.inp = null;
});

describe('readCurrent', () => {
  it('reads a Program: name, tempo, arp state and the single slot', async () => {
    const { fake, device, session, changed } = await load();
    Object.assign(fake.prog, { name: 'Funky Clav', tempo: 98.5, arp: 1, latch: 1 });
    Object.assign(fake.prog.slots.P, { pattern: 300, octave: 3, res: 5, gate: 101, vel: 128, swing: -20 });
    expect(await run(device.readCurrent())).toBeUndefined();
    expect(session.state).toEqual({
      kind: 'prog', name: 'Funky Clav', tempo: 98.5, arp: 1, latch: 1,
      slots: { P: { pattern: 300, octave: 3, res: 5, gate: 101, vel: 128, swing: -20 } },
    });
    expect(session.modeLabel).toBe('Keyboard mode: Program Play');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(banner()).toBe('');
  });

  it('reads a Combination with both arp slots and moves the active slot onto one that exists', async () => {
    const { fake, device, session } = await load({ mode: MODE.COMBI_PLAY });
    fake.combi.slots.B.pattern = 77;
    expect(session.activeSlot).toBe('P');
    await run(device.readCurrent());
    expect(session.state.kind).toBe('combi');
    expect(Object.keys(session.state.slots)).toEqual(['A', 'B']);
    expect(session.state.slots.B.pattern).toBe(77);
    expect(session.activeSlot).toBe('A');
  });

  it('explains when the keyboard is in a mode with nothing to read, and clears the state', async () => {
    const { device, session, changed } = await load({ mode: MODE.SEQUENCER });
    session.state = { stale: true };
    await run(device.readCurrent());
    expect(session.state).toBeNull();
    expect(banner()).toContain('The keyboard is in Sequencer mode. Press PROG or COMBI');
    expect(session.modeLabel).toBe('Keyboard mode: Sequencer');
    expect(changed).toHaveBeenCalled();
  });

  it('retries when the unit ignores a request just after a change', async () => {
    const { fake, device, session } = await load();
    fake.dropNext(2);                                           // the first two mode requests get no answer
    fake.prog.name = 'After Change';
    expect(await run(device.readCurrent())).toBeUndefined();
    expect(session.state.name).toBe('After Change');
  });

  it('gives up after three attempts', async () => {
    const { fake, device } = await load();
    fake.silent = true;
    const err = await run(device.readCurrent());
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('timeout');
  });
});

describe('setParam / setSlot', () => {
  it('changes the tempo (hundredths of a BPM) and reads the result back', async () => {
    const { device, session, protocol } = await load();
    await run(device.setParam(protocol.PARAM.ARP_GLOBAL, protocol.ARP_GLOBAL.TEMPO, 14025));
    expect(session.state.tempo).toBe(140.25);
  });

  it('switches arp and latch on', async () => {
    const { device, session, protocol } = await load();
    await run(device.setParam(protocol.PARAM.ARP_GLOBAL, protocol.ARP_GLOBAL.ON, 1));
    await run(device.setParam(protocol.PARAM.ARP_GLOBAL, protocol.ARP_GLOBAL.LATCH, 1));
    expect([session.state.arp, session.state.latch]).toEqual([1, 1]);
  });

  it('sets slot fields, including a negative swing and the Step sentinels', async () => {
    const { device, session, protocol } = await load();
    const { ARP_SLOT, GATE_STEP, VEL_STEP } = protocol;
    await run(device.setSlot('P', ARP_SLOT.SWING, -50));
    await run(device.setSlot('P', ARP_SLOT.GATE, GATE_STEP));
    await run(device.setSlot('P', ARP_SLOT.VELOCITY, VEL_STEP));
    await run(device.setSlot('P', ARP_SLOT.OCTAVE, 3));            // stored as octave - 1; read back as octave 4
    await run(device.setSlot('P', ARP_SLOT.PATTERN, 516));
    expect(session.state.slots.P).toMatchObject({ swing: -50, gate: 0x65, vel: 0x81, octave: 4, pattern: 516 });
  });

  it('addresses arp B separately in a Combination', async () => {
    const { device, session, protocol } = await load({ mode: MODE.COMBI_PLAY });
    await run(device.readCurrent());
    await run(device.setSlot('B', protocol.ARP_SLOT.PATTERN, 42));
    expect(session.state.slots.B.pattern).toBe(42);
    expect(session.state.slots.A.pattern).toBe(0);
  });

  it('reports a failed re-read in the banner instead of throwing', async () => {
    const { fake, device, protocol } = await load();
    fake.silent = true;
    expect(await run(device.setParam(protocol.PARAM.ARP_GLOBAL, protocol.ARP_GLOBAL.ON, 1))).toBeUndefined();
    expect(banner()).toBe('Re-read failed: timeout');
  });
});

describe('restoreArp', () => {
  it('switches the arp back on after a sound change turned it off', async () => {
    const { fake, device, session } = await load();
    await run(device.readCurrent());                            // arp is off now, as after a sound change
    await run(device.restoreArp(true, true));
    expect(session.state.arp).toBe(1);
    expect(fake.prog.arp).toBe(1);
  });
  it('leaves it off when it was off before, or when "keep arp on" is unticked', async () => {
    const { device, session } = await load();
    await run(device.readCurrent());
    await run(device.restoreArp(false, true));
    await run(device.restoreArp(true, false));
    expect(session.state.arp).toBe(0);
  });
});
