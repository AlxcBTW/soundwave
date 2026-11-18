/**
 * Where does the vocal line put notes? Per window: vocal stem loudness, how much pitched singing
 * the transcriber found, and our vocal notes (dev tooling for spotting notes without singing).
 *
 *   SONG=givenchy pnpm vitest run --config vitest.dev.config.ts vocalWindows
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import type { AnalysisResult, StemNotes } from '../../src/analysis/types';

const song = process.env.SONG ?? 'givenchy';
const dir = join(process.cwd(), 'local-audio');
const WIN = Number(process.env.WIN ?? 2);

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

it(`vocal windows ${song}`, () => {
  const a = JSON.parse(readFileSync(join(dir, `${song}.hybrid.json`), 'utf8')) as AnalysisResult;
  const ml = JSON.parse(readFileSync(join(dir, `${song}.ml.json`), 'utf8')) as { stemNotes?: StemNotes };
  const voiced = (ml.stemNotes?.vocals ?? []).filter((n) => n.strength >= 0.15 && n.midi >= 40 && n.midi <= 88);
  const { x, sr } = wavMono(join(dir, `${song}.ml.vocals.wav`));
  const rms: number[] = [];
  for (let t = 0; t < a.duration; t += WIN) {
    let s = 0;
    const i0 = Math.floor(t * sr);
    const i1 = Math.min(x.length, Math.floor((t + WIN) * sr));
    for (let i = i0; i < i1; i++) s += x[i] * x[i];
    rms.push(Math.sqrt(s / Math.max(1, i1 - i0)));
  }
  const ref = [...rms].sort((p, q) => p - q)[Math.floor(rms.length * 0.95)];
  const prev = process.env.PREV ? (JSON.parse(readFileSync(join(dir, process.env.PREV), 'utf8')) as AnalysisResult).vocals : undefined;
  const out = ['t     vocalLvl voicedSec ours' + (prev ? ' prev' : '')];
  rms.forEach((r, k) => {
    const t0 = k * WIN;
    const t1 = t0 + WIN;
    const vs = voiced.reduce((s, n) => s + Math.max(0, Math.min(t1, n.t + n.dur) - Math.max(t0, n.t)), 0);
    const ours = a.vocals.filter((n) => n.t >= t0 && n.t < t1).length;
    const p = prev?.filter((n) => n.t >= t0 && n.t < t1).length;
    out.push(`${t0.toFixed(0).padStart(4)}  ${(r / ref).toFixed(2).padStart(6)}  ${vs.toFixed(2).padStart(6)}  ${String(ours).padStart(4)}${prev ? String(p).padStart(5) : ''}`);
  });
  writeFileSync(join(dir, `${song}.vocal-windows.txt`), out.join('\n'));
});
