import type { Chart } from '../chart/types';
import { gradeFor, WINDOWS, type Grade } from './judge';
import { multiplierFor, NOTE_POINTS, starsFor, SUSTAIN_POINTS_PER_BEAT } from './scoring';

export type GameEvent =
  | { type: 'hit'; lane: number; grade: Grade; noteIndex: number }
  | { type: 'miss'; lane: number; noteIndex: number }
  | { type: 'ghost'; lane: number }
  | { type: 'sustain-end'; lane: number; complete: boolean }
  | { type: 'release'; lane: number; grade: Grade; noteIndex: number }
  | { type: 'release-miss'; lane: number; noteIndex: number; early: boolean }
  | { type: 'phrase-complete'; phrase: number }
  | { type: 'phrase-failed'; phrase: number }
  | { type: 'overdrive-start' }
  | { type: 'overdrive-end' };

const enum NoteState {
  Pending = 0,
  Hit = 1,
  Missed = 2,
}

/** How early a sustain may be released and still count as complete. */
const SUSTAIN_RELEASE_GRACE = 0.12;
/** Fraction of the overdrive meter a completed phrase awards. */
export const PHRASE_REWARD = 0.25;
/** Beats of overdrive per PHRASE_REWARD of meter. */
const BEATS_PER_REWARD = 8;

export interface Results {
  score: number;
  stars: number;
  accuracy: number;
  counts: Record<Grade | 'miss', number>;
  bestStreak: number;
  totalNotes: number;
  fullCombo: boolean;
  overdriveActivations: number;
  /** Hold-and-release notes let go on time, of all release notes in the chart. */
  releases: { hit: number; total: number };
}

/**
 * Pure gameplay state machine. It knows nothing about audio or rendering:
 * callers feed it song time (seconds) and lane presses/releases.
 */
export class GameSession {
  readonly chart: Chart;
  readonly state: Uint8Array;
  /** Per-lane index of the note currently being sustained, or -1. */
  readonly holding: Int32Array;
  readonly laneDown: Uint8Array;
  /** Per note: 0 = release pending (or not a release note), 1 = released on time, 2 = missed. */
  readonly releaseState: Uint8Array;
  releasesHit = 0;

  score = 0;
  streak = 0;
  bestStreak = 0;
  overdrive = 0;
  overdriveActive = false;
  overdriveActivations = 0;
  counts: Record<Grade | 'miss', number> = { perfect: 0, great: 0, good: 0, miss: 0 };

  private cursor = 0;
  private lastTime = 0;
  private readonly phraseFailed = new Set<number>();
  private readonly phraseLast = new Map<number, number>();
  private readonly baseScore: number;
  private listeners: ((e: GameEvent) => void)[] = [];

  constructor(chart: Chart) {
    this.chart = chart;
    this.state = new Uint8Array(chart.notes.length);
    this.holding = new Int32Array(chart.lanes).fill(-1);
    this.laneDown = new Uint8Array(chart.lanes);
    this.releaseState = new Uint8Array(chart.notes.length);
    let base = 0;
    chart.notes.forEach((n, i) => {
      base += NOTE_POINTS.perfect + (n.dur / chart.secondsPerBeat) * SUSTAIN_POINTS_PER_BEAT + (n.release ? NOTE_POINTS.perfect : 0);
      if (n.phrase >= 0) this.phraseLast.set(n.phrase, i);
    });
    this.baseScore = base;
  }

