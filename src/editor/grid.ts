/**
 * The beat grid a chart is edited on: where the beats and bar lines fall, and the snapping,
 * stepping and naming that goes with them. A grid either follows a list of beats (found by
 * listening to the song) or runs at one fixed tempo from a first beat.
 */
import { Grid } from '../chart/generator';

export type GridSpec =
  /** One tempo for the whole song. `offset` is the time of a first beat of a bar, in seconds. */
  | { kind: 'fixed'; bpm: number; offset: number; beatsPerBar: number }
  /** Beats as they were heard, which may drift. `downbeats` are indices into `beats`. */
  | { kind: 'beats'; beats: number[]; downbeats: number[] };

export interface BeatGrid {
  beats: number[];
  /** Indices into `beats` that start a bar. */
  downbeats: number[];
  secondsPerBeat: number;
}

export const MIN_BPM = 40;
export const MAX_BPM = 260;

/** Steps per beat the editor can snap to: quarters, eighths, eighth triplets, sixteenths, sixteenth triplets, thirty-seconds. */
export const SNAPS = [1, 2, 3, 4, 6, 8] as const;
export type Snap = (typeof SNAPS)[number];

export const SNAP_LABEL: Record<Snap, string> = { 1: '1/4', 2: '1/8', 3: '1/8 triplet', 4: '1/16', 6: '1/16 triplet', 8: '1/32' };
export const SNAP_NAME: Record<Snap, string> = {
  1: 'Quarter notes',
  2: 'Eighth notes',
  3: 'Eighth triplets',
  4: 'Sixteenth notes',
  6: 'Sixteenth triplets',
  8: 'Thirty-second notes',
};

/** Positions are kept on a fine lattice (it holds every snap exactly), so equal positions compare equal. */
const LATTICE = 96;
export const quantize = (pos: number) => Math.round(pos * LATTICE) / LATTICE + 0;
/** A position read from a time: put on the lattice when it is within a hair of it. */
export const settle = (pos: number) => {
  const q = quantize(pos);
  return Math.abs(q - pos) < 0.004 ? q : pos;
};
export const samePos = (a: number, b: number) => Math.abs(a - b) < 1e-4;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** The beats of a fixed-tempo grid, covering the whole song and one beat beyond it. */
function fixedGrid(spec: Extract<GridSpec, { kind: 'fixed' }>, duration: number): BeatGrid {
  const bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, spec.bpm || 120));
  const spb = 60 / bpm;
  const perBar = Math.min(12, Math.max(1, Math.round(spec.beatsPerBar) || 4));
  const offset = Number.isFinite(spec.offset) ? spec.offset : 0;
  // The first beat at or after the start of the song that lies on the grid.
  const lead = Math.ceil(-offset / spb - 1e-9);
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let k = lead; ; k++) {
    const t = offset + k * spb;
    if (t > duration + spb) break;
    if (((k % perBar) + perBar) % perBar === 0) downbeats.push(beats.length);
    beats.push(Math.max(0, t));
    if (beats.length > 200_000) break;
  }
  return { beats, downbeats, secondsPerBeat: spb };
}

