/**
 * Writes every part's expert note times for some songs, so two runs (e.g. with different rhythm
 * settings) can be diffed (dev tooling).
 *
 *   SONGS=rivers,alive OUT=a.json pnpm vitest run --config vitest.dev.config.ts snapDiff
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import type { AnalysisResult } from '../../src/analysis/types';
import { generateAll } from '../../src/chart/generator';
import { PARTS } from '../../src/chart/types';

it('expert note times', () => {
  const dir = join(process.cwd(), 'local-audio');
  const out: Record<string, Record<string, number[]>> = {};
  for (const song of (process.env.SONGS ?? 'rivers,alive,layall,sna,givenchy,demo,demo2').split(',')) {
    const file = join(dir, `${song}.hybrid.json`);
    if (!existsSync(file)) continue;
    const a = JSON.parse(readFileSync(file, 'utf8')) as AnalysisResult;
    out[song] = {};
    for (const p of PARTS) {
      try {
        out[song][p] = [...new Set(generateAll(a, p, song).expert.notes.map((n) => +n.t.toFixed(3)))];
      } catch (e) {
        console.log(`${song}/${p}: ${(e as Error).message}`);
      }
    }
  }
  writeFileSync(join(dir, process.env.OUT ?? 'snap.json'), JSON.stringify(out));
});
