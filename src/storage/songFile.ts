/**
 * Songs as .festival files: every song in the library is stored as one (src/storage/festivalFile.ts),
 * kept up to date as it is analyzed, and that same file is what is exported and shared. The song
 * list and the analysis cache in the database are indexes of it, for listing and playing quickly.
 */
import { ANALYSIS_VERSION, isAnalysisResult, type AnalysisResult } from '../analysis/types';
import { analysisKey, getAnalysis, getSong, getStoredFile, listSongs, putAnalysis, putSong, putStoredFile, type SongMeta } from './db';
import { isFestival, readFestival, writeFestival, type FestivalAnalysis } from './festivalFile';
import { hashBytes } from './hash';

/** One write of a song's file at a time, so a conversion and a finished analysis cannot cross. */
let writes: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = writes.then(job, job);
  writes = next.catch(() => {});
  return next;
}

/** The analysis a song's file should carry: the cached one for the current analyzer, if any. */
async function cachedAnalysis(id: string): Promise<AnalysisResult | undefined> {
  for (const source of ['ml', 'local']) {
    const r = await getAnalysis<AnalysisResult>(analysisKey(id, ANALYSIS_VERSION, source)).catch(() => undefined);
    if (r && isAnalysisResult(r)) return r;
  }
  return undefined;
}

function build(meta: SongMeta, audio: Blob, analysis?: AnalysisResult) {
  return writeFestival({
    meta: { title: meta.title, artist: meta.artist, album: meta.album, duration: meta.duration, fileName: meta.fileName, addedAt: meta.addedAt },
    cover: meta.cover,
    analysis: analysis ? { version: ANALYSIS_VERSION, data: analysis } : undefined,
    audio: audio.type ? audio : new Blob([audio], { type: meta.mime }),
  });
}

/** The bare audio of what is stored, whichever form it is in. */
async function audioOf(stored: Blob, meta: SongMeta): Promise<Blob> {
  if (!(await isFestival(stored))) return stored.type ? stored : new Blob([stored], { type: meta.mime });
  return (await readFestival(stored)).audio;
}

/** Adds a song from an audio file: it is stored as a .festival file. */
export async function storeNewSong(meta: SongMeta, audio: Blob) {
  await putSong(meta, await build(meta, audio));
}

/** Writes a finished analysis into the song's file, so the file carries its charts. */
export function writeAnalysisToFile(id: string, analysis: AnalysisResult): Promise<void> {
  return serial(async () => {
    const [meta, stored] = await Promise.all([getSong(id), getStoredFile(id)]);
    if (!meta || !stored) return;
    await putStoredFile(id, await build(meta, await audioOf(stored, meta), analysis));
  });
}

/** A song's .festival file, for exporting: with its cover and current analysis. */
export function songFile(id: string): Promise<Blob> {
  return serial(async () => {
    const [meta, stored] = await Promise.all([getSong(id), getStoredFile(id)]);
    if (!meta || !stored) throw new Error('This song is no longer in your library.');
    const analysis = await cachedAnalysis(id);
    if (await isFestival(stored)) {
      // The stored file is current unless the analysis changed since it was written.
      const has = (await readFestival(stored)).analysis;
      if (!analysis || (has?.version === ANALYSIS_VERSION && JSON.stringify(has.data) === JSON.stringify(analysis))) return stored;
    }
    const file = await build(meta, await audioOf(stored, meta), analysis);
    await putStoredFile(id, file);
    return file;
  });
}

/**
 * Converts a library from before the .festival format: each song stored as a bare audio file is
 * rewritten as a .festival file carrying its details, cover and analysis. Songs already converted
 * are left as they are, so this is cheap to run on every start.
 */
export async function convertLibrary(): Promise<number> {
  let converted = 0;
  for (const meta of await listSongs()) {
    try {
      const done = await serial(async () => {
        const stored = await getStoredFile(meta.id);
        if (!stored || (await isFestival(stored))) return false;
        await putStoredFile(meta.id, await build(meta, await audioOf(stored, meta), await cachedAnalysis(meta.id)));
        return true;
      });
      if (done) converted++;
    } catch (e) {
      console.warn(`could not convert "${meta.title}" to a song file`, e);
    }
  }
  return converted;
}

function usableAnalysis(a: FestivalAnalysis | undefined): AnalysisResult | undefined {
  if (!a || a.version !== ANALYSIS_VERSION || !isAnalysisResult(a.data)) return undefined;
  const r = a.data as AnalysisResult;
  return r.source === 'ml' || r.source === 'local' ? r : undefined;
}

/**
 * Reads a .festival file from elsewhere. The song's id is worked out from its audio again (never
 * taken from the file), and its analysis is kept only when this version of the game charts from it.
 */
export async function readSongPackage(file: Blob, fileName: string): Promise<{ meta: SongMeta; audio: Blob; analysis?: AnalysisResult }> {
  const c = await readFestival(file);
  const id = await hashBytes(await c.audio.arrayBuffer());
  const meta: SongMeta = {
    id,
    title: c.meta.title,
    artist: c.meta.artist,
    album: c.meta.album,
    fileName: c.meta.fileName || fileName,
    mime: c.audio.type,
    size: c.audio.size,
    duration: c.meta.duration,
    addedAt: Date.now(),
    cover: c.cover,
  };
  return { meta, audio: c.audio, analysis: usableAnalysis(c.analysis) };
}

/** Adds a song read from a .festival file, with its analysis when it came with a usable one. */
export async function storeSongPackage(p: { meta: SongMeta; audio: Blob; analysis?: AnalysisResult }) {
  await putSong(p.meta, await build(p.meta, p.audio, p.analysis));
  if (p.analysis) await putAnalysis(analysisKey(p.meta.id, ANALYSIS_VERSION, p.analysis.source), p.meta.id, p.analysis);
}
