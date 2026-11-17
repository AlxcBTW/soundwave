/**
 * The menu theme (public/audio, rendered by tools/audio/theme.py): a short intro that is heard
 * once, then one seamless loop. It plays behind every menu and steps aside for anything else
 * that makes sound (a song preview, a song, the calibration clicks). After a short interruption
 * it comes back where it left off; after a long one, such as a song, it starts from the top.
 * It feeds the engine's analyser, so the menu backdrop moves with it.
 */
import { getEngine } from './engine';

/**
 * Seconds of the loop that the intro file also holds: the intro ends at this point of the loop,
 * and the loop takes over there. HEAD_BARS in tools/audio/theme.py, in seconds.
 */
const HANDOVER = 9.6;
/** How long the intro and the loop overlap where they meet (they are identical there). */
const BLEND = 0.08;
/** An interruption longer than this (seconds) ends the piece: it starts again from the top. */
const RESTART_AFTER = 20;

let loop: AudioBuffer | null = null;
let intro: AudioBuffer | null = null;
let loading: Promise<void> | null = null;
let volume = 0.6;
/** The app wants menu music (a menu is showing). */
let wanted = false;
/** Things that are making their own sound right now; the theme waits for all of them. */
let holds = 0;
/**
 * What is sounding: its sources, its fader, when it started (context time) and where in the
 * loop it will be at that moment (negative while the intro is still playing).
 */
let voice: { sources: AudioBufferSourceNode[]; gain: GainNode; startedAt: number; from: number } | null = null;
/** Where in the loop to pick up; 0 is the top, which gets the intro. */
let offset = 0;
let stoppedAt = 0;
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

async function fetchBuffer(name: string): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}audio/${name}.ogg`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await getEngine().ctx.decodeAudioData(await res.arrayBuffer());
  } catch (err) {
    console.warn(`Menu music (${name}) is unavailable`, err);
    return null;
  }
}

function load(): Promise<void> {
  loading ??= (async () => {
    [loop, intro] = await Promise.all([fetchBuffer('menu-theme'), fetchBuffer('menu-theme-intro')]);
  })();
  return loading;
}

function start() {
  if (voice || !loop) return;
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
  const now = ctx.currentTime;
  if (stoppedAt && now - stoppedAt > RESTART_AFTER) offset = 0;
  const gain = ctx.createGain();
  gain.connect(analyser);
  const play = (buffer: AudioBuffer, looping: boolean) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = looping;
    const fader = ctx.createGain();
    src.connect(fader).connect(gain);
    return { src, fader };
  };
  const body = play(loop, true);
  const sources = [body.src];
  let fadeIn: number;
  let from: number;
  if (offset === 0 && intro && intro.duration > HANDOVER + BLEND) {
    // From the top: the intro once, the loop taking over where the intro ends.
    const head = play(intro, false);
    const join = now + intro.duration - BLEND;
    head.fader.gain.setValueAtTime(1, join);
    head.fader.gain.linearRampToValueAtTime(0, join + BLEND);
    body.fader.gain.setValueAtTime(0, join);
    body.fader.gain.linearRampToValueAtTime(1, join + BLEND);
    head.src.start(now);
    body.src.start(join, HANDOVER - BLEND);
    sources.push(head.src);
    from = HANDOVER - intro.duration;
    fadeIn = 0.05; // the intro itself rises out of silence
  } else {
    // Picking up in the middle (or no intro to play): fade in.
    body.src.start(now, offset % loop.duration);
    from = offset;
    fadeIn = 1.6;
  }
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + fadeIn);
  voice = { sources, gain, startedAt: now, from };
}

function stop(fadeOut: number) {
  if (!voice || !loop) return;
  const { ctx } = getEngine();
  const { sources, gain, startedAt, from } = voice;
  voice = null;
  const now = ctx.currentTime;
  hold(gain.gain, now);
  gain.gain.linearRampToValueAtTime(0, now + fadeOut);
  for (const src of sources) {
    try {
      src.stop(now + fadeOut + 0.02);
    } catch {
      /* already ended */
    }
  }
  sources[0].onended = () => gain.disconnect();
  // Interrupted during the intro, the piece starts over; otherwise it resumes where it was.
  const at = from + (now + fadeOut - startedAt);
  offset = at <= 0 ? 0 : at % loop.duration;
  stoppedAt = now;
}

/** Brings what is sounding in line with what should be; `fadeOut` is how fast the theme leaves. */
function sync(fadeOut = 0.5) {
  if (shouldPlay()) {
    if (!loop) void load().then(() => shouldPlay() && start());
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
export const menuMusicStatus = () => {
  const now = voice ? getEngine().ctx.currentTime : 0;
  const at = voice ? voice.from + (now - voice.startedAt) : offset;
  return { loaded: !!loop, intro: !!intro, playing: !!voice, inIntro: !!voice && at < 0, position: at, wanted, holds, volume, duration: loop?.duration ?? 0 };
};
