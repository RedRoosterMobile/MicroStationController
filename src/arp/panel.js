// The main arp panel: render() from the session state, plus the arp on/off/latch, tempo and per-slot controls.
import { $, esc } from '../lib/dom.js';
import { ports } from '../lib/midi.js';
import { clamp } from '../lib/util.js';
import { setControlsEnabled } from './controls.js';
import { setParam, setSlot } from './device.js';
import { ARP_GLOBAL, ARP_SLOT, GATE_STEP, PARAM, VEL_KEY, VEL_STEP } from './protocol.js';
import { editedTag, patternLabel, renderPatternList } from './patterns.js';
import { session } from './session.js';
import { renderSounds } from './sounds.js';

const RESOLUTIONS = ['1/16 triplet', '1/16', '1/8 triplet', '1/8', '1/4 triplet', '1/4'];
const options = list => list.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
const PANEL_INPUTS = ['arp', 'latch', 'tempo', 'psearch', 'prev', 'next', 'save', 'sprev', 'snext', 'srandom', 'prandom', 'selbank', 'selnum', 'selsearch', 'selcat'];

// ---------- arp slots (one for a Program, A and B for a Combination) ----------
function slotHtml(slot) {
  const label = slot === 'P' ? '' : `<h3>Arpeggiator ${slot}</h3>`;
  const f = n => `data-slot="${slot}" data-f="${n}"`;
  return `<div class="slot">${label}
    <div class="row"><label>Octave</label><input type="range" ${f('octave')} min="1" max="4" step="1"><span class="val" ${f('octave_v')}></span></div>
    <div class="row"><label>Resolution</label>
      <select ${f('res')}>${options(RESOLUTIONS.map((t, i) => [i, t]))}</select><span></span></div>
    <div class="row"><label>Gate</label><div class="bar"><select ${f('gate_m')}>${options([['v', 'Value'], ['s', 'Step']])}</select>
      <input type="range" ${f('gate')} min="0" max="100" step="1" class="grow"></div><span class="val" ${f('gate_v')}></span></div>
    <div class="row"><label>Velocity</label><div class="bar"><select ${f('vel_m')}>${options([['v', 'Value'], ['k', 'Key'], ['s', 'Step']])}</select>
      <input type="range" ${f('vel')} min="1" max="127" step="1" class="grow"></div><span class="val" ${f('vel_v')}></span></div>
    <div class="row"><label>Swing</label><input type="range" ${f('swing')} min="-100" max="100" step="1"><span class="val" ${f('swing_v')}></span></div>
  </div>`;
}
const slotEl = (slot, f) => document.querySelector(`[data-slot="${slot}"][data-f="${f}"]`);

// Rebuild the slot controls only when the set of slots changes (Program ↔ Combination).
function buildSlots() {
  const want = session.state ? Object.keys(session.state.slots).join('') : '';
  if ($('slots').dataset.built === want) return;
  $('slots').dataset.built = want;
  $('slots').innerHTML = want.split('').map(slotHtml).join('');
  $('tabs').innerHTML = want.length > 1 ? want.split('').map(s => `<button data-tab="${s}">${s}</button>`).join('') : '';
}

function renderSlot(slot, v) {
  const set = (f, value) => { slotEl(slot, f).value = value; };
  const label = (f, text) => { slotEl(slot, f + '_v').textContent = text; };

  set('octave', v.octave); label('octave', v.octave);
  set('res', v.res);

  const gateStep = v.gate === GATE_STEP;
  set('gate_m', gateStep ? 's' : 'v');
  slotEl(slot, 'gate').disabled = gateStep;
  if (!gateStep) set('gate', v.gate);
  label('gate', gateStep ? 'Step' : v.gate + ' %');

  const velMode = v.vel === VEL_KEY ? 'k' : v.vel === VEL_STEP ? 's' : 'v';
  set('vel_m', velMode);
  slotEl(slot, 'vel').disabled = velMode !== 'v';
  if (velMode === 'v') set('vel', v.vel);
  label('vel', velMode === 'k' ? 'Key' : velMode === 's' ? 'Step' : v.vel);

  set('swing', v.swing); label('swing', v.swing);
}

