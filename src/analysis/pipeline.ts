import { extendGrid, findDownbeats, refineBeats, estimateTempo, smoothBeats, trackBeats } from './dsp/beats';
import { beatChroma, chromagram, estimateKey, harmonicEvents } from './dsp/chroma';
import { findSections, resampleCurve, rmsCurve } from './dsp/energy';
import { hpss } from './dsp/hpss';
import { highpass, lowpass, refineOnset } from './dsp/refine';
import { bandFlux, normalize, onsetEnvelope, pickPeaks } from './dsp/onsets';
import { stft, type Spectrogram } from './dsp/stft';
import { BASS_SPLIT, splitLines } from './pitch/lines';
import { salienceLine } from './pitch/salience';
import {
  ANALYSIS_SAMPLE_RATE,
  ANALYSIS_VERSION,
  type AnalysisProgress,
  type AnalysisResult,
  type AnalysisStep,
  type DrumHit,
  type DrumKind,
  type PitchedNote,
} from './types';

export type Transcriber = (audio: Float32Array, onProgress: (p: number) => void) => Promise<PitchedNote[]>;

export interface PipelineOptions {
  /** Optional neural transcriber; falls back to harmonic-salience tracking when missing or failing. */
  transcriber?: Transcriber;
  onProgress?: (p: AnalysisProgress) => void;
  onLog?: (msg: string) => void;
}

const NFFT = 2048;
const HOP = 512;

