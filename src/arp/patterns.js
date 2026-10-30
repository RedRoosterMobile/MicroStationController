// Arpeggio pattern catalogue (factory list + names read from the unit), favourites, and pattern selection.
// Raw pattern index: 0–4 = presets P0–P4, then 5 + U-number for the user patterns U000–U639.
import FACTORY from '../../arp_patterns.json';
import { $, esc } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { clamp, pickRandom } from '../lib/util.js';
import { setSlot } from './device.js';
import { ARP_SLOT } from './protocol.js';
import { session } from './session.js';

const MAX_RAW = 5 + 639;
const PATTERN_LIST_LIMIT = 200;

const favs = new Set(store.get('arp.favs', []));
let unitNames = store.get('arp.unitNames', {});       // U-number -> { name, length }, as read from the unit
const factoryByRaw = new Map(FACTORY.map(p => [p.raw, p]));

export function patternInfo(raw) {
  const factory = factoryByRaw.get(raw);
  if (raw < 5) return { raw, slot: factory.slot, name: factory.name, empty: false, length: null, edited: false };
  const u = raw - 5, unit = unitNames[u];
  const slot = 'U' + String(u).padStart(3, '0');
  // U512–U639 ship blank: the unit names them "ArpeggioPatternNNNN" and no step is switched on, so they play nothing
  const empty = unit ? unit.name.startsWith('ArpeggioPattern') : !factory;
  const name = empty ? '(empty user slot)' : unit?.name ?? factory.name;
  return {
    raw, slot, name, empty,
    length: empty ? null : unit?.length ?? factory?.length ?? null,
    edited: !!(unit && factory && unit.name !== factory.name),
  };
}
export const patternLabel = raw => { const p = patternInfo(raw); return `${p.slot} ${p.name}`; };
export const editedTag = raw => patternInfo(raw).edited ? '<span class="tag">edited</span>' : '';

export function setUnitNames(names) {
  unitNames = names;
  store.set('arp.unitNames', names);
}
// How many of the 512 factory slots have a different name on the unit than in the factory list.
export const countEditedFactorySlots = names =>
  Object.keys(names).filter(u => +u < 512 && factoryByRaw.get(5 + +u)?.name !== names[u].name).length;

// Rapid presses coalesce: only the latest requested pattern is sent once the previous change finished.
let busy = false, desired = null;
async function goPattern(raw) {
  desired = clamp(raw, 0, MAX_RAW);
  if (busy) return;
  busy = true;
  try {
    while (desired !== null) {
      const target = desired;
      desired = null;
      await setSlot(session.activeSlot, ARP_SLOT.PATTERN, target);
    }
  } finally { busy = false; }
}
export const stepPattern = delta => session.state && goPattern((desired ?? session.state.slots[session.activeSlot].pattern) + delta);

let candidates = [];                                  // raw indexes the list currently shows, for the random button

export function renderPatternList() {
  const query = $('psearch').value.trim().toLowerCase(), favOnly = $('favonly').checked;
  const current = session.state?.slots[session.activeSlot]?.pattern;
  const matches = [];
  for (let raw = 0; raw <= MAX_RAW; raw++) {
    if (favOnly && !favs.has(raw)) continue;
    const p = patternInfo(raw);
    if (p.empty) continue;                              // blank user slots never appear in the list
    if (query && !(p.slot + ' ' + p.name).toLowerCase().includes(query)) continue;
    matches.push(p);
  }
  candidates = matches.map(p => p.raw);

  $('plist').innerHTML = matches.slice(0, PATTERN_LIST_LIMIT).map(p =>
    `<div class="p${p.raw === current ? ' cur' : ''}" data-raw="${p.raw}">
       <button class="star${favs.has(p.raw) ? ' on' : ''}" data-fav="${p.raw}" title="Favorite">${favs.has(p.raw) ? '★' : '☆'}</button>
       <span>${p.slot}</span><span>${esc(p.name)}${editedTag(p.raw)}</span><span class="len">${p.length ?? ''}</span></div>`).join('')
    || '<div class="p"><span></span><span></span><span>No match</span><span></span></div>';
  const row = $('plist').querySelector('.cur');
  if (row && !query) row.scrollIntoView({ block: 'nearest' });
}

function toggleFavorite(raw) {
  if (favs.has(raw)) favs.delete(raw); else favs.add(raw);
  store.set('arp.favs', [...favs]);
  renderPatternList();
}

export function initPatterns() {
  $('prev').onclick = () => stepPattern(-1);
  $('next').onclick = () => stepPattern(+1);
  $('prandom').onclick = () => { const r = pickRandom(candidates, session.state?.slots[session.activeSlot]?.pattern); if (r !== null) goPattern(r); };
  $('psearch').oninput = renderPatternList;
  $('favonly').onchange = renderPatternList;
  $('plist').onclick = e => {
    const fav = e.target.closest('[data-fav]');
    if (fav) { toggleFavorite(+fav.dataset.fav); e.stopPropagation(); return; }
    const row = e.target.closest('.p');
    if (row?.dataset.raw) goPattern(+row.dataset.raw);
  };
}
