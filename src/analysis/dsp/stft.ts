import FFT from 'fft.js';

export interface Spectrogram {
  /** Row-major magnitudes: frame f, bin k at f * bins + k. */
  mag: Float32Array;
  frames: number;
  bins: number;
  nfft: number;
  hop: number;
  sr: number;
}

export const binHz = (s: Spectrogram) => s.sr / s.nfft;
export const frameTime = (s: Spectrogram, f: number) => (f * s.hop) / s.sr;
export const hzToBin = (s: Spectrogram, hz: number) => Math.min(s.bins - 1, Math.max(0, Math.round(hz / binHz(s))));

/** Magnitude STFT with a Hann window. Frame f is centered on sample f * hop. */
export function stft(signal: Float32Array, sr: number, nfft = 2048, hop = 512, onProgress?: (p: number) => void): Spectrogram {
  const bins = nfft / 2 + 1;
  const frames = Math.max(1, Math.ceil(signal.length / hop));
  const mag = new Float32Array(frames * bins);
  const fft = new FFT(nfft);
  const input = new Array<number>(nfft).fill(0);
  const out = fft.createComplexArray() as number[];
  const win = new Float32Array(nfft);
  for (let i = 0; i < nfft; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / nfft);
  const half = nfft / 2;
  for (let f = 0; f < frames; f++) {
    const start = f * hop - half;
    for (let i = 0; i < nfft; i++) {
      const idx = start + i;
      input[i] = idx >= 0 && idx < signal.length ? signal[idx] * win[i] : 0;
    }
    fft.realTransform(out, input);
    const row = f * bins;
    for (let k = 0; k < bins; k++) {
      const re = out[2 * k];
      const im = out[2 * k + 1];
      mag[row + k] = Math.sqrt(re * re + im * im);
    }
    if (onProgress && (f & 1023) === 0) onProgress(f / frames);
  }
  return { mag, frames, bins, nfft, hop, sr };
}
