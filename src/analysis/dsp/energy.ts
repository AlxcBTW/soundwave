import type { Section } from '../types';
import { percentile, smooth } from './onsets';

/** RMS per hop, normalized so the 95th percentile is 1. */
export function rmsCurve(signal: Float32Array, hop: number): Float32Array {
  const n = Math.ceil(signal.length / hop);
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const a = f * hop - hop;
    const b = f * hop + hop;
    let s = 0;
    let c = 0;
    for (let i = Math.max(0, a); i < Math.min(signal.length, b); i++) {
      s += signal[i] * signal[i];
      c++;
    }
    out[f] = c ? Math.sqrt(s / c) : 0;
  }
  const ref = percentile(out, 0.95) || 1;
  for (let i = 0; i < n; i++) out[i] = Math.min(1.5, out[i] / ref);
  return out;
}

/** Downsamples a per-frame curve to one value every `stepSec` seconds (smoothed). */
export function resampleCurve(x: Float32Array, fps: number, stepSec: number): number[] {
  const r = Math.max(1, Math.round((fps * stepSec) / 2));
  const sm = smooth(x, r);
  const out: number[] = [];
  for (let t = 0; t * fps < x.length; t += stepSec) out.push(Math.round(sm[Math.floor(t * fps)] * 1000) / 1000);
  return out;
}

/**
 * Segments the song at bar boundaries where loudness, harmony or onset density changes.
 * `barFeatures` holds one vector per bar (any dimension), `barEnergy` one loudness value per bar.
 */
export function findSections(barTimes: number[], barEnergy: number[], barFeatures: Float32Array[], duration: number, minBars = 4): Section[] {
  const n = barTimes.length;
  if (n < minBars * 2) return [{ start: 0, end: duration, energy: 0.7 }];
  const win = 2;
  const nov = new Float32Array(n);
  for (let i = win; i <= n - win; i++) {
    let eA = 0;
    let eB = 0;
    const fA = new Float32Array(barFeatures[0].length);
    const fB = new Float32Array(barFeatures[0].length);
    for (let j = 0; j < win; j++) {
      eA += barEnergy[i - 1 - j];
      eB += barEnergy[i + j] ?? 0;
      barFeatures[i - 1 - j].forEach((v, k) => (fA[k] += v));
      barFeatures[i + j]?.forEach((v, k) => (fB[k] += v));
    }
    let d = 0;
    let na = 0;
    let nb = 0;
    for (let k = 0; k < fA.length; k++) {
      d += fA[k] * fB[k];
      na += fA[k] * fA[k];
      nb += fB[k] * fB[k];
    }
    const cos = d / (Math.sqrt(na * nb) || 1);
    nov[i] = Math.abs(eA - eB) / win * 2 + (1 - cos);
  }
  let mean = 0;
  for (const v of nov) mean += v;
  mean /= n;
  let sd = 0;
  for (const v of nov) sd += (v - mean) ** 2;
  sd = Math.sqrt(sd / n);
  const bounds = [0];
  // Greedy: strongest novelty peaks first, respecting the minimum section length.
  const cands = Array.from(nov, (v, i) => ({ v, i }))
    .filter(({ v, i }) => i >= minBars && i <= n - minBars && v > mean + 0.5 * sd && v >= (nov[i - 1] ?? 0) && v >= (nov[i + 1] ?? 0))
    .sort((a, b) => b.v - a.v);
  for (const c of cands) if (bounds.every((b) => Math.abs(b - c.i) >= minBars)) bounds.push(c.i);
  bounds.sort((a, b) => a - b);
  const sections: Section[] = [];
  for (let s = 0; s < bounds.length; s++) {
    const a = bounds[s];
    const b = bounds[s + 1] ?? n;
    let e = 0;
    for (let i = a; i < b; i++) e += barEnergy[i];
    sections.push({ start: s === 0 ? 0 : barTimes[a], end: b >= n ? duration : barTimes[b], energy: e / Math.max(1, b - a) });
  }
  const lo = Math.min(...sections.map((s) => s.energy));
  const hi = Math.max(...sections.map((s) => s.energy));
  for (const s of sections) {
    const rel = hi > lo ? (s.energy - lo) / (hi - lo) : 0.7;
    s.energy = Math.round((0.35 + 0.65 * rel) * 100) / 100;
  }
  return sections;
}
