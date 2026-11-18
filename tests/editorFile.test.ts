import { describe, expect, it } from 'vitest';
import { EDITS_VERSION, emptyEdits, sanitizeEdits, type SongEdits } from '../src/editor/edits';
import { readSoundwave, writeSoundwave } from '../src/storage/soundwaveFile';

const audio = new Blob([Uint8Array.from({ length: 2000 }, (_, i) => (i * 11) & 255)], { type: 'audio/mpeg' });
const meta = { title: 'Hand Made', artist: 'The Lanes', duration: 30, fileName: 'hand-made.mp3' };

describe('edited charts in a .soundwave file', () => {
  it('travel with the song and come back as they were', async () => {
    const edits: SongEdits = {
      ...emptyEdits(),
      grid: { kind: 'fixed', bpm: 128, offset: 0.31, beatsPerBar: 4 },
      duration: 30,
      charts: { 'lead:expert': [{ t: 1, lane: 4, dur: 0.5, phrase: 0, release: true }], 'drums:easy': [{ t: 2, lane: 0, dur: 0, phrase: -1 }] },
    };
    const file = await writeSoundwave({ meta, edits: { version: EDITS_VERSION, data: edits }, audio });
    const back = await readSoundwave(file);
    expect(back.edits?.version).toBe(EDITS_VERSION);
    expect(sanitizeEdits(back.edits?.data)).toEqual(edits);
    // The audio is still the last chunk, byte for byte.
    expect(new Uint8Array(await back.audio.arrayBuffer())).toEqual(new Uint8Array(await audio.arrayBuffer()));
  });

  it('are simply absent from a file without them', async () => {
    const back = await readSoundwave(await writeSoundwave({ meta, audio }));
    expect(back.edits).toBeUndefined();
  });
});
