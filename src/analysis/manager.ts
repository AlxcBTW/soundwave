import { loadSongBuffer } from '../audio/songAudio';
import { generateChart } from '../chart/generator';
import type { Chart, Difficulty, Part } from '../chart/types';
import { analysisKey, deleteAnalyses, getAnalysis, putAnalysis } from '../storage/db';
import { ANALYSIS_SAMPLE_RATE, ANALYSIS_VERSION, isAnalysisResult, type AnalysisResult, type AnalysisStep } from './types';
import type { WorkerRequest, WorkerResponse } from './worker';

export interface AnalysisStatus {
  state: 'idle' | 'queued' | 'analyzing' | 'ready' | 'error';
  progress?: number;
  step?: string;
  error?: string;
}

const STEP_LABEL: Record<AnalysisStep, string> = {
  decoding: 'Decoding',
  spectrum: 'Listening',
  separating: 'Separating',
  rhythm: 'Finding the beat',
  harmony: 'Reading chords',
  melody: 'Transcribing',
  finishing: 'Charting',
};

/** Pluggable remote analyzer (the optional ML service). Returns null when unavailable. */
export type RemoteAnalyzer = (songId: string, onProgress: (p: number, label: string) => void) => Promise<AnalysisResult | null>;

type Listener = () => void;

class AnalysisManager {
  private status: Record<string, AnalysisStatus> = {};
  private results = new Map<string, AnalysisResult>();
  private charts = new Map<string, Chart>();
  private queue: string[] = [];
  private running = false;
  private listeners = new Set<Listener>();
  remote: RemoteAnalyzer | null = null;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  snapshot = () => this.status;

  private set(id: string, s: AnalysisStatus) {
    this.status = { ...this.status, [id]: s };
    for (const l of this.listeners) l();
  }

  /** Loads a cached analysis if there is one; otherwise queues the song when `autoQueue` is set. */
  async check(id: string, autoQueue: boolean) {
    if (this.status[id]?.state === 'analyzing' || this.status[id]?.state === 'queued') return;
    const cached = await this.loadCached(id);
    if (cached) this.set(id, { state: 'ready' });
    else if (autoQueue) this.enqueue(id);
    else this.set(id, { state: 'idle' });
  }

  private async loadCached(id: string): Promise<AnalysisResult | undefined> {
    const mem = this.results.get(id);
    if (mem) return mem;
    for (const source of ['ml', 'local']) {
      try {
        const r = await getAnalysis<AnalysisResult>(analysisKey(id, ANALYSIS_VERSION, source));
        if (r && isAnalysisResult(r)) {
          this.results.set(id, r);
          return r;
        }
      } catch {
        /* storage unavailable */
      }
    }
    return undefined;
  }

  enqueue(id: string, force = false) {
    if (force) {
      this.results.delete(id);
      for (const k of [...this.charts.keys()]) if (k.startsWith(`${id}:`)) this.charts.delete(k);
    }
    if (this.queue.includes(id) || this.status[id]?.state === 'analyzing') return;
    this.queue.push(id);
    this.set(id, { state: 'queued' });
    void this.pump();
  }

  forget(id: string) {
    this.queue = this.queue.filter((q) => q !== id);
    this.results.delete(id);
    const { [id]: _, ...rest } = this.status;
    this.status = rest;
    for (const l of this.listeners) l();
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const id = this.queue.shift()!;
      try {
        const result = await this.analyze(id);
        this.results.set(id, result);
        try {
          // One cached result per song: a re-analysis replaces whatever was there.
          await deleteAnalyses(id);
          await putAnalysis(analysisKey(id, ANALYSIS_VERSION, result.source), id, result);
        } catch {
          /* cache is best-effort */
        }
        this.set(id, { state: 'ready' });
      } catch (e) {
        this.set(id, { state: 'error', error: (e as Error).message });
      }
    }
    this.running = false;
  }

  private async analyze(id: string): Promise<AnalysisResult> {
    if (this.remote) {
      try {
        const r = await this.remote(id, (progress, step) => this.set(id, { state: 'analyzing', progress, step }));
        if (r) return r;
      } catch (e) {
        console.warn('remote analysis failed, using in-app analysis', e);
      }
    }
    this.set(id, { state: 'analyzing', progress: 0, step: STEP_LABEL.decoding });
    const buffer = await loadSongBuffer(id);
    const signal = await toAnalysisSignal(buffer);
    return runWorker(signal, (p) => this.set(id, { state: 'analyzing', progress: p.progress, step: STEP_LABEL[p.step] }));
  }

  async analysis(id: string): Promise<AnalysisResult | undefined> {
    return this.loadCached(id);
  }

  async chart(id: string, part: Part, difficulty: Difficulty): Promise<Chart | undefined> {
    const key = `${id}:${part}:${difficulty}`;
    const hit = this.charts.get(key);
    if (hit) return hit;
    const a = await this.loadCached(id);
    if (!a) return undefined;
    const c = generateChart(a, part, difficulty, id);
    this.charts.set(key, c);
    return c;
  }
}

/** Mono, 22.05 kHz copy of the song for analysis. */
async function toAnalysisSignal(buffer: AudioBuffer): Promise<Float32Array> {
  const length = Math.ceil(buffer.duration * ANALYSIS_SAMPLE_RATE);
  const ctx = new OfflineAudioContext(1, length, ANALYSIS_SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice();
}

function runWorker(signal: Float32Array, onProgress: (p: { step: AnalysisStep; progress: number }) => void): Promise<AnalysisResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m.progress);
      else if (m.type === 'log') console.info('[analysis]', m.message);
      else {
        worker.terminate();
        if (m.type === 'done') resolve(m.result);
        else reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Analysis worker crashed'));
    };
    const req: WorkerRequest = {
      type: 'analyze',
      signal,
      modelUrl: new URL(`${import.meta.env.BASE_URL}models/basic-pitch/model.json`, location.href).href,
      useTranscriber: true,
    };
    worker.postMessage(req, [signal.buffer]);
  });
}

export const analysisManager = new AnalysisManager();
