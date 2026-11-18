import { parseBlob } from 'music-metadata';
import type { SongMeta } from '../storage/db';
import { hashBytes } from '../storage/hash';

export const ACCEPTED = '.soundwave,.mp3,.wav,.flac,.ogg,.oga,.opus,.m4a,.aac,.webm,audio/*';
const AUDIO_EXT = /\.(mp3|wav|wave|flac|ogg|oga|opus|m4a|aac|webm)$/i;

export const isAudioFile = (f: File) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name);

const stripExt = (name: string) => name.replace(/\.[^.]+$/, '');

/** Reads tags and cover art and hashes the file. Decoding happens later, when the song is analyzed or played. */
export async function readSongFile(file: File): Promise<{ meta: SongMeta; bytes: ArrayBuffer }> {
  const bytes = await file.arrayBuffer();
  const id = await hashBytes(bytes);
  let title = stripExt(file.name);
  let artist = 'Unknown artist';
  let album: string | undefined;
  let duration = 0;
  let cover: Blob | undefined;
  try {
    const md = await parseBlob(file, { duration: false, skipCovers: false });
    title = md.common.title?.trim() || title;
    artist = md.common.artist?.trim() || md.common.albumartist?.trim() || artist;
    album = md.common.album?.trim() || undefined;
    duration = md.format.duration ?? 0;
    const pic = md.common.picture?.[0];
    if (pic) cover = new Blob([pic.data as Uint8Array<ArrayBuffer>], { type: pic.format });
  } catch {
    // Tags are optional; untagged or unusual files still import with the file name.
  }
  if (artist === 'Unknown artist' && / - /.test(title)) {
    const [a, ...rest] = title.split(' - ');
    artist = a.trim();
    title = rest.join(' - ').trim();
  }
  return {
    bytes,
    meta: {
      id,
      title,
      artist,
      album,
      fileName: file.name,
      mime: file.type || 'audio/*',
      size: file.size,
      duration,
      addedAt: Date.now(),
      cover,
    },
  };
}
