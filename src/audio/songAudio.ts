import { getAudio } from '../storage/db';
import { getEngine } from './engine';

const cache = new Map<string, Promise<AudioBuffer>>();
const MAX_CACHED = 2;

export class DecodeError extends Error {}

/** Decoded audio for a song, cached for the last couple of songs. */
export function loadSongBuffer(id: string): Promise<AudioBuffer> {
  const hit = cache.get(id);
  if (hit) {
    cache.delete(id);
    cache.set(id, hit);
    return hit;
  }
  const p = (async () => {
    const blob = await getAudio(id);
    if (!blob) throw new DecodeError('The audio file for this song is missing.');
    try {
      return await getEngine().decode(await blob.arrayBuffer());
    } catch {
      throw new DecodeError('This audio format could not be decoded here. Try MP3, WAV, FLAC or OGG.');
    }
  })();
  p.catch(() => cache.delete(id));
  cache.set(id, p);
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return p;
}

export function forgetSongBuffer(id: string) {
  cache.delete(id);
}
