import type { Grade } from './judge';

export const NOTE_POINTS: Record<Grade, number> = { perfect: 50, great: 40, good: 25 };
export const SUSTAIN_POINTS_PER_BEAT = 25;
export const STREAK_PER_MULTIPLIER = 10;
export const MAX_MULTIPLIER = 4;
/** Fraction of the base score needed for 1..5 stars. */
export const STAR_THRESHOLDS = [0.3, 0.7, 1.2, 2.0, 2.8];

export const multiplierFor = (streak: number) =>
  Math.min(MAX_MULTIPLIER, 1 + Math.floor(streak / STREAK_PER_MULTIPLIER));

export function starsFor(score: number, baseScore: number): number {
  if (baseScore <= 0) return 0;
  const r = score / baseScore;
  let stars = 0;
  for (const th of STAR_THRESHOLDS) if (r >= th) stars++;
  return stars;
}
