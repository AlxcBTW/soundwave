import type { PitchedNote } from '../types';

/** Upper bound (exclusive) of the bass register in MIDI (E3). */
export const BASS_SPLIT = 52;
/** Notes starting within this window belong to the same onset cluster. */
const CLUSTER_SEC = 0.05;
/** Pitch-bend activity (semitones) above which a note behaves like a voice. */
const VOCAL_BEND = 0.06;

/**
 * Reduces polyphonic notes to one line. At each overlap the note with the best score wins;
 * the losing earlier note is truncated where the winner starts.
 */
export function monophonic(notes: PitchedNote[], score: (n: PitchedNote) => number, minDur = 0.06): PitchedNote[] {
  const sorted = [...notes].sort((a, b) => a.t - b.t || score(b) - score(a));
  const out: PitchedNote[] = [];
  for (const n of sorted) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push({ ...n });
      continue;
    }
    if (n.t - prev.t < CLUSTER_SEC) {
      if (score(n) > score(prev)) out[out.length - 1] = { ...n };
      continue;
    }
    if (n.t < prev.t + prev.dur) {
      if (score(n) < score(prev) * 0.5) continue;
      prev.dur = n.t - prev.t;
    }
    out.push({ ...n });
  }
  return out.filter((n) => n.dur >= minDur);
}

/** Gap between consecutive onsets that starts a new cluster. */
const CLUSTER_GAP = 0.03;

/**
 * Groups notes struck together: a new cluster starts after a gap of CLUSTER_GAP between
 * consecutive onsets (so a chord is not split by an unrelated note just before it), capped at
 * twice CLUSTER_SEC so slow strums don't chain into one cluster.
 */
export function clusters(notes: PitchedNote[]): PitchedNote[][] {
  const sorted = [...notes].sort((a, b) => a.t - b.t || a.midi - b.midi);
  const out: PitchedNote[][] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    if (last && n.t - prev!.t < CLUSTER_GAP && n.t - last[0].t < CLUSTER_SEC * 2) last.push(n);
    else out.push([n]);
  }
  return out;
}

function weightedMedian(values: { v: number; w: number }[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a.v - b.v);
  const total = s.reduce((a, b) => a + b.w, 0);
  let acc = 0;
  for (const x of s) {
    acc += x.w;
    if (acc >= total / 2) return x.v;
  }
  return s[s.length - 1].v;
}

/**
 * Bass line: the lowest pitch class of each onset, folded to the octave nearest the recent bass
 * register. Transcribers often hear a bass note in two octaves at once (fundamental and strong
 * second harmonic), which would otherwise throw the chart across the highway.
 */
export function bassLine(notes: PitchedNote[]): PitchedNote[] {
  const low = notes.filter((n) => n.midi < BASS_SPLIT && n.strength >= 0.12);
  if (!low.length) return [];
  let ref = weightedMedian(low.map((n) => ({ v: n.midi, w: n.strength * Math.max(0.05, n.dur) })));
  const recent: number[] = [];
  const out: PitchedNote[] = [];
  for (const c of clusters(low)) {
    const lowest = c[0];
    const pc = ((lowest.midi % 12) + 12) % 12;
    const same = c.filter((n) => n.midi % 12 === pc);
    // Pick the octave of this pitch class closest to where the bass has been playing.
    let midi = lowest.midi;
    for (let m = pc + 12; m < BASS_SPLIT + 12; m += 12) if (Math.abs(m - ref) < Math.abs(midi - ref)) midi = m;
    out.push({
      t: lowest.t,
      dur: Math.max(...same.map((n) => n.dur)),
      midi,
      strength: Math.max(...same.map((n) => n.strength)),
    });
    recent.push(midi);
    if (recent.length > 8) recent.shift();
    ref = [...recent].sort((a, b) => a - b)[recent.length >> 1];
  }
  // Re-detections of the same held note collapse into one.
  const merged: PitchedNote[] = [];
  for (const n of monophonic(out, (x) => x.strength)) {
    const prev = merged[merged.length - 1];
    if (prev && prev.midi === n.midi && n.t - (prev.t + prev.dur) < 0.04 && n.strength < prev.strength * 0.8) {
      prev.dur = n.t + n.dur - prev.t;
      continue;
    }
    merged.push(n);
  }
  return merged;
}

/**
 * Chooses a melodic path through candidate notes by dynamic programming: each note adds its
 * score minus `floor`, and moving between notes costs more the larger the leap. This follows one
 * voice instead of hopping between instruments the way a per-onset "loudest note" pick does.
 */
