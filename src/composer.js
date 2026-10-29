import SOUNDS from '../sounds.json';
import SAMPLE_NAMES from '../drumsamples.json';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ---------- General MIDI names ----------
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
const GM = Object.values(GM_FAMILIES).flat();
const DRUM_KITS = [[0, 'Standard Kit'], [8, 'Room Kit'], [16, 'Power Kit'], [24, 'Electronic Kit'], [25, 'TR-808 Kit'], [32, 'Jazz Kit'], [40, 'Brush Kit'], [48, 'Orchestra Kit'], [56, 'SFX Kit']];

// ---------- sound catalogue ----------
// Bank index as the keyboard stores it: 0-3 = A-D, 4 = GM, 5-13 = g(1)-g(9), 14 = g(d) drums (read back from the unit).
const BANK_GM = 4, BANK_GM_DRUMS = 14;
const KIT_SUBS = new Set(['Natural', 'Dance', 'Perc']);          // categories that hold drum kits
const KBD = SOUNDS.programs.map(p => ({ ...p, bank: 'ABCD'.indexOf(p.bank), id: p.bank + p.num, kit: KIT_SUBS.has(p.sub) }));
const kbdByKey = new Map(KBD.map(k => [k.bank + ':' + k.num, k]));
const gmName = p => GM[p] ?? 'GM ' + p;
const soundName = t => {
  if (t.bank < 4) return kbdByKey.get(t.bank + ':' + t.program)?.name ?? 'Program ' + t.program;
  if (t.bank === BANK_GM_DRUMS) return DRUM_KITS.find(([p]) => p === t.program)?.[1] ?? 'GM kit ' + t.program;
  return gmName(t.program);
};
// "B74" keyboard program, "gm:33" GM program (0-based), "gmd:25" GM drum kit
function parseSound(str) {
  let m;
  if ((m = /^([A-D])(\d{1,3})$/i.exec(str ?? ''))) { const bank = 'ABCD'.indexOf(m[1].toUpperCase()), program = +m[2]; if (program < 128) return { bank, program }; }
  if ((m = /^gm:(\d{1,3})$/i.exec(str ?? '')) && +m[1] < 128) return { bank: BANK_GM, program: +m[1] };
  if ((m = /^gmd:(\d{1,3})$/i.exec(str ?? '')) && +m[1] < 128) return { bank: BANK_GM_DRUMS, program: +m[1] };
  return null;
}
const soundStr = t => t.bank < 4 ? 'ABCD'[t.bank] + t.program : t.bank === BANK_GM_DRUMS ? 'gmd:' + t.program : 'gm:' + t.program;
const optHtml = (t, bank, prog, label) => `<option value="${bank}:${prog}"${t.bank === bank && t.program === prog ? ' selected' : ''}>${esc(label)}</option>`;
function instOptions(t) {
  const kbd = KBD.filter(k => k.kit === t.drums);
  const groups = {};
  for (const k of kbd) (groups[k.sub] ??= []).push(k);
  const kbdHtml = Object.entries(groups).map(([sub, list]) => `<optgroup label="Keyboard · ${esc(sub)}">${list.map(k => optHtml(t, k.bank, k.num, `${k.id} ${k.name}${k.kit ? ' (own key layout)' : ''}`)).join('')}</optgroup>`).join('');
  const gmHtml = t.drums
    ? `<optgroup label="General MIDI kits">${DRUM_KITS.map(([p, n]) => optHtml(t, BANK_GM_DRUMS, p, n)).join('')}</optgroup>`
    : Object.entries(GM_FAMILIES).map(([fam, names], f) => `<optgroup label="GM · ${fam}">${names.map((n, i) => optHtml(t, BANK_GM, f * 8 + i, `${f * 8 + i + 1}. ${n}`)).join('')}</optgroup>`).join('');
  return gmHtml + kbdHtml;
}
const bankMsb = b => b < 4 ? 0x00 : b === BANK_GM_DRUMS ? 0x78 : 0x79;     // Bank Map KORG
const bankLsb = b => b < 4 ? b : b === BANK_GM_DRUMS || b === BANK_GM ? 0 : b - 4;

