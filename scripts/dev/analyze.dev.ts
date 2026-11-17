/**
 * Offline analysis harness for tuning, run with `npm run dev:analyze`.
 *
 *   SONG=rivers npm run dev:analyze
 *
 * Expects `local-audio/<SONG>.f32`: mono float32 at 22050 Hz. One way to make it:
 *   ml-service/.venv/Scripts/python -c "import librosa,numpy as np; y,_=librosa.load('in.flac',sr=22050,mono=True); y.astype(np.float32).tofile('local-audio/x.f32')"
 *
 * The Basic Pitch transcription is cached in `local-audio/<SONG>.notes.json`, so later runs only
 * redo the DSP analysis and chart generation. `local-audio/` is gitignored.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { analyzeSignal } from '../../src/analysis/pipeline';
import { transcribe } from '../../src/analysis/pitch/basicPitch';
import type { AnalysisResult, PitchedNote, StemNotes } from '../../src/analysis/types';
import { generateChart } from '../../src/chart/generator';
import { DIFFICULTIES, PARTS } from '../../src/chart/types';

const song = process.env.SONG ?? 'rivers';
const dir = join(process.cwd(), 'local-audio');
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nm = (m: number) => NAMES[m % 12] + (Math.floor(m / 12) - 1);

function modelHandler() {
  const base = join(process.cwd(), 'models', 'basic-pitch-tfjs');
  const json = JSON.parse(readFileSync(join(base, 'model.json'), 'utf8'));
  const buffers = json.weightsManifest.flatMap((g: { paths: string[] }) => g.paths.map((p) => readFileSync(join(base, p))));
  const all = Buffer.concat(buffers);
  return {
    load: async () => ({
      modelTopology: json.modelTopology,
      format: json.format,
      generatedBy: json.generatedBy,
      convertedBy: json.convertedBy,
      weightSpecs: json.weightsManifest.flatMap((g: { weights: unknown[] }) => g.weights),
      weightData: all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength),
      userDefinedMetadata: json.userDefinedMetadata,
    }),
  };
}

it(`analyze ${song}`, async () => {
  // ANALYSIS=ml reports on a result saved from the ML service (local-audio/<song>.ml.json).
  if (process.env.ANALYSIS === 'ml') return report(JSON.parse(readFileSync(join(dir, `${song}.ml.json`), 'utf8')), `${song}.ml`);
  const raw = readFileSync(join(dir, `${song}.f32`));
  const signal = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  // ANALYSIS=hybrid mirrors the app with the ML service: lines from <song>.ml.json, drums from
  // <song>.ml.drums.wav, beat grid and structure from the in-app pipeline.
  if (process.env.ANALYSIS === 'hybrid') {
    const ml = JSON.parse(readFileSync(join(dir, `${song}.ml.json`), 'utf8')) as AnalysisResult;
    const drumPath = join(dir, `${song}.ml.drums.wav`);
    const drumSignal = existsSync(drumPath) ? readWav16(drumPath, signal.length) : undefined;
    const stem = (n: string) => (existsSync(join(dir, `${song}.ml.${n}.wav`)) ? readWav16(join(dir, `${song}.ml.${n}.wav`), signal.length) : undefined);
    const stemNotes = (ml as { stemNotes?: StemNotes }).stemNotes;
    const a = await analyzeSignal(signal, {
      lines: { bass: ml.bass, lead: ml.lead, vocals: ml.vocals },
      drumSignal,
      stems: { bass: stem('bass'), vocals: stem('vocals'), other: stem('other') },
      stemNotes: process.env.STEM_LINES === '0' ? undefined : stemNotes,
      onLog: (m) => console.log(m),
    });
    writeFileSync(join(dir, `${song}.hybrid.json`), JSON.stringify(a));
    return report(a, `${song}.hybrid`);
  }
  const cachePath = join(dir, `${song}.notes.json`);
  let notes: PitchedNote[];
  if (existsSync(cachePath)) {
    notes = JSON.parse(readFileSync(cachePath, 'utf8'));
  } else {
    const t0 = performance.now();
    ({ notes } = await transcribe(signal, modelHandler(), () => {}, 3_600_000));
    writeFileSync(cachePath, JSON.stringify(notes));
    console.log(`transcribed ${notes.length} notes in ${Math.round((performance.now() - t0) / 1000)} s`);
  }
  const a = await analyzeSignal(signal, { transcriber: async () => notes, onLog: (m) => console.log(m) });
  writeFileSync(join(dir, `${song}.analysis.json`), JSON.stringify(a));
  report(a, song);
});

/** Mono 16-bit PCM WAV (as written by the ML service), padded or cut to `length` samples. */
function readWav16(path: string, length: number): Float32Array {
  const buf = readFileSync(path);
  let off = 12;
  while (off < buf.length - 8 && buf.toString('ascii', off, off + 4) !== 'data') off += 8 + buf.readUInt32LE(off + 4);
  const start = off + 8;
  const n = Math.min(length, Math.floor((buf.length - start) / 2));
  const out = new Float32Array(length);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(start + i * 2) / 32768;
  return out;
}

function report(a: AnalysisResult, name: string) {

  const spb = 60 / a.tempo;
  const bars = a.downbeats.map((i) => a.beats[i]);
  const from = Number(process.env.BAR ?? bars.findIndex((t) => t >= 60));
  const count = Number(process.env.BARS ?? 4);
  const lines: string[] = [`tempo ${a.tempo}  bass ${a.bass.length}  lead ${a.lead.length}  vocals ${a.vocals.length}  drums ${a.drums.length}`];
  for (const [name, list] of [['bass', a.bass], ['lead', a.lead], ['vocals', a.vocals]] as const) {
    for (let b = from; b < from + count; b++) {
      const s = bars[b];
      const e = bars[b + 1];
      const ns = list.filter((n) => n.t >= s - 0.03 && n.t < e - 0.03);
      lines.push(`${name.padEnd(6)} bar ${b}: ${ns.map((n) => `${((n.t - s) / spb).toFixed(2)}:${n.chord ? `[${n.chord.map(nm).join(' ')}]` : nm(n.midi)}`).join(' ')}`);
    }
  }
  const parts = (process.env.PARTS ?? PARTS.join(',')).split(',');
  for (const part of PARTS.filter((p) => parts.includes(p))) {
    for (const d of DIFFICULTIES) {
      const c = generateChart(a, part, d, song);
      const lanesUsed = Array.from({ length: c.lanes }, (_, l) => c.notes.filter((n) => n.lane === l).length).join('/');
      const chords = c.notes.length - new Set(c.notes.map((n) => n.t)).size;
      lines.push(`${part}/${d}: ${c.notes.length} notes (${(c.notes.length / a.duration).toFixed(2)}/s) lanes ${lanesUsed} chords ${chords} sustains ${c.notes.filter((n) => n.dur > 0).length}`);
      for (let b = from; b < from + Math.min(count, 2); b++) {
        const s = bars[b];
        const e = bars[b + 1];
        const ns = c.notes.filter((n) => n.t >= s - 0.03 && n.t < e - 0.03);
        lines.push(`    bar ${b}: ${ns.map((n) => `${((n.t - s) / spb).toFixed(2)}:${'GRYBO'[n.lane]}${n.dur ? '~' : ''}`).join(' ')}`);
      }
    }
  }
  writeFileSync(join(dir, `${name}.report.txt`), lines.join('\n'));
  console.log(lines.join('\n'));
}
