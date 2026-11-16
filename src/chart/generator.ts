import type { AnalysisResult, DrumKind, PitchedNote } from '../analysis/types';
import { PROFILES, type DifficultyProfile } from './profiles';
import { DIFFICULTIES, type Chart, type Difficulty, type Note, type Part } from './types';

export const CHART_VERSION = 2;

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Maps times to beat positions and back using the (possibly uneven) beat grid. */
export class Grid {
  private readonly beats: number[];
  private readonly spb: number;

  constructor(beats: number[], spb: number) {
    this.beats = beats;
    this.spb = spb;
  }

  pos(t: number): number {
    const b = this.beats;
    if (b.length < 2) return t / this.spb;
    if (t <= b[0]) return (t - b[0]) / (b[1] - b[0]);
    if (t >= b[b.length - 1]) return b.length - 1 + (t - b[b.length - 1]) / (b[b.length - 1] - b[b.length - 2]);
    let lo = 0;
    let hi = b.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (b[mid] <= t) lo = mid;
      else hi = mid;
    }
    return lo + (t - b[lo]) / (b[lo + 1] - b[lo]);
  }

  time(pos: number): number {
    const b = this.beats;
    if (b.length < 2) return pos * this.spb;
    const i = Math.max(0, Math.min(b.length - 2, Math.floor(pos)));
    return b[i] + (pos - i) * (b[i + 1] - b[i]);
  }
}

const EPS = 1e-6;
const isMultiple = (pos: number, step: number) => Math.abs(pos / step - Math.round(pos / step)) < 1e-4;

/** A musical event before lane assignment. Positions are in beats. */
interface Ev {
  pos: number;
  /** Sustain length in beats (0 = tap). */
  len: number;
  midi: number;
  /** Ascending pitches when the event is a chord. */
  chord?: number[];
  strength: number;
  kind?: DrumKind;
}

/** Snaps a beat position to sixteenths, or to eighth-note triplets when clearly closer. */
function snap(pos: number, triplets: boolean): number {
  const q16 = Math.round(pos * 4) / 4;
  if (!triplets) return q16;
  const q12 = Math.round(pos * 3) / 3;
  const e16 = Math.abs(pos - q16);
  const e12 = Math.abs(pos - q12);
  // Only clearly-triplet timing counts; small timing errors in straight music stay on sixteenths.
  return e16 > 0.09 && e12 < 0.035 ? q12 : q16;
}

// ---------------------------------------------------------------------------------------------
// Expert transcription

function pitchedExpert(line: PitchedNote[], grid: Grid, duration: number, chords: boolean): Ev[] {
  const byPos = new Map<number, Ev>();
  for (const n of line) {
    if (n.t < 0.2 || n.t > duration - 0.05) continue;
    const pos = snap(grid.pos(n.t), true);
    const endPos = grid.pos(n.t + n.dur);
    const ev: Ev = {
      pos,
      len: Math.max(0, endPos - pos),
      midi: n.midi,
      strength: n.strength,
      ...(chords && n.chord && n.chord.length > 1 ? { chord: n.chord } : {}),
    };
    const key = Math.round(pos * 48);
    const prev = byPos.get(key);
    if (!prev || ev.strength > prev.strength) byPos.set(key, ev);
  }
  return [...byPos.values()].sort((a, b) => a.pos - b.pos);
}

function drumsExpert(a: AnalysisResult, grid: Grid): Ev[] {
  const byKey = new Map<string, Ev>();
  for (const d of a.drums) {
    if (d.t < 0.2 || d.t > a.duration - 0.05) continue;
    const pos = snap(grid.pos(d.t), true);
    const key = `${Math.round(pos * 48)}:${d.kind}`;
    const prev = byKey.get(key);
    if (!prev || d.strength > prev.strength) byKey.set(key, { pos, len: 0, midi: 0, strength: d.strength, kind: d.kind });
  }
  return [...byKey.values()].sort((x, y) => x.pos - y.pos || kindOrder(x.kind!) - kindOrder(y.kind!));
}

const kindOrder = (k: DrumKind) => (k === 'kick' ? 0 : k === 'snare' ? 1 : 2);

// ---------------------------------------------------------------------------------------------
// Reductions: each difficulty simplifies the one above it.

