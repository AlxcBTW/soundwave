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
 *
 * The shape of the ladder follows the convention of band rhythm games, where the cutoffs are fixed
 * multiples of a chart's score at x1 (for a part whose multiplier tops out at x6: 0.21, 0.50, 0.90,
 * 2.77, 4.62, and 6.78 for gold). Divided by that top multiplier they become shares of par, which
 * keeps them fair for a short chart, where the climb up the ladder weighs more. The first three
 * stars come quickly, the fourth and fifth ask for a run that keeps its streak, and gold lies
 * beyond a flawless run: it cannot be had without overdrive.
 */
export const STAR_THRESHOLDS = [0.035, 0.083, 0.15, 0.46, 0.77];
/** Gold stars: 13% over par at most (see `goldThreshold`). */
export const GOLD_THRESHOLD = 1.13;
/**
 * The gold cutoff for one chart, as a share of par. Overdrive is the only way past par, so a
 * chart with little of it to give asks for less: never more than three quarters of what its
 * phrases can add, and exactly par when it has none. `overdriveShare` is the part of the
 * chart's playing time that overdrive can cover if every phrase is played (0..1).
 */
export const goldThreshold = (overdriveShare: number) =>
  Math.min(GOLD_THRESHOLD, 1 + 0.75 * (OVERDRIVE_FACTOR - 1) * Math.max(0, Math.min(1, overdriveShare)));
/** `starsFor` gives this for gold stars: all five, and gold. */
export const GOLD_STARS = 6;

export const multiplierFor = (streak: number) =>
  Math.min(MAX_MULTIPLIER, 1 + Math.floor(streak / STREAK_PER_MULTIPLIER));

/** Stars for a score against the song's par: 0..5, or GOLD_STARS (6) for five gold ones. */
export function starsFor(score: number, par: number, gold = GOLD_THRESHOLD): number {
  if (par <= 0) return 0;
  const r = score / par;
  let stars = 0;
  for (const th of STAR_THRESHOLDS) if (r >= th) stars++;
  return stars === STAR_THRESHOLDS.length && r >= gold ? GOLD_STARS : stars;
}

/** The five stars a result shows, whether they are gold or not. */
export const shownStars = (stars: number) => Math.min(5, Math.max(0, stars));
export const isGold = (stars: number) => stars >= GOLD_STARS;

/**
 * How far a score is from its current star toward the next one, 0..1. After the fifth star the
 * next step is gold; once the stars are gold it stays at 1.
 */
export function starProgress(score: number, par: number, gold = GOLD_THRESHOLD): number {
  if (par <= 0) return 0;
  const steps = [...STAR_THRESHOLDS, gold];
  const r = score / par;
  const n = starsFor(score, par, gold);
  if (n >= steps.length) return 1;
  const from = n === 0 ? 0 : steps[n - 1];
  return Math.max(0, Math.min(1, (r - from) / (steps[n] - from)));
}
