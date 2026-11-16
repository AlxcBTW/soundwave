import type { AnalysisResult, DrumKind, PitchedNote } from '../analysis/types';
import { PROFILES, type DifficultyProfile } from './profiles';
import type { Chart, Difficulty, Note, Part } from './types';

export const CHART_VERSION = 1;

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

interface Candidate {
  t: number;
  /** Position in beats (fractional). */
  pos: number;
  priority: number;
  kind?: DrumKind;
  midi?: number;
  /** Seconds, for pitched notes. */
  dur: number;
  /** Harmony changes here: a chord is musically justified. */
  chordHint: boolean;
}

/** Maps times to beat positions and back using the (possibly uneven) beat grid. */
class Grid {
  constructor(
    private readonly beats: number[],
    private readonly spb: number,
  ) {}

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

  snap(t: number, subdivision: number): { t: number; pos: number } {
    const pos = Math.round(this.pos(t) * subdivision) / subdivision;
    return { t: this.time(pos), pos };
  }
}

function metricWeight(pos: number, downbeats: Set<number>) {
  const beat = Math.round(pos);
  const onBeat = Math.abs(pos - beat) < 1e-6;
  const frac = pos - Math.floor(pos);
  let w = 1;
  if (onBeat) w += 0.4;
  else if (Math.abs(frac - 0.5) < 1e-6) w += 0.15;
  if (onBeat && downbeats.has(beat)) w += 0.3;
  return w;
}

const DRUM_WEIGHT: Record<DrumKind, number> = { kick: 1.1, snare: 1.15, hat: 0.6 };

/** Drum kinds share lanes so the kit reads left (kick) to right (cymbals). */
const DRUM_LANES: Record<4 | 5, Record<DrumKind, [number, number]>> = {
  4: { kick: [0, 1], snare: [2, 1], hat: [3, 2] },
  5: { kick: [0, 1], snare: [2, 3], hat: [4, 3] },
};

function rootAt(a: AnalysisResult, t: number) {
  let root = a.key?.tonic ?? 0;
  for (const h of a.harmony) {
    if (h.t > t) break;
    root = h.root;
  }
  return root;
}

/** Candidates for a part. Sparse melodic parts are filled with rhythm from the drums. */
function candidates(a: AnalysisResult, part: Part, p: DifficultyProfile, grid: Grid, downbeats: Set<number>): Candidate[] {
  const out: Candidate[] = [];
  const changeTimes = a.harmony.filter((h) => h.strength >= 0.5).map((h) => h.t);
  const nearChange = (t: number) => changeTimes.some((c) => Math.abs(c - t) < 0.12);

  const push = (t: number, strength: number, extra: Partial<Candidate>) => {
    const s = grid.snap(t, p.subdivision);
    out.push({ t: s.t, pos: s.pos, priority: strength * metricWeight(s.pos, downbeats), dur: 0, chordHint: false, ...extra });
  };

  if (part === 'drums') {
    for (const d of a.drums) {
      if (d.kind === 'hat' && !p.hats) continue;
      push(d.t, d.strength * DRUM_WEIGHT[d.kind], { kind: d.kind });
    }
    return out;
  }

  const line: PitchedNote[] = part === 'bass' ? a.bass : a.lead;
  for (const n of line) push(n.t, 0.35 + 0.65 * n.strength, { midi: n.midi, dur: n.dur, chordHint: part === 'lead' && nearChange(n.t) });

  // Fill sections where the line is too sparse to be fun.
  const minPerSec = 0.35;
  for (const s of a.sections) {
    const count = line.filter((n) => n.t >= s.start && n.t < s.end).length;
    if (count >= (s.end - s.start) * minPerSec) continue;
    // Walk chord tones so filled passages still have a melodic contour.
    const tones = [0, 7, 4, 12, 7, 0, 4, 7];
    let step = 0;
    for (const d of a.drums) {
      if (d.t < s.start || d.t >= s.end) continue;
      const wanted = part === 'bass' ? d.kind === 'kick' : d.kind !== 'kick';
      if (!wanted) continue;
      const h = a.harmony.findLast((x) => x.t <= d.t);
      const third = h?.minor ? 3 : 4;
      const tone = tones[step++ % tones.length];
      const interval = tone === 4 ? third : tone;
      const midi = (part === 'bass' ? 36 : 60) + rootAt(a, d.t) + (part === 'bass' ? (tone === 7 ? 7 : 0) : interval);
      push(d.t, 0.25 + 0.5 * d.strength, { midi, dur: 0, chordHint: false });
    }
    for (const h of a.harmony) {
      if (h.t < s.start || h.t >= s.end) continue;
      const midi = (part === 'bass' ? 36 : 60) + h.root;
      push(h.t, 0.4 + 0.4 * h.strength, { midi, dur: 0.5, chordHint: part === 'lead' });
    }
  }
  return out;
}

