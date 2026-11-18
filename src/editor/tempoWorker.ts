/// <reference lib="webworker" />
import type { GridSpec } from './grid';
import { hearBeats, steadyGrid, type HeardBeats } from './tempo';

export type TempoRequest = { signal: Float32Array; sampleRate: number };
export type TempoResponse = { ok: true; heard: HeardBeats; steady?: Extract<GridSpec, { kind: 'fixed' }> } | { ok: false; message: string };

self.onmessage = (e: MessageEvent<TempoRequest>) => {
  const post = (m: TempoResponse) => (self as DedicatedWorkerGlobalScope).postMessage(m);
  try {
    const heard = hearBeats(e.data.signal, e.data.sampleRate);
    post({ ok: true, heard, steady: heard.beats.length >= 8 ? steadyGrid(e.data.signal, e.data.sampleRate, heard) : undefined });
  } catch (err) {
    post({ ok: false, message: (err as Error).message || String(err) });
  }
};
