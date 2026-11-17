import type { Chart } from '../chart/types';

/** Gaps without notes at least this long (seconds) get a countdown. */
export const BREAK_MIN = 5;
/** The countdown appears this long after the last note (or its sustain) ends... */
const SHOW_AFTER = 0.6;
/** ...and is gone this long before the next note. */
const HIDE_BEFORE = 0.25;

export interface Break {
  /** When the countdown shows and hides (seconds). */
  from: number;
  to: number;
  /** When the next note arrives: the countdown reaches zero here. */
  next: number;
  /** Length of the whole gap, for the countdown ring. */
  length: number;
}

/** Long stretches without notes, including an intro before the first note. */
export function findBreaks(chart: Chart, min = BREAK_MIN): Break[] {
  const out: Break[] = [];
  let free = 0;
  for (const n of chart.notes) {
    if (n.t - free >= min) out.push({ from: free + (free > 0 ? SHOW_AFTER : 0), to: n.t - HIDE_BEFORE, next: n.t, length: n.t - free });
    free = Math.max(free, n.t + n.dur);
  }
  return out;
}
