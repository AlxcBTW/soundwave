/**
 * Vocal notes standing alone in a long stretch without singing: are they real (charted in a
 * reference) or strays from bleed and breaths? Lists each with what the vocal stem looks like
 * around it (dev tooling).
 *
 *   SONGS=demo:ref-demo,demo2:ref-demo2,givenchy pnpm vitest run --config vitest.dev.config.ts isolatedVocals
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import type { AnalysisResult } from '../../src/analysis/types';

const dir = join(process.cwd(), 'local-audio');
const GAP = Number(process.env.GAP ?? 1.5);
const MAX_CLUSTER = Number(process.env.MAX_CLUSTER ?? 3);

function wavMono(path: string): { x: Float32Array; sr: number } {
  const b = readFileSync(path);
  const ch = b.readUInt16LE(22);
  const sr = b.readUInt32LE(24);
  let at = 12;
  while (b.toString('ascii', at, at + 4) !== 'data') at += 8 + b.readUInt32LE(at + 4);
  const n = b.readUInt32LE(at + 4) / 2 / ch;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += b.readInt16LE(at + 8 + (i * ch + c) * 2);
    x[i] = s / ch / 32768;
  }
  return { x, sr };
}

it('isolated vocal notes', () => {
  const out: string[] = [];
  for (const spec of (process.env.SONGS ?? 'demo:ref-demo,demo2:ref-demo2,givenchy,rivers,alive,layall,sna').split(',')) {
    const [song, ref] = spec.split(':');
    const a = JSON.parse(readFileSync(join(dir, `${song}.hybrid.json`), 'utf8')) as AnalysisResult;
    const { x, sr } = wavMono(join(dir, `${song}.ml.vocals.wav`));
    const rms = (t0: number, t1: number) => {
      let s = 0;
      const i0 = Math.max(0, Math.floor(t0 * sr));
      const i1 = Math.min(x.length, Math.floor(t1 * sr));
      for (let i = i0; i < i1; i++) s += x[i] * x[i];
      return Math.sqrt(s / Math.max(1, i1 - i0));
    };
    // The stem's loud reference: 95th percentile of 100 ms windows.
    const wins: number[] = [];
    for (let t = 0; t < a.duration; t += 0.1) wins.push(rms(t, t + 0.1));
    const ref95 = [...wins].sort((p, q) => p - q)[Math.floor(wins.length * 0.95)] || 1;
    let tiles: number[] | undefined;
    let off = 0;
    if (ref && existsSync(join(dir, ref, 'notes.json'))) {
      tiles = (JSON.parse(readFileSync(join(dir, ref, 'notes.json'), 'utf8')) as { notes: { t: number }[] }).notes.map((n) => n.t);
      off = Number((readFileSync(join(dir, `${song}.video-compare.txt`), 'utf8').match(/offset (-?[\d.]+)s/) ?? [])[1] ?? 0);
    }
    const v = a.vocals;
    let real = 0;
    let stray = 0;
    out.push(`== ${song}: ${v.length} vocal notes; clusters of up to ${MAX_CLUSTER} notes with ${GAP}s of silence around${tiles ? '' : ' (no reference)'}`);
    // Clusters: runs of notes whose onsets are closer than GAP to the previous note's end.
    const clusters: number[][] = [];
    v.forEach((n, i) => {
      const prev = v[i - 1];
      if (prev && n.t - (prev.t + prev.dur) < GAP) clusters[clusters.length - 1].push(i);
      else clusters.push([i]);
    });
    for (const c of clusters) {
      if (c.length > MAX_CLUSTER) continue;
      for (const i of c) {
        const n = v[i];
        const level = rms(n.t, n.t + Math.max(0.1, n.dur)) / ref95;
        const around = (rms(n.t - 1.5, n.t - 0.3) + rms(n.t + n.dur + 0.3, n.t + n.dur + 1.5)) / 2 / ref95;
        const charted = tiles ? tiles.some((t) => Math.abs(t + off - n.t) < 0.07) : undefined;
        if (charted === true) real++;
        if (charted === false) stray++;
        out.push(`  ${n.t.toFixed(2)}s dur ${n.dur.toFixed(2)} midi ${n.midi} str ${n.strength.toFixed(2)} bend ${(n.bend ?? 0).toFixed(2)} level ${level.toFixed(2)} around ${around.toFixed(2)} cluster ${c.length}${charted === undefined ? '' : charted ? ' CHARTED' : ' stray'}`);
      }
    }
    if (tiles) out.push(`  -> ${real} charted, ${stray} not charted`);
  }
  writeFileSync(join(dir, 'isolated-vocals.txt'), out.join('\n'));
});
