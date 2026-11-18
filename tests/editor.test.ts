import { describe, expect, it } from 'vitest';
import { AnalysisManager } from '../src/analysis/manager';
import type { AnalysisResult } from '../src/analysis/types';
import type { Note } from '../src/chart/types';
import { ChartDoc } from '../src/editor/doc';
import { chartFromNotes, cleanNotes, emptyEdits, sanitizeEdits, type SongEdits } from '../src/editor/edits';
import { buildGrid, EditorGrid, fitFixed, type GridSpec } from '../src/editor/grid';

const fixed = (bpm = 120, offset = 0, beatsPerBar = 4): GridSpec => ({ kind: 'fixed', bpm, offset, beatsPerBar });
const grid = (spec: GridSpec = fixed(), duration = 60) => new EditorGrid(buildGrid(spec, duration), duration);
const note = (t: number, lane: number, dur = 0, phrase = -1): Note => ({ t, lane, dur, phrase });

describe('beat grids', () => {
  it('lays a fixed tempo over the whole song, with bars from the first beat', () => {
    const g = buildGrid(fixed(120, 0.25), 10);
    expect(g.secondsPerBeat).toBeCloseTo(0.5);
    expect(g.beats[0]).toBeCloseTo(0.25);
    expect(g.beats[g.beats.length - 1]).toBeGreaterThanOrEqual(10);
    expect(g.downbeats.slice(0, 3)).toEqual([0, 4, 8]);
  });

  it('runs bars backwards from a first beat that comes late', () => {
    // The first bar line is 2.25 s in: the beats before it belong to the bar that ends there.
    const g = buildGrid(fixed(120, 2.25), 10);
    expect(g.beats[0]).toBeCloseTo(0.25);
    expect(g.downbeats[0]).toBe(0);
    expect(g.beats[g.downbeats[1]]).toBeCloseTo(2.25);
  });

  it('follows heard beats and runs them on to both ends of the song', () => {
    const heard = Array.from({ length: 8 }, (_, i) => 2 + i * 0.5);
    const g = buildGrid({ kind: 'beats', beats: heard, downbeats: [1, 5] }, 10);
    expect(g.beats[0]).toBeCloseTo(0);
    expect(g.beats[g.beats.length - 1]).toBeGreaterThanOrEqual(10);
    // Bar lines stay four beats apart, before and after the ones that were given.
    const bars = g.downbeats.map((i) => g.beats[i]);
    expect(bars.slice(0, 4).map((t) => +t.toFixed(2))).toEqual([0.5, 2.5, 4.5, 6.5]);
  });

  it('finds the steady tempo of heard beats', () => {
    const beats = Array.from({ length: 64 }, (_, i) => 0.31 + i * (60 / 128) + (i % 2 ? 0.004 : -0.004));
    const fit = fitFixed(beats, [2, 6, 10]);
    expect(fit.bpm).toBe(128);
    expect(fit.beatsPerBar).toBe(4);
    // Beat 2 starts a bar.
    expect(fit.offset).toBeCloseTo(0.31 + 2 * (60 / 128), 2);
  });

  it('snaps, steps and names positions', () => {
    const g = grid(fixed(120, 0), 20);
    expect(g.time(4)).toBeCloseTo(2);
    expect(g.pos(2.25)).toBeCloseTo(4.5);
    expect(g.snap(4.6, 4)).toBeCloseTo(4.5);
    expect(g.snap(4.6, 3)).toBeCloseTo(4 + 2 / 3);
    expect(g.step(4.5, 4, 1)).toBeCloseTo(4.75);
    expect(g.step(4.6, 4, 1)).toBeCloseTo(4.75);
    expect(g.step(4.6, 4, -1)).toBeCloseTo(4.5);
    expect(g.step(0, 4, -1)).toBe(0);
    expect(g.barBeat(0)).toEqual({ bar: 1, beat: 1 });
    expect(g.barBeat(6.5)).toEqual({ bar: 2, beat: 3 });
    expect(g.barStep(6.5, 1)).toBe(8);
    expect(g.barStep(6.5, -1)).toBe(4);
    expect(g.barStep(4, -1)).toBe(0);
    expect(g.barStart(6.5)).toBe(4);
  });
});

