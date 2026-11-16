/// <reference lib="webworker" />
import { analyzeSignal } from './pipeline';
import { transcribe } from './pitch/basicPitch';
import type { AnalysisProgress, AnalysisResult, PartLines, PitchedNote } from './types';

export type WorkerRequest = {
  type: 'analyze';
  signal: Float32Array;
  modelUrl: string;
  useTranscriber: boolean;
  lines?: PartLines;
  drumSignal?: Float32Array;
};

export type WorkerResponse =
  | { type: 'progress'; progress: AnalysisProgress }
  | { type: 'log'; message: string }
  | { type: 'done'; result: AnalysisResult }
  | { type: 'error'; message: string };

const post = (m: WorkerResponse) => (self as DedicatedWorkerGlobalScope).postMessage(m);

/** Errors thrown asynchronously inside libraries (timers, backends) never reach our awaits. */
let asyncFailure: ((e: unknown) => void) | null = null;
self.addEventListener('unhandledrejection', (e) => {
  post({ type: 'log', message: `unhandled: ${(e.reason as Error)?.stack ?? e.reason}` });
  e.preventDefault();
  asyncFailure?.(e.reason);
});

/** Runs the neural transcriber, failing fast if it throws asynchronously or stops making progress. */
function guardedTranscribe(audio: Float32Array, modelUrl: string, onProgress: (p: number) => void, budgetMs: number): Promise<PitchedNote[]> {
  return new Promise((resolve, reject) => {
    let lastProgress = performance.now();
    const STALL_MS = 45_000;
    const watchdog = setInterval(() => {
      if (performance.now() - lastProgress > STALL_MS) finish(new Error('transcriber stalled'));
    }, 2000);
    const finish = (err: unknown, notes?: PitchedNote[]) => {
      clearInterval(watchdog);
      asyncFailure = null;
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else resolve(notes!);
    };
    asyncFailure = (e) => finish(e);
    const started = performance.now();
    transcribe(
      audio,
      modelUrl,
      (p) => {
        lastProgress = performance.now();
        onProgress(p);
      },
      budgetMs,
    ).then(
      ({ notes, backend }) => {
        post({ type: 'log', message: `basic-pitch on ${backend} took ${Math.round(performance.now() - started)} ms` });
        finish(null, notes);
      },
      (e) => finish(e),
    );
  });
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.type !== 'analyze') return;
  try {
    const duration = req.signal.length / 22050;
    const result = await analyzeSignal(req.signal, {
      onProgress: (progress) => post({ type: 'progress', progress }),
      onLog: (message) => post({ type: 'log', message }),
      lines: req.lines,
      drumSignal: req.drumSignal,
      transcriber: req.useTranscriber && !req.lines
        ? (audio, onProgress) => guardedTranscribe(audio, req.modelUrl, onProgress, Math.max(90_000, duration * 1500))
        : undefined,
    });
    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'error', message: (err as Error).message || String(err) });
  }
};
