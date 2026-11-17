import { describe, expect, it } from 'vitest';
import type { Chart, Note } from '../src/chart/types';
import { barsLeft, findBreaks } from '../src/game/breaks';

const chart = (notes: Partial<Note>[]): Chart => ({
  part: 'lead',
  difficulty: 'expert',
  lanes: 5,
  notes: notes.map((n) => ({ t: 0, lane: 0, dur: 0, phrase: -1, ...n })),
  beats: [],
  downbeats: [],
  secondsPerBeat: 0.5,
  duration: 60,
});

describe('findBreaks', () => {
  it('finds the intro and long gaps, measured from the end of a sustain', () => {
    const b = findBreaks(chart([{ t: 8 }, { t: 9 }, { t: 10, dur: 3 }, { t: 19 }, { t: 21 }, { t: 30 }]));
    expect(b.map((x) => x.next)).toEqual([8, 19, 30]);
    // Shown after the sustain ends, gone just before the next note is due.
    expect(b[1].from).toBeCloseTo(13.6);
    expect(b[1].to).toBeCloseTo(18.88);
  });

  it('skips short gaps and counts down the ones just long enough', () => {
    expect(findBreaks(chart([{ t: 1 }, { t: 4 }, { t: 8.9 }]))).toEqual([]);
    // A 5.5 s gap: the countdown runs until just before the note.
    const b = findBreaks(chart([{ t: 1 }, { t: 6.5 }]));
    expect(b).toHaveLength(1);
    expect(b[0].from).toBeCloseTo(1.6);
    expect(b[0].to).toBeCloseTo(6.38);
    expect(b[0].next).toBe(6.5);
  });
});

describe('barsLeft', () => {
  const bars = [0, 2, 4, 6, 8, 10];
  it('counts bar lines before the next note plus the bar it falls in', () => {
    expect(barsLeft(0.5, 8, bars)).toBe(4);
    expect(barsLeft(6.1, 8, bars)).toBe(1);
    // A note in the middle of a bar: that bar counts too.
    expect(barsLeft(0.5, 9, bars)).toBe(5);
  });
});