/** Keeps events on the profile's grid; lone off-grid notes move to the nearest free grid slot. */
function reduceRhythm(evs: Ev[], p: DifficultyProfile, spb: number, drums: boolean): Ev[] {
  const step = 1 / p.grid;
  const kept = new Map<number, Ev[]>();
  const key = (pos: number) => Math.round(pos * 48);
  const onGrid = (pos: number) => isMultiple(pos, step) || (p.triplets && isMultiple(pos, 1 / 3));
  for (const e of evs) if (onGrid(e.pos)) kept.set(key(e.pos), [...(kept.get(key(e.pos)) ?? []), e]);
  if (!drums) {
    // A note off the grid with no neighbour on its grid slot keeps its place in the melody, moved.
    for (const e of evs) {
      if (onGrid(e.pos)) continue;
      const target = Math.round(e.pos / step) * step;
      if (kept.has(key(target))) continue;
      const near = evs.some((o) => o !== e && Math.abs(o.pos - target) < step * 0.75 && o.strength >= e.strength);
      if (!near) kept.set(key(target), [{ ...e, pos: target, len: Math.max(0, e.len - (target - e.pos)) }]);
    }
  }
  // Minimum spacing in seconds: drop the weaker note of a too-fast pair (strong beats win ties).
  const times = [...kept.entries()].sort((x, y) => x[0] - y[0]);
  const weight = (pos: number, list: Ev[]) =>
    Math.max(...list.map((e) => e.strength)) * (isMultiple(pos, 1) ? 1.3 : isMultiple(pos, 0.5) ? 1.12 : 1);
  const out: [number, Ev[]][] = [];
  for (const [k, list] of times) {
    const pos = k / 48;
    const last = out[out.length - 1];
    if (last && (pos - last[0] / 48) * spb < p.minGap - EPS) {
      if (weight(pos, list) > weight(last[0] / 48, last[1])) out[out.length - 1] = [k, list];
      continue;
    }
    out.push([k, list]);
  }
  return out.flatMap(([, list]) => list);
}

function reduceDrums(evs: Ev[], d: Difficulty): Ev[] {
  if (d === 'expert') return evs;
  return evs.filter((e) => {
    if (e.kind !== 'hat') return true;
    // Hi-hats thin out first: none on easy, quarters on medium, eighths on hard.
    if (d === 'easy') return false;
    return d === 'medium' ? isMultiple(e.pos, 1) : isMultiple(e.pos, 0.5);
  });
}

// ---------------------------------------------------------------------------------------------
// Lane assignment for pitched parts

interface PhraseCtx {
  lanes: number;
  partLo: number;
  partHi: number;
  memo: Map<string, number[]>;
}

/** Lane step for an interval: small steps move one lane, leaps more. */
const stepFor = (interval: number) => (interval <= 4 ? 1 : interval <= 9 ? 2 : 3);

/**
 * Lanes for one segment with at most `lanes` distinct pitches: lowest pitch to the left, highest to
 * the right, the same pitch always in the same lane, wider intervals further apart. The block sits
 * where the segment's register falls within the part's overall range.
 */
function segmentLanes(pitches: number[], ctx: PhraseCtx, anchor?: { lane: number; midi: number; firstMidi: number }): Map<number, number> {
  const distinct = [...new Set(pitches)].sort((a, b) => a - b);
  const pos: number[] = [0];
  for (let i = 1; i < distinct.length; i++) pos.push(pos[i - 1] + stepFor(distinct[i] - distinct[i - 1]));
  let span = pos[pos.length - 1];
  if (span > ctx.lanes - 1) {
    // Too wide: fall back to plain ranks, which always fit.
    for (let i = 0; i < pos.length; i++) pos[i] = i;
    span = distinct.length - 1;
  }
  const room = ctx.lanes - 1 - span;
  let offset: number;
  if (anchor) {
    // Continue from the previous segment in the direction the melody moves.
    const idx = distinct.indexOf(anchor.firstMidi);
    const dir = Math.sign(anchor.firstMidi - anchor.midi);
    const want = Math.max(0, Math.min(ctx.lanes - 1, anchor.lane + (dir === 0 ? 0 : dir)));
    offset = Math.max(0, Math.min(room, want - pos[idx]));
  } else {
    const median = [...pitches].sort((a, b) => a - b)[pitches.length >> 1];
    const reg = ctx.partHi > ctx.partLo ? (median - ctx.partLo) / (ctx.partHi - ctx.partLo) : 0.5;
    offset = Math.round(Math.max(0, Math.min(1, reg)) * room);
  }
  return new Map(distinct.map((m, i) => [m, pos[i] + offset]));
}

