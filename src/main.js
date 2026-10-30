import FACTORY from '../arp_patterns.json';
import SOUNDS from '../sounds.json';

const $ = id => document.getElementById(id);
const hex = a => Array.from(a, b => b.toString(16).padStart(2, '0')).join(' ');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const MAX_RAW = 5 + 639;                         // P0–P4, then U000–U639 (raw = 5 + U-number)

let access, out, inp, ch = 0, state = null, waiters = [], quiet = false;
let activeSlot = 'P';

// ---------- storage (per-browser conveniences only) ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
let favs = new Set(store.get('arp.favs', []));
let unitNames = store.get('arp.unitNames', {});   // U-number -> { name, length }

// ---------- pattern catalogue ----------
const factoryByRaw = new Map(FACTORY.map(p => [p.raw, p]));
function patternInfo(raw) {
  const f = factoryByRaw.get(raw);
  if (raw < 5) return { raw, slot: f.slot, name: f.name, empty: false, length: null, edited: false };
  const u = raw - 5, unit = unitNames[u];
  const slot = 'U' + String(u).padStart(3, '0');
  // U512–U639 ship blank: the unit names them "ArpeggioPatternNNNN" and no step is switched on, so they play nothing
  const empty = unit ? unit.name.startsWith('ArpeggioPattern') : !f;
  const name = empty ? '(empty user slot)' : unit?.name ?? f.name;
  return { raw, slot, name, empty, length: empty ? null : unit?.length ?? f?.length ?? null, edited: !!(unit && f && unit.name !== f.name) };
}
const patLabel = raw => { const p = patternInfo(raw); return `${p.slot} ${p.name}`; };

// ---------- log / banner ----------
function log(s) { if (quiet) return; const l = $('log'); l.textContent += s + '\n'; l.scrollTop = l.scrollHeight; }
function banner(msg) { const b = $('banner'); b.textContent = msg || ''; b.classList.toggle('show', !!msg); }

// ---------- MIDI plumbing ----------
const hdr = () => [0xF0, 0x42, 0x30 | ch, 0x00, 0x01, 0x0D];
function send(bytes) { out.send(bytes); log('→ ' + (bytes.length > 24 ? hex(bytes.slice(0, 24)) + ' …' : hex(bytes))); }

function onMessage(e) {
  const d = e.data;
  if (d[0] !== 0xF0) return;                       // ignore realtime / active sensing
  log('← ' + (d.length > 24 ? hex(d.slice(0, 24)) + ` … (${d.length} bytes)` : hex(d)));
  waiters = waiters.filter(w => { if (w.match(d)) { w.resolve(d); return false; } return true; });
}
function request(bytes, match, ms = 1500) {
  return new Promise((resolve, reject) => {
    const w = { match, resolve };
    waiters.push(w);
    setTimeout(() => { if (waiters.includes(w)) { waiters = waiters.filter(x => x !== w); reject(new Error('timeout')); } }, ms);
    send(bytes);
  });
}

// Korg 8-byte → 7-byte unpack (MIDIimp note *1): first byte of each group holds the MSBs.
function unpack(body) {
  const o = [];
  for (let i = 0; i < body.length; i += 8) {
    const g = body.slice(i, i + 8);
    for (let j = 1; j < g.length; j++) o.push(g[j] | (((g[0] >> (j - 1)) & 1) << 7));
  }
  return o;
}
const s8 = v => v > 127 ? v - 256 : v;
const text = (o, from, n) => String.fromCharCode(...o.slice(from, from + n)).trim();

// ---------- parsing ----------
// Program and Combination share the arp block at 620+: A (or the Program's single arp) at 628, B at 640.
function parseSlot(o, base) {
  return {
    pattern: o[base] | (o[base + 1] << 8),
    octave: (o[base + 2] & 3) + 1, res: (o[base + 2] >> 2) & 7,
    gate: o[base + 4], vel: o[base + 5], swing: s8(o[base + 6]),
  };
}
function parseCurrent(d, kind) {
  const o = unpack(d.slice(9, d.length - 1));
  if (o.length < (kind === 'combi' ? 652 : 640)) throw new Error('short dump: ' + o.length);
  const slots = kind === 'combi' ? { A: parseSlot(o, 628), B: parseSlot(o, 640) } : { P: parseSlot(o, 628) };
  return { kind, name: text(o, 0, 24), tempo: (o[620] | (o[621] << 8)) / 100, arp: o[624] & 1, latch: (o[624] >> 1) & 1, slots };
}

