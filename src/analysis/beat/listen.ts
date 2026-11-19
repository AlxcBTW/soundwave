import type * as Ort from 'onnxruntime-web/webgpu';
import { loadRuntime } from '../runtime';
import { openBeatModel } from './model';
import { beatsAndBars, type Beats } from './track';

/** Where the beat model is and what to run it on. */
export interface BeatModelAt {
  url: string;
  device: 'gpu' | 'cpu';
}

/** On the page: the address of the beat model, which is served with the game. */
export const beatModelUrl = () => new URL(`${import.meta.env.BASE_URL}models/beat-this/small0.onnx`, location.href).href;

/**
 * In a worker: a song's beats and bar starts from the beat model. The runtime is got ready and the
 * model opened for this one song, and released after it. `audio` is mono at 22.05 kHz.
 */
export async function listenForBeats(
  ort: typeof Ort,
  at: BeatModelAt,
  audio: Float32Array,
  onProgress: (p: number) => void,
  log: (message: string) => void,
): Promise<Beats> {
  const started = performance.now();
  await loadRuntime(ort, at.device);
  const model = await openBeatModel(ort, at.url, at.device, log);
  try {
    const found = await beatsAndBars(audio, model, onProgress);
    log(
      `beat model on ${model.device}: ${found.beats.length} beats, ${found.downbeats.length} bars in ${Math.round(performance.now() - started)} ms`,
    );
    return found;
  } finally {
    await model.release();
  }
}
