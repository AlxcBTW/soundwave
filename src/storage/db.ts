import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { StemName } from '../analysis/types';
import type { Difficulty, Part } from '../chart/types';
import type { SongEdits } from '../editor/edits';
import { festivalAudio, isFestival } from './festivalFile';

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
  /**
   * Each song's .festival file (src/storage/festivalFile.ts): its details, cover, analysis and
   * audio in one. Libraries from before the format hold the bare audio file here until they are
   * converted (src/storage/songFile.ts).
   */
  audio: { key: string; value: { id: string; blob: Blob } };
  /** Cached analysis results keyed by `${songId}:${analyzerVersion}:${source}`. */
  analysis: { key: string; value: { key: string; songId: string; data: unknown } };
  scores: { key: string; value: BestScore; indexes: { songId: string } };
  /** A song's separated stems, keyed by `${songId}:${name}` (for previewing). */
  stems: { key: string; value: { key: string; songId: string; name: StemName; blob: Blob }; indexes: { songId: string } };
  /** What the track editor made for a song: hand-edited charts and their beat grid, keyed by song id. */
  edits: { key: string; value: { songId: string; data: SongEdits } };
}

/** The library cannot be opened because the game is also open somewhere else, on an older version of it. */
export class StorageBlockedError extends Error {
  constructor() {
    super('The game is open in another tab or window that still uses an older version of your library. Close it, and your songs are back.');
  }
}

let dbPromise: Promise<IDBPDatabase<FestivalDB>> | null = null;

function db() {
  if (dbPromise) return dbPromise;
  // A database that needs upgrading waits for every older connection to close. Rather than wait
  // without a word, storage fails with the reason until the way is clear.
  let blocked: () => void = () => {};
  const gate = new Promise<never>((_, reject) => (blocked = () => reject(new StorageBlockedError())));
  const opening = openDB<FestivalDB>('festival', 4, {
    blocked,
    // A newer version of the game wants to upgrade the library: this one lets go of it.
    blocking() {
      dbPromise = null;
      void opening.then((d) => d.close()).catch(() => {});
    },
    terminated() {
      dbPromise = null;
    },
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore('songs', { keyPath: 'id' }).createIndex('addedAt', 'addedAt');
        d.createObjectStore('audio', { keyPath: 'id' });
        d.createObjectStore('analysis', { keyPath: 'key' });
        d.createObjectStore('scores', { keyPath: 'key' }).createIndex('songId', 'songId');
      }
      if (oldVersion < 2) d.createObjectStore('stems', { keyPath: 'key' }).createIndex('songId', 'songId');
      // (Version 3 added a store for a developer tool that is gone; libraries that have it keep it, unused.)
      if (oldVersion < 4) d.createObjectStore('edits', { keyPath: 'songId' });
    },
  });
  const guarded = Promise.race([opening, gate]);
  guarded.catch(() => {});
  dbPromise = guarded;
  // Opened after all (the other tab was closed): from here on storage works.
  void opening.then(
    () => {
      if (dbPromise === guarded) dbPromise = opening;
    },
    () => {
      if (dbPromise === guarded) dbPromise = null;
    },
  );
  return dbPromise;
}

/**
 * Deletes the whole library: every song and its file, analyses, stems, hand-edited charts and best
 * scores. The connection here is closed first; another tab or window still holding one blocks it.
 */
export async function deleteLibrary(): Promise<void> {
  const open = dbPromise;
  dbPromise = null;
  if (open) (await open.catch(() => undefined))?.close();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('festival');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('The library could not be deleted.'));
    req.onblocked = () => reject(new Error('The game is open in another tab or window. Close it, then try again.'));
  });
}

export async function listSongs(): Promise<SongMeta[]> {
  const all = await (await db()).getAllFromIndex('songs', 'addedAt');
  return all.reverse();
}

export async function getSong(id: string) {
  return (await db()).get('songs', id);
}

/** Stores a song: its entry in the list and its .festival file. */
export async function putSong(meta: SongMeta, file: Blob) {
  const d = await db();
  const tx = d.transaction(['songs', 'audio'], 'readwrite');
  await Promise.all([tx.objectStore('songs').put(meta), tx.objectStore('audio').put({ id: meta.id, blob: file }), tx.done]);
}

/** What is stored for a song: its .festival file, or the bare audio file of a library not yet converted. */
export async function getStoredFile(id: string): Promise<Blob | undefined> {
  return (await (await db()).get('audio', id))?.blob;
}

export async function putStoredFile(id: string, file: Blob) {
  await (await db()).put('audio', { id, blob: file });
}

/** A song's audio file, sliced out of its .festival file. */
export async function getAudio(id: string): Promise<Blob | undefined> {
  const stored = await getStoredFile(id);
  if (!stored) return undefined;
  return (await isFestival(stored)) ? festivalAudio(stored) : stored;
}

export async function deleteSong(id: string) {
  const d = await db();
  const tx = d.transaction(['songs', 'audio', 'analysis', 'scores', 'stems', 'edits'], 'readwrite');
  await tx.objectStore('songs').delete(id);
  await tx.objectStore('audio').delete(id);
  await tx.objectStore('edits').delete(id);
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

/** A song's hand-edited charts and beat grid (see src/editor/edits.ts). */
export async function getEdits(songId: string): Promise<SongEdits | undefined> {
  return (await (await db()).get('edits', songId))?.data;
}

export async function putEdits(songId: string, data: SongEdits) {
  await (await db()).put('edits', { songId, data });
}

export async function deleteEdits(songId: string) {
  await (await db()).delete('edits', songId);
}

export const scoreKey = (songId: string, part: Part, d: Difficulty) => `${songId}:${part}:${d}`;

export async function getScores(songId: string): Promise<BestScore[]> {
  return (await db()).getAllFromIndex('scores', 'songId', songId);
}

/** Every best score, across all songs. */
export async function listAllScores(): Promise<BestScore[]> {
  return (await db()).getAll('scores');
}

/** Stores the score if it beats the previous best. Returns the previous best score, if any. */
export async function submitScore(s: Omit<BestScore, 'key' | 'date'>): Promise<number | undefined> {
  const d = await db();
  const key = scoreKey(s.songId, s.part, s.difficulty);
  const prev = await d.get('scores', key);
  if (!prev || s.score > prev.score) await d.put('scores', { ...s, key, date: Date.now() });
  return prev?.score;
}

