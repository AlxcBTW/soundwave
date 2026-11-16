import type { DrumHit, PitchedNote } from '../analysis/types';
import type { Difficulty, Note, Part } from '../chart/types';
import { deleteAnnotation, listAnnotations, putAnnotation } from '../storage/db';

export const CATEGORIES = [
  { id: 'missing', label: 'Missing note', hint: 'Sound here, but no tile' },
  { id: 'extra', label: 'Extra note', hint: 'Tile, but nothing to hear' },
  { id: 'timing', label: 'Timing', hint: 'Tile early/late or wrong rhythm' },
  { id: 'lane', label: 'Lane', hint: 'Lane movement does not match the melody' },
  { id: 'pitch', label: 'Wrong pitch', hint: 'Transcribed pitch is wrong' },
  { id: 'chord', label: 'Chord', hint: 'Chord should be single (or the reverse)' },
  { id: 'sustain', label: 'Sustain', hint: 'Too long / too short / missing' },
  { id: 'density', label: 'Density', hint: 'Too many or too few notes for the difficulty' },
  { id: 'other', label: 'Other', hint: '' },
] as const;

export type Category = (typeof CATEGORIES)[number]['id'];

/**
 * One problem report. It carries its own context (chart and source notes around it, analysis
 * metadata), so it can be diagnosed without re-running the analysis.
 */
export interface Annotation {
  id: string;
  songId: string;
  songTitle: string;
  part: Part;
  difficulty: Difficulty;
  category: Category;
  comment: string;
  createdAt: string;
  /** What was selected: a time range, and the chart notes inside the selection (if any). */
  range: { start: number; end: number; startBeat: number; endBeat: number; bar: number };
  notes: Note[];
  /** Everything within ±1 s of the selection. */
  context: { chart: Note[]; source: PitchedNote[]; drums?: DrumHit[] };
  analysis: { version: number; source: string; pitchSource: string; tempo: number; chartVersion: number };
  /** What was audible while annotating. */
  audio: { source: string; rate: number };
}

export async function loadAnnotations(songId: string): Promise<Annotation[]> {
  try {
    return (await listAnnotations(songId)).sort((a, b) => a.range.start - b.range.start);
  } catch {
    return [];
  }
}

export interface SongRef {
  songId: string;
  songTitle: string;
}

export async function saveAnnotation(a: Annotation, all: Annotation[]) {
  await putAnnotation(a);
  return syncToProject(all, a);
}

export async function removeAnnotation(id: string, all: Annotation[], song: SongRef) {
  await deleteAnnotation(id);
  return syncToProject(all, song);
}

/**
 * In the dev build, writes this song's annotations to `debug-annotations/` in the project, where
 * they can be read and acted on. Returns the written path, or null outside the dev server.
 */
export async function syncToProject(all: Annotation[], song: SongRef): Promise<string | null> {
  // An empty list is written too, so deleting the last annotation clears the file.
  if (!import.meta.env.DEV) return null;
  try {
    const res = await fetch('/__debug/annotations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ songId: song.songId, songTitle: song.songTitle, annotations: all }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { path: string }).path;
  } catch {
    return null;
  }
}

export function exportJson(all: Annotation[]): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), annotations: all }, null, 2);
}
