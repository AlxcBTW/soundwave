import { describe, expect, it } from 'vitest';
import type { Note } from '../src/chart/types';
import { ChartDoc } from '../src/editor/doc';
import { buildGrid, EditorGrid } from '../src/editor/grid';
import { reduceNotes, type BeatNote } from '../src/editor/reduce';
import { findAttacks, nearestIndex } from '../src/editor/sounds';

const grid = new EditorGrid(buildGrid({ kind: 'fixed', bpm: 120, offset: 0, beatsPerBar: 4 }, 60), 60);
const note = (t: number, lane: number, dur = 0): Note => ({ t, lane, dur, phrase: -1 });
const beat = (pos: number, lane: number, len = 0, phrase = -1): BeatNote => ({ pos, lane, len, phrase });

describe('sounds in a song', () => {
  it('finds where sounds start, to within a few milliseconds', () => {
    const sr = 22050;
    const data = new Float32Array(sr * 6);
    const starts = [0.5, 1.0, 1.25, 2.4, 3.0, 4.75];
    for (const t of starts) {
      const at = Math.floor(t * sr);
      for (let i = 0; i < 3000; i++) data[at + i] += Math.sin(i * 0.05) * Math.exp(-i / 700) * 0.8;
    }
    const found = findAttacks(data, sr);
    expect(found).toHaveLength(starts.length);
    found.forEach((t, i) => expect(Math.abs(t - starts[i])).toBeLessThan(0.012));
  });

  it('hears nothing in silence or steady noise', () => {
    const sr = 22050;
    expect(findAttacks(new Float32Array(sr * 3), sr)).toEqual([]);
    let seed = 5;
    const noise = Float32Array.from({ length: sr * 3 }, () => (((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1) * 0.3);
    expect(findAttacks(noise, sr).length).toBeLessThan(3);
  });

  it('finds the nearest of a sorted list', () => {
    expect(nearestIndex([], 1)).toBe(-1);
    expect(nearestIndex([1, 2, 4], 2.9)).toBe(1);
    expect(nearestIndex([1, 2, 4], 3.1)).toBe(2);
    expect(nearestIndex([1, 2, 4], -5)).toBe(0);
    expect(nearestIndex([1, 2, 4], 50)).toBe(2);
  });
});

describe('tools on notes', () => {
  const doc = (notes: Note[]) => {
    const d = new ChartDoc(5);
    d.load(notes, grid);
    return d;
  };

  it('puts notes on the grid in one step that can be undone', () => {
    // Notes played a little off the sixteenths, one held for not quite a beat.
    const d = doc([note(0.51, 0), note(0.77, 1, 0.46), note(1.24, 2)]);
    const ids = d.notes.map((n) => n.id);
    expect(d.transform(ids, (n) => ({ pos: grid.snap(n.pos, 4), len: n.len > 0 ? Math.round(n.len * 4) / 4 : 0 }))).toBe(true);
    expect(d.notes.map((n) => [n.pos, n.len])).toEqual([
      [1, 0],
      [1.5, 1],
      [2.5, 0],
    ]);
    d.undo();
    expect(d.notes[0].pos).toBeCloseTo(1.02);
  });

  it('lets what moves win over what it lands on, and removes what is given no place', () => {
    const d = doc([note(0.5, 0), note(1, 0), note(1.5, 3)]);
    const [a, , c] = d.notes.map((n) => n.id);
    d.transform([a], () => ({ pos: 2 }));
    expect(d.notes.map((n) => n.id)).toEqual([a, c]);
    d.transform([c], () => null);
    expect(d.notes.map((n) => n.id)).toEqual([a]);
  });

  it('replaces a chart with notes given in beats', () => {
    const d = doc([note(0.5, 0)]);
    d.setNotes([beat(4, 2, 1), beat(2, 9), beat(2, 1)]);
    expect(d.notes.map((n) => [n.pos, n.lane, n.len])).toEqual([
      [2, 1, 0],
      [4, 2, 1],
    ]);
    d.undo();
    expect(d.notes).toHaveLength(1);
  });
});

describe('an easier chart from a harder one', () => {
  // Two bars of sixteenths up and down five lanes, a three-note chord on each bar line, a short hold.
  const expert: BeatNote[] = [];
  for (let i = 0; i < 32; i++) expert.push(beat(i / 4, [0, 1, 2, 3, 4, 3, 2, 1][i % 8], i === 6 ? 0.6 : 0, i < 8 ? 0 : -1));
  expert.push(beat(0, 2), beat(0, 4), beat(4, 2), beat(4, 4));
  const count = (notes: BeatNote[]) => new Set(notes.map((n) => n.pos)).size;

  it('keeps the skeleton and thins toward the beat', () => {
    const hard = reduceNotes(expert, 5, 'hard', grid);
    const medium = reduceNotes(hard, 4, 'medium', grid);
    const easy = reduceNotes(medium, 4, 'easy', grid);
    expect(count(hard)).toBeLessThan(count(expert));
    expect(count(medium)).toBeLessThan(count(hard));
    expect(count(easy)).toBeLessThan(count(medium));
    // Easy plays on the beat, one note at a time, at most two a bar.
    expect(easy.every((n) => Number.isInteger(n.pos))).toBe(true);
    expect(count(easy)).toBe(easy.length);
    expect(easy.filter((n) => n.pos < 4).length).toBeLessThanOrEqual(2);
    // The bar lines survive every step down.
    for (const chart of [hard, medium, easy]) expect(chart.some((n) => n.pos === 0) && chart.some((n) => n.pos === 4)).toBe(true);
  });

  it('folds five lanes into four and keeps chords within reach', () => {
    const hard = reduceNotes(expert, 5, 'hard', grid);
    expect(hard.every((n) => n.lane >= 0 && n.lane <= 3)).toBe(true);
    const chord = hard.filter((n) => n.pos === 0);
    expect(chord.length).toBe(2);
    expect(new Set(chord.map((n) => n.lane)).size).toBe(2);
  });

  it('turns short holds into taps and drops a phrase left with one note', () => {
    const hard = reduceNotes(expert, 5, 'hard', grid);
    expect(hard.every((n) => n.len === 0)).toBe(true);
    const lonely = reduceNotes([beat(0, 0, 0, 3), beat(0.25, 1, 0, 3), beat(1, 2, 2, -1)], 5, 'easy', grid);
    expect(lonely.map((n) => [n.pos, n.phrase, n.len])).toEqual([
      [0, -1, 0],
      [1, -1, 2],
    ]);
  });
});
