/**
 * What the track editor stores for a song: the charts written or changed by hand, and the beat grid
 * they were placed on. A chart that is not in here is the one the game generates from its analysis;
 * a song that has a grid in here can be played without any analysis at all.
 */
import type { AnalysisResult } from '../analysis/types';
import { DIFFICULTIES, lanesFor, PARTS, type Chart, type Difficulty, type Note, type Part } from '../chart/types';
import { buildGrid, MAX_BPM, MIN_BPM, type BeatGrid, type GridSpec } from './grid';

export const EDITS_VERSION = 1;

export type ChartKey = `${Part}:${Difficulty}`;
export const chartKey = (part: Part, difficulty: Difficulty) => `${part}:${difficulty}` as ChartKey;
export const CHART_KEYS: ChartKey[] = PARTS.flatMap((p) => DIFFICULTIES.map((d) => chartKey(p, d)));

export interface SongEdits {
  version: number;
  /** The grid the editor snaps to. Without one, the beats of the song's analysis are used. */
  grid?: GridSpec;
  /** Beats heard in a song that was started from scratch, kept so the grid can follow them again. */
  tracked?: { beats: number[]; downbeats: number[] };
  /** The song's length in seconds, for a song without an analysis to take it from. */
  duration?: number;
  /** Charts made or changed by hand, in seconds like every chart. */
  charts: Partial<Record<ChartKey, Note[]>>;
  updatedAt: number;
}

export const emptyEdits = (): SongEdits => ({ version: EDITS_VERSION, charts: {}, updatedAt: Date.now() });

/** How many of a song's charts were made or changed by hand. */
export const editedCount = (e: SongEdits | undefined) => (e ? Object.keys(e.charts).length : 0);

/** Whether the song can be opened and played without an analysis: it has a grid of its own. */
export const standsAlone = (e: SongEdits | undefined) => !!e?.grid;

/** The shortest a long note may be, in beats; anything shorter is a tap. */
export const MIN_LONG = 0.2;
/** Most notes kept in one chart read from a file. */
const MAX_NOTES = 60_000;
const MAX_BEATS = 200_000;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round4 = (x: number) => Math.round(x * 10000) / 10000;

/**
 * Puts notes in playing order and makes them playable: one note per lane and time, lanes inside the
 * chart, a long note ending before the next note in its lane, and phrases numbered in order.
 * `secondsPerBeat` sizes the shortest long note and the gap left after one.
 */
export function cleanNotes(notes: readonly Note[], lanes: number, secondsPerBeat = 0.5, duration = Infinity): Note[] {
  const sorted = notes
    .filter((n) => n && num(n.t) && num(n.lane) && n.t >= 0 && n.t <= duration && Number.isInteger(n.lane) && n.lane >= 0 && n.lane < lanes)
    .map((n) => ({ ...n, dur: num(n.dur) && n.dur > 0 ? n.dur : 0 }))
    .sort((a, b) => a.t - b.t || a.lane - b.lane);
  const out: Note[] = [];
  const lastInLane: (Note | undefined)[] = [];
  const gap = Math.max(0.04, secondsPerBeat * 0.125);
  const shortest = secondsPerBeat * MIN_LONG;
  for (const n of sorted) {
    const prev = lastInLane[n.lane];
    if (prev && n.t - prev.t < 0.004) continue;
    if (prev && prev.dur > 0 && prev.t + prev.dur > n.t - gap) {
      prev.dur = Math.max(0, n.t - gap - prev.t);
      if (prev.dur < shortest) {
        prev.dur = 0;
        delete prev.release;
      }
    }
    const note: Note = { t: round4(n.t), lane: n.lane, dur: n.dur, phrase: num(n.phrase) && n.phrase >= 0 ? Math.floor(n.phrase) : -1 };
    if (note.dur > 0 && note.dur < shortest) note.dur = 0;
    if (note.t + note.dur > duration) note.dur = Math.max(0, duration - note.t);
    if (n.release && note.dur > 0) note.release = true;
    out.push(note);
    lastInLane[n.lane] = note;
  }
  // Phrases are numbered in the order they start.
  const ids = new Map<number, number>();
  for (const n of out) {
    n.dur = round4(n.dur);
    if (n.phrase < 0) continue;
    if (!ids.has(n.phrase)) ids.set(n.phrase, ids.size);
    n.phrase = ids.get(n.phrase)!;
  }
  return out;
}