// ---------- MIDI plumbing ----------
let access, out, inp, song = null, waiters = [];
const banner = msg => { $('banner').textContent = msg || ''; $('banner').classList.toggle('show', !!msg); };
const send = (bytes, t) => out?.send(bytes, t);
const gch = () => +$('gch').value;

for (let i = 1; i <= 16; i++) $('dch').add(new Option(i, i));
$('dch').value = store.get('comp.dch', 10);
$('sx').checked = store.get('comp.sx', false);
$('sx').onchange = () => store.set('comp.sx', $('sx').checked);
$('bank').checked = store.get('comp.bank', true);
$('bank').onchange = () => store.set('comp.bank', $('bank').checked);
$('dch').onchange = () => { store.set('comp.dch', +$('dch').value); if (song) { applyDrumCh(song); renderTracks(); if (out) pushSetup(); saveSong(); } };
// Move drum tracks to the preferred channel; whoever sits there swaps to the drum track's old channel.
function applyDrumCh(s) {
  const want = +$('dch').value;
  for (const d of s.tracks.filter(t => t.drums && t.ch !== want)) {
    const other = s.tracks.find(t => t !== d && t.ch === want);
    if (other) other.ch = d.ch;
    d.ch = want;
  }
}
for (let i = 0; i < 16; i++) $('gch').add(new Option(i + 1, i));
$('gch').value = store.get('comp.gch', 0);
$('gch').onchange = () => store.set('comp.gch', gch());

async function connect() {
  if (!navigator.requestMIDIAccess) { banner('Web MIDI is not available in this browser. Use Chrome or Edge.'); return; }
  try { access = await navigator.requestMIDIAccess({ sysex: true }); } catch (e) { banner('MIDI access denied: ' + e.message); return; }
  const outs = [...access.outputs.values()];
  const saved = store.get('comp.out', null);
  $('outsel').innerHTML = outs.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('');
  const pick = outs.find(o => o.id === saved) ?? outs.find(o => /sound/i.test(o.name)) ?? outs[0];
  if (pick) $('outsel').value = pick.id;
  $('outsel').onchange = pickOut;
  inp = [...access.inputs.values()].find(i => /keyboard/i.test(i.name)) ?? [...access.inputs.values()][0];
  if (inp) inp.onmidimessage = e => { const d = e.data; if (d[0] === 0xF0) waiters = waiters.filter(w => { if (w.match(d)) { w.resolve(d); return false; } return true; }); };
  pickOut();
}
function pickOut() {
  out = access.outputs.get($('outsel').value);
  if (out) store.set('comp.out', out.id);
  $('dot').classList.toggle('on', !!out);
  $('conn').textContent = out ? 'Connected' : 'No MIDI output found';
  $('outsel').disabled = !out; $('setup').disabled = !out;
  if (out && song) pushSetup(); updateButtons();
}
$('connect').onclick = connect;

// Sequencer mode (function 4E, mode 4) then GM System On, so all 16 tracks take GM sounds.
$('setup').onclick = async () => {
  banner('Switching keyboard to Sequencer mode…');
  send([0xF0, 0x42, 0x30 | gch(), 0x00, 0x01, 0x0D, 0x4E, 0x04, 0xF7]);
  await sleep(2500);
  send([0xF0, 0x7E, 0x7F, 0x09, 0x01, 0xF7]);
  await sleep(600);
  if (song) pushSetup();
  banner('');
};

// Bank select + program change + volume for every channel of the song.
function pushProgram(t) {
  const c = t.ch - 1;
  if ($('sx').checked && method !== 'cc') { SETTERS[method](c, t.bank, t.program); return; }
  if ($('bank').checked || method === 'cc') { send([0xB0 | c, 0x00, bankMsb(t.bank)]); send([0xB0 | c, 0x20, bankLsb(t.bank)]); }
  send([0xC0 | c, t.program]);                      // one message per send(): some browsers drop the rest
}
const pushVol = t => send([0xB0 | (t.ch - 1), 0x07, t.vol ?? 100]);
const pushSetup = () => song.tracks.forEach(t => { pushProgram(t); pushVol(t); ensureKit(t); });

