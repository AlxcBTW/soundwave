/**
 * Compares our analysis and charts with a reference chart (community notes.mid).
 *
 *   SONG=sna REF=ref-sna npx vitest run --config vitest.dev.config.ts compare
 *
 * Needs local-audio/<SONG>.hybrid.json (from analyze.dev.ts with ANALYSIS=hybrid) and
 * local-audio/<REF>/{notes.mid, align.json} (align.json from scripts/dev/align.py).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import type { AnalysisResult, PitchedNote } from '../../src/analysis/types';
import { generateAll } from '../../src/chart/generator';
import { DIFFICULTIES, type Note, type Part } from '../../src/chart/types';
import { readReference, type RefNote } from './reference';

const song = process.env.SONG ?? 'sna';
const refDir = join(process.cwd(), 'local-audio', process.env.REF ?? 'ref-sna');
const dir = join(process.cwd(), 'local-audio');

/** Greedy one-to-one onset matching within `tol` seconds. Returns matched index pairs. */
function match(ref: number[], ours: number[], tol: number): [number, number][] {
  const pairs: [number, number][] = [];
  const used = new Uint8Array(ours.length);
  let j = 0;
  for (let i = 0; i < ref.length; i++) {
    while (j < ours.length && ours[j] < ref[i] - tol) j++;
    let best = -1;
    for (let k = j; k < ours.length && ours[k] <= ref[i] + tol; k++) {
      if (!used[k] && (best < 0 || Math.abs(ours[k] - ref[i]) < Math.abs(ours[best] - ref[i]))) best = k;
    }
    if (best >= 0) {
      used[best] = 1;
      pairs.push([i, best]);
    }
  }
  return pairs;
}