  on(fn: (e: GameEvent) => void) {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((l) => l !== fn));
  }

  private emit(e: GameEvent) {
    for (const l of this.listeners) l(e);
  }

  get multiplier() {
    return multiplierFor(this.streak) * (this.overdriveActive ? 2 : 1);
  }

  press(lane: number, t: number) {
    if (lane < 0 || lane >= this.chart.lanes) return;
    this.laneDown[lane] = 1;
    const notes = this.chart.notes;
    let best = -1;
    for (let i = this.cursor; i < notes.length; i++) {
      const n = notes[i];
      if (n.t - t > WINDOWS.good) break;
      if (n.lane !== lane || this.state[i] !== NoteState.Pending) continue;
      if (Math.abs(n.t - t) <= WINDOWS.good) {
        best = i;
        break;
      }
    }
    if (best < 0) {
      this.streak = 0;
      this.emit({ type: 'ghost', lane });
      return;
    }
    const n = notes[best];
    const grade = gradeFor(t - n.t)!;
    this.state[best] = NoteState.Hit;
    this.counts[grade]++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.score += NOTE_POINTS[grade] * this.multiplier;
    if (n.dur > 0) this.holding[lane] = best;
    this.emit({ type: 'hit', lane, grade, noteIndex: best });
    this.checkPhrase(best);
  }

  release(lane: number, t: number) {
    if (lane < 0 || lane >= this.chart.lanes) return;
    this.laneDown[lane] = 0;
    const idx = this.holding[lane];
    if (idx < 0) return;
    const n = this.chart.notes[idx];
    this.holding[lane] = -1;
    const end = n.t + n.dur;
    if (n.release) {
      // Let go within the timing windows of the end: a graded release; earlier is a miss.
      const grade = gradeFor(t - end);
      if (grade) this.releaseHit(idx, lane, grade);
      else this.releaseMiss(idx, lane, true);
      this.emit({ type: 'sustain-end', lane, complete: grade !== null });
      return;
    }
    this.emit({ type: 'sustain-end', lane, complete: t >= end - SUSTAIN_RELEASE_GRACE });
  }

  private releaseHit(i: number, lane: number, grade: Grade) {
    this.releaseState[i] = 1;
    this.releasesHit++;
    this.score += NOTE_POINTS[grade] * this.multiplier;
    this.emit({ type: 'release', lane, grade, noteIndex: i });
  }

  private releaseMiss(i: number, lane: number, early: boolean) {
    this.releaseState[i] = 2;
    this.streak = 0;
    this.emit({ type: 'release-miss', lane, noteIndex: i, early });
  }

  /**
   * Ends every hold without judging it (pausing rewinds the song, so a hold can't be finished).
   * A release note dropped this way counts as not released, but doesn't break the streak.
   */
  dropHolds() {
    for (let lane = 0; lane < this.holding.length; lane++) {
      this.laneDown[lane] = 0;
      const idx = this.holding[lane];
      if (idx < 0) continue;
      this.holding[lane] = -1;
      if (this.chart.notes[idx].release) this.releaseState[idx] = 2;
      this.emit({ type: 'sustain-end', lane, complete: false });
    }
  }

  isReleased(i: number) {
    return this.releaseState[i] === 1;
  }

  isReleaseMissed(i: number) {
    return this.releaseState[i] === 2;
  }

  activateOverdrive() {
    if (this.overdriveActive || this.overdrive < PHRASE_REWARD) return false;
    this.overdriveActive = true;
    this.overdriveActivations++;
    this.emit({ type: 'overdrive-start' });
    return true;
  }

  /** Advance to song time t: scores sustains, drains overdrive, registers misses. */
  update(t: number) {
    const dt = Math.max(0, t - this.lastTime);
    this.lastTime = t;
    const notes = this.chart.notes;
    const spb = this.chart.secondsPerBeat;

    for (let lane = 0; lane < this.holding.length; lane++) {
      const idx = this.holding[lane];
      if (idx < 0) continue;
      const n = notes[idx];
      const end = n.t + n.dur;
      const from = Math.max(n.t, t - dt);
      const to = Math.min(end, t);
      if (to > from) this.score += ((to - from) / spb) * SUSTAIN_POINTS_PER_BEAT * this.multiplier;
      if (n.release) {
        // Still holding once the release window has passed: too late.
        if (t > end + WINDOWS.good) {
          this.holding[lane] = -1;
          this.releaseMiss(idx, lane, false);
          this.emit({ type: 'sustain-end', lane, complete: false });
        }
      } else if (t >= end) {
        this.holding[lane] = -1;
        this.emit({ type: 'sustain-end', lane, complete: true });
      }
    }

    if (this.overdriveActive) {
      this.overdrive -= (dt / (BEATS_PER_REWARD * spb)) * PHRASE_REWARD;
      if (this.overdrive <= 0) {
        this.overdrive = 0;
        this.overdriveActive = false;
        this.emit({ type: 'overdrive-end' });
      }
    }

    while (this.cursor < notes.length) {
      const i = this.cursor;
      const n = notes[i];
      if (this.state[i] === NoteState.Pending) {
        if (t - n.t <= WINDOWS.good) break;
        this.state[i] = NoteState.Missed;
        if (n.release) this.releaseState[i] = 2;
        this.counts.miss++;
        this.streak = 0;
        this.emit({ type: 'miss', lane: n.lane, noteIndex: i });
        if (n.phrase >= 0 && !this.phraseFailed.has(n.phrase)) {
          this.phraseFailed.add(n.phrase);
          this.emit({ type: 'phrase-failed', phrase: n.phrase });
        }
      }
      this.cursor++;
    }
  }

  isHit(i: number) {
    return this.state[i] === NoteState.Hit;
  }

  isMissed(i: number) {
    return this.state[i] === NoteState.Missed;
  }

  isPhraseFailed(phrase: number) {
    return this.phraseFailed.has(phrase);
  }

  private checkPhrase(i: number) {
    const p = this.chart.notes[i].phrase;
    if (p < 0 || this.phraseFailed.has(p) || this.phraseLast.get(p) !== i) return;
    // The last note of a phrase was hit; every earlier note must have been hit too.
    for (let j = i; j >= 0 && this.chart.notes[j].t >= this.chart.notes[i].t - 60; j--) {
      if (this.chart.notes[j].phrase === p && this.state[j] !== NoteState.Hit) {
        this.phraseFailed.add(p);
        this.emit({ type: 'phrase-failed', phrase: p });
        return;
      }
    }
    this.overdrive = Math.min(1, this.overdrive + PHRASE_REWARD);
    this.emit({ type: 'phrase-complete', phrase: p });
  }

  get progressStars() {
    return starsFor(this.score, this.baseScore);
  }

  results(): Results {
    const total = this.chart.notes.length;
    const hits = this.counts.perfect + this.counts.great + this.counts.good;
    return {
      score: Math.round(this.score),
      stars: starsFor(this.score, this.baseScore),
      accuracy: total ? hits / total : 0,
      counts: { ...this.counts },
      bestStreak: this.bestStreak,
      totalNotes: total,
      fullCombo: total > 0 && hits === total,
      overdriveActivations: this.overdriveActivations,
      releases: { hit: this.releasesHit, total: this.chart.notes.filter((n) => n.release).length },
    };
  }
}
