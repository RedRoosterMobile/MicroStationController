// Realtime controls: filter/EG knobs, the joystick pad, and the LFOs that automate both.
// Knobs and the pad hold the manual value; an LFO adds an offset on top of it.
import { $ } from '../lib/dom.js';
import { ports, send } from '../lib/midi.js';
import { store } from '../lib/store.js';
import { clamp } from '../lib/util.js';
import { session } from './session.js';

const ccMsg = (cc, value) => [0xB0 | session.ch, cc, value];
const sendQuiet = bytes => send(bytes, { silent: true });

// ---------- filter / EG knobs (realtime controls, mode A): relative -99…+99, sent as MIDI CC ----------
const KNOBS = [
  { id: 'cutoff', label: 'Cutoff', cc: 74 }, { id: 'reso', label: 'Resonance', cc: 71 }, { id: 'egint', label: 'EG Intensity', cc: 79 },
  { id: 'egrel', label: 'EG Release', cc: 72 }, { id: 'egatk', label: 'EG Attack', cc: 73 }, { id: 'egdec', label: 'EG Decay', cc: 75 }, { id: 'egsus', label: 'EG Sustain', cc: 70 },
];
const knobVal = Object.fromEntries(KNOBS.map(k => [k.id, 0]));
const knobCC = x => clamp(Math.round((x + 99) / 198 * 127), 0, 127);
const signed = x => (x > 0 ? '+' : '') + x;

function setKnob(knob, x, sendIt) {
  knobVal[knob.id] = x;
  $('k_' + knob.id).value = x;
  $('k_' + knob.id + '_v').textContent = signed(x);
  if (sendIt && ports.out && !LFO[knob.id].on) sendQuiet(ccMsg(knob.cc, knobCC(x)));
}
export function resetKnobs(sendIt) { for (const k of KNOBS) setKnob(k, 0, sendIt); }

function initKnobs() {
  $('filter').innerHTML = KNOBS.map(k => `<div class="row"><label>${k.label}</label><input type="range" id="k_${k.id}" min="-99" max="99" step="1" value="0" disabled><span class="val" id="k_${k.id}_v">0</span></div>`).join('');
  for (const k of KNOBS) {
    const slider = $('k_' + k.id);
    slider.oninput = () => setKnob(k, +slider.value, true);
    slider.onchange = () => slider.blur();            // return arrow keys to pattern stepping
    slider.ondblclick = () => setKnob(k, 0, true);
  }
  $('freset').onclick = () => resetKnobs(true);
}

// ---------- joystick: X = pitch bend, +Y = CC#1, −Y = CC#2; optionally springs back to centre ----------
const PITCH_CENTER = 8192;
let sent = { bend: PITCH_CENTER, up: 0, dn: 0 };      // last values sent, to skip redundant messages
// The pad position (padPos, -1…+1) is the base; LFOs add an offset on top, except while the pad is being dragged.
let padPos = { x: 0, y: 0 }, padDrag = false, lfoOff = { x: 0, y: 0 };

function sendStick(bend, up, dn) {
  if (bend !== sent.bend) sendQuiet([0xE0 | session.ch, bend & 127, bend >> 7]);
  if (up !== sent.up) sendQuiet(ccMsg(1, up));
  if (dn !== sent.dn) sendQuiet(ccMsg(2, dn));
  sent = { bend, up, dn };
  $('st_x').textContent = bend - PITCH_CENTER; $('st_up').textContent = up; $('st_dn').textContent = dn;
}

function applyStick() {
  const lfo = padDrag ? { x: 0, y: 0 } : lfoOff;
  const x = clamp(padPos.x + lfo.x, -1, 1), y = clamp(padPos.y + lfo.y, -1, 1);
  $('knob').style.left = (50 + x * 42) + '%';
  $('knob').style.top = (50 - y * 42) + '%';
  sendStick(Math.round(PITCH_CENTER + x * 8191), y > 0 ? Math.round(y * 127) : 0, y < 0 ? Math.round(-y * 127) : 0);
}

