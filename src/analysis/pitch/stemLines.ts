import { bandFlux, normalize, percentile, pickPeaks } from '../dsp/onsets';
import { highpass, lowpass, refineOnset } from '../dsp/refine';
import { stft } from '../dsp/stft';
import type { PitchedNote } from '../types';
import { BASS_SPLIT } from './lines';

/**
 * Lines from separated stems, timed by what you can hear.
 *
 * The transcriber's note starts are a poor rhythm source: vibrato and slides split one sung note
 * into several, reverb and pads produce notes without an attack, and soft syllables start late.
 * So each line is built from the stem's own audible attacks (spectral-flux onsets, refined to the
 * waveform), and the transcription only decides which pitch each attack is.
 */

const HOP = 512;
/** Attacks closer than this merge into one note. */
const MIN_IOI = 0.07;

export interface StemInput {
  signal: Float32Array;
  sr: number;
  /** Polyphonic transcription of this stem. */
  notes: PitchedNote[];
}

interface Attack {
  t: number;
  strength: number;
}

interface Envelope {
  fps: number;
  rms: Float32Array;
  /** 95th percentile, the "loud" reference. */
  ref: number;
}

function envelope(signal: Float32Array, sr: number): Envelope {
  const n = Math.ceil(signal.length / HOP);
  const rms = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    const a = f * HOP;
    const b = Math.min(signal.length, a + HOP);
    for (let i = a; i < b; i++) s += signal[i] * signal[i];
    rms[f] = Math.sqrt(s / Math.max(1, b - a));
  }
  return { fps: sr / HOP, rms, ref: percentile(rms, 0.95) || 1 };
}

const level = (env: Envelope, from: number, to: number) => {
  const a = Math.max(0, Math.floor(from * env.fps));
  const b = Math.min(env.rms.length, Math.max(a + 1, Math.ceil(to * env.fps)));
  let s = 0;
  for (let f = a; f < b; f++) s += env.rms[f];
  return s / (b - a) / env.ref;
};

/** Audible attacks in a stem: flux peaks in a band, moved to the attack in the filtered waveform. */
export function attacks(signal: Float32Array, sr: number, loHz: number, hiHz: number, delta = 0.08): Attack[] {
  const spec = stft(signal, sr, 2048, HOP);
  const flux = normalize(bandFlux(spec.mag, spec, loHz, hiHz));
  const fps = sr / HOP;
  const peaks = pickPeaks(flux, { maxWin: 2, avgWin: Math.round(0.2 * fps), delta, wait: Math.round(MIN_IOI * fps) });
  const filtered = highpass(lowpass(signal, sr, hiHz), sr, loHz);
  const out: Attack[] = [];
  for (const f of peaks) {
    const t = refineOnset(filtered, sr, f / fps, 0.03, 0.09);
    const prev = out[out.length - 1];
    if (prev && t - prev.t < MIN_IOI) {
      prev.strength = Math.max(prev.strength, flux[f]);
      continue;
    }
    out.push({ t, strength: Math.min(1, flux[f]) });
  }
  return out;
}

/**
 * A real attack is loud enough and followed by at least as much sound as just before it. The end
 * of a note can splatter across the spectrum and look like an attack, but it is followed by less.
 */
function isOnset(env: Envelope, t: number, minLevel: number): boolean {
  const after = level(env, t + 0.01, t + 0.1);
  return after >= minLevel && after >= level(env, t - 0.1, t - 0.01) * 0.9;
}

/**
 * End of a held pitch: transcribers split long notes (vibrato, breathy tone) into back-to-back
 * pieces of the same pitch, so follow the chain of same-pitch pieces.
 */
function heldUntil(notes: PitchedNote[], start: PitchedNote): number {
  let end = start.t + start.dur;
  for (const n of [...notes].sort((a, b) => a.t - b.t)) {
    if (n.midi !== start.midi || n.t <= start.t) continue;
    if (n.t - end > 0.12) break;
    end = Math.max(end, n.t + n.dur);
  }
  return end;
}

/** Notes sounding at time t (started up to `lead` seconds later count as sounding). */
const soundingAt = (notes: PitchedNote[], t: number, lead = 0) => notes.filter((n) => n.t <= t + lead && n.t + n.dur > t);

