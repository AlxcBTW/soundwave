/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import { listenForBeats, type BeatModelAt } from '../analysis/beat/listen';
import { proxyWorkerFetch } from '../app/workerFetch';
import type { GridSpec } from './grid';
import { heardByModel, hearBeats, steadyGrid, type HeardBeats } from './tempo';

export type TempoRequest = {
  signal: Float32Array;
  sampleRate: number;
  /** Where the beat model is and what to run it on; without it the beat tracker listens. */
  beatModel?: BeatModelAt;
};
export type TempoResponse = { ok: true; heard: HeardBeats; steady?: Extract<GridSpec, { kind: 'fixed' }> } | { ok: false; message: string };

// Where a worker cannot fetch the game's files itself (the macOS app), the page fetches them.
const fetched = proxyWorkerFetch((m) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m));

/** The beat model's beats, or nothing when it cannot be run or hears too little. */
async function byModel(req: TempoRequest): Promise<HeardBeats | undefined> {
  if (!req.beatModel) return undefined;
  try {
    return heardByModel(
      await listenForBeats(
        ort,
        req.beatModel,
        req.signal,
        () => {},
        (message) => console.info('[tempo]', message),
      ),
    );
  } catch (err) {
    console.info('[tempo]', `the beat model failed (${(err as Error).message || String(err)}); using the beat tracker`);
    return undefined;
  }
}

self.onmessage = async (e: MessageEvent<TempoRequest>) => {
  if (fetched(e.data)) return;
  const post = (m: TempoResponse) => (self as DedicatedWorkerGlobalScope).postMessage(m);
  try {
    const heard = (await byModel(e.data)) ?? hearBeats(e.data.signal, e.data.sampleRate);
    post({ ok: true, heard, steady: heard.beats.length >= 8 ? steadyGrid(e.data.signal, e.data.sampleRate, heard) : undefined });
  } catch (err) {
    post({ ok: false, message: (err as Error).message || String(err) });
  }
};
