/**
 * The song preview: whichever song is highlighted in a list, or open on its page, plays by itself
 * after a moment, from a third of the way in, and goes round the same half minute until another
 * song is highlighted. It fades in and out, and from one song to the next.
 *
 * It has a source and a gain of its own and joins the game's output at the analyser, so the stage
 * behind the menus moves to it, the master output and its muting apply, and nothing that plays a
 * song through the engine (a set, the editor) is disturbed by it.
 */
import { getEngine } from './engine';
import { loadSongBuffer } from './songAudio';

/** How long a song has to stay highlighted before it plays: moving down a list starts nothing. */
const DWELL_MS = 420;
/** How much of the song is played before it goes round again, seconds. */
const LENGTH = 30;
const FADE_IN = 0.7;
const FADE_OUT = 0.35;
/** A preview sits a little under a song that is played. */
const LEVEL = 0.8;

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

let wanted: string | null = null;
let volume = 0.9;
/** Counts every change of what is wanted: work begun for an older one gives up. */
let token = 0;
let voice: Voice | null = null;
let dwell = 0;
let round = 0;
let sounding = false;
const listeners = new Set<() => void>();

function setSounding(on: boolean) {
  if (on === sounding) return;
  sounding = on;
  for (const l of listeners) l();
}

function fadeOut(v: Voice, seconds = FADE_OUT) {
  const ctx = getEngine().ctx;
  const t = ctx.currentTime;
  const g = v.gain.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(0, t + seconds);
  v.src.onended = () => {
    v.src.disconnect();
    v.gain.disconnect();
  };
  try {
    v.src.stop(t + seconds + 0.03);
  } catch {
    /* already stopped */
  }
}

async function start(id: string, mine: number) {
  const engine = getEngine();
  let buffer: AudioBuffer;
  try {
    buffer = await loadSongBuffer(id);
  } catch {
    // A song that cannot be decoded has no preview; playing it says why.
    if (token === mine) setSounding(false);
    return;
  }
  if (token !== mine) return;
  const ctx = engine.ctx;
  if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  // Browsers start audio only after a press: until then there is no preview.
  if (token !== mine || (ctx.state as AudioContextState) !== 'running') return;
  const from = buffer.duration > LENGTH * 1.5 ? buffer.duration / 3 : 0;
  const length = Math.min(LENGTH, buffer.duration - from);
  const play = () => {
    if (token !== mine) return;
    if (voice) fadeOut(voice);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    const t = ctx.currentTime + 0.03;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume * LEVEL, t + FADE_IN);
    src.connect(gain).connect(engine.analyser);
    src.start(t, from);
    voice = { src, gain };
    setSounding(true);
    // Round again from the same place, fading across the join.
    round = window.setTimeout(play, Math.max(2, length - FADE_OUT) * 1000);
  };
  play();
}

/**
 * Says which song should be previewing: the highlighted one, or null for none. Asking for the song
 * that is already playing changes nothing.
 */
export function previewSong(id: string | null) {
  if (id === wanted) return;
  wanted = id;
  token++;
  clearTimeout(dwell);
  clearTimeout(round);
  if (voice) {
    fadeOut(voice);
    voice = null;
  }
  if (!id) return setSounding(false);
  const mine = token;
  dwell = window.setTimeout(() => void start(id, mine), DWELL_MS);
}

/** The songs' volume (0..1); a preview that is playing follows it. */
export function setPreviewVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  if (!voice) return;
  const ctx = getEngine().ctx;
  voice.gain.gain.cancelScheduledValues(ctx.currentTime);
  voice.gain.gain.setTargetAtTime(volume * LEVEL, ctx.currentTime, 0.05);
}

/** Whether a preview is sounding (or about to carry on with the next song), so the menu music makes way. */
export const isPreviewing = () => sounding;

export function watchPreview(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** For checking from the console in development. */
export const previewStatus = () => ({ wanted, sounding, volume, playing: !!voice });
