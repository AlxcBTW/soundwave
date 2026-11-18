/**
 * Where sounds start in a song, read straight off its waveform: the moments it gets suddenly
 * louder. The editor shows them beside the lanes, can step from one to the next, and can snap notes
 * to them, so a song that was never analyzed still says where its notes probably go.
 */

/** Start times, in seconds, of the sounds in a mono signal. */
export function findAttacks(data: Float32Array, sampleRate: number): number[] {
  // Loudness every 5 ms, on a scale where a quiet sound still counts.
  const size = Math.max(1, Math.round(sampleRate / 200));
  const n = Math.floor(data.length / size);
  if (n < 40) return [];
  const level = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * size, end = j + size; j < end; j++) s += data[j] * data[j];
    level[i] = Math.log1p(200 * Math.sqrt(s / size));
  }
  // How much louder each moment is than the two before it.
  const rise = new Float32Array(n);
  for (let i = 2; i < n; i++) rise[i] = Math.max(0, level[i] - Math.min(level[i - 1], level[i - 2]));
  // A rise counts when it stands well clear of what is usual around it (a second either way).
  const sums = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sums[i + 1] = sums[i] + rise[i];
  const out: number[] = [];
  let last = -100;
  let lastRise = 0;
  for (let i = 2; i < n - 3; i++) {
    const r = rise[i];
    // Loudness measured this finely flickers by itself: a rise has to be well clear of that.
    if (r < 0.3) continue;
    if (r < rise[i - 1] || r < rise[i + 1] || r < rise[i + 2] || r < rise[i - 2]) continue;
    const a = Math.max(0, i - 200);
    const b = Math.min(n, i + 200);
    const usual = (sums[b] - sums[a]) / (b - a);
    if (r < usual * 2.4 + 0.06) continue;
    // Two rises within 60 ms are one sound: the stronger one stands.
    if (i - last < 12) {
      if (r <= lastRise) continue;
      out.pop();
    }
    out.push((i * size) / sampleRate);
    last = i;
    lastRise = r;
  }
  return out;
}

/** Index of the entry of a sorted list nearest to `x`, or -1 for an empty list. */
export function nearestIndex(sorted: readonly number[], x: number): number {
  if (!sorted.length) return -1;
  let lo = 0;
  let hi = sorted.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid;
    else hi = mid;
  }
  return Math.abs(sorted[hi] - x) < Math.abs(sorted[lo] - x) ? hi : lo;
}
