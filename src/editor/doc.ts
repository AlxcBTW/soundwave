/**
 * One chart while it is being edited. Notes are kept in beats, not seconds, so a change of tempo
 * moves them with the grid and every step, snap and comparison is exact. The document knows nothing
 * about the screen: the editor asks it to change and it remembers how to undo each change.
 */
import type { Note } from '../chart/types';
import { MIN_LONG } from './edits';
import { quantize, samePos, settle, type EditorGrid } from './grid';

export interface DocNote {
  /** Stays with the note through every change, so a selection survives edits. */
  id: number;
  /** Where it is hit, in beats. */
  pos: number;
  lane: number;
  /** How long it is held, in beats (0 for a tap). */
  len: number;
  /** A long note that must also be let go on time. */
  release?: boolean;
  /** Its overdrive phrase, or -1. */
  phrase: number;
}

/** Copied notes: positions are measured from the start of what was copied. */
export interface Clip {
  notes: Omit<DocNote, 'id'>[];
  /** How many beats the copied stretch covers. */
  length: number;
  lanes: number;
}

/** Room left between the end of a long note and the next note in its lane, in beats. */
const TAIL_GAP = 0.125;
const MAX_UNDO = 200;

const byPlace = (a: DocNote, b: DocNote) => a.pos - b.pos || a.lane - b.lane;

export class ChartDoc {
  private list: DocNote[] = [];
  private undoStack: DocNote[][] = [];
  private redoStack: DocNote[][] = [];
  /** The notes as they were when a gesture began; while set, changes are one undo step. */
  private pending: DocNote[] | null = null;
  private nextId = 1;
  /** Counts every change, for anything that caches what it drew or saved. */
  revision = 0;
  /** The notes as they were loaded. */
  private base: DocNote[] = [];
  /** Set when the chart has to be written again although its notes are the same (its grid moved). */
  private stale = false;

  constructor(readonly lanes: number) {}

  /** Loads a chart's notes (in seconds) onto the grid. Clears the history. */
  load(notes: readonly Note[], grid: EditorGrid) {
    this.list = notes
      .filter((n) => n.lane >= 0 && n.lane < this.lanes)
      .map((n) => {
        const pos = settle(grid.pos(n.t));
        const len = n.dur > 0 ? settle(grid.pos(n.t + n.dur) - pos) : 0;
        return {
          id: this.nextId++,
          pos,
          lane: n.lane,
          len: Math.max(0, len),
          phrase: n.phrase ?? -1,
          ...(n.release && n.dur > 0 ? { release: true } : {}),
        };
      })
      .sort(byPlace);
    this.base = this.list;
    this.stale = false;
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
    this.revision++;
  }

  /** Whether the chart differs from what it was loaded as. Undoing every change makes it the same again. */
  get changed() {
    return this.stale || !same(this.list, this.base, false);
  }

  /** Marks the chart as needing to be saved again. */
  touch() {
    this.stale = true;
  }

  /** The chart in seconds, as it is stored and played. */
  toNotes(grid: EditorGrid): Note[] {
    return this.list.map((n) => {
      const t = Math.max(0, grid.time(n.pos));
      const dur = n.len > 0 ? Math.max(0, grid.time(n.pos + n.len) - grid.time(n.pos)) : 0;
      return { t, lane: n.lane, dur, phrase: n.phrase, ...(n.release && dur > 0 ? { release: true } : {}) };
    });
  }

