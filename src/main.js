// microSTATION arp controller: wires the modules together.
import { $ } from './lib/dom.js';
import { initConnection } from './arp/connection.js';
import { initControls } from './arp/controls.js';
import { initLog } from './arp/log.js';
import { initNames } from './arp/names.js';
import { initPanel, render } from './arp/panel.js';
import { initPatterns, renderPatternList, stepPattern } from './arp/patterns.js';
import { initSave } from './arp/save.js';
import { onSessionChange, session } from './arp/session.js';
import { initSounds, stepSound, syncSound } from './arp/sounds.js';

initLog();
initControls();
initSounds();
initPatterns();
initPanel();
initNames();
initSave();
initConnection();

// Whenever the keyboard state is (re)read, resolve the current sound and redraw.
onSessionChange(() => {
  if (session.state) syncSound();
  render();
});

// Arrow keys step through patterns (← →) and sounds (↑ ↓) unless a field has focus.
document.addEventListener('keydown', e => {
  if (!session.state || $('savedlg').open || e.metaKey || e.ctrlKey || e.altKey) return;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  const step = { ArrowRight: () => stepPattern(+1), ArrowLeft: () => stepPattern(-1), ArrowDown: () => stepSound(+1), ArrowUp: () => stepSound(-1) }[e.key];
  if (step) { e.preventDefault(); step(); }
});

renderPatternList();
