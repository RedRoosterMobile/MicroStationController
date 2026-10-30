// Talking to the keyboard: reading the current Program/Combination and changing its parameters.
import { banner } from '../lib/dom.js';
import { request, send, sysexHeader, unpack } from '../lib/midi.js';
import { sleep } from '../lib/util.js';
import { ARP_GLOBAL, FN, PARAM, MODE_NAMES, encodeParamValue, parseCurrent } from './protocol.js';
import { session, notifySessionChange } from './session.js';

export const hdr = () => sysexHeader(session.ch);

// The unit sometimes ignores a request right after a mode/sound change, so retry a couple of times.
export async function readCurrent() {
  let err;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await readOnce(); } catch (e) { err = e; await sleep(600); }
  }
  throw err;
}

async function readOnce() {
  const modeReply = await request([...hdr(), FN.MODE_REQUEST, 0xF7], d => d[6] === FN.MODE_DATA);
  const mode = modeReply[7] & 7;
  session.modeLabel = 'Keyboard mode: ' + (MODE_NAMES[mode] ?? mode);
  const kind = mode === 2 || mode === 3 ? 'prog' : mode === 0 || mode === 1 ? 'combi' : null;
  if (!kind) {
    banner(`The keyboard is in ${MODE_NAMES[mode] ?? 'another'} mode. Press PROG or COMBI on the keyboard, then click “Re-read”.`);
    session.state = null;
    notifySessionChange();
    return;
  }
  banner('');
  const object = kind === 'combi' ? 0x01 : 0x00;
  const dump = await request([...hdr(), FN.CURRENT_DUMP_REQUEST, object, 0xF7], d => d[6] === FN.CURRENT_DUMP && d[7] === object, 2500);
  session.state = parseCurrent(dump, kind);
  if (!session.state.slots[session.activeSlot]) session.activeSlot = Object.keys(session.state.slots)[0];
  notifySessionChange();
}

const modeByte = () => session.state?.kind === 'combi' ? 0x00 : 0x02;
const slotParamId = slot => slot === 'B' ? PARAM.ARP_SLOT_B : PARAM.ARP_SLOT_A;

export async function setParam(id, sub, value) {
  send([...hdr(), FN.PARAM_CHANGE, modeByte(), 0x00, id, 0x00, sub, ...encodeParamValue(value), 0xF7]);
  await sleep(120);
  try { await readCurrent(); } catch (e) { banner('Re-read failed: ' + e.message); }
}
export const setSlot = (slot, sub, value) => setParam(slotParamId(slot), sub, value);

// Each sound stores its own arp on/off flag, so a sound change usually turns the arp off. Put it back if it was on.
export async function restoreArp(wasOn, keepArpEnabled) {
  const { state } = session;
  if (wasOn && keepArpEnabled && state && !state.arp) await setParam(PARAM.ARP_GLOBAL, ARP_GLOBAL.ON, 1);
}
