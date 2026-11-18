import type { AnalysisResult } from '../analysis/types';
import { PARTS, type Part } from './types';

/**
 * How much of a song each part plays in, and which parts are hardly there. A song without a singer
 * still gets a few "vocal" notes (bits of other instruments that ended up in the vocal stem), and an
 * a cappella song a few stray drum hits: such a part would be a chart of long waits and a handful
 * of notes that are not really its own, so it is not offered for playing.
 */

/** A note that sounds for at least this share of a bar makes the bar one the part plays in. */
const HELD_SHARE = 0.3;
/** A part that plays in fewer than this share of the song's bars is hardly there... */
const MIN_SHARE = 0.1;
/** ...and so is one that plays in fewer than this share of the bars the busiest part plays in. */
const MIN_OF_BUSIEST = 0.2;
/** Where a song has no bar lines, it is cut into stretches of this many seconds instead. */
const WINDOW = 2;

interface Sound {
  t: number;
  dur: number;
}

/** The song cut at its bar lines (or into even stretches where it has none). */
function barEdges(a: AnalysisResult): number[] {
  const end = Math.max(a.duration, a.beats[a.beats.length - 1] ?? 0);
  const starts = a.downbeats.map((i) => a.beats[i]).filter((t) => t !== undefined && t < end);
  let edges: number[];
  if (starts.length >= 2) {
    // What is played before the first bar line (a pickup, an intro off the grid) is a stretch too.
    edges = starts[0] > 0.5 ? [0, ...starts] : [...starts];
  } else {
    edges = [];
    for (let t = 0; t < end; t += WINDOW) edges.push(t);
  }
  edges.push(end);
  return edges;
}

/**
 * The share of the song's bars (0..1) the part plays in. A bar counts when the part has two notes
 * or more in it, or a note sounding through a good part of it; a single short note does not.
 */
function share(sounds: Sound[], edges: number[]): number {
  const bars = edges.length - 1;
  if (bars <= 0 || !sounds.length) return 0;
  const sorted = [...sounds].sort((x, y) => x.t - y.t);
  let active = 0;
  let first = 0;
  for (let b = 0; b < bars; b++) {
    const from = edges[b];
    const to = edges[b + 1];
    // Notes that ended before this bar are done with.
    while (first < sorted.length && sorted[first].t + sorted[first].dur <= from && sorted[first].t < from) first++;
    let onsets = 0;
    let held = 0;
    for (let i = first; i < sorted.length && sorted[i].t < to; i++) {
      const s = sorted[i];
      if (s.t >= from) onsets++;
      held += Math.max(0, Math.min(to, s.t + s.dur) - Math.max(from, s.t));
    }
    if (onsets >= 2 || held >= HELD_SHARE * (to - from)) active++;
  }
  return active / bars;
}

/** For each part, the share of the song's bars it plays in (0..1). */
export function partPresence(a: AnalysisResult): Record<Part, number> {
  const edges = barEdges(a);
  const sounds: Record<Part, Sound[]> = {
    vocals: a.vocals ?? [],
    lead: a.lead,
    bass: a.bass,
    drums: a.drums.map((d) => ({ t: d.t, dur: 0 })),
  };
  return Object.fromEntries(PARTS.map((p) => [p, share(sounds[p], edges)])) as Record<Part, number>;
}

/**
 * The parts the song hardly has, compared with the rest of it. None when no part stands out as
 * present (nothing to compare with), so a song is never left without a part to play.
 */
export function thinParts(a: AnalysisResult): Part[] {
  const presence = partPresence(a);
  const busiest = Math.max(...PARTS.map((p) => presence[p]));
  const thin = PARTS.filter((p) => presence[p] < MIN_SHARE || presence[p] < MIN_OF_BUSIEST * busiest);
  return thin.length === PARTS.length ? [] : thin;
}
