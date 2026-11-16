import { describe, expect, it } from 'vitest';
import { bassLine, clusters, separateParts } from '../src/analysis/pitch/lines';
import type { PitchedNote } from '../src/analysis/types';

const note = (t: number, midi: number, extra: Partial<PitchedNote> = {}): PitchedNote => ({ t, dur: 0.3, midi, strength: 0.7, ...extra });

describe('bassLine', () => {
  it('folds octave doublings onto one octave', () => {
    // Transcribers often report the bass in two octaves at once (F1 + F2) and wander between them.
    const notes = [0, 0.5, 1, 1.5, 2, 2.5].flatMap((t, i) => [note(t, 29 + (i % 2 ? 12 : 0)), note(t + 0.01, 41)]);
    const line = bassLine(notes);
    expect(line).toHaveLength(6);
    expect(new Set(line.map((n) => n.midi)).size).toBe(1);
  });
});

describe('clusters', () => {
  it('keeps a chord together when an unrelated note comes just before it', () => {
    const c = clusters([note(1.0, 57), note(1.047, 76), note(1.059, 65), note(1.059, 53)]);
    expect(c.map((x) => x.length)).toEqual([1, 3]);
  });
});

describe('separateParts', () => {
  const song: PitchedNote[] = [];
  for (let bar = 0; bar < 16; bar++) {
    const t = bar * 2;
    // Synth stab chords: steady (no bend), three pitches at once.
    for (const off of [0, 1.25]) for (const m of [55, 62, 67]) song.push(note(t + off, m, { dur: 0.2 }));
    // Sung melody: bendy single notes between the stabs.
    for (const [off, m] of [[0.5, 64], [0.75, 65], [1.5, 67], [1.75, 64]] as const) song.push(note(t + off, m, { bend: 0.2, dur: 0.22 }));
    // Bass.
    song.push(note(t, 31, { dur: 0.4 }), note(t + 1, 31, { dur: 0.4 }));
  }

  it('puts stab chords on lead, bendy notes on vocals and the low line on bass', () => {
    const { bass, lead, vocals } = separateParts(song, 32);
    expect(bass.length).toBe(32);
    const chords = lead.filter((n) => n.chord);
    expect(chords.length).toBe(32);
    expect(chords[0].chord).toEqual([55, 62, 67]);
    expect(chords[0].midi).toBe(67);
    expect(vocals.length).toBeGreaterThanOrEqual(60);
    expect(vocals.every((v) => (v.bend ?? 0) > 0)).toBe(true);
    // No chord tone leaks into the vocal line.
    expect(vocals.some((v) => chords.some((c) => Math.abs(c.t - v.t) < 0.02))).toBe(false);
  });

  it('lets lead double the vocal melody where no instrument plays for a long time', () => {
    const sungOnly = song.filter((n) => n.bend || n.midi < 50).map((n) => ({ ...n }));
    const { lead, vocals } = separateParts(sungOnly, 32);
    expect(vocals.length).toBeGreaterThan(30);
    expect(lead.length).toBe(vocals.length);
  });
});
