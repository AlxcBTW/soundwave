import { describe, expect, it } from 'vitest';
import type { Chart, Note } from '../src/chart/types';
import { findBreaks } from '../src/game/breaks';

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
    const b = findBreaks(chart([{ t: 8 }, { t: 9 }, { t: 10, dur: 3 }, { t: 18 }, { t: 21 }, { t: 30 }]));
    expect(b.map((x) => [x.next, x.length])).toEqual([
      [8, 8],
      [18, 5],
      [30, 9],
    ]);
    expect(b[1].from).toBeCloseTo(13.6);
    expect(b[1].to).toBeCloseTo(17.75);
  });

  it('ignores short gaps', () => {
    expect(findBreaks(chart([{ t: 1 }, { t: 4 }, { t: 8.9 }]))).toEqual([]);
  });
});