  get notes(): readonly DocNote[] {
    return this.list;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  byId(id: number) {
    return this.list.find((n) => n.id === id);
  }

  /** The note that starts at this position in this lane. */
  at(pos: number, lane: number) {
    return this.list.find((n) => n.lane === lane && samePos(n.pos, pos));
  }

  /** The note at this position in this lane, or the long note that is being held there. */
  covering(pos: number, lane: number) {
    return this.list.find((n) => n.lane === lane && (samePos(n.pos, pos) || (n.len > 0 && pos > n.pos && pos <= n.pos + n.len + 1e-4)));
  }

  /** Index of the first note at or after `pos`. */
  firstFrom(pos: number) {
    let lo = 0;
    let hi = this.list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.list[mid].pos < pos - 1e-4) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Ids of the notes that start inside [from, to). */
  idsBetween(from: number, to: number): number[] {
    const out: number[] = [];
    for (let i = this.firstFrom(from); i < this.list.length && this.list[i].pos < to - 1e-4; i++) out.push(this.list[i].id);
    return out;
  }

  /* History ------------------------------------------------------------------------------- */

  /** Starts a gesture (a drag, a recording): every change until `commit` is one step to undo. */
  begin() {
    this.pending ??= this.list;
  }

  commit() {
    const before = this.pending;
    this.pending = null;
    if (before && before !== this.list) this.remember(before);
  }

  /** Abandons a gesture and puts the notes back. */
  cancel() {
    if (!this.pending) return;
    this.list = this.pending;
    this.pending = null;
    this.revision++;
  }

  private remember(before: DocNote[]) {
    this.undoStack.push(before);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Replaces the notes; `next` must be a new array. Returns whether anything changed. */
  private apply(next: DocNote[]): boolean {
    const tidy = this.tidy(next);
    if (same(tidy, this.list)) return false;
    if (!this.pending) this.remember(this.list);
    this.list = tidy;
    this.revision++;
    return true;
  }

  undo(): boolean {
    this.commit();
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.list);
    this.list = prev;
    this.revision++;
    return true;
  }

  redo(): boolean {
    this.commit();
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.list);
    this.list = next;
    this.revision++;
    return true;
  }

  /** Sorted, one note per lane and position, and no long note running into the next note in its lane. */
  private tidy(notes: DocNote[]): DocNote[] {
    const sorted = [...notes].sort(byPlace);
    const out: DocNote[] = [];
    const last: (number | undefined)[] = [];
    for (let n of sorted) {
      if (n.lane < 0 || n.lane >= this.lanes) continue;
      const pi = last[n.lane];
      if (pi !== undefined) {
        const p = out[pi];
        if (samePos(p.pos, n.pos)) continue;
        if (p.len > 0 && p.pos + p.len > n.pos - TAIL_GAP + 1e-6) {
          const len = quantize(Math.max(0, n.pos - TAIL_GAP - p.pos));
          out[pi] = trimmed(p, len < MIN_LONG ? 0 : len);
        }
      }
      if (n.len > 0 && n.len < MIN_LONG) n = trimmed(n, 0);
      last[n.lane] = out.length;
      out.push(n);
    }
    return out;
  }

  /**
   * Moves every note, and every state that could be gone back to, by whole beats: the grid under
   * the chart was renumbered. Not a change to the chart, so nothing is added to the history.
   */
  rebase(beats: number) {
    if (!beats) return;
    const shift = (list: DocNote[]) => list.map((n) => ({ ...n, pos: quantize(n.pos + beats) }));
    const pristine = this.list === this.base;
    this.list = shift(this.list);
    this.base = pristine ? this.list : shift(this.base);
    this.undoStack = this.undoStack.map(shift);
    this.redoStack = this.redoStack.map(shift);
    if (this.pending) this.pending = shift(this.pending);
    this.revision++;
  }

  /* Changes ------------------------------------------------------------------------------- */

  /**
   * Adds a note; one already there is kept. Returns the note at that place.
   *
   * A tile set down on a long note is not a note of its own: it is where that note is let go. The
   * long note ends there and becomes a hold-and-release note (the tile at the end of a hold, as the
   * game draws it). Set on the end of one that already is, it takes the release away again. With
   * `plain`, a tile is always a note, and a long note under it is cut short to make room.
   */
  add(pos: number, lane: number, len = 0, plain = false): DocNote | undefined {
    const there = this.at(pos, lane);
    if (there) return there;
    if (lane < 0 || lane >= this.lanes) return undefined;
    const held = plain
      ? undefined
      : this.list.find((n) => n.lane === lane && n.len > 0 && pos > n.pos + 1e-4 && pos < n.pos + n.len + 1e-4);
    if (held) {
      const atEnd = samePos(pos, held.pos + held.len);
      const to = quantize(pos - held.pos);
      if (to < MIN_LONG) return held;
      this.apply(
        this.list.map((n) => {
          if (n.id !== held.id) return n;
          const { release: _, ...rest } = n;
          return atEnd && n.release ? rest : { ...rest, len: to, release: true };
        }),
      );
      return this.byId(held.id);
    }
    // A note set down inside a phrase belongs to it.
    const phrase = this.phraseAt(pos);
    const note: DocNote = { id: this.nextId++, pos: quantize(pos), lane, len: Math.max(0, len), phrase };
    this.apply([...this.list, note]);
    return this.byId(note.id);
  }

