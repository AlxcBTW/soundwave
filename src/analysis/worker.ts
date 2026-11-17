/// <reference lib="webworker" />
import { analyzeSignal } from './pipeline';
import type { AnalysisProgress, AnalysisResult, PartLines, StemName, StemNotes } from './types';

export type WorkerRequest = {
  type: 'analyze';
  signal: Float32Array;
  lines?: PartLines;
  drumSignal?: Float32Array;
  stems?: Partial<Record<StemName, Float32Array>>;
  stemNotes?: StemNotes;
};

export type WorkerResponse =
  | { type: 'progress'; progress: AnalysisProgress }
  | { type: 'log'; message: string }
  | { type: 'done'; result: AnalysisResult }
  | { type: 'error'; message: string };

const post = (m: WorkerResponse) => (self as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
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
    });
    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'error', message: (err as Error).message || String(err) });
  }
};
