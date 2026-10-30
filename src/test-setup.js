// In-memory localStorage for tests (Node's own is experimental and warns), fresh for every test.
import { beforeEach } from 'vitest';

class MemoryStorage {
  #items = new Map();
  getItem(k) { return this.#items.has(k) ? this.#items.get(k) : null; }
  setItem(k, v) { this.#items.set(k, String(v)); }
  removeItem(k) { this.#items.delete(k); }
  clear() { this.#items.clear(); }
}

Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });
beforeEach(() => localStorage.clear());

// A minimal DOM so modules that look elements up by id can run in Node: every id yields a plain stand-in object,
// reset for every test. Tests read and write the stand-ins directly, e.g. document.getElementById('trackinfo').textContent.
const elements = new Map();
const makeElement = id => ({
  id, textContent: '', innerHTML: '', value: '', checked: false, disabled: false, style: {}, dataset: {}, options: [],
  classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, blur() {}, focus() {}, select() {},
});
globalThis.document = {
  getElementById: id => { if (!elements.has(id)) elements.set(id, makeElement(id)); return elements.get(id); },
  querySelectorAll: () => [],
  querySelector: () => null,
  activeElement: null,
};
beforeEach(() => elements.clear());
