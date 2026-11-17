/**
 * Basic Pitch's note decoding (outputToNotesPoly, addPitchBendsToNoteEvents and noteFramesToTime in
 * @spotify/basic-pitch's toMidi.ts, Apache-2.0), on flat typed arrays instead of nested ones.
 *
 * It gives the same notes, bends and times as the original (tests/noteEvents.test.ts checks that),
 * including its ties: where two values are equal, the original picks the later column of a row and
 * the earlier row. The difference is speed. The original's "melodia" step finds the largest energy
 * left in the whole frames-by-pitches grid once per note it adds, scanning every cell each time;
 * for a four-minute song that is billions of comparisons, seconds per stem. Here each frame keeps
 * its own largest value, so a search reads one value per frame and only the frames a note changed
 * are scanned again.
 */

const MIDI_OFFSET = 21;
const SAMPLE_RATE = 22050;
const FFT_HOP = 256;
const FPS = Math.floor(SAMPLE_RATE / FFT_HOP);
const WINDOW_SECONDS = 2;
const WINDOW_FRAMES = FPS * WINDOW_SECONDS;
const WINDOW_SAMPLES = SAMPLE_RATE * WINDOW_SECONDS - FFT_HOP;
// As in the original, magic number included.
const WINDOW_OFFSET = (FFT_HOP / SAMPLE_RATE) * (WINDOW_FRAMES - WINDOW_SAMPLES / FFT_HOP) + 0.0018;
const MAX_FREQ_IDX = 87;
const CONTOUR_BINS_PER_SEMITONE = 3;
const BASE_FREQUENCY = 27.5;
export const PITCHES = 88;
export const CONTOUR_BINS = PITCHES * CONTOUR_BINS_PER_SEMITONE;

export interface NoteEvent {
  startFrame: number;
  durationFrames: number;
  pitchMidi: number;
  amplitude: number;
  pitchBends?: number[];
}

export interface NoteEventTime {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
  amplitude: number;
  pitchBends?: number[];
}

export interface DecodeOptions {
  onsetThresh: number;
  frameThresh: number;
  minNoteLen: number;
  energyTolerance: number;
}

/**
 * Notes from the model's note (`frames`) and onset activations, each `nFrames` x PITCHES, row by
 * row. Same as outputToNotesPoly with inferOnsets and the melodia trick on, and no frequency limits.
 */
export function decodeNotes(frames: Float32Array, onsets: Float32Array, nFrames: number, o: DecodeOptions): NoteEvent[] {
  const P = PITCHES;
  const thresh = o.frameThresh;

  // Inferred onsets: where a pitch's frame activation rises sharply, as strong as the onset output.
  // min over n = 1, 2 of frames[t] - frames[t - n] (zero before the start), clipped at 0, the first
  // two frames zeroed, rescaled to the onsets' maximum, then the larger of that and the onsets.
  const diff = new Float64Array(nFrames * P);
  for (let r = 2; r < nFrames; r++) {
    for (let c = 0; c < P; c++) {
      const v = frames[r * P + c];
      const d1 = v - frames[(r - 1) * P + c];
      const d2 = v - frames[(r - 2) * P + c];
      diff[r * P + c] = Math.max(Math.min(d1, d2), 0);
    }
  }
  let onsetMax = 0;
  for (let i = 0; i < nFrames * P; i++) if (onsets[i] > onsetMax) onsetMax = onsets[i];
  let diffMax = 0;
  for (let i = 0; i < nFrames * P; i++) if (diff[i] > diffMax) diffMax = diff[i];
  const inferred = new Float64Array(nFrames * P);
  for (let i = 0; i < nFrames * P; i++) inferred[i] = Math.max(onsets[i], (onsetMax * diff[i]) / diffMax);

  // Onset peaks (larger than the frame before and after) above the threshold, latest first and,
  // within a frame, highest pitch first: the original's order.
  const isPeak = (r: number, c: number) => {
    const v = inferred[r * P + c];
    if (r > 0 && !(v > inferred[(r - 1) * P + c])) return false;
    if (r < nFrames - 1 && !(v > inferred[(r + 1) * P + c])) return false;
    return true;
  };

  const remaining = Float32Array.from(frames.subarray(0, nFrames * P));
  const amplitudeOf = (start: number, end: number, c: number) => {
    let sum = 0;
    for (let r = start; r < end; r++) sum += frames[r * P + c];
    return sum / (end - start);
  };
  const clear = (r: number, c: number) => {
    const at = r * P + c;
    remaining[at] = 0;
    if (c < MAX_FREQ_IDX) remaining[at + 1] = 0;
    if (c > 0) remaining[at - 1] = 0;
  };

  const notes: NoteEvent[] = [];
  for (let r = nFrames - 1; r >= 0; r--) {
    for (let c = P - 1; c >= 0; c--) {
      if (!(inferred[r * P + c] > o.onsetThresh) || !isPeak(r, c)) continue;
      if (r >= nFrames - 1) continue;
      let i = r + 1;
      let k = 0;
      while (i < nFrames - 1 && k < o.energyTolerance) {
        k = remaining[i * P + c] < thresh ? k + 1 : 0;
        i++;
      }
      i -= k;
      if (i - r <= o.minNoteLen) continue;
      for (let j = r; j < i; j++) clear(j, c);
      notes.push({ startFrame: r, durationFrames: i - r, pitchMidi: c + MIDI_OFFSET, amplitude: amplitudeOf(r, i, c) });
    }
  }

  // Melodia: the strongest energy left starts a note, followed both ways while it lasts.
  const rowMax = new Float64Array(nFrames);
  const rowArg = new Int32Array(nFrames);
  const scanRow = (r: number) => {
    // The last column of the largest value, as the original's argMax.
    let best = -Infinity;
    let arg = 0;
    for (let c = 0; c < P; c++) {
      const v = remaining[r * P + c];
      if (!(best > v)) {
        best = v;
        arg = c;
      }
    }
    rowMax[r] = best;
    rowArg[r] = arg;
  };
  for (let r = 0; r < nFrames; r++) scanRow(r);

  for (;;) {
    let globalMax = 0;
    for (let r = 0; r < nFrames; r++) if (rowMax[r] > globalMax) globalMax = rowMax[r];
    if (!(globalMax > thresh)) break;
    // The original starts from cell (0, 0) and moves on only to a strictly larger row maximum.
    let iMid = 0;
    let c = 0;
    let bestValue = remaining[0];
    for (let r = 0; r < nFrames; r++) {
      if (rowMax[r] > bestValue) {
        bestValue = rowMax[r];
        iMid = r;
        c = rowArg[r];
      }
    }
    remaining[iMid * P + c] = 0;

    let i = iMid + 1;
    let k = 0;
    while (i < nFrames - 1 && k < o.energyTolerance) {
      k = remaining[i * P + c] < thresh ? k + 1 : 0;
      clear(i, c);
      i++;
    }
    const forwardEnd = i;
    const iEnd = i - 1 - k;

    i = iMid - 1;
    k = 0;
    while (i > 0 && k < o.energyTolerance) {
      k = remaining[i * P + c] < thresh ? k + 1 : 0;
      clear(i, c);
      i--;
    }
    const backwardEnd = i;
    const iStart = i + 1 + k;

    for (let r = Math.max(0, backwardEnd + 1); r < Math.min(nFrames, forwardEnd); r++) scanRow(r);
    scanRow(iMid);

    if (iEnd - iStart <= o.minNoteLen) continue;
    notes.push({ startFrame: iStart, durationFrames: iEnd - iStart, pitchMidi: c + MIDI_OFFSET, amplitude: amplitudeOf(iStart, iEnd, c) });
  }
  return notes;
}