const STEPS: Record<AnalysisStep, [number, number]> = {
  decoding: [0, 0.03],
  spectrum: [0.03, 0.15],
  separating: [0.15, 0.32],
  rhythm: [0.32, 0.4],
  harmony: [0.4, 0.45],
  melody: [0.45, 0.96],
  finishing: [0.96, 1],
};

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Full analysis of a mono signal at ANALYSIS_SAMPLE_RATE. Pure apart from the optional transcriber. */
export async function analyzeSignal(signal: Float32Array, opts: PipelineOptions = {}): Promise<AnalysisResult> {
  const sr = ANALYSIS_SAMPLE_RATE;
  const duration = signal.length / sr;
  const report = (step: AnalysisStep, p = 0) => {
    const [a, b] = STEPS[step];
    opts.onProgress?.({ step, progress: a + (b - a) * Math.min(1, Math.max(0, p)) });
  };
  const yieldNow = () => new Promise((r) => setTimeout(r, 0));

  // 1. Spectrum
  report('spectrum');
  const spec = stft(signal, sr, NFFT, HOP, (p) => report('spectrum', p));
  const fps = sr / HOP;
  await yieldNow();

  // 2. Harmonic / percussive separation
  report('separating');
  const { harmonic, percussive } = hpss(spec, 17, 17, (p) => report('separating', p));
  await yieldNow();

  // 3. Rhythm: onset envelope, tempo, beats, drum hits
  report('rhythm');
  const rms = rmsCurve(signal, HOP);
  // Band-balanced onset envelope so kicks count as much as broadband noise.
  const env = onsetEnvelope(spec);
  const tempo = estimateTempo(env, fps);
  report('rhythm', 0.3);
  const beatFrames = trackBeats(env, fps, tempo);
  let beats = refineBeats(beatFrames, env, fps);
  // Drop beats the tracker invented in silence.
  beats = beats.filter((t) => (rms[Math.min(rms.length - 1, Math.round(t * fps))] ?? 0) > 0.06);
  report('rhythm', 0.6);
  const drums = detectDrums(percussive, spec, fps, signal);
  // Align the grid with the actual attacks, then extend it at constant tempo to cover the song.
  beats = extendGrid(calibrateBeats(beats, drums), duration);
  report('rhythm', 1);
  await yieldNow();

  // 4. Harmony: chroma, chord changes, key
  report('harmony');
  const chroma = chromagram(harmonic, spec);
  const bc = beatChroma(chroma, spec.frames, fps, beats);
  const harmony = harmonicEvents(beats, bc);
  const key = estimateKey(bc);
  const lowEnv = normalize(bandFlux(percussive, spec, 30, 150));
  const changeAt = new Map(harmony.map((h) => [h.t, h.strength]));
  const accent = beats.map((t) => {
    const f = Math.round(t * fps);
    const kick = Math.max(lowEnv[f - 1] ?? 0, lowEnv[f] ?? 0, lowEnv[f + 1] ?? 0);
    return kick + (changeAt.get(t) ?? 0) * 1.2;
  });
  const downbeats = findDownbeats(accent);
  report('harmony', 1);
  await yieldNow();

  // 5. Melody: bass and lead lines
  report('melody');
  let bass: PitchedNote[] = [];
  let lead: PitchedNote[] = [];
  let pitchSource: AnalysisResult['pitchSource'] = 'salience';
  if (opts.transcriber) {
    try {
      const notes = await opts.transcriber(signal, (p) => report('melody', p * 0.9));
      ({ bass, lead } = splitLines(notes));
      pitchSource = 'basic-pitch';
      opts.onLog?.(`transcribed ${notes.length} notes (${bass.length} bass, ${lead.length} lead)`);
    } catch (e) {
      opts.onLog?.(`transcriber unavailable: ${(e as Error).message}`);
    }
  }
  const harmOnsets = (lo: number, hi: number) =>
    new Set(pickPeaks(normalize(bandFlux(harmonic, spec, lo, hi)), { maxWin: 2, avgWin: 10, delta: 0.1, wait: 3 }));
  if (bass.length < duration * 0.1) {
    bass = salienceLine(harmonic, spec, 28, BASS_SPLIT - 1, harmOnsets(30, 260), 0.45);
  }
  if (lead.length < duration * 0.2) {
    lead = salienceLine(harmonic, spec, BASS_SPLIT, 88, harmOnsets(250, 4000), 0.5);
    if (pitchSource === 'basic-pitch') pitchSource = 'salience';
  }
  report('melody', 1);

  // 6. Sections and energy
  report('finishing');
  const barTimes = downbeats.map((i) => beats[i]);
  const barEnergy: number[] = [];
  const barFeatures: Float32Array[] = [];
  for (let b = 0; b < barTimes.length; b++) {
    const a = barTimes[b];
    const e = barTimes[b + 1] ?? duration;
    const fa = Math.floor(a * fps);
    const fe = Math.max(fa + 1, Math.floor(e * fps));
    let en = 0;
    const v = new Float32Array(13);
    for (let f = fa; f < fe && f < rms.length; f++) {
      en += rms[f];
      for (let p = 0; p < 12; p++) v[p] += chroma[f * 12 + p] ?? 0;
    }
    en /= fe - fa;
    const hits = drums.filter((d) => d.t >= a && d.t < e).length;
    v[12] = (hits / Math.max(0.5, e - a)) * 2;
    barEnergy.push(en);
    barFeatures.push(v);
  }
  const sections = findSections(barTimes, barEnergy, barFeatures, duration);

  const result: AnalysisResult = {
    version: ANALYSIS_VERSION,
    source: 'local',
    duration: round3(duration),
    tempo: Math.round(tempo * 100) / 100,
    beats: beats.map(round3),
    downbeats,
    drums,
    bass: bass.map(roundNote),
    lead: lead.map(roundNote),
    harmony: harmony.map((h) => ({ ...h, t: round3(h.t), strength: round3(h.strength) })),
    sections,
    energy: resampleCurve(rms, fps, 0.1),
    energyHop: 0.1,
    key,
    pitchSource,
  };
  report('finishing', 1);
  return result;
}

const roundNote = (n: PitchedNote): PitchedNote => ({ t: round3(n.t), dur: round3(n.dur), midi: n.midi, strength: round3(n.strength) });

const BANDS: { kind: DrumKind; lo: number; hi: number; wait: number }[] = [
  { kind: 'kick', lo: 30, hi: 150, wait: 0.1 },
  { kind: 'snare', lo: 180, hi: 2500, wait: 0.08 },
  { kind: 'hat', lo: 5000, hi: 10500, wait: 0.06 },
];

