/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import { proxyWorkerFetch } from '../app/workerFetch';
import { listenForBeats, type BeatModelAt } from './beat/listen';
import { analyzeSignal, type BeatTracker } from './pipeline';
import type { AnalysisProgress, AnalysisResult, PartLines, StemName, StemNotes } from './types';

export type WorkerRequest = {
  type: 'analyze';
  signal: Float32Array;
  lines?: PartLines;
  drumSignal?: Float32Array;
  stems?: Partial<Record<StemName, Float32Array>>;
  stemNotes?: StemNotes;
  /** Where the beat model is and what to run it on; without it the beat tracker finds the grid. */
  beatModel?: BeatModelAt;
};

export type WorkerResponse =
  | { type: 'progress'; progress: AnalysisProgress }
  | { type: 'log'; message: string }
  | { type: 'done'; result: AnalysisResult }
  | { type: 'error'; message: string };

const post = (m: WorkerResponse) => (self as DedicatedWorkerGlobalScope).postMessage(m);

/** The song's beats and bar starts from the beat model. */
const beatTracker =
  (at: BeatModelAt): BeatTracker =>
  (audio, onProgress) =>
    listenForBeats(ort, at, audio, onProgress, (message) => post({ type: 'log', message }));

// Where a worker cannot fetch the game's files itself (the macOS app), the page fetches them.
const fetched = proxyWorkerFetch((m) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m));

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  if (fetched(e.data)) return;
  const req = e.data;
  if (req.type !== 'analyze') return;
  try {
    const result = await analyzeSignal(req.signal, {
      onProgress: (progress) => post({ type: 'progress', progress }),
      onLog: (message) => post({ type: 'log', message }),
      lines: req.lines,
      drumSignal: req.drumSignal,
      stems: req.stems,
      stemNotes: req.stemNotes,
      beatTracker: req.beatModel && beatTracker(req.beatModel),
    });
    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'error', message: (err as Error).message || String(err) });
  }
};