  remove(ids: Iterable<number>): boolean {
    const gone = new Set(ids);
    if (!gone.size) return false;
    return this.apply(this.list.filter((n) => !gone.has(n.id)));
  }

  /** Adds a note where there is none and removes the one that is there. Returns the note added, if any. */
  toggle(pos: number, lane: number): DocNote | undefined {
    const there = this.at(pos, lane);
    if (there) {
      this.remove([there.id]);
      return undefined;
    }
    return this.add(pos, lane);
  }

  /** Sets how long a note is held, in beats. It is kept clear of the next note in its lane. */
  setLength(id: number, len: number): boolean {
    const n = this.byId(id);
    if (!n) return false;
    const next = this.list.find((m) => m.lane === n.lane && m.pos > n.pos + 1e-4);
    // Stretched right up to a tile in its lane, the long note takes that tile as its end: it is let
    // go there, and the tile is no longer a note of its own.
    if (next && next.len === 0 && len > next.pos - n.pos - 1e-4 && next.pos - n.pos >= MIN_LONG) {
      const to = quantize(next.pos - n.pos);
      return this.apply(this.list.filter((m) => m.id !== next.id).map((m) => (m.id === id ? { ...m, len: to, release: true } : m)));
    }
    const room = next ? Math.max(0, next.pos - TAIL_GAP - n.pos) : Infinity;
    let want = Math.max(0, Math.min(len, room));
    if (want < MIN_LONG) want = 0;
    want = quantize(want);
    if (samePos(want, n.len)) return false;
    return this.apply(this.list.map((m) => (m.id === id ? trimmed(m, want) : m)));
  }

  /** Moves notes by beats and lanes. Nothing moves if any of them would leave the chart. */
  move(ids: Iterable<number>, beats: number, lanes: number, min: number, max: number): boolean {
    const set = new Set(ids);
    if (!set.size || (!beats && !lanes)) return false;
    const moving = this.list.filter((n) => set.has(n.id));
    if (moving.some((n) => n.lane + lanes < 0 || n.lane + lanes >= this.lanes || n.pos + beats < min - 1e-4 || n.pos + beats > max + 1e-4))
      return false;
    const moved = moving.map((n) => ({ ...n, pos: quantize(n.pos + beats), lane: n.lane + lanes }));
    // What moves wins over what it lands on.
    const taken = new Set(moved.map((n) => `${n.lane}:${n.pos.toFixed(4)}`));
    const rest = this.list.filter((n) => !set.has(n.id) && !taken.has(`${n.lane}:${n.pos.toFixed(4)}`));
    return this.apply([...rest, ...moved]);
  }

  /**
   * Rewrites notes in place: `fn` gives each of them its new position, lane and length, or null to
   * remove it. What they land on gives way.
   */
  transform(ids: Iterable<number>, fn: (n: DocNote, index: number) => { pos: number; lane?: number; len?: number } | null): boolean {
    const set = new Set(ids);
    if (!set.size) return false;
    const moved: DocNote[] = [];
    this.list
      .filter((n) => set.has(n.id))
      .forEach((n, i) => {
        const to = fn(n, i);
        if (!to) return;
        const len = Math.max(0, to.len ?? n.len);
        moved.push(trimmed({ ...n, pos: quantize(to.pos), lane: to.lane ?? n.lane }, len < MIN_LONG ? 0 : quantize(len)));
      });
    const taken = new Set(moved.map((n) => `${n.lane}:${n.pos.toFixed(4)}`));
    const rest = this.list.filter((n) => !set.has(n.id) && !taken.has(`${n.lane}:${n.pos.toFixed(4)}`));
    return this.apply([...rest, ...moved]);
  }