const MODE_NAMES = { 0: 'Combination Play', 1: 'Combination Edit', 2: 'Program Play', 3: 'Program Edit', 4: 'Sequencer', 6: 'Global' };

// The unit sometimes ignores a request right after a mode/sound change, so retry a couple of times.
async function readCurrent() {
  let err;
  for (let i = 0; i < 3; i++) {
    try { return await readOnce(); } catch (e) { err = e; await sleep(600); }
  }
  throw err;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readOnce() {
  const mode = await request([...hdr(), 0x12, 0xF7], d => d[6] === 0x42);
  const m = mode[7] & 7;
  $('pmode').textContent = 'Keyboard mode: ' + (MODE_NAMES[m] ?? m);
  const kind = m === 2 || m === 3 ? 'prog' : m === 0 || m === 1 ? 'combi' : null;
  if (!kind) {
    banner(`The keyboard is in ${MODE_NAMES[m] ?? 'another'} mode. Press PROG or COMBI on the keyboard, then click “Re-read”.`);
    state = null; render(); return;
  }
  banner('');
  const obj = kind === 'combi' ? 0x01 : 0x00;
  const d = await request([...hdr(), 0x74, obj, 0xF7], d => d[6] === 0x75 && d[7] === obj, 2500);
  state = parseCurrent(d, kind);
  if (!state.slots[activeSlot]) activeSlot = Object.keys(state.slots)[0];
  syncSound();
  render();
}

// ---------- sounds: Programs A–D, Combinations A–C (raw = bank * 128 + number) ----------
const BANKS = () => state?.kind === 'combi' ? 3 : 4;
const soundList = () => SOUNDS[state?.kind === 'combi' ? 'combis' : 'programs'];
const soundCode = raw => 'ABCD'[raw >> 7] + String(raw & 127).padStart(3, '0');
const soundAt = raw => soundList().find(s => s.bank === 'ABCD'[raw >> 7] && s.num === (raw & 127));
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
const catOf = Object.fromEntries(Object.entries(CATEGORIES).flatMap(([c, subs]) => subs.map(s => [s, c])));
for (const list of Object.values(SOUNDS)) for (const s of list) s.cat = catOf[s.sub] ?? '';
let soundCandidates = [], patternCandidates = [];     // whatever the lists currently show, for the random buttons
const pickRandom = (arr, not) => { const pool = arr.filter(x => x !== not); return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null; };
let curSound = null;                              // raw index of the selected sound, if known
function syncSound() {                              // find the current sound by name unless we already know it
  if (curSound !== null && soundAt(curSound)?.name === state.name) return;
  const hit = soundList().find(s => s.name === state.name);
  curSound = hit ? 'ABCD'.indexOf(hit.bank) * 128 + hit.num : null;
}
let soundBusy = false, desiredSound = null;
async function goSound(raw) {
  desiredSound = clamp(raw, 0, BANKS() * 128 - 1);
  if (soundBusy) return;
  soundBusy = true;
  try {
    while (desiredSound !== null) {
      const t = desiredSound; desiredSound = null;
      const wasOn = !!state?.arp;
      send([0xB0 | ch, 0x00, 0x00]); await sleep(40);
      send([0xB0 | ch, 0x20, t >> 7]); await sleep(40);
      send([0xC0 | ch, t & 127]); await sleep(500);
      curSound = t; resetKnobs(false);
      try { await readCurrent(); await restoreArp(wasOn); } catch (e) { banner('Re-read failed: ' + e.message); }
    }
  } finally { soundBusy = false; }
}
// Each sound stores its own arp on/off flag, so a sound change usually turns the arp off. Put it back if it was on.
async function restoreArp(wasOn) {
  if (wasOn && $('keeparp').checked && state && !state.arp) await setParam(0x02, 0x01, 1);
}
$('keeparp').checked = store.get('arp.keepArp', true);
$('keeparp').onchange = e => store.set('arp.keepArp', e.target.checked);
const stepSound = d => state && goSound((desiredSound ?? curSound ?? 0) + d);

async function switchMode(m) {                      // 0 = Combination Play, 2 = Program Play
  banner('Switching mode…'); curSound = null; desiredSound = null; resetKnobs(false);
  const wasOn = !!state?.arp;
  send([...hdr(), 0x4E, m, 0xF7]);
  await sleep(2500);                                // the unit ignores requests for a moment after a mode change
  try { await readCurrent(); await restoreArp(wasOn); banner(''); } catch (e) { banner('Mode switch sent, but re-read failed: ' + e.message + '. Try “Re-read”.'); }
}

// Parameter change (function 41): value as 5 groups of 7 bits (top group 4 bits), negatives two's-complement.
const modeByte = () => state?.kind === 'combi' ? 0x00 : 0x02;
const slotId = slot => slot === 'B' ? 0x04 : 0x03;
async function setParam(id, sub, value) {
  const v = value >>> 0;
  send([...hdr(), 0x41, modeByte(), 0x00, id, 0x00, sub, (v >>> 28) & 0x0F, (v >>> 21) & 0x7F, (v >>> 14) & 0x7F, (v >>> 7) & 0x7F, v & 0x7F, 0xF7]);
  await new Promise(r => setTimeout(r, 120));
  try { await readCurrent(); } catch (e) { banner('Re-read failed: ' + e.message); }
}
const setSlot = (slot, sub, value) => setParam(slotId(slot), sub, value);

// ---------- filter / EG knobs (realtime controls, mode A): relative -99…+99, sent as MIDI CC ----------
const KNOBS = [
  { id: 'cutoff', label: 'Cutoff', cc: 74 }, { id: 'reso', label: 'Resonance', cc: 71 }, { id: 'egint', label: 'EG Intensity', cc: 79 },
  { id: 'egrel', label: 'EG Release', cc: 72 }, { id: 'egatk', label: 'EG Attack', cc: 73 }, { id: 'egdec', label: 'EG Decay', cc: 75 }, { id: 'egsus', label: 'EG Sustain', cc: 70 },
];
const knobVal = {};
const knobCC = x => clamp(Math.round((x + 99) / 198 * 127), 0, 127);
$('filter').innerHTML = KNOBS.map(k => `<div class="row"><label>${k.label}</label><input type="range" id="k_${k.id}" min="-99" max="99" step="1" value="0" disabled><span class="val" id="k_${k.id}_v">0</span></div>`).join('');
function setKnob(k, x, sendIt) {
  knobVal[k.id] = x; $('k_' + k.id).value = x; $('k_' + k.id + '_v').textContent = (x > 0 ? '+' : '') + x;
  if (sendIt && out) send([0xB0 | ch, k.cc, knobCC(x)]);
}
function resetKnobs(sendIt) { for (const k of KNOBS) setKnob(k, 0, sendIt); }
for (const k of KNOBS) {
  const r = $('k_' + k.id);
  r.oninput = () => setKnob(k, +r.value, true);
  r.onchange = () => r.blur();                      // return arrow keys to pattern stepping
  r.ondblclick = () => setKnob(k, 0, true);
}
$('freset').onclick = () => resetKnobs(true);

// ---------- joystick: X = pitch bend, +Y = CC#1, −Y = CC#2; springs back to centre ----------
const pad = $('pad'), padKnob = $('knob');
let stick = { bend: 8192, up: 0, dn: 0 };
function sendStick(bend, up, dn) {
  if (bend !== stick.bend) send([0xE0 | ch, bend & 127, bend >> 7]);
  if (up !== stick.up) send([0xB0 | ch, 1, up]);
  if (dn !== stick.dn) send([0xB0 | ch, 2, dn]);
  stick = { bend, up, dn };
  $('st_x').textContent = bend - 8192; $('st_up').textContent = up; $('st_dn').textContent = dn;
}
function moveStick(e) {
  const r = pad.getBoundingClientRect();
  const x = clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1), y = clamp(1 - (e.clientY - r.top) / r.height * 2, -1, 1);
  padKnob.style.left = (50 + x * 42) + '%'; padKnob.style.top = (50 - y * 42) + '%';
  sendStick(Math.round(8192 + x * 8191), y > 0 ? Math.round(y * 127) : 0, y < 0 ? Math.round(-y * 127) : 0);
}
pad.onpointerdown = e => { if (!state) return; pad.setPointerCapture(e.pointerId); moveStick(e); };
pad.onpointermove = e => { if (pad.hasPointerCapture(e.pointerId)) moveStick(e); };
const releaseStick = e => {
  if (!pad.hasPointerCapture(e.pointerId)) return;
  pad.releasePointerCapture(e.pointerId);
  padKnob.style.left = padKnob.style.top = '50%';
  sendStick(8192, 0, 0);
};
pad.onpointerup = pad.onpointercancel = releaseStick;