export function melodicPath(notes: PitchedNote[], score: (n: PitchedNote) => number, floor: number, leapCost: number): PitchedNote[] {
  const c = [...notes].sort((a, b) => a.t - b.t || b.midi - a.midi);
  const n = c.length;
  const best = new Float64Array(n);
  const prev = new Int32Array(n).fill(-1);
  let start = 0;
  for (let i = 0; i < n; i++) {
    const gain = score(c[i]) - floor;
    best[i] = gain;
    while (start < i && c[i].t - c[start].t > 4) start++;
    for (let j = start; j < i; j++) {
      if (c[i].t - c[j].t < CLUSTER_SEC) continue;
      const gap = c[i].t - (c[j].t + c[j].dur);
      const leap = Math.abs(c[i].midi - c[j].midi);
      // Leaps after a rest are cheap; leaps inside a legato phrase are expensive.
      const cost = (leap / 12) * leapCost * (gap > 0.6 ? 0.3 : 1);
      const v = best[j] - cost + gain;
      if (v > best[i]) {
        best[i] = v;
        prev[i] = j;
      }
    }
  }
  // The path may stop and restart: collect the best chains greedily until nothing positive remains.
  const used = new Uint8Array(n);
  const order = Array.from(best.keys()).sort((a, b) => best[b] - best[a]);
  const chosen: PitchedNote[] = [];
  for (const end of order) {
    if (used[end] || best[end] <= 0) continue;
    const chain: number[] = [];
    for (let k = end; k >= 0 && !used[k]; k = prev[k]) chain.push(k);
    for (const k of chain) used[k] = 1;
    for (const k of chain) chosen.push(c[k]);
  }
  return monophonic(chosen, score);
}

const vocalScore = (n: PitchedNote) =>
  n.strength * (0.25 + Math.min(1, (n.bend ?? 0) / 0.15)) * Math.min(1.4, 0.6 + n.dur * 2);

/**
 * Splits transcribed notes into the parts a band would play:
 * - bass: lowest line, octave-stabilized;
 * - vocals: the sung line (pitch-bend rich, legato, continuous);
 * - lead: the main instrument (synth/keys/guitar) with chord voicings kept as chords.
 */
export function separateParts(notes: PitchedNote[], duration: number): { bass: PitchedNote[]; lead: PitchedNote[]; vocals: PitchedNote[] } {
  const bass = bassLine(notes);

  const upper = notes.filter((n) => n.midi >= BASS_SPLIT - 4 && n.strength >= 0.15);
  // Notes inside a steady chord (three or more pitches struck together) belong to an instrument.
  const chordMember = new Set<PitchedNote>();
  for (const c of clusters(upper)) {
    const steadyNotes = c.filter((n) => (n.bend ?? 0) < VOCAL_BEND * 2);
    if (new Set(steadyNotes.map((n) => n.midi)).size >= 3) for (const n of steadyNotes) chordMember.add(n);
  }
  // Vocals: only when the song clearly has a voice (enough bendy notes).
  const bendy = upper.filter((n) => (n.bend ?? 0) >= VOCAL_BEND && n.midi <= 84);
  let vocals: PitchedNote[] = [];
  if (bendy.length >= Math.max(12, duration * 0.08)) {
    const chordOnsets = [...chordMember].map((n) => n.t);
    // A note struck together with a synth/keys chord only counts as sung when it clearly bends.
    const onChord = (n: PitchedNote) => chordOnsets.some((t) => Math.abs(t - n.t) < CLUSTER_SEC);
    const cands = upper.filter(
      (n) => n.midi >= 48 && n.midi <= 84 && !chordMember.has(n) && (!onChord(n) || (n.bend ?? 0) >= VOCAL_BEND * 2),
    );
    vocals = dropStrayVocals(melodicPath(cands, vocalScore, 0.18, 0.5).filter((n) => vocalScore(n) >= 0.12));
  }
  const vocalKey = new Set(vocals.map((n) => `${n.t}:${n.midi}`));

  // Lead: chords (three or more steady notes at one onset) and the strongest steady riff line.
  const steady = upper.filter((n) => !vocalKey.has(`${n.t}:${n.midi}`) && (n.bend ?? 0) < VOCAL_BEND * 2);
  const lead: PitchedNote[] = [];
  const riffCands: PitchedNote[] = [];
  for (const c of clusters(steady)) {
    const pitches = [...new Set(c.map((n) => n.midi))].sort((a, b) => a - b);
    const pcs = new Set(pitches.map((m) => m % 12));
    if (pitches.length >= 3 && pcs.size >= 2) {
      const top = pitches[pitches.length - 1];
      lead.push({
        t: c[0].t,
        dur: c.map((n) => n.dur).sort((a, b) => a - b)[c.length >> 1],
        midi: top,
        strength: Math.max(...c.map((n) => n.strength)),
        chord: pitches,
      });
    } else {
      riffCands.push(...c);
    }
  }
  const riffScore = (n: PitchedNote) => n.strength * Math.min(1.4, 0.6 + n.dur * 2);
  // Notes that start while a chord is still ringing are usually re-detections of that chord.
  const chordSpans = lead.map((l) => [l.t, l.t + l.dur] as const);
  const free = riffCands.filter((n) => !chordSpans.some(([a, b]) => n.t > a + CLUSTER_SEC && n.t < b - 0.02));
  const riff = melodicPath(free, riffScore, 0.4, 0.6);
  for (const r of riff) {
    // Chords win when a riff note lands on the same onset.
    if (!lead.some((l) => Math.abs(l.t - r.t) < CLUSTER_SEC)) lead.push(r);
  }
  lead.sort((a, b) => a.t - b.t);
  return { bass, lead: trimOverlaps(fillGaps(lead, vocals, duration)), vocals };
}

