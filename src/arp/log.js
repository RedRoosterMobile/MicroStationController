// The MIDI log pane. Keeps only the last LOG_MAX lines and redraws at most once per frame;
// an ever-growing text node makes the browser re-lay-out it on every message.
import { $ } from '../lib/dom.js';
import { hex, hooks } from '../lib/midi.js';

const LOG_MAX = 200;
const PREVIEW_BYTES = 24;
const lines = [];
let redrawQueued = false, quiet = false;

export const setQuiet = q => { quiet = q; };

export function log(line) {
  if (quiet) return;
  lines.push(line);
  if (lines.length > LOG_MAX) lines.shift();
  if (redrawQueued) return;
  redrawQueued = true;
  requestAnimationFrame(() => {
    redrawQueued = false;
    const el = $('log');
    el.textContent = lines.join('\n');
    el.scrollTop = el.scrollHeight;
  });
}

const preview = bytes => bytes.length > PREVIEW_BYTES ? hex(bytes.slice(0, PREVIEW_BYTES)) : hex(bytes);

export function initLog() {
  hooks.onSend = bytes => log('→ ' + preview(bytes) + (bytes.length > PREVIEW_BYTES ? ' …' : ''));
  hooks.onReceive = d => log('← ' + preview(d) + (d.length > PREVIEW_BYTES ? ` … (${d.length} bytes)` : ''));
}
