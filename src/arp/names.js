// Read all 640 user pattern names from the unit (data dump object 0x16).
import { $ } from '../lib/dom.js';
import { request, unpack } from '../lib/midi.js';
import { setQuiet } from './log.js';
import { hdr } from './device.js';
import { DUMP_PATTERN_NAME, FN, text } from './protocol.js';
import { countEditedFactorySlots, setUnitNames } from './patterns.js';
import { notifySessionChange } from './session.js';

const PATTERN_COUNT = 640;
let cancelled = false;

async function readNames() {
  cancelled = false; setQuiet(true);                    // keep the MIDI log from flooding
  $('names').style.display = 'none'; $('namescancel').style.display = '';
  const fresh = {};
  let n = 0;
  try {
    for (; n < PATTERN_COUNT && !cancelled; n++) {
      const msb = n >> 7, lsb = n & 0x7F;
      const d = await request([...hdr(), FN.DATA_DUMP_REQUEST, DUMP_PATTERN_NAME, 0x00, msb, lsb, 0xF7],
        r => r[6] === FN.DATA_DUMP && r[7] === DUMP_PATTERN_NAME && r[9] === msb && r[10] === lsb, 1500);
      const o = unpack(d.slice(12, d.length - 1));
      fresh[n] = { name: text(o, 0, 24), length: o[25] };
      if (n % 8 === 0) $('namesstat').textContent = `Reading names… ${n + 1}/${PATTERN_COUNT}`;
    }
    if (cancelled) { $('namesstat').textContent = `Cancelled at ${n}/${PATTERN_COUNT} (nothing saved).`; }
    else {
      setUnitNames(fresh);
      $('namesstat').textContent = `Read ${PATTERN_COUNT} names from the unit. ${countEditedFactorySlots(fresh)} of the 512 factory slots differ from the factory list.`;
    }
  } catch (e) {
    $('namesstat').textContent = `Stopped at ${n}/${PATTERN_COUNT}: ${e.message}. Nothing saved.`;
  } finally {
    setQuiet(false); $('names').style.display = ''; $('namescancel').style.display = 'none'; notifySessionChange();
  }
}

export function initNames() {
  $('names').onclick = readNames;
  $('namescancel').onclick = () => { cancelled = true; };
}
