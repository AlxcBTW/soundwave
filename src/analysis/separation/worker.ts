/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import { transcribeOnnx } from '../pitch/basicPitchOnnx';
import type { StemName, StemNotes } from '../types';
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

/** The transcription model (Basic Pitch, 230 KB) on the same device as the stem model. */
async function openPitchSession(url: string, device: 'gpu' | 'cpu'): Promise<ort.InferenceSession> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  try {
    return await ort.InferenceSession.create(bytes, { executionProviders: [device === 'gpu' ? 'webgpu' : 'wasm'] });
  } catch (err) {
    if (device !== 'gpu') throw err;
    post({ type: 'log', message: `the graphics card could not load the transcription model (${(err as Error).message}); using the processor` });
    return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  }
}

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

self.onmessage = async (e: MessageEvent<SeparationRequest>) => {
  const req = e.data;
  if (req.type !== 'separate') return;
  try {
    // The runtime's script and WebAssembly file are served next to the app (public/ort). The script
    // is handed over as a blob, because the runtime starts its threads from the script's own address:
    // from a blob that needs no request, and a request for an app file made by a thread of a worker
    // is never answered in the desktop app's window.
    const base = new URL(`${import.meta.env.BASE_URL}ort/`, self.location.href).href;
    const script = await (await fetch(`${base}ort-wasm-simd-threaded.asyncify.mjs`)).text();
    ort.env.wasm.wasmPaths = {
      mjs: URL.createObjectURL(new Blob([script], { type: 'text/javascript' })),
      wasm: `${base}ort-wasm-simd-threaded.asyncify.wasm`,
    };
    // A graphics card does the arithmetic itself; threads are for the processor path.
    if (req.device === 'gpu') ort.env.wasm.numThreads = 1;
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

    // Separation is nearly all of the work, on a graphics card and on a processor alike.
    const share = 0.9;
    const started = performance.now();
    const full = await separate(req.left, req.right, runner(session), (p) => post({ type: 'progress', progress: p * share, step: 'Separating stems' }));
    await session.release();
    post({ type: 'log', message: `separated ${(req.left.length / 44100).toFixed(0)} s in ${Math.round(performance.now() - started)} ms` });

    const stems = {} as Record<StemName, Float32Array>;
    MODEL_STEMS.forEach((name, i) => (stems[name] = halve(full[i])));
    const notes = {} as StemNotes;
    const pitched = ['bass', 'vocals', 'other'] as const;
    const transcriber = await openPitchSession(req.pitchModelUrl, device);
    for (const [i, name] of pitched.entries()) {
      const at = share + ((1 - share) * i) / pitched.length;
      const label = name === 'other' ? 'Transcribing instruments' : `Transcribing ${name}`;
      post({ type: 'progress', progress: at, step: label });
      const t = await transcribeOnnx(ort, transcriber, stems[name], (p) => post({ type: 'progress', progress: at + ((1 - share) * p) / pitched.length, step: label }));
      notes[name] = t.notes;
      post({ type: 'log', message: `transcribed ${name} on ${device} in ${Math.round(t.modelMs + t.notesMs)} ms (${Math.round(t.notesMs)} ms of it decoding notes)` });
    }
    await transcriber.release();
    post({ type: 'done', stems, notes, device }, Object.values(stems).map((s) => s.buffer));
  } catch (err) {
    post({ type: 'error', message: (err as Error).message || String(err) });
  }
};