export function render() {
  const { state } = session;
  const on = !!state;
  buildSlots();
  $('pmode').textContent = session.modeLabel;
  for (const id of PANEL_INPUTS) $(id).disabled = !on;
  $('refresh').disabled = !ports.out; $('names').disabled = !ports.out;
  setControlsEnabled(on);
  document.querySelectorAll('#modes button').forEach(b => { b.disabled = !ports.out; b.classList.toggle('on', on && (state.kind === 'combi') === (b.dataset.mode === '0')); });
  document.querySelectorAll('#slots input, #slots select').forEach(e => e.disabled = !on);
  if (!on) { $('pname').textContent = '–'; $('pcur').textContent = '–'; return; }

  $('kind').textContent = state.kind === 'combi' ? 'Combination' : 'Program';
  $('pname').textContent = state.name;
  renderSounds();
  $('arp').checked = !!state.arp; $('latch').checked = !!state.latch;
  $('tempo').value = Math.round(state.tempo); $('tempo_v').textContent = state.tempo.toFixed(2) + ' BPM';
  for (const [slot, v] of Object.entries(state.slots)) renderSlot(slot, v);

  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === session.activeSlot));
  const raw = state.slots[session.activeSlot].pattern;
  $('pcur').innerHTML = (state.kind === 'combi' ? session.activeSlot + ': ' : '') + esc(patternLabel(raw)) + editedTag(raw);
  renderPatternList();
}

// ---------- tempo: slider, or click the BPM number to type (Enter or blur applies, Esc cancels) ----------
const TEMPO_MIN = 40, TEMPO_MAX = 300;
const setTempo = bpm => setParam(PARAM.ARP_GLOBAL, ARP_GLOBAL.TEMPO, Math.round(bpm * 100));

function initTempo() {
  const text = $('tempo_v'), field = $('tempo_n');
  $('tempo').oninput = e => $('tempo_v').textContent = e.target.value + ' BPM';
  $('tempo').onchange = e => { setTempo(e.target.value); e.target.blur(); };

  text.onclick = () => {
    if (!session.state) return;
    field.value = session.state.tempo.toFixed(2).replace(/\.?0+$/, '');
    text.style.display = 'none'; field.style.display = '';
    field.focus(); field.select();
  };
  const close = commit => {
    if (field.style.display === 'none') return;
    const bpm = parseFloat(field.value);
    field.style.display = 'none'; text.style.display = '';
    if (commit && Number.isFinite(bpm)) setTempo(clamp(bpm, TEMPO_MIN, TEMPO_MAX));
  };
  field.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); close(true); }
    else if (e.key === 'Escape') close(false);
  };
  field.onblur = () => close(true);
}

// ---------- per-slot controls ----------
// Maps a control (data-f) to the slot parameter it writes.
function slotChange(slot, field, el, cur) {
  const n = +el.value;
  switch (field) {
    case 'octave': return setSlot(slot, ARP_SLOT.OCTAVE, n - 1);
    case 'res': return setSlot(slot, ARP_SLOT.RESOLUTION, n);
    case 'gate': return setSlot(slot, ARP_SLOT.GATE, n);
    case 'gate_m': return setSlot(slot, ARP_SLOT.GATE, el.value === 's' ? GATE_STEP : (cur.gate === GATE_STEP ? 100 : cur.gate));
    case 'vel': return setSlot(slot, ARP_SLOT.VELOCITY, n);
    case 'vel_m': return setSlot(slot, ARP_SLOT.VELOCITY, el.value === 'k' ? VEL_KEY : el.value === 's' ? VEL_STEP : (cur.vel >= VEL_KEY ? 100 : cur.vel));
    case 'swing': return setSlot(slot, ARP_SLOT.SWING, n);
  }
}

function initSlots() {
  $('arp').onchange = e => setParam(PARAM.ARP_GLOBAL, ARP_GLOBAL.ON, e.target.checked ? 1 : 0);
  $('latch').onchange = e => setParam(PARAM.ARP_GLOBAL, ARP_GLOBAL.LATCH, e.target.checked ? 1 : 0);

  $('slots').addEventListener('input', e => {             // live value readout while dragging
    const { f, slot } = e.target.dataset;
    const readout = f && slotEl(slot, f + '_v');
    if (readout) readout.textContent = f === 'gate' ? e.target.value + ' %' : e.target.value;
  });
  $('slots').addEventListener('change', e => {
    const { f, slot } = e.target.dataset;
    if (!f) return;
    slotChange(slot, f, e.target, session.state.slots[slot]);
    if (e.target.type === 'range') e.target.blur();       // return arrow keys to pattern stepping
  });

  $('tabs').onclick = e => {
    const b = e.target.closest('button');
    if (b) { session.activeSlot = b.dataset.tab; render(); }
  };
}

export function initPanel() { initTempo(); initSlots(); }
