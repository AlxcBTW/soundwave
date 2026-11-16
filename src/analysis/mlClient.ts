import { getAudio, getSong } from '../storage/db';
import { isAnalysisResult, type AnalysisResult } from './types';
import type { RemoteAnalyzer } from './manager';

export interface MlHealth {
  ok: boolean;
  engines?: { demucs: boolean; basicPitch: boolean };
  device?: string;
}

const trimUrl = (url: string) => url.replace(/\/+$/, '');

export async function checkHealth(url: string, timeoutMs = 1500): Promise<MlHealth | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${trimUrl(url)}/health`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as MlHealth;
    return body?.ok ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Analyzer backed by the local ML service. Returns null (→ in-app analysis) when the service is down. */
export function mlAnalyzer(url: string): RemoteAnalyzer {
  const base = trimUrl(url);
  return async (songId, onProgress) => {
    if (!(await checkHealth(base))) return null;
    const [blob, meta] = await Promise.all([getAudio(songId), getSong(songId)]);
    if (!blob) return null;
    onProgress(0, 'Uploading');
    const form = new FormData();
    form.append('file', blob, meta?.fileName ?? 'song');
    const res = await fetch(`${base}/jobs`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`analysis service rejected the upload (${res.status})`);
    const { id } = (await res.json()) as { id: string };
    let failures = 0;
    for (;;) {
      await sleep(1000);
      let job: { state: string; progress: number; step: string; result?: unknown; error?: string };
      try {
        const r = await fetch(`${base}/jobs/${id}`);
        if (!r.ok) throw new Error(String(r.status));
        job = await r.json();
        failures = 0;
      } catch (e) {
        if (++failures > 5) throw new Error(`lost contact with the analysis service (${(e as Error).message})`);
        continue;
      }
      if (job.state === 'error') throw new Error(job.error ?? 'analysis service failed');
      if (job.state === 'done') {
        if (!isAnalysisResult(job.result)) throw new Error('analysis service returned an invalid result');
        return job.result as AnalysisResult;
      }
      onProgress(job.progress ?? 0, job.step ?? 'Analyzing');
    }
  };
}
