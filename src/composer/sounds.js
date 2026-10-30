// Sound catalogue: General MIDI names, drum kits, and the keyboard's own Programs.
import SOUNDS from '../../sounds.json';
import { esc } from '../lib/dom.js';

const GM_FAMILIES = {
  Piano: ['Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano', 'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet'],
  'Chromatic Percussion': ['Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer'],
  Organ: ['Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion'],
  Guitar: ['Nylon Guitar', 'Steel Guitar', 'Jazz Guitar', 'Clean Guitar', 'Muted Guitar', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics'],
  Bass: ['Acoustic Bass', 'Fingered Bass', 'Picked Bass', 'Fretless Bass', 'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2'],
  Strings: ['Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani'],
  Ensemble: ['String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit'],
  Brass: ['Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2'],
  Reed: ['Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet'],
  Pipe: ['Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina'],
  'Synth Lead': ['Square Lead', 'Saw Lead', 'Calliope Lead', 'Chiff Lead', 'Charang Lead', 'Voice Lead', 'Fifths Lead', 'Bass + Lead'],
  'Synth Pad': ['New Age Pad', 'Warm Pad', 'Polysynth Pad', 'Choir Pad', 'Bowed Pad', 'Metallic Pad', 'Halo Pad', 'Sweep Pad'],
  'Synth Effects': ['Rain', 'Soundtrack', 'Crystal', 'Atmosphere', 'Brightness', 'Goblins', 'Echoes', 'Sci-Fi'],
  Ethnic: ['Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai'],
  Percussive: ['Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal'],
  'Sound Effects': ['Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot'],
};
const DRUM_KITS = [[0, 'Standard Kit'], [8, 'Room Kit'], [16, 'Power Kit'], [24, 'Electronic Kit'], [25, 'TR-808 Kit'], [32, 'Jazz Kit'], [40, 'Brush Kit'], [48, 'Orchestra Kit'], [56, 'SFX Kit']];

// Bank index as the keyboard stores it: 0-3 = A-D, 4 = GM, 5-13 = g(1)-g(9), 14 = g(d) drums (read back from the unit).
export const BANK_GM = 4, BANK_GM_DRUMS = 14;
const KIT_SUBS = new Set(['Natural', 'Dance', 'Perc']);          // categories that hold drum kits
const KBD = SOUNDS.programs.map(p => ({ ...p, bank: 'ABCD'.indexOf(p.bank), id: p.bank + p.num, kit: KIT_SUBS.has(p.sub) }));
export const kbdByKey = new Map(KBD.map(k => [k.bank + ':' + k.num, k]));

// Sound ids: "B74" keyboard program, "gm:33" GM program (0-based), "gmd:25" GM drum kit
export function parseSound(str) {
  let m;
  if ((m = /^([A-D])(\d{1,3})$/i.exec(str ?? ''))) { const bank = 'ABCD'.indexOf(m[1].toUpperCase()), program = +m[2]; if (program < 128) return { bank, program }; }
  if ((m = /^gm:(\d{1,3})$/i.exec(str ?? '')) && +m[1] < 128) return { bank: BANK_GM, program: +m[1] };
  if ((m = /^gmd:(\d{1,3})$/i.exec(str ?? '')) && +m[1] < 128) return { bank: BANK_GM_DRUMS, program: +m[1] };
  return null;
}
export const soundStr = t => t.bank < 4 ? 'ABCD'[t.bank] + t.program : t.bank === BANK_GM_DRUMS ? 'gmd:' + t.program : 'gm:' + t.program;

const optionHtml = (t, bank, prog, label) => `<option value="${bank}:${prog}"${t.bank === bank && t.program === prog ? ' selected' : ''}>${esc(label)}</option>`;

// <option> groups for a track's instrument menu: GM sounds/kits first, then the keyboard's own (kits only for drum tracks).
export function instrumentOptions(t) {
  const groups = {};
  for (const k of KBD.filter(k => k.kit === t.drums)) (groups[k.sub] ??= []).push(k);
  const keyboardHtml = Object.entries(groups).map(([sub, list]) =>
    `<optgroup label="Keyboard · ${esc(sub)}">${list.map(k => optionHtml(t, k.bank, k.num, `${k.id} ${k.name}${k.kit ? ' (own key layout)' : ''}`)).join('')}</optgroup>`).join('');
  const gmHtml = t.drums
    ? `<optgroup label="General MIDI kits">${DRUM_KITS.map(([p, n]) => optionHtml(t, BANK_GM_DRUMS, p, n)).join('')}</optgroup>`
    : Object.entries(GM_FAMILIES).map(([family, names], f) =>
        `<optgroup label="GM · ${family}">${names.map((n, i) => optionHtml(t, BANK_GM, f * 8 + i, `${f * 8 + i + 1}. ${n}`)).join('')}</optgroup>`).join('');
  return gmHtml + keyboardHtml;
}

export const bankMsb = b => b < 4 ? 0x00 : b === BANK_GM_DRUMS ? 0x78 : 0x79;     // Bank Map KORG
export const bankLsb = b => b < 4 ? b : b === BANK_GM_DRUMS || b === BANK_GM ? 0 : b - 4;
