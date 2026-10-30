// The track list: channel, instrument, volume, test note, mute and solo per track.
import { $, esc } from '../lib/dom.js';
import { send } from '../lib/midi.js';
import { describeKit, ensureKit } from './kits.js';
import { previewNote } from './player.js';
import { pushProgram, pushVol } from './routing.js';
import { instrumentOptions } from './sounds.js';
import { audible, composer, onTracksChange, saveSong } from './state.js';

const ALL_NOTES_OFF = 123;
const channelOptions = t => Array.from({ length: 16 }, (_, k) => `<option value="${k + 1}"${k + 1 === t.ch ? ' selected' : ''}>${k + 1}</option>`).join('');

export function renderTracks() {
  $('tracks').innerHTML = composer.song.tracks.map((t, i) => `
    <div class="track" data-i="${i}">
      <select data-act="ch" class="ch" title="MIDI channel">${channelOptions(t)}</select>
      <span>${esc(t.name || 'Track')}${t.kitHint ? `<br><small class="hint">${esc(t.kitHint)}</small>` : ''}</span>
      <select data-act="prog">${instrumentOptions(t)}</select>
      <input type="range" data-act="vol" min="0" max="127" value="${t.vol}" title="Volume">
      <button data-act="test" title="Play a test note on this channel">♪</button>
      <button data-act="mute" class="${t.muted ? 'on' : ''}">M</button>
      <button data-act="solo" class="${t.solo ? 'on' : ''}">S</button>
    </div>`).join('');
}

function onTrackInput(e) {
  const row = e.target.closest('.track');
  if (!row) return;
  const t = composer.song.tracks[+row.dataset.i];
  setTimeout(saveSong);
  switch (e.target.dataset.act) {
    case 'ch':
      send([0xB0 | (t.ch - 1), ALL_NOTES_OFF, 0]);      // silence the old channel
      t.ch = +e.target.value;
      pushProgram(t); pushVol(t); previewNote(t);
      break;
    case 'prog':
      [t.bank, t.program] = e.target.value.split(':').map(Number);
      t.kitHint = describeKit(t);
      pushProgram(t);
      ensureKit(t).then(() => previewNote(t));
      break;
    case 'vol':
      t.vol = +e.target.value;
      pushVol(t);
      break;
  }
}

function onTrackClick(e) {
  const row = e.target.closest('.track'), act = e.target.dataset.act;
  if (!row || !['mute', 'solo', 'test'].includes(act)) return;
  const { song } = composer, t = song.tracks[+row.dataset.i];
  if (act === 'test') { pushProgram(t); previewNote(t, true); return; }
  const flag = act === 'mute' ? 'muted' : 'solo';
  t[flag] = !t[flag];
  for (const x of song.tracks) if (!audible(x)) send([0xB0 | (x.ch - 1), ALL_NOTES_OFF, 0]);
  renderTracks();
}

export function initTracks() {
  $('tracks').addEventListener('input', onTrackInput);
  $('tracks').addEventListener('click', onTrackClick);
  onTracksChange(() => { if (composer.song) renderTracks(); });   // e.g. a drum kit layout was just learned
}