// ---------- read the keyboard's track setup (Current Song Timbre Set, TABLE 10; track i starts at byte 664 + 44*i) ----------
const hdr = () => [0xF0, 0x42, 0x30 | gch(), 0x00, 0x01, 0x0D];
function unpack(body) {                            // Korg 8-byte -> 7-byte groups, first byte holds the MSBs
  const o = [];
  for (let i = 0; i < body.length; i += 8) {
    const g = body.slice(i, i + 8);
    for (let j = 1; j < g.length; j++) o.push(g[j] | (((g[0] >> (j - 1)) & 1) << 7));
  }
  return o;
}
const STATUS = ['Off', 'INT', 'EXT', 'EX2'];
async function dumpTracks() {
  if (!inp) throw new Error('no MIDI input found (needs the keyboard input port)');
  const d = await new Promise((resolve, reject) => {
    const w = { match: d => d[6] === 0x75 && d[7] === 0x02, resolve };
    waiters.push(w);
    setTimeout(() => { waiters = waiters.filter(x => x !== w); reject(new Error('no reply (is the keyboard in Sequencer mode, and the input port the keyboard one?)')); }, 2500);
    send([...hdr(), 0x74, 0x02, 0xF7]);
  });
  const o = unpack(d.slice(9, d.length - 1));
  return Array.from({ length: 16 }, (_, i) => { const b = 664 + 44 * i; return { prog: o[b], bank: o[b + 1], ch: o[b + 2] & 31, status: o[b + 2] >> 5, vol: o[b + 5] }; });
}
$('readtracks').onclick = async () => {
  $('trackinfo').textContent = 'Reading…';
  try {
    const tr = await dumpTracks();
    $('trackinfo').textContent = tr.map((t, i) => `Track ${i + 1}: prog ${t.prog}, bank ${t.bank}, MIDI ch ${t.ch} (0-based; 16=global), status ${STATUS[t.status] ?? t.status}, vol ${t.vol}`).join('\n');
  } catch (e) { $('trackinfo').textContent = 'Read failed: ' + e.message; }
};

// How a sound (bank + program) gets onto a track. 'sx8'/'sx7' = SysEx parameter change with the value encoded as prog | bank<<8 or prog | bank<<7;
// 'cc' = bank select control changes + program change. The self-test below finds which one the keyboard actually honours.
let method = store.get('comp.method', 'sx7');
const sxParam = (c, v) => send([...hdr(), 0x41, 0x04, 0x00, 0x04 + c, 0x00, 0x00, (v >>> 28) & 0x0F, (v >>> 21) & 0x7F, (v >>> 14) & 0x7F, (v >>> 7) & 0x7F, v & 0x7F, 0xF7]);
const SETTERS = {
  sx8: (c, bank, prog) => sxParam(c, prog | (bank << 8)),
  sx7: (c, bank, prog) => sxParam(c, prog | (bank << 7)),
  cc: (c, bank, prog) => { send([0xB0 | c, 0x00, bankMsb(bank)]); send([0xB0 | c, 0x20, bankLsb(bank)]); send([0xC0 | c, prog]); },
};
$('selftest').onclick = async () => {
  const c = 15, out_ = [];                          // track 16 / channel 16, unlikely to be in use
  let found = null;
  try {
    for (const [i, name] of ['sx8', 'sx7', 'cc'].entries()) {
      const bank = BANK_GM_DRUMS, prog = [8, 16, 24][i];
      SETTERS[name](c, bank, prog);
      await sleep(400);
      const t = (await dumpTracks())[c];
      const ok = t.bank === bank && t.prog === prog;
      out_.push(`${name}: sent bank ${bank} prog ${prog}, track 16 now bank ${t.bank} prog ${t.prog} → ${ok ? 'OK' : 'no'}`);
      if (ok && !found) found = name;
    }
    if (found) { method = found; store.set('comp.method', method); out_.push(`Using "${found}" from now on.`); if (song) pushSetup(); }
    else out_.push('None of the three methods changed the bank. Tell me this output.');
  } catch (e) { out_.push('Self-test failed: ' + e.message); }
  $('trackinfo').textContent = out_.join('\n');
};


