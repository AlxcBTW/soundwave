import FFT from 'fft.js';

/**
 * The transform at both ends of the stem model, which the model file leaves out (see
 * tools/analysis/export_stem_model.py). It matches Demucs' own: 4096-point Hann frames every 1024
 * samples, scaled by 1/sqrt(4096), reflected at the edges, without the top bin and without the two
 * frames at either end.
 */
export const SEGMENT = 343980; // 7.8 s at 44.1 kHz, the length the model was trained on
export const NFFT = 4096;
export const HOP = 1024;
export const BINS = NFFT / 2;
export const FRAMES = Math.ceil(SEGMENT / HOP);

/** Samples reflected onto each end before the frames are cut (Demucs pads by a quarter and a half frame). */
const PAD = (HOP / 2) * 3;
const CENTER = NFFT / 2;
/** Length after the first padding: a whole number of hops plus the pad at both ends. */
const PADDED = FRAMES * HOP + 2 * PAD;
/** Frames kept start two in. */
const SKIP = 2;
const SCALE = 1 / Math.sqrt(NFFT);
/** Four Hann windows a quarter apart always sum to this when squared. */
const WINDOW_SUM = 1.5;

const fft = new FFT(NFFT);
const HANN = Float32Array.from({ length: NFFT }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / NFFT));

const reflect = (i: number, n: number) => {
  while (i < 0 || i >= n) i = i < 0 ? -i : 2 * (n - 1) - i;
  return i;
};

const padded = new Float32Array(PADDED + NFFT);
const frame = new Float64Array(NFFT);
const spectrum = fft.createComplexArray();
const time = fft.createComplexArray();

/**
 * Spectrogram of one channel of a segment, written as two planes (real, imaginary) of
 * BINS x FRAMES values each, into `out` starting at plane `plane`.
 */
export function spectrogram(x: Float32Array, out: Float32Array, plane: number): void {
  // Both paddings at once: the inner one by PAD (and up to a whole hop), the outer one by half a frame.
  for (let p = 0; p < padded.length; p++) padded[p] = x[reflect(reflect(p - CENTER, PADDED) - PAD, SEGMENT)];
  const re = plane * BINS * FRAMES;
  const im = re + BINS * FRAMES;
  for (let t = 0; t < FRAMES; t++) {
    const at = (t + SKIP) * HOP;
    for (let n = 0; n < NFFT; n++) frame[n] = padded[at + n] * HANN[n];
    fft.realTransform(spectrum, frame);
    for (let f = 0; f < BINS; f++) {
      out[re + f * FRAMES + t] = spectrum[2 * f] * SCALE;
      out[im + f * FRAMES + t] = spectrum[2 * f + 1] * SCALE;
    }
  }
}

/**
 * The signal of a spectrogram given as a real and an imaginary plane (BINS x FRAMES each, read
 * from `planes` at `re` and `im`), SEGMENT samples long, added onto `out` times `gain`.
 */
export function addInverse(planes: Float32Array, re: number, im: number, out: Float32Array, gain: number): void {
  // Output sample i sits at i + PAD + CENTER on the timeline the frames overlap on.
  const shift = PAD + CENTER;
  // Undoes the forward scale and the overlap of the windows (fft.js divides by the size itself).
  const k = gain / (SCALE * WINDOW_SUM);
  for (let t = 0; t < FRAMES; t++) {
    for (let f = 0; f < BINS; f++) {
      const a = planes[re + f * FRAMES + t];
      const b = planes[im + f * FRAMES + t];
      spectrum[2 * f] = a;
      spectrum[2 * f + 1] = b;
      if (f > 0) {
        spectrum[2 * (NFFT - f)] = a;
        spectrum[2 * (NFFT - f) + 1] = -b;
      }
    }
    spectrum[2 * BINS] = 0;
    spectrum[2 * BINS + 1] = 0;
    fft.inverseTransform(time, spectrum);
    const at = (t + SKIP) * HOP - shift;
    const from = Math.max(0, -at);
    const to = Math.min(NFFT, SEGMENT - at);
    for (let n = from; n < to; n++) out[at + n] += time[2 * n] * HANN[n] * k;
  }
}
