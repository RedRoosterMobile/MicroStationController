// Reading the keyboard's track setup back, and the self-test that finds which routing method it honours.
import { $ } from '../lib/dom.js';
import { ports, request, unpack } from '../lib/midi.js';
import { sleep } from '../lib/util.js';
import { hdr } from './channels.js';
import { SETTERS, pushSetup, setMethod, setSysexSounds } from './routing.js';
import { BANK_GM, BANK_GM_DRUMS } from './sounds.js';
import { composer } from './state.js';

const STATUS = ['Off', 'INT', 'EXT', 'EX2'];

// Current Song Timbre Set (TABLE 10): track i starts at byte 664 + 44*i.
async function dumpTracks() {
  if (!ports.inp) throw new Error('no MIDI input found (needs the keyboard input port)');
  const d = await request([...hdr(), 0x74, 0x02, 0xF7], d => d[6] === 0x75 && d[7] === 0x02, 2500,
    'no reply (is the keyboard in Sequencer mode, and the input port the keyboard one?)');
  const o = unpack(d.slice(9, d.length - 1));
  return Array.from({ length: 16 }, (_, i) => {
    const b = 664 + 44 * i;
    return { prog: o[b], bank: o[b + 1], ch: o[b + 2] & 31, status: o[b + 2] >> 5, vol: o[b + 5] };
  });
}

async function readTracks() {
  $('trackinfo').textContent = 'Reading…';
  try {
    const tracks = await dumpTracks();
    $('trackinfo').textContent = tracks.map((t, i) =>
      `Track ${i + 1}: prog ${t.prog}, bank ${t.bank}, MIDI ch ${t.ch} (0-based; 16=global), status ${STATUS[t.status] ?? t.status}, vol ${t.vol}`).join('\n');
  } catch (e) { $('trackinfo').textContent = 'Read failed: ' + e.message; }
}

// Send each bank number with the winning SysEx method and report which bank the unit actually stored (A–D = 0–3, GM = 4, g(d) = 14).
async function probeBanks(method, c) {
  const lines = ['Bank mapping (sent → stored):'];
  for (const bank of [0, 1, 2, 3, 4, 14]) {
    SETTERS[method](c, bank, 5);
    await sleep(400);
    const t = (await dumpTracks())[c];
    lines.push(`  bank ${bank} → ${t.bank}${t.bank === bank ? '' : '  ← differs'} (prog ${t.prog})`);
  }
  return lines;
}

// Try each method on track 16 / channel 16 (unlikely to be in use) and keep the first one the unit reflects back.
// Each trial targets a bank and program different from what the track holds now, so a leftover value can't pass as a success.
async function selfTest() {
  const c = 15, lines = [];
  let found = null;
  try {
    for (const name of ['sx7', 'cc']) {
      const current = (await dumpTracks())[c];
      const bank = current.bank === BANK_GM_DRUMS ? BANK_GM : BANK_GM_DRUMS;
      const prog = current.prog === 16 ? 24 : 16;
      SETTERS[name](c, bank, prog);
      await sleep(400);
      const t = (await dumpTracks())[c];
      const ok = t.bank === bank && t.prog === prog;
      lines.push(`${name}: sent bank ${bank} prog ${prog}, track 16 now bank ${t.bank} prog ${t.prog} → ${ok ? 'OK' : 'no'}`);
      if (ok && !found) found = name;
    }
    if (found && found !== 'cc') lines.push(...await probeBanks(found, c));
    if (found) {
      setMethod(found);
      if (found !== 'cc') setSysexSounds(true);          // SysEx methods only take effect with this ticked
      lines.push(`Using "${found}" from now on.`);
      if (composer.song) pushSetup();
    }
    else lines.push('Neither method changed the bank. Tell me this output.');
  } catch (e) { lines.push('Self-test failed: ' + e.message); }
  $('trackinfo').textContent = lines.join('\n');
}

export function initDiagnostics() {
  $('readtracks').onclick = readTracks;
  $('selftest').onclick = selfTest;
}
