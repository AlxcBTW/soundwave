import { loadSongBuffer } from '../audio/songAudio';
import { encodeWav } from '../audio/wav';
import { getAudio } from '../storage/db';
import { isAnalysisResult, STEM_NAMES, type AnalysisResult, type StemName } from './types';
import type { RemoteAnalyzer, RemoteResult } from './manager';

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
  return async (songId, onProgress, signal) => {
    if (!(await checkHealth(base))) return null;
    if (!(await getAudio(songId))) return null;
    onProgress(0, 'Uploading');
    // Upload what the app decoded, as WAV: files are often not what their extension says (an
    // MP4/AAC download named .mp3), and the browser reads more formats than the service does.
    const form = new FormData();
    form.append('file', encodeWav(await loadSongBuffer(songId)), 'song.wav');
    const res = await fetch(`${base}/jobs`, { method: 'POST', body: form, signal });
    if (!res.ok) throw new Error(`analysis service rejected the upload (${res.status})`);
    const { id } = (await res.json()) as { id: string };
    let failures = 0;
    for (;;) {
      await sleep(1000);
      if (signal.aborted) throw new DOMException('analysis cancelled', 'AbortError');
      let job: { state: string; progress: number; step: string; result?: unknown; error?: string };
      try {
        const r = await fetch(`${base}/jobs/${id}`, { signal });
        if (!r.ok) throw new Error(String(r.status));
        job = await r.json();
        failures = 0;
      } catch (e) {
        if (signal.aborted) throw e;
        if (++failures > 5) throw new Error(`lost contact with the analysis service (${(e as Error).message})`);
        continue;
      }
      if (job.state === 'error') throw new Error(job.error ?? 'analysis service failed');
      if (job.state === 'done') {
        if (!isAnalysisResult(job.result)) throw new Error('analysis service returned an invalid result');
        const out: RemoteResult = { result: job.result as AnalysisResult, stems: {} };
        const names = ((job.result as { stems?: string[] }).stems ?? []).filter((n): n is StemName => STEM_NAMES.includes(n as StemName));
        for (const name of names) {
          onProgress(1, `Downloading ${name}`);
          const stem = await fetch(`${base}/jobs/${id}/stems/${name}.wav`, { signal });
          if (stem.ok) out.stems[name] = await stem.arrayBuffer();
        }
        return out;
      }
      onProgress(job.progress ?? 0, job.step ?? 'Analyzing');
    }
  };
}
