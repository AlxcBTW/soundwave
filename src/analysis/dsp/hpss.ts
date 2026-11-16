import type { Spectrogram } from './stft';
import { medianFilter } from './median';

export interface Hpss {
  harmonic: Float32Array;
  percussive: Float32Array;
}

/**
 * Harmonic/percussive separation by median filtering (Fitzgerald 2010) with soft masks.
 * Harmonic content is smooth over time, percussive content is smooth over frequency.
 */
export function hpss(s: Spectrogram, timeWin = 17, freqWin = 17, onProgress?: (p: number) => void): Hpss {
  const { mag, frames, bins } = s;
  const harmonic = new Float32Array(mag.length);
  const percussive = new Float32Array(mag.length);
  const scratch = new Float32Array(Math.max(timeWin, freqWin) + 2);
  for (let k = 0; k < bins; k++) {
    medianFilter(mag, harmonic, k, bins, frames, timeWin, scratch);
    if (onProgress && (k & 127) === 0) onProgress((k / bins) * 0.5);
  }
  for (let f = 0; f < frames; f++) {
    medianFilter(mag, percussive, f * bins, 1, bins, freqWin, scratch);
    if (onProgress && (f & 2047) === 0) onProgress(0.5 + (f / frames) * 0.5);
  }
  for (let i = 0; i < mag.length; i++) {
    const h = harmonic[i] * harmonic[i];
    const p = percussive[i] * percussive[i];
    const sum = h + p + 1e-12;
    harmonic[i] = (mag[i] * h) / sum;
    percussive[i] = (mag[i] * p) / sum;
  }
  return { harmonic, percussive };
}