/** Groups candidates by snapped time; keeps the best per drum kind, or the best pitched note. */
function mergeByTime(cands: Candidate[], part: Part): Map<number, Candidate[]> {
  const byPos = new Map<number, Candidate[]>();
  for (const c of cands) {
    const key = Math.round(c.pos * 48);
    const list = byPos.get(key) ?? [];
    const sameIdx = list.findIndex((x) => (part === 'drums' ? x.kind === c.kind : true));
    if (sameIdx >= 0) {
      const x = list[sameIdx];
      if (c.priority > x.priority) list[sameIdx] = { ...c, chordHint: c.chordHint || x.chordHint, dur: Math.max(c.dur, x.dur) };
      else x.chordHint ||= c.chordHint;
    } else list.push(c);
    byPos.set(key, list);
  }
  return byPos;
}

/** Picks note times by priority under a per-section density budget and a minimum gap. */
function selectTimes(groups: Candidate[][], a: AnalysisResult, p: DifficultyProfile, spb: number): Candidate[][] {
  const scored = groups
    .map((g) => ({ g, t: g[0].t, prio: Math.max(...g.map((c) => c.priority)) }))
    .filter((x) => x.prio >= p.minPriority && x.t >= 0.25 && x.t <= a.duration - 0.1)
    .sort((x, y) => y.prio - x.prio);
  const sectionOf = (t: number) => Math.max(0, a.sections.findIndex((s) => t >= s.start && t < s.end));
  const budget = a.sections.map((s) => ((s.end - s.start) / spb) * p.notesPerBeat * (0.5 + 0.5 * s.energy));
  const used = a.sections.map(() => 0);
  const accepted: number[] = [];
  const keep: { g: Candidate[]; t: number }[] = [];
  const gapOk = (t: number) => {
    let lo = 0;
    let hi = accepted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (accepted[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    const before = accepted[lo - 1];
    const after = accepted[lo];
    return (before === undefined || t - before >= p.minGap) && (after === undefined || after - t >= p.minGap);
  };
  for (const x of scored) {
    const si = a.sections.length ? sectionOf(x.t) : -1;
    if (si >= 0 && used[si] >= budget[si]) continue;
    if (!gapOk(x.t)) continue;
    let lo = 0;
    while (lo < accepted.length && accepted[lo] < x.t) lo++;
    accepted.splice(lo, 0, x.t);
    keep.push(x);
    if (si >= 0) used[si]++;
  }
  return keep.sort((x, y) => x.t - y.t).map((x) => x.g);
}

const CHORD_SHAPES: Record<4 | 5, Record<2 | 3, number[][]>> = {
  4: { 2: [[0, 2], [1, 3], [0, 1], [2, 3], [1, 2]], 3: [[0, 1, 3], [0, 2, 3], [0, 1, 2], [1, 2, 3]] },
  5: { 2: [[0, 2], [1, 3], [2, 4], [0, 1], [3, 4], [1, 2], [2, 3]], 3: [[0, 2, 4], [0, 1, 3], [1, 3, 4], [0, 1, 2], [2, 3, 4], [1, 2, 4]] },
};

function chordLanes(base: number, size: 2 | 3, lanes: 4 | 5, r: () => number): number[] {
  const shapes = CHORD_SHAPES[lanes][size].filter((s) => s.includes(base));
  const pool = shapes.length ? shapes : CHORD_SHAPES[lanes][size];
  return pool[Math.floor(r() * pool.length)];
}

/** Lane for each pitched note: follows the melodic contour within a sliding pitch range. */
function contourLanes(notes: { t: number; midi: number }[], lanes: number, spb: number): number[] {
  const out: number[] = [];
  const window = spb * 8;
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    while (lo < notes.length && notes[lo].t < n.t - window) lo++;
    while (hi < notes.length && notes[hi].t <= n.t + window) hi++;
    let min = Infinity;
    let max = -Infinity;
    for (let j = lo; j < hi; j++) {
      min = Math.min(min, notes[j].midi);
      max = Math.max(max, notes[j].midi);
    }
    const target = max > min ? Math.round(((n.midi - min) / (max - min)) * (lanes - 1)) : Math.floor(lanes / 2);
    if (i === 0) {
      out.push(target);
      continue;
    }
    const prev = out[i - 1];
    const d = n.midi - notes[i - 1].midi;
    let lane = target;
    if (d === 0) lane = prev;
    else if (d > 0 && lane <= prev) lane = Math.min(lanes - 1, prev + (Math.abs(d) >= 7 ? 2 : 1));
    else if (d < 0 && lane >= prev) lane = Math.max(0, prev - (Math.abs(d) >= 7 ? 2 : 1));
    out.push(Math.max(0, Math.min(lanes - 1, lane)));
  }
  return out;
}

function assignOverdrive(notes: Note[], a: AnalysisResult, grid: Grid, r: () => number) {
  if (!a.downbeats.length || notes.length < 8) return;
  const barStart = a.downbeats.map((i) => a.beats[i]);
  const energyAt = (t: number) => a.sections.find((s) => t >= s.start && t < s.end)?.energy ?? 0.6;
  let phrase = 0;
  let bar = 4 + Math.floor(r() * 4);
  while (bar < barStart.length - 1) {
    // Prefer louder sections: look a few bars ahead for more energy.
    let best = bar;
    for (let k = bar; k < Math.min(barStart.length - 1, bar + 4); k++) if (energyAt(barStart[k]) > energyAt(barStart[best]) + 0.1) best = k;
    let len = 1;
    const inRange = (b: number, l: number) =>
      notes.filter((n) => n.t >= barStart[b] && n.t < (barStart[b + l] ?? grid.time(grid.pos(barStart[b]) + 4 * l)));
    let members = inRange(best, len);
    if (members.length < 4) {
      len = 2;
      members = inRange(best, len);
    }
    if (members.length >= 3) {
      for (const n of members) n.phrase = phrase;
      phrase++;
    }
    bar = best + len + 7 + Math.floor(r() * 6);
  }
}

/** Builds a playable chart for one part and difficulty from an analysis result. */
export function generateChart(a: AnalysisResult, part: Part, difficulty: Difficulty, seedKey = ''): Chart {
  const p = PROFILES[difficulty];
  const lanes = p.lanes;
  const intervals = a.beats.slice(1).map((b, i) => b - a.beats[i]).sort((x, y) => x - y);
  const spb = intervals.length ? intervals[Math.floor(intervals.length / 2)] : 60 / (a.tempo || 120);
  const grid = new Grid(a.beats, spb);
  const downbeats = new Set(a.downbeats);
  const r = rng(seedFrom(`${seedKey}:${part}:${difficulty}:${CHART_VERSION}`));

  const groups = [...mergeByTime(candidates(a, part, p, grid, downbeats), part).values()];
  const chosen = selectTimes(groups, a, p, spb);

  const notes: Note[] = [];
  // Only the strongest simultaneous hits become chords, up to the profile's chord rate.
  const chordScore = (g: Candidate[]) => (g.length < 2 ? 0 : [...g].sort((x, y) => y.priority - x.priority)[1].priority);
  const chordBudget = Math.floor(chosen.length * p.chordRate);
  const chordOk = new Set(
    chosen
      .filter((g) => (part === 'drums' ? g.length > 1 : g.some((c) => c.chordHint)))
      .sort((x, y) => (part === 'drums' ? chordScore(y) - chordScore(x) : Math.max(...y.map((c) => c.priority)) - Math.max(...x.map((c) => c.priority))))
      .slice(0, chordBudget),
  );
  if (part === 'drums') {
    const lastLane: Record<DrumKind, { lane: number; t: number }> = {
      kick: { lane: -1, t: -9 },
      snare: { lane: -1, t: -9 },
      hat: { lane: -1, t: -9 },
    };
    for (const g of chosen) {
      const hits = [...g].sort((x, y) => y.priority - x.priority).slice(0, chordOk.has(g) ? p.maxChord : 1);
      const taken = new Set<number>();
      for (const h of hits) {
        // Without hats (easy) the snare spreads to the right-hand lanes so all four are used.
        const [first, second] = !p.hats && h.kind === 'snare' && lanes === 4 ? [2, 3] : DRUM_LANES[lanes][h.kind!];
        const prev = lastLane[h.kind!];
        // Alternate lanes on quick repeats of the same drum (rolls, 8th-note hats).
        let lane = prev.lane === first && h.t - prev.t <= spb * 1.01 ? second : first;
        if (taken.has(lane)) lane = lane === first ? second : first;
        if (taken.has(lane)) continue;
        taken.add(lane);
        lastLane[h.kind!] = { lane, t: h.t };
        notes.push({ t: h.t, lane, dur: 0, phrase: -1 });
      }
    }
  } else {
    const line = chosen.map((g) => g.reduce((best, c) => (c.priority > best.priority ? c : best)));
    const laneOf = contourLanes(line.map((c) => ({ t: c.t, midi: c.midi ?? 60 })), lanes, spb);
    chosen.forEach((g, i) => {
      const c = line[i];
      const next = line[i + 1];
      let dur = 0;
      if (c.dur >= p.sustainBeats * spb) {
        const end = grid.snap(c.t + c.dur, p.subdivision).t;
        dur = end - c.t;
        if (next) dur = Math.min(dur, next.t - c.t - Math.max(p.minGap, spb * 0.25));
        if (dur < p.sustainBeats * spb * 0.7) dur = 0;
      }
      let size: 1 | 2 | 3 = 1;
      if (p.maxChord >= 2 && chordOk.has(g)) size = 2;
      if (p.maxChord >= 3 && chordOk.has(g) && c.priority > 1.1 && downbeats.has(Math.round(c.pos))) size = 3;
      const ls = size === 1 ? [laneOf[i]] : chordLanes(laneOf[i], size, lanes, r);
      for (const lane of ls) notes.push({ t: c.t, lane, dur: Math.max(0, dur), phrase: -1 });
    });
  }

  notes.sort((x, y) => x.t - y.t || x.lane - y.lane);
  const clean = validate(notes, lanes, p, spb);
  assignOverdrive(clean, a, grid, r);
  return {
    part,
    difficulty,
    lanes,
    notes: clean,
    beats: a.beats,
    downbeats: a.downbeats,
    secondsPerBeat: spb,
    duration: a.duration,
  };
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
  const gap = Math.max(0.06, spb * 0.2);
  for (let i = 0; i < out.length; i++) {
    const n = out[i];
    if (n.dur <= 0) continue;
    for (let j = i + 1; j < out.length && out[j].t < n.t + n.dur + gap; j++) {
      const m = out[j];
      if (m.t <= n.t + 1e-6) continue;
      if (m.lane === n.lane || !p.overlapSustains) n.dur = Math.min(n.dur, m.t - n.t - gap);
    }
    if (n.dur < spb * 0.4) n.dur = 0;
  }
  return out;
}
