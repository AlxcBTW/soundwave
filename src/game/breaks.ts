import type { Chart } from '../chart/types';

/** Gaps without notes at least this long (seconds) get a countdown. */
export const BREAK_MIN = 5;
/** The countdown appears this long after the last note (or its sustain) ends. */
const SHOW_AFTER = 0.6;
/** Countdowns that would be visible for less than this (seconds) aren't shown at all. */
const MIN_VISIBLE = 1.5;

export interface Break {
  /** When the countdown shows and hides (seconds). It hides when the next note comes into view. */
  from: number;
  to: number;
  /** When the next note reaches the strike line. */
  next: number;
}

/**
 * Long stretches without notes, including an intro before the first note. `lookahead` is how
 * far ahead (seconds) the highway shows notes: the countdown makes way once the next one appears.
 */
export function findBreaks(chart: Chart, lookahead: number, min = BREAK_MIN): Break[] {
  const out: Break[] = [];
  let free = 0;
  for (const n of chart.notes) {
    if (n.t - free >= min) {
      const from = free + (free > 0 ? SHOW_AFTER : 0);
      const to = n.t - lookahead;
      if (to - from >= MIN_VISIBLE) out.push({ from, to, next: n.t });
    }
    free = Math.max(free, n.t + n.dur);
  }
  return out;
}

/**
 * Bars left before the next note: bar lines still to come before it, plus the bar it falls in.
 * A note on a bar line counts that bar line as the last one.
 */
export function barsLeft(t: number, next: number, barTimes: number[]): number {
  let n = 0;
  for (const b of barTimes) if (b > t && b < next - 0.05) n++;
  return n + 1;
}