/** Kick / snare / hat hits from band-limited flux of the percussive component. */
export function detectDrums(percussive: Float32Array, s: Spectrogram, fps: number, signal?: Float32Array): DrumHit[] {
  const curves = BANDS.map((b) => normalize(bandFlux(percussive, s, b.lo, b.hi)));
  const peaks = curves.map((c, i) =>
    pickPeaks(c, { maxWin: 2, avgWin: Math.round(0.25 * fps), delta: 0.12, wait: Math.max(2, Math.round(BANDS[i].wait * fps)) }),
  );
  const [kickC, snareC, hatC] = curves;
  const near = (list: number[], f: number) => list.some((p) => Math.abs(p - f) <= 1);
  const hits: DrumHit[] = [];
  for (const f of peaks[0]) hits.push({ t: f / fps, kind: 'kick', strength: Math.min(1, kickC[f]) });
  for (const f of peaks[1]) {
    // Kick drums leak into the snare band; drop snare hits that are mostly kick.
    if (near(peaks[0], f) && kickC[f] > snareC[f] * 1.3) continue;
    hits.push({ t: f / fps, kind: 'snare', strength: Math.min(1, snareC[f]) });
  }
  for (const f of peaks[2]) {
    // Snare noise reaches the hat band; keep hats only when the top end dominates.
    if (near(peaks[1], f) && hatC[f] < snareC[f] * 1.1) continue;
    hits.push({ t: f / fps, kind: 'hat', strength: Math.min(1, hatC[f]) });
  }
  let kept = hits.filter((h) => h.strength >= 0.15);
  if (signal) {
    // Move each hit to the attack in a band-filtered copy of the signal.
    const sr = s.sr;
    const filtered: Record<DrumKind, Float32Array> = {
      kick: lowpass(lowpass(signal, sr, 160), sr, 160),
      snare: highpass(lowpass(signal, sr, 4000), sr, 200),
      hat: highpass(highpass(signal, sr, 5000), sr, 5000),
    };
    kept = kept.map((h) => ({ ...h, t: refineOnset(filtered[h.kind], sr, h.t, 0.03, 0.09) }));
  }
  kept.sort((a, b) => a.t - b.t);
  // Refinement can pull two detections onto the same attack.
  const out: DrumHit[] = [];
  const last: Partial<Record<DrumKind, DrumHit>> = {};
  for (const h of kept) {
    const prev = last[h.kind];
    if (prev && h.t - prev.t < BANDS.find((b) => b.kind === h.kind)!.wait * 0.9) {
      prev.strength = Math.max(prev.strength, h.strength);
      continue;
    }
    const copy = { ...h };
    out.push(copy);
    last[h.kind] = copy;
  }
  return out.map((h) => ({ ...h, t: round3(h.t), strength: round3(h.strength) }));
}

/** Shifts the beat grid by the median offset to nearby kick/snare attacks (removes analysis latency). */
export function calibrateBeats(beats: number[], drums: DrumHit[]): number[] {
  const hits = drums.filter((d) => d.kind !== 'hat').map((d) => d.t);
  if (hits.length < 8) return beats;
  const diffs: number[] = [];
  let j = 0;
  for (const b of beats) {
    while (j < hits.length - 1 && hits[j + 1] <= b) j++;
    let best = Infinity;
    for (const k of [j, j + 1]) if (k < hits.length && Math.abs(hits[k] - b) < Math.abs(best)) best = hits[k] - b;
    if (Math.abs(best) < 0.08) diffs.push(best);
  }
  if (diffs.length < Math.max(8, beats.length * 0.2)) return beats;
  diffs.sort((a, b) => a - b);
  const shift = diffs[Math.floor(diffs.length / 2)];
  // After the global shift, pull each beat onto an attack that is very close to it.
  let k = 0;
  const snapped = beats.map((b0) => {
    const b = b0 + shift;
    while (k < hits.length - 1 && hits[k + 1] <= b) k++;
    let best = 0;
    let dist = 0.03;
    for (const i of [k, k + 1]) {
      if (i < hits.length && Math.abs(hits[i] - b) < dist) {
        dist = Math.abs(hits[i] - b);
        best = hits[i] - b;
      }
    }
    return b + best;
  });
  return smoothBeats(snapped).filter((b) => b >= 0);
}
