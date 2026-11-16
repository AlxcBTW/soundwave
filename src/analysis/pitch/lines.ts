import type { PitchedNote } from '../types';

/** Upper bound (exclusive) of the bass register in MIDI (D3). */
export const BASS_SPLIT = 50;

/**
 * Reduces polyphonic notes to one line. At each overlap the note with the best score wins;
 * the losing earlier note is truncated where the winner starts.
 */
export function monophonic(notes: PitchedNote[], score: (n: PitchedNote) => number, minDur = 0.06): PitchedNote[] {
  const sorted = [...notes].sort((a, b) => a.t - b.t || score(b) - score(a));
  const out: PitchedNote[] = [];
  for (const n of sorted) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push({ ...n });
      continue;
    }
    if (n.t - prev.t < 0.05) {
      // Same onset: keep the better one.
      if (score(n) > score(prev)) out[out.length - 1] = { ...n };
      continue;
    }
    if (n.t < prev.t + prev.dur) {
      // Overlap: a new onset interrupts the held note if it scores reasonably well.
      if (score(n) < score(prev) * 0.5) continue;
      prev.dur = n.t - prev.t;
    }
    out.push({ ...n });
  }
  return out.filter((n) => n.dur >= minDur);
}

/** Splits transcribed notes into a bass line (lowest notes) and a lead line (salient upper notes). */
export function splitLines(notes: PitchedNote[], minStrength = 0.15): { bass: PitchedNote[]; lead: PitchedNote[] } {
  const strong = notes.filter((n) => n.strength >= minStrength);
  const low = strong.filter((n) => n.midi < BASS_SPLIT);
  const high = strong.filter((n) => n.midi >= BASS_SPLIT);
  const bass = monophonic(low, (n) => n.strength * (1 + (BASS_SPLIT - n.midi) * 0.03));
  const lead = monophonic(high, (n) => n.strength * (1 + (n.midi - 60) * 0.015) * Math.min(1.5, 0.6 + n.dur * 2));
  return { bass, lead };
}
