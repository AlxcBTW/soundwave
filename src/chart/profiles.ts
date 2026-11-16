import type { Difficulty } from './types';

export interface DifficultyProfile {
  lanes: 4 | 5;
  /** Finest grid subdivision per beat. */
  subdivision: number;
  /** Minimum seconds between consecutive note times. */
  minGap: number;
  /** Maximum notes sounding at the same time. */
  maxChord: number;
  /** Notes at least this many beats long become sustains. */
  sustainBeats: number;
  /** Average notes per beat in a full-energy section. */
  notesPerBeat: number;
  /** Candidates below this priority are never charted. */
  minPriority: number;
  /** Whether hi-hat hits are charted on drums. */
  hats: boolean;
  /** Whether a sustain may overlap notes in other lanes. */
  overlapSustains: boolean;
  /** Maximum fraction of note times that may be chords. */
  chordRate: number;
}

export const PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy: { lanes: 4, subdivision: 1, minGap: 0.32, maxChord: 1, sustainBeats: 1.5, notesPerBeat: 0.6, minPriority: 0.3, hats: false, overlapSustains: false, chordRate: 0 },
  medium: { lanes: 4, subdivision: 2, minGap: 0.18, maxChord: 2, sustainBeats: 1, notesPerBeat: 1.1, minPriority: 0.22, hats: true, overlapSustains: false, chordRate: 0.12 },
  hard: { lanes: 4, subdivision: 2, minGap: 0.12, maxChord: 2, sustainBeats: 0.75, notesPerBeat: 1.7, minPriority: 0.15, hats: true, overlapSustains: true, chordRate: 0.25 },
  expert: { lanes: 5, subdivision: 4, minGap: 0.075, maxChord: 3, sustainBeats: 0.5, notesPerBeat: 2.6, minPriority: 0.1, hats: true, overlapSustains: true, chordRate: 0.35 },
};