/** Seconds without any lead note after which the lead part doubles the vocal melody. */
const LEAD_GAP_SEC = 12;

/**
 * Where no lead instrument plays for a long stretch but someone sings, the lead part plays the
 * vocal melody, so the part never sits silent for half a minute.
 */
export function fillGaps(lead: PitchedNote[], vocals: PitchedNote[], duration: number): PitchedNote[] {
  if (!vocals.length) return lead;
  const bounds = [0, ...lead.flatMap((n) => [n.t, n.t + n.dur]), duration];
  const out = [...lead];
  for (let i = 0; i + 1 < bounds.length; i += 2) {
    const a = bounds[i];
    const b = bounds[i + 1];
    if (b - a < LEAD_GAP_SEC) continue;
    for (const v of vocals) if (v.t > a + 0.1 && v.t < b - 0.1) out.push({ ...v });
  }
  return out.sort((x, y) => x.t - y.t);
}

/** Shortens notes so each one ends before the next begins. */
function trimOverlaps(notes: PitchedNote[]): PitchedNote[] {
  for (let i = 0; i + 1 < notes.length; i++) {
    const n = notes[i];
    const next = notes[i + 1].t;
    if (n.t + n.dur > next) n.dur = Math.max(0.03, next - n.t);
  }
  return notes;
}

/** Legacy split used when no bend data is available (salience tracker). */
export function splitLines(notes: PitchedNote[], minStrength = 0.15): { bass: PitchedNote[]; lead: PitchedNote[] } {
  const strong = notes.filter((n) => n.strength >= minStrength);
  const high = strong.filter((n) => n.midi >= BASS_SPLIT);
  const bass = bassLine(strong);
  const lead = monophonic(high, (n) => n.strength * (1 + (n.midi - 60) * 0.015) * Math.min(1.5, 0.6 + n.dur * 2));
  return { bass, lead };
}

/** Silence (s) around a cluster of sung notes that makes it stand alone. */
const STRAY_GAP = 1.5;
/** Clusters this small (or smaller) in a break need to prove they are singing. */
const STRAY_MAX_NOTES = 3;
/** Notes in runs at least this long count as phrases. */
const PHRASE_NOTES = 4;

/**
 * Removes stray notes from a vocal line: a note or two in a long break without singing is usually
 * an instrument bleeding into the vocal track (or, without stems, an instrument taken for a voice).
 * A small cluster with silence around it stays only when it sounds like the singing elsewhere in
 * the song: not clearly weaker than the song's typical sung note, not completely flat in pitch,
 * and, when the vocal stem's loudness is known (`level`, relative to its loud parts), not quiet.
 * A "vocal line" that is nearly all such fragments has no singing at all and is dropped.
 */
export function dropStrayVocals(notes: PitchedNote[], level?: (n: PitchedNote) => number): PitchedNote[] {
  if (!notes.length) return notes;
  const sorted = [...notes].sort((a, b) => a.t - b.t);
  const groups: PitchedNote[][] = [];
  for (const n of sorted) {
    const g = groups[groups.length - 1];
    const prev = g?.[g.length - 1];
    if (prev && n.t - (prev.t + prev.dur) < STRAY_GAP) g.push(n);
    else groups.push([n]);
  }
  const inPhrases = groups.filter((g) => g.length >= PHRASE_NOTES).reduce((sum, g) => sum + g.length, 0);
  if (inPhrases < sorted.length * 0.25) return [];

  const strengths = sorted.map((n) => n.strength).sort((a, b) => a - b);
  const typical = strengths[strengths.length >> 1];
  const sung = (g: PitchedNote[]) => {
    const mean = g.reduce((s, n) => s + n.strength, 0) / g.length;
    const flat = g.every((n) => (n.bend ?? 0) < 0.05);
    if (level) {
      const loudest = Math.max(...g.map(level));
      return !(loudest < 0.35 && mean < typical) && !flat;
    }
    return mean >= typical * 0.8 && !flat;
  };
  return groups.flatMap((g) => (g.length > STRAY_MAX_NOTES || sung(g) ? g : []));
}
