import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { StemName } from '../analysis/types';
import type { Difficulty, Part } from '../chart/types';

export interface SongMeta {
  id: string;
  title: string;
  artist: string;
  album?: string;
  fileName: string;
  mime: string;
  size: number;
  duration: number;
  addedAt: number;
  cover?: Blob;
}

export interface BestScore {
  key: string;
  songId: string;
  part: Part;
  difficulty: Difficulty;
  score: number;
  stars: number;
  accuracy: number;
  fullCombo: boolean;
  date: number;
}

interface FestivalDB extends DBSchema {
  songs: { key: string; value: SongMeta; indexes: { addedAt: number } };
  audio: { key: string; value: { id: string; blob: Blob } };
  /** Cached analysis results keyed by `${songId}:${analyzerVersion}:${source}`. */
  analysis: { key: string; value: { key: string; songId: string; data: unknown } };
  scores: { key: string; value: BestScore; indexes: { songId: string } };
  /** Separated stems from the ML service, keyed by `${songId}:${name}` (for previewing). */
  stems: { key: string; value: { key: string; songId: string; name: StemName; blob: Blob }; indexes: { songId: string } };
}

let dbPromise: Promise<IDBPDatabase<FestivalDB>> | null = null;

function db() {
  dbPromise ??= openDB<FestivalDB>('festival', 2, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore('songs', { keyPath: 'id' }).createIndex('addedAt', 'addedAt');
        d.createObjectStore('audio', { keyPath: 'id' });
        d.createObjectStore('analysis', { keyPath: 'key' });
        d.createObjectStore('scores', { keyPath: 'key' }).createIndex('songId', 'songId');
      }
      if (oldVersion < 2) d.createObjectStore('stems', { keyPath: 'key' }).createIndex('songId', 'songId');
    },
  });
  return dbPromise;
}

export async function listSongs(): Promise<SongMeta[]> {
  const all = await (await db()).getAllFromIndex('songs', 'addedAt');
  return all.reverse();
}

export async function getSong(id: string) {
  return (await db()).get('songs', id);
}

export async function putSong(meta: SongMeta, blob: Blob) {
  const d = await db();
  const tx = d.transaction(['songs', 'audio'], 'readwrite');
  await Promise.all([tx.objectStore('songs').put(meta), tx.objectStore('audio').put({ id: meta.id, blob }), tx.done]);
}

export async function getAudio(id: string): Promise<Blob | undefined> {
  return (await (await db()).get('audio', id))?.blob;
}

export async function deleteSong(id: string) {
  const d = await db();
  const tx = d.transaction(['songs', 'audio', 'analysis', 'scores', 'stems'], 'readwrite');
  await tx.objectStore('songs').delete(id);
  await tx.objectStore('audio').delete(id);
  const analysis = tx.objectStore('analysis');
  for (let c = await analysis.openCursor(); c; c = await c.continue()) {
    if (c.value.songId === id) await c.delete();
  }
  const scores = tx.objectStore('scores');
  for (let c = await scores.index('songId').openCursor(id); c; c = await c.continue()) await c.delete();
  const stems = tx.objectStore('stems');
  for (let c = await stems.index('songId').openCursor(id); c; c = await c.continue()) await c.delete();
  await tx.done;
}

/** Replaces a song's stored stems. */
export async function putStems(songId: string, stems: Partial<Record<StemName, Blob>>) {
  const tx = (await db()).transaction('stems', 'readwrite');
  for (let c = await tx.store.index('songId').openCursor(songId); c; c = await c.continue()) await c.delete();
  for (const [name, blob] of Object.entries(stems) as [StemName, Blob][]) {
    await tx.store.put({ key: `${songId}:${name}`, songId, name, blob });
  }
  await tx.done;
}

export async function listStems(songId: string): Promise<StemName[]> {
  const rows = await (await db()).getAllFromIndex('stems', 'songId', songId);
  // Same order as the parts: instruments (lead), bass, drums, vocals.
  const order: StemName[] = ['other', 'bass', 'drums', 'vocals'];
  return rows.map((r) => r.name).sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

export async function getStem(songId: string, name: StemName): Promise<Blob | undefined> {
  return (await (await db()).get('stems', `${songId}:${name}`))?.blob;
}

export const analysisKey = (songId: string, version: number, source: string) => `${songId}:${version}:${source}`;

export async function getAnalysis<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('analysis', key))?.data as T | undefined;
}

export async function deleteAnalyses(songId: string) {
  const tx = (await db()).transaction('analysis', 'readwrite');
  for (let c = await tx.store.openCursor(); c; c = await c.continue()) if (c.value.songId === songId) await c.delete();
  await tx.done;
}

export async function putAnalysis(key: string, songId: string, data: unknown) {
  await (await db()).put('analysis', { key, songId, data });
}

export const scoreKey = (songId: string, part: Part, d: Difficulty) => `${songId}:${part}:${d}`;

export async function getScores(songId: string): Promise<BestScore[]> {
  return (await db()).getAllFromIndex('scores', 'songId', songId);
}

/** Stores the score if it beats the previous best. Returns the previous best score, if any. */
export async function submitScore(s: Omit<BestScore, 'key' | 'date'>): Promise<number | undefined> {
  const d = await db();
  const key = scoreKey(s.songId, s.part, s.difficulty);
  const prev = await d.get('scores', key);
  if (!prev || s.score > prev.score) await d.put('scores', { ...s, key, date: Date.now() });
  return prev?.score;
}
