import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

// Compose endpoint: shells out to the local `claude` CLI (already logged in), so no API key is needed.
const KIT_SUBS = new Set(['Natural', 'Dance', 'Perc']);
const catalogue = () => {
  const programs = JSON.parse(readFileSync(new URL('./sounds.json', import.meta.url))).programs;
  const group = list => {
    const by = {};
    for (const p of list) (by[p.sub] ??= []).push(`${p.bank}${p.num} ${p.name}`);
    return Object.entries(by).map(([sub, names]) => `${sub}: ${names.join(', ')}`).join('\n');
  };
  return { melodic: group(programs.filter(p => !KIT_SUBS.has(p.sub))), kits: group(programs.filter(p => KIT_SUBS.has(p.sub))) };
};

const system = () => {
  const c = catalogue();
  return `You are a MIDI composer for a Korg microSTATION synthesizer used as a 16-channel multitimbral sound module. Reply with ONE JSON object and nothing else (no prose, no code fences).
Schema:
{
  "title": string,
  "tempo": number,                 // BPM
  "beats": number,                 // total length in quarter-note beats (loop length)
  "tracks": [{
    "ch": 1-16,                    // MIDI channel; drums are ALWAYS on channel 10, never use channel 10 for anything else
    "name": string,                // e.g. "Bass", "Lead", "Drums"
    "sound": string,               // see SOUNDS below
    "vol": 0-127,                  // optional channel volume, default 100
    "notes": [[startBeat, durationBeats, midiNote, velocity], ...]
  }]
}
SOUNDS: the sound's character matters most, so choose the sound that fits best, from the keyboard's own sounds or General MIDI.
- Keyboard sounds are given by their id: a bank letter A-D plus program number, e.g. "B74". Use the ids exactly as listed below.
- General MIDI: "gm:N" with N the 0-based GM program number (e.g. "gm:33" = Fingered Bass).
- Drum tracks (channel 10) use a drum kit: either "gmd:N" with N one of 0 Standard, 8 Room, 16 Power, 24 Electronic, 25 TR-808, 32 Jazz, 40 Brush, 48 Orchestra, 56 SFX, or a keyboard kit id from the KITS list. Always write drum notes with the GM drum note numbers; the player remaps them to the chosen kit's own key layout. Choose the kit whose character fits the music (GM kits or the keyboard's own kits).
Prefer the richer keyboard sounds for leads, pads, basses and keys when they fit; use GM where it is the better match.
Keyboard melodic sounds by category:
${c.melodic}
KITS (keyboard drum kits):
${c.kits}
Rules: startBeat/duration are in quarter-note beats (floats ok, 4/4 unless asked otherwise). Write a loopable arrangement of 16-64 beats (unless asked for a length) with a clear groove, harmony and melody. Use 3-7 tracks on different channels (not 10 except for drums). Drums use the GM drum map: 36 kick, 38 snare, 42 closed hat, 46 open hat, 49 crash, 45/47/50 toms, 39 clap, 37 rim; give drum notes duration 0.1. Velocities 40-120 with human-like variation.
If an existing song is supplied, apply the user's change request to it and return the complete updated song in the same schema, keeping its sounds unless asked to change them.`;
};

function composePlugin() {
  return {
    name: 'compose-api',
    configureServer(server) {
      server.middlewares.use('/api/compose', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        let body = '';
        req.on('data', c => (body += c));
        req.on('end', () => {
          let input;
          try { input = JSON.parse(body); } catch { res.statusCode = 400; return res.end('bad json'); }
          const user = input.song
            ? `Existing song:\n${JSON.stringify(input.song)}\n\nChange request: ${input.prompt}`
            : `Song description: ${input.prompt}`;
          const p = spawn('claude', ['-p', '--model', 'sonnet', '--tools', '', '--no-session-persistence', '--append-system-prompt', system()],
            { cwd: tmpdir() });
          let out = '', err = '';
          p.stdout.on('data', d => (out += d));
          p.stderr.on('data', d => (err += d));
          p.on('error', e => { res.statusCode = 500; res.end(JSON.stringify({ error: String(e) })); });
          p.on('close', code => {
            res.setHeader('content-type', 'application/json');
            const m = out.match(/\{[\s\S]*\}/);
            if (code !== 0 || !m) { res.statusCode = 500; return res.end(JSON.stringify({ error: err || out || 'no output' })); }
            try { JSON.parse(m[0]); res.end(m[0]); } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: 'invalid JSON from model: ' + e.message })); }
          });
          p.stdin.end(user);
        });
      });
    },
  };
}

export default {
  plugins: [composePlugin()],
  test: { setupFiles: ['./src/test-setup.js'] },
  build: { rollupOptions: { input: { main: 'index.html', composer: 'composer.html' } } },
};
