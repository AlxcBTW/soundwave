import { Drum, Guitar, KeyboardMusic, Mic, Star, type LucideIcon } from 'lucide-react';
import type { Difficulty, Part } from '../chart/types';
import { isGold, shownStars } from '../game/scoring';

/** One icon per part; Lead is everything melodic that isn't bass or voice (keys, guitar, synths). */
export const PART_ICON: Record<Part, LucideIcon> = { lead: KeyboardMusic, bass: Guitar, drums: Drum, vocals: Mic };

export const PART_LABEL: Record<Part, string> = { lead: 'Lead', bass: 'Bass', drums: 'Drums', vocals: 'Vocals' };

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };

/** Difficulty as a level of four pips. */
export const DIFFICULTY_LEVEL: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3, expert: 4 };

/** Stroke weight shared by every icon in the interface. */
export const ICON_STROKE = 2.25;

/** What a star rating is called: "3 of 5 stars", or "Gold stars" for the tier beyond five. */
export const starsLabel = (n: number) => (isGold(n) ? 'Gold stars' : `${shownStars(n)} of 5 stars`);

/** Star rating, drawn: the first `n` of five are lit, and all five are gold beyond that (n = 6). */
export function Stars({ n, className = '' }: { n: number; className?: string }) {
  const lit = shownStars(n);
  return (
    <span className={`stars ${isGold(n) ? 'gold' : ''} ${className}`} role="img" aria-label={starsLabel(n)}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} className={i < lit ? 'on' : ''} style={{ ['--k' as string]: i }} strokeWidth={ICON_STROKE} aria-hidden />
      ))}
    </span>
  );
}

/** Four pips, lit up to the difficulty's level in its colour. */
export function Pips({ difficulty }: { difficulty: Difficulty }) {
  const level = DIFFICULTY_LEVEL[difficulty];
  return (
    <span className="pips" data-level={level} aria-hidden>
      {[1, 2, 3, 4].map((k) => (
        <span key={k} className={k <= level ? 'lit' : ''} />
      ))}
    </span>
  );
}
