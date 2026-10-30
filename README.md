# microSTATION arpeggiator research

## Conclusion

A focused modern editor for changing a sound's arpeggiator looks feasible using Korg's published MIDI implementation. Reverse-engineering the old Mac executable is not necessary for the documented controls. The research below has since been put into practice in a working web app (see “The app” below).

## The app

A Vite web page (`npm run dev`, `index.html` + `src/main.js`) that talks to the keyboard over Web MIDI with SysEx enabled (use Chrome or Edge). There is also a pattern composer page (`composer.html`, `src/composer.js`).

- **Connect:** identifies the unit and its global channel, reads the current Program or Combination, and can switch between Program and Combination Play.
- **Sounds:** browse, search and filter the factory Programs (banks A–D) and Combinations (A–C), step with ↑/↓, or pick a random one. Selection uses Bank Select + Program Change.
- **Arpeggiator:** on/off, latch, tempo, and for each arp (A and B in Combinations) octave, resolution, gate, velocity and swing, plus a searchable pattern list with favourites and a random button (←/→ step through patterns). Values are re-read from the unit after each change. Pattern names can be read from the unit.
- **Save:** writes the edit buffer to a chosen bank/number after an explicit confirmation. Nothing is written to memory otherwise.
- **Filter / EG:** sliders for Cutoff (CC#74), Resonance (CC#71), EG Intensity (CC#79), EG Release (CC#72), EG Attack (CC#73), EG Decay (CC#75) and EG Sustain (CC#70). These are the realtime-knob “mode A” parameters, relative −99…+99 with 0 as programmed, sent as MIDI CC. The unit does not report their position, so the sliders reflect only what the page last sent, and they reset on sound or mode change. Needs “Enable Control Change” on the keyboard.
- **Joystick pad:** X sends pitch bend, up sends CC#1 and down sends CC#2. A checkbox chooses whether the stick springs back to centre on release (remembered in the browser).
- **Automation (LFO):** one LFO per joystick axis and per filter/EG knob. Shapes are sine, triangle, saw, square and random; rates are synced to the arp tempo (4 bars to 1/16) or free in Hz; polarity is ±, + only or − only; depth is a percentage of the range. The LFO adds an offset to the manual value, and dragging the pad overrides its LFOs. A Web Worker keeps the timing steady in background tabs, and messages are sent only when a value changes (at most about 50 per second per target). “Stop all & centre” and any sound or mode change stop all LFOs.

## Downloaded references

Official product support: https://www.korg.com/us/support/download/product/0/87/

Original files are in `docs/originals/`; searchable PDF conversions are in `docs/text/`.

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

Combination Table 2 uses ID 03 for A and ID 04 for B, with corresponding sub-IDs. Timbre arpeggiator assignment is also documented. A first version should focus on Program mode to avoid additional routing complexity.

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

## Prerequisites and safety

- Enable Global/Media → MIDI → MIDI Filter → SysEx on the keyboard. Editor manual printed page 8 discusses this requirement.
- Determine the device's Global MIDI channel and current mode before edits.
- Verify MIDI connectivity on this modern Mac; the old USB-MIDI Setup Guide is not evidence that its historical driver supports current macOS. A compatible DIN MIDI interface is another possible transport.
- Start with read-only identity/mode/current-Program queries, then back up the current Program.
- Preview with parameter changes; do not send memory-write/store commands automatically. A persistent save should require explicit user action, preferably initially using the keyboard's own Write operation and a spare destination.
- The research phase sent no MIDI messages, installed no driver and changed no security settings.

## Uncertainties to resolve on hardware

The MIDI specification lists pattern-selection values 0–1032 and pattern-edit indices 0–1027, while the user-facing manuals describe five presets plus 640 user slots. Some Parameter Guide passages also show larger ranges. Treat these as documentation inconsistencies; do not expose all raw indices or assume the exact P/U-to-wire mapping. Read a current Program dump with a known pattern, change the pattern on the front panel, and compare the result before implementing selection.

Also verify the dump's byte ordering/version, value encoding (especially signed values), actual USB/DIN ports, and live readback behavior on this specific unit.

## Recommended first implementation

A small standalone Program-mode arpeggiator controller:

1. Connect, identify mode/channel, and read the current Program.
2. Show its current pattern; offer a searchable pattern picker.
3. Add arp on/off, latch, tempo, octave, resolution, gate, velocity, swing.
4. Preview without automatic permanent writes; explicitly save only after confirmation.

This is substantially narrower than replacing the entire old Editor/Librarian. Choosing native CoreMIDI versus another MIDI-capable UI can wait until connectivity and the pattern-number mapping are verified.
