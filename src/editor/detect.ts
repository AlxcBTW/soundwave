/**
 * The grid a song gets when it is started from scratch: its beats as heard, and the steady tempo
 * closest to them, which is what the editor starts on (a number is easier to correct than a list).
 */
import { beatModelUrl } from '../analysis/beat/listen';
import { toAnalysisSignal } from '../analysis/manager';
import { analysisDevice } from '../analysis/separation/support';
import { serveWorkerFetch } from '../app/workerFetch';
import { ANALYSIS_SAMPLE_RATE } from '../analysis/types';
import type { GridSpec } from './grid';
import type { HeardBeats } from './tempo';
import type { TempoRequest, TempoResponse } from './tempoWorker';

export interface DetectedGrid {
  grid: Extract<GridSpec, { kind: 'fixed' }>;
  /** The beats as heard, when any were. */
  tracked?: HeardBeats;
}

/** What a song gets when nothing can be heard in it. */
export const DEFAULT_GRID: Extract<GridSpec, { kind: 'fixed' }> = { kind: 'fixed', bpm: 120, offset: 0, beatsPerBar: 4 };

async function listen(signal: Float32Array): Promise<{ heard: HeardBeats; steady?: DetectedGrid['grid'] }> {
  // The beat model listens where a song can be analyzed. A phone would take a minute over it, where
  // the beat tracker takes seconds, so there the tracker listens as before.
  const device = await analysisDevice();
  const beatModel = device === 'none' ? undefined : { url: beatModelUrl(), device };
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./tempoWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<TempoResponse>) => {
      // The worker's fetches, where it cannot make them itself (see app/workerFetch).
      if (serveWorkerFetch(worker, e.data)) return;
      worker.terminate();
      if (e.data.ok) resolve({ heard: e.data.heard, steady: e.data.steady });
      else reject(new Error(e.data.message));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'The tempo could not be worked out.'));
    };
    const req: TempoRequest = { signal, sampleRate: ANALYSIS_SAMPLE_RATE, beatModel };
    worker.postMessage(req, [signal.buffer]);
  });
}

/** Listens for the song's beats. A song with no beat to find gets 120 BPM from its start. */
export async function detectGrid(buffer: AudioBuffer): Promise<DetectedGrid> {
  try {
    const { heard, steady } = await listen(await toAnalysisSignal(buffer));
    if (!steady) return { grid: DEFAULT_GRID };
    return { grid: steady, tracked: heard };
  } catch (e) {
    console.warn('could not find the tempo', e);
    return { grid: DEFAULT_GRID };
  }
}