describe('the chart document', () => {
  const doc = (notes: Note[] = [], lanes = 5) => {
    const d = new ChartDoc(lanes);
    d.load(notes, grid());
    return d;
  };

  it('keeps notes on their beats when the tempo changes', () => {
    const d = doc([note(1, 0), note(1.5, 2, 1)]);
    expect(d.notes.map((n) => [n.pos, n.lane, n.len])).toEqual([
      [2, 0, 0],
      [3, 2, 2],
    ]);
    const faster = d.toNotes(grid(fixed(240)));
    expect(faster.map((n) => [n.t, n.dur])).toEqual([
      [0.5, 0],
      [0.75, 0.5],
    ]);
  });

  it('adds and removes notes, one change to undo at a time', () => {
    const d = doc();
    d.toggle(1, 0);
    d.toggle(2, 1);
    d.toggle(1, 0);
    expect(d.notes.map((n) => n.pos)).toEqual([2]);
    expect(d.changed).toBe(true);
    d.undo();
    expect(d.notes.map((n) => n.pos)).toEqual([1, 2]);
    d.undo();
    d.undo();
    expect(d.notes).toHaveLength(0);
    expect(d.canUndo).toBe(false);
    d.redo();
    d.redo();
    expect(d.notes.map((n) => n.pos)).toEqual([1, 2]);
    // A new change ends what could be redone.
    d.toggle(3, 3);
    expect(d.canRedo).toBe(false);
  });

  it('counts as changed only while it differs from what was loaded', () => {
    const d = doc([note(1, 0)]);
    expect(d.changed).toBe(false);
    d.toggle(4, 2);
    expect(d.changed).toBe(true);
    d.undo();
    expect(d.changed).toBe(false);
    // The same notes set down again are the same chart, and a grid renumbered under it changes nothing.
    d.toggle(1, 0);
    d.toggle(1, 0);
    expect(d.changed).toBe(false);
    d.rebase(4);
    expect(d.notes[0].pos).toBe(6);
    expect(d.changed).toBe(false);
    d.touch();
    expect(d.changed).toBe(true);
  });

  it('treats a gesture as one step', () => {
    const d = doc();
    d.begin();
    const n = d.add(1, 0)!;
    d.setLength(n.id, 1);
    d.setLength(n.id, 2);
    d.commit();
    expect(d.notes[0].len).toBe(2);
    d.undo();
    expect(d.notes).toHaveLength(0);
  });

  it('keeps a long note clear of the next note in its lane', () => {
    const d = doc([note(0.5, 1, 1.5)]);
    expect(d.notes[0].len).toBe(3);
    // A note set down inside the long one cuts it short.
    d.add(3, 1);
    expect(d.notes[0].len).toBeCloseTo(1.875);
    // Stretching stops short of the next note; another lane is no obstacle.
    d.setLength(d.notes[0].id, 8);
    expect(d.notes[0].len).toBeCloseTo(1.875);
    d.add(2, 3);
    expect(d.notes.find((n) => n.lane === 1 && n.pos === 1)!.len).toBeCloseTo(1.875);
    // Too short to hold is a tap.
    d.setLength(d.notes[0].id, 0.1);
    expect(d.notes[0].len).toBe(0);
  });

  it('moves a selection as one, or not at all', () => {
    const d = doc([note(0.5, 0), note(1, 4)]);
    const ids = d.notes.map((n) => n.id);
    expect(d.move(ids, 1, 1, 0, 100)).toBe(false);
    expect(d.move(ids, 1, -1, 0, 100)).toBe(false);
    expect(d.move([ids[0]], 1, 1, 0, 100)).toBe(true);
    expect(d.byId(ids[0])).toMatchObject({ pos: 2, lane: 1 });
    expect(d.move(ids, -3, 0, 0, 100)).toBe(false);
  });

  it('makes a phrase of everything between the first and last note chosen', () => {
    const d = doc([note(0.5, 0), note(1, 1), note(1.5, 2), note(3, 0)]);
    const [a, , c, last] = d.notes.map((n) => n.id);
    d.setPhrase([a, c], true);
    expect(d.notes.map((n) => n.phrase)).toEqual([0, 0, 0, -1]);
    expect(d.phrases()).toMatchObject([{ from: 1, to: 3, count: 3 }]);
    // A note set down inside the phrase joins it.
    expect(d.add(2.5, 4)!.phrase).toBe(0);
    d.setPhrase([last], true);
    expect(d.phrases()).toHaveLength(2);
    d.setPhrase([a], false);
    expect(d.byId(a)!.phrase).toBe(-1);
  });

  it('copies a stretch and sets it down again in place of what was there', () => {
    const d = doc([note(0, 0), note(0.5, 1, 0.5), note(1, 2), note(2, 4), note(2.25, 3)]);
    const clip = d.copy(d.idsBetween(0, 4), 0, 4)!;
    expect(clip.notes).toHaveLength(3);
    const pasted = d.paste(clip, 4, 100);
    expect(pasted).toHaveLength(3);
    expect(d.notes.map((n) => [n.pos, n.lane])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [4, 0],
      [5, 1],
      [6, 2],
    ]);
    // Into a narrower chart the fifth lane folds onto the fourth.
    const four = doc([], 4);
    four.paste({ notes: [{ pos: 0, lane: 4, len: 0, phrase: -1 }], length: 1, lanes: 5 }, 0, 100);
    expect(four.notes[0].lane).toBe(3);
  });

  it('counts what is in a chart', () => {
    const d = doc([note(0, 0), note(0, 1), note(0.5, 2, 1), note(1.6, 0), note(1.7, 3), note(1.8, 4)]);
    expect(d.stats(grid())).toMatchObject({ notes: 6, long: 1, chords: 1, awkward: 1, peak: 3 });
  });
});

