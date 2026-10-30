// Sound selection: Programs A–D, Combinations A–C (raw index = bank * 128 + number), and Program/Combination mode switching.
import SOUNDS from '../../sounds.json';
import { $, banner, esc } from '../lib/dom.js';
import { send } from '../lib/midi.js';
import { store } from '../lib/store.js';
import { clamp, pickRandom, sleep } from '../lib/util.js';
import { resetKnobs, stopLfos } from './controls.js';
import { hdr, readCurrent, restoreArp } from './device.js';
import { FN } from './protocol.js';
import { session } from './session.js';

const BANK_LETTERS = 'ABCD';
const SOUND_LIST_LIMIT = 300;

const bankCount = () => session.state?.kind === 'combi' ? 3 : 4;
const soundList = () => SOUNDS[session.state?.kind === 'combi' ? 'combis' : 'programs'];
const rawOf = s => BANK_LETTERS.indexOf(s.bank) * 128 + s.num;
const soundCode = raw => BANK_LETTERS[raw >> 7] + String(raw & 127).padStart(3, '0');
const soundAt = raw => soundList().find(s => s.bank === BANK_LETTERS[raw >> 7] && s.num === (raw & 127));

// Main categories and their sub-categories (Parameter Guide, Program/Combination select).
const CATEGORIES = {
  'Keyboard': ['A.Piano', 'Synth E.P', 'Real E.P', 'Clav/Harpsi', 'E.Organ', 'Pipe Organ'],
  'Strings / Brass / Woodwind': ['Orchestral', 'World', 'Strings', 'Vocal', 'Airy', 'Brass', 'Woodwind', 'Reed'],
  'Guitar': ['A.Guitar', 'E.Guitar', 'Plucked'],
  'Bass & Bass Split': ['E.Bass', 'A.Bass', 'Synth Bass', 'Bass Split', 'Bass'],
  'Synth': ['Fast', 'Slow', 'Motion', 'Short decay'],
  'Lead & Solo Split': ['Syn Lead', 'Solo Split'],
  'Drum / Mallet / Hits': ['Natural', 'Dance', 'Perc', 'Bell', 'Mallet', 'SFX', 'Hits'],
};
const categoryOf = Object.fromEntries(Object.entries(CATEGORIES).flatMap(([cat, subs]) => subs.map(sub => [sub, cat])));
for (const list of Object.values(SOUNDS)) for (const s of list) s.cat = categoryOf[s.sub] ?? '';

let candidates = [];                                  // raw indexes the list currently shows, for the random button

// Find the current sound by name unless we already know it.
export function syncSound() {
  const { state, curSound } = session;
  if (curSound !== null && soundAt(curSound)?.name === state.name) return;
  const hit = soundList().find(s => s.name === state.name);
  session.curSound = hit ? rawOf(hit) : null;
}

// Rapid presses coalesce: only the latest requested sound is sent once the previous change finished.
let busy = false, desired = null;
async function goSound(raw) {
  desired = clamp(raw, 0, bankCount() * 128 - 1);
  if (busy) return;
  busy = true;
  try {
    while (desired !== null) {
      const target = desired;
      desired = null;
      const wasOn = !!session.state?.arp;
      send([0xB0 | session.ch, 0x00, 0x00]); await sleep(40);        // bank select MSB
      send([0xB0 | session.ch, 0x20, target >> 7]); await sleep(40); // bank select LSB
      send([0xC0 | session.ch, target & 127]); await sleep(500);     // program change
      session.curSound = target; stopLfos(); resetKnobs(false);
      try { await readCurrent(); await restoreArp(wasOn, $('keeparp').checked); } catch (e) { banner('Re-read failed: ' + e.message); }
    }
  } finally { busy = false; }
}
export const stepSound = delta => session.state && goSound((desired ?? session.curSound ?? 0) + delta);

async function switchMode(mode) {                       // 0 = Combination Play, 2 = Program Play
  banner('Switching mode…');
  session.curSound = null; desired = null; stopLfos(); resetKnobs(false);
  const wasOn = !!session.state?.arp;
  send([...hdr(), FN.MODE_CHANGE, mode, 0xF7]);
  await sleep(2500);                                    // the unit ignores requests for a moment after a mode change
  try { await readCurrent(); await restoreArp(wasOn, $('keeparp').checked); banner(''); }
  catch (e) { banner('Mode switch sent, but re-read failed: ' + e.message + '. Try “Re-read”.'); }
}

export function renderSounds() {
  const bankSel = $('selbank'), banks = bankCount();
  if (bankSel.options.length !== banks) bankSel.innerHTML = Array.from({ length: banks }, (_, i) => `<option value="${i}">Bank ${BANK_LETTERS[i]}</option>`).join('');
  if (session.curSound !== null) {
    bankSel.value = session.curSound >> 7;
    if (document.activeElement !== $('selnum')) $('selnum').value = session.curSound & 127;
  }
  const catSel = $('selcat');
  if (catSel.options.length === 1) catSel.innerHTML += Object.keys(CATEGORIES).map(c => `<option>${c}</option>`).join('');

  const query = $('selsearch').value.trim().toLowerCase(), words = query.split(/\s+/).filter(Boolean), cat = catSel.value;
  const matches = soundList().filter(s => (!cat || s.cat === cat) &&
    words.every(w => `${s.name} ${s.sub} ${s.cat} ${s.bank}${String(s.num).padStart(3, '0')}`.toLowerCase().includes(w)));
  const rows = matches.slice(0, SOUND_LIST_LIMIT);
  candidates = matches.map(rawOf);

  $('selcount').textContent = `${matches.length} sound${matches.length === 1 ? '' : 's'}` + (matches.length > rows.length ? ` (showing ${rows.length})` : '');
  $('sellist').innerHTML = rows.map(s => {
    const raw = rawOf(s);
    return `<div class="s${raw === session.curSound ? ' cur' : ''}" data-sraw="${raw}" title="${esc(s.cat)}"><span>${soundCode(raw)}</span><span>${esc(s.name)}</span><span>${esc(s.sub)}</span></div>`;
  }).join('') || '<div class="s"><span></span><span>No match</span><span></span></div>';
  const current = $('sellist').querySelector('.cur');
  if (current && !query) current.scrollIntoView({ block: 'nearest' });
}

export function initSounds() {
  $('keeparp').checked = store.get('arp.keepArp', true);
  $('keeparp').onchange = e => store.set('arp.keepArp', e.target.checked);

  $('modes').onclick = e => { const b = e.target.closest('button'); if (b && !b.disabled) switchMode(+b.dataset.mode); };
  $('srandom').onclick = () => { const r = pickRandom(candidates, session.curSound); if (r !== null) goSound(r); };
  $('sprev').onclick = () => stepSound(-1);
  $('snext').onclick = () => stepSound(+1);
  $('selsearch').oninput = renderSounds;
  $('selcat').onchange = renderSounds;
  $('sellist').onclick = e => { const row = e.target.closest('.s'); if (row?.dataset.sraw) goSound(+row.dataset.sraw); };

  const gotoTyped = () => { const n = $('selnum').value; goSound(+$('selbank').value * 128 + clamp(n === '' ? 0 : +n, 0, 127)); };
  $('selbank').onchange = gotoTyped;
  $('selnum').onchange = gotoTyped;
}