  /** Replaces the whole chart with notes given in beats. Can be undone. Returns whether it changed. */
  setNotes(notes: readonly Omit<DocNote, 'id'>[]): boolean {
    return this.apply(notes.filter((n) => n.lane >= 0 && n.lane < this.lanes).map((n) => ({ ...n, id: this.nextId++ })));
  }

  /** Flips notes across the middle of the highway. */
  mirror(ids: Iterable<number>): boolean {
    const set = new Set(ids);
    if (!set.size) return false;
    const flipped = this.list.filter((n) => set.has(n.id)).map((n) => ({ ...n, lane: this.lanes - 1 - n.lane }));
    const taken = new Set(flipped.map((n) => `${n.lane}:${n.pos.toFixed(4)}`));
    const rest = this.list.filter((n) => !set.has(n.id) && !taken.has(`${n.lane}:${n.pos.toFixed(4)}`));
    return this.apply([...rest, ...flipped]);
  }

  /** The phrase a position falls inside (between a phrase's first and last note), or -1. */
  phraseAt(pos: number): number {
    const span = new Map<number, [number, number]>();
    for (const n of this.list) {
      if (n.phrase < 0) continue;
      const s = span.get(n.phrase);
      if (!s) span.set(n.phrase, [n.pos, n.pos]);
      else s[1] = n.pos;
    }
    for (const [id, [a, b]] of span) if (pos > a - 1e-4 && pos < b + 1e-4) return id;
    return -1;
  }

  /** Each phrase's first and last position, in order. */
  phrases(): { id: number; from: number; to: number; count: number }[] {
    const span = new Map<number, { id: number; from: number; to: number; count: number }>();
    for (const n of this.list) {
      if (n.phrase < 0) continue;
      const s = span.get(n.phrase);
      if (!s) span.set(n.phrase, { id: n.phrase, from: n.pos, to: n.pos + n.len, count: 1 });
      else {
        s.to = Math.max(s.to, n.pos + n.len);
        s.count++;
      }
    }
    return [...span.values()].sort((a, b) => a.from - b.from);
  }

  /**
   * Makes the notes one overdrive phrase, or takes them out of theirs. A phrase is a stretch of the
   * song, so every note between the first and the last of them joins it.
   */
  setPhrase(ids: Iterable<number>, on: boolean): boolean {
    const set = new Set(ids);
    const picked = this.list.filter((n) => set.has(n.id));
    if (!picked.length) return false;
    if (!on) return this.apply(this.list.map((n) => (set.has(n.id) && n.phrase >= 0 ? { ...n, phrase: -1 } : n)));
    const from = picked[0].pos;
    const to = picked[picked.length - 1].pos;
    const id = this.list.reduce((m, n) => Math.max(m, n.phrase), -1) + 1;
    return this.apply(this.list.map((n) => (n.pos > from - 1e-4 && n.pos < to + 1e-4 ? { ...n, phrase: id } : n)));
  }

  /** Whether every one of the notes is in a phrase. */
  allInPhrase(ids: Iterable<number>): boolean {
    const set = new Set(ids);
    const picked = this.list.filter((n) => set.has(n.id));
    return picked.length > 0 && picked.every((n) => n.phrase >= 0);
  }

  /** Long notes among these that must be let go on time: sets it, or clears it. */
  setRelease(ids: Iterable<number>, on: boolean): boolean {
    const set = new Set(ids);
    return this.apply(
      this.list.map((n) => {
        if (!set.has(n.id) || n.len <= 0 || !!n.release === on) return n;
        const { release: _, ...rest } = n;
        return on ? { ...rest, release: true } : rest;
      }),
    );
  }

  /** Replaces the whole chart (written again, copied from another, cleared). Can be undone. */
  replace(notes: readonly Note[], grid: EditorGrid): boolean {
    const next = notes
      .filter((n) => n.lane >= 0 && n.lane < this.lanes)
      .map((n) => {
        const pos = settle(grid.pos(n.t));
        const len = n.dur > 0 ? Math.max(0, settle(grid.pos(n.t + n.dur) - pos)) : 0;
        return { id: this.nextId++, pos, lane: n.lane, len, phrase: n.phrase ?? -1, ...(n.release && n.dur > 0 ? { release: true } : {}) };
      });
    return this.apply(next);
  }

