// MIDI port selection and the keyboard's Sequencer-mode setup.
import { $, banner, esc } from '../lib/dom.js';
import { listen, ports, send } from '../lib/midi.js';
import { store } from '../lib/store.js';
import { sleep } from '../lib/util.js';
import { gch } from './channels.js';
import { updateButtons } from './player.js';
import { pushSetup } from './routing.js';
import { composer } from './state.js';

let access;

function pickOutput() {
  ports.out = access.outputs.get($('outsel').value);
  const connected = !!ports.out;
  if (connected) store.set('comp.out', ports.out.id);
  $('dot').classList.toggle('on', connected);
  $('conn').textContent = connected ? 'Connected' : 'No MIDI output found';
  $('outsel').disabled = !connected; $('setup').disabled = !connected;
  if (connected && composer.song) pushSetup();
  updateButtons();
}

export async function connect() {
  if (!navigator.requestMIDIAccess) { banner('Web MIDI is not available in this browser. Use Chrome or Edge.'); return; }
  try { access = await navigator.requestMIDIAccess({ sysex: true }); } catch (e) { banner('MIDI access denied: ' + e.message); return; }
  const outs = [...access.outputs.values()];
  const saved = store.get('comp.out', null);
  $('outsel').innerHTML = outs.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('');
  const pick = outs.find(o => o.id === saved) ?? outs.find(o => /sound/i.test(o.name)) ?? outs[0];
  if (pick) $('outsel').value = pick.id;
  $('outsel').onchange = pickOutput;
  const inputs = [...access.inputs.values()];
  listen(inputs.find(i => /keyboard/i.test(i.name)) ?? inputs[0]);
  pickOutput();
}

// Sequencer mode (function 4E, mode 4) then GM System On, so all 16 tracks take GM sounds.
async function setupSequencer() {
  banner('Switching keyboard to Sequencer mode…');
  send([0xF0, 0x42, 0x30 | gch(), 0x00, 0x01, 0x0D, 0x4E, 0x04, 0xF7]);
  await sleep(2500);
  send([0xF0, 0x7E, 0x7F, 0x09, 0x01, 0xF7]);
  await sleep(600);
  if (composer.song) pushSetup();
  banner('');
}

export function initConnection() {
  $('connect').onclick = connect;
  $('setup').onclick = setupSequencer;
}
