export const $ = id => document.getElementById(id);

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = s => String(s).replace(/[&<>"]/g, c => ESCAPES[c]);

export function banner(msg) {
  const b = $('banner');
  b.textContent = msg || '';
  b.classList.toggle('show', !!msg);
}