function moveStick(e) {
  const r = $('pad').getBoundingClientRect();
  padPos = { x: clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1), y: clamp(1 - (e.clientY - r.top) / r.height * 2, -1, 1) };
  applyStick();
}
function centerStick() { padPos = { x: 0, y: 0 }; applyStick(); }

function initStick() {
  const pad = $('pad');
  pad.onpointerdown = e => { if (!session.state) return; padDrag = true; pad.setPointerCapture(e.pointerId); moveStick(e); };
  pad.onpointermove = e => { if (pad.hasPointerCapture(e.pointerId)) moveStick(e); };
  pad.onpointerup = pad.onpointercancel = e => {
    if (!pad.hasPointerCapture(e.pointerId)) return;
    pad.releasePointerCapture(e.pointerId);
    padDrag = false;
    if ($('snap').checked) padPos = { x: 0, y: 0 };   // snap off: the stick stays where it was released
    applyStick();
  };
  $('snap').checked = store.get('stick.snap', true);
  $('snap').onchange = e => { store.set('stick.snap', e.target.checked); if (e.target.checked) centerStick(); };
}

// ---------- LFO automation for the joystick axes and the filter knobs ----------
// Rates are tempo-synced to the arp (the value is beats per cycle, so '1' = 1/4 note) or free in Hz.
const TARGETS = [
  { id: 'jx', label: 'Joystick X (bend)', axis: 'x' }, { id: 'jy', label: 'Joystick Y (CC#1 / CC#2)', axis: 'y' },
  ...KNOBS.map(k => ({ id: k.id, label: k.label, knob: k })),
];
const RATES = [['16', '4 bars'], ['8', '2 bars'], ['4', '1 bar'], ['2', '1/2'], ['1', '1/4'], ['0.5', '1/8'], ['0.25', '1/16'], ['free', 'Free (Hz)']];
const SHAPES = [['sine', 'Sine'], ['tri', 'Triangle'], ['saw', 'Saw'], ['square', 'Square'], ['rand', 'Random']];
const POLARITIES = [['bi', '±'], ['up', '+ only'], ['dn', '− only']];
const WAVES = {
  sine: p => Math.sin(2 * Math.PI * p),
  tri: p => p < .25 ? 4 * p : p < .75 ? 2 - 4 * p : 4 * p - 4,
  saw: p => 2 * ((p + .5) % 1) - 1,
  square: p => p < .5 ? 1 : -1,
};
const LFO_TICK_MS = 20;

const LFO = {};
for (const t of TARGETS) LFO[t.id] = { on: false, shape: 'sine', rate: t.knob ? '4' : '1', hz: 1, depth: 50, pol: 'bi', phase: 0, hold: 0, last: null, shown: null, outEl: null };

const lfoRow = id => $('lfos').querySelector(`[data-t="${id}"]`);
const lfoField = (id, p) => lfoRow(id).querySelector(`[data-p="${p}"]`);
const options = list => list.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');

function renderLfoRows() {
  $('lfos').innerHTML = TARGETS.map(t => `<div class="lfo" data-t="${t.id}">
  <label class="lfo-h"><input type="checkbox" data-p="on" disabled> ${t.label}</label>
  <select data-p="shape">${options(SHAPES)}</select>
  <select data-p="rate">${options(RATES)}</select>
  <input type="number" data-p="hz" min="0.05" max="20" step="0.05" value="1" style="width:70px;display:none" title="Hz">
  <select data-p="pol">${options(POLARITIES)}</select>
  <input type="range" data-p="depth" min="0" max="100" step="1" value="50" title="Depth">
  <span class="val" data-p="out"></span></div>`).join('');
  for (const t of TARGETS) lfoField(t.id, 'rate').value = LFO[t.id].rate;
}

