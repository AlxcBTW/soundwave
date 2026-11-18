import { describe, expect, it } from 'vitest';
import { festivalAudio, festivalFileName, FestivalFileError, isFestival, readFestival, writeFestival, type FestivalContents } from '../src/storage/festivalFile';

const audioBytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) & 255);
const coverBytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 13) & 255);

function contents(extra: Partial<FestivalContents> = {}): FestivalContents {
  return {
    meta: { title: 'Night Drive', artist: 'The Lanes', album: 'Highway', duration: 201.5, fileName: 'night-drive.mp3', addedAt: 1700000000000 },
    cover: new Blob([coverBytes], { type: 'image/png' }),
    analysis: { version: 2, data: { tempo: 128, beats: [0.5, 0.97, 1.44], note: 'ü' } },
    audio: new Blob([audioBytes], { type: 'audio/mpeg' }),
    ...extra,
  };
}

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

describe('.festival files', () => {
  it('carries a song whole: details, cover, analysis and the audio byte for byte', async () => {
    const file = await writeFestival(contents());
    expect(await isFestival(file)).toBe(true);
    const back = await readFestival(file);
    expect(back.meta).toEqual(contents().meta);
    expect(back.analysis).toEqual({ version: 2, data: { tempo: 128, beats: [0.5, 0.97, 1.44], note: 'ü' } });
    expect(back.cover?.type).toBe('image/png');
    expect(await bytes(back.cover!)).toEqual(coverBytes);
    expect(back.audio.type).toBe('audio/mpeg');
    expect(await bytes(back.audio)).toEqual(audioBytes);
  });

  it('starts with its magic and version, and slices the audio out without reading the rest', async () => {
    const file = await writeFestival(contents());
    const head = await bytes(file.slice(0, 12));
    expect(String.fromCharCode(...head.subarray(0, 8))).toBe('FESTIVAL');
    expect(head[8] | (head[9] << 8)).toBe(1);
    const audio = await festivalAudio(file);
    expect(audio.type).toBe('audio/mpeg');
    expect(await bytes(audio)).toEqual(audioBytes);
  });

  it('works without a cover or an analysis', async () => {
    const back = await readFestival(await writeFestival(contents({ cover: undefined, analysis: undefined })));
    expect(back.cover).toBeUndefined();
    expect(back.analysis).toBeUndefined();
    expect(await bytes(back.audio)).toEqual(audioBytes);
  });

  it('turns down what is not a song file, is damaged, cut short or from a newer version', async () => {
    await expect(readFestival(new Blob([audioBytes]))).rejects.toThrow(FestivalFileError);
    const good = await bytes(await writeFestival(contents()));

    const flipped = good.slice();
    flipped[flipped.length - 100] ^= 0xff; // inside the audio
    await expect(readFestival(new Blob([flipped]))).rejects.toThrow(/damaged/);

    await expect(readFestival(new Blob([good.subarray(0, good.length - 10)]))).rejects.toThrow(FestivalFileError);

    const newer = good.slice();
    newer[8] = 9;
    await expect(readFestival(new Blob([newer]))).rejects.toThrow(/newer version/);
  });

  it('skips chunks it does not know, so later versions can add their own', async () => {
    const good = await bytes(await writeFestival(contents()));
    const extra = new Uint8Array([...'XTRA'].map((c) => c.charCodeAt(0)).concat([3, 0, 0, 0, 1, 2, 3, 0, 0, 0, 0]));
    const withExtra = new Blob([good.subarray(0, 12), extra, good.subarray(12)]);
    expect(await bytes((await readFestival(withExtra)).audio)).toEqual(audioBytes);
  });

  it('keeps out what it cannot trust in a file from elsewhere', async () => {
    const back = await readFestival(
      await writeFestival(
        contents({
          meta: { title: 'x'.repeat(1000), artist: '  ', duration: Number.NaN, fileName: 'a.mp3' },
          cover: new Blob(['<svg onload="alert(1)"/>'], { type: 'image/svg+xml' }),
        }),
      ),
    );
    expect(back.meta.title).toHaveLength(300);
    expect(back.meta.artist).toBe('Unknown artist');
    expect(back.meta.duration).toBe(0);
    expect(back.cover).toBeUndefined();
  });

  it('names files "Artist - Title.festival", safe on every system', () => {
    expect(festivalFileName({ artist: 'AC/DC', title: 'T.N.T.' })).toBe('AC DC - T.N.T.festival');
    expect(festivalFileName({ artist: 'A', title: 'Why? <Live>: "2024"' })).toBe('A - Why Live 2024.festival');
    expect(festivalFileName({ artist: 'Unknown artist', title: 'Night Drive' })).toBe('Night Drive.festival');
    expect(festivalFileName({ artist: '', title: '' })).toBe('song.festival');
  });
});
