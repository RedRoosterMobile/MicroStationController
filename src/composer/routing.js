// Getting each track's sound onto the keyboard: bank + program + volume per channel, and which method the unit honours.
import { $ } from '../lib/dom.js';
import { encodeParamValue, send } from '../lib/midi.js';
import { store } from '../lib/store.js';
import { hdr } from './channels.js';
import { ensureKit } from './kits.js';
import { bankLsb, bankMsb } from './sounds.js';
import { composer } from './state.js';

// 'sx8'/'sx7' = SysEx parameter change with the value encoded as prog | bank<<8 or prog | bank<<7;
// 'cc' = bank select control changes + program change. The self-test (diagnostics.js) finds which one the keyboard actually honours.
let method = store.get('comp.method', 'sx7');
export const setMethod = m => { method = m; store.set('comp.method', m); };

const sxParam = (c, v) => send([...hdr(), 0x41, 0x04, 0x00, 0x04 + c, 0x00, 0x00, ...encodeParamValue(v), 0xF7]);
const sendBankAndProgram = (c, bank, prog) => {
  send([0xB0 | c, 0x00, bankMsb(bank)]);
  send([0xB0 | c, 0x20, bankLsb(bank)]);
  send([0xC0 | c, prog]);
};
export const SETTERS = {
  sx8: (c, bank, prog) => sxParam(c, prog | (bank << 8)),
  sx7: (c, bank, prog) => sxParam(c, prog | (bank << 7)),
  cc: sendBankAndProgram,
};

export function pushProgram(t) {
  const c = t.ch - 1;
  if ($('sx').checked && method !== 'cc') { SETTERS[method](c, t.bank, t.program); return; }
  if ($('bank').checked || method === 'cc') { send([0xB0 | c, 0x00, bankMsb(t.bank)]); send([0xB0 | c, 0x20, bankLsb(t.bank)]); }
  send([0xC0 | c, t.program]);                      // one message per send(): some browsers drop the rest
}
export const pushVol = t => send([0xB0 | (t.ch - 1), 0x07, t.vol ?? 100]);

// Bank select + program change + volume for every channel of the song.
export const pushSetup = () => composer.song.tracks.forEach(t => { pushProgram(t); pushVol(t); ensureKit(t); });

export function initRouting() {
  $('sx').checked = store.get('comp.sx', false);
  $('sx').onchange = () => store.set('comp.sx', $('sx').checked);
  $('bank').checked = store.get('comp.bank', true);
  $('bank').onchange = () => store.set('comp.bank', $('bank').checked);
}