// ---------- pattern stepping (coalesces rapid presses) ----------
let stepBusy = false, desired = null;
async function goPattern(raw) {
  desired = clamp(raw, 0, MAX_RAW);
  if (stepBusy) return;
  stepBusy = true;
  try { while (desired !== null) { const t = desired; desired = null; await setSlot(activeSlot, 0x00, t); } }
  finally { stepBusy = false; }
}
const stepPattern = delta => state && goPattern((desired ?? state.slots[activeSlot].pattern) + delta);

// ---------- rendering ----------
function slotHtml(slot) {
  const label = slot === 'P' ? '' : `<h3>Arpeggiator ${slot}</h3>`;
  const f = n => `data-slot="${slot}" data-f="${n}"`;
  return `<div class="slot">${label}
    <div class="row"><label>Octave</label><input type="range" ${f('octave')} min="1" max="4" step="1"><span class="val" ${f('octave_v')}></span></div>
    <div class="row"><label>Resolution</label>
      <select ${f('res')}><option value="0">1/16 triplet</option><option value="1">1/16</option><option value="2">1/8 triplet</option><option value="3">1/8</option><option value="4">1/4 triplet</option><option value="5">1/4</option></select><span></span></div>
    <div class="row"><label>Gate</label><div class="bar"><select ${f('gate_m')}><option value="v">Value</option><option value="s">Step</option></select>
      <input type="range" ${f('gate')} min="0" max="100" step="1" class="grow"></div><span class="val" ${f('gate_v')}></span></div>
    <div class="row"><label>Velocity</label><div class="bar"><select ${f('vel_m')}><option value="v">Value</option><option value="k">Key</option><option value="s">Step</option></select>
      <input type="range" ${f('vel')} min="1" max="127" step="1" class="grow"></div><span class="val" ${f('vel_v')}></span></div>
    <div class="row"><label>Swing</label><input type="range" ${f('swing')} min="-100" max="100" step="1"><span class="val" ${f('swing_v')}></span></div>
  </div>`;
}
const el = (slot, f) => document.querySelector(`[data-slot="${slot}"][data-f="${f}"]`);