// ---------- keyboard drum kits: learn which key plays what, then remap GM drum notes ----------
const request = (bytes, match, ms = 2500) => new Promise((resolve, reject) => {
  const w = { match, resolve };
  waiters.push(w);
  setTimeout(() => { waiters = waiters.filter(x => x !== w); reject(new Error('no reply from the keyboard')); }, ms);
  send(bytes);
});
// What each GM drum note stands for, and how to recognise that in a drum sample's name.
const GM_ROLE = { 35: 'kick', 36: 'kick', 37: 'rim', 38: 'snare', 39: 'clap', 40: 'snare', 41: 'tomLo', 42: 'hatC', 43: 'tomLo', 44: 'hatP', 45: 'tomLo', 46: 'hatO', 47: 'tomMid', 48: 'tomMid', 49: 'crash', 50: 'tomHi', 51: 'ride', 53: 'ride', 57: 'crash', 59: 'ride' };
const ROLE_FALLBACK = { tomLo: ['tomMid', 'tomHi'], tomMid: ['tomLo', 'tomHi'], tomHi: ['tomMid', 'tomLo'], hatP: ['hatC'], hatO: ['hatC'], crash: ['ride'], ride: ['crash'], rim: ['snare'], clap: ['snare'] };
const GM_ANCHOR = { kick: 36, snare: 38, rim: 37, clap: 39, tomLo: 43, tomMid: 47, tomHi: 50, hatC: 42, hatP: 44, hatO: 46, crash: 49, ride: 51 };
function roleOf(n) {
  if (/^BD/i.test(n)) return 'kick';
  if (/^SD/i.test(n)) return 'snare';
  if (/Side ?stick|Rim ?shot|Rim$/i.test(n)) return 'rim';
  if (/Clap/i.test(n)) return 'clap';
  if (/Hi-?Hat/i.test(n)) return /Pedal/i.test(n) ? 'hatP' : /Open/i.test(n) ? 'hatO' : 'hatC';
  if (/Crash|Splash|China/i.test(n)) return 'crash';
  if (/Ride/i.test(n)) return 'ride';
  if (/^Tom/i.test(n)) return /Floor|Lo/i.test(n) ? 'tomLo' : /Mid/i.test(n) ? 'tomMid' : 'tomHi';
  return null;
}
const kitMaps = new Map(Object.entries(store.get('comp.kitmaps3', {})));   // "bank:prog" -> { kit, map: { gmNote: kitKey } , roles }
// Read the program (which drum kit it uses), then that kit's per-key sample numbers, from the keyboard.
async function learnKit(bank, prog) {
  const key = bank + ':' + prog;
  if (kitMaps.has(key)) return kitMaps.get(key);
  const pd = await request([...hdr(), 0x72, 0x00, bank, 0x00, prog, 0xF7], d => d[6] === 0x73 && d[7] === 0x00);
  const po = unpack(pd.slice(12, pd.length - 1));
  if ((po[640] & 7) !== 2) throw new Error('not a drum program');
  const kitNo = po[738] | (po[739] << 8);
  const kd = await request([...hdr(), 0x72, 0x04, 0x00, 0x00, kitNo & 0x1F, 0xF7], d => d[6] === 0x73 && d[7] === 0x04);
  const ko = unpack(kd.slice(12, kd.length - 1));
  const kitName = String.fromCharCode(...ko.slice(0, 24)).replace(/[^\x20-\x7E]/g, '').trim();
  const byRole = {}, keyNames = {};
  for (let k = 0; k < 128; k++) {
    const b = 24 + 68 * k;
    if (ko[b] !== 1) continue;                            // key has no drum sample
    const name = SAMPLE_NAMES[(ko[b + 1] ? 's' : 'm') + (ko[b + 2] | (ko[b + 3] << 8))];
    if (!name) continue;
    keyNames[k] = name;
    const r = roleOf(name);
    if (r) (byRole[r] ??= []).push(k);
  }
  // closest to where GM would put the sound, but ordinary hits beat effects (reverse, roll, flam, ghost, rim, gated...)
  const ODD = /Reverse|Roll|Flam|Ghost|Rim|Side|Gated|Buzz|Lo-?Fi|Distort|Noise|Filter|Pitch|Tail|Hit \d|Sweep|Delay|Echo|Pad|Synth/i;
  const pick = role => {
    for (const r of [role, ...(ROLE_FALLBACK[role] ?? [])]) {
      const ks = byRole[r];
      if (!ks?.length) continue;
      const score = k => Math.abs(k - GM_ANCHOR[r]) + (ODD.test(keyNames[k]) ? 60 : 0);
      return ks.reduce((a, b) => score(b) < score(a) ? b : a);
    }
    return null;
  };
  const map = {};
  for (const [gm, role] of Object.entries(GM_ROLE)) { const k = pick(role); if (k !== null) map[gm] = k; }
  const found = Object.fromEntries(Object.keys(GM_ANCHOR).map(r => [r, pick(r)]));
  const nm = k => k === null ? null : keyNames[k];
  const info = { kit: `${kitName} (#${kitNo})`, map, kick: found.kick, snare: found.snare, hat: found.hatC, kickN: nm(found.kick), snareN: nm(found.snare), hatN: nm(found.hatC) };
  kitMaps.set(key, info);
  store.set('comp.kitmaps3', Object.fromEntries(kitMaps));
  return info;
}
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = n => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);
// The note to actually send for a GM drum note on this track (null = this kit has nothing for it).
const drumNote = (t, n) => {
  if (!t.drums || t.bank >= 4) return n;
  const info = kitMaps.get(t.bank + ':' + t.program);
  return info ? (info.map[n] ?? null) : n;
};
async function ensureKit(t) {
  if (!t.drums || t.bank >= 4 || !out || !inp) return;
  try { await learnKit(t.bank, t.program); t.kitHint = describeKit(t); }
  catch (e) { t.kitHint = 'kit layout unknown: ' + e.message; }
  if (song) renderTracks();
}
const describeKit = t => {
  const i = kitMaps.get(t.bank + ':' + t.program);
  if (!i) return '';
  const f = (k, n) => k === null ? '–' : `${noteName(k)} ${n}`;
  return `${i.kit}: kick ${f(i.kick, i.kickN)}, snare ${f(i.snare, i.snareN)}, hat ${f(i.hat, i.hatN)}`;
};

