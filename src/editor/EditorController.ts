/**
 * The track editor behind its screen: the song, its charts while they are edited, the edit position,
 * the selection, playback, recording and saving, and every way of putting a hand on it (keys, a
 * controller, a mouse, fingers). It lives outside React, like the play controller: the screen draws
 * a small snapshot of it and calls its methods, and the frame loop never re-renders anything.
 */
import { analysisManager } from '../analysis/manager';
import type { AnalysisResult, StemName } from '../analysis/types';
import { getEngine } from '../audio/engine';
import { playSfx, type Sfx } from '../audio/sfx';
import { loadSongBuffer } from '../audio/songAudio';
import { lanesFor, type Chart, type Difficulty, type Note, type Part } from '../chart/types';
import { computePeaks, type Peaks } from '../debug/Timeline';
import type { Settings } from '../game/settings';
import { getInputMode, isTextField, usesFocus } from '../input/inputMode';
import { confirmInput, pads, PAUSE_INPUT, resolveStyle, type PadEvent } from '../input/pads';
import { menuPulse, type MenuPulse } from '../input/rumble';
import { getStem, listStems, type SongMeta } from '../storage/db';
import { Clicks, type Tick } from './clicks';
import { detectGrid } from './detect';
import { ChartDoc, type Clip } from './doc';
import { chartFromNotes, chartKey, cleanNotes, emptyEdits, fitLanes, resolveGrid, type ChartKey, type SongEdits } from './edits';
import { drawOverview, EditorView, type GuideMark, type Scene } from './EditorView';
import { EditorGrid, fitFixed, MAX_BPM, MIN_BPM, SNAPS, type GridSpec, type Snap } from './grid';

export type Tool = 'draw' | 'select';
export type AudioSource = 'song' | StemName;
export const RATES = [1, 0.75, 0.5] as const;
export const SOURCE_LABEL: Record<AudioSource, string> = { song: 'Whole song', other: 'Instruments only', bass: 'Bass only', drums: 'Drums only', vocals: 'Vocals only' };
/** Which stem belongs to a part (the instrument stem feeds Lead). */
const PART_STEM: Record<Part, StemName> = { lead: 'other', bass: 'bass', drums: 'drums', vocals: 'vocals' };

/** Zoom steps, in px per beat at a 16px root. */
const ZOOMS = [26, 38, 54, 76, 108, 152, 214, 300];
const PREFS_KEY = 'festival.editor.v1';

interface Prefs {
  part: Part;
  difficulty: Difficulty;
  snap: Snap;
  zoom: number;
  clicks: boolean;
  metronome: boolean;
  tool: Tool;
}

function loadPrefs(): Prefs {
  const base: Prefs = { part: 'lead', difficulty: 'expert', snap: 4, zoom: 4, clicks: true, metronome: false, tool: 'draw' };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return {
      part: (['lead', 'bass', 'drums', 'vocals'] as Part[]).includes(p.part as Part) ? (p.part as Part) : base.part,
      difficulty: (['easy', 'medium', 'hard', 'expert'] as Difficulty[]).includes(p.difficulty as Difficulty) ? (p.difficulty as Difficulty) : base.difficulty,
      snap: SNAPS.includes(p.snap as Snap) ? (p.snap as Snap) : base.snap,
      zoom: Number.isInteger(p.zoom) && p.zoom! >= 0 && p.zoom! < ZOOMS.length ? p.zoom! : base.zoom,
      clicks: typeof p.clicks === 'boolean' ? p.clicks : base.clicks,
      metronome: typeof p.metronome === 'boolean' ? p.metronome : base.metronome,
      tool: p.tool === 'select' ? 'select' : 'draw',
    };
  } catch {
    return base;
  }
}

export interface GridInfo {
  /** `song`: the grid follows the beats heard in the song. `fixed`: one tempo throughout. */
  mode: 'song' | 'fixed';
  bpm: number;
  /** Time of a first beat of a bar, seconds. */
  offset: number;
  beatsPerBar: number;
  /** Whether there are heard beats to follow. */
  canFollow: boolean;
}

export interface EditorSnapshot {
  phase: 'loading' | 'ready' | 'error';
  error?: string;
  part: Part;
  difficulty: Difficulty;
  lanes: number;
  snap: Snap;
  zoom: number;
  zoomSteps: number;
  tool: Tool;
  playing: boolean;
  recording: boolean;
  rate: number;
  source: AudioSource;
  sources: AudioSource[];
  clicks: boolean;
  metronome: boolean;
  /** Notes selected, and whether a stretch is being marked from the controller or keyboard. */
  selected: number;
  marking: boolean;
  /** A stretch of the song is marked (it may hold no notes). */
  ranged: boolean;
  /** About the selection: all of it is in a phrase; it has long notes; all of those must be let go on time. */
  selPhrase: boolean;
  selLong: boolean;
  selRelease: boolean;
  clipboard: number;
  canUndo: boolean;
  canRedo: boolean;
  stats: { notes: number; long: number; chords: number; awkward: number; phrases: number; peak: number };
  /** This chart was made or changed by hand (otherwise it is the one the game wrote). */
  edited: boolean;
  /** The game has a chart of its own for this part that the edited one could be put back to. */
  canRevert: boolean;
  save: 'saved' | 'pending' | 'saving';
  hasAnalysis: boolean;
  grid: GridInfo;
  duration: number;
}

export interface EditorElements {
  track: HTMLElement;
  canvas: HTMLCanvasElement;
  overview: HTMLCanvasElement;
  /** Readouts written every frame: the bar and beat, and the time. */
  bar: HTMLElement;
  time: HTMLElement;
  /** Says where the cursor is, for a screen reader. */
  status: HTMLElement;
}

type Gesture =
  | { kind: 'wait'; x: number; y: number; timer: number; lane: number; pos: number; noteId?: number }
  | { kind: 'draw'; id: number; existed: boolean; stretched: boolean; y: number }
  | { kind: 'pan'; y: number; pos: number; lastY: number; lastT: number; v: number }
  | { kind: 'marquee'; x: number; y: number; add: Set<number> }
  | { kind: 'move'; pos: number; lane: number; dPos: number; dLane: number; moved: boolean; id: number; wasSelected: boolean }
  | { kind: 'pinch'; dist: number; px: number };

/** Keeps a pointer's moves coming to an element. A pointer that is already gone cannot be held on to. */
const hold = (el: Element, id: number) => {
  try {
    el.setPointerCapture(id);
  } catch {
    /* the pointer ended before this ran */
  }
};

const fmtTime = (t: number) => {
  const s = Math.max(0, t);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};

/** What was copied last, in any chart of any song: it can be set down in another part or difficulty. */
let clipboard: Clip | null = null;

/** An editor put aside while its chart is test-played, to be picked up again with its history. */
let parked: EditorController | null = null;
export function parkEditor(c: EditorController) {
  if (parked && parked !== c) parked.dispose();
  parked = c;
}
export function takeParked(songId: string): EditorController | null {
  const c = parked;
  parked = null;
  if (c && c.song.id === songId && !c.disposed) return c;
  c?.dispose();
  return null;
}

export class EditorController {
  readonly engine = getEngine();
  private readonly prefs = loadPrefs();
  private analysis?: AnalysisResult;
  private edits: SongEdits = emptyEdits();
  private buffer?: AudioBuffer;
  private songBuffer?: AudioBuffer;
  private peaks?: Peaks;
  private stems: StemName[] = [];
  private duration = 0;
  grid!: EditorGrid;
  private docs = new Map<ChartKey, ChartDoc>();
  /** Per open chart: the revision at which it was put back to the game's own chart. */
  private reverted = new Map<ChartKey, number>();
  /** Open charts that were the player's own when they were opened. */
  private own = new Set<ChartKey>();
  doc = new ChartDoc(5);
  private guide?: GuideMark[];

  private part: Part = this.prefs.part;
  private difficulty: Difficulty = this.prefs.difficulty;
  private snap: Snap = this.prefs.snap;
  private zoom = this.prefs.zoom;
  private tool: Tool = this.prefs.tool;
  private clicksOn = this.prefs.clicks;
  private metronome = this.prefs.metronome;
  private rate = 1;
  private source: AudioSource = 'song';

