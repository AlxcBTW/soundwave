import { describe, expect, it } from 'vitest';
import type { Chart, Note } from '../src/chart/types';
import { GameSession, PHRASE_REWARD } from '../src/game/GameSession';
import { gradeFor } from '../src/game/judge';
import { multiplierFor, starsFor } from '../src/game/scoring';

const chart = (notes: Partial<Note>[], lanes: 4 | 5 = 4): Chart => ({
  part: 'lead',
  difficulty: lanes === 5 ? 'hard' : 'easy',
  lanes,
  notes: notes.map((n) => ({ t: 0, lane: 0, dur: 0, phrase: -1, ...n })),
  beats: [],
  downbeats: [],
  secondsPerBeat: 0.5,
  duration: 60,
});

describe('judge', () => {
  it('grades by window', () => {
    expect(gradeFor(0.01)).toBe('perfect');
    expect(gradeFor(-0.07)).toBe('great');
    expect(gradeFor(0.12)).toBe('good');
    expect(gradeFor(0.2)).toBeNull();
  });
});

describe('scoring', () => {
  it('ramps multiplier every 10 notes up to x4', () => {
    expect(multiplierFor(0)).toBe(1);
    expect(multiplierFor(10)).toBe(2);
    expect(multiplierFor(99)).toBe(4);
  });
  it('awards stars by base score ratio', () => {
    expect(starsFor(0, 100)).toBe(0);
    expect(starsFor(300, 100)).toBe(5);
  });
});

describe('GameSession', () => {
  it('hits notes in the right lane and misses late ones', () => {
    const s = new GameSession(chart([{ t: 1, lane: 0 }, { t: 2, lane: 1 }]));
    s.press(0, 1.01);
    s.update(3);
    const r = s.results();
    expect(r.counts.perfect).toBe(1);
    expect(r.counts.miss).toBe(1);
    expect(s.streak).toBe(0);
  });

  it('breaks the streak on a ghost press', () => {
    const s = new GameSession(chart([{ t: 1 }, { t: 3 }]));
    s.press(0, 1);
    expect(s.streak).toBe(1);
    s.press(0, 2);
    expect(s.streak).toBe(0);
  });

  it('judges each chord note separately', () => {
    const s = new GameSession(chart([{ t: 1, lane: 0 }, { t: 1, lane: 2 }]));
    s.press(0, 1);
    s.press(2, 1.05);
    expect(s.results().fullCombo).toBe(true);
  });

  it('scores sustains while held', () => {
    const s = new GameSession(chart([{ t: 1, dur: 1 }]));
    s.press(0, 1);
    const tap = s.score;
    s.update(1.5);
    s.update(2.1);
    expect(s.score).toBeGreaterThan(tap + 40);
    expect(s.holding[0]).toBe(-1);
  });

  it('fills overdrive on a completed phrase and drains while active', () => {
    const s = new GameSession(chart([{ t: 1, phrase: 0 }, { t: 2, phrase: 0 }, { t: 3 }]));
    s.press(0, 1);
    s.press(0, 2);
    expect(s.overdrive).toBeCloseTo(PHRASE_REWARD);
    expect(s.activateOverdrive()).toBe(true);
    expect(s.multiplier).toBe(2);
    s.update(2);
    s.update(10);
    expect(s.overdriveActive).toBe(false);
  });

  it('fails a phrase when one note is missed', () => {
    const s = new GameSession(chart([{ t: 1, phrase: 0 }, { t: 2, phrase: 0 }]));
    s.update(1.5);
    s.press(0, 2);
    expect(s.overdrive).toBe(0);
  });
});
