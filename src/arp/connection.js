// Connecting to the keyboard: MIDI port selection and the device identity handshake.
import { $, banner } from '../lib/dom.js';
import { listen, ports, request } from '../lib/midi.js';
import { log } from './log.js';
import { readCurrent } from './device.js';
import { session } from './session.js';

let access;

function fillSelect(select, list, preferred) {
  select.innerHTML = '';
  for (const p of list) select.add(new Option(p.name, p.id));
  const pick = list.find(p => /microstation/i.test(p.name) && (preferred ? preferred.test(p.name) : true)) || list[0];
  if (pick) select.value = pick.id;
  select.disabled = false;
}

async function attach() {
  ports.out = access.outputs.get($('outsel').value);
  listen(access.inputs.get($('insel').value));
  if (!ports.out || !ports.inp) { banner('Select a MIDI in and out port.'); return; }
  try {
    // Universal Device Inquiry; the reply carries the global channel, manufacturer/family and version
    const r = await request([0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7], d => d[1] === 0x7E && d[3] === 0x06 && d[4] === 0x02);
    session.ch = r[2] & 0x0F;
    const isMicroStation = r[5] === 0x42 && r[6] === 0x0D;
    $('conn').textContent = isMicroStation
      ? `Connected: Korg microSTATION (v${r[10]}.${r[11]}.${r[12]}, ch ${session.ch + 1})`
      : 'Connected, but the device did not identify as a microSTATION';
    $('dot').classList.toggle('on', isMicroStation);
    await readCurrent();
  } catch {
    $('dot').classList.remove('on');
    $('conn').textContent = 'No reply from the device';
    banner('No SysEx reply. Check the USB connection, the selected ports, and Global/Media → MIDI → MIDI Filter → SysEx = enabled on the keyboard.');
  }
  $('refresh').disabled = false; $('names').disabled = false;
}

async function connect() {
  if (!navigator.requestMIDIAccess) { banner('Web MIDI is not available in this browser. Use Chrome or Edge.'); return; }
  try { access = await navigator.requestMIDIAccess({ sysex: true }); }
  catch (e) { banner('MIDI/SysEx access was denied: ' + e.message); return; }
  fillSelect($('outsel'), [...access.outputs.values()], /sound/i);
  fillSelect($('insel'), [...access.inputs.values()], /keyboard/i);
  access.onstatechange = ev => log(`port ${ev.port.name} ${ev.port.state}`);
  attach();
}

export function initConnection() {
  $('outsel').onchange = $('insel').onchange = attach;
  $('connect').onclick = connect;
  $('refresh').onclick = () => readCurrent().catch(e => banner('Read failed: ' + e.message));
}
