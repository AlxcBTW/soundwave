import { thumbOf } from '../chart/generator';
import { lanesFor, type Chart, type Difficulty, type Note } from '../chart/types';

const BPM = 120;
const BARS = 20;
const SPB = 60 / BPM;
const LEAD_IN = 2 * SPB;

/** A synthesized practice track (kick, hats, bass line) so the game is playable without uploads. */
export function renderDemoAudio(sampleRate = 44100): { channels: Float32Array[]; sampleRate: number } {
  const beats = BARS * 4;
  const length = Math.ceil((LEAD_IN + beats * SPB + 2) * sampleRate);
  const l = new Float32Array(length);
  const add = (start: number, dur: number, fn: (t: number) => number) => {
    const s0 = Math.floor(start * sampleRate);
    const n = Math.floor(dur * sampleRate);
    for (let i = 0; i < n && s0 + i < length; i++) l[s0 + i] += fn(i / sampleRate);
  };
  const bassLine = [40, 40, 43, 45, 40, 40, 47, 45];
  for (let b = 0; b < beats; b++) {
    const t = LEAD_IN + b * SPB;
    // Kick
    add(t, 0.25, (x) => Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-x * 30)) * x) * Math.exp(-x * 12) * 0.9);
    // Hat on the off-beat
    add(t + SPB / 2, 0.05, (x) => (Math.random() * 2 - 1) * Math.exp(-x * 80) * 0.25);
    // Snare on 2 and 4
    if (b % 2 === 1) add(t, 0.18, (x) => ((Math.random() * 2 - 1) * 0.5 + Math.sin(2 * Math.PI * 190 * x) * 0.3) * Math.exp(-x * 22) * 0.6);
    // Bass note
    const midi = bassLine[b % bassLine.length];
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const dur = b % 8 === 7 ? SPB * 0.95 : SPB * 0.45;
    add(t, dur, (x) => (Math.sin(2 * Math.PI * f * x) + 0.3 * Math.sin(4 * Math.PI * f * x)) * Math.min(1, x * 200) * Math.exp(-x * 2) * 0.35);
  }
  for (let i = 0; i < length; i++) l[i] = Math.tanh(l[i]);
  return { channels: [l, l], sampleRate };
}

export function demoChart(difficulty: Difficulty): Chart {
  const lanes = lanesFor(difficulty);
  const beats: number[] = [];
  const downbeats: number[] = [];
  const total = BARS * 4;
  for (let b = 0; b < total; b++) {
    beats.push(LEAD_IN + b * SPB);
    if (b % 4 === 0) downbeats.push(b);
  }
  const pattern4 = [0, 1, 2, 1, 0, 2, 3, 2];
  const pattern5 = [0, 1, 2, 3, 4, 3, 2, 1];
  const pattern = lanes === 5 ? pattern5 : pattern4;
  const notes: Note[] = [];
  const step = difficulty === 'easy' ? 1 : difficulty === 'expert' ? 0.25 : 0.5;
  let k = 0;
  for (let b = 0; b < total; b += step) {
    const bar = Math.floor(b / 4);
    const t = LEAD_IN + b * SPB;
    const phrase = bar % 4 === 2 ? bar : -1;
    // Every four bars, a hold from the third bar's downbeat let go 1.5 beats later (on easy, a plain hold).
    const inPhrase = b % 16;
    if (inPhrase > 8 && inPhrase < 10) continue;
    if (inPhrase === 8) {
      notes.push({ t, lane: pattern[k++ % pattern.length], dur: SPB * 1.5, phrase: -1, ...(difficulty !== 'easy' ? { release: true } : {}) });
      continue;
    }
    const lane = pattern[k++ % pattern.length];
    const sustain = Number.isInteger(b) && b % 8 === 7 ? SPB * Math.min(0.9, step * 1.8) : 0;
    notes.push({ t, lane, dur: sustain, phrase });
    if (difficulty !== 'easy' && b % 4 === 0 && bar % 2 === 1) {
      // The second note goes under the other thumb (see thumbOf in the generator).
      notes.push({ t, lane: thumbOf(lane) === 0 ? Math.min(lanes - 1, lane + 2) : 1, dur: 0, phrase });
    }
  }
  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
  return {
    part: 'drums',
    difficulty,
    lanes,
    notes,
    beats,
    downbeats,
    secondsPerBeat: SPB,
    duration: LEAD_IN + total * SPB + 2,
  };
}
