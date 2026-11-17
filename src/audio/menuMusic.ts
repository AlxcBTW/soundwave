/**
 * The menu theme: one seamless orchestral loop (public/audio/menu-theme.ogg, rendered by
 * tools/audio/theme.py). It plays behind every menu, steps aside for anything else that makes
 * sound (a song preview, a song, the calibration clicks) and comes back where it left off.
 * It feeds the engine's analyser, so the menu backdrop moves with it.
 */
import { getEngine } from './engine';

let buffer: AudioBuffer | null = null;
let loading: Promise<void> | null = null;
let volume = 0.6;
/** The app wants menu music (a menu is showing). */
let wanted = false;
/** Things that are making their own sound right now; the theme waits for all of them. */
let holds = 0;
/** The voice now sounding, and when and where in the loop it started. */
let voice: { src: AudioBufferSourceNode; gain: GainNode; startedAt: number } | null = null;
let offset = 0;
let waitingForGesture = false;
let watchingContext = false;

/** Freezes a parameter where its automation has brought it, so a new ramp starts from there. */
function hold(p: AudioParam, now: number) {
  if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(now);
  else {
    const v = p.value;
    p.cancelScheduledValues(now);
    p.setValueAtTime(v, now);
  }
}

const shouldPlay = () => wanted && holds === 0 && volume > 0 && !document.hidden;

function load(): Promise<void> {
  loading ??= (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}audio/menu-theme.ogg`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buffer = await getEngine().ctx.decodeAudioData(await res.arrayBuffer());
    } catch (err) {
      console.warn('Menu music is unavailable', err);
    }
  })();
  return loading;
}

function start() {
  if (voice || !buffer) return;
  const { ctx, analyser } = getEngine();
  if (!watchingContext) {
    watchingContext = true;
    ctx.addEventListener('statechange', () => sync());
  }
  if (ctx.state !== 'running') {
    // Browsers hold audio back until the first key, click or button press; whoever wakes the
    // context, the state change above starts the music.
    void ctx.resume().catch(() => {});
    if (!waitingForGesture) {
      waitingForGesture = true;
      const wake = () => {
        waitingForGesture = false;
        window.removeEventListener('pointerdown', wake, true);
        window.removeEventListener('keydown', wake, true);
        void ctx.resume().catch(() => {});
      };
      window.addEventListener('pointerdown', wake, true);
      window.addEventListener('keydown', wake, true);
    }
    return;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  // The piece itself comes in from nothing; a return from somewhere in the middle fades in slower.
  const fadeIn = offset === 0 ? 0.8 : 1.6;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + fadeIn);
  src.connect(gain).connect(analyser);
  src.start(now, offset % buffer.duration);
  voice = { src, gain, startedAt: now };
}

function stop(fadeOut: number) {
  if (!voice || !buffer) return;
  const { ctx } = getEngine();
  const { src, gain, startedAt } = voice;
  voice = null;
  const now = ctx.currentTime;
  hold(gain.gain, now);
  gain.gain.linearRampToValueAtTime(0, now + fadeOut);
  src.stop(now + fadeOut + 0.02);
  src.onended = () => {
    src.disconnect();
    gain.disconnect();
  };
  offset = (offset + now + fadeOut - startedAt) % buffer.duration;
}

/** Brings what is sounding in line with what should be; `fadeOut` is how fast the theme leaves. */
function sync(fadeOut = 0.5) {
  if (shouldPlay()) {
    if (!buffer) void load().then(() => shouldPlay() && start());
    else start();
  } else stop(fadeOut);
}

/** Turns the theme on (a menu is showing) or off; `fade` is how fast it leaves, in seconds. */
export function setMenuMusic(on: boolean, fade = 0.5) {
  wanted = on;
  sync(fade);
}

/** Menu music volume, 0..1. */
export function setMusicVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  if (voice && volume > 0) {
    const now = getEngine().ctx.currentTime;
    hold(voice.gain.gain, now);
    voice.gain.gain.setTargetAtTime(volume, now, 0.05);
  }
  sync(0.2);
}

/**
 * Keeps the theme quiet while something else plays; call the returned function when it is done.
 * (An effect cleanup in React, typically.)
 */
export function holdMenuMusic(fade = 0.4): () => void {
  holds++;
  sync(fade);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
    sync();
  };
}

if (typeof document !== 'undefined') {
  // No music from a window nobody is looking at.
  document.addEventListener('visibilitychange', () => sync(0.3));
}

/** For checking the player from the console in development. */
export const menuMusicStatus = () => ({ loaded: !!buffer, playing: !!voice, wanted, holds, volume, offset, duration: buffer?.duration ?? 0 });