function buildSlots() {
  const want = state ? Object.keys(state.slots).join('') : '';
  if ($('slots').dataset.built === want) return;
  $('slots').dataset.built = want;
  $('slots').innerHTML = want.split('').map(slotHtml).join('');
  $('tabs').innerHTML = want.length > 1 ? want.split('').map(s => `<button data-tab="${s}">${s}</button>`).join('') : '';
}

function render() {
  const on = !!state;
  buildSlots();
  for (const id of ['arp', 'latch', 'tempo', 'psearch', 'prev', 'next', 'save', 'sprev', 'snext', 'srandom', 'prandom', 'selbank', 'selnum', 'selsearch', 'selcat']) $(id).disabled = !on;
  $('refresh').disabled = !out; $('names').disabled = !out;
  for (const k of KNOBS) $('k_' + k.id).disabled = !on;
  $('freset').disabled = !on; pad.classList.toggle('off', !on);
  document.querySelectorAll('#modes button').forEach(b => { b.disabled = !out; b.classList.toggle('on', on && (state.kind === 'combi') === (b.dataset.mode === '0')); });
  document.querySelectorAll('#slots input, #slots select').forEach(e => e.disabled = !on);
  if (!on) { $('pname').textContent = '–'; $('pcur').textContent = '–'; return; }
  const s = state;
  $('kind').textContent = s.kind === 'combi' ? 'Combination' : 'Program';
  $('pname').textContent = s.name;
  renderSounds();
  $('arp').checked = !!s.arp; $('latch').checked = !!s.latch;
  $('tempo').value = Math.round(s.tempo); $('tempo_v').textContent = s.tempo.toFixed(2) + ' BPM';
  for (const [slot, v] of Object.entries(s.slots)) {
    el(slot, 'octave').value = v.octave; el(slot, 'octave_v').textContent = v.octave;
    el(slot, 'res').value = v.res;
    const gStep = v.gate === 0x65; el(slot, 'gate_m').value = gStep ? 's' : 'v'; el(slot, 'gate').disabled = gStep;
    if (!gStep) el(slot, 'gate').value = v.gate; el(slot, 'gate_v').textContent = gStep ? 'Step' : v.gate + ' %';
    const vm = v.vel === 0x80 ? 'k' : v.vel === 0x81 ? 's' : 'v'; el(slot, 'vel_m').value = vm; el(slot, 'vel').disabled = vm !== 'v';
    if (vm === 'v') el(slot, 'vel').value = v.vel; el(slot, 'vel_v').textContent = vm === 'k' ? 'Key' : vm === 's' ? 'Step' : v.vel;
    el(slot, 'swing').value = v.swing; el(slot, 'swing_v').textContent = v.swing;
  }
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === activeSlot));
  const raw = s.slots[activeSlot].pattern;
  $('pcur').innerHTML = (state.kind === 'combi' ? activeSlot + ': ' : '') + esc(patLabel(raw)) + (patternInfo(raw).edited ? '<span class="tag">edited</span>' : '');
  renderList();
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderList() {
  const q = $('psearch').value.trim().toLowerCase(), favOnly = $('favonly').checked;
  const cur = state?.slots[activeSlot]?.pattern;
  const all = [];
  for (let raw = 0; raw <= MAX_RAW; raw++) {
    if (favOnly && !favs.has(raw)) continue;
    const p = patternInfo(raw);
    if (p.empty) continue;                          // blank user slots never appear in the list
    if (q && !(p.slot + ' ' + p.name).toLowerCase().includes(q)) continue;
    all.push(p);
  }
  const rows = all.slice(0, 200);
  patternCandidates = all.map(p => p.raw);
  $('plist').innerHTML = rows.map(p =>
    `<div class="p${p.raw === cur ? ' cur' : ''}" data-raw="${p.raw}">
       <button class="star${favs.has(p.raw) ? ' on' : ''}" data-fav="${p.raw}" title="Favorite">${favs.has(p.raw) ? '★' : '☆'}</button>
       <span>${p.slot}</span><span>${esc(p.name)}${p.edited ? '<span class="tag">edited</span>' : ''}</span><span class="len">${p.length ?? ''}</span></div>`).join('')
    || '<div class="p"><span></span><span></span><span>No match</span><span></span></div>';
  const c = $('plist').querySelector('.cur'); if (c && !q) c.scrollIntoView({ block: 'nearest' });
}

