import type { PitchedNote } from '../types';
import { medianFilter } from '../dsp/median';
import { binHz, type Spectrogram } from '../dsp/stft';

const HARMONICS = 8;
const DECAY = 0.8;

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Monophonic pitch line by harmonic summation over a (harmonic) spectrogram.
 * Used for the bass and lead lines when the neural transcriber is unavailable.
 */
export function salienceLine(
  spec: Float32Array,
  s: Spectrogram,
  minMidi: number,
  maxMidi: number,
  onsetFrames: Set<number>,
  voicing = 0.35,
): PitchedNote[] {
  const hz = binHz(s);
  const nP = maxMidi - minMidi + 1;
  const pitch = new Float32Array(s.frames);
  const sal = new Float32Array(s.frames);
  const weights = Array.from({ length: HARMONICS }, (_, h) => Math.pow(DECAY, h));
  for (let f = 0; f < s.frames; f++) {
    const row = f * s.bins;
    let best = -1;
    let bestS = 0;
    for (let p = 0; p < nP; p++) {
      const f0 = midiHz(minMidi + p);
      let acc = 0;
      for (let h = 0; h < HARMONICS; h++) {
        const pos = (f0 * (h + 1)) / hz;
        const k = Math.floor(pos);
        if (k + 1 >= s.bins) break;
        const frac = pos - k;
        const m = spec[row + k] * (1 - frac) + spec[row + k + 1] * frac;
        acc += weights[h] * Math.log1p(m);
      }
      if (acc > bestS) {
        bestS = acc;
        best = p;
      }
    }
    pitch[f] = best >= 0 ? minMidi + best : 0;
    sal[f] = bestS;
  }
  // Smooth the pitch track so vibrato and single-frame jumps do not split notes.
  const smoothP = new Float32Array(s.frames);
  medianFilter(pitch, smoothP, 0, 1, s.frames, 5, new Float32Array(8));
  const ref = (() => {
    const a = Float32Array.from(sal).sort();
    return a[Math.floor(a.length * 0.95)] || 1;
  })();
  const fps = s.sr / s.hop;
  const notes: PitchedNote[] = [];
  let start = -1;
  let cur = 0;
  let acc = 0;
  const flush = (end: number) => {
    const len = end - start;
    if (start >= 0 && len >= 3) {
      notes.push({ t: start / fps, dur: len / fps, midi: Math.round(cur), strength: Math.min(1, acc / len / ref) });
    }
    start = -1;
    acc = 0;
  };
  for (let f = 0; f < s.frames; f++) {
    const voiced = sal[f] / ref > voicing;
    const m = Math.round(smoothP[f]);
    if (!voiced) {
      if (start >= 0) flush(f);
      continue;
    }
    if (start < 0) {
      start = f;
      cur = m;
    } else if (m !== cur || (onsetFrames.has(f) && f - start >= 4)) {
      flush(f);
      start = f;
      cur = m;
    }
    acc += sal[f];
  }
  if (start >= 0) flush(s.frames);
  return notes;
}
