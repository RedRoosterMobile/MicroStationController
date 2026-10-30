# microSTATION arpeggiator research

## Conclusion

A focused modern editor for changing a sound's arpeggiator looks feasible using Korg's published MIDI implementation. Reverse-engineering the old Mac executable is not necessary for the documented controls. The research below has since been put into practice in a working web app (see “The app” below).

## The app

Two Vite web pages that talk to the keyboard over Web MIDI with SysEx enabled (use Chrome or Edge, over USB):

- **Arp controller** (`index.html`): reads and edits a sound's arpeggiator and plays with realtime controls, described next.
- **Composer** (`composer.html`): turns a text prompt into a multitrack song and plays it on the keyboard as a 16-channel sound module, described [below](#the-composer).

### Arp controller

- **Connect:** identifies the unit and its global channel, reads the current Program or Combination, and can switch between Program and Combination Play. If the keyboard is in another mode (for example Sequencer), the page says so and asks you to switch.
- **Sounds:** browse, search and filter the factory Programs (banks A–D) and Combinations (A–C), step with ↑/↓, or pick a random one. Selection uses Bank Select + Program Change.
- **Arpeggiator:** on/off, latch, tempo, and for each arp (A and B in Combinations) octave, resolution, gate, velocity and swing, plus a searchable pattern list with favourites and a random button (←/→ step through patterns). Values are re-read from the unit after each change. Pattern names can be read from the unit.
- **Save:** writes the edit buffer to a chosen bank/number after an explicit confirmation. Nothing is written to memory otherwise.
- **Filter / EG:** sliders for Cutoff (CC#74), Resonance (CC#71), EG Intensity (CC#79), EG Release (CC#72), EG Attack (CC#73), EG Decay (CC#75) and EG Sustain (CC#70). These are the realtime-knob “mode A” parameters, relative −99…+99 with 0 as programmed, sent as MIDI CC. The unit does not report their position, so the sliders reflect only what the page last sent, and they reset on sound or mode change. Needs “Enable Control Change” on the keyboard.
- **Joystick pad:** X sends pitch bend, up sends CC#1 and down sends CC#2. A checkbox chooses whether the stick springs back to centre on release (remembered in the browser).
- **Automation (LFO):** one LFO per joystick axis and per filter/EG knob. Shapes are sine, triangle, saw, square and random; rates are synced to the arp tempo (4 bars to 1/16) or free in Hz; polarity is ±, + only or − only; depth is a percentage of the range. The LFO adds an offset to the manual value, and dragging the pad overrides its LFOs. A Web Worker keeps the timing steady in background tabs, and messages are sent only when a value changes (at most about 50 per second per target). “Stop all & centre” and any sound or mode change stop all LFOs.

### The composer

- **Compose / Revise:** a prompt becomes a song (title, tempo, loop length and up to 16 tracks of notes). “Revise current song” sends the current song back with a change request. This runs through a dev-server endpoint (`/api/compose` in `vite.config.js`) that calls the local `claude` CLI, so it only works with `npm run dev` and a logged-in Claude Code, and needs no API key. The page also has a built-in test song for checking routing without composing.
- **Sounds:** each track can use a General MIDI sound or one of the keyboard's own Programs (banks A–D), chosen from a menu. Drum tracks use a GM drum kit or a keyboard drum kit.
- **Keyboard drum kits:** these have their own key layouts, so the page reads the Program and its kit from the unit, works out which key plays kick, snare, hats, crashes and so on, and remaps the song's GM drum notes onto them. Learned layouts are remembered in the browser.
- **Playback:** schedules notes ahead of time on the MIDI output, with loop, tempo change while playing, per-track volume, mute and solo, and a test note per track. Songs persist in the browser.
- **Download .mid:** exports a Standard MIDI File (format 1) with the tracks' bank select and program changes.
- **Prepare keyboard (Sequencer + GM):** switches the unit to Sequencer mode and sends GM System On. This resets every track to a GM sound, so it replaces whatever track setup the keyboard had.
- **Read keyboard tracks / Self-test sound routing:** the first lists each track's program, bank, channel, status and volume as the unit reports them. The second tries SysEx and bank select + program change on track 16, reads the result back, prints how each bank number was stored, and ticks “Set sounds via SysEx” when that works. See “Findings from the hardware”.

### Development

```text
npm run dev        # dev server (the compose endpoint only exists here)
npm run build      # production build of both pages
npm test           # unit and integration tests (Vitest)
```

- `src/main.js` and `src/composer.js` are thin entry points that wire modules together.
- `src/lib/` holds what both pages share: Web MIDI ports, `send` and request/response matching, Korg 8-to-7-byte unpacking, parameter value encoding, the browser-storage wrapper and DOM helpers.
- `src/arp/` has the arp controller: SysEx protocol constants and dump parsing (`protocol.js`), keyboard I/O (`device.js`), sounds, patterns, the main panel, filter/joystick/LFO controls, pattern-name reading, saving and connection.
- `src/composer/` has the composer: sound catalogue, drum-kit learning, sound routing, diagnostics, song loading and composing, the track list, playback, MIDI export and connection.
- Tests sit next to the code (`*.test.js`). `src/test/fake-keyboard.js` simulates the unit (identity, modes, dumps, parameter changes, bank select and program change, saving) so reading, routing, kit learning and the self-test can be tested without hardware. It encodes what was observed on a real unit, so a new hardware finding means updating the fake first and then adding a test.

## Downloaded references

Official product support: https://www.korg.com/us/support/download/product/0/87/

Original files go in `docs/originals/` (git-ignored: download them from the Korg page above); searchable PDF conversions are in `docs/text/`.

| Reference | Local file under docs/originals | Official download page |
| --- | --- | --- |
| Parameter Guide | microSTATION_ParamG_E2.pdf | https://www.korg.com/us/support/download/manual/0/87/1876/ |
| Editor/Librarian Operation Manual | microSTATION_Editor_OM_E2.pdf | https://www.korg.com/us/support/download/manual/0/87/1872/ |
| Operation Guide | microSTATION_OG_E2.pdf | https://www.korg.com/us/support/download/manual/0/87/1875/ |
| USB-MIDI Setup Guide | microSTATION_SetupG_E2.pdf | https://www.korg.com/us/support/download/manual/0/87/1877/ |
| Voice Name List | microSTATION_VNL_EFGSJ2.pdf | https://www.korg.com/us/support/download/manual/0/87/1878/ |
| MIDI Implementation | microSTATION_MIDIimp.zip | https://www.korg.com/us/support/download/manual/0/87/2702/ |

The MIDI ZIP contains `microSTATION_MIDIimp/microSTATION_MIDIimp.TXT` (message formats and parameter tables) and `MIDIFX.TXT` (effect parameters). These are extracted alongside the ZIP. PDF text was extracted with `pdftotext -layout`.

## What we can control

### Change the pattern used by a sound

The instrument distinguishes Programs (single sounds) from Combinations (multiple timbres). Program mode has one arpeggiator; Combination and Sequencer modes have two, A and B.

The manuals describe five basic patterns (P0–P4: UP, DOWN, ALT1, ALT2, RANDOM) plus 640 user-pattern slots (U000–U639). The Parameter Guide's Global arpeggiator section distinguishes U000–U511(INT), preloaded patterns, from U512–U639(USER). Voice Name List printed page 65 onward supplies pattern names and lengths, including guitar strums, keyboard phrases, bass lines, and more. Current device names may differ if its patterns have been customized.

Editor manual printed page 21 explicitly describes changing the current arpeggio with the Arpeggiator Setup `Pattern` setting while it is playing.

### Other useful controls

MIDI implementation Table 1, Program arpeggiator parameters:

| Setting | Parameter tuple (mode, ID, sub-ID), hex |
| --- | --- |
| Tempo | 02,02,00 |
| Arpeggiator on/off | 02,02,01 |
| Global arp latch | 02,02,02 |
| Pattern selection | 02,03,00 |
| Resolution | 02,03,01 |
| Octave range | 02,03,02 |
| Gate | 02,03,03 |
| Velocity | 02,03,04 |
| Swing | 02,03,05 |
| Sort | 02,03,06 |
| Per-pattern latch | 02,03,07 |
| Key sync | 02,03,08 |
| Keyboard | 02,03,09 |
| Run | 02,03,0A |

Tempo is documented as 4000–30000 representing 40.00–300.00 BPM. Octave uses 0–3 for one to four octaves. Resolution has six choices. Gate/velocity include special values such as Step or Key; signed parameters need careful encoding rather than blindly treating bytes as unsigned.

Combination Table 2 uses ID 03 for A and ID 04 for B, with corresponding sub-IDs. Timbre arpeggiator assignment is also documented. The app covers Program and Combination arps (A and B).

### Edit the pattern itself (a separate, larger feature)

Message function 54 and Table 4 document pattern editing: length 1–48 steps, 12 tones, per-step pitch offset, gate, velocity, flam and enabled tones. Pattern dumps and storage commands are also documented.

Important distinction: selecting another pattern for one Program is not the same as modifying the shared pattern. Editing a pattern can affect other Programs/Combinations that reference it. Korg recommends copying a preloaded pattern to an unused user slot before editing it.

## Protocol essentials

MIDI implementation section (4), PARAMETER CHANGE:

```text
F0 42 3g 00 01 0D 41 mm 00 pp 00 qq v4 v3 v2 v1 v0 F7
```

- `g`: zero-based Global MIDI channel, 0–15 (`3g` means 0x30 + channel).
- `mm`: mode; 02 = Program Play. Table 1 says mode-02 messages also work in Program Edit.
- `pp`, `qq`: parameter ID and sub-ID from the table.
- Value is represented with the documented 32-bit grouping: bits 28–31, 21–27, 14–20, 7–13, 0–6. It is not an ordinary single-byte MIDI CC.
- The instrument does not send a reply to a parameter-change message. Readback/dumps are needed to verify state.

The document also supplies mode requests (function 12), mode responses (42), mode changes (4E), current Program dumps (section 32), and explicit object-write requests (77). Bulk dumps use Korg's 7-to-8-byte packing, explained in note *1; do not confuse this with the parameter value encoding above.

## Findings from the hardware

Things the documentation did not make obvious, found by testing on a real unit (all of this is encoded in the fake keyboard used by the tests):

- **Setting a track's sound in Sequencer mode (SysEx):** a parameter change with ID `04 + track index` (0-based), sub-ID `00` and value `program | bank << 7`. The bank is stored as sent: A–D are 0–3, GM is 4, g(1)–g(9) are 5–13 and the GM drum kits (g(d)) are 14. An earlier `program | bank << 8` encoding made the unit store double the bank (B became C, D became GM), so keyboard sounds and drum kits came out wrong. A bank outside 0–16 is ignored while the program still changes. MIDI implementation Table 10 lists the first timbre as ID `05`, but `04 + index` is what works.
- **Bank Select + Program Change did not work in Sequencer mode:** it was ignored on the unit. The Operation Guide says program changes are not received in Sequencer mode unless the track's MIDI filter “Prog Chg” is on, and that it is off by default. We did not confirm that this is the cause by switching Prog Chg on, but SysEx sound setting worked without it. The composer therefore defaults to SysEx (“Set sounds via SysEx”).
- **Parameter changes appear to apply only in the matching mode.** The self-test failed for every method until the keyboard was switched to Sequencer mode, and the unit gives no error, so a failing self-test most likely means “not in Sequencer mode”.
- **GM Initialize:** after “Prepare keyboard” every track reads GM program 1 (bank 4, prog 0) and track 10 the GM drum kit (bank 14).
- **Keyboard drum kits** are Programs with a drum oscillator and their own key layout (kit number at byte 738 of the Program dump, per-key sample numbers in the kit dump), so GM drum notes must be remapped to hear the right drums.
- **After a mode or sound change the unit may ignore requests for a moment,** so the page waits (about 2.5 s after a mode switch) and retries reads.
- **A sound change usually turns the arpeggiator off,** so the arp controller restores it afterwards when “Keep arp on when switching” is ticked.

## Prerequisites and safety

- Enable Global/Media → MIDI → MIDI Filter → SysEx on the keyboard. Editor manual printed page 8 discusses this requirement.
- Determine the device's Global MIDI channel and current mode before edits.
- Connectivity: Web MIDI over USB works from Chrome on the Mac this was developed on; the unit shows up as separate “KEYBOARD” and “SOUND” ports, which the pages pick by name.
- The app starts with read-only identity, mode and current-Program queries. A Program is not backed up automatically; use the keyboard's own tools if you want a backup before saving.
- Everything the pages send is a live preview: arp and sound changes, filter and joystick control changes, track sounds in the composer. The only message that writes to the unit's memory is “Save to memory…” on the arp page, which needs an explicit bank, number and confirmation. “Prepare keyboard” changes the mode and resets the Sequencer's tracks to GM sounds; it does not write to memory either.
- The research phase (the sections above) sent no MIDI messages, installed no driver and changed no security settings.

## Open questions

The MIDI specification lists pattern-selection values 0–1032 and pattern-edit indices 0–1027, while the user-facing manuals describe five presets plus 640 user slots. The app only exposes P0–P4 and U000–U639, using the raw index `5 + U-number` for user patterns, and relies on the unit's own pattern names (readable from the unit) rather than assuming the factory list. The other raw indices in the specification are not used. Some Parameter Guide passages also show larger ranges; treat these as documentation inconsistencies.

## Not implemented yet

- **Editing patterns** (function 54, Table 4: 1–48 steps, 12 tones, per-step pitch offset, gate, velocity, flam). Pattern selection exists; editing the shared pattern does not.
- **The other arp parameters:** Sort, per-pattern latch, key sync, keyboard and run (see the table above), and a Timbre's arp assignment in Combinations.
- **Combination and Sequencer routing details** beyond what the composer needs, for example per-track MIDI filter settings (Prog Chg) over SysEx.
- **A backup of the current Program** before saving.