describe('stored edits', () => {
  it('makes hand-placed notes playable', () => {
    const cleaned = cleanNotes([note(2, 1), note(1, 0, 3), note(2, 0), note(2.001, 0), note(1, 9), note(-1, 0), note(1.5, 2, 0.01, 7), note(5, 2, 1, 3)], 5, 0.5);
    expect(cleaned.map((n) => [n.t, n.lane])).toEqual([
      [1, 0],
      [1.5, 2],
      [2, 0],
      [2, 1],
      [5, 2],
    ]);
    // The long note ends before the next one in its lane; phrases are numbered in order.
    expect(cleaned[0].dur).toBeLessThan(1);
    expect(cleaned[0].dur).toBeGreaterThan(0.9);
    expect(cleaned[1]).toMatchObject({ dur: 0, phrase: 0 });
    expect(cleaned[4].phrase).toBe(1);
  });

  it('drops what is malformed in edits from a file', () => {
    expect(sanitizeEdits(null)).toBeUndefined();
    expect(sanitizeEdits({ charts: { 'lead:expert': 'no' } })).toBeUndefined();
    const e = sanitizeEdits({
      grid: { kind: 'fixed', bpm: 9999, offset: 0.5 },
      duration: 30,
      charts: { 'lead:easy': [note(1, 0), note(2, 4), { t: 'x', lane: 0 }, note(99, 1)], 'kazoo:easy': [note(1, 0)], 'bass:expert': [note(1, 4)] },
      extra: true,
    })!;
    expect(e.grid).toEqual({ kind: 'fixed', bpm: 260, offset: 0.5, beatsPerBar: 4 });
    // Easy has four lanes, and the song is thirty seconds long.
    expect(e.charts['lead:easy']).toEqual([note(1, 0)]);
    expect(e.charts['bass:expert']).toEqual([note(1, 4)]);
    expect(Object.keys(e.charts)).toEqual(['lead:easy', 'bass:expert']);
    expect('extra' in e).toBe(false);
  });

  it('builds a chart on the grid', () => {
    const c = chartFromNotes([note(2, 1), note(1, 0)], 'bass', 'hard', buildGrid(fixed(100), 20), 20);
    expect(c).toMatchObject({ part: 'bass', difficulty: 'hard', lanes: 4, secondsPerBeat: 0.6, duration: 20 });
    expect(c.notes.map((n) => n.t)).toEqual([1, 2]);
  });
});