/** Beats as heard, cleaned up and run on at their own tempo to both ends of the song. */
function heardGrid(spec: Extract<GridSpec, { kind: 'beats' }>, duration: number): BeatGrid {
  const src = spec.beats.filter((t) => Number.isFinite(t) && t >= 0).sort((a, b) => a - b);
  const beats: number[] = [];
  const kept: number[] = [];
  src.forEach((t, i) => {
    if (beats.length && t - beats[beats.length - 1] < 0.05) return;
    kept.push(i);
    beats.push(t);
  });
  if (beats.length < 2) return fixedGrid({ kind: 'fixed', bpm: 120, offset: beats[0] ?? 0, beatsPerBar: 4 }, duration);
  const steps = beats.slice(1).map((t, i) => t - beats[i]);
  const spb = median(steps);
  const head = median(steps.slice(0, 8));
  const tail = median(steps.slice(-8));
  const pre: number[] = [];
  for (let t = beats[0] - head; t >= 0; t -= head) pre.unshift(t);
  const post: number[] = [];
  for (let t = beats[beats.length - 1] + tail; t <= duration + tail; t += tail) post.push(t);
  const all = [...pre, ...beats, ...post];
  // Bars as given, then carried on at the same length before and after them.
  const given = spec.downbeats
    .map((d) => kept.indexOf(d))
    .filter((i) => i >= 0)
    .map((i) => i + pre.length);
  const gaps = given.slice(1).map((d, i) => d - given[i]);
  const perBar = Math.max(1, median(gaps) || 4);
  const downs = new Set(given);
  const first = given[0] ?? pre.length;
  const last = given[given.length - 1] ?? first;
  for (let i = first - perBar; i >= 0; i -= perBar) downs.add(i);
  for (let i = last + perBar; i < all.length; i += perBar) downs.add(i);
  return { beats: all, downbeats: [...downs].sort((a, b) => a - b), secondsPerBeat: spb };
}

export function buildGrid(spec: GridSpec, duration: number): BeatGrid {
  return spec.kind === 'fixed' ? fixedGrid(spec, duration) : heardGrid(spec, duration);
}

/** The steady tempo closest to a list of heard beats, and the time of a first beat of a bar. */
export function fitFixed(beats: number[], downbeats: number[]): Extract<GridSpec, { kind: 'fixed' }> {
  if (beats.length < 2) return { kind: 'fixed', bpm: 120, offset: beats[0] ?? 0, beatsPerBar: 4 };
  let spb = median(beats.slice(1).map((t, i) => t - beats[i]));
  // Number the beats by their times, not their place in the list: a beat that went unheard (a quiet
  // bar) leaves a gap in the list but not in the count.
  const count = [0];
  for (let i = 1; i < beats.length; i++) count.push(count[i - 1] + Math.max(1, Math.round((beats[i] - beats[i - 1]) / spb)));
  // The pace over half the song at a time is far steadier than any one interval, and the middle
  // one of those is not thrown by a stretch that was heard wrongly.
  const n = beats.length;
  const half = Math.floor(n / 2);
  if (half >= 4) {
    const long = [];
    for (let i = 0; i + half < n; i++) long.push((beats[i + half] - beats[i]) / (count[i + half] - count[i]));
    const steady = median(long);
    if (Math.abs(steady - spb) / spb < 0.04) spb = steady;
  }
  let bpm = 60 / spb;
  // Most recorded music sits on a whole tempo: take it when the beats are that close to one.
  if (Math.abs(bpm - Math.round(bpm)) < 0.15) bpm = Math.round(bpm);
  else bpm = Math.round(bpm * 100) / 100;
  bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
  spb = 60 / bpm;
  // Bars are counted in the beats that were heard: an unheard beat does not make a bar longer.
  const gaps = downbeats
    .slice(1)
    .map((d, i) => d - downbeats[i])
    .filter((g) => g > 0);
  const beatsPerBar = Math.min(12, Math.max(1, median(gaps) || 4));
  const phase = downbeats.length ? count[downbeats[0]] % beatsPerBar : 0;
  // Where beat 0 would be at this tempo, judged from every beat.
  const zero = median(beats.map((t, i) => t - count[i] * spb));
  const bar = spb * beatsPerBar;
  let offset = zero + phase * spb;
  offset -= Math.floor(offset / bar) * bar;
  return { kind: 'fixed', bpm, offset: Math.round(offset * 1000) / 1000, beatsPerBar };
}

export interface BarBeat {
  /** Bar number from 1; 0 for a pickup before the first bar line. */
  bar: number;
  /** Beat in the bar, from 1. */
  beat: number;
}

/** A beat grid with the arithmetic the editor needs: times, snapping, bars. Positions are in beats. */
export class EditorGrid {
  readonly beats: number[];
  readonly downbeats: number[];
  readonly secondsPerBeat: number;
  /** The first and last position inside the song. */
  readonly start: number;
  readonly end: number;
  private readonly map: Grid;
  private readonly bars: Set<number>;

