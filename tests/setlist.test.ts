import { describe, expect, it } from 'vitest';
import { GOLD_THRESHOLD, starProgress, STAR_THRESHOLDS } from '../src/game/scoring';
import { formatTime, pruneSetlist, SET_MAX, suggestSets, toggleSong } from '../src/game/setlist';
import { modeForKey, modeForPointer } from '../src/input/inputMode';

describe('setlist', () => {
  it('adds a song at the end and takes it out again', () => {
    expect(toggleSong(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleSong(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('holds four songs at most', () => {
    const full = ['a', 'b', 'c', 'd'];
    expect(full).toHaveLength(SET_MAX);
    expect(toggleSong(full, 'e')).toEqual(full);
    expect(toggleSong(full, 'c')).toEqual(['a', 'b', 'd']);
  });

  it('drops songs that are gone, repeats and anything past four', () => {
    expect(pruneSetlist(['a', 'gone', 'a', 'b'], new Set(['a', 'b']))).toEqual(['a', 'b']);
    expect(pruneSetlist(['a', 'b', 'c', 'd', 'e'], new Set(['a', 'b', 'c', 'd', 'e']))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('formats lengths as minutes and seconds', () => {
    expect(formatTime(0)).toBe('');
    expect(formatTime(42)).toBe('0:42');
    expect(formatTime(185.4)).toBe('3:05');
  });
});

describe('suggested sets', () => {
  const song = (id: string, addedAt: number) => ({ id, addedAt, duration: 100 });
  const library = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => song(id, i + 1));

  it('offers a shuffle, the newest and the unplayed songs', () => {
    const sets = suggestSets(library, new Set(['a', 'b', 'c']), 7);
    expect(sets.map((s) => s.id)).toEqual(['shuffle', 'newest', 'unplayed']);
    expect(sets[1].songs).toEqual(['f', 'e', 'd', 'c']);
    expect(sets[2].songs).toEqual(['d', 'e', 'f']);
    for (const s of sets) expect(s.songs.length).toBeLessThanOrEqual(SET_MAX);
  });

  it('deals the same shuffle for the same seed and another for a new one', () => {
    const many = Array.from({ length: 30 }, (_, i) => song(`s${i}`, i + 1));
    const one = suggestSets(many, new Set(), 1)[0].songs;
    expect(suggestSets(many, new Set(), 1)[0].songs).toEqual(one);
    expect(suggestSets(many, new Set(), 2)[0].songs).not.toEqual(one);
  });

  it('needs two songs for a set and leaves out a set that repeats another', () => {
    expect(suggestSets([song('a', 1)], new Set(), 1)).toEqual([]);
    // Two songs, none played: shuffle, newest and unplayed would all be the same two.
    expect(suggestSets([song('a', 1), song('b', 2)], new Set(), 1).map((s) => s.id)).toEqual(['shuffle']);
  });

});

describe('progress toward the next star', () => {
  const base = 1000;
  it('runs from 0 to 1 between two star thresholds', () => {
    expect(starProgress(0, base)).toBe(0);
    expect(starProgress(STAR_THRESHOLDS[0] * base * 0.5, base)).toBeCloseTo(0.5);
    const mid = ((STAR_THRESHOLDS[1] + STAR_THRESHOLDS[2]) / 2) * base;
    expect(starProgress(mid, base)).toBeCloseTo(0.5);
  });

  it('heads for gold after the fifth star, is full once the stars are gold, and empty without a chart', () => {
    expect(starProgress(STAR_THRESHOLDS[4] * base, base)).toBe(0);
    expect(starProgress(((STAR_THRESHOLDS[4] + GOLD_THRESHOLD) / 2) * base, base)).toBeCloseTo(0.5);
    expect(starProgress(GOLD_THRESHOLD * base, base)).toBe(1);
    expect(starProgress(500, 0)).toBe(0);
  });
});

describe('input mode', () => {
  it('takes navigation and shortcut keys as the keyboard', () => {
    expect(modeForKey('ArrowDown', false)).toBe('keyboard');
    expect(modeForKey('r', false)).toBe('keyboard');
  });

  it('ignores modifier keys and typing into a text field', () => {
    expect(modeForKey('Shift', false)).toBeNull();
    expect(modeForKey('a', true)).toBeNull();
    expect(modeForKey('Backspace', true)).toBeNull();
    // Leaving the field with the keyboard is still keyboard use.
    expect(modeForKey('Escape', true)).toBe('keyboard');
    expect(modeForKey('ArrowDown', true)).toBe('keyboard');
  });

  it('tells a finger and a pen from a mouse', () => {
    expect(modeForPointer('touch')).toBe('touch');
    expect(modeForPointer('pen')).toBe('touch');
    expect(modeForPointer('mouse')).toBe('mouse');
  });
});
