import { describe, expect, it } from 'vitest';
import { BackupError, packBackup, preferenceKeys, readBackup } from '../src/storage/backup';
import { readSoundwave, writeSoundwave } from '../src/storage/soundwaveFile';

const song = (title: string, n: number) =>
  writeSoundwave({
    meta: { title, artist: 'Test', duration: 3, fileName: `${title}.wav` },
    audio: new Blob([Uint8Array.from({ length: n }, (_, i) => i & 255)], { type: 'audio/wav' }),
  });

const score = { songId: 'abc', part: 'drums', difficulty: 'hard', score: 12345, stars: 4, accuracy: 0.9, fullCombo: false, key: 'abc:drums:hard', date: 1 };

describe('library backups', () => {
  it('carry the songs whole, the scores and the preferences', async () => {
    const songs = [await song('One', 3000), await song('Two', 5000)];
    const file = await packBackup({ createdAt: 1700000000000, preferences: { 'soundwave.settings.v1': '{"volume":0.5}', 'soundwave.setlist': '["abc"]' }, scores: [score], songs });
    const b = await readBackup(file);
    expect(b.createdAt).toBe(1700000000000);
    expect(b.songs).toHaveLength(2);
    expect((await readSoundwave(b.songs[1])).meta.title).toBe('Two');
    expect(new Uint8Array(await b.songs[0].arrayBuffer())).toEqual(new Uint8Array(await songs[0].arrayBuffer()));
    expect(b.scores).toEqual([{ songId: 'abc', part: 'drums', difficulty: 'hard', score: 12345, stars: 4, accuracy: 0.9, fullCombo: false }]);
    expect(b.preferences).toEqual({ 'soundwave.settings.v1': '{"volume":0.5}', 'soundwave.setlist': '["abc"]' });
  });

  it('take only the game’s own preferences, never developer overrides or other sites’ keys', async () => {
    expect(preferenceKeys(['soundwave.settings.v1', 'soundwave.dev.stem-model', 'other', 'soundwave.setlist'])).toEqual(['soundwave.settings.v1', 'soundwave.setlist']);
    const file = await packBackup({ createdAt: 1, preferences: { 'soundwave.dev.analysis-device': 'none', evil: 'x', 'soundwave.home-tab': 'sets' }, scores: [], songs: [] });
    expect((await readBackup(file)).preferences).toEqual({ 'soundwave.home-tab': 'sets' });
  });

  it('drop scores that are not well formed', async () => {
    const bad = [{ ...score, part: 'kazoo' }, { ...score, score: 'lots' }, { ...score, stars: 99, accuracy: 3 }, null];
    const b = await readBackup(await packBackup({ createdAt: 1, preferences: {}, scores: bad, songs: [] }));
    expect(b.scores).toEqual([{ songId: 'abc', part: 'drums', difficulty: 'hard', score: 12345, stars: 6, accuracy: 1, fullCombo: false }]);
  });

  it('turn down song files, damaged backups and backups from a newer version', async () => {
    await expect(readBackup(await song('One', 100))).rejects.toThrow(/not a Soundwave library backup/);
    const good = new Uint8Array(await (await packBackup({ createdAt: 1, preferences: { 'soundwave.a': 'b' }, scores: [], songs: [] })).arrayBuffer());
    const damaged = good.slice();
    damaged[30] ^= 0xff; // inside the INFO payload
    await expect(readBackup(new Blob([damaged]))).rejects.toThrow(BackupError);
    await expect(readBackup(new Blob([good.subarray(0, good.length - 3)]))).rejects.toThrow(BackupError);
    const newer = good.slice();
    newer[8] = 9;
    await expect(readBackup(new Blob([newer]))).rejects.toThrow(/newer version/);
  });
});
