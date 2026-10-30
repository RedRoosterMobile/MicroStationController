import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const el = id => document.getElementById(id);

async function load() {
  vi.resetModules();
  const song = await import('./song.js');
  song.initSong();
  el('prompt').value = 'upbeat funk';
  return song;
}
const respond = (status, body) => vi.fn(async () => ({ ok: status < 400, status, json: async () => { if (body === undefined) throw new SyntaxError('Unexpected token <'); return body; } }));

beforeEach(() => vi.stubGlobal('fetch', undefined));
afterEach(() => vi.unstubAllGlobals());

describe('compose', () => {
  it('asks for api/compose relative to the page, so it works under any sub-path', async () => {
    const fetch = respond(500, { error: 'boom' });
    vi.stubGlobal('fetch', fetch);
    await load();
    await el('compose').onclick();
    expect(fetch.mock.calls[0][0]).toBe('api/compose');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ prompt: 'upbeat funk' });
  });

  it('shows the server\'s error message', async () => {
    vi.stubGlobal('fetch', respond(500, { error: 'claude exited with code 1' }));
    await load();
    await el('compose').onclick();
    expect(el('cstatus').textContent).toBe('Failed: claude exited with code 1');
  });

  it('explains that composing needs the dev server when the host answers with something other than JSON (static hosting)', async () => {
    for (const status of [404, 405, 501]) {
      vi.stubGlobal('fetch', respond(status, undefined));          // the host answers with an HTML error page, not JSON
      await load();
      await el('compose').onclick();
      expect(el('cstatus').textContent).toBe('Failed: composing needs the local dev server (npm run dev)');
    }
  });

  it('does nothing for an empty prompt', async () => {
    const fetch = respond(200, {});
    vi.stubGlobal('fetch', fetch);
    await load();
    el('prompt').value = '   ';
    await el('compose').onclick();
    expect(fetch).not.toHaveBeenCalled();
  });
});
