/**
 * Chart quality metrics for a saved analysis (default: local-audio/<SONG>.hybrid.json).
 *
 *   SONG=rivers FILE=hybrid pnpm vitest run --config vitest.dev.config.ts metrics
 *
 * Reports, per pitched part: onset timing against the beat grid, how many source notes survive into
 * the expert chart, whether lanes follow the pitch contour, and whether repeated bars chart the same.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import type { AnalysisResult, PitchedNote } from '../../src/analysis/types';
import { generateAll, Grid } from '../../src/chart/generator';
import type { Part } from '../../src/chart/types';

const song = process.env.SONG ?? 'rivers';
const file = process.env.FILE ?? 'hybrid';
const dir = join(process.cwd(), 'local-audio');

it(`metrics ${song}.${file}`, () => {
  const a = JSON.parse(readFileSync(join(dir, `${song}.${file}.json`), 'utf8')) as AnalysisResult;
  const spb = 60 / a.tempo;
  const grid = new Grid(a.beats, spb);
  const out: string[] = [];
  for (const part of ['bass', 'lead', 'vocals'] as Part[]) {
    const line: PitchedNote[] = part === 'bass' ? a.bass : part === 'lead' ? a.lead : a.vocals;
    // 1. Timing: offset of each onset from the nearest sixteenth, in ms.
    const offs = line.map((n) => {
      const p = grid.pos(n.t) * 4;
      return (p - Math.round(p)) * (spb / 4) * 1000;
    });
    const mean = offs.reduce((x, y) => x + y, 0) / offs.length;
    const hist = [-60, -40, -20, 0, 20, 40, 60].map((lo) => offs.filter((o) => o >= lo - 10 && o < lo + 10).length);
    // 2-4. Expert chart vs. source line.
    const charts = generateAll(a, part, song);
    for (const d of ['expert', 'medium'] as const) {
      const c = charts[d];
      const times = [...new Set(c.notes.map((n) => n.t))].sort((x, y) => x - y);
      const singles = times.map((t) => c.notes.filter((n) => n.t === t)).filter((g) => g.length === 1).map((g) => g[0]);
      const src = (t: number) => line.reduce((best, n) => (Math.abs(n.t - t) < Math.abs(best.t - t) ? n : best), line[0]);
      let up = 0;
      let upOk = 0;
      let same = 0;
      let sameOk = 0;
      const jumps: number[] = [];
      for (let i = 1; i < singles.length; i++) {
        const dm = src(singles[i].t).midi - src(singles[i - 1].t).midi;
        const dl = singles[i].lane - singles[i - 1].lane;
        jumps.push(Math.abs(dl));
        if (dm === 0) {
          same++;
          if (dl === 0) sameOk++;
        } else {
          up++;
          if (Math.sign(dl) === Math.sign(dm)) upOk++;
        }
      }
      // Repeated bars: same quantized rhythm + pitches → same lanes?
      const bars = a.downbeats.map((i) => a.beats[i]);
      const seen = new Map<string, string>();
      let rep = 0;
      let repOk = 0;
      for (let b = 0; b + 1 < bars.length; b++) {
        const ns = c.notes.filter((n) => n.t >= bars[b] - 0.02 && n.t < bars[b + 1] - 0.02);
        if (ns.length < 2) continue;
        const key = ns.map((n) => `${(grid.pos(n.t) - grid.pos(bars[b])).toFixed(2)}:${src(n.t).midi}`).join(',');
        const lanes = ns.map((n) => n.lane).join('');
        if (seen.has(key)) {
          rep++;
          if (seen.get(key) === lanes) repOk++;
        } else seen.set(key, lanes);
      }
      const pct = (x: number, y: number) => (y ? `${Math.round((100 * x) / y)}%` : '-');
      out.push(
        `${part}/${d}: source ${line.length} -> ${times.length} times (${c.notes.length} notes) | ` +
          `contour ${pct(upOk, up)} of ${up} moves, same-pitch-same-lane ${pct(sameOk, same)} of ${same} | ` +
          `mean jump ${(jumps.reduce((x, y) => x + y, 0) / Math.max(1, jumps.length)).toFixed(2)} lanes | ` +
          `repeated bars identical ${pct(repOk, rep)} of ${rep}`,
      );
    }
    out.push(`${part}: onset offset vs 16th grid mean ${mean.toFixed(1)} ms, histogram [-60..60 by 20] ${hist.join(' ')}`);
  }
  writeFileSync(join(dir, `${song}.${file}.metrics.txt`), out.join('\n'));
  console.log(out.join('\n'));
});
