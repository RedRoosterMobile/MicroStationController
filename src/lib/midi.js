// Web MIDI plumbing shared by both pages: the active ports, send(), and request/response matching for SysEx.
export const ports = { out: null, inp: null };

let waiters = [];
export const hooks = { onSend: null, onReceive: null };    // optional logging callbacks

export const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(' ');

// SysEx header for a Korg microSTATION on the given global channel (0-based).
export const sysexHeader = ch => [0xF0, 0x42, 0x30 | ch, 0x00, 0x01, 0x0D];

// `time` is an optional Web MIDI timestamp; `silent` skips the send hook (for high-rate control changes).
export function send(bytes, { time, silent = false } = {}) {
  ports.out?.send(bytes, time);
  if (!silent) hooks.onSend?.(bytes);
}

// Attach to an input port; only SysEx is routed to pending requests (realtime / active sensing is ignored).
export function listen(input) {
  if (ports.inp) ports.inp.onmidimessage = null;
  ports.inp = input;
  if (input) input.onmidimessage = e => {
    const data = e.data;
    if (data[0] !== 0xF0) return;
    hooks.onReceive?.(data);
    waiters = waiters.filter(w => {
      if (!w.match(data)) return true;
      w.resolve(data);
      return false;
    });
  };
}

// Send `bytes` and resolve with the first SysEx message for which `match(data)` is true.
export function request(bytes, match, ms = 1500, timeoutMessage = 'timeout') {
  return new Promise((resolve, reject) => {
    const waiter = { match, resolve };
    waiters.push(waiter);
    setTimeout(() => {
      if (!waiters.includes(waiter)) return;
      waiters = waiters.filter(w => w !== waiter);
      reject(new Error(timeoutMessage));
    }, ms);
    send(bytes);
  });
}

// Korg 8-byte → 7-byte unpack (MIDIimp note *1): first byte of each group holds the MSBs.
export function unpack(body) {
  const out = [];
  for (let i = 0; i < body.length; i += 8) {
    const group = body.slice(i, i + 8);
    for (let j = 1; j < group.length; j++) out.push(group[j] | (((group[0] >> (j - 1)) & 1) << 7));
  }
  return out;
}

// Parameter-change value: 5 groups of 7 bits (top group 4 bits), negatives two's-complement.
export function encodeParamValue(value) {
  const v = value >>> 0;
  return [(v >>> 28) & 0x0F, (v >>> 21) & 0x7F, (v >>> 14) & 0x7F, (v >>> 7) & 0x7F, v & 0x7F];
}