// ---------- test song + persistence ----------
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
$('test').onclick = () => { stop(); loadSong(testSong()); };
const saveSong = () => song && store.set('comp.song', song);

// ---------- compose ----------
const forModel = sg => ({ title: sg.title, tempo: sg.tempo, beats: sg.beats, tracks: sg.tracks.map(t => ({ ch: t.ch, name: t.name, sound: soundStr(t), vol: t.vol, notes: t.notes })) });
async function compose(revise) {
  const prompt = $('prompt').value.trim();
  if (!prompt) return;
  $('compose').disabled = $('revise').disabled = true;
  $('cstatus').textContent = 'Composing… (this takes ~20–60 s)';
  try {
    const r = await fetch('/api/compose', { method: 'POST', body: JSON.stringify({ prompt, song: revise ? forModel(song) : undefined }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    stop();
    loadSong(j);
    $('cstatus').textContent = '';
  } catch (e) { $('cstatus').textContent = 'Failed: ' + e.message; }
  $('compose').disabled = false; updateButtons();
}
$('compose').onclick = () => compose(false);
$('revise').onclick = () => compose(true);

function loadSong(s) {
  // normalise whatever the model returned
  s.tracks = (s.tracks ?? []).filter(t => t.ch >= 1 && t.ch <= 16 && Array.isArray(t.notes));
  for (const t of s.tracks) {
    t.drums ??= t.ch === 10;
    const snd = parseSound(t.sound) ?? (t.bank !== undefined ? { bank: t.bank, program: t.program } : { bank: t.drums ? BANK_GM_DRUMS : BANK_GM, program: clampi(t.program ?? 0, 0, 127) });
    if (t.drums !== !!(snd.bank === BANK_GM_DRUMS || (snd.bank < 4 && kbdByKey.get(snd.bank + ':' + snd.program)?.kit))) Object.assign(snd, { bank: t.drums ? BANK_GM_DRUMS : BANK_GM, program: 0 });   // sound kind must match track kind
    t.bank = snd.bank; t.program = snd.program; delete t.sound;
    t.vol ??= 100; t.muted = false; t.solo = false;
  }
  s.tempo = +s.tempo || 120;
  s.beats = +s.beats || Math.max(4, ...s.tracks.flatMap(t => t.notes.map(n => n[0] + n[1])));
  applyDrumCh(s);
  song = s;
  $('title').textContent = s.title || 'Song';
  $('tempo').value = Math.round(s.tempo);
  renderTracks();
  if (out) pushSetup();
  saveSong();
  updateButtons();
}
const clampi = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

function renderTracks() {
  $('tracks').innerHTML = song.tracks.map((t, i) => `
    <div class="track" data-i="${i}">
      <select data-act="ch" class="ch" title="MIDI channel">${Array.from({ length: 16 }, (_, k) => `<option value="${k + 1}"${k + 1 === t.ch ? ' selected' : ''}>${k + 1}</option>`).join('')}</select>
      <span>${esc(t.name || 'Track')}${t.kitHint ? `<br><small class="hint">${esc(t.kitHint)}</small>` : ''}</span>
      <select data-act="prog">${instOptions(t)}</select>
      <input type="range" data-act="vol" min="0" max="127" value="${t.vol}" title="Volume">
      <button data-act="test" title="Play a test note on this channel">♪</button>
      <button data-act="mute" class="${t.muted ? 'on' : ''}">M</button>
      <button data-act="solo" class="${t.solo ? 'on' : ''}">S</button>
    </div>`).join('');
}
$('tracks').addEventListener('input', e => {
  const row = e.target.closest('.track'); if (!row) return;
  const t = song.tracks[+row.dataset.i];
  setTimeout(saveSong);
  if (e.target.dataset.act === 'ch') {
    send([0xB0 | (t.ch - 1), 123, 0]);
    t.ch = +e.target.value; pushProgram(t); pushVol(t); preview(t); return;
  }
  if (e.target.dataset.act === 'prog') { [t.bank, t.program] = e.target.value.split(':').map(Number); t.kitHint = describeKit(t); pushProgram(t); ensureKit(t).then(() => preview(t)); }
  if (e.target.dataset.act === 'vol') { t.vol = +e.target.value; pushVol(t); }
});
$('tracks').addEventListener('click', e => {
  const row = e.target.closest('.track'); const act = e.target.dataset.act;
  if (!row || !['mute', 'solo', 'test'].includes(act)) return;
  const t = song.tracks[+row.dataset.i];
  if (act === 'test') { const w = playing; playing = false; pushProgram(t); preview(t); playing = w; return; }
  t[act === 'mute' ? 'muted' : 'solo'] = !t[act === 'mute' ? 'muted' : 'solo'];
  for (const x of song.tracks) if (!audible(x)) send([0xB0 | (x.ch - 1), 123, 0]);
  renderTracks();
});
const audible = t => !t.muted && (!song.tracks.some(x => x.solo) || t.solo);

// Short audition note so an instrument change is audible even when stopped.
function preview(t) {
  if (playing) return;
  const c = t.ch - 1, n = t.drums ? (drumNote(t, 38) ?? drumNote(t, 36) ?? 38) : (t.notes[0]?.[2] ?? 60);
  send([0x90 | c, n, 100]); setTimeout(() => send([0x80 | c, n, 0]), 350);
}

// ---------- playback ----------
let playing = false, timer = null, events = [], idx = 0, loopNo = 0, anchorMs = 0, anchorBeat = 0;
const LOOKAHEAD_MS = 150;
const msPerBeat = () => 60000 / song.tempo;

function buildEvents() {
  events = [];
  song.tracks.forEach((t, ti) => t.notes.forEach(([s, d, n, v]) => {
    const dur = Math.max(0.05, d);
    events.push({ b: s, on: true, ti, n, v: clampi(v ?? 90, 1, 127) });
    events.push({ b: s + dur - 0.001, on: false, ti, n });
  }));
  events.sort((a, b) => a.b - b.b || (a.on - b.on));
}
function play() {
  if (!song || !out) return;
  stop();
  pushSetup();
  buildEvents();
  idx = 0; loopNo = 0; playing = true;
  anchorMs = performance.now() + 120; anchorBeat = 0;
  timer = setInterval(tick, 40);
  updateButtons();
}
function tick() {
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
    const t = anchorMs + (abs - anchorBeat) * msPerBeat(), tr = song.tracks[e.ti], c = tr.ch - 1;
    const n = drumNote(tr, e.n);
    if (n === null) continue;
    if (e.on) { if (audible(tr)) send([0x90 | c, n, e.v], t); }
    else send([0x80 | c, n, 0], t);
  }
  $('pos').textContent = `beat ${(nowBeat % song.beats + 1).toFixed(1)} / ${song.beats}`;
}
function stop() {
  clearInterval(timer); timer = null; playing = false;
  try { out?.clear?.(); } catch { /* not supported */ }
  if (out) for (let c = 0; c < 16; c++) send([0xB0 | c, 123, 0]);
  $('pos').textContent = '';
  updateButtons();
}
$('play').onclick = play;
$('stop').onclick = stop;
$('tempo').onchange = () => {
  if (!song) return;
  const nowBeat = playing ? anchorBeat + (performance.now() - anchorMs) / msPerBeat() : 0;
  song.tempo = clampi($('tempo').value, 30, 300);
  if (playing) { anchorBeat = nowBeat; anchorMs = performance.now(); }
};

function updateButtons() {
  $('play').disabled = !song || !out || playing;
  $('stop').disabled = !playing;
  $('revise').disabled = !song;
  $('dl').disabled = !song;
}

// ---------- Standard MIDI File export ----------
function vlq(n) { const b = [n & 0x7F]; while ((n >>= 7)) b.unshift((n & 0x7F) | 0x80); return b; }
$('dl').onclick = () => {
  const PPQ = 480, chunks = [];
  const u32 = n => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255], u16 = n => [(n >> 8) & 255, n & 255];
  const trk = ev => {
    ev.sort((a, b) => a.t - b.t || a.o - b.o);
    const d = []; let last = 0;
    for (const e of ev) { d.push(...vlq(e.t - last), ...e.d); last = e.t; }
    d.push(0, 0xFF, 0x2F, 0);
    return [0x4D, 0x54, 0x72, 0x6B, ...u32(d.length), ...d];
  };
  const mpq = Math.round(60e6 / song.tempo);
  chunks.push(trk([{ t: 0, o: 0, d: [0xFF, 0x51, 3, (mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255] }]));
  for (const t of song.tracks) {
    const c = t.ch - 1, ev = [];
    ev.push({ t: 0, o: 0, d: [0xB0 | c, 0, bankMsb(t.bank)] }, { t: 0, o: 0, d: [0xB0 | c, 32, bankLsb(t.bank)] }, { t: 0, o: 0, d: [0xC0 | c, t.program] }, { t: 0, o: 0, d: [0xB0 | c, 7, t.vol] });
    for (const [s, d, n, v] of t.notes) {
      const kn = drumNote(t, n); if (kn === null) continue;
      ev.push({ t: Math.round(s * PPQ), o: 1, d: [0x90 | c, kn, clampi(v ?? 90, 1, 127)] });
      ev.push({ t: Math.round((s + Math.max(0.05, d)) * PPQ) - 1, o: 0, d: [0x80 | c, kn, 0] });
    }
    chunks.push(trk(ev));
  }
  const bytes = new Uint8Array([0x4D, 0x54, 0x68, 0x64, ...u32(6), ...u16(1), ...u16(chunks.length), ...u16(PPQ), ...chunks.flat()]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'audio/midi' }));
  a.download = (song.title || 'song').replace(/[^\w-]+/g, '_') + '.mid';
  a.click();
};

updateButtons();
const saved = store.get('comp.song', null);
if (saved) loadSong(saved);
connect();
