/**
 * Where notes fall within the beat around a time: reference tiles, our vocal line and the expert
 * chart, as beat positions on our grid (dev tooling for rhythm-grid questions).
 *
 *   SONG=demo2 REF=ref-demo2 FROM=64 SPAN=4 pnpm vitest run --config vitest.dev.config.ts beatPos
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import type { AnalysisResult } from '../../src/analysis/types';
import { generateAll, Grid } from '../../src/chart/generator';

it('beat positions', () => {
  const song = process.env.SONG ?? 'demo2';
  const dir = join(process.cwd(), 'local-audio');
  const a = JSON.parse(readFileSync(join(dir, `${song}.hybrid.json`), 'utf8')) as AnalysisResult;
  const off = Number((readFileSync(join(dir, `${song}.video-compare.txt`), 'utf8').match(/offset (-?[\d.]+)s/) ?? [])[1] ?? 0);
  const tiles = (JSON.parse(readFileSync(join(dir, process.env.REF ?? 'ref-demo2', 'notes.json'), 'utf8')) as { notes: { t: number }[] }).notes.map((n) => n.t + off);
  const intervals = a.beats.slice(1).map((b, i) => b - a.beats[i]).sort((x, y) => x - y);
  const grid = new Grid(a.beats, intervals[intervals.length >> 1]);
  const from = Number(process.env.FROM ?? 64);
  const to = from + Number(process.env.SPAN ?? 4);
  const fmt = (ts: number[]) => ts.filter((t) => t >= from && t < to).map((t) => grid.pos(t).toFixed(2)).join(' ');
  console.log(`tempo ${a.tempo.toFixed(1)} spb ${intervals[intervals.length >> 1].toFixed(3)}`);
  console.log('beats :', a.beats.filter((t) => t >= from && t < to).map((t) => `${t.toFixed(2)}=${grid.pos(t).toFixed(0)}`).join(' '));
  console.log('tiles :', fmt(tiles));
  console.log('line  :', fmt(a.vocals.map((n) => n.t)));
  console.log('expert:', fmt(generateAll(a, 'vocals', song).expert.notes.map((n) => n.t)));
});
