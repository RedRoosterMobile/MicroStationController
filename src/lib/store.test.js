import { describe, expect, it, vi } from 'vitest';
import { store } from './store.js';

describe('store', () => {
  it('returns the fallback for a missing key', () => expect(store.get('nope', 42)).toBe(42));
  it('round-trips JSON values', () => {
    store.set('k', { a: [1, 2], b: 'x', c: false });
    expect(store.get('k', null)).toEqual({ a: [1, 2], b: 'x', c: false });
  });
  it('keeps a stored false or 0 instead of using the fallback', () => {
    store.set('flag', false);
    store.set('n', 0);
    expect(store.get('flag', true)).toBe(false);
    expect(store.get('n', 5)).toBe(0);
  });
  it('falls back when the stored text is not valid JSON', () => {
    localStorage.setItem('bad', '{oops');
    expect(store.get('bad', 'fallback')).toBe('fallback');
  });
  it('swallows errors when storage is unavailable', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => store.set('k', 1)).not.toThrow();
    spy.mockRestore();
    const get = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(store.get('k', 7)).toBe(7);
    get.mockRestore();
  });
});
