import { getAudio } from '../storage/db';
import { renderDemoAudio } from '../game/demo';
import { getEngine } from './engine';

export const DEMO_ID = 'builtin-demo';

const cache = new Map<string, Promise<AudioBuffer>>();
const MAX_CACHED = 2;

function demoBuffer(): AudioBuffer {
  const engine = getEngine();
  const { channels, sampleRate } = renderDemoAudio(engine.ctx.sampleRate);
  const buf = engine.ctx.createBuffer(2, channels[0].length, sampleRate);
  channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return buf;
}

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
    if (id === DEMO_ID) return demoBuffer();
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
