// Helpers shared by the test files.

// Inverse of lib/midi.js unpack (Korg 7 → 8 byte packing): used to build dumps like the unit sends them.
export const pack = bytes => {
  const out = [];
  for (let i = 0; i < bytes.length; i += 7) {
    const group = bytes.slice(i, i + 7);
    out.push(group.reduce((msbs, b, j) => msbs | (((b >> 7) & 1) << j), 0), ...group.map(b => b & 0x7F));
  }
  return out;
};
