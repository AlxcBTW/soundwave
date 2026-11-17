/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import { transcribe } from '../pitch/basicPitch';
import { ANALYSIS_SAMPLE_RATE, type PitchedNote, type StemName, type StemNotes } from '../types';
import type { LoadedModel } from './model';
import { halve } from './resample';
import { MODEL_STEMS, separate, type SegmentModel } from './separate';
import { BINS, FRAMES, SEGMENT } from './stft';

export type SeparationRequest = {
  type: 'separate';
  /** The song in stereo at 44.1 kHz. */
  left: Float32Array;
  right: Float32Array;
  model: LoadedModel;
  device: 'gpu' | 'cpu';
  pitchModelUrl: string;
};

export type SeparationResponse =
  | { type: 'progress'; progress: number; step: string }
  | { type: 'log'; message: string }
  | { type: 'done'; stems: Record<StemName, Float32Array>; notes: StemNotes; device: 'gpu' | 'cpu' }
  | { type: 'error'; message: string };

const post = (m: SeparationResponse, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(m, transfer);

/** Errors thrown asynchronously inside the libraries (timers, backends) never reach an await. */
let asyncFailure: ((e: unknown) => void) | null = null;
self.addEventListener('unhandledrejection', (e) => {
  post({ type: 'log', message: `unhandled: ${(e.reason as Error)?.stack ?? e.reason}` });
  e.preventDefault();
  asyncFailure?.(e.reason);
});

async function openSession(model: LoadedModel, provider: 'webgpu' | 'wasm'): Promise<ort.InferenceSession> {
  const entry = model.files.find((f) => f.name === model.entry)!;
  return ort.InferenceSession.create(new Uint8Array(entry.data), {
    executionProviders: [provider],
    externalData: model.files.filter((f) => f !== entry).map((f) => ({ path: f.name, data: new Uint8Array(f.data) })),
  });
}

function runner(session: ort.InferenceSession): SegmentModel {
  return {
    async run(x, xt) {
      const out = await session.run({
        x: new ort.Tensor('float32', x, [1, 4, BINS, FRAMES]),
        xt: new ort.Tensor('float32', xt, [1, 2, SEGMENT]),
      });
      const result = { x: (await out.x_out.getData()) as Float32Array, xt: (await out.xt_out.getData()) as Float32Array };
      out.x_out.dispose();
      out.xt_out.dispose();
      return result;
    },
  };
}

/** Transcribes one stem, giving up if the transcriber throws out of sight or stops making progress. */
function transcribeStem(audio: Float32Array, modelUrl: string, onProgress: (p: number) => void): Promise<PitchedNote[]> {
  return new Promise((resolve, reject) => {
    let last = performance.now();
    const watchdog = setInterval(() => performance.now() - last > 45_000 && finish(new Error('the transcriber stalled')), 2000);
    const finish = (err: unknown, notes?: PitchedNote[]) => {
      clearInterval(watchdog);
      asyncFailure = null;
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else resolve(notes!);
    };
    asyncFailure = (e) => finish(e);
    const started = performance.now();
    const seconds = audio.length / ANALYSIS_SAMPLE_RATE;
    transcribe(
      audio,
      modelUrl,
      (p) => {
        last = performance.now();
        onProgress(p);
      },
      Math.max(180_000, seconds * 3000),
    ).then(
      ({ notes, backend }) => {
        post({ type: 'log', message: `basic-pitch on ${backend} took ${Math.round(performance.now() - started)} ms` });
        finish(null, notes);
      },
      (e) => finish(e),
    );
  });
}

self.onmessage = async (e: MessageEvent<SeparationRequest>) => {
  const req = e.data;
  if (req.type !== 'separate') return;
  try {
    // The runtime's script and WebAssembly file are served next to the app (public/ort).
    ort.env.wasm.wasmPaths = new URL(`${import.meta.env.BASE_URL}ort/`, self.location.href).href;
    ort.env.logLevel = 'error';
    post({ type: 'progress', progress: 0, step: 'Loading the stem model' });
    let device = req.device;
    let session: ort.InferenceSession;
    const opened = performance.now();
    try {
      session = await openSession(req.model, device === 'gpu' ? 'webgpu' : 'wasm');
    } catch (err) {
      if (device !== 'gpu') throw err;
      post({ type: 'log', message: `the graphics card could not load the stem model (${(err as Error).message}); using the processor` });
      device = 'cpu';
      session = await openSession(req.model, 'wasm');
    }
    post({ type: 'log', message: `stem model on ${device} loaded in ${Math.round(performance.now() - opened)} ms` });

    // Separation is nearly all of the work on a processor and most of it on a graphics card.
    const share = 0.8;
    const started = performance.now();
    const full = await separate(req.left, req.right, runner(session), (p) => post({ type: 'progress', progress: p * share, step: 'Separating stems' }));
    await session.release();
    post({ type: 'log', message: `separated ${(req.left.length / 44100).toFixed(0)} s in ${Math.round(performance.now() - started)} ms` });

    const stems = {} as Record<StemName, Float32Array>;
    MODEL_STEMS.forEach((name, i) => (stems[name] = halve(full[i])));
    const notes = {} as StemNotes;
    const pitched = ['bass', 'vocals', 'other'] as const;
    for (const [i, name] of pitched.entries()) {
      const at = share + ((1 - share) * i) / pitched.length;
      const label = name === 'other' ? 'Transcribing instruments' : `Transcribing ${name}`;
      post({ type: 'progress', progress: at, step: label });
      notes[name] = await transcribeStem(stems[name], req.pitchModelUrl, (p) => post({ type: 'progress', progress: at + ((1 - share) * p) / pitched.length, step: label }));
    }
    post({ type: 'done', stems, notes, device }, Object.values(stems).map((s) => s.buffer));
  } catch (err) {
    post({ type: 'error', message: (err as Error).message || String(err) });
  }
};