  /** The position on the now line, and where it is easing to. */
  private viewPos = 0;
  private target: number | null = null;
  private lane = 0;
  private sel = new Set<number>();
  private range: [number, number] | null = null;
  /** Where a marked stretch started; `sticky` when it was started with the mark button (it then follows every move). */
  private mark: number | null = null;
  private sticky = false;
  private ghost: Scene['ghost'] = null;
  private marquee: Scene['marquee'] = null;
  private struck: number[] = [0, 0, 0, 0, 0];
  private held: (number | null)[] = [null, null, null, null, null];

  private phase: EditorSnapshot['phase'] = 'loading';
  private error?: string;
  private playing = false;
  private recording = false;
  private recHeld = new Map<number, { id: number; pos: number; t: number }>();
  private lastPlayed = 0;
  private holding: { id: number; existed: boolean; moved: boolean } | null = null;
  private dirty = false;
  private saving = false;
  private saveTimer = 0;
  private taps: number[] = [];

  private view: EditorView | null = null;
  private els: EditorElements | null = null;
  private observer: ResizeObserver | null = null;
  private clicks: Clicks;
  private raf = 0;
  private lastFrame = 0;
  private needsDraw = true;
  private shift = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture | null = null;
  private momentum = 0;
  private scrubbing = false;
  private barRepeat = 0;
  private releasePad: (() => void) | null = null;
  private shownBar = '';
  private shownTime = '';
  disposed = false;

  private listeners = new Set<() => void>();
  private snapshotCache!: EditorSnapshot;
  /** Asked for when the confirm button is pressed on a selection: the screen shows what can be done with it. */
  onSelectionMenu: () => void = () => {};
  /** Says something in passing (what was copied, why something cannot be done). */
  onNotice: (text: string) => void = () => {};

  constructor(
    readonly song: SongMeta,
    private settings: Settings,
  ) {
    this.clicks = new Clicks(this.engine, (from, to) => this.ticksBetween(from, to));
    this.refresh();
  }

  /* Snapshot ------------------------------------------------------------------------------ */

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  snapshot = () => this.snapshotCache;

  private refresh() {
    const key = chartKey(this.part, this.difficulty);
    const picked = this.doc.notes.filter((n) => this.sel.has(n.id));
    const long = picked.filter((n) => n.len > 0);
    this.snapshotCache = {
      phase: this.phase,
      error: this.error,
      part: this.part,
      difficulty: this.difficulty,
      lanes: this.doc.lanes,
      snap: this.snap,
      zoom: this.zoom,
      zoomSteps: ZOOMS.length,
      tool: this.tool,
      playing: this.playing,
      recording: this.recording,
      rate: this.rate,
      source: this.source,
      sources: ['song', ...(this.stems.includes(PART_STEM[this.part]) ? [PART_STEM[this.part]] : []), ...this.stems.filter((s) => s !== PART_STEM[this.part])],
      clicks: this.clicksOn,
      metronome: this.metronome,
      selected: this.sel.size,
      marking: this.mark !== null && this.sticky,
      ranged: this.mark !== null || this.range !== null,
      selPhrase: picked.length > 0 && picked.every((n) => n.phrase >= 0),
      selLong: long.length > 0,
      selRelease: long.length > 0 && long.every((n) => n.release),
      clipboard: clipboard?.notes.length ?? 0,
      canUndo: this.doc.canUndo,
      canRedo: this.doc.canRedo,
      stats: this.grid ? this.doc.stats(this.grid) : { notes: 0, long: 0, chords: 0, awkward: 0, phrases: 0, peak: 0 },
      edited: this.isEdited(key),
      canRevert: !!this.analysis && this.isEdited(key),
      save: this.saving ? 'saving' : this.dirty ? 'pending' : 'saved',
      hasAnalysis: !!this.analysis,
      grid: this.gridInfo(),
      duration: this.duration,
    };
  }

  private emit() {
    this.refresh();
    this.needsDraw = true;
    for (const l of this.listeners) l();
  }

  private isEdited(key: ChartKey) {
    const doc = this.docs.get(key);
    if (!doc) return key in this.edits.charts;
    if (this.reverted.get(key) === doc.revision) return false;
    return this.own.has(key) || doc.changed;
  }

