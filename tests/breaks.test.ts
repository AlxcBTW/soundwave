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
    const b = findBreaks(chart([{ t: 8 }, { t: 9 }, { t: 10, dur: 3 }, { t: 19 }, { t: 21 }, { t: 30 }]), 2.5);
    expect(b.map((x) => x.next)).toEqual([8, 19, 30]);
    // Shown after the sustain ends, hidden once the next note is on the highway.
    expect(b[1].from).toBeCloseTo(13.6);
    expect(b[1].to).toBeCloseTo(16.5);
  });

  it('skips short gaps and breaks the highway would cover anyway', () => {
    expect(findBreaks(chart([{ t: 1 }, { t: 4 }, { t: 8.9 }]), 2.5)).toEqual([]);
    // 5.5 s gap, but with 4.5 s of look-ahead only 0.4 s of countdown would remain.
    expect(findBreaks(chart([{ t: 1 }, { t: 6.5 }]), 4.5)).toEqual([]);
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
