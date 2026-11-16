/**
 * Compares our vocals with tiles extracted from a gameplay recording (scripts/dev/video_notes.py).
 *
 *   SONG=demo REF=ref-demo npx vitest run --config vitest.dev.config.ts compareVideo
 *
 * The tiles' times are offset by an unknown constant (scroll travel, capture latency); the offset
 * that best matches our vocal attacks is found first.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import type { AnalysisResult } from '../../src/analysis/types';
import { generateAll } from '../../src/chart/generator';

const song = process.env.SONG ?? 'demo';
const refDir = join(process.cwd(), 'local-audio', process.env.REF ?? 'ref-demo');
const dir = join(process.cwd(), 'local-audio');

function matchCount(ref: number[], ours: number[], tol: number) {
  let j = 0;
  let m = 0;
  const used = new Uint8Array(ours.length);
  const pairs: [number, number][] = [];
  for (let i = 0; i < ref.length; i++) {
    while (j < ours.length && ours[j] < ref[i] - tol) j++;
    let best = -1;
    for (let k = j; k < ours.length && ours[k] <= ref[i] + tol; k++) if (!used[k] && (best < 0 || Math.abs(ours[k] - ref[i]) < Math.abs(ours[best] - ref[i]))) best = k;
    if (best >= 0) {
      used[best] = 1;
      m++;
      pairs.push([i, best]);
    }
  }
  return { m, pairs };
}

it(`compare ${song} with video tiles`, () => {
  const tiles = JSON.parse(readFileSync(join(refDir, 'notes.json'), 'utf8')) as { notes: { t: number; lane: number }[] };
  const a = JSON.parse(readFileSync(join(dir, `${song}.hybrid.json`), 'utf8')) as AnalysisResult;
  const times = [...new Set(tiles.notes.map((n) => +n.t.toFixed(3)))].sort((x, y) => x - y);
  const ours = a.vocals.map((n) => n.t);

  // Offset search (ref time + offset = our time): coarse against the vocal line, then fine against
  // the expert chart (both are grid-placed, so the fine fit removes any latency in the recording).
  let best = { off: 0, m: -1 };
  for (let off = -1.5; off <= 1.5; off += 0.005) {
    const { m } = matchCount(times.map((t) => t + off), ours, 0.05);
    if (m > best.m) best = { off, m };
  }
  const expertTimes = [...new Set(generateAll(a, 'vocals', song).expert.notes.map((n) => +n.t.toFixed(3)))].sort((x, y) => x - y);
  const coarse = best.off;
  best = { off: coarse, m: -1 };
  for (let off = coarse - 0.06; off <= coarse + 0.06; off += 0.002) {
    const { m } = matchCount(times.map((t) => t + off), expertTimes, 0.03);
    if (m > best.m) best = { off, m };
  }
  const off = +best.off.toFixed(3);
  const ref = tiles.notes.map((n) => ({ t: n.t + off, lane: n.lane }));
  const refTimes = times.map((t) => t + off);
  const out: string[] = [`offset ${off}s (tile time + offset = audio time)`];
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  const refChordTimes = refTimes.filter((t) => ref.filter((n) => Math.abs(n.t - t) < 0.002).length > 1).length;
  const laneUse = [0, 1, 2, 3, 4].map((l) => ref.filter((n) => n.lane === l).length);
  out.push(`tiles: ${ref.length} notes at ${refTimes.length} times (${(refTimes.length / a.duration).toFixed(2)}/s), chords at ${pct(refChordTimes / refTimes.length)} of times, lanes G/R/Y/B/O ${laneUse.join('/')}`);

  for (const tol of [0.05, 0.1]) {
    const { m } = matchCount(refTimes, ours, tol);
    const p = m / ours.length;
    const r = m / refTimes.length;
    out.push(`vocal line vs tiles @${tol * 1000}ms: ours ${ours.length}, matched ${m} | P ${pct(p)} R ${pct(r)} F1 ${pct((2 * p * r) / (p + r))}`);
  }

  const charts = generateAll(a, 'vocals', song);
  for (const d of ['expert', 'hard', 'medium', 'easy'] as const) {
    const c = charts[d].notes;
    const ct = [...new Set(c.map((n) => +n.t.toFixed(3)))].sort((x, y) => x - y);
    const { m, pairs } = matchCount(refTimes, ct, 0.07);
    const p = m / ct.length;
    const r = m / refTimes.length;
    // Lane direction between consecutive matched single notes.
    const laneOf = (list: { t: number; lane: number }[], t: number) => list.filter((n) => Math.abs(n.t - t) < 0.002).map((n) => n.lane);
    let agree = 0;
    let moves = 0;
    let stay = 0;
    let stayOk = 0;
    for (let k = 1; k < pairs.length; k++) {
      if (pairs[k][0] !== pairs[k - 1][0] + 1) continue;
      const r0 = laneOf(ref, refTimes[pairs[k - 1][0]]);
      const r1 = laneOf(ref, refTimes[pairs[k][0]]);
      const o0 = laneOf(c, ct[pairs[k - 1][1]]);
      const o1 = laneOf(c, ct[pairs[k][1]]);
      if (r0.length !== 1 || r1.length !== 1 || o0.length !== 1 || o1.length !== 1) continue;
      moves++;
      const dr = Math.sign(r1[0] - r0[0]);
      if (dr === Math.sign(o1[0] - o0[0])) agree++;
      if (dr === 0) {
        stay++;
        if (o1[0] === o0[0]) stayOk++;
      }
    }
    const ourUse = [0, 1, 2, 3, 4].map((l) => c.filter((n) => n.lane === l).length);
    out.push(
      `vocals/${d}: ${ct.length} times (${(ct.length / a.duration).toFixed(2)}/s) | onset P ${pct(p)} R ${pct(r)} F1 ${pct((2 * p * r) / (p + r))} | lane direction ${pct(agree / Math.max(1, moves))} of ${moves}, repeats kept ${pct(stayOk / Math.max(1, stay))} of ${stay} | lanes ${ourUse.join('/')}`,
    );
  }

  // How does the charter map pitch to lanes? Lane vs our transcribed pitch for matched notes.
  const { pairs } = matchCount(refTimes, ours, 0.07);
  const byLane = [0, 1, 2, 3, 4].map(() => [] as number[]);
  for (const [i, j] of pairs) {
    const lanes = ref.filter((n) => Math.abs(n.t - refTimes[i]) < 0.002).map((n) => n.lane);
    if (lanes.length === 1) byLane[lanes[0]].push(a.vocals[j].midi);
  }
  out.push('pitch per tile lane (median MIDI, n): ' + byLane.map((xs, l) => `${'GRYBO'[l]} ${xs.length ? [...xs].sort((x, y) => x - y)[xs.length >> 1] : '-'} (${xs.length})`).join(', '));

  const from = Number(process.env.FROM ?? 20);
  const to = from + Number(process.env.SPAN ?? 8);
  const N = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const nm = (m: number) => N[m % 12] + (Math.floor(m / 12) - 1);
  out.push(`--- ${from}-${to}s`);
  out.push('tiles : ' + ref.filter((n) => n.t >= from && n.t < to).map((n) => `${n.t.toFixed(2)}:${'GRYBO'[n.lane]}`).join(' '));
  out.push('line  : ' + a.vocals.filter((n) => n.t >= from && n.t < to).map((n) => `${n.t.toFixed(2)}:${nm(n.midi)}`).join(' '));
  out.push('expert: ' + charts.expert.notes.filter((n) => n.t >= from && n.t < to).map((n) => `${n.t.toFixed(2)}:${'GRYBO'[n.lane]}${n.dur ? '~' : ''}`).join(' '));
  writeFileSync(join(dir, `${song}.video-compare.txt`), out.join('\n'));
  console.log(out.join('\n'));
});