/** Dominant (strongest, then highest) pitch sounding during [a, b]. */
function dominantPitch(notes: PitchedNote[], a: number, b: number): PitchedNote | undefined {
  let best: PitchedNote | undefined;
  let bestScore = 0;
  for (const n of notes) {
    const overlap = Math.min(b, n.t + n.dur) - Math.max(a, n.t);
    if (overlap <= 0) continue;
    const score = overlap * n.strength;
    if (score > bestScore || (score === bestScore && best && n.midi > best.midi)) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

/** When the sound has faded below `frac` of its level just after `t`. */
function fadeEnd(env: Envelope, t: number, limit: number, frac: number): number {
  const peak = level(env, t, t + 0.08);
  const start = Math.floor((t + 0.08) * env.fps);
  const stop = Math.min(env.rms.length, Math.ceil(limit * env.fps));
  for (let f = start; f < stop; f++) if (env.rms[f] / env.ref < peak * frac) return f / env.fps;
  return limit;
}

/**
 * Sung line: one note per audible syllable, plus legato pitch changes inside a held vowel.
 * Breaths and unpitched consonants (no pitch right after the attack) produce nothing.
 */
export function vocalLineFromStem({ signal, sr, notes }: StemInput): PitchedNote[] {
  const env = envelope(signal, sr);
  const voiced = notes.filter((n) => n.strength >= 0.15 && n.midi >= 40 && n.midi <= 88);
  const events: { t: number; strength: number }[] = attacks(signal, sr, 120, 6000).filter((a) => isOnset(env, a.t, 0.12));

  // Legato: the pitch moves to a new note inside a held syllable, with no new attack.
  const sorted = [...voiced].sort((x, y) => x.t - y.t);
  for (const n of sorted) {
    if (n.dur < 0.1) continue;
    if (events.some((e) => Math.abs(e.t - n.t) < 0.12)) continue;
    const before = dominantPitch(voiced, n.t - 0.12, n.t - 0.02);
    if (before && Math.abs(before.midi - n.midi) >= 1 && level(env, n.t, n.t + 0.1) >= 0.12) events.push({ t: n.t, strength: 0.5 });
  }
  events.sort((x, y) => x.t - y.t);

  const out: PitchedNote[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const next = events[i + 1]?.t ?? e.t + 2;
    const pitch = dominantPitch(voiced, e.t + 0.03, Math.min(next, e.t + 0.2));
    if (!pitch) continue;
    const end = Math.min(next - 0.02, heldUntil(voiced, pitch) + 0.1, fadeEnd(env, e.t, next, 0.3));
    if (end - e.t < 0.06) continue;
    out.push({ t: e.t, dur: end - e.t, midi: pitch.midi, strength: Math.min(1, 0.4 + e.strength * 0.6), bend: pitch.bend });
  }
  return out;
}

/**
 * Instrument line: one note per audible attack. Several pitches struck together become a chord
 * (melody on top); a lone note keeps its pitch. Attacks without a newly struck pitch (pad swells,
 * noise) produce nothing.
 */
export function leadLineFromStem({ signal, sr, notes }: StemInput): PitchedNote[] {
  const env = envelope(signal, sr);
  const pitched = notes.filter((n) => n.strength >= 0.2 && n.midi >= 45);
  const out: PitchedNote[] = [];
  const hits = attacks(signal, sr, 150, 8000).filter((a) => isOnset(env, a.t, 0.1));
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const next = hits[i + 1]?.t ?? h.t + 2;
    const struck = pitched.filter((n) => n.t >= h.t - 0.05 && n.t <= h.t + 0.08);
    if (!struck.length) continue;
    const loud = Math.max(...struck.map((n) => n.strength));
    const voice = struck.filter((n) => n.strength >= loud * 0.5);
    const pitches = [...new Set(voice.map((n) => n.midi))].sort((a, b) => a - b);
    const top = pitches[pitches.length - 1];
    const longest = Math.max(...voice.map((n) => n.t + n.dur));
    const end = Math.min(next - 0.02, longest + 0.05, fadeEnd(env, h.t, next, 0.35));
    if (end - h.t < 0.05) continue;
    const chord = pitches.length >= 3 && new Set(pitches.map((m) => m % 12)).size >= 2 ? pitches.slice(-6) : undefined;
    out.push({ t: h.t, dur: end - h.t, midi: top, strength: Math.min(1, 0.4 + h.strength * 0.6), ...(chord ? { chord } : {}) });
  }
  return out;
}

/** Bass line: one note per audible attack in the bass stem, lowest struck pitch, octave-folded. */
export function bassLineFromStem({ signal, sr, notes }: StemInput): PitchedNote[] {
  const env = envelope(signal, sr);
  const low = notes.filter((n) => n.strength >= 0.12);
  const hits = attacks(signal, sr, 30, 400, 0.1).filter((a) => isOnset(env, a.t, 0.12));
  const raw: PitchedNote[] = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const next = hits[i + 1]?.t ?? h.t + 2;
    const struck = low.filter((n) => n.t >= h.t - 0.06 && n.t <= h.t + 0.1);
    const pool = struck.length ? struck : soundingAt(low, h.t + 0.05);
    if (!pool.length) continue;
    const lowest = pool.reduce((m, n) => (n.midi < m.midi ? n : m));
    const end = Math.min(next - 0.02, fadeEnd(env, h.t, next, 0.3));
    if (end - h.t < 0.05) continue;
    raw.push({ t: h.t, dur: end - h.t, midi: lowest.midi, strength: Math.min(1, 0.4 + h.strength * 0.6) });
  }
  return foldOctaves(raw);
}

/**
 * Moves each bass note to the octave nearest the recent bass register (pitch class unchanged).
 * Every attack is kept: repeated notes are real here, not re-detections.
 */
export function foldOctaves(notes: PitchedNote[]): PitchedNote[] {
  const recent: number[] = [];
  const sorted = [...notes.map((n) => n.midi)].sort((a, b) => a - b);
  let ref = sorted[sorted.length >> 1] ?? 36;
  return notes.map((n) => {
    let midi = n.midi;
    for (let m = n.midi % 12; m < BASS_SPLIT + 12; m += 12) if (Math.abs(m - ref) < Math.abs(midi - ref)) midi = m;
    recent.push(midi);
    if (recent.length > 8) recent.shift();
    ref = [...recent].sort((a, b) => a - b)[recent.length >> 1];
    return { ...n, midi };
  });
}