function renderSounds() {
  const sel = $('selbank'), banks = BANKS();
  if (sel.options.length !== banks) sel.innerHTML = Array.from({ length: banks }, (_, i) => `<option value="${i}">Bank ${'ABCD'[i]}</option>`).join('');
  if (curSound !== null) { sel.value = curSound >> 7; if (document.activeElement !== $('selnum')) $('selnum').value = curSound & 127; }
  const cs = $('selcat');
  if (cs.options.length === 1) cs.innerHTML += Object.keys(CATEGORIES).map(c => `<option>${c}</option>`).join('');
  const q = $('selsearch').value.trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean), cat = cs.value;
  const all = soundList().filter(s => (!cat || s.cat === cat) &&
    words.every(w => `${s.name} ${s.sub} ${s.cat} ${s.bank}${String(s.num).padStart(3, '0')}`.toLowerCase().includes(w)));
  const rows = all.slice(0, 300);
  soundCandidates = all.map(s => 'ABCD'.indexOf(s.bank) * 128 + s.num);
  $('selcount').textContent = `${all.length} sound${all.length === 1 ? '' : 's'}` + (all.length > rows.length ? ` (showing ${rows.length})` : '');
  $('sellist').innerHTML = rows.map(s => {
    const raw = 'ABCD'.indexOf(s.bank) * 128 + s.num;
    return `<div class="s${raw === curSound ? ' cur' : ''}" data-sraw="${raw}" title="${esc(s.cat)}"><span>${soundCode(raw)}</span><span>${esc(s.name)}</span><span>${esc(s.sub)}</span></div>`;
  }).join('') || '<div class="s"><span></span><span>No match</span><span></span></div>';
  const c = $('sellist').querySelector('.cur'); if (c && !q) c.scrollIntoView({ block: 'nearest' });
}