const midiToHz = (midi: number) => 440.0 * 2.0 ** ((midi - 69.0) / 12.0);
const contourBin = (midi: number) => 12.0 * CONTOUR_BINS_PER_SEMITONE * Math.log2(midiToHz(midi) / BASE_FREQUENCY);

/** Each note's pitch over time, in thirds of a semitone around it, from the contour output (`nFrames` x CONTOUR_BINS). */
export function addPitchBends(contours: Float32Array, notes: NoteEvent[], tolerance = 25): NoteEvent[] {
  const length = tolerance * 2 + 1;
  const gaussian = Array.from({ length }, (_, n) => Math.exp((-1 * (n - (length - 1) / 2) ** 2) / (2 * 5 ** 2)));
  return notes.map((note) => {
    const bin = Math.floor(Math.round(contourBin(note.pitchMidi)));
    const from = Math.max(bin - tolerance, 0);
    const to = Math.min(CONTOUR_BINS, bin + tolerance + 1);
    const g0 = Math.max(0, tolerance - bin);
    const shift = tolerance - Math.max(0, tolerance - bin);
    const bends: number[] = [];
    for (let r = note.startFrame; r < note.startFrame + note.durationFrames; r++) {
      let best = -Infinity;
      let arg = 0;
      for (let b = from; b < to; b++) {
        const v = contours[r * CONTOUR_BINS + b] * gaussian[g0 + b - from];
        if (!(best > v)) {
          best = v;
          arg = b - from;
        }
      }
      bends.push(arg - shift);
    }
    return { ...note, pitchBends: bends };
  });
}

const frameTime = (frame: number) => (frame * FFT_HOP) / SAMPLE_RATE - WINDOW_OFFSET * Math.floor(frame / WINDOW_FRAMES);

export const notesToTime = (notes: NoteEvent[]): NoteEventTime[] =>
  notes.map((n) => ({
    pitchMidi: n.pitchMidi,
    amplitude: n.amplitude,
    pitchBends: n.pitchBends,
    startTimeSeconds: frameTime(n.startFrame),
    durationSeconds: frameTime(n.startFrame + n.durationFrames) - frameTime(n.startFrame),
  }));

/**
 * Standard deviation of a note's pitch-bend curve, in semitones (Basic Pitch reports bends in
 * thirds of a semitone). Vibrato and slides make sung notes score far higher than synth or keys.
 */
export function bendActivity(bends: number[] | undefined): number {
  if (!bends || bends.length < 3) return 0;
  const mean = bends.reduce((a, b) => a + b, 0) / bends.length;
  const variance = bends.reduce((a, b) => a + (b - mean) ** 2, 0) / bends.length;
  return Math.round((Math.sqrt(variance) / 3) * 1000) / 1000;
}
