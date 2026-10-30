import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pack } from '../test-helpers.js';
import { encodeParamValue, hex, hooks, listen, ports, request, send, sysexHeader, unpack } from './midi.js';

describe('unpack', () => {
  it('restores the top bit of each byte from the group header', () => {
    // header 0b0000101: bytes 0 and 2 of the group had their MSB set
    expect(unpack([0b0000101, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]))
      .toEqual([0x81, 0x02, 0x83, 0x04, 0x05, 0x06, 0x07]);
  });
  it('handles several groups and a short last group', () => {
    expect(unpack([0, 1, 2, 3, 4, 5, 6, 7, 0b11, 0x10, 0x20])).toEqual([1, 2, 3, 4, 5, 6, 7, 0x90, 0xA0]);
  });
  it('returns nothing for an empty body', () => expect(unpack([])).toEqual([]));
  it('round-trips with pack for every byte value', () => {
    const data = Array.from({ length: 256 }, (_, i) => i);
    expect(unpack(pack(data))).toEqual(data);
  });
});

describe('encodeParamValue', () => {
  it('splits into 5 groups of 7 bits, top group 4 bits', () => {
    expect(encodeParamValue(0)).toEqual([0, 0, 0, 0, 0]);
    expect(encodeParamValue(1)).toEqual([0, 0, 0, 0, 1]);
    expect(encodeParamValue(127)).toEqual([0, 0, 0, 0, 127]);
    expect(encodeParamValue(128)).toEqual([0, 0, 0, 1, 0]);
    expect(encodeParamValue(12000)).toEqual([0, 0, 0, 93, 96]);   // 120 BPM × 100
  });
  it('encodes bank and program as prog | bank << 7', () => {
    expect(encodeParamValue(20 | (3 << 7))).toEqual([0, 0, 0, 3, 20]);       // D020
    expect(encodeParamValue(16 | (14 << 7))).toEqual([0, 0, 0, 14, 16]);     // g(d) kit 16
  });
  it('uses two\'s complement for negatives', () => {
    expect(encodeParamValue(-1)).toEqual([0x0F, 0x7F, 0x7F, 0x7F, 0x7F]);
  });
});

describe('sysexHeader / hex', () => {
  it('addresses the microSTATION on the given channel', () => {
    expect(sysexHeader(0)).toEqual([0xF0, 0x42, 0x30, 0x00, 0x01, 0x0D]);
    expect(sysexHeader(5)).toEqual([0xF0, 0x42, 0x35, 0x00, 0x01, 0x0D]);
  });
  it('formats bytes as spaced lowercase hex', () => expect(hex([0xF0, 0x0A, 0x7F])).toBe('f0 0a 7f'));
});

describe('send / listen / request', () => {
  let out, input;
  beforeEach(() => {
    vi.useFakeTimers();
    out = { send: vi.fn() };
    input = {};
    ports.out = out;
    hooks.onSend = hooks.onReceive = null;
    listen(input);
  });
  afterEach(() => {
    vi.useRealTimers();
    ports.out = ports.inp = null;
  });
  const receive = data => input.onmidimessage({ data });

  it('sends bytes with an optional timestamp and calls the send hook unless silent', () => {
    hooks.onSend = vi.fn();
    send([0x90, 60, 100]);
    send([0x80, 60, 0], { time: 1234 });
    send([0xB0, 1, 2], { silent: true });
    expect(out.send.mock.calls).toEqual([[[0x90, 60, 100], undefined], [[0x80, 60, 0], 1234], [[0xB0, 1, 2], undefined]]);
    expect(hooks.onSend).toHaveBeenCalledTimes(2);
  });
  it('does nothing without an output port', () => {
    ports.out = null;
    expect(() => send([1])).not.toThrow();
  });

  it('resolves with the first sysex message matching, and sends the request', async () => {
    const p = request([0xF0, 1, 0xF7], d => d[1] === 0x42);
    expect(out.send).toHaveBeenCalledWith([0xF0, 1, 0xF7], undefined);
    receive([0xF0, 0x10, 0xF7]);                 // not a match: ignored
    receive([0xF0, 0x42, 0xF7]);
    await expect(p).resolves.toEqual([0xF0, 0x42, 0xF7]);
  });
  it('ignores realtime / non-sysex messages', async () => {
    const match = vi.fn(() => true);
    const p = request([0xF0, 0xF7], match);
    receive([0xF8]);
    receive([0xFE]);
    expect(match).not.toHaveBeenCalled();
    receive([0xF0, 1, 0xF7]);
    await p;
  });
  it('calls the receive hook for sysex only', () => {
    hooks.onReceive = vi.fn();
    receive([0xF8]);
    receive([0xF0, 1, 0xF7]);
    expect(hooks.onReceive).toHaveBeenCalledTimes(1);
  });
  it('rejects with the timeout message and stops waiting', async () => {
    const p = request([0xF0, 0xF7], () => true, 1500, 'no reply');
    const assertion = expect(p).rejects.toThrow('no reply');
    await vi.advanceTimersByTimeAsync(1500);
    await assertion;
    receive([0xF0, 1, 0xF7]);                    // late reply must not throw or resolve anything
  });
  it('serves several pending requests independently', async () => {
    const a = request([1], d => d[1] === 1), b = request([2], d => d[1] === 2);
    receive([0xF0, 2, 0xF7]);
    receive([0xF0, 1, 0xF7]);
    await expect(a).resolves.toEqual([0xF0, 1, 0xF7]);
    await expect(b).resolves.toEqual([0xF0, 2, 0xF7]);
  });
  it('detaches the previous input when listening to a new one', () => {
    const next = {};
    listen(next);
    expect(input.onmidimessage).toBeNull();
    expect(typeof next.onmidimessage).toBe('function');
  });
});
