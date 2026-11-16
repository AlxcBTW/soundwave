import { describe, expect, it } from 'vitest';
import { estimateTempo, trackBeats } from '../src/analysis/dsp/beats';
import { onsetEnvelope } from '../src/analysis/dsp/onsets';
import { stft } from '../src/analysis/dsp/stft';
import { hpss } from '../src/analysis/dsp/hpss';
import { analyzeSignal } from '../src/analysis/pipeline';
import { ANALYSIS_SAMPLE_RATE as SR } from '../src/analysis/types';

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Kick on every beat, snare on 2 & 4, hats on 8ths, a bass note per beat and a lead melody per beat. */
function song(bpm: number, seconds: number, opts: { drums?: boolean; bass?: number[]; lead?: number[] } = {}) {
  const x = new Float32Array(Math.floor(seconds * SR));
  const spb = 60 / bpm;
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const add = (t0: number, dur: number, fn: (t: number) => number) => {
    const a = Math.floor(t0 * SR);
    for (let i = 0; i < dur * SR && a + i < x.length; i++) x[a + i] += fn(i / SR);
  };
  const beats = Math.floor(seconds / spb);
  for (let b = 0; b < beats; b++) {
    const t = 0.5 + b * spb;
    if (opts.drums !== false) {
      add(t, 0.2, (s) => Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-s * 30)) * s) * Math.exp(-s * 15) * 0.8);
      if (b % 2 === 1) add(t, 0.15, (s) => noise() * Math.exp(-s * 25) * 0.4);
      add(t + spb / 2, 0.04, (s) => noise() * Math.exp(-s * 90) * 0.15);
    }
    if (opts.bass) {
      const f = midiHz(opts.bass[b % opts.bass.length]);
      add(t, spb * 0.9, (s) => Math.sin(2 * Math.PI * f * s) * 0.3 * Math.min(1, s * 100));
    }
    if (opts.lead) {
      const f = midiHz(opts.lead[b % opts.lead.length]);
      add(t, spb * 0.9, (s) => (Math.sin(2 * Math.PI * f * s) + 0.4 * Math.sin(4 * Math.PI * f * s) + 0.2 * Math.sin(6 * Math.PI * f * s)) * 0.15 * Math.min(1, s * 100));
    }
  }
  return x;
}

describe('dsp', () => {
  it.each([90, 128, 174])('estimates %i BPM', (bpm) => {
    const x = song(bpm, 20);
    const s = stft(x, SR);
    const env = onsetEnvelope(s);
    const tempo = estimateTempo(env, SR / 512);
    // Allow octave-equivalent answers only within the prior's preferred range.
    const ratio = tempo / bpm;
    expect([0.5, 1, 2].some((r) => Math.abs(ratio - r) < 0.03)).toBe(true);
    if (bpm === 128) expect(Math.abs(tempo - 128)).toBeLessThan(2);
  });

  it('tracks beats on the clicks', () => {
    const bpm = 120;
    const x = song(bpm, 16);
    const s = stft(x, SR);
    const fps = SR / 512;
    const env = onsetEnvelope(s);
    const frames = trackBeats(env, fps, estimateTempo(env, fps));
    const times = frames.map((f) => f / fps).filter((t) => t > 2 && t < 14);
    for (const t of times) {
      const off = (((t - 0.5) % 0.5) + 0.5) % 0.5;
      expect(Math.min(off, 0.5 - off)).toBeLessThan(0.035);
    }
  });

  it('separates a sustained tone from clicks', () => {
    const x = song(120, 6, { drums: true, lead: [69] });
    const s = stft(x, SR);
    const { harmonic, percussive } = hpss(s);
    const k440 = Math.round(440 / (SR / 2048));
    let h = 0;
    let p = 0;
    for (let f = 0; f < s.frames; f++) {
      h += harmonic[f * s.bins + k440];
      p += percussive[f * s.bins + k440];
    }
    expect(h).toBeGreaterThan(p * 3);
  });
});

describe('drum detection', () => {
  it('does not mistake off-beat bass notes for kicks', async () => {
    // Four-on-the-floor kick plus a sustained bass note on every off-beat.
    const x = new Float32Array(16 * SR);
    const add = (t0: number, dur: number, fn: (t: number) => number) => {
      const a = Math.floor(t0 * SR);
      for (let i = 0; i < dur * SR && a + i < x.length; i++) x[a + i] += fn(i / SR);
    };
    for (let b = 0; b < 30; b++) {
      const t = 0.5 + b * 0.5;
      add(t, 0.2, (s) => Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-s * 30)) * s) * Math.exp(-s * 15) * 0.8);
      const f = midiHz([33, 36, 31, 33][b % 4]);
      add(t + 0.25, 0.24, (s) => Math.sin(2 * Math.PI * f * s) * 0.35 * Math.min(1, s * 300) * Math.min(1, (0.24 - s) * 100));
    }
    const a = await analyzeSignal(x);
    const kicks = a.drums.filter((d) => d.kind === 'kick' && d.t > 1 && d.t < 15);
    const offBeat = kicks.filter((k) => {
      const o = (((k.t - 0.5) % 0.5) + 0.5) % 0.5;
      return Math.min(o, 0.5 - o) > 0.08;
    });
    expect(kicks.length).toBeGreaterThan(20);
    expect(offBeat.length).toBeLessThanOrEqual(2);
  }, 60_000);
});

describe('pipeline', () => {
  it('finds drums, beats, bass and lead in a synthetic song', async () => {
    const bass = [40, 40, 43, 45];
    const lead = [72, 74, 76, 79];
    const x = song(120, 24, { bass, lead });
    const a = await analyzeSignal(x);
    expect(Math.abs(a.tempo - 120)).toBeLessThan(3);
    expect(a.beats.length).toBeGreaterThan(40);
    const kicks = a.drums.filter((d) => d.kind === 'kick');
    expect(kicks.length).toBeGreaterThan(30);
    for (const k of kicks.filter((k) => k.t > 1 && k.t < 22)) {
      const off = (((k.t - 0.5) % 0.5) + 0.5) % 0.5;
      expect(Math.min(off, 0.5 - off)).toBeLessThan(0.05);
    }
    // Pitch classes of the detected lines should match the written ones.
    const pcs = (notes: { midi: number }[]) => new Set(notes.map((n) => n.midi % 12));
    const leadPcs = pcs(a.lead);
    expect(lead.filter((m) => leadPcs.has(m % 12)).length).toBeGreaterThanOrEqual(3);
    const bassPcs = pcs(a.bass);
    expect(bass.filter((m) => bassPcs.has(m % 12)).length).toBeGreaterThanOrEqual(2);
    expect(a.sections.length).toBeGreaterThan(0);
    expect(a.downbeats.length).toBeGreaterThan(8);
  }, 60_000);
});
