import { describe, expect, it } from 'vitest';
import type { AnalysisResult, PitchedNote } from '../src/analysis/types';
import { partPresence, thinParts } from '../src/chart/presence';
import { loadPick, partFor, setParts } from '../src/game/setlist';
import { PARTS } from '../src/chart/types';

const BARS = 40;
const BAR = 2;

/** A song of 40 two-second bars; each part plays in the bars its function says yes to. */
function song(plays: { vocals?(bar: number): boolean; lead?(bar: number): boolean; bass?(bar: number): boolean; drums?(bar: number): boolean }, grid = true): AnalysisResult {
  const beats = Array.from({ length: BARS * 4 }, (_, i) => i * 0.5);
  const notes = (on?: (bar: number) => boolean): PitchedNote[] =>
    Array.from({ length: BARS }, (_, bar) => bar)
      .filter((bar) => on?.(bar))
      .flatMap((bar) => [0, 1].map((k) => ({ t: bar * BAR + k, dur: 0.4, midi: 60, strength: 0.8 })));
  return {
    version: 2,
    source: 'ml',
    duration: BARS * BAR,
    tempo: 120,
    beats: grid ? beats : [],
    downbeats: grid ? Array.from({ length: BARS }, (_, i) => i * 4) : [],
    drums: Array.from({ length: BARS }, (_, bar) => bar)
      .filter((bar) => plays.drums?.(bar))
      .flatMap((bar) => [0, 0.5, 1, 1.5].map((k) => ({ t: bar * BAR + k, kind: 'kick' as const, strength: 1 }))),
    bass: notes(plays.bass),
    lead: notes(plays.lead),
    vocals: notes(plays.vocals),
    harmony: [],
    sections: [],
    energy: [],
    energyHop: 0.1,
    pitchSource: 'ml',
  };
}

const always = () => true;

describe('how much of a song a part plays in', () => {
  it('counts the bars a part plays in', () => {
    const p = partPresence(song({ vocals: (b) => b < 10, lead: always, bass: (b) => b % 2 === 0, drums: always }));
    expect(p.vocals).toBeCloseTo(0.25);
    expect(p.lead).toBeCloseTo(1);
    expect(p.bass).toBeCloseTo(0.5);
    expect(p.drums).toBeCloseTo(1);
  });

  it('does not count a bar for one short stray note, but does for one that is held', () => {
    const a = song({ lead: always, drums: always });
    a.vocals = [3, 11, 19, 27].map((bar) => ({ t: bar * BAR + 0.3, dur: 0.15, midi: 64, strength: 0.3 }));
    a.bass = Array.from({ length: BARS }, (_, bar) => ({ t: bar * BAR, dur: 1.6, midi: 36, strength: 0.9 }));
    const p = partPresence(a);
    expect(p.vocals).toBe(0);
    expect(p.bass).toBeCloseTo(1);
  });

  it('works without bar lines', () => {
    const p = partPresence(song({ vocals: (b) => b < 20, drums: always }, false));
    expect(p.vocals).toBeCloseTo(0.5);
    expect(p.drums).toBeCloseTo(1);
  });
});

describe('parts a song hardly has', () => {
  it('names a part with almost nothing next to the others', () => {
    // An instrumental: two bars of "vocals" that leaked from the lead.
    expect(thinParts(song({ vocals: (b) => b === 7 || b === 23, lead: always, bass: always, drums: always }))).toEqual(['vocals']);
    // A voice and a guitar: no bass, no drums.
    expect(thinParts(song({ vocals: always, lead: always }))).toEqual(['bass', 'drums']);
  });

  it('keeps a part that comes in late or only in the choruses', () => {
    expect(thinParts(song({ vocals: (b) => b % 4 === 0, lead: always, bass: always, drums: (b) => b > 26 }))).toEqual([]);
  });

  it('names nothing when no part stands out', () => {
    expect(thinParts(song({}))).toEqual([]);
  });
});

describe('the parts a set is played on', () => {
  it('opens every part some song of the set has', () => {
    const thin = { a: ['vocals'] as const, b: ['vocals', 'bass'] as const };
    expect(setParts(['a'], thin)).toEqual(['lead', 'bass', 'drums']);
    expect(setParts(['a', 'b'], thin)).toEqual(['lead', 'bass', 'drums']);
    expect(setParts(['a', 'c'], thin)).toEqual(PARTS);
  });

  it('never leaves a set without a part', () => {
    expect(setParts(['a'], { a: PARTS })).toEqual(PARTS);
  });

  it('plays the chosen part, or the first open one when the set hardly has it', () => {
    expect(partFor({ part: 'vocals', difficulty: 'expert' }, ['lead', 'bass', 'drums'])).toBe('lead');
    expect(partFor({ part: 'bass', difficulty: 'expert' }, ['lead', 'bass', 'drums'])).toBe('bass');
  });
});

describe('defaults', () => {
  it('offers the voice first, and starts on vocals at expert', () => {
    expect(PARTS[0]).toBe('vocals');
    expect(loadPick()).toEqual({ part: 'vocals', difficulty: 'expert' });
  });
});
