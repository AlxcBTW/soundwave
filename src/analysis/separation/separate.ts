import { addInverse, BINS, FRAMES, SEGMENT, spectrogram } from './stft';

/** The stems in the order the model gives them. */
export const MODEL_STEMS = ['drums', 'bass', 'other', 'vocals'] as const;
export const MODEL_RATE = 44100;

/** Neighbouring segments share a quarter of their length. */
const STRIDE = Math.floor(0.75 * SEGMENT);
const PLANE = BINS * FRAMES;
const SOURCES = MODEL_STEMS.length;

/**
 * The network itself, for one segment: `x` is the normalised spectrogram (4 planes of BINS x FRAMES:
 * left re, left im, right re, right im) and `xt` the normalised segment (left, then right). It
 * returns, still normalised, 4 such planes per stem and 2 channels per stem.
 */
export interface SegmentModel {
  run(x: Float32Array, xt: Float32Array): Promise<{ x: Float32Array; xt: Float32Array }>;
}

function meanAndDeviation(a: Float32Array): [number, number] {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i];
  const mean = sum / a.length;
  let sq = 0;
  for (let i = 0; i < a.length; i++) sq += (a[i] - mean) ** 2;
  return [mean, Math.sqrt(sq / (a.length - 1))];
}

function normalise(a: Float32Array): [number, number] {
  const [mean, dev] = meanAndDeviation(a);
  const k = 1 / (1e-5 + dev);
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - mean) * k;
  return [mean, dev];
}

/**
 * Splits a stereo song at 44.1 kHz into its four stems, each mixed to mono, the way Demucs applies
 * its model: overlapping 7.8 s segments, each weighted by a triangle and summed. Unlike Demucs'
 * default there is no random time shift, so the same song always gives the same stems.
 */
export async function separate(
  left: Float32Array,
  right: Float32Array,
  model: SegmentModel,
  onProgress: (p: number) => void = () => {},
  aborted: () => boolean = () => false,
): Promise<Float32Array[]> {
  const length = left.length;
  // The whole song is levelled first, by its mono mix.
  let sum = 0;
  for (let i = 0; i < length; i++) sum += (left[i] + right[i]) / 2;
  const mean = sum / length;
  let sq = 0;
  for (let i = 0; i < length; i++) sq += ((left[i] + right[i]) / 2 - mean) ** 2;
  const scale = Math.sqrt(sq / Math.max(1, length - 1)) + 1e-8;

  const stems = MODEL_STEMS.map(() => new Float32Array(length));
  const weights = new Float32Array(length);
  const xt = new Float32Array(2 * SEGMENT);
  const x = new Float32Array(4 * PLANE);
  const mono = new Float32Array(SEGMENT);
  const both = new Float32Array(2 * PLANE);
  const half = SEGMENT / 2;
  const weight = (i: number) => (i < half ? i + 1 : SEGMENT - i) / half;

  for (let offset = 0; offset < length; offset += STRIDE) {
    if (aborted()) throw new DOMException('analysis cancelled', 'AbortError');
    // A short last segment is centred in a full-length one, with what comes before it and silence after.
    const span = Math.min(length - offset, SEGMENT);
    const lead = Math.floor((SEGMENT - span) / 2);
    const start = offset - lead;
    for (let i = 0; i < SEGMENT; i++) {
      const src = start + i;
      const inside = src >= 0 && src < length;
      xt[i] = inside ? (left[src] - mean) / scale : 0;
      xt[SEGMENT + i] = inside ? (right[src] - mean) / scale : 0;
    }
    spectrogram(xt.subarray(0, SEGMENT), x, 0);
    spectrogram(xt.subarray(SEGMENT), x, 2);
    const [xMean, xDev] = normalise(x);
    const [tMean, tDev] = normalise(xt);
    const out = await model.run(x, xt);

    // Both outputs come back normalised like the inputs.
    for (let i = 0; i < out.x.length; i++) out.x[i] = out.x[i] * xDev + xMean;
    for (let s = 0; s < SOURCES; s++) {
      // Both channels at once: the mono stem is their average, and the inverse transform is linear,
      // so the two spectrograms are averaged and transformed back together.
      const at0 = s * 4 * PLANE;
      for (let i = 0; i < 2 * PLANE; i++) both[i] = (out.x[at0 + i] + out.x[at0 + 2 * PLANE + i]) / 2;
      mono.fill(0);
      addInverse(both, 0, PLANE, mono, 1);
      const l = s * 2 * SEGMENT;
      const r = l + SEGMENT;
      const stem = stems[s];
      for (let i = 0; i < span; i++) {
        const at = lead + i;
        const v = mono[at] + ((out.xt[l + at] + out.xt[r + at]) / 2) * tDev + tMean;
        stem[offset + i] += weight(i) * v;
      }
    }
    for (let i = 0; i < span; i++) weights[offset + i] += weight(i);
    onProgress(Math.min(1, (offset + span) / length));
  }
  for (const stem of stems) for (let i = 0; i < length; i++) stem[i] = (stem[i] / weights[i]) * scale + mean;
  return stems;
}
