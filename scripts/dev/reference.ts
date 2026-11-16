/**
 * Reads a Rock Band–style `notes.mid` (community charts) as reference data for tuning.
 * Only used by dev tooling; nothing from a reference chart ends up in the app.
 */
import { readFileSync } from 'node:fs';
import { Midi } from '@tonejs/midi';
import type { Difficulty } from '../../src/chart/types';

export interface RefNote {
  t: number;
  dur: number;
  /** Lane 0..4 for instruments; MIDI pitch for vocals. */
  value: number;
}

export interface Reference {
  /** Beat times and which of them start a bar (from the BEAT track). */
  beats: number[];
  downbeats: number[];
  vocals: RefNote[];
  guitar: Record<Difficulty, RefNote[]>;
  bass: Record<Difficulty, RefNote[]>;
  drums: Record<Difficulty, RefNote[]>;
}

/** Five-lane note ranges per difficulty (green..orange), as in the Rock Band MIDI spec. */
const LANE_BASE: Record<Difficulty, number> = { easy: 60, medium: 72, hard: 84, expert: 96 };

function lanes(track: Midi['tracks'][number] | undefined): Record<Difficulty, RefNote[]> {
  const out = { easy: [], medium: [], hard: [], expert: [] } as Record<Difficulty, RefNote[]>;
  if (!track) return out;
  for (const d of Object.keys(LANE_BASE) as Difficulty[]) {
    const base = LANE_BASE[d];
    out[d] = track.notes
      .filter((n) => n.midi >= base && n.midi <= base + 4)
      .map((n) => ({ t: n.time, dur: n.duration, value: n.midi - base }))
      .sort((a, b) => a.t - b.t || a.value - b.value);
  }
  return out;
}

export function readReference(path: string): Reference {
  const midi = new Midi(readFileSync(path));
  const track = (name: string) => midi.tracks.find((t) => t.name === name);
  const beatTrack = track('BEAT');
  const beatNotes = (beatTrack?.notes ?? []).sort((a, b) => a.time - b.time);
  const beats = beatNotes.map((n) => n.time);
  // BEAT track: 12 = first beat of a bar, 13 = other beats.
  const downbeats = beatNotes.map((n, i) => (n.midi === 12 ? i : -1)).filter((i) => i >= 0);
  // Sung notes use pitches 36..84; other pitches are phrase markers, percussion and overdrive.
  const vocals = (track('PART VOCALS')?.notes ?? [])
    .filter((n) => n.midi >= 36 && n.midi <= 84)
    .map((n) => ({ t: n.time, dur: n.duration, value: n.midi }))
    .sort((a, b) => a.t - b.t);
  return { beats, downbeats, vocals, guitar: lanes(track('PART GUITAR')), bass: lanes(track('PART BASS')), drums: lanes(track('PART DRUMS')) };
}
