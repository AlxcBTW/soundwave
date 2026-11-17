import { describe, expect, it } from 'vitest';
import type { Chart, Note } from '../src/chart/types';
import { GameSession, PHRASE_REWARD } from '../src/game/GameSession';
import { gradeFor } from '../src/game/judge';
import { multiplierFor, starsFor } from '../src/game/scoring';

const chart = (notes: Partial<Note>[], lanes: 4 | 5 = 4): Chart => ({
  part: 'lead',
  difficulty: lanes === 5 ? 'expert' : 'easy',
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
  it('ramps multiplier every 10 notes up to x6', () => {
    expect(multiplierFor(0)).toBe(1);
    expect(multiplierFor(10)).toBe(2);
    expect(multiplierFor(49)).toBe(5);
    expect(multiplierFor(50)).toBe(6);
    expect(multiplierFor(999)).toBe(6);
  });
  it('awards stars by the share of par, and gold stars at par', () => {
    expect(starsFor(0, 100)).toBe(0);
    expect(starsFor(9, 100)).toBe(0);
    expect(starsFor(10, 100)).toBe(1);
    expect(starsFor(78, 100)).toBe(5);
    expect(starsFor(99, 100)).toBe(5);
    expect(starsFor(100, 100)).toBe(6);
    expect(starsFor(300, 100)).toBe(6);
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

describe('hold and release notes', () => {
  const holdThenRelease = () => {
    const s = new GameSession(chart([{ t: 1, dur: 1, release: true }, { t: 3 }]));
    const events: string[] = [];
    s.on((e) => events.push(e.type === 'release' ? `release ${e.grade}` : e.type === 'release-miss' ? `release-miss ${e.early ? 'early' : 'late'}` : e.type));
    s.update(0.99);
    s.press(0, 1.0);
    return { s, events };
  };

  it('scores a release on time', () => {
    const { s, events } = holdThenRelease();
    s.update(1.98);
    const before = s.score;
    s.release(0, 2.01);
    expect(events).toContain('release perfect');
    expect(s.score).toBeGreaterThan(before);
    expect(s.results().releases).toEqual({ hit: 1, total: 1 });
  });

  it('letting go clearly early is a miss that breaks the streak', () => {
    const { s, events } = holdThenRelease();
    s.update(1.5);
    s.release(0, 1.5);
    expect(events).toContain('release-miss early');
    expect(s.streak).toBe(0);
    expect(s.isReleaseMissed(0)).toBe(true);
  });

  it('holding past the window is a late miss', () => {
    const { s, events } = holdThenRelease();
    s.update(2.0);
    expect(events).not.toContain('release-miss late');
    s.update(2.2);
    expect(events).toContain('release-miss late');
    expect(s.holding[0]).toBe(-1);
  });

  it('a pause drops the hold without breaking the streak', () => {
    const { s, events } = holdThenRelease();
    s.update(1.4);
    s.dropHolds();
    expect(s.streak).toBe(1);
    expect(s.isReleaseMissed(0)).toBe(true);
    expect(events.filter((e) => e.startsWith('release'))).toEqual([]);
  });

  it('a missed head misses its release too', () => {
    const s = new GameSession(chart([{ t: 1, dur: 1, release: true }]));
    s.update(1.5);
    expect(s.isReleaseMissed(0)).toBe(true);
    expect(s.results().releases).toEqual({ hit: 0, total: 1 });
  });
});
