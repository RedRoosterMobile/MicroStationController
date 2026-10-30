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
