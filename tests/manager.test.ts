import { describe, expect, it } from 'vitest';
import { AnalysisManager, type Assist, type LocalAnalyzer } from '../src/analysis/manager';
import type { StemAnalyzer } from '../src/analysis/separation/analyzer';
import type { AnalysisResult } from '../src/analysis/types';

const result = (): AnalysisResult => ({
  version: 1,
  source: 'local',
  duration: 10,
  tempo: 120,
  beats: [0.5, 1],
  downbeats: [0],
  drums: [],
  bass: [],
  lead: [],
  vocals: [],
  harmony: [],
  sections: [],
  energy: [],
  energyHop: 0.1,
  pitchSource: 'salience',
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('AnalysisManager', () => {
  it('does not keep a failure from a song removed mid-analysis, and re-analyzes on re-import', async () => {
    let calls = 0;
    let failFirst: (e: Error) => void = () => {};
    let aborted = false;
    const local: LocalAnalyzer = (_id, _p, signal) => {
      calls++;
      if (calls === 1) {
        signal.addEventListener('abort', () => (aborted = true));
        // The first run outlives the removal and then fails, like reading deleted audio.
        return new Promise((_, reject) => (failFirst = reject));
      }
      return Promise.resolve(result());
    };
    const m = new AnalysisManager(local);

    m.enqueue('song');
    await tick();
    expect(m.snapshot().song?.state).toBe('analyzing');

    m.forget('song'); // removed while analyzing
    expect(aborted).toBe(true);
    failFirst(new Error('The audio file for this song is missing.'));
    await tick();
    expect(m.snapshot().song).toBeUndefined();

    await m.check('song', true); // re-imported: no cached analysis, so it queues again
    for (let i = 0; i < 5 && m.snapshot().song?.state !== 'ready'; i++) await tick();
    expect(m.snapshot().song?.state).toBe('ready');
    expect(calls).toBe(2);
  });

  it('ignores a successful result that arrives after the song was removed', async () => {
    let finish: (r: AnalysisResult) => void = () => {};
    const m = new AnalysisManager(() => new Promise((res) => (finish = res)));
    m.enqueue('song');
    await tick();
    m.forget('song');
    finish(result());
    await tick();
    await tick();
    expect(m.snapshot().song).toBeUndefined();
    expect(await m.chart('song', 'drums', 'easy')).toBeUndefined();
  });

  it('separates a song into stems first and hands them to the rest of the analysis', async () => {
    const wav = () => new ArrayBuffer(8);
    const separator: StemAnalyzer = async (_id, onProgress) => {
      onProgress(0.5, 'Separating stems');
      return { stems: { drums: wav(), bass: wav(), vocals: wav(), other: wav() }, notes: { bass: [{ t: 1, dur: 0.2, midi: 40, strength: 1 }], vocals: [], other: [] } };
    };
    let got: Assist | undefined;
    const m = new AnalysisManager((_id, _p, _signal, assist) => {
      got = assist;
      return Promise.resolve({ ...result(), source: 'ml' });
    }, separator);
    m.enqueue('song');
    for (let i = 0; i < 5 && m.snapshot().song?.state !== 'ready'; i++) await tick();
    expect(m.snapshot().song?.state).toBe('ready');
    expect(Object.keys(got?.stems ?? {}).sort()).toEqual(['bass', 'drums', 'other', 'vocals']);
    expect(got?.drumStem).toBeInstanceOf(ArrayBuffer);
    expect(got?.stemNotes?.bass).toHaveLength(1);
  });

  it('does not chart a song it could not separate', async () => {
    let charted = false;
    const m = new AnalysisManager(
      () => {
        charted = true;
        return Promise.resolve(result());
      },
      () => Promise.reject(new Error('The analysis model could not be downloaded.')),
    );
    m.enqueue('song');
    for (let i = 0; i < 5 && m.snapshot().song?.state !== 'error'; i++) await tick();
    expect(m.snapshot().song).toMatchObject({ state: 'error', error: 'The analysis model could not be downloaded.' });
    expect(charted).toBe(false);
  });

  it('reports real failures', async () => {
    const m = new AnalysisManager(() => Promise.reject(new Error('decode failed')));
    m.enqueue('song');
    for (let i = 0; i < 5 && m.snapshot().song?.state !== 'error'; i++) await tick();
    expect(m.snapshot().song).toMatchObject({ state: 'error', error: 'decode failed' });
  });
});