/** Lanes for a phrase (melody pitches in order). Long runs are wrapped into segments. */
function phraseLanes(pitches: number[], ctx: PhraseCtx): number[] {
  const out: number[] = [];
  let start = 0;
  let prev: { lane: number; midi: number } | undefined;
  while (start < pitches.length) {
    const seen = new Set<number>();
    let end = start;
    while (end < pitches.length && (seen.has(pitches[end]) || seen.size < ctx.lanes)) seen.add(pitches[end++]);
    const seg = pitches.slice(start, end);
    const map = segmentLanes(seg, ctx, prev ? { ...prev, firstMidi: seg[0] } : undefined);
    for (const m of seg) out.push(map.get(m)!);
    prev = { lane: out[out.length - 1], midi: seg[seg.length - 1] };
    start = end;
  }
  return out;
}

/** Splits events into phrases at rests and every two bars; repeated phrases reuse their lanes. */
function assignPitchedLanes(evs: Ev[], downbeats: number[], ctx: PhraseCtx): number[] {
  const barOf = (pos: number) => {
    if (!downbeats.length || pos < downbeats[0] - EPS) return -1;
    let lo = 0;
    let hi = downbeats.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (downbeats[mid] <= pos + EPS) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const lanes: number[] = new Array(evs.length);
  let i = 0;
  while (i < evs.length) {
    const group = Math.floor(barOf(evs[i].pos) / 2);
    let j = i + 1;
    while (j < evs.length && Math.floor(barOf(evs[j].pos) / 2) === group && evs[j].pos - (evs[j - 1].pos + evs[j - 1].len) < 1.5) j++;
    const phrase = evs.slice(i, j);
    const bar = barOf(phrase[0].pos);
    const origin = phrase[0].pos - (bar >= 0 ? downbeats[bar] : 0);
    const sig = phrase.map((e) => `${(e.pos - phrase[0].pos).toFixed(3)}:${e.midi}`).join(',') + `@${origin.toFixed(3)}`;
    let ls = ctx.memo.get(sig);
    if (!ls) {
      ls = phraseLanes(
        phrase.map((e) => e.midi),
        ctx,
      );
      ctx.memo.set(sig, ls);
    }
    for (let k = 0; k < phrase.length; k++) lanes[i + k] = ls[k];
    i = j;
  }
  return lanes;
}

/** Chord lanes ending on the melody lane: the interval decides how far apart the notes sit. */
function chordShape(top: number, chord: number[], p: DifficultyProfile): number[] {
  const span = chord[chord.length - 1] - chord[0];
  const pcs = new Set(chord.map((m) => m % 12)).size;
  const three = p.maxChord >= 3 && pcs >= 3 && chord.length >= 3;
  const gap = Math.min(span <= 4 ? 1 : span <= 8 ? 2 : 3, p.maxChordSpread);
  if (gap < 1) return [top];
  let shape = three ? [-2, -1, 0] : [-gap, 0];
  if (three && span > 8 && p.lanes === 5) shape = [-4, -2, 0];
  const lowest = top + shape[0];
  const shift = lowest < 0 ? -lowest : 0;
  return shape.map((s) => Math.min(p.lanes - 1, top + s + shift));
}

// ---------------------------------------------------------------------------------------------
// Overdrive: the same musical windows on every difficulty

function overdriveWindows(expert: Ev[], a: AnalysisResult, grid: Grid, r: () => number): [number, number][] {
  if (a.downbeats.length < 8 || expert.length < 8) return [];
  const barPos = a.downbeats;
  const energyAt = (t: number) => a.sections.find((s) => t >= s.start && t < s.end)?.energy ?? 0.6;
  const windows: [number, number][] = [];
  let bar = 4 + Math.floor(r() * 4);
  while (bar < barPos.length - 2) {
    let best = bar;
    for (let k = bar; k < Math.min(barPos.length - 2, bar + 4); k++) {
      if (energyAt(grid.time(barPos[k])) > energyAt(grid.time(barPos[best])) + 0.1) best = k;
    }
    const count = (l: number) => expert.filter((e) => e.pos >= barPos[best] - EPS && e.pos < (barPos[best + l] ?? Infinity) - EPS).length;
    const len = count(1) < 4 ? 2 : 1;
    if (count(len) >= 3) windows.push([barPos[best], barPos[best + len] ?? barPos[best] + 4 * len]);
    bar = best + len + 7 + Math.floor(r() * 6);
  }
  return windows;
}

// ---------------------------------------------------------------------------------------------

function lineFor(a: AnalysisResult, part: Part): PitchedNote[] {
  if (part === 'bass') return a.bass;
  if (part === 'vocals') return a.vocals ?? [];
  return a.lead;
}

function medianInterval(beats: number[], tempo: number) {
  const intervals = beats
    .slice(1)
    .map((b, i) => b - beats[i])
    .sort((x, y) => x - y);
  return intervals.length ? intervals[Math.floor(intervals.length / 2)] : 60 / (tempo || 120);
}

/** Builds a playable chart for one part and difficulty from an analysis result. */
export function generateChart(a: AnalysisResult, part: Part, difficulty: Difficulty, seedKey = ''): Chart {
  return generateAll(a, part, seedKey)[difficulty];
}

/**
 * Builds all difficulties of a part together: expert is transcribed, then each difficulty reduces
 * the one above it, so lower difficulties keep the same musical skeleton.
 */
export function generateAll(a: AnalysisResult, part: Part, seedKey = ''): Record<Difficulty, Chart> {
  const spb = medianInterval(a.beats, a.tempo);
  const grid = new Grid(a.beats, spb);
  const r = rng(seedFrom(`${seedKey}:${part}:${CHART_VERSION}`));
  const drums = part === 'drums';
  const line = lineFor(a, part);

  const expertEvs = drums ? drumsExpert(a, grid) : pitchedExpert(line, grid, a.duration, part === 'lead');
  const windows = overdriveWindows(expertEvs, a, grid, r);
  const midis = line.map((n) => n.midi).sort((x, y) => x - y);
  const partLo = midis[Math.floor(midis.length * 0.05)] ?? 48;
  const partHi = midis[Math.floor(midis.length * 0.95)] ?? 72;

  const out = {} as Record<Difficulty, Chart>;
  let source = expertEvs;
  for (const d of [...DIFFICULTIES].reverse()) {
    const p = PROFILES[d];
    const evs = drums ? reduceRhythm(reduceDrums(source, d), p, spb, true) : reduceRhythm(source, p, spb, false);
    const notes = drums
      ? drumNotes(evs, p, d)
      : pitchedNotes(evs, p, d, a.downbeats, { lanes: p.lanes, partLo, partHi, memo: new Map() });
    const timed: Note[] = notes.map((n) => ({ ...n, t: grid.time(n.t), dur: n.dur > 0 ? grid.time(n.t + n.dur) - grid.time(n.t) : 0 }));
    timed.sort((x, y) => x.t - y.t || x.lane - y.lane);
    const clean = validate(timed, p.lanes, p, spb);
    windows.forEach(([s, e], id) => {
      const ts = grid.time(s) - 1e-3;
      const te = grid.time(e) - 1e-3;
      const members = clean.filter((n) => n.t >= ts && n.t < te);
      if (members.length >= 2) for (const n of members) n.phrase = id;
    });
    out[d] = {
      part,
      difficulty: d,
      lanes: p.lanes,
      notes: clean,
      beats: a.beats,
      downbeats: a.downbeats,
      secondsPerBeat: spb,
      duration: a.duration,
    };
    source = evs;
  }
  return out;
}

/** Notes in beat positions (t and dur are positions here; converted to seconds by the caller). */
function pitchedNotes(evs: Ev[], p: DifficultyProfile, d: Difficulty, downbeats: number[], ctx: PhraseCtx): Note[] {
  // Easy plays the root of a chord; everything else keeps the melody (top) note.
  const melody = evs.map((e) => (d === 'easy' && e.chord ? e.chord[0] : e.midi));
  const lanes = assignPitchedLanes(
    evs.map((e, i) => ({ ...e, midi: melody[i] })),
    downbeats,
    ctx,
  );
  const notes: Note[] = [];
  evs.forEach((e, i) => {
    const next = evs[i + 1];
    let len = e.len >= p.sustainBeats ? e.len : 0;
    if (len && next) len = Math.min(len, next.pos - e.pos - p.sustainGapBeats);
    if (len < p.sustainBeats * 0.75) len = 0;
    const shape = e.chord && p.maxChord >= 2 && d !== 'easy' ? chordShape(lanes[i], e.chord, p) : [lanes[i]];
    for (const lane of new Set(shape)) notes.push({ t: e.pos, lane, dur: len, phrase: -1 });
  });
  return notes;
}

const DRUM_LANES: Record<4 | 5, Record<DrumKind, [number, number]>> = {
  4: { kick: [0, 1], snare: [2, 1], hat: [3, 2] },
  5: { kick: [0, 1], snare: [2, 3], hat: [4, 3] },
};

/** Fixed kit layout (kick left, snare middle, hats right); quick repeats alternate hands. */
function drumNotes(evs: Ev[], p: DifficultyProfile, d: Difficulty): Note[] {
  const notes: Note[] = [];
  const last: Record<DrumKind, { lane: number; pos: number; bar: number }> = {
    kick: { lane: -1, pos: -9, bar: -1 },
    snare: { lane: -1, pos: -9, bar: -1 },
    hat: { lane: -1, pos: -9, bar: -1 },
  };
  const byPos = new Map<number, Ev[]>();
  for (const e of evs) byPos.set(Math.round(e.pos * 48), [...(byPos.get(Math.round(e.pos * 48)) ?? []), e]);
  for (const [, group] of [...byPos.entries()].sort((x, y) => x[0] - y[0])) {
    let hits = [...group].sort((x, y) => y.strength - x.strength);
    if (d === 'easy') {
      // One hit per beat: backbeat snares, otherwise kick.
      const snare = hits.find((h) => h.kind === 'snare');
      const kick = hits.find((h) => h.kind === 'kick');
      const backbeat = snare && Math.round(snare.pos) % 2 === 1;
      hits = [(backbeat || !kick ? snare : kick) ?? hits[0]];
    }
    // Chords on lower difficulties: only strong kick+snare backbeats, so the kit doesn't turn into
    // constant two-hand hits.
    const backbeat = isMultiple(group[0].pos, 1) && Math.round(group[0].pos) % 2 === 1;
    const allowChord = d === 'expert' || (d === 'hard' ? hits[1]?.strength >= 0.45 : backbeat && hits[1]?.strength >= 0.5);
    hits = hits.slice(0, allowChord ? p.maxChord : 1);
    const taken = new Set<number>();
    for (const h of hits) {
      const [first, second] = DRUM_LANES[p.lanes][h.kind!];
      const prev = last[h.kind!];
      const bar = Math.floor(h.pos / 4);
      // Alternate on quick repeats; reset each bar so repeated bars chart identically.
      let lane = prev.bar === bar && prev.lane === first && h.pos - prev.pos <= 0.5 + EPS ? second : first;
      if (taken.has(lane)) lane = lane === first ? second : first;
      if (taken.has(lane)) continue;
      taken.add(lane);
      last[h.kind!] = { lane, pos: h.pos, bar };
      notes.push({ t: h.pos, lane, dur: 0, phrase: -1 });
    }
  }
  return notes;
}

/** Removes duplicates and makes sure sustains never run into later notes. */
export function validate(notes: Note[], lanes: number, p: DifficultyProfile, spb: number): Note[] {
  const out: Note[] = [];
  const seen = new Set<string>();
  for (const n of notes) {
    if (n.lane < 0 || n.lane >= lanes || !Number.isFinite(n.t)) continue;
    const k = `${n.t.toFixed(4)}:${n.lane}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...n });
  }
  const gap = Math.max(0.05, spb * p.sustainGapBeats);
  for (let i = 0; i < out.length; i++) {
    const n = out[i];
    if (n.dur <= 0) continue;
    for (let j = i + 1; j < out.length && out[j].t < n.t + n.dur + gap; j++) {
      const m = out[j];
      if (m.t <= n.t + 1e-6) continue;
      n.dur = Math.min(n.dur, m.t - n.t - gap);
    }
    if (n.dur < spb * 0.4) n.dur = 0;
  }
  return out;
}