// ---------- wiring ----------
$('modes').onclick = e => { const b = e.target.closest('button'); if (b && !b.disabled) switchMode(+b.dataset.mode); };
$('srandom').onclick = () => { const r = pickRandom(soundCandidates, curSound); if (r !== null) goSound(r); };
$('prandom').onclick = () => { const r = pickRandom(patternCandidates, state?.slots[activeSlot]?.pattern); if (r !== null) goPattern(r); };
$('sprev').onclick = () => stepSound(-1);
$('snext').onclick = () => stepSound(+1);
$('selsearch').oninput = renderSounds;
$('selcat').onchange = renderSounds;
$('sellist').onclick = e => { const r = e.target.closest('.s'); if (r?.dataset.sraw) goSound(+r.dataset.sraw); };
const gotoTyped = () => { const n = $('selnum').value; goSound(+$('selbank').value * 128 + clamp(n === '' ? 0 : +n, 0, 127)); };
$('selbank').onchange = gotoTyped;
$('selnum').onchange = gotoTyped;
$('arp').onchange = e => setParam(0x02, 0x01, e.target.checked ? 1 : 0);
$('latch').onchange = e => setParam(0x02, 0x02, e.target.checked ? 1 : 0);
$('tempo').oninput = e => $('tempo_v').textContent = e.target.value + ' BPM';
$('tempo').onchange = e => { setParam(0x02, 0x00, Math.round(e.target.value * 100)); e.target.blur(); };

// click the BPM number to type a tempo (Enter or blur applies, Esc cancels)
const tempoText = $('tempo_v'), tempoField = $('tempo_n');
tempoText.onclick = () => {
  if (!state) return;
  tempoField.value = state.tempo.toFixed(2).replace(/\.?0+$/, '');
  tempoText.style.display = 'none'; tempoField.style.display = '';
  tempoField.focus(); tempoField.select();
};
function closeTempo(commit) {
  if (tempoField.style.display === 'none') return;
  const bpm = parseFloat(tempoField.value);
  tempoField.style.display = 'none'; tempoText.style.display = '';
  if (commit && Number.isFinite(bpm)) setParam(0x02, 0x00, Math.round(clamp(bpm, 40, 300) * 100));
}
tempoField.onkeydown = e => {
  if (e.key === 'Enter') { e.preventDefault(); closeTempo(true); }
  else if (e.key === 'Escape') closeTempo(false);
};
tempoField.onblur = () => closeTempo(true);

