export type Part = 'lead' | 'bass' | 'drums' | 'vocals';
export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

export const PARTS: Part[] = ['lead', 'bass', 'drums', 'vocals'];
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

export const lanesFor = (d: Difficulty): 4 | 5 => (d === 'expert' ? 5 : 4);

export interface Note {
  /** Hit time in seconds from song start. */
  t: number;
  /** Lane index, 0 = leftmost. */
  lane: number;
  /** Sustain length in seconds (0 = tap note). */
  dur: number;
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
