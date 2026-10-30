// LFO waveforms and phase stepping (pure; the timers and MIDI output live in controls.js).
export const WAVES = {
  sine: p => Math.sin(2 * Math.PI * p),
  tri: p => p < .25 ? 4 * p : p < .75 ? 2 - 4 * p : 4 * p - 4,
  saw: p => 2 * ((p + .5) % 1) - 1,
  square: p => p < .5 ? 1 : -1,
};

// Advance LFO state `l` ({ phase, hold, shape, pol, depth }) by `dt` seconds at `cyclesPerSecond`;
// returns the output as a share of the full range, -1…+1 (random shapes draw a new value each cycle).
export function advanceLfo(l, dt, cyclesPerSecond) {
  l.phase += dt * cyclesPerSecond;
  if (l.phase >= 1) { l.phase %= 1; l.hold = Math.random() * 2 - 1; }
  let v = l.shape === 'rand' ? l.hold : WAVES[l.shape](l.phase);
  if (l.pol === 'up') v = (v + 1) / 2;
  else if (l.pol === 'dn') v = -(v + 1) / 2;
  return v * l.depth / 100;
}
