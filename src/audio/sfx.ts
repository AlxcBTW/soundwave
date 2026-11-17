/**
 * Interface sound effects, synthesized on the fly (no audio files): short tones, noise and
 * sweeps shaped by envelopes. They share the game's AudioContext but have their own volume and
 * go straight to the output, so they neither follow the music volume nor drive the visualizer.
 */
import { getEngine } from './engine';

export type Sfx = 'move' | 'select' | 'back' | 'tab' | 'toggle-on' | 'toggle-off' | 'launch' | 'star' | 'count' | 'best' | 'pause' | 'resume' | 'error' | 'add';

let out: GainNode | null = null;
let volume = 0.7;
let noise: AudioBuffer | null = null;
const lastPlayed = new Map<Sfx, number>();

/** Effects volume, 0..1. */
export function setSfxVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  if (out) out.gain.value = volume * 0.5;
}

function graph(): { ctx: AudioContext; out: GainNode } | null {
  if (volume <= 0) return null;
  const ctx = getEngine().ctx;
  if (ctx.state !== 'running') {
    // Browsers start audio only after a gesture; try, and skip this sound if it isn't allowed yet.
    void ctx.resume().catch(() => {});
    if ((ctx.state as AudioContextState) !== 'running') return null;
  }
  if (!out) {
    out = ctx.createGain();
    out.gain.value = volume * 0.5;
    out.connect(ctx.destination);
  }
  return { ctx, out };
}

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let seed = 7;
    for (let i = 0; i < d.length; i++) d[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  }
  return noise;
}

interface Tone {
  type?: OscillatorType;
  freq: number;
  /** Glide target (Hz) over the note. */
  to?: number;
  at?: number;
  dur: number;
  gain: number;
  attack?: number;
}

function tone(ctx: AudioContext, dest: AudioNode, t0: number, { type = 'triangle', freq, to, at = 0, dur, gain, attack = 0.004 }: Tone) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  const s = t0 + at;
  o.frequency.setValueAtTime(freq, s);
  if (to) o.frequency.exponentialRampToValueAtTime(to, s + dur);
  g.gain.setValueAtTime(0, s);
  g.gain.linearRampToValueAtTime(gain, s + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
  o.connect(g).connect(dest);
  o.start(s);
  o.stop(s + dur + 0.02);
}

interface Hiss {
  at?: number;
  dur: number;
  gain: number;
  from: number;
  to: number;
  q?: number;
}

function hiss(ctx: AudioContext, dest: AudioNode, t0: number, { at = 0, dur, gain, from, to, q = 1.2 }: Hiss) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  const s = t0 + at;
  f.frequency.setValueAtTime(from, s);
  f.frequency.exponentialRampToValueAtTime(to, s + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, s);
  g.gain.linearRampToValueAtTime(gain, s + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(s);
  src.stop(s + dur + 0.02);
}

/** A bell: a few inharmonic partials decaying at different rates. */
function bell(ctx: AudioContext, dest: AudioNode, t0: number, freq: number, gain: number, at = 0) {
  [1, 2.76, 5.4].forEach((k, i) => tone(ctx, dest, t0, { type: 'sine', freq: freq * k, at, dur: 0.9 / (i + 1), gain: gain / (i + 1.4), attack: 0.002 }));
}

/** Minimum spacing (s) per effect, so rapid repeats (holding a direction) don't pile up. */
const SPACING: Partial<Record<Sfx, number>> = { move: 0.045, count: 0.035, tab: 0.06 };

export function playSfx(name: Sfx, opts: { index?: number } = {}) {
  const g = graph();
  if (!g) return;
  const { ctx, out } = g;
  const t = ctx.currentTime + 0.005;
  const gap = SPACING[name];
  if (gap && t - (lastPlayed.get(name) ?? -1) < gap) return;
  lastPlayed.set(name, t);
  switch (name) {
    case 'move':
      tone(ctx, out, t, { type: 'sine', freq: 2100, dur: 0.035, gain: 0.12 });
      hiss(ctx, out, t, { dur: 0.03, gain: 0.05, from: 6000, to: 4000, q: 2 });
      break;
    case 'select':
      tone(ctx, out, t, { freq: 880, dur: 0.07, gain: 0.22 });
      tone(ctx, out, t, { freq: 1318.5, at: 0.055, dur: 0.12, gain: 0.22 });
      break;
    case 'back':
      tone(ctx, out, t, { freq: 1046.5, dur: 0.06, gain: 0.18 });
      tone(ctx, out, t, { freq: 659.3, at: 0.05, dur: 0.11, gain: 0.18 });
      break;
    case 'tab':
      hiss(ctx, out, t, { dur: 0.13, gain: 0.16, from: 900, to: 4200 });
      tone(ctx, out, t, { type: 'sine', freq: 1568, at: 0.04, dur: 0.06, gain: 0.08 });
      break;
    case 'toggle-on':
      tone(ctx, out, t, { type: 'square', freq: 740, to: 1110, dur: 0.06, gain: 0.07 });
      break;
    case 'toggle-off':
      tone(ctx, out, t, { type: 'square', freq: 740, to: 494, dur: 0.06, gain: 0.07 });
      break;
    case 'launch':
      // A riser into a hit: the stage lights coming up.
      tone(ctx, out, t, { type: 'sawtooth', freq: 110, to: 880, dur: 0.55, gain: 0.07, attack: 0.25 });
      hiss(ctx, out, t, { dur: 0.6, gain: 0.22, from: 400, to: 9000, q: 0.8 });
      tone(ctx, out, t, { type: 'sine', freq: 110, to: 45, at: 0.55, dur: 0.35, gain: 0.5 });
      bell(ctx, out, t, 1318.5, 0.16, 0.55);
      break;
    case 'star':
      bell(ctx, out, t, 880 * Math.pow(2, (opts.index ?? 0) * (4 / 12)), 0.22);
      break;
    case 'count':
      tone(ctx, out, t, { type: 'square', freq: 3200, dur: 0.012, gain: 0.03, attack: 0.001 });
      break;
    case 'best':
      [523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(ctx, out, t, { freq: f, at: i * 0.075, dur: 0.35, gain: 0.16 }));
      bell(ctx, out, t, 2093, 0.1, 0.3);
      break;
    case 'pause':
      tone(ctx, out, t, { type: 'sine', freq: 330, to: 110, dur: 0.22, gain: 0.3 });
      hiss(ctx, out, t, { dur: 0.18, gain: 0.08, from: 3000, to: 400 });
      break;
    case 'resume':
      tone(ctx, out, t, { type: 'sine', freq: 140, to: 420, dur: 0.18, gain: 0.26 });
      break;
    case 'error':
      tone(ctx, out, t, { type: 'square', freq: 130, dur: 0.12, gain: 0.08 });
      tone(ctx, out, t, { type: 'square', freq: 123, at: 0.13, dur: 0.16, gain: 0.08 });
      break;
    case 'add':
      tone(ctx, out, t, { type: 'sine', freq: 660, to: 1320, dur: 0.1, gain: 0.18 });
      bell(ctx, out, t, 1760, 0.08, 0.06);
      break;
  }
}