// A worker drives the ticks so a background tab doesn't throttle them.
const tickWorker = new Worker(URL.createObjectURL(new Blob(
  ['let id;onmessage=e=>{clearInterval(id);if(e.data)id=setInterval(()=>postMessage(0),e.data)}'], { type: 'text/javascript' })));
let tickRunning = false, lastTick = 0;
tickWorker.onmessage = () => lfoTick(performance.now());

const anyLfoOn = () => TARGETS.some(t => LFO[t.id].on);
const cyclesPerSecond = l => l.rate === 'free' ? l.hz : (session.state?.tempo ?? 120) / 60 / +l.rate;

function advanceLfo(l, dt) {
  l.phase += dt * cyclesPerSecond(l);
  if (l.phase >= 1) { l.phase %= 1; l.hold = Math.random() * 2 - 1; }
  let v = l.shape === 'rand' ? l.hold : WAVES[l.shape](l.phase);
  if (l.pol === 'up') v = (v + 1) / 2;
  else if (l.pol === 'dn') v = -(v + 1) / 2;
  return v * l.depth / 100;                           // -1…+1 share of the full range
}

function lfoTick(now) {
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  const off = { x: 0, y: 0 };
  for (const t of TARGETS) {
    const l = LFO[t.id];
    if (!l.on) continue;
    const amount = advanceLfo(l, dt);
    if (!t.knob) { off[t.axis] = amount; continue; }
    const effective = clamp(Math.round(knobVal[t.id] + amount * 99), -99, 99), cc = knobCC(effective);
    if (cc !== l.last) { sendQuiet(ccMsg(t.knob.cc, cc)); l.last = cc; }
    const label = signed(effective);
    if (l.shown !== label) { l.shown = label; (l.outEl ??= lfoField(t.id, 'out')).textContent = label; }
  }
  lfoOff = off;
  if (LFO.jx.on || LFO.jy.on) applyStick();
}

function setLfo(id, on) {
  const l = LFO[id], t = TARGETS.find(x => x.id === id);
  l.on = on; l.last = null;
  lfoField(id, 'on').checked = on;
  if (on) l.phase = 0;
  else {
    lfoField(id, 'out').textContent = ''; l.shown = null;
    if (t.knob) { if (ports.out) sendQuiet(ccMsg(t.knob.cc, knobCC(knobVal[id]))); }   // back to the manual value
    else { lfoOff = { x: LFO.jx.on ? lfoOff.x : 0, y: LFO.jy.on ? lfoOff.y : 0 }; applyStick(); }
  }
  syncTickWorker();
}
function syncTickWorker() {
  if (anyLfoOn() === tickRunning) return;
  tickRunning = anyLfoOn();
  if (tickRunning) lastTick = performance.now();
  tickWorker.postMessage(tickRunning ? LFO_TICK_MS : 0);
}
export function stopLfos() { for (const t of TARGETS) if (LFO[t.id].on) setLfo(t.id, false); }

function initLfos() {
  renderLfoRows();
  $('lfos').addEventListener('input', e => {
    const row = e.target.closest('[data-t]'), p = e.target.dataset.p;
    if (!row || !p) return;
    const id = row.dataset.t, l = LFO[id];
    if (p === 'on') { setLfo(id, e.target.checked); return; }
    l[p] = p === 'depth' || p === 'hz' ? +e.target.value : e.target.value;
    if (p === 'rate') lfoField(id, 'hz').style.display = l.rate === 'free' ? '' : 'none';
  });
  $('lfostop').onclick = () => { stopLfos(); centerStick(); };
}

// ---------- shared ----------
export function initControls() { initKnobs(); initStick(); initLfos(); }

// Enable/disable everything here; losing the keyboard also stops the LFOs.
export function setControlsEnabled(on) {
  for (const k of KNOBS) $('k_' + k.id).disabled = !on;
  $('freset').disabled = !on;
  $('lfostop').disabled = !on;
  $('pad').classList.toggle('off', !on);
  document.querySelectorAll('#lfos [data-p=on]').forEach(c => c.disabled = !on);
  if (!on) stopLfos();
}
