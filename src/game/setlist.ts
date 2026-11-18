/**
 * Setlists: up to four songs played back to back with one part and difficulty. The player's own
 * setlist is stored between visits; the home screen also offers a few made from the library.
 */
import { DIFFICULTIES, PARTS, type Difficulty, type Part } from '../chart/types';

export const SET_MAX = 4;

export interface Pick {
  part: Part;
  difficulty: Difficulty;
}

/** Per song, the parts it hardly has (see chart/presence): they are not offered for playing. */
export type ThinParts = Record<string, readonly Part[] | undefined>;

/**
 * The parts a set can be played on: every part that at least one of its songs really has. A set
 * never ends up without one: if no part is left, all are open.
 */
export function setParts(ids: readonly string[], thin: ThinParts): Part[] {
  const open = PARTS.filter((p) => ids.some((id) => !thin[id]?.includes(p)));
  return open.length ? open : [...PARTS];
}

/** The part a set is played on: the chosen one, or the first open one when the set does not have it. */
export function partFor(pick: Pick, open: readonly Part[]): Part {
  return open.includes(pick.part) ? pick.part : open[0];
}

/** Adds the song to the setlist, or takes it out when it is already in. A full setlist stays as it is. */
export function toggleSong(list: readonly string[], id: string): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id);
  return list.length >= SET_MAX ? [...list] : [...list, id];
}

/** The setlist without songs that are gone, without repeats, and no longer than a set. */
export function pruneSetlist(list: readonly string[], known: ReadonlySet<string>): string[] {
  return [...new Set(list)].filter((id) => known.has(id)).slice(0, SET_MAX);
}

export const formatTime = (seconds: number) => (seconds > 0 ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}` : '');

export interface SetSong {
  id: string;
  addedAt: number;
  duration: number;
}

export interface SuggestedSet {
  id: 'shuffle' | 'newest' | 'unplayed';
  title: string;
  caption: string;
  songs: string[];
}

/** A small seeded generator (mulberry32), so a shuffle stays put until it is asked for again. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sets made from the playable songs: a shuffle, the newest additions and songs never played. A set
 * needs at least two songs, and one that would repeat an earlier set is left out.
 */
export function suggestSets(ready: readonly SetSong[], played: ReadonlySet<string>, seed: number): SuggestedSet[] {
  const out: SuggestedSet[] = [];
  const add = (set: SuggestedSet) => {
    if (set.songs.length < 2) return;
    const key = [...set.songs].sort().join();
    if (out.some((o) => [...o.songs].sort().join() === key)) return;
    out.push(set);
  };
  const rand = seeded(seed);
  const shuffled = ready.map((s) => ({ id: s.id, r: rand() })).sort((a, b) => a.r - b.r);
  add({ id: 'shuffle', title: 'Shuffle', caption: 'A different mix each visit', songs: shuffled.slice(0, SET_MAX).map((s) => s.id) });
  const newest = [...ready].filter((s) => s.addedAt > 0).sort((a, b) => b.addedAt - a.addedAt);
  add({ id: 'newest', title: 'Newest', caption: 'Your latest additions', songs: newest.slice(0, SET_MAX).map((s) => s.id) });
  const fresh = ready.filter((s) => !played.has(s.id));
  add({ id: 'unplayed', title: 'Unplayed', caption: 'Songs without a score yet', songs: fresh.slice(0, SET_MAX).map((s) => s.id) });
  return out;
}

const SET_KEY = 'festival.setlist';
const PICK_KEY = 'festival.lastPick';

export function loadSetlist(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SET_KEY) ?? '[]');
    if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').slice(0, SET_MAX);
  } catch {
    /* none saved */
  }
  return [];
}

export function saveSetlist(list: readonly string[]) {
  try {
    localStorage.setItem(SET_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

export function loadPick(): Pick {
  try {
    const v = JSON.parse(localStorage.getItem(PICK_KEY) ?? '');
    if (PARTS.includes(v.part) && DIFFICULTIES.includes(v.difficulty)) return { part: v.part, difficulty: v.difficulty };
  } catch {
    /* none saved */
  }
  return { part: 'vocals', difficulty: 'expert' };
}

export function savePick(pick: Pick) {
  try {
    localStorage.setItem(PICK_KEY, JSON.stringify(pick));
  } catch {
    /* storage unavailable */
  }
}