const analysis = (): AnalysisResult => ({
  version: 2,
  source: 'ml',
  duration: 8,
  tempo: 120,
  beats: Array.from({ length: 16 }, (_, i) => i * 0.5),
  downbeats: [0, 4, 8, 12],
  drums: Array.from({ length: 16 }, (_, i) => ({ t: i * 0.5, kind: 'kick' as const, strength: 1 })),
  bass: [],
  lead: [],
  vocals: [],
  harmony: [],
  sections: [{ start: 0, end: 8, energy: 1 }],
  energy: [],
  energyHop: 0.1,
  pitchSource: 'ml',
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('edited charts in the game', () => {
  it('plays a hand-edited chart in place of the generated one, and only that one', async () => {
    const m = new AnalysisManager(() => Promise.resolve(analysis()));
    m.enqueue('song');
    for (let i = 0; i < 5 && m.snapshot().song?.state !== 'ready'; i++) await tick();
    const made = (await m.chart('song', 'drums', 'expert'))!;
    expect(made.notes.length).toBeGreaterThan(4);

    const edits: SongEdits = { ...emptyEdits(), charts: { 'drums:expert': [note(1, 2), note(2, 3, 1)] } };
    await m.saveEdits('song', edits);
    expect(m.snapshot().song).toMatchObject({ state: 'ready', edited: 1 });
    const custom = (await m.chart('song', 'drums', 'expert'))!;
    expect(custom.notes).toEqual([note(1, 2), note(2, 3, 1)]);
    expect(custom.beats[1]).toBeCloseTo(0.5);
    // The other difficulties and the generated chart itself are untouched.
    expect((await m.chart('song', 'drums', 'hard'))!.notes.length).toBeGreaterThan(2);
    expect((await m.generated('song', 'drums', 'expert'))!.notes).toEqual(made.notes);

    await m.saveEdits('song', null);
    expect(m.snapshot().song?.edited).toBeUndefined();
    expect((await m.chart('song', 'drums', 'expert'))!.notes).toEqual(made.notes);
  });

  it('makes a song started from scratch playable without analyzing it', async () => {
    let analyzed = 0;
    const m = new AnalysisManager(() => (analyzed++, Promise.resolve(analysis())));
    await m.saveEdits('fresh', { ...emptyEdits(), grid: fixed(120, 0), duration: 12, charts: { 'lead:easy': [note(1, 0)] } });
    await m.check('fresh', true);
    await tick();
    expect(analyzed).toBe(0);
    expect(m.snapshot().fresh).toMatchObject({ state: 'ready', manual: true, edited: 1 });
    expect((await m.chart('fresh', 'lead', 'easy'))!).toMatchObject({ lanes: 4, duration: 12, notes: [note(1, 0)] });
    // A part nobody has charted is there, and empty.
    expect((await m.chart('fresh', 'bass', 'expert'))!.notes).toEqual([]);
  });

  it('stops an analysis that is no longer wanted', async () => {
    let aborted = false;
    const m = new AnalysisManager(
      (_id, _p, signal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('cancelled'));
          }),
        ),
    );
    m.enqueue('song');
    await tick();
    m.cancel('song');
    await tick();
    expect(aborted).toBe(true);
    expect(m.snapshot().song?.state).toBe('idle');
  });
});

describe('finding a tempo by listening', () => {
  it('finds the tempo and the beat of a steady song to within a few milliseconds', async () => {
    const { hearBeats, steadyGrid } = await import('../src/editor/tempo');
    const sr = 22050;
    const bpm = 128;
    const spb = 60 / bpm;
    const first = 0.3;
    const signal = new Float32Array(sr * 40);
    let seed = 3;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let b = 0; first + b * spb < 39; b++) {
      const at = Math.floor((first + b * spb) * sr);
      // A kick on every beat (louder on the first of four), a snare on two and four.
      for (let i = 0; i < 4000; i++) signal[at + i] += Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-i / 700)) * (i / sr)) * Math.exp(-i / 1800) * (b % 4 === 0 ? 1 : 0.7);
      if (b % 2 === 1) for (let i = 0; i < 3000; i++) signal[at + i] += noise() * Math.exp(-i / 900) * 0.4;
    }
    const heard = hearBeats(signal, sr);
    expect(heard.beats.length).toBeGreaterThan(60);
    const grid = steadyGrid(signal, sr, heard);
    expect(grid.bpm).toBe(128);
    expect(grid.beatsPerBar).toBe(4);
    // The beat sits on the kicks, whichever of them was taken for the first of the bar.
    const off = (((grid.offset - first) % spb) + spb) % spb;
    expect(Math.min(off, spb - off)).toBeLessThan(0.012);
  });

  it('counts beats that went unheard when it fits a tempo', () => {
    const spb = 60 / 100;
    const beats = Array.from({ length: 80 }, (_, i) => 1 + i * spb).filter((_, i) => i < 20 || i > 27);
    expect(fitFixed(beats, [0, 4, 8]).bpm).toBe(100);
  });
});
