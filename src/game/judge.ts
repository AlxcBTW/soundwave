export type Grade = 'perfect' | 'great' | 'good';

export const WINDOWS = { perfect: 0.045, great: 0.09, good: 0.135 } as const;

/** Grades an absolute timing error in seconds; null means outside every window. */
export function gradeFor(delta: number): Grade | null {
  const d = Math.abs(delta);
  if (d <= WINDOWS.perfect) return 'perfect';
  if (d <= WINDOWS.great) return 'great';
  if (d <= WINDOWS.good) return 'good';
  return null;
}
