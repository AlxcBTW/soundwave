/** A song's waveform reduced to the loudest swing each way per slice of time, for drawing it quickly. */
export interface Peaks {
  /** Slices per second. */
  perSec: number;
  min: Float32Array;
  max: Float32Array;
}

export function computePeaks(buffer: AudioBuffer, perSec = 200): Peaks {
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(buffer.sampleRate / perSec));
  const n = Math.ceil(data.length / step);
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    let lo = 0;
    let hi = 0;
    const end = Math.min(data.length, (b + 1) * step);
    for (let i = b * step; i < end; i++) {
      const v = data[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { perSec: buffer.sampleRate / step, min, max };
}
