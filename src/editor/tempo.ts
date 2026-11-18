/**
 * Finds a song's beats by listening, for a song that is charted by hand: the same beat tracking the
 * full analysis starts with, without the minutes of stem separation and transcription around it.
 */
import { estimateTempo, findDownbeats, refineBeats, trackBeats } from '../analysis/dsp/beats';
import { rmsCurve } from '../analysis/dsp/energy';
import { bandFlux, normalize, onsetEnvelope } from '../analysis/dsp/onsets';
import { stft } from '../analysis/dsp/stft';
import { fitFixed, MAX_BPM, MIN_BPM, type GridSpec } from './grid';

export interface HeardBeats {
  beats: number[];
  /** Indices into `beats` that start a bar. */
  downbeats: number[];
}

const NFFT = 2048;
const HOP = 512;

/** Beat times and bar starts of a mono signal. Empty when no beat can be made out. */
export function hearBeats(signal: Float32Array, sampleRate: number): HeardBeats {
  if (signal.length < sampleRate * 2) return { beats: [], downbeats: [] };
  const spec = stft(signal, sampleRate, NFFT, HOP);
  const fps = sampleRate / HOP;
  const env = onsetEnvelope(spec);
  const tempo = estimateTempo(env, fps);
  if (!Number.isFinite(tempo) || tempo <= 0) return { beats: [], downbeats: [] };
  const rms = rmsCurve(signal, HOP);
  // Beats the tracker carried on through silence are not beats of the song.
  const beats = refineBeats(trackBeats(env, fps, tempo), env, fps).filter((t) => (rms[Math.min(rms.length - 1, Math.round(t * fps))] ?? 0) > 0.06);
  if (beats.length < 4) return { beats: [], downbeats: [] };
  // A bar starts where the low end hits hardest.
  const low = normalize(bandFlux(spec.mag, spec, 30, 150));
  const accent = beats.map((t) => {
    const f = Math.round(t * fps);
    return Math.max(low[f - 1] ?? 0, low[f] ?? 0, low[f + 1] ?? 0);
  });
  return { beats, downbeats: findDownbeats(accent) };
}

/** How sharply the signal gets louder, every 5 ms: high where a sound starts. */
function attacks(signal: Float32Array, sampleRate: number): { rise: Float32Array; hop: number } {
  const size = Math.max(1, Math.round(sampleRate / 200));
  const n = Math.floor(signal.length / size);
  const level = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * size, end = j + size; j < end; j++) s += signal[j] * signal[j];
    level[i] = Math.log1p(200 * Math.sqrt(s / size));
  }
  const rise = new Float32Array(n);
  for (let i = 1; i < n; i++) rise[i] = Math.max(0, level[i] - level[i - 1]);
  return { rise, hop: size / sampleRate };
}

/**
 * The steady tempo of a song and where its beat falls, to a few milliseconds: the tempo and beat
 * that put the most attacks on the beat. The heard beats say roughly where to look (they are placed
 * by a spectrum that smears time by tens of milliseconds); the waveform itself settles it.
 */
export function steadyGrid(signal: Float32Array, sampleRate: number, heard: HeardBeats): Extract<GridSpec, { kind: 'fixed' }> {
  const rough = fitFixed(heard.beats, heard.downbeats);
  const { rise, hop } = attacks(signal, sampleRate);
  if (rise.length < 400) return rough;
  const first = heard.beats[0];
  const last = heard.beats[heard.beats.length - 1];
  const at = (t: number) => {
    const x = t / hop;
    const i = Math.floor(x);
    if (i < 1 || i + 1 >= rise.length) return 0;
    // An attack counts in full on its frame and in part on the frames beside it.
    return Math.max(rise[i], rise[i + 1], 0.6 * rise[i - 1]);
  };
  const score = (spb: number, phase: number) => {
    let s = 0;
    let n = 0;
    for (let t = phase + Math.ceil((first - phase) / spb) * spb; t <= last + 0.05; t += spb) {
      s += at(t);
      n++;
    }
    return n ? s / n : 0;
  };
  const scan = (bpm: number) => {
    const spb = 60 / bpm;
    let best = { score: -1, phase: 0 };
    // Every phase of the beat, 2 ms apart.
    for (let phase = 0; phase < spb; phase += 0.002) {
      const sc = score(spb, phase);
      if (sc > best.score) best = { score: sc, phase };
    }
    return best;
  };
  // A tempo that is off by a hundredth drifts a beat's worth of milliseconds over a song: look
  // closely around the rough one, and prefer a whole tempo when it does as well as any.
  let best = { bpm: rough.bpm, ...scan(rough.bpm) };
  const lo = Math.max(MIN_BPM, rough.bpm * 0.985);
  const hi = Math.min(MAX_BPM, rough.bpm * 1.015);
  for (let bpm = Math.ceil(lo * 20) / 20; bpm <= hi; bpm += 0.05) {
    const s = scan(bpm);
    if (s.score > best.score) best = { bpm: Math.round(bpm * 100) / 100, ...s };
  }
  for (let fine = best.bpm - 0.04; fine <= best.bpm + 0.041; fine += 0.01) {
    const s = scan(fine);
    if (s.score > best.score) best = { bpm: Math.round(fine * 100) / 100, ...s };
  }
  const whole = Math.round(best.bpm);
  if (whole !== best.bpm && whole >= lo && whole <= hi) {
    const s = scan(whole);
    if (s.score >= best.score * 0.97) best = { bpm: whole, ...s };
  }
  const spb = 60 / best.bpm;
  // The bar starts on the beat nearest to where the rough grid had it.
  const bar = spb * rough.beatsPerBar;
  const k = Math.round((rough.offset - best.phase) / spb);
  let offset = best.phase + k * spb;
  offset -= Math.floor(offset / bar) * bar;
  return { kind: 'fixed', bpm: best.bpm, offset: Math.round(offset * 1000) / 1000, beatsPerBar: rough.beatsPerBar };
}
