/**
 * How well does the analysis find beats and bar starts? Scores the grid it ends up with against
 * beats marked by hand, with the beat tracker alone and with the beat model (dev tooling).
 *
 *   BEATS=gtzan pnpm vitest run --config vitest.dev.config.ts beats
 *
 * Expects a folder `local-audio/<BEATS>/` with, for every song:
 *   <name>.f32        mono float32 at 22050 Hz (analyze.dev.ts says one way to make it)
 *   <name>.beats      a line per beat: its time in seconds, then its position in the bar (1 starts
 *                     a bar), separated by white space, as in the GTZAN-Rhythm annotations
 *   <name>.drums.f32  optional: the song's drum stem in the same form, which the grid is then
 *                     aligned to, as it is in the game
 *
 * Reports, as the mean over the songs: the F-measure of the beats within 70 ms (the usual measure)
 * and within 35 ms (about the window of a Perfect), of the bar starts within 70 ms, and how far the
 * found beats sit from the marked ones. The first five seconds are left out, as is usual. Set
 * TRACKER_ONLY=1 to skip the model. A thirty-second excerpt takes about three seconds. The table
 * is also written to `beats.report.txt` in the folder.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-web';
import { it } from 'vitest';
import { MELS } from '../../src/analysis/beat/spectrogram';
import { beatsAndBars, WINDOW, type BeatModel } from '../../src/analysis/beat/track';
import { analyzeSignal } from '../../src/analysis/pipeline';

const dir = join(process.cwd(), 'local-audio', process.env.BEATS ?? 'beats');
const START = 5;

const f32 = (path: string) => {
  const raw = readFileSync(path);
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
};

/** Marked and found times that pair up within `window` seconds, each used once, as [marked, found]. */
function pairs(marked: number[], found: number[], window: number): [number, number][] {
  const out: [number, number][] = [];
  let j = 0;
  for (const t of marked) {
    while (j < found.length && found[j] < t - window) j++;
    if (j < found.length && Math.abs(found[j] - t) <= window) out.push([t, found[j++]]);
  }
  return out;
}

function fMeasure(marked: number[], found: number[], window = 0.07): number {
  if (!marked.length || !found.length) return 0;
  const hits = pairs(marked, found, window).length;
  return (2 * hits) / (marked.length + found.length);
}

interface Score {
  beats: number;
  tight: number;
  bars: number;
  offsets: number[];
}

function score(marked: { beats: number[]; bars: number[] }, grid: { beats: number[]; downbeats: number[] }): Score {
  const late = (list: number[]) => list.filter((t) => t >= START).sort((a, b) => a - b);
  const beats = late(grid.beats);
  return {
    beats: fMeasure(late(marked.beats), beats),
    tight: fMeasure(late(marked.beats), beats, 0.035),
    bars: fMeasure(late(marked.bars), late(grid.downbeats.map((i) => grid.beats[i]))),
    offsets: pairs(late(marked.beats), beats, 0.07).map(([m, f]) => f - m),
  };
}

it(`beat grids of ${dir}`, async () => {
  const names = readdirSync(dir)
    .filter((f) => f.endsWith('.beats') && existsSync(join(dir, f.replace('.beats', '.f32'))))
    .map((f) => f.replace('.beats', ''))
    .sort();
  if (!names.length) throw new Error(`no songs with a .f32 and a .beats file in ${dir}`);

  let model: BeatModel | undefined;
  if (process.env.TRACKER_ONLY !== '1') {
    const session = await ort.InferenceSession.create(
      new Uint8Array(readFileSync(join(process.cwd(), 'public', 'models', 'beat-this', 'small0.onnx'))),
      {
        executionProviders: ['wasm'],
        logSeverityLevel: 3,
      },
    );
    model = {
      async run(spect) {
        const out = await session.run({ spect: new ort.Tensor('float32', spect, [1, WINDOW, MELS]) });
        return { beat: out.beat.data as Float32Array, downbeat: out.downbeat.data as Float32Array };
      },
    };
  }

  const scores: Record<string, Score[]> = { 'beat tracker': [], 'beat model': [] };
  for (const name of names) {
    const signal = f32(join(dir, `${name}.f32`));
    const rows = readFileSync(join(dir, `${name}.beats`), 'utf8')
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter((p) => p[0] !== '');
    const marked = { beats: rows.map((p) => Number(p[0])), bars: rows.filter((p) => p[1] === '1').map((p) => Number(p[0])) };
    let drumSignal: Float32Array | undefined;
    if (existsSync(join(dir, `${name}.drums.f32`))) {
      drumSignal = new Float32Array(signal.length);
      drumSignal.set(f32(join(dir, `${name}.drums.f32`)).subarray(0, signal.length));
    }
    scores['beat tracker'].push(score(marked, await analyzeSignal(signal, { drumSignal })));
    if (model) {
      const beatModel = model;
      scores['beat model'].push(
        score(
          marked,
          await analyzeSignal(signal, { drumSignal, beatTracker: (audio, onProgress) => beatsAndBars(audio, beatModel, onProgress) }),
        ),
      );
    }
  }

  const mean = (list: number[]) => (100 * list.reduce((a, b) => a + b, 0)) / list.length;
  const lines = [`${names.length} songs in ${dir}`, `${''.padEnd(14)}  beats F  within 35 ms  bar starts F  median offset`];
  for (const [label, list] of Object.entries(scores)) {
    if (!list.length) continue;
    const offsets = list.flatMap((s) => s.offsets).sort((a, b) => a - b);
    const offset = offsets.length ? `${(1000 * offsets[offsets.length >> 1]).toFixed(0)} ms` : '-';
    lines.push(
      `${label.padEnd(14)}  ${mean(list.map((s) => s.beats))
        .toFixed(1)
        .padStart(7)}  ${mean(list.map((s) => s.tight))
        .toFixed(1)
        .padStart(12)}  ${mean(list.map((s) => s.bars))
        .toFixed(1)
        .padStart(12)}  ${offset.padStart(13)}`,
    );
  }
  writeFileSync(join(dir, 'beats.report.txt'), lines.join('\n'));
  console.log(lines.join('\n'));
}, 3_600_000);
