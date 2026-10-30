// Save the edit buffer to a Program/Combination location (OBJECT WRITE REQUEST, function 77).
import { $ } from '../lib/dom.js';
import { request } from '../lib/midi.js';
import { hdr } from './device.js';
import { FN } from './protocol.js';
import { session } from './session.js';

const RESULT = {
  0: 'Saved.',
  1: 'The unit reports: data length wrong.',
  2: 'The unit reports: destination memory is protected. Turn off Memory Protect in Global mode first.',
  3: 'The unit reports: that bank/number does not exist.',
  4: 'The unit reports: wrong mode for this operation.',
  5: 'The unit reports: memory overflow.',
  0x40: 'The unit reports another error.',
};

function openSave() {
  const { state } = session, combi = state.kind === 'combi';
  const banks = combi ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D'];
  $('sbank').innerHTML = '<option value="">Choose…</option>' + banks.map((b, i) => `<option value="${i}">Bank ${b}</option>`).join('');
  $('snum').value = ''; $('sconfirm').checked = false; $('sresult').textContent = '';
  $('sdesc').textContent = `Writes the current ${combi ? 'Combination' : 'Program'} (“${state.name}”) from the keyboard's edit buffer to the chosen location.`;
  updateSaveButton();
  $('savedlg').showModal();
}

// Saving needs a valid location and an explicit confirmation.
function updateSaveButton() {
  const num = $('snum').value;
  const validTarget = $('sbank').value !== '' && num !== '' && +num >= 0 && +num <= 127;
  $('sgo').disabled = !(validTarget && $('sconfirm').checked);
}

async function save() {
  const combi = session.state.kind === 'combi';
  $('sgo').disabled = true; $('sresult').textContent = 'Saving…';
  try {
    const reply = await request([...hdr(), FN.OBJECT_WRITE, combi ? 1 : 0, +$('sbank').value, 0x00, +$('snum').value, 0xF7], d => d[6] === FN.WRITE_RESULT, 3000);
    $('sresult').textContent = RESULT[reply[7]] ?? `Unit result code ${reply[7]}.`;
  } catch { $('sresult').textContent = 'No reply from the unit — it may not have saved. Check the keyboard.'; }
  $('sconfirm').checked = false;
}

export function initSave() {
  $('save').onclick = openSave;
  $('scancel').onclick = () => $('savedlg').close();
  $('sbank').onchange = $('snum').oninput = $('sconfirm').onchange = updateSaveButton;
  $('sgo').onclick = save;
}
