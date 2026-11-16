/** One-pole low-pass filter. */
export function lowpass(x: Float32Array, sr: number, hz: number): Float32Array {
  const a = Math.exp((-2 * Math.PI * hz) / sr);
  const y = new Float32Array(x.length);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    s = (1 - a) * x[i] + a * s;
    y[i] = s;
  }
  return y;
}

/** One-pole high-pass filter (input minus its low-passed copy). */
export function highpass(x: Float32Array, sr: number, hz: number): Float32Array {
  const lp = lowpass(x, sr, hz);
  for (let i = 0; i < x.length; i++) lp[i] = x[i] - lp[i];
  return lp;
}

const WIN = 128;
const HOP = 32;

/**
 * Moves a coarse onset estimate to the steepest rise of a fine energy envelope nearby.
 * STFT-based onsets are biased early by roughly half a window; this recovers the attack time.
 */
export function refineOnset(x: Float32Array, sr: number, t: number, before = 0.04, after = 0.1): number {
  const a = Math.max(0, Math.floor((t - before) * sr));
  const b = Math.min(x.length - WIN, Math.floor((t + after) * sr));
  if (b <= a + WIN) return t;
  const rises: number[] = [];
  const at: number[] = [];
  let prev = Number.NaN;
  for (let i = a; i <= b; i += HOP) {
    let e = 0;
    for (let j = 0; j < WIN; j++) e += x[i + j] * x[i + j];
    const v = Math.log(1e-9 + Math.sqrt(e / WIN));
    if (!Number.isNaN(prev)) {
      rises.push(v - prev);
      at.push(i);
    }
    prev = v;
  }
  const maxRise = Math.max(0, ...rises);
  // The first strong rise marks the attack; later rises are usually decay ripple or other sounds.
  let bestAt = -1;
  for (let k = 0; k < rises.length; k++) {
    if (maxRise > 0 && rises[k] >= maxRise * 0.6) {
      bestAt = at[k];
      // Walk forward while the rise keeps growing (same attack).
      while (k + 1 < rises.length && rises[k + 1] > rises[k]) bestAt = at[++k];
      break;
    }
  }
  // The rise is measured between two windows; the attack sits near the end of the earlier one.
  return bestAt < 0 ? t : (bestAt + WIN - HOP / 2) / sr;
}