const f1 = (m: number, r: number, o: number) => {
  const p = o ? m / o : 0;
  const rc = r ? m / r : 0;
  return { p, r: rc, f: p + rc ? (2 * p * rc) / (p + rc) : 0 };
};
const pct = (x: number) => `${Math.round(x * 100)}%`;
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : NaN);
const uniqueTimes = (ts: number[]) => [...new Set(ts.map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b);

it(`compare ${song} with reference`, () => {
  const ref = readReference(join(refDir, 'notes.mid'));
  const { offset } = JSON.parse(readFileSync(join(refDir, 'align.json'), 'utf8')) as { offset: number };
  const a = JSON.parse(readFileSync(join(dir, `${song}.hybrid.json`), 'utf8')) as AnalysisResult;
  // Our times → chart timeline.
  const toChart = (t: number) => t - offset;
  const out: string[] = [`offset ${offset}s (our time = chart time + offset)`];

  // Beats
  const ourBeats = a.beats.map(toChart);
  const beatErr = ref.beats.filter((b) => b > ourBeats[0] && b < ourBeats[ourBeats.length - 1]).map((b) => {
    const nearest = ourBeats.reduce((m, x) => (Math.abs(x - b) < Math.abs(m - b) ? x : m), ourBeats[0]);
    return (nearest - b) * 1000;
  });
  out.push(
    `beats: ref ${ref.beats.length}, ours ${a.beats.length}; error median ${median(beatErr).toFixed(1)} ms, |err|<30ms ${pct(beatErr.filter((e) => Math.abs(e) < 30).length / beatErr.length)}, |err|<60ms ${pct(beatErr.filter((e) => Math.abs(e) < 60).length / beatErr.length)}`,
  );
  const refDown = new Set(ref.downbeats.map((i) => ref.beats[i]));
  const ourDown = a.downbeats.map((i) => toChart(a.beats[i]));
  out.push(`downbeats on a reference downbeat: ${pct(ourDown.filter((t) => [...refDown].some((r) => Math.abs(r - t) < 0.08)).length / ourDown.length)}`);

  // Vocals: our line vs the sung reference syllables.
  const rv = ref.vocals;
  const ov: PitchedNote[] = (a.vocals ?? []).map((n) => ({ ...n, t: toChart(n.t) }));
  for (const tol of [0.05, 0.1]) {
    const m = match(rv.map((n) => n.t), ov.map((n) => n.t), tol);
    const s = f1(m.length, rv.length, ov.length);
    const exact = m.filter(([i, j]) => rv[i].value === ov[j].midi).length;
    const pc = m.filter(([i, j]) => rv[i].value % 12 === ov[j].midi % 12).length;
    const near = m.filter(([i, j]) => Math.abs(rv[i].value - ov[j].midi) <= 1).length;
    const durRatio = median(m.map(([i, j]) => ov[j].dur / Math.max(0.05, rv[i].dur)));
    out.push(
      `vocals @${tol * 1000}ms: ref ${rv.length}, ours ${ov.length}, matched ${m.length} | P ${pct(s.p)} R ${pct(s.r)} F1 ${pct(s.f)} | pitch exact ${pct(exact / Math.max(1, m.length))}, ±1 ${pct(near / Math.max(1, m.length))}, same pitch class ${pct(pc / Math.max(1, m.length))} | duration ratio ${durRatio.toFixed(2)}`,
    );
  }
  const mv = match(rv.map((n) => n.t), ov.map((n) => n.t), 0.1);
  // Contour: between consecutive matched syllables, does our pitch (and our chart lane) move the
  // same way as the reference pitch? Repeated notes count as "same" only if both stay put.
  const vocalCharts = generateAll(a, 'vocals', song);
  for (const d of ['expert', 'medium'] as const) {
    const chart = vocalCharts[d].notes.map((n) => ({ ...n, t: toChart(n.t) }));
    let agreePitch = 0;
    let agreeLane = 0;
    let moves = 0;
    let repeats = 0;
    let repeatsKept = 0;
    for (let k = 1; k < mv.length; k++) {
      const [i0, j0] = mv[k - 1];
      const [i1, j1] = mv[k];
      if (i1 !== i0 + 1) continue;
      const dr = Math.sign(rv[i1].value - rv[i0].value);
      const dp = Math.sign(ov[j1].midi - ov[j0].midi);
      const l0 = chart.find((n) => Math.abs(n.t - ov[j0].t) < 0.06);
      const l1 = chart.find((n) => Math.abs(n.t - ov[j1].t) < 0.06);
      if (!l0 || !l1) continue;
      const dl = Math.sign(l1.lane - l0.lane);
      moves++;
      if (dr === dp) agreePitch++;
      if (dr === dl) agreeLane++;
      if (dr === 0) {
        repeats++;
        if (dl === 0) repeatsKept++;
      }
    }
    out.push(
      `vocals contour (${d} chart): pitch direction agrees ${pct(agreePitch / Math.max(1, moves))}, lane direction agrees ${pct(agreeLane / Math.max(1, moves))} of ${moves}; repeated notes kept in lane ${pct(repeatsKept / Math.max(1, repeats))} of ${repeats}`,
    );
  }
  const timingErr = mv.map(([i, j]) => (ov[j].t - rv[i].t) * 1000);
  out.push(`vocals timing (matched @100ms): median ${median(timingErr).toFixed(1)} ms, median |err| ${median(timingErr.map(Math.abs)).toFixed(1)} ms`);

  // Five-lane parts: per difficulty, onset F1, density, chords, lane direction agreement.
  const parts: [Part, keyof typeof ref][] = [
    ['lead', 'guitar'],
    ['bass', 'bass'],
    ['drums', 'drums'],
  ];
  for (const [part, key] of parts) {
    const charts = generateAll(a, part, song);
    for (const d of DIFFICULTIES) {
      const rn = (ref[key] as Record<string, RefNote[]>)[d];
      const on: Note[] = charts[d].notes.map((n) => ({ ...n, t: toChart(n.t) }));
      const rt = uniqueTimes(rn.map((n) => n.t));
      const ot = uniqueTimes(on.map((n) => n.t));
      const m = match(rt, ot, 0.07);
      const s = f1(m.length, rt.length, ot.length);
      const chordRate = (ns: { t: number }[], ts: number[]) => (ts.length ? 1 - ts.length / ns.length : 0);
      // Lane direction: for consecutive matched single-note times, does the lane move the same way?
      const laneAt = (ns: { t: number; lane?: number; value?: number }[], t: number) =>
        ns.filter((n) => Math.abs(n.t - t) < 0.002).map((n) => n.lane ?? n.value ?? 0);
      let same = 0;
      let moves = 0;
      for (let k = 1; k < m.length; k++) {
        const r0 = laneAt(rn, rt[m[k - 1][0]]);
        const r1 = laneAt(rn, rt[m[k][0]]);
        const o0 = laneAt(on, ot[m[k - 1][1]]);
        const o1 = laneAt(on, ot[m[k][1]]);
        if (r0.length !== 1 || r1.length !== 1 || o0.length !== 1 || o1.length !== 1) continue;
        moves++;
        if (Math.sign(r1[0] - r0[0]) === Math.sign(o1[0] - o0[0])) same++;
      }
      out.push(
        `${part}/${d}: ref ${rt.length} times (chords ${pct(chordRate(rn, rt))}), ours ${ot.length} (chords ${pct(chordRate(on, ot))}) | onset P ${pct(s.p)} R ${pct(s.r)} F1 ${pct(s.f)} | lane direction agrees ${moves ? pct(same / moves) : '-'} of ${moves}`,
      );
    }
  }

  // Side-by-side vocals for a window (chart time).
  const from = Number(process.env.FROM ?? 20);
  const to = from + Number(process.env.SPAN ?? 10);
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const nm = (m: number) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
  out.push(`--- vocals ${from}-${to}s (chart time)`);
  out.push('ref : ' + rv.filter((n) => n.t >= from && n.t < to).map((n) => `${n.t.toFixed(2)}:${nm(n.value)}(${n.dur.toFixed(2)})`).join(' '));
  out.push('ours: ' + ov.filter((n) => n.t >= from && n.t < to).map((n) => `${n.t.toFixed(2)}:${nm(n.midi)}(${n.dur.toFixed(2)})`).join(' '));
  out.push(`--- guitar expert ${from}-${to}s`);
  out.push('ref : ' + ref.guitar.expert.filter((n) => n.t >= from && n.t < to).map((n) => `${n.t.toFixed(2)}:${'GRYBO'[n.value]}`).join(' '));
  const le = generateAll(a, 'lead', song).expert.notes.map((n) => ({ ...n, t: toChart(n.t) }));
  out.push('ours: ' + le.filter((n) => n.t >= from && n.t < to).map((n) => `${n.t.toFixed(2)}:${'GRYBO'[n.lane]}`).join(' '));

  writeFileSync(join(dir, `${song}.compare.txt`), out.join('\n'));
  console.log(out.join('\n'));
});