  constructor(
    grid: BeatGrid,
    readonly duration: number,
  ) {
    this.beats = grid.beats;
    this.downbeats = grid.downbeats;
    this.secondsPerBeat = grid.secondsPerBeat;
    this.map = new Grid(grid.beats, grid.secondsPerBeat);
    this.bars = new Set(grid.downbeats);
    this.start = Math.min(0, this.map.pos(0));
    this.end = Math.max(this.start, this.map.pos(Math.max(0, duration)));
  }

  pos(t: number) {
    return this.map.pos(t);
  }

  time(pos: number) {
    const b = this.beats;
    if (b.length < 2) return pos * this.secondsPerBeat;
    // Past either end the grid runs on at the tempo of its last beats.
    if (pos < 0) return b[0] + pos * (b[1] - b[0]);
    if (pos > b.length - 1) return b[b.length - 1] + (pos - (b.length - 1)) * (b[b.length - 1] - b[b.length - 2]);
    return this.map.time(pos);
  }

  /** Seconds a stretch of beats lasts, starting at `pos`. */
  span(pos: number, len: number) {
    return this.time(pos + len) - this.time(pos);
  }

  clamp(pos: number) {
    return Math.min(this.end, Math.max(this.start, pos));
  }

  /** The nearest snap line inside the song. */
  snap(pos: number, snap: Snap) {
    const lo = Math.ceil(this.start * snap - 1e-6) / snap;
    const hi = Math.floor(this.end * snap + 1e-6) / snap;
    return quantize(Math.min(hi, Math.max(lo, Math.round(pos * snap) / snap)));
  }

  /** One snap step on from `pos`, forwards or backwards; from between two lines, to the next one that way. */
  step(pos: number, snap: Snap, dir: -1 | 1) {
    const exact = pos * snap;
    const next = dir > 0 ? Math.floor(exact + 1e-4) + 1 : Math.ceil(exact - 1e-4) - 1;
    return this.snap(next / snap, snap);
  }

  isBar(beat: number) {
    return this.bars.has(beat);
  }

  /** The bar line at or before `pos` (or the first position of the song when there is none). */
  barStart(pos: number) {
    const at = Math.floor(pos + 1e-4);
    for (let i = this.downbeats.length - 1; i >= 0; i--) if (this.downbeats[i] <= at) return this.downbeats[i];
    return this.start;
  }

  /** The next bar line after `pos`, or the previous one before it. */
  barStep(pos: number, dir: -1 | 1) {
    if (dir > 0) {
      for (const d of this.downbeats) if (d > pos + 1e-4) return Math.min(this.end, d);
      return this.end;
    }
    for (let i = this.downbeats.length - 1; i >= 0; i--) if (this.downbeats[i] < pos - 1e-4) return this.downbeats[i];
    return this.start;
  }

  barBeat(pos: number): BarBeat {
    const at = Math.floor(pos + 1e-4);
    let bar = 0;
    let from = at;
    for (let i = 0; i < this.downbeats.length; i++) {
      if (this.downbeats[i] > at) break;
      bar = i + 1;
      from = this.downbeats[i];
    }
    return { bar, beat: bar ? at - from + 1 : Math.max(1, at - Math.floor(this.start) + 1) };
  }

  /** Beats in the bar that holds `pos`. */
  barLength(pos: number) {
    const start = this.barStart(pos);
    const i = this.downbeats.indexOf(start);
    if (i >= 0 && i + 1 < this.downbeats.length) return this.downbeats[i + 1] - start;
    const gaps = this.downbeats.slice(1).map((d, k) => d - this.downbeats[k]);
    return gaps.length ? gaps[gaps.length - 1] : 4;
  }

  /** Average tempo, for showing. */
  get bpm() {
    return 60 / this.secondsPerBeat;
  }
}