  /* Copy and paste ------------------------------------------------------------------------ */

  /**
   * Copies notes. `from` and `length` say which stretch was meant (a marked range); without them it
   * runs from the first note to the end of the last, rounded up to whole beats.
   */
  copy(ids: Iterable<number>, from?: number, length?: number): Clip | undefined {
    const set = new Set(ids);
    const picked = this.list.filter((n) => set.has(n.id));
    if (!picked.length) return undefined;
    const start = from ?? Math.floor(picked[0].pos + 1e-4);
    const end = picked.reduce((m, n) => Math.max(m, n.pos + n.len), start);
    const len = length ?? Math.max(1, Math.ceil(end - start - 1e-4));
    // Phrases keep their shape but not their numbers.
    const phrases = new Map<number, number>();
    const notes = picked.map((n) => {
      if (n.phrase >= 0 && !phrases.has(n.phrase)) phrases.set(n.phrase, phrases.size);
      return {
        pos: quantize(n.pos - start),
        lane: n.lane,
        len: n.len,
        phrase: n.phrase >= 0 ? phrases.get(n.phrase)! : -1,
        ...(n.release ? { release: true } : {}),
      };
    });
    return { notes, length: len, lanes: this.lanes };
  }

  /** Sets copied notes down from `pos` on, in place of whatever was in that stretch. Returns their ids. */
  paste(clip: Clip, pos: number, max: number): number[] {
    const base = this.list.reduce((m, n) => Math.max(m, n.phrase), -1) + 1;
    const added: DocNote[] = [];
    for (const c of clip.notes) {
      const at = quantize(pos + c.pos);
      if (at > max + 1e-4) continue;
      const lane = Math.min(this.lanes - 1, c.lane);
      if (added.some((a) => a.lane === lane && samePos(a.pos, at))) continue;
      added.push({
        id: this.nextId++,
        pos: at,
        lane,
        len: c.len,
        phrase: c.phrase >= 0 ? base + c.phrase : -1,
        ...(c.release ? { release: true } : {}),
      });
    }
    if (!added.length) return [];
    const rest = this.list.filter((n) => n.pos < pos - 1e-4 || n.pos >= pos + clip.length - 1e-4);
    this.apply([...rest, ...added]);
    const ids = new Set(added.map((a) => a.id));
    return this.list.filter((n) => ids.has(n.id)).map((n) => n.id);
  }

  /* Facts --------------------------------------------------------------------------------- */

  stats(grid: EditorGrid) {
    let long = 0;
    let chords = 0;
    let awkward = 0;
    let peak = 0;
    const times: number[] = [];
    for (let i = 0; i < this.list.length;) {
      let j = i;
      let left = 0;
      let right = 0;
      while (j < this.list.length && samePos(this.list[j].pos, this.list[i].pos)) {
        if (this.list[j].len > 0) long++;
        // On a controller the two leftmost lanes are under one thumb and the rest under the other.
        if (this.list[j].lane <= 1) left++;
        else right++;
        j++;
      }
      if (j - i > 1) chords++;
      if (left > 1 || right > 1) awkward++;
      times.push(grid.time(this.list[i].pos));
      i = j;
    }
    // The busiest second, in note times.
    for (let a = 0, b = 0; b < times.length; b++) {
      while (times[b] - times[a] > 1) a++;
      peak = Math.max(peak, b - a + 1);
    }
    return { notes: this.list.length, long, chords, awkward, phrases: this.phrases().length, peak };
  }
}

function trimmed(n: DocNote, len: number): DocNote {
  if (len > 0) return { ...n, len };
  const { release: _, ...rest } = n;
  return { ...rest, len: 0 };
}

/** Whether two lists hold the same notes; with `ids`, also the very same ones. */
function same(a: DocNote[], b: DocNote[], ids = true) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (
      (ids && x.id !== y.id) ||
      x.lane !== y.lane ||
      x.phrase !== y.phrase ||
      !!x.release !== !!y.release ||
      !samePos(x.pos, y.pos) ||
      !samePos(x.len, y.len)
    )
      return false;
  }
  return true;
}
