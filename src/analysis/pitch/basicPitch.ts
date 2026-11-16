import type { PitchedNote } from '../types';

/**
 * Polyphonic note transcription with Spotify's Basic Pitch model (TF.js, Apache-2.0).
 * Loaded lazily so the main bundle stays small. Expects mono audio at 22050 Hz.
 */
export async function transcribe(
  audio: Float32Array,
  /** Model URL, or a TF.js IO handler (used by offline tooling to load from disk). */
  modelUrl: string | object,
  onProgress: (p: number) => void,
  timeBudgetMs: number,
): Promise<{ notes: PitchedNote[]; backend: string }> {
  // TF.js 3 reads the bare global `window` (`if (!window ...)`), which throws inside workers.
  // Declaring it as undefined keeps every `typeof window` check unchanged but stops the throw.
  const g = globalThis as { window?: unknown };
  if (!('window' in g)) g.window = undefined;
  const tf = await import('@tensorflow/tfjs');
  const bp = await import('@spotify/basic-pitch');

  let backend = 'cpu';
  try {
    if (await tf.setBackend('webgl')) backend = 'webgl';
  } catch {
    /* fall through to cpu */
  }
  if (backend !== 'webgl') await tf.setBackend('cpu');
  await tf.ready();

  const model = new bp.BasicPitch(tf.loadGraphModel(modelUrl as Parameters<typeof tf.loadGraphModel>[0]));
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  const started = performance.now();
  let aborted = false;

  await model.evaluateModel(
    audio,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p) => {
      onProgress(p);
      // Rough projection: give up early if this machine would take too long.
      const elapsed = performance.now() - started;
      if (!aborted && p > 0.05 && elapsed / p > timeBudgetMs) {
        aborted = true;
        throw new Error('transcription-too-slow');
      }
    },
  );

  const events = bp.noteFramesToTime(
    bp.addPitchBendsToNoteEvents(contours, bp.outputToNotesPoly(frames, onsets, 0.45, 0.3, 8, true, null, null, true, 11)),
  );
  const maxAmp = events.reduce((m, e) => Math.max(m, e.amplitude), 0) || 1;
  const notes = events
    .map((e) => ({
      t: e.startTimeSeconds,
      dur: e.durationSeconds,
      midi: e.pitchMidi,
      strength: Math.min(1, e.amplitude / maxAmp),
      bend: bendActivity(e.pitchBends),
    }))
    .sort((a, b) => a.t - b.t);
  return { notes, backend };
}

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