  private savePrefs() {
    const p: Prefs = { part: this.part, difficulty: this.difficulty, snap: this.snap, zoom: this.zoom, clicks: this.clicksOn, metronome: this.metronome, tool: this.tool };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
      /* storage unavailable */
    }
  }

  private feedback(sfx: Sfx, pulse?: MenuPulse) {
    // The song is sounding: the interface keeps quiet, the controller still answers.
    if (!this.playing) playSfx(sfx);
    if (pulse) menuPulse(pulse);
  }

  /* Loading ------------------------------------------------------------------------------- */

  private loading: Promise<void> | null = null;

  /** Reads the song, its analysis and what was edited before. Asking twice loads once. */
  load(): Promise<void> {
    return (this.loading ??= this.read());
  }

  private async read() {
    try {
      const id = this.song.id;
      const [buffer, analysis, edits, stems] = await Promise.all([
        loadSongBuffer(id),
        analysisManager.analysis(id),
        analysisManager.editsOf(id),
        listStems(id).catch(() => [] as StemName[]),
      ]);
      if (this.disposed) return;
      this.buffer = this.songBuffer = buffer;
      this.analysis = analysis;
      this.edits = edits ? structuredClone(edits) : emptyEdits();
      this.stems = stems;
      this.duration = buffer.duration;
      const grid = resolveGrid(this.edits, analysis, this.duration);
      if (!grid) throw new Error('This song has no beats to chart on yet. Analyze it, or start it from scratch.');
      this.grid = new EditorGrid(grid, this.duration);
      await this.openChart(this.part, this.difficulty);
      this.peaks = computePeaks(buffer);
      this.phase = 'ready';
      this.setupAudio();
      this.view?.resize(this.doc.lanes, !!this.guide);
      this.emit();
    } catch (e) {
      if (this.disposed) return;
      this.phase = 'error';
      this.error = (e as Error).message;
      this.emit();
    }
  }

  private setupAudio() {
    if (!this.buffer || !this.els) return;
    this.engine.stop();
    this.engine.load(this.buffer);
    this.engine.offset = this.settings.offsetMs / 1000;
    this.engine.volume = this.settings.volume;
    this.engine.onEnded = () => {
      if (this.recording) this.stopRecording();
      else if (this.playing) this.pause();
    };
  }

  applySettings(s: Settings) {
    this.settings = s;
    this.engine.offset = s.offsetMs / 1000;
    this.engine.volume = s.volume;
  }

  private async openChart(part: Part, difficulty: Difficulty) {
    const key = chartKey(part, difficulty);
    let doc = this.docs.get(key);
    if (!doc) {
      const stored = this.edits.charts[key];
      const notes = stored ?? (await analysisManager.generated(this.song.id, part, difficulty))?.notes ?? [];
      doc = new ChartDoc(lanesFor(difficulty));
      doc.load(notes, this.grid);
      this.docs.set(key, doc);
      if (stored) this.own.add(key);
    }
    this.doc = doc;
    this.part = part;
    this.difficulty = difficulty;
    this.lane = Math.min(this.lane, doc.lanes - 1);
    this.clearSelection(false);
    this.buildGuide();
    this.viewPos = this.grid.clamp(this.viewPos);
    this.target = null;
  }

  /** Switches to another of the song's charts. The edit position stays where it is in the song. */
  async setChart(part: Part, difficulty: Difficulty) {
    if (this.phase !== 'ready' || this.recording || (part === this.part && difficulty === this.difficulty)) return;
    this.endHold();
    await this.openChart(part, difficulty);
    if (this.disposed) return;
    this.view?.resize(this.doc.lanes, !!this.guide);
    this.clicks.reset();
    this.savePrefs();
    this.emit();
  }

  private buildGuide() {
    const a = this.analysis;
    this.guide = undefined;
    if (!a) return;
    const g = this.grid;
    if (this.part === 'drums') {
      const col = { kick: 0.05, snare: 0.5, hat: 0.95 } as const;
      this.guide = a.drums.map((h) => ({ pos: g.pos(h.t), len: 0, x: col[h.kind], strength: h.strength }));
      return;
    }
    const line = this.part === 'bass' ? a.bass : this.part === 'vocals' ? a.vocals : a.lead;
    if (!line?.length) return;
    const pitches = line.flatMap((n) => n.chord ?? [n.midi]).sort((x, y) => x - y);
    const lo = pitches[Math.floor(pitches.length * 0.02)];
    const hi = Math.max(lo + 1, pitches[Math.floor(pitches.length * 0.98)]);
    const marks: GuideMark[] = [];
    for (const n of line) {
      const pos = g.pos(n.t);
      const len = g.pos(n.t + n.dur) - pos;
      for (const m of n.chord ?? [n.midi]) marks.push({ pos, len, x: Math.min(1, Math.max(0, (m - lo) / (hi - lo))), strength: m === n.midi ? n.strength : n.strength * 0.5 });
    }
    this.guide = marks;
  }

  /* On screen ----------------------------------------------------------------------------- */

  attach(els: EditorElements) {
    this.els = els;
    this.view = new EditorView(els.canvas);
    this.view.resize(this.doc.lanes, !!this.guide);
    this.observer = new ResizeObserver(() => {
      this.view?.resize();
      this.needsDraw = true;
    });
    this.observer.observe(els.canvas);
    els.canvas.addEventListener('pointerdown', this.pointerDown);
    els.canvas.addEventListener('pointermove', this.pointerMove);
    els.canvas.addEventListener('pointerup', this.pointerUp);
    els.canvas.addEventListener('pointercancel', this.pointerUp);
    els.canvas.addEventListener('pointerleave', this.pointerLeave);
    els.canvas.addEventListener('wheel', this.wheel, { passive: false });
    els.overview.addEventListener('pointerdown', this.overviewDown);
    els.overview.addEventListener('pointermove', this.overviewMove);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('keydown', this.modifiers, true);
    window.addEventListener('keyup', this.modifiers, true);
    window.addEventListener('blur', this.blur);
    this.releasePad = pads.capture(this.pad);
    if (this.phase === 'ready') this.setupAudio();
    this.shownBar = this.shownTime = '';
    this.lastFrame = performance.now();
    this.needsDraw = true;
    this.loop();
  }

  detach() {
    cancelAnimationFrame(this.raf);
    if (this.recording) this.stopRecording();
    if (this.playing) this.pause();
    this.endHold();
    this.clicks.stop();
    this.engine.stop();
    this.engine.onEnded = null;
    clearTimeout(this.barRepeat);
    this.releasePad?.();
    this.releasePad = null;
    this.observer?.disconnect();
    const els = this.els;
    if (els) {
      els.canvas.removeEventListener('pointerdown', this.pointerDown);
      els.canvas.removeEventListener('pointermove', this.pointerMove);
      els.canvas.removeEventListener('pointerup', this.pointerUp);
      els.canvas.removeEventListener('pointercancel', this.pointerUp);
      els.canvas.removeEventListener('pointerleave', this.pointerLeave);
      els.canvas.removeEventListener('wheel', this.wheel);
      els.overview.removeEventListener('pointerdown', this.overviewDown);
      els.overview.removeEventListener('pointermove', this.overviewMove);
    }
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('keydown', this.modifiers, true);
    window.removeEventListener('keyup', this.modifiers, true);
    window.removeEventListener('blur', this.blur);
    this.pointers.clear();
    this.gesture = null;
    this.els = null;
    this.view = null;
    void this.flush();
  }

  dispose() {
    if (this.disposed) return;
    if (this.els) this.detach();
    this.disposed = true;
    this.listeners.clear();
  }

  private get pxPerBeat() {
    return ZOOMS[this.zoom] * ((this.view?.layout.u ?? 16) / 16);
  }

  private scene(): Scene {
    const mode = getInputMode();
    return {
      grid: this.grid,
      doc: this.doc,
      viewPos: this.viewPos,
      pxPerBeat: this.pxPerBeat,
      snap: this.snap,
      lane: usesFocus(mode) ? this.lane : null,
      selection: this.sel,
      range: this.range,
      ghost: mode === 'mouse' ? this.ghost : null,
      marquee: this.marquee,
      playing: this.playing,
      recording: this.recording,
      struck: this.struck,
      held: this.held,
      peaks: this.peaks,
      guide: this.guide,
      touch: mode === 'touch',
    };
  }

  private get calm() {
    return document.documentElement.dataset.motion === 'reduced';
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(100, now - this.lastFrame);
    this.lastFrame = now;
    if (this.phase !== 'ready' || !this.view) return;

    if (this.playing) {
      const pos = this.grid.clamp(this.grid.pos(this.engine.time()));
      // Notes that crossed the now line since the last frame light their lanes.
      if (pos > this.lastPlayed) {
        const notes = this.doc.notes;
        for (let i = this.doc.firstFrom(this.lastPlayed + 1e-3); i < notes.length && notes[i].pos <= pos; i++) this.struck[notes[i].lane] = now;
      }
      this.lastPlayed = pos;
      this.viewPos = pos;
      this.needsDraw = true;
    } else {
      // The right stick scrubs: the further it is pushed, the faster the chart runs by.
      const stick = this.stick();
      if (Math.abs(stick) > 0.2) {
        const speed = (-stick * Math.abs(stick) * 22 * dt) / 1000;
        this.viewPos = this.grid.clamp(this.viewPos + speed * Math.max(1, 108 / ZOOMS[this.zoom]));
        this.target = null;
        this.scrubbing = true;
        this.afterMove(false);
      } else if (this.scrubbing) {
        this.scrubbing = false;
        this.goto(this.grid.snap(this.viewPos, this.snap));
      }
      if (this.momentum && !this.gesture) {
        this.viewPos = this.grid.clamp(this.viewPos + this.momentum * dt);
        this.momentum *= Math.exp(-dt / 260);
        if (Math.abs(this.momentum) < 0.0006) this.momentum = 0;
        this.needsDraw = true;
      }
      if (this.target !== null) {
        const d = this.target - this.viewPos;
        if (Math.abs(d) * this.pxPerBeat < 0.6 || this.calm) {
          this.viewPos = this.target;
          this.target = null;
        } else this.viewPos += d * (1 - Math.exp(-dt / 42));
        this.needsDraw = true;
      }
    }
    // A flash on the now line fades over a few frames.
    if (this.struck.some((t) => now - t < 240)) this.needsDraw = true;

    if (this.needsDraw) {
      this.needsDraw = false;
      const scene = this.scene();
      this.view.draw(scene);
      if (this.els) drawOverview(this.els.overview, scene, this.view.layout.h / this.pxPerBeat);
      this.readouts();
    }
  };

  private readouts() {
    const els = this.els;
    if (!els) return;
    const pos = this.playing ? this.viewPos : (this.target ?? this.viewPos);
    const bb = this.grid.barBeat(pos);
    const bar = bb.bar ? `${bb.bar}.${bb.beat}` : `0.${bb.beat}`;
    if (bar !== this.shownBar) els.bar.textContent = this.shownBar = bar;
    const time = fmtTime(this.grid.time(pos));
    if (time !== this.shownTime) els.time.textContent = this.shownTime = time;
  }

  /** The right stick's push up or down on the controller in use, -1..1. */
  private stick(): number {
    if (getInputMode() !== 'pad' || document.querySelector('[data-modal]')) return 0;
    const gp = pads.gamepad(pads.snapshot().lastPad);
    return gp?.axes[3] ?? 0;
  }

  /* The edit position --------------------------------------------------------------------- */

  /** The snap line the now line is on (or heading for). */
  get cursor() {
    return this.grid.snap(this.target ?? this.viewPos, this.snap);
  }

  private goto(pos: number, ease = true) {
    const to = this.grid.clamp(pos);
    this.momentum = 0;
    if (!ease || this.calm) {
      this.viewPos = to;
      this.target = null;
    } else this.target = to;
    this.needsDraw = true;
  }

  /** Keeps what depends on the edit position in step with it. */
  private afterMove(announce = true) {
    if (this.holding) this.stretchHeld();
    if (this.mark !== null) this.updateRange();
    this.needsDraw = true;
    if (announce) this.announce();
  }

  private announce() {
    const els = this.els;
    if (!els) return;
    const pos = this.cursor;
    const bb = this.grid.barBeat(pos);
    const note = this.doc.covering(pos, this.lane);
    els.status.textContent = `Bar ${bb.bar}, beat ${bb.beat}. Lane ${this.lane + 1}: ${note ? (note.len > 0 ? 'long note' : 'note') : 'empty'}.`;
  }

  /** One snap step later or earlier. With `extend`, the stretch between where this started and the cursor is marked. */
  moveTime(dir: -1 | 1, extend = false) {
    if (this.phase !== 'ready' || this.recording) return;
    if (this.playing) return this.seek(this.grid.clamp(this.viewPos + dir));
    const from = this.cursor;
    const to = this.grid.step(from, this.snap, dir);
    if (extend && this.mark === null) {
      this.mark = from;
      this.sticky = false;
    } else if (!extend && this.mark !== null && !this.sticky && !this.holding) this.clearSelection(false);
    if (to === from) return;
    this.goto(to);
    this.afterMove();
    this.feedback('move', 'move');
    this.emitIfSelection();
  }

  moveLane(dir: -1 | 1) {
    if (this.phase !== 'ready' || this.recording) return;
    const next = Math.min(this.doc.lanes - 1, Math.max(0, this.lane + dir));
    if (next === this.lane) return;
    this.lane = next;
    this.needsDraw = true;
    this.announce();
    this.feedback('move', 'move');
  }

  /** To the next bar line, or the one before. */
  moveBar(dir: -1 | 1) {
    if (this.phase !== 'ready' || this.recording) return;
    const from = this.playing ? this.viewPos : this.cursor;
    const to = this.grid.barStep(from, dir);
    if (this.playing) return this.seek(to);
    if (to === from) return;
    if (this.mark !== null && !this.sticky && !this.shift) this.clearSelection(false);
    this.goto(to);
    this.afterMove();
    this.feedback('move', dir < 0 ? 'tab-left' : 'tab-right');
    this.emitIfSelection();
  }

  toStart() {
    this.jump(this.grid.start);
  }

  toEnd() {
    this.jump(this.grid.end);
  }

  private jump(pos: number) {
    if (this.phase !== 'ready' || this.recording) return;
    if (this.playing) return this.seek(pos);
    this.goto(this.grid.snap(pos, this.snap));
    this.afterMove();
    this.emitIfSelection();
  }

  /** Jumps playback (or the edit position) to a place in the song. */
  private seek(pos: number) {
    const to = this.grid.clamp(pos);
    if (this.playing) {
      const t = Math.min(Math.max(0, this.duration - 0.05), Math.max(0, this.grid.time(to)));
      void this.engine.seek(t).then(() => this.clicks.reset());
      this.viewPos = this.lastPlayed = to;
    } else this.goto(to, false);
    this.needsDraw = true;
  }

  private emitIfSelection() {
    if (this.mark !== null || this.sel.size) this.emit();
  }

  setSnap(snap: Snap) {
    if (snap === this.snap) return;
    this.snap = snap;
    if (!this.playing && this.phase === 'ready') this.goto(this.grid.snap(this.viewPos, snap));
    this.savePrefs();
    this.emit();
  }

  /** A finer or coarser grid. */
  stepSnap(d: -1 | 1) {
    const i = SNAPS.indexOf(this.snap) + d;
    if (i < 0 || i >= SNAPS.length) return;
    this.feedback('tab', d < 0 ? 'tab-left' : 'tab-right');
    this.setSnap(SNAPS[i]);
  }

  zoomBy(d: -1 | 1) {
    const z = Math.min(ZOOMS.length - 1, Math.max(0, this.zoom + d));
    if (z === this.zoom) return;
    this.zoom = z;
    this.savePrefs();
    this.emit();
  }

  setTool(tool: Tool) {
    if (tool === this.tool) return;
    this.tool = tool;
    this.ghost = null;
    this.savePrefs();
    this.emit();
  }

  /* Notes --------------------------------------------------------------------------------- */

  /** A change was made to the notes: forget selected notes that are gone, save soon, redraw. */
  private changed() {
    if (this.sel.size) {
      const alive = new Set(this.doc.notes.map((n) => n.id));
      for (const id of this.sel) if (!alive.has(id)) this.sel.delete(id);
    }
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flush(), 900);
    if (this.playing) this.clicks.reset();
    this.emit();
  }

  /**
   * The confirm button goes down on the track: a note is set down at the cursor, or the one that is
   * there is picked up. While it stays down, moving along the lane stretches the note; let go without
   * moving and a note that was already there is removed. On a selection it asks what to do with it.
   */
  noteDown() {
    if (this.phase !== 'ready' || this.recording || this.holding) return;
    if (this.sel.size || this.mark !== null) return this.onSelectionMenu();
    const pos = this.playing ? this.grid.snap(this.viewPos, this.snap) : this.cursor;
    this.doc.begin();
    const there = this.doc.at(pos, this.lane);
    if (there) this.holding = { id: there.id, existed: true, moved: false };
    else {
      const n = this.doc.add(pos, this.lane);
      if (!n) return this.doc.commit();
      this.holding = { id: n.id, existed: false, moved: false };
      this.struck[this.lane] = performance.now();
      this.feedback('toggle-on', 'select');
      this.changed();
    }
  }

  noteUp() {
    const h = this.holding;
    if (!h) return;
    this.holding = null;
    if (h.existed && !h.moved) {
      this.doc.remove([h.id]);
      this.feedback('toggle-off', 'back');
    }
    this.doc.commit();
    this.changed();
    this.announce();
  }

  private endHold() {
    if (!this.holding) return;
    this.holding = null;
    this.doc.commit();
  }

  private stretchHeld() {
    const h = this.holding;
    const n = h && this.doc.byId(h.id);
    if (!h || !n) return;
    h.moved = true;
    if (this.doc.setLength(n.id, Math.max(0, this.cursor - n.pos))) this.changed();
  }

  /** Sets a note down in a lane at the cursor, or takes the one there away (the number keys). */
  toggleLane(lane: number) {
    if (this.phase !== 'ready' || this.recording || lane < 0 || lane >= this.doc.lanes) return;
    this.lane = lane;
    const pos = this.playing ? this.grid.snap(this.viewPos, this.snap) : this.cursor;
    const added = this.doc.toggle(pos, lane);
    if (added) this.struck[lane] = performance.now();
    this.feedback(added ? 'toggle-on' : 'toggle-off', added ? 'select' : 'back');
    this.changed();
  }

  /** Removes the selection, or without one the note under the cursor. */
  remove() {
    if (this.phase !== 'ready' || this.recording) return;
    const ids = this.sel.size ? [...this.sel] : [this.doc.covering(this.cursor, this.lane)?.id].filter((x): x is number => x !== undefined);
    if (!ids.length || !this.doc.remove(ids)) return;
    this.clearSelection(false);
    this.feedback('toggle-off', 'back');
    this.changed();
  }

  undo() {
    if (this.recording) return;
    this.endHold();
    if (!this.doc.undo()) return;
    this.feedback('back', 'back');
    this.changed();
  }

  redo() {
    if (this.recording) return;
    this.endHold();
    if (!this.doc.redo()) return;
    this.feedback('select', 'select');
    this.changed();
  }

  /* Selection ----------------------------------------------------------------------------- */

  /** Starts marking a stretch at the cursor (every move then extends it), or ends the marking. */
  toggleMark() {
    if (this.phase !== 'ready' || this.recording) return;
    if (this.mark !== null || this.sel.size) {
      this.clearSelection();
      this.feedback('back', 'back');
      return;
    }
    this.mark = this.cursor;
    this.sticky = true;
    this.updateRange();
    this.feedback('select', 'select');
    this.emit();
  }

  private updateRange() {
    if (this.mark === null) return;
    const c = this.cursor;
    const a = Math.min(this.mark, c);
    const b = Math.max(this.mark, c);
    this.range = [a, b];
    this.sel = new Set(this.doc.idsBetween(a, b));
  }

  /** Whether anything is selected or being marked. */
  get hasSelection() {
    return this.sel.size > 0 || this.mark !== null || this.range !== null;
  }

  clearSelection(emit = true) {
    this.sel = new Set();
    this.range = null;
    this.mark = null;
    this.sticky = false;
    this.marquee = null;
    if (emit) this.emit();
  }

  selectAll() {
    if (this.phase !== 'ready') return;
    this.sel = new Set(this.doc.notes.map((n) => n.id));
    this.range = null;
    this.mark = null;
    this.emit();
  }

  /** The stretch the selection stands for: the marked one, or from its first note to whole beats after its last. */
  private span(): { from: number; length: number } | null {
    if (this.range) return this.range[1] > this.range[0] ? { from: this.range[0], length: this.range[1] - this.range[0] } : null;
    const picked = this.doc.notes.filter((n) => this.sel.has(n.id));
    if (!picked.length) return null;
    const from = Math.floor(picked[0].pos + 1e-4);
    const end = picked.reduce((m, n) => Math.max(m, n.pos + n.len), from);
    return { from, length: Math.max(1, Math.ceil(end - from + 1e-4)) };
  }

  copy(): boolean {
    const span = this.span();
    const clip = span && this.doc.copy(this.sel, span.from, span.length);
    if (!clip) return false;
    clipboard = clip;
    this.onNotice(`Copied ${clip.notes.length} ${clip.notes.length === 1 ? 'note' : 'notes'}. Paste sets them down at the cursor.`);
    this.emit();
    return true;
  }

  cut() {
    if (!this.copy()) return;
    this.doc.remove(this.sel);
    this.clearSelection(false);
    this.changed();
  }

  /** Sets the copied notes down from the cursor on, and moves the cursor to their end. */
  paste() {
    if (this.phase !== 'ready' || this.recording || !clipboard) return;
    this.pasteAt(clipboard, this.cursor);
  }

  private pasteAt(clip: Clip, at: number) {
    const ids = this.doc.paste(clip, at, this.grid.end);
    if (!ids.length) return;
    this.sel = new Set(ids);
    this.range = [at, Math.min(this.grid.end, at + clip.length)];
    this.mark = null;
    this.sticky = false;
    if (!this.playing) this.goto(this.grid.snap(at + clip.length, this.snap));
    this.feedback('toggle-on', 'select');
    this.changed();
  }

  /** Sets the selection down again right after itself: the quick way to repeat a bar. */
  repeat() {
    const span = this.span();
    const clip = span && this.doc.copy(this.sel, span.from, span.length);
    if (!span || !clip) return;
    this.pasteAt(clip, span.from + span.length);
  }

  /** Makes the selection (or the note under the cursor) an overdrive phrase, or takes it out of one. */
  togglePhrase() {
    const ids = this.targetIds();
    if (!ids.length) return;
    if (this.doc.setPhrase(ids, !this.doc.allInPhrase(ids))) {
      this.feedback('select', 'select');
      this.changed();
    }
  }

  /** Long notes in the selection (or under the cursor) must be let go on time, or need not be. */
  toggleRelease() {
    const ids = this.targetIds();
    const long = this.doc.notes.filter((n) => ids.includes(n.id) && n.len > 0);
    if (!long.length) return this.onNotice('Only a long note can ask to be let go on time. Stretch a note first.');
    if (this.doc.setRelease(ids, !long.every((n) => n.release))) {
      this.feedback('select', 'select');
      this.changed();
    }
  }

  mirror() {
    if (this.doc.mirror(this.sel)) {
      this.feedback('select', 'select');
      this.changed();
    }
  }

  /** Moves the selection by snap steps and lanes. */
  nudge(steps: number, lanes: number) {
    if (!this.sel.size) return;
    const d = steps / this.snap;
    if (!this.doc.move(this.sel, d, lanes, this.grid.start, this.grid.end)) return;
    if (this.range) this.range = [this.range[0] + d, this.range[1] + d];
    this.feedback('move', 'move');
    this.changed();
  }

  private targetIds(): number[] {
    if (this.sel.size) return [...this.sel];
    const n = this.doc.covering(this.cursor, this.lane);
    return n ? [n.id] : [];
  }

  /* Playback ------------------------------------------------------------------------------ */

  private ticksBetween(from: number, to: number): Tick[] {
    const out: Tick[] = [];
    const g = this.grid;
    if (this.clicksOn && !this.recording) {
      const notes = this.doc.notes;
      const a = g.pos(from);
      const b = g.pos(to);
      let last = -1;
      for (let i = this.doc.firstFrom(a - 0.01); i < notes.length && notes[i].pos <= b + 0.01; i++) {
        const t = g.time(notes[i].pos);
        if (t > from && t <= to && t !== last) out.push({ t: (last = t), kind: 'note' });
      }
    }
    // The metronome also counts a recording in, whatever the setting.
    if (this.metronome || (this.recording && this.engine.time() < this.recCountIn)) {
      for (let b = Math.max(0, Math.floor(g.pos(from))); b < g.beats.length && g.beats[b] <= to; b++) {
        if (g.beats[b] > from) out.push({ t: g.beats[b], kind: g.isBar(b) ? 'bar' : 'beat' });
      }
    }
    return out;
  }

  togglePlay() {
    if (this.recording) return this.stopRecording();
    if (this.playing) this.pause();
    else void this.play();
  }

  async play(from = this.viewPos) {
    if (this.phase !== 'ready' || !this.buffer || this.playing) return;
    this.endHold();
    this.target = null;
    this.momentum = 0;
    // From the very end there is nothing to play: start over.
    const pos = from >= this.grid.end - 0.05 ? this.grid.start : from;
    const t = Math.min(Math.max(0, this.duration - 0.05), Math.max(0, this.grid.time(pos)));
    this.viewPos = this.lastPlayed = this.grid.pos(t);
    this.playing = true;
    this.emit();
    await this.engine.play(t, 0.06, this.rate);
    if (!this.playing) return this.engine.pause();
    this.clicks.start();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.engine.pause();
    this.clicks.stop();
    this.goto(this.grid.snap(this.viewPos, this.snap));
    this.emit();
  }

  setRate(rate: number) {
    if (rate === this.rate) return;
    this.rate = rate;
    if (this.playing) void this.engine.play(this.engine.time(), 0.03, rate).then(() => this.clicks.reset());
    this.emit();
  }

  setClicks(on: boolean) {
    this.clicksOn = on;
    this.clicks.reset();
    this.savePrefs();
    this.emit();
  }

  setMetronome(on: boolean) {
    this.metronome = on;
    this.clicks.reset();
    this.savePrefs();
    this.emit();
  }

  /** Plays the whole song, or one of its separated stems on its own (to hear a part clearly). */
  async setSource(source: AudioSource) {
    if (source === this.source || this.recording) return;
    const was = this.playing;
    if (was) this.pause();
    try {
      let buf = this.songBuffer;
      if (source !== 'song') {
        const blob = await getStem(this.song.id, source);
        if (!blob) throw new Error('This stem is no longer stored. Analyze the song again to get it back.');
        buf = await this.engine.decode(await blob.arrayBuffer());
      }
      if (!buf || this.disposed) return;
      this.buffer = buf;
      this.source = source;
      this.peaks = computePeaks(buf);
      this.setupAudio();
      this.emit();
      if (was) void this.play();
    } catch (e) {
      this.onNotice((e as Error).message);
    }
  }

  /* Recording ----------------------------------------------------------------------------- */

  /** Song time until which the metronome counts a recording in. */
  private recCountIn = 0;

  /**
   * Plays the song from a bar before the cursor and turns every lane press into a note on the grid:
   * the keys, buttons and lanes of the game itself. A press that is held becomes a long note.
   */
  async startRecording() {
    if (this.phase !== 'ready' || this.recording || !this.buffer) return;
    if (this.playing) this.pause();
    this.endHold();
    this.clearSelection(false);
    const at = this.cursor;
    const from = this.grid.clamp(Math.max(this.grid.start, at - this.grid.barLength(at)));
    this.recCountIn = this.grid.time(at);
    this.recording = true;
    this.recHeld.clear();
    this.doc.begin();
    this.target = null;
    const t = Math.min(Math.max(0, this.duration - 0.05), Math.max(0, this.grid.time(from)));
    this.viewPos = this.lastPlayed = this.grid.pos(t);
    this.playing = true;
    this.emit();
    await this.engine.play(t, 0.06, this.rate);
    if (!this.recording) return this.engine.pause();
    this.clicks.start();
  }

  stopRecording() {
    if (!this.recording) return;
    const now = performance.now();
    for (const lane of [...this.recHeld.keys()]) this.recordRelease(lane, now);
    this.recording = false;
    this.playing = false;
    this.engine.pause();
    this.clicks.stop();
    this.doc.commit();
    this.held.fill(null);
    this.goto(this.grid.snap(this.viewPos, this.snap));
    playSfx('select');
    this.changed();
  }

  private recordPress(lane: number, stamp: number) {
    if (lane < 0 || lane >= this.doc.lanes || this.recHeld.has(lane)) return;
    const t = this.engine.time(stamp);
    const pos = this.grid.snap(this.grid.pos(t), this.snap);
    const note = this.doc.at(pos, lane) ?? this.doc.add(pos, lane);
    this.struck[lane] = performance.now();
    if (!note) return;
    this.recHeld.set(lane, { id: note.id, pos, t });
    this.held[lane] = note.id;
    this.needsDraw = true;
  }

  private recordRelease(lane: number, stamp: number) {
    const h = this.recHeld.get(lane);
    if (!h) return;
    this.recHeld.delete(lane);
    this.held[lane] = null;
    const t = this.engine.time(stamp);
    const len = this.grid.snap(this.grid.pos(t), this.snap) - h.pos;
    // A press held for a good part of a beat was meant as a long note.
    if (t - h.t > 0.3 && len >= 0.5) this.doc.setLength(h.id, len);
    this.needsDraw = true;
  }

  /* Whole charts -------------------------------------------------------------------------- */

  clearChart() {
    if (this.doc.replace([], this.grid)) this.changed();
    this.clearSelection();
  }

  /** Puts the chart back to the one the game writes from its analysis. */
  async revert() {
    const made = await analysisManager.generated(this.song.id, this.part, this.difficulty);
    if (!made || this.disposed) return;
    this.doc.replace(made.notes, this.grid);
    this.reverted.set(chartKey(this.part, this.difficulty), this.doc.revision);
    this.clearSelection(false);
    this.changed();
  }

  /** How many notes each of the song's charts has, and which were edited by hand. */
  async summaries(): Promise<Record<ChartKey, { notes: number; edited: boolean }>> {
    const out = {} as Record<ChartKey, { notes: number; edited: boolean }>;
    for (const part of ['lead', 'bass', 'drums', 'vocals'] as Part[]) {
      for (const d of ['easy', 'medium', 'hard', 'expert'] as Difficulty[]) {
        const key = chartKey(part, d);
        const doc = this.docs.get(key);
        const notes = doc ? doc.notes.length : (this.edits.charts[key]?.length ?? (await analysisManager.generated(this.song.id, part, d))?.notes.length ?? 0);
        out[key] = { notes, edited: this.isEdited(key) };
      }
    }
    return out;
  }

  /** Replaces this chart with a copy of another of the song's charts. */
  async copyFrom(part: Part, difficulty: Difficulty) {
    const key = chartKey(part, difficulty);
    const doc = this.docs.get(key);
    const notes: readonly Note[] = doc ? doc.toNotes(this.grid) : (this.edits.charts[key] ?? (await analysisManager.generated(this.song.id, part, difficulty))?.notes ?? []);
    if (this.disposed) return;
    this.doc.replace(fitLanes(notes, this.doc.lanes), this.grid);
    this.clearSelection(false);
    this.changed();
  }

  /** The chart as it stands, to play: from the bar the cursor is in, or from the top. */
  testChart(fromStart = false): { chart: Chart; startAt: number } {
    const g = this.grid;
    const notes = cleanNotes(this.doc.toNotes(g), this.doc.lanes, g.secondsPerBeat, this.duration);
    const bar = g.barStart(this.cursor);
    // Close to the top there is no point in skipping the little that comes before.
    const startAt = fromStart || g.time(bar) < 6 ? 0 : g.time(bar);
    const chart = chartFromNotes(notes.filter((n) => n.t >= startAt - 1e-3), this.part, this.difficulty, g, this.duration);
    return { chart, startAt };
  }

  /* The grid ------------------------------------------------------------------------------ */

  private gridInfo(): GridInfo {
    const spec = this.edits.grid;
    const canFollow = !!this.analysis || !!this.edits.tracked;
    if (spec?.kind === 'fixed') return { mode: 'fixed', bpm: spec.bpm, offset: spec.offset, beatsPerBar: spec.beatsPerBar, canFollow };
    const g = this.grid;
    if (!g) return { mode: 'song', bpm: 120, offset: 0, beatsPerBar: 4, canFollow };
    const first = g.downbeats[0] ?? 0;
    return { mode: 'song', bpm: Math.round(g.bpm * 100) / 100, offset: g.beats[first] ?? 0, beatsPerBar: g.barLength(first), canFollow };
  }

  /**
   * Changes the grid. Notes stay on their beats: with a new tempo or a first beat nudged a little
   * they move with the grid, and with the first beat moved by whole beats only the bar lines move.
   */
  private applyGrid(spec: GridSpec | undefined) {
    const old = this.grid;
    const edits: SongEdits = { ...this.edits };
    if (spec) edits.grid = spec;
    else delete edits.grid;
    const built = resolveGrid(edits, this.analysis, this.duration);
    if (!built) return;
    const next = new EditorGrid(built, this.duration);
    // The beat that was at the old grid's first bar line keeps its notes.
    const anchor = Math.min(this.duration, Math.max(0, old.beats[old.downbeats[0] ?? 0] ?? 0));
    const shift = Math.round(next.pos(anchor)) - Math.round(old.pos(anchor));
    // Charts that are not open are stored in seconds: carry them over beat by beat.
    const charts = { ...edits.charts };
    for (const [key, notes] of Object.entries(charts) as [ChartKey, Note[]][]) {
      if (this.docs.has(key)) continue;
      charts[key] = notes.map((n) => {
        const pos = old.pos(n.t) + shift;
        const t = Math.max(0, next.time(pos));
        return { ...n, t, dur: n.dur > 0 ? Math.max(0, next.time(old.pos(n.t + n.dur) + shift) - t) : 0 };
      });
    }
    edits.charts = charts;
    this.edits = edits;
    this.grid = next;
    for (const [key, doc] of this.docs) {
      if (shift) doc.rebase(shift);
      // Their times changed with the grid, so the edited ones are written again.
      if (key in charts) doc.touch();
    }
    this.viewPos = next.clamp(this.viewPos + shift);
    this.target = null;
    if (this.range) this.range = [this.range[0] + shift, this.range[1] + shift];
    if (this.mark !== null) this.mark += shift;
    this.buildGuide();
    this.changed();
  }

  /** The steady tempo the grid has now, or the one closest to the beats it follows. */
  private fixedNow() {
    const spec = this.edits.grid;
    return spec?.kind === 'fixed' ? spec : fitFixed(this.grid.beats, this.grid.downbeats);
  }

  setFixed(patch: Partial<{ bpm: number; offset: number; beatsPerBar: number }>) {
    if (this.phase !== 'ready') return;
    const now = this.fixedNow();
    const bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round((patch.bpm ?? now.bpm) * 100) / 100));
    const beatsPerBar = Math.min(12, Math.max(1, Math.round(patch.beatsPerBar ?? now.beatsPerBar)));
    const offset = Math.round((patch.offset ?? now.offset) * 1000) / 1000;
    this.applyGrid({ kind: 'fixed', bpm, offset: Math.min(this.duration, Math.max(0, offset)), beatsPerBar });
  }

  /** Lets the grid follow the beats heard in the song again. */
  followSong() {
    if (this.analysis) this.applyGrid(undefined);
    else if (this.edits.tracked) this.applyGrid({ kind: 'beats', ...this.edits.tracked });
  }

  /** Listens for the song's beats again and takes the tempo found. */
  async detect(): Promise<boolean> {
    if (!this.songBuffer) return false;
    const found = await detectGrid(this.songBuffer);
    if (this.disposed) return false;
    if (found.tracked) this.edits = { ...this.edits, tracked: found.tracked };
    this.applyGrid(found.grid);
    return !!found.tracked;
  }

  /** The bar line moves to the cursor: this is where a bar starts. */
  firstBeatHere() {
    this.setFixed({ offset: this.grid.time(this.playing ? this.viewPos : this.cursor) });
  }

  /**
   * A tap on the beat. From four taps on, their pace is the tempo; while the song plays, where they
   * fell is the beat as well. Returns how many taps are being counted.
   */
  tap(stamp = performance.now()): number {
    const t = this.playing ? this.engine.time(stamp) * 1000 : stamp;
    if (this.taps.length && (t - this.taps[this.taps.length - 1] > 2200 || t < this.taps[this.taps.length - 1])) this.taps = [];
    this.taps.push(t);
    if (this.taps.length > 12) this.taps.shift();
    const n = this.taps.length;
    if (n >= 4) {
      const ms = (this.taps[n - 1] - this.taps[0]) / (n - 1);
      const bpm = Math.round((60000 / ms) * 2) / 2;
      if (bpm >= MIN_BPM && bpm <= MAX_BPM) {
        const spb = 60 / bpm;
        // Where the taps say the beat is: the average of each tap carried back to the first.
        const phase = this.taps.reduce((s, x, i) => s + (x / 1000 - i * spb), 0) / n;
        this.setFixed(this.playing ? { bpm, offset: phase - Math.floor(phase / spb) * spb } : { bpm });
      }
    }
    return n;
  }

  /* Saving -------------------------------------------------------------------------------- */

  /** Writes what changed to the song. The editor saves as it goes; this does it now. */
  async flush() {
    clearTimeout(this.saveTimer);
    if (!this.dirty || this.phase !== 'ready') return;
    this.dirty = false;
    this.saving = true;
    if (!this.disposed) this.emit();
    const charts = { ...this.edits.charts };
    for (const [key, doc] of this.docs) {
      // A chart is the player's own if it was when it was opened or differs from how it was opened;
      // one put back to the game's, or changed and changed back, is the game's again.
      if (this.isEdited(key)) charts[key] = cleanNotes(doc.toNotes(this.grid), doc.lanes, this.grid.secondsPerBeat, this.duration);
      else delete charts[key];
    }
    this.edits = { ...this.edits, charts, duration: this.duration, updatedAt: Date.now() };
    const anything = !!this.edits.grid || Object.keys(charts).length > 0;
    await analysisManager.saveEdits(this.song.id, anything ? structuredClone(this.edits) : null);
    this.saving = false;
    if (!this.disposed) this.emit();
  }

  /* Keys ---------------------------------------------------------------------------------- */

  private live() {
    return this.phase === 'ready' && !!this.els && !document.querySelector('[data-modal]');
  }

  private onTrack() {
    const a = document.activeElement;
    return !a || a === document.body || a === this.els?.track;
  }

  private laneKeys() {
    return this.doc.lanes === 5 ? this.settings.keys5 : this.settings.keys4;
  }

  /** Whether Shift is down, known before anything else hears the key (the arrow keys reach the track as directions). */
  private modifiers = (e: KeyboardEvent) => {
    this.shift = e.shiftKey;
  };

  private keyDown = (e: KeyboardEvent) => {
    if (!this.live() || isTextField(e.target)) return;
    if (this.recording) {
      // Only the lanes and the way out: everything else would get in the way of playing.
      const lane = this.laneKeys().indexOf(e.code);
      if (lane >= 0) {
        if (!e.repeat) this.recordPress(lane, e.timeStamp);
      } else if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') {
        if (!e.repeat) this.stopRecording();
      } else return;
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (e.altKey) return;
    let done = true;
    if (mod) {
      const k = e.key.toLowerCase();
      if (k === 'z') e.shiftKey ? this.redo() : this.undo();
      else if (k === 'y') this.redo();
      else if (k === 'c') this.copy();
      else if (k === 'x') this.cut();
      else if (k === 'v') this.paste();
      else if (k === 'a') this.selectAll();
      else if (k === 'd') this.repeat();
      else if (k === 's') void this.flush();
      else done = false;
    } else if (e.code === 'PageUp') this.moveBar(1);
    else if (e.code === 'PageDown') this.moveBar(-1);
    else if (e.code === 'Home') this.toStart();
    else if (e.code === 'End') this.toEnd();
    else if (e.code === 'Delete' || e.code === 'Backspace') this.remove();
    else if (/^Digit[1-5]$/.test(e.code) || /^Numpad[1-5]$/.test(e.code)) {
      if (!e.repeat) this.toggleLane(Number(e.code.slice(-1)) - 1);
    } else if (e.code === 'Equal' || e.code === 'NumpadAdd') this.zoomBy(1);
    else if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.zoomBy(-1);
    else if (e.code === 'Enter' && this.onTrack()) {
      if (!e.repeat) this.noteDown();
    } else if (this.sel.size && e.shiftKey && e.code.startsWith('Arrow') && this.mark === null) {
      // Shift and the arrows move what the mouse selected.
      if (e.code === 'ArrowUp') this.nudge(1, 0);
      else if (e.code === 'ArrowDown') this.nudge(-1, 0);
      else this.nudge(0, e.code === 'ArrowLeft' ? -1 : 1);
    } else done = false;
    if (done) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };

  private keyUp = (e: KeyboardEvent) => {
    if (this.recording) {
      const lane = this.laneKeys().indexOf(e.code);
      if (lane >= 0) this.recordRelease(lane, e.timeStamp);
    } else if (e.code === 'Enter') this.noteUp();
  };

  private blur = () => {
    this.shift = false;
    this.noteUp();
    if (this.recording) for (const lane of [...this.recHeld.keys()]) this.recordRelease(lane, performance.now());
  };

  /** A direction from the arrow keys or a controller, offered to the track before focus would move. */
  direction(dir: 'up' | 'down' | 'left' | 'right') {
    if (dir === 'up') this.moveTime(1, this.shift);
    else if (dir === 'down') this.moveTime(-1, this.shift);
    else this.moveLane(dir === 'left' ? -1 : 1);
  }

  /* Controller ---------------------------------------------------------------------------- */

  private pad = (e: PadEvent): boolean => {
    if (!this.live()) return false;
    if (this.recording) {
      // Every button is a lane or nothing; Options stops, as it pauses a song.
      if (e.input === PAUSE_INPUT) {
        if (e.down) this.stopRecording();
        return true;
      }
      const lane = (this.doc.lanes === 5 ? this.settings.pad5 : this.settings.pad4).indexOf(e.input);
      if (lane >= 0) {
        if (e.down) this.recordPress(lane, e.t);
        else this.recordRelease(lane, e.t);
      }
      return true;
    }
    const style = resolveStyle(this.settings.glyphs, pads.snapshot().family);
    if (e.input === confirmInput(style)) {
      if (!this.onTrack()) return false;
      if (e.down) this.noteDown();
      else this.noteUp();
      return true;
    }
    if (e.input === 'b6' || e.input === 'b7') {
      // The triggers step a bar at a time, and keep stepping while held.
      clearTimeout(this.barRepeat);
      if (!e.down) return true;
      const dir = e.input === 'b6' ? -1 : 1;
      this.moveBar(dir);
      const again = (delay: number) => {
        this.barRepeat = window.setTimeout(() => {
          this.moveBar(dir);
          again(130);
        }, delay);
      };
      again(360);
      return true;
    }
    if (e.input === 'b8') {
      if (e.down) this.undo();
      return true;
    }
    if (e.input === 'a2-' || e.input === 'a2+') {
      if (e.down) this.zoomBy(e.input === 'a2+' ? 1 : -1);
      return true;
    }
    // The right stick's up and down are read as a push, every frame.
    if (e.input === 'a3-' || e.input === 'a3+') return true;
    return false;
  };

  /* Pointer ------------------------------------------------------------------------------- */

  private at(e: PointerEvent | WheelEvent) {
    const r = this.els!.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private pointerDown = (e: PointerEvent) => {
    if (this.phase !== 'ready' || !this.view) return;
    const { x, y } = this.at(e);
    const scene = this.scene();
    const hit = this.view.hit(x, y, scene);
    if (this.recording) {
      if (hit.lane >= 0) {
        hold(this.els!.canvas, e.pointerId);
        this.pointers.set(e.pointerId, { x: hit.lane, y });
        this.recordPress(hit.lane, e.timeStamp);
        if (e.pointerType !== 'mouse' && this.settings.touchHaptics) navigator.vibrate?.(8);
      }
      return;
    }
    hold(this.els!.canvas, e.pointerId);
    this.pointers.set(e.pointerId, { x, y });
    this.momentum = 0;
    this.target = null;
    if (this.pointers.size === 2) {
      // Two fingers: pinch to zoom. Whatever one finger had begun is put back.
      this.cancelGesture();
      const [a, b] = [...this.pointers.values()];
      this.gesture = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, px: ZOOMS[this.zoom] };
      return;
    }
    if (this.pointers.size > 2) return;
    const touch = e.pointerType !== 'mouse';
    // The right mouse button takes a note away.
    if (e.button === 2) {
      if (hit.note && this.doc.remove([hit.note.id])) this.changed();
      return;
    }
    if (hit.zone !== 'deck') {
      this.gesture = { kind: 'pan', y, pos: this.viewPos, lastY: y, lastT: e.timeStamp, v: 0 };
      return;
    }
    if (this.tool === 'select' || e.shiftKey) {
      if (hit.note) {
        const was = this.sel.has(hit.note.id);
        if (!was) {
          if (!e.shiftKey) this.sel = new Set();
          this.sel.add(hit.note.id);
          this.range = null;
          this.mark = null;
          this.emit();
        }
        this.doc.begin();
        this.gesture = { kind: 'move', pos: this.grid.snap(hit.pos, this.snap), lane: hit.lane, dPos: 0, dLane: 0, moved: false, id: hit.note.id, wasSelected: was && e.shiftKey };
      } else this.gesture = { kind: 'marquee', x, y, add: e.shiftKey ? new Set(this.sel) : new Set() };
      return;
    }
    const pos = this.grid.snap(hit.pos, this.snap);
    if (touch) {
      // A finger may be about to scroll: a tap sets a note down, a press that stays put stretches one.
      const timer = window.setTimeout(() => {
        const g = this.gesture;
        if (g?.kind !== 'wait') return;
        if (this.settings.touchHaptics) navigator.vibrate?.(12);
        this.startDraw(g.pos, g.lane, g.noteId, g.y);
      }, 300);
      this.gesture = { kind: 'wait', x, y, timer, lane: hit.lane, pos, noteId: hit.note?.id };
    } else this.startDraw(pos, hit.lane, hit.note?.id, y);
  };

  /** Picks up the note under the pointer, or sets a new one down, ready to be stretched. */
  private startDraw(pos: number, lane: number, noteId: number | undefined, y: number) {
    if (this.sel.size) this.clearSelection(false);
    this.doc.begin();
    if (noteId !== undefined && this.doc.byId(noteId)) {
      this.gesture = { kind: 'draw', id: noteId, existed: true, stretched: false, y };
      return;
    }
    const n = this.doc.add(pos, lane);
    if (!n) {
      this.doc.commit();
      this.gesture = null;
      return;
    }
    this.gesture = { kind: 'draw', id: n.id, existed: false, stretched: false, y };
    this.struck[lane] = performance.now();
    this.feedback('toggle-on');
    this.changed();
  }

  private cancelGesture() {
    const g = this.gesture;
    if (g?.kind === 'wait') clearTimeout(g.timer);
    if (g?.kind === 'draw' || g?.kind === 'move') {
      this.doc.cancel();
      this.changed();
    }
    this.marquee = null;
    this.gesture = null;
  }

  private pointerMove = (e: PointerEvent) => {
    if (this.phase !== 'ready' || !this.view || this.recording) return;
    const { x, y } = this.at(e);
    const scene = this.scene();
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      // The mouse is only passing over: show where a note would land.
      if (e.pointerType !== 'mouse') return;
      const hit = this.view.hit(x, y, scene);
      const ghost = hit.zone === 'deck' && this.tool === 'draw' && !hit.note && !e.shiftKey ? { pos: this.grid.snap(hit.pos, this.snap), lane: hit.lane } : null;
      if (ghost?.pos !== this.ghost?.pos || ghost?.lane !== this.ghost?.lane) {
        this.ghost = ghost;
        this.needsDraw = true;
      }
      this.els!.canvas.style.cursor = hit.zone === 'deck' ? (hit.note ? 'pointer' : this.tool === 'select' ? 'crosshair' : 'cell') : 'ns-resize';
      return;
    }
    p.x = x;
    p.y = y;
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      const [a, b] = [...this.pointers.values()];
      if (!a || !b) return;
      const want = g.px * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist);
      // The zoom step nearest to what the fingers ask for.
      let best = 0;
      for (let i = 1; i < ZOOMS.length; i++) if (Math.abs(ZOOMS[i] - want) < Math.abs(ZOOMS[best] - want)) best = i;
      if (best !== this.zoom) {
        this.zoom = best;
        this.savePrefs();
        this.emit();
      }
    } else if (g.kind === 'wait') {
      if (Math.hypot(x - g.x, y - g.y) > 9) {
        clearTimeout(g.timer);
        this.gesture = { kind: 'pan', y: g.y, pos: this.viewPos, lastY: y, lastT: e.timeStamp, v: 0 };
      }
    } else if (g.kind === 'pan') {
      this.viewPos = this.grid.clamp(g.pos + (y - g.y) / this.pxPerBeat);
      const dt = e.timeStamp - g.lastT;
      if (dt > 0) g.v = g.v * 0.5 + (((y - g.lastY) / this.pxPerBeat / dt) * 0.5);
      g.lastY = y;
      g.lastT = e.timeStamp;
      this.afterMove(false);
    } else if (g.kind === 'draw') {
      const n = this.doc.byId(g.id);
      if (!n) return;
      if (Math.abs(y - g.y) > 6) g.stretched = true;
      if (!g.stretched) return;
      const len = this.grid.snap(this.view.posAt(y, scene), this.snap) - n.pos;
      if (this.doc.setLength(g.id, Math.max(0, len))) this.changed();
    } else if (g.kind === 'marquee') {
      if (Math.hypot(x - g.x, y - g.y) < 5 && !this.marquee) return;
      this.marquee = { x0: g.x, y0: g.y, x1: x, y1: y };
      this.sel = new Set([...g.add, ...this.view.notesIn(g.x, g.y, x, y, scene)]);
      this.range = null;
      this.mark = null;
      this.emit();
    } else if (g.kind === 'move') {
      const dPos = this.grid.snap(this.view.posAt(y, scene), this.snap) - g.pos;
      const lane = this.view.laneAt(x);
      const dLane = lane < 0 ? g.dLane : lane - g.lane;
      let changed = false;
      if (Math.abs(dPos - g.dPos) > 1e-4 && this.doc.move(this.sel, dPos - g.dPos, 0, this.grid.start, this.grid.end)) {
        g.dPos = dPos;
        changed = true;
      }
      if (dLane !== g.dLane && this.doc.move(this.sel, 0, dLane - g.dLane, this.grid.start, this.grid.end)) {
        g.dLane = dLane;
        changed = true;
      }
      if (changed) {
        g.moved = true;
        this.changed();
      }
    }
  };

  private pointerUp = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (this.recording) {
      this.recordRelease(p.x, e.timeStamp);
      return;
    }
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    if (g.kind === 'wait') {
      // A tap: a note where there was none, none where there was one.
      clearTimeout(g.timer);
      if (e.type === 'pointercancel') return;
      if (this.sel.size) this.clearSelection(false);
      if (g.noteId !== undefined) this.doc.remove([g.noteId]);
      else if (this.doc.add(g.pos, g.lane)) this.struck[g.lane] = performance.now();
      this.feedback(g.noteId !== undefined ? 'toggle-off' : 'toggle-on');
      this.changed();
    } else if (g.kind === 'draw') {
      if (g.existed && !g.stretched) {
        this.doc.remove([g.id]);
        this.feedback('toggle-off');
      }
      this.doc.commit();
      this.changed();
    } else if (g.kind === 'pan') {
      // A finger that was moving when it lifted lets the chart run on a little.
      if (e.pointerType !== 'mouse' && Math.abs(g.v) > 0.002 && e.timeStamp - g.lastT < 80 && !this.calm) this.momentum = Math.max(-0.08, Math.min(0.08, g.v));
    } else if (g.kind === 'marquee') {
      if (!this.marquee) this.clearSelection(false);
      this.marquee = null;
      this.emit();
    } else if (g.kind === 'move') {
      this.doc.commit();
      // A press on a selected note without moving it takes it out of a shift-selection.
      if (!g.moved && g.wasSelected) this.sel.delete(g.id);
      this.changed();
    }
    this.needsDraw = true;
  };

  private pointerLeave = () => {
    if (!this.ghost) return;
    this.ghost = null;
    this.needsDraw = true;
  };

  private wheel = (e: WheelEvent) => {
    if (this.phase !== 'ready' || this.recording) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      this.zoomBy(e.deltaY < 0 ? 1 : -1);
      return;
    }
    const px = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    if (this.playing) return this.seek(this.viewPos - px / this.pxPerBeat);
    // Scrolling down brings up what came before, as the chart reads from the bottom up.
    this.viewPos = this.grid.clamp(this.viewPos - px / this.pxPerBeat);
    this.target = null;
    this.ghost = null;
    this.afterMove(false);
  };

  private overviewDown = (e: PointerEvent) => {
    if (this.phase !== 'ready' || this.recording) return;
    hold(e.currentTarget as HTMLElement, e.pointerId);
    this.overviewSeek(e);
  };

  private overviewMove = (e: PointerEvent) => {
    if (e.buttons & 1 || e.pointerType !== 'mouse') this.overviewSeek(e);
  };

  private overviewSeek(e: PointerEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * this.duration;
    this.seek(this.grid.pos(t));
    this.afterMove(false);
  }

  /** Steps the overview like a slider (its keys). */
  overviewStep(dir: -1 | 1) {
    this.moveBar(dir);
  }
}