$('slots').addEventListener('input', e => {
  const t = e.target, f = t.dataset.f, slot = t.dataset.slot; if (!f) return;
  const v = el(slot, f + '_v'); if (!v) return;
  v.textContent = f === 'gate' ? t.value + ' %' : t.value;
});
$('slots').addEventListener('change', e => {
  const t = e.target, f = t.dataset.f, slot = t.dataset.slot; if (!f) return;
  const cur = state.slots[slot], n = +t.value;
  switch (f) {
    case 'octave': setSlot(slot, 0x02, n - 1); break;
    case 'res': setSlot(slot, 0x01, n); break;
    case 'gate': setSlot(slot, 0x03, n); break;
    case 'gate_m': setSlot(slot, 0x03, t.value === 's' ? 0x65 : (cur.gate === 0x65 ? 100 : cur.gate)); break;
    case 'vel': setSlot(slot, 0x04, n); break;
    case 'vel_m': setSlot(slot, 0x04, t.value === 'k' ? 0x80 : t.value === 's' ? 0x81 : (cur.vel >= 0x80 ? 100 : cur.vel)); break;
    case 'swing': setSlot(slot, 0x05, n); break;
  }
  if (t.type === 'range') t.blur();                // return arrow keys to pattern stepping
});

$('tabs').onclick = e => { const b = e.target.closest('button'); if (b) { activeSlot = b.dataset.tab; render(); } };
$('psearch').oninput = renderList;
$('favonly').onchange = renderList;$('prev').onclick = () => stepPattern(-1);
$('next').onclick = () => stepPattern(+1);
$('plist').onclick = e => {
  const fav = e.target.closest('[data-fav]');
  if (fav) { const r = +fav.dataset.fav; favs.has(r) ? favs.delete(r) : favs.add(r); store.set('arp.favs', [...favs]); renderList(); e.stopPropagation(); return; }
  const row = e.target.closest('.p'); if (row?.dataset.raw) goPattern(+row.dataset.raw);
};
document.addEventListener('keydown', e => {
  if (!state || $('savedlg').open || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.key === 'ArrowRight') { e.preventDefault(); stepPattern(+1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); stepPattern(-1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); stepSound(+1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); stepSound(-1); }
});
$('refresh').onclick = () => readCurrent().catch(e => banner('Read failed: ' + e.message));

// ---------- read pattern names from the unit (function 17 → 73/16) ----------
let namesCancel = false;
async function readNames() {
  namesCancel = false; quiet = true;
  $('names').style.display = 'none'; $('namescancel').style.display = '';
  const fresh = {}; let n = 0;
  try {
    for (; n < 640 && !namesCancel; n++) {
      const msb = n >> 7, lsb = n & 0x7F;
      const d = await request([...hdr(), 0x72, 0x16, 0x00, msb, lsb, 0xF7],
        r => r[6] === 0x73 && r[7] === 0x16 && r[9] === msb && r[10] === lsb, 1500);
      const o = unpack(d.slice(12, d.length - 1));
      fresh[n] = { name: text(o, 0, 24), length: o[25] };
      if (n % 8 === 0) $('namesstat').textContent = `Reading names… ${n + 1}/640`;
    }
    if (namesCancel) { $('namesstat').textContent = `Cancelled at ${n}/640 (nothing saved).`; }
    else {
      unitNames = fresh; store.set('arp.unitNames', unitNames);
      const edited = Object.keys(fresh).filter(u => +u < 512 && factoryByRaw.get(5 + +u)?.name !== fresh[u].name).length;
      $('namesstat').textContent = `Read 640 names from the unit. ${edited} of the 512 factory slots differ from the factory list.`;
    }
  } catch (e) {
    $('namesstat').textContent = `Stopped at ${n}/640: ${e.message}. Nothing saved.`;
  } finally {
    quiet = false; $('names').style.display = ''; $('namescancel').style.display = 'none'; render();
  }
}
$('names').onclick = readNames;
$('namescancel').onclick = () => { namesCancel = true; };

