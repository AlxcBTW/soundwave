import { describe, expect, it } from 'vitest';
import { loudness, pruneOvertones, vocalLineFromStem } from '../src/analysis/pitch/stemLines';

describe('pruneOvertones', () => {
  it('reduces a distorted power chord to root and fifth', () => {
    // A2 + E3 power chord heard with octave and twelfth overtones (A3, E4, A4) and a 17th (C#5).
    expect(pruneOvertones([45, 52, 57, 64, 69, 73])).toEqual([45, 52]);
  });
  it('keeps real chord tones', () => {
    expect(pruneOvertones([55, 59, 62])).toEqual([55, 59, 62]);
  });
});
import type { PitchedNote } from '../src/analysis/types';

const SR = 22050;
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

describe('vocalLineFromStem', () => {
  // Four sung syllables with vibrato, one breath (noise, no pitch) in between.
  const syllables = [
    { t: 1.0, dur: 0.45, midi: 62 },
    { t: 1.6, dur: 0.45, midi: 62 },
    { t: 2.2, dur: 0.8, midi: 65 },
    { t: 3.4, dur: 0.45, midi: 60 },
  ];
  const signal = new Float32Array(5 * SR);
  let seed = 3;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (const s of syllables) {
    const f = midiHz(s.midi);
    let phase = 0;
    for (let i = 0; i < s.dur * SR; i++) {
      const t = i / SR;
      phase += (2 * Math.PI * f * (1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * t))) / SR; // vibrato
      const envl = Math.min(1, t * 80) * Math.min(1, (s.dur - t) * 30);
      signal[Math.floor(s.t * SR) + i] += 0.4 * envl * (Math.sin(phase) + 0.3 * Math.sin(2 * phase));
    }
  }
  for (let i = 0; i < 0.25 * SR; i++) signal[Math.floor(3.05 * SR) + i] += 0.08 * noise(); // breath

  // A transcriber's view: the long vibrato note split in two, plus nothing for the breath.
  const notes: PitchedNote[] = [
    { t: 1.02, dur: 0.43, midi: 62, strength: 0.8, bend: 0.2 },
    { t: 1.63, dur: 0.42, midi: 62, strength: 0.8, bend: 0.2 },
    { t: 2.25, dur: 0.35, midi: 65, strength: 0.8, bend: 0.2 },
    { t: 2.62, dur: 0.36, midi: 65, strength: 0.6, bend: 0.25 },
    { t: 3.43, dur: 0.4, midi: 60, strength: 0.8, bend: 0.2 },
  ];

  it('gives one note per syllable, timed by the attack', () => {
    const line = vocalLineFromStem({ signal, sr: SR, notes });
    expect(line.map((n) => n.midi)).toEqual([62, 62, 65, 60]);
    line.forEach((n, i) => expect(Math.abs(n.t - syllables[i].t)).toBeLessThan(0.03));
    // The held syllable stays one note even though the transcriber split it.
    expect(line[2].dur).toBeGreaterThan(0.6);
  });

  it('finds nothing in a stem all but silent next to the song (an instrumental)', () => {
    // The separation leaves a thousandth of the song's level in the vocal stem of a song without a
    // singer. Judged by its own loud parts, that residue looks like singing; next to the song, not.
    const residue = signal.map((x) => x * 0.001);
    expect(vocalLineFromStem({ signal: residue, sr: SR, notes }).length).toBeGreaterThan(0);
    expect(vocalLineFromStem({ signal: residue, sr: SR, notes, mixLoudness: loudness(signal) })).toEqual([]);
    // A real vocal at the song's level is unaffected.
    expect(vocalLineFromStem({ signal, sr: SR, notes, mixLoudness: loudness(signal) }).length).toBe(4);
  });
});
