// Realtime playback: schedules the song's note events a little ahead of time onto the MIDI output.
import { $ } from '../lib/dom.js';
import { ports, send } from '../lib/midi.js';
import { clampInt } from '../lib/util.js';
import { drumNote } from './kits.js';
import { pushSetup } from './routing.js';
import { audible, composer } from './state.js';

const LOOKAHEAD_MS = 150;
const TICK_MS = 40;
const START_DELAY_MS = 120;
const MIN_NOTE_BEATS = 0.05;
const ALL_NOTES_OFF = 123;

let playing = false, timer = null, events = [], idx = 0, loopNo = 0, anchorMs = 0, anchorBeat = 0;
const msPerBeat = () => 60000 / composer.song.tempo;

export function updateButtons() {
  const { song } = composer;
  $('play').disabled = !song || !ports.out || playing;
  $('stop').disabled = !playing;
  $('revise').disabled = !song;
  $('dl').disabled = !song;
}

// Flat, time-sorted list of note-on / note-off events (offs sort before ons at the same beat).
function buildEvents() {
  events = [];
  composer.song.tracks.forEach((t, ti) => t.notes.forEach(([start, dur, n, vel]) => {
    const length = Math.max(MIN_NOTE_BEATS, dur);
    events.push({ b: start, on: true, ti, n, v: clampInt(vel ?? 90, 1, 127) });
    events.push({ b: start + length - 0.001, on: false, ti, n });
  }));
  events.sort((a, b) => a.b - b.b || (a.on - b.on));
}

export function play() {
  if (!composer.song || !ports.out) return;
  stop();
  pushSetup();
  buildEvents();
  idx = 0; loopNo = 0; playing = true;
  anchorMs = performance.now() + START_DELAY_MS; anchorBeat = 0;
  timer = setInterval(tick, TICK_MS);
  updateButtons();
}

function tick() {
  const { song } = composer;
  const now = performance.now();
  const nowBeat = anchorBeat + (now - anchorMs) / msPerBeat();
  const horizon = nowBeat + LOOKAHEAD_MS / msPerBeat();
  for (;;) {
    if (idx >= events.length) {
      loopNo++; idx = 0;
      if (!$('loop').checked) { if (nowBeat > loopNo * song.beats) stop(); return; }
    }
    const e = events[idx], abs = loopNo * song.beats + e.b;
    if (abs > horizon) break;
    idx++;
    const time = anchorMs + (abs - anchorBeat) * msPerBeat(), track = song.tracks[e.ti], c = track.ch - 1;
    const n = drumNote(track, e.n);
    if (n === null) continue;
    if (e.on) { if (audible(track)) send([0x90 | c, n, e.v], { time }); }
    else send([0x80 | c, n, 0], { time });
  }
  $('pos').textContent = `beat ${(nowBeat % song.beats + 1).toFixed(1)} / ${song.beats}`;
}

export function stop() {
  clearInterval(timer); timer = null; playing = false;
  try { ports.out?.clear?.(); } catch { /* not supported */ }
  if (ports.out) for (let c = 0; c < 16; c++) send([0xB0 | c, ALL_NOTES_OFF, 0]);
  $('pos').textContent = '';
  updateButtons();
}

// Short audition note so an instrument change is audible even when stopped (`force` also plays during playback).
export function previewNote(t, force = false) {
  if (playing && !force) return;
  const c = t.ch - 1, n = t.drums ? (drumNote(t, 38) ?? drumNote(t, 36) ?? 38) : (t.notes[0]?.[2] ?? 60);
  send([0x90 | c, n, 100]);
  setTimeout(() => send([0x80 | c, n, 0]), 350);
}

export function initPlayer() {
  $('play').onclick = play;
  $('stop').onclick = stop;
  $('tempo').onchange = () => {
    const { song } = composer;
    if (!song) return;
    const nowBeat = playing ? anchorBeat + (performance.now() - anchorMs) / msPerBeat() : 0;
    song.tempo = clampInt($('tempo').value, 30, 300);
    if (playing) { anchorBeat = nowBeat; anchorMs = performance.now(); }   // keep the current beat when the tempo changes
  };
}