// ---------- save (OBJECT WRITE REQUEST, function 77) ----------
const RESULT = { 0: 'Saved.', 1: 'The unit reports: data length wrong.', 2: 'The unit reports: destination memory is protected. Turn off Memory Protect in Global mode first.',
  3: 'The unit reports: that bank/number does not exist.', 4: 'The unit reports: wrong mode for this operation.', 5: 'The unit reports: memory overflow.', 0x40: 'The unit reports another error.' };
function openSave() {
  const combi = state.kind === 'combi';
  $('sbank').innerHTML = '<option value="">Choose…</option>' + (combi ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D']).map((b, i) => `<option value="${i}">Bank ${b}</option>`).join('');
  $('snum').value = ''; $('sconfirm').checked = false; $('sresult').textContent = '';
  $('sdesc').textContent = `Writes the current ${combi ? 'Combination' : 'Program'} (“${state.name}”) from the keyboard's edit buffer to the chosen location.`;
  updateSaveBtn(); $('savedlg').showModal();
}
function updateSaveBtn() {
  const num = $('snum').value, ok = $('sbank').value !== '' && num !== '' && +num >= 0 && +num <= 127;
  $('sgo').disabled = !(ok && $('sconfirm').checked);
}
$('save').onclick = openSave;
$('scancel').onclick = () => $('savedlg').close();
$('sbank').onchange = $('snum').oninput = $('sconfirm').onchange = updateSaveBtn;
$('sgo').onclick = async () => {
  const combi = state.kind === 'combi';
  $('sgo').disabled = true; $('sresult').textContent = 'Saving…';
  try {
    const r = await request([...hdr(), 0x77, combi ? 1 : 0, +$('sbank').value, 0x00, +$('snum').value, 0xF7], d => d[6] === 0x24, 3000);
    $('sresult').textContent = RESULT[r[7]] ?? `Unit result code ${r[7]}.`;
  } catch { $('sresult').textContent = 'No reply from the unit — it may not have saved. Check the keyboard.'; }
  $('sconfirm').checked = false;
};

// ---------- connection ----------
function fillSelect(sel, ports, preferred) {
  sel.innerHTML = ''; for (const p of ports) sel.add(new Option(p.name, p.id));
  const pick = ports.find(p => /microstation/i.test(p.name) && (preferred ? preferred.test(p.name) : true)) || ports[0];
  if (pick) sel.value = pick.id; sel.disabled = false;
}
async function attach() {
  if (inp) inp.onmidimessage = null;
  out = access.outputs.get($('outsel').value); inp = access.inputs.get($('insel').value);
  if (!out || !inp) { banner('Select a MIDI in and out port.'); return; }
  inp.onmidimessage = onMessage;
  try {
    const r = await request([0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7], d => d[1] === 0x7E && d[3] === 0x06 && d[4] === 0x02);
    ch = r[2] & 0x0F;
    const ok = r[5] === 0x42 && r[6] === 0x0D;
    $('conn').textContent = ok ? `Connected: Korg microSTATION (v${r[10]}.${r[11]}.${r[12]}, ch ${ch + 1})` : 'Connected, but the device did not identify as a microSTATION';
    $('dot').classList.toggle('on', ok);
    await readCurrent();
  } catch (e) {
    $('dot').classList.remove('on'); $('conn').textContent = 'No reply from the device';
    banner('No SysEx reply. Check the USB connection, the selected ports, and Global/Media → MIDI → MIDI Filter → SysEx = enabled on the keyboard.');
  }
  $('refresh').disabled = false; $('names').disabled = false;
}
$('outsel').onchange = $('insel').onchange = attach;
$('connect').onclick = async () => {
  if (!navigator.requestMIDIAccess) { banner('Web MIDI is not available in this browser. Use Chrome or Edge.'); return; }
  try { access = await navigator.requestMIDIAccess({ sysex: true }); }
  catch (e) { banner('MIDI/SysEx access was denied: ' + e.message); return; }
  fillSelect($('outsel'), [...access.outputs.values()], /sound/i);
  fillSelect($('insel'), [...access.inputs.values()], /keyboard/i);
  access.onstatechange = ev => log(`port ${ev.port.name} ${ev.port.state}`);
  attach();
};
renderList();