function cleanSpec(raw: unknown): GridSpec | undefined {
  const g = raw as GridSpec;
  if (!g || typeof g !== 'object') return undefined;
  if (g.kind === 'fixed') {
    if (!num(g.bpm) || !num(g.offset)) return undefined;
    return {
      kind: 'fixed',
      bpm: Math.min(MAX_BPM, Math.max(MIN_BPM, g.bpm)),
      offset: Math.min(3600, Math.max(-60, g.offset)),
      beatsPerBar: num(g.beatsPerBar) ? Math.min(12, Math.max(1, Math.round(g.beatsPerBar))) : 4,
    };
  }
  if (g.kind === 'beats') {
    const heard = cleanBeats(g);
    return heard ? { kind: 'beats', ...heard } : undefined;
  }
  return undefined;
}

function cleanBeats(raw: unknown): { beats: number[]; downbeats: number[] } | undefined {
  const g = raw as { beats?: unknown; downbeats?: unknown };
  if (!g || !Array.isArray(g.beats) || g.beats.length < 2 || g.beats.length > MAX_BEATS) return undefined;
  const beats = g.beats.filter(num).filter((t) => t >= 0);
  if (beats.length < 2) return undefined;
  const downbeats = Array.isArray(g.downbeats)
    ? g.downbeats.filter(num).filter((i) => Number.isInteger(i) && i >= 0 && i < beats.length)
    : [];
  return { beats, downbeats };
}

/**
 * Edits read from a file or from storage, made safe to use: anything malformed is left out, and
 * every chart is put through `cleanNotes`. Undefined when nothing usable is left.
 */
export function sanitizeEdits(raw: unknown): SongEdits | undefined {
  const e = raw as Partial<SongEdits>;
  if (!e || typeof e !== 'object') return undefined;
  const grid = cleanSpec(e.grid);
  const tracked = cleanBeats(e.tracked);
  const duration = num(e.duration) && e.duration > 0 && e.duration < 24 * 3600 ? e.duration : undefined;
  const charts: SongEdits['charts'] = {};
  const src = e.charts && typeof e.charts === 'object' ? (e.charts as Record<string, unknown>) : {};
  for (const part of PARTS) {
    for (const d of DIFFICULTIES) {
      const list = src[chartKey(part, d)];
      if (!Array.isArray(list) || list.length > MAX_NOTES) continue;
      charts[chartKey(part, d)] = cleanNotes(list as Note[], lanesFor(d), 0.5, duration);
    }
  }
  if (!grid && !Object.keys(charts).length) return undefined;
  return {
    version: EDITS_VERSION,
    ...(grid ? { grid } : {}),
    ...(tracked ? { tracked } : {}),
    ...(duration ? { duration } : {}),
    charts,
    updatedAt: num(e.updatedAt) ? e.updatedAt : Date.now(),
  };
}

/** How long the song is, from whichever knows: its analysis, or what the editor stored. */
export const songDuration = (edits: SongEdits | undefined, analysis: AnalysisResult | undefined, fallback = 0) =>
  analysis?.duration || edits?.duration || fallback;

/** The grid a song's hand-made charts sit on: its own, or the beats of its analysis. */
export function resolveGrid(edits: SongEdits | undefined, analysis: AnalysisResult | undefined, duration: number): BeatGrid | undefined {
  if (edits?.grid) return buildGrid(edits.grid, duration);
  if (analysis && analysis.beats.length >= 2)
    return buildGrid({ kind: 'beats', beats: analysis.beats, downbeats: analysis.downbeats }, duration);
  return undefined;
}

/** A playable chart from hand-placed notes. */
export function chartFromNotes(notes: readonly Note[], part: Part, difficulty: Difficulty, grid: BeatGrid, duration: number): Chart {
  const lanes = lanesFor(difficulty);
  return {
    part,
    difficulty,
    lanes,
    notes: cleanNotes(notes, lanes, grid.secondsPerBeat, duration > 0 ? duration : Infinity),
    beats: grid.beats,
    downbeats: grid.downbeats,
    secondsPerBeat: grid.secondsPerBeat,
    duration,
  };
}

/** Notes of one chart fitted to another's lanes: a fifth lane folds onto the fourth. */
export function fitLanes(notes: readonly Note[], lanes: number): Note[] {
  return notes.map((n) => ({ ...n, lane: Math.min(lanes - 1, n.lane) }));
}
