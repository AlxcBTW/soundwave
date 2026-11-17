/**
 * How a chart moves between lanes: for consecutive notes, grouped by the time between them, how
 * often the lane repeats, steps to a neighbour or jumps, and how lane moves follow pitch moves.
 * Compares tiles from gameplay recordings with our charts (dev tooling).
 *
 *   SONGS=demo:ref-demo,demo2:ref-demo2 npx vitest run --config vitest.dev.config.ts laneStats
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import type { AnalysisResult } from '../../src/analysis/types';
import { generateAll } from '../../src/chart/generator';

const dir = join(process.cwd(), 'local-audio');
const pairs = (process.env.SONGS ?? 'demo:ref-demo,demo2:ref-demo2').split(',').map((s) => s.split(':') as [string, string]);
const BUCKETS = [0, 0.15, 0.25, 0.4, 0.8, Infinity];
const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);

interface N {
  t: number;
  lane: number;
}

function movement(notes: N[]): string[] {
  const out: string[] = [];
  const rows = BUCKETS.slice(0, -1).map(() => ({ n: 0, same: 0, step: 0, jump2: 0, jump3: 0 }));
  for (let i = 1; i < notes.length; i++) {
    const gap = notes[i].t - notes[i - 1].t;
    if (gap < 0.03) continue;
    const b = BUCKETS.findIndex((x, k) => gap >= x && gap < BUCKETS[k + 1]);
    const d = Math.abs(notes[i].lane - notes[i - 1].lane);
    const r = rows[b];
    r.n++;
    if (d === 0) r.same++;
    else if (d === 1) r.step++;
    else if (d === 2) r.jump2++;
    else r.jump3++;
  }
  rows.forEach((r, k) => {
    const label = `${Math.round(BUCKETS[k] * 1000)}-${BUCKETS[k + 1] === Infinity ? '∞' : Math.round(BUCKETS[k + 1] * 1000)}ms`.padEnd(11);
    out.push(`  ${label} n ${String(r.n).padStart(4)} | same ${pct(r.same / r.n)} | ±1 ${pct(r.step / r.n)} | ±2 ${pct(r.jump2 / r.n)} | ±3+ ${pct(r.jump3 / r.n)}`);
  });
  // Runs on one lane among fast notes (one finger hammering).
  let run = 1;
  let longRuns = 0;
  let fastPairs = 0;
  for (let i = 1; i < notes.length; i++) {
    const fast = notes[i].t - notes[i - 1].t < 0.25;
    if (fast) fastPairs++;
    if (fast && notes[i].lane === notes[i - 1].lane) {
      run++;
      if (run === 3) longRuns++;
    } else run = 1;
  }
  out.push(`  3+ same-lane notes in a row (each <250ms apart): ${longRuns} (per 100 fast pairs: ${((longRuns / Math.max(1, fastPairs)) * 100).toFixed(1)})`);
  return out;
}

it('lane movement', () => {
  const out: string[] = [];
  for (const [song, ref] of pairs) {
    const a = JSON.parse(readFileSync(join(dir, `${song}.hybrid.json`), 'utf8')) as AnalysisResult;
    const tiles = (JSON.parse(readFileSync(join(dir, ref, 'notes.json'), 'utf8')) as { notes: N[] }).notes;
    const chart = generateAll(a, 'vocals', song).expert.notes;
    out.push(`== ${song} tiles (${tiles.length})`, ...movement(tiles));
    out.push(`== ${song} ours (${chart.length})`, ...movement(chart));

    // Lane moves against pitch moves, for tiles matched to our transcribed vocal line.
    const line = a.vocals;
    const off = Number((readFileSync(join(dir, `${song}.video-compare.txt`), 'utf8').match(/offset (-?[\d.]+)s/) ?? [])[1] ?? 0);
    const pitchAt = (t: number) => {
      let best: (typeof line)[number] | undefined;
      for (const n of line) if (Math.abs(n.t - t) < 0.07 && (!best || Math.abs(n.t - t) < Math.abs(best.t - t))) best = n;
      return best?.midi;
    };
    const m = { up: [0, 0, 0], down: [0, 0, 0], same: [0, 0, 0] };
    for (let i = 1; i < tiles.length; i++) {
      const p0 = pitchAt(tiles[i - 1].t + off);
      const p1 = pitchAt(tiles[i].t + off);
      if (p0 === undefined || p1 === undefined) continue;
      const dl = Math.sign(tiles[i].lane - tiles[i - 1].lane);
      const key = p1 > p0 ? 'up' : p1 < p0 ? 'down' : 'same';
      m[key][dl + 1]++;
    }
    out.push(`  tiles: lane move when pitch goes up / down / stays (lane down, same, up):`);
    for (const k of ['up', 'down', 'same'] as const) {
      const n = m[k].reduce((s, x) => s + x, 0);
      out.push(`    pitch ${k.padEnd(4)} n ${String(n).padStart(4)} | lane down ${pct(m[k][0] / n)} | same ${pct(m[k][1] / n)} | up ${pct(m[k][2] / n)}`);
    }
  }
  writeFileSync(join(dir, 'lane-stats.txt'), out.join('\n'));
});
