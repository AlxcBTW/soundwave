export type Part = 'lead' | 'bass' | 'drums' | 'vocals';
export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

/** In the order they are offered everywhere: the voice first. */
export const PARTS: Part[] = ['vocals', 'lead', 'bass', 'drums'];
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

export const lanesFor = (d: Difficulty): 4 | 5 => (d === 'expert' ? 5 : 4);

export interface Note {
  /** Hit time in seconds from song start. */
  t: number;
  /** Lane index, 0 = leftmost. */
  lane: number;
  /** Sustain length in seconds (0 = tap note). */
  dur: number;
  /** A held note that must also be let go on time, at the end of its sustain. */
  release?: boolean;
  /** Overdrive phrase id, or -1 when the note is not part of a phrase. */
  phrase: number;
}

export interface Chart {
  part: Part;
  difficulty: Difficulty;
  lanes: 4 | 5;
  /** Sorted by time, then lane. Notes sharing a time form a chord. */
  notes: Note[];
  /** Beat times in seconds. */
  beats: number[];
  /** Indices into `beats` that start a bar. */
  downbeats: number[];
  /** Average seconds per beat. */
  secondsPerBeat: number;
  duration: number;
}
