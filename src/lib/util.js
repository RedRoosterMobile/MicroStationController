export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const clampInt = (v, lo, hi) => clamp(Math.round(v), lo, hi);

// Random element of `arr` other than `not`, or null when nothing else is left.
export function pickRandom(arr, not) {
  const pool = arr.filter(x => x !== not);
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}
