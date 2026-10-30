// Loading songs (from the test groove, the composer API, or localStorage) and normalising them.
import { $ } from '../lib/dom.js';
import { ports } from '../lib/midi.js';
import { store } from '../lib/store.js';
import { clampInt } from '../lib/util.js';
import { applyDrumChannel } from './channels.js';
import { stop, updateButtons } from './player.js';
import { pushSetup } from './routing.js';
import { BANK_GM, BANK_GM_DRUMS, kbdByKey, parseSound, soundStr } from './sounds.js';
import { composer, saveSong } from './state.js';
import { renderTracks } from './tracks.js';

// A fixed 8-beat groove on channels 10 (drums), 2 (bass), 3 (keys), 4 (lead), 5 (pad) so routing can be tested without composing.
function testSong() {
  const drums = [], bass = [], keys = [], lead = [], pad = [[0, 8, 52, 70], [0, 8, 59, 70], [0, 8, 64, 70]];
  for (let b = 0; b < 8; b++) {
    drums.push([b, 0.1, b % 2 ? 38 : 36, 105]);
    drums.push([b, 0.1, 42, 80], [b + 0.5, 0.1, 42, 60]);
    bass.push([b, 0.9, [40, 40, 43, 38][b >> 1], 100]);
    keys.push([b + 0.5, 0.4, [64, 67, 71, 67][b % 4], 85]);
    lead.push([b, 0.8, [76, 79, 83, 79, 76, 74, 71, 74][b], 95]);
  }
  return {
    title: 'Test song', tempo: 110, beats: 8, tracks: [
      { ch: 10, name: 'Drums', sound: 'gmd:0', vol: 105, notes: drums },
      { ch: 2, name: 'Bass', sound: 'gm:33', vol: 105, notes: bass },
      { ch: 3, name: 'Keys', sound: 'gm:4', vol: 95, notes: keys },
      { ch: 4, name: 'Lead', sound: 'gm:80', vol: 90, notes: lead },
      { ch: 5, name: 'Pad', sound: 'gm:89', vol: 80, notes: pad },
    ],
  };
}

// Whether the sound is a drum kit (GM kit bank, or one of the keyboard's own kit programs).
const isKitSound = snd => snd.bank === BANK_GM_DRUMS || (snd.bank < 4 && !!kbdByKey.get(snd.bank + ':' + snd.program)?.kit);

// Normalise whatever the model (or storage) returned, then make it the current song.
export function loadSong(s) {
  s.tracks = (s.tracks ?? []).filter(t => t.ch >= 1 && t.ch <= 16 && Array.isArray(t.notes));
  for (const t of s.tracks) {
    t.drums ??= t.ch === 10;
    const snd = parseSound(t.sound)
      ?? (t.bank !== undefined ? { bank: t.bank, program: t.program } : { bank: t.drums ? BANK_GM_DRUMS : BANK_GM, program: clampInt(t.program ?? 0, 0, 127) });
    if (t.drums !== isKitSound(snd)) Object.assign(snd, { bank: t.drums ? BANK_GM_DRUMS : BANK_GM, program: 0 });   // sound kind must match track kind
    t.bank = snd.bank; t.program = snd.program; delete t.sound;
    t.vol ??= 100; t.muted = false; t.solo = false;
  }
  s.tempo = +s.tempo || 120;
  s.beats = +s.beats || Math.max(4, ...s.tracks.flatMap(t => t.notes.map(n => n[0] + n[1])));
  applyDrumChannel(s);
  composer.song = s;
  $('title').textContent = s.title || 'Song';
  $('tempo').value = Math.round(s.tempo);
  renderTracks();
  if (ports.out) pushSetup();
  saveSong();
  updateButtons();
}

export function loadSavedSong() {
  const saved = store.get('comp.song', null);
  if (saved) loadSong(saved);
}

// The song as the model sees it (sound ids instead of bank/program numbers, no UI state).
const forModel = song => ({
  title: song.title, tempo: song.tempo, beats: song.beats,
  tracks: song.tracks.map(t => ({ ch: t.ch, name: t.name, sound: soundStr(t), vol: t.vol, notes: t.notes })),
});

async function compose(revise) {
  const prompt = $('prompt').value.trim();
  if (!prompt) return;
  $('compose').disabled = $('revise').disabled = true;
  $('cstatus').textContent = 'Composing… (this takes ~20–60 s)';
  try {
    const r = await fetch('api/compose', { method: 'POST', body: JSON.stringify({ prompt, song: revise ? forModel(composer.song) : undefined }) });
    const j = await r.json().catch(() => null);          // the compose endpoint always answers JSON; anything else is a static host
    if (!j) throw new Error('composing needs the local dev server (npm run dev)');
    if (!r.ok) throw new Error(j.error || r.status);
    stop();
    loadSong(j);
    $('cstatus').textContent = '';
  } catch (e) { $('cstatus').textContent = 'Failed: ' + e.message; }
  $('compose').disabled = false;
  updateButtons();
}

// The preferred drum channel changed: re-home the drum tracks of the current song.
export function onDrumChannelChange() {
  const { song } = composer;
  if (!song) return;
  applyDrumChannel(song);
  renderTracks();
  if (ports.out) pushSetup();
  saveSong();
}

export function initSong() {
  $('test').onclick = () => { stop(); loadSong(testSong()); };
  $('compose').onclick = () => compose(false);
  $('revise').onclick = () => compose(true);
}
