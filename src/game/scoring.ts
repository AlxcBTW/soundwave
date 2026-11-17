import type { Grade } from './judge';

export const NOTE_POINTS: Record<Grade, number> = { perfect: 50, great: 40, good: 25 };
export const SUSTAIN_POINTS_PER_BEAT = 25;
export const STREAK_PER_MULTIPLIER = 10;
/** The top of the streak's ladder: ×6 from a streak of 50. Overdrive doubles whatever the ladder gives. */
export const MAX_MULTIPLIER = 6;
export const OVERDRIVE_FACTOR = 2;

/**
 * Stars are measured against a song's par: the score of a flawless run, every note perfect and the
 * streak never broken, without overdrive. These are the shares of par that earn 1..5 stars.
 */
export const STAR_THRESHOLDS = [0.1, 0.25, 0.42, 0.6, 0.78];
/** Reaching par itself turns the five stars gold: that takes a near-flawless run, or overdrive used well. */
export const GOLD_THRESHOLD = 1;
/** `starsFor` gives this for gold stars: all five, and gold. */
export const GOLD_STARS = 6;

export const multiplierFor = (streak: number) =>
  Math.min(MAX_MULTIPLIER, 1 + Math.floor(streak / STREAK_PER_MULTIPLIER));

/** Every step up the ladder of stars, the gold one last. */
const STEPS = [...STAR_THRESHOLDS, GOLD_THRESHOLD];

/** Stars for a score against the song's par: 0..5, or GOLD_STARS (6) for five gold ones. */
export function starsFor(score: number, par: number): number {
  if (par <= 0) return 0;
  const r = score / par;
  let stars = 0;
  for (const th of STEPS) if (r >= th) stars++;
  return stars;
}

/** The five stars a result shows, whether they are gold or not. */
export const shownStars = (stars: number) => Math.min(5, Math.max(0, stars));
export const isGold = (stars: number) => stars >= GOLD_STARS;

/**
 * How far a score is from its current star toward the next one, 0..1. After the fifth star the
 * next step is gold; once the stars are gold it stays at 1.
 */
export function starProgress(score: number, par: number): number {
  if (par <= 0) return 0;
  const r = score / par;
  const n = starsFor(score, par);
  if (n >= STEPS.length) return 1;
  const from = n === 0 ? 0 : STEPS[n - 1];
  return Math.max(0, Math.min(1, (r - from) / (STEPS[n] - from)));
}
