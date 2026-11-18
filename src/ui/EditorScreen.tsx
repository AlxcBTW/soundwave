import {
  ArrowLeft,
  Circle,
  Gamepad2,
  ListChecks,
  Magnet,
  Menu,
  MousePointer2,
  Pause,
  Pencil,
  Play,
  Redo2,
  Repeat,
  SkipBack,
  SkipForward,
  Square,
  SquareDashedMousePointer,
  Timer,
  Undo2,
  Wrench,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DIFFICULTIES, PARTS, type Chart } from '../chart/types';
import { EditorController, parkEditor, takeParked, type EditorSnapshot } from '../editor/EditorController';
import { SNAP_LABEL, SNAP_NAME, SNAPS } from '../editor/grid';
import type { Results } from '../game/GameSession';
import { keyLabel, type Settings } from '../game/settings';
import { formatTime } from '../game/setlist';
import { PadGlyph } from '../input/glyphs';
import type { InputMode } from '../input/inputMode';
import { NAV_EVENT, TAB_EVENT, type Dir } from '../input/menuNav';
import { confirmInput, type GlyphStyle } from '../input/pads';
import type { SongMeta } from '../storage/db';
import { CONFIRM_HINT, Hint, keyName, useActions, useHints } from './actions';
import { Cover } from './Cover';
import { AskCard, CheckCard, CopyFromCard, EditorMenu, SelectionCard, selectionActions, TempoSheet, ToolsCard, type MenuAsk } from './EditorDialogs';
import { DIFFICULTY_LABEL, ICON_STROKE, PART_ICON, PART_LABEL, Pips, Stars } from './icons';
import { useSlide } from './useSlide';

interface Props {
  song: SongMeta;
  settings: Settings;
  /** How the last test play of this chart went. */
  tested?: Results;
  /** Plays a chart from the editor: the real game, from `startAt` seconds, and back here afterwards. */
  onTest(chart: Chart, startAt: number): void;
  onBack(): void;
}

type Open = 'menu' | 'selection' | MenuAsk | null;

/** A line of the controls legend: what to press, and what it does. */
function Legend({ rows }: { rows: [ReactNode, string][] }) {
  return (
    <ul className="legend">
      {rows.map(([keys, text], i) => (
        <li key={i}>
          <span className="legend-keys">{keys}</span>
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

const Key = ({ children }: { children: ReactNode }) => <kbd className="keycap-hint">{children}</kbd>;

/**
 * The mark on a control: how to reach it without pointing at it. A keycap for the keyboard and the
 * mouse, the controller's own symbol for a controller, nothing under a finger.
 */
function Mark({ keys, pad, mode, style }: { keys?: string; pad?: string; mode: InputMode; style: GlyphStyle }) {
  if (mode === 'touch') return null;
  if (mode === 'pad') return pad ? <PadGlyph input={pad} style={style} className="hint-glyph mark" /> : null;
  return keys ? <kbd className="keycap-hint mark">{keys}</kbd> : null;
}

const SNAP_WORD = { grid: 'Grid', sounds: 'Sounds', off: 'Off' } as const;

/** How the editor is worked with the input in use. */
function legendFor(mode: InputMode, style: GlyphStyle, lanes: number, settings: Settings): [ReactNode, string][] {
  if (mode === 'pad') {
    const G = (input: string) => <PadGlyph input={input} style={style} />;
    const ok = confirmInput(style);
    return [
      [<>{G('b12')}{G('b15')}</>, 'Move along the song and across the lanes'],
      [G(ok), 'Set a note down, or take it away'],
      [<>{G(ok)}<span className="legend-plus">+</span>{G('b12')}</>, 'Hold and move up for a long note'],
      [G(ok), 'On a long note, or stretched into a tile: it must be let go there'],
      [G('b2'), 'Mark a stretch, then press confirm to copy, repeat or delete it'],
      [G('b3'), 'Play from here'],
      [<>{G('b4')}{G('b5')}</>, 'Coarser or finer grid'],
      [<>{G('b6')}{G('b7')}</>, 'A bar back, a bar on'],
      [G('a3-'), 'Push to run through the song; sideways to zoom'],
      [G('b10'), 'Notes snap to the grid, to sounds, or to nothing'],
      [G('b11'), 'Loop the marked stretch'],
      [G('b8'), 'Undo'],
      [G('b9'), 'Menu: record, test play, tools, tempo, hold-and-release, and all of the above'],
    ];
  }
  if (mode === 'keyboard') {
    return [
      [<><Key>↑</Key><Key>↓</Key><Key>←</Key><Key>→</Key></>, 'Move along the song and across the lanes'],
      [<><Key>Enter</Key><Key>1</Key>–<Key>{lanes}</Key></>, 'Set a note down, or take it away'],
      [<><Key>Enter</Key><span className="legend-plus">+</span><Key>↑</Key></>, 'Hold and move up for a long note'],
      [<><Key>Enter</Key></>, 'On a long note, or stretched into a tile: it must be let go there'],
      [<><Key>Shift</Key><span className="legend-plus">+</span><Key>↑</Key></>, 'Mark a stretch; Enter for what to do with it'],
      [<><Key>Q</Key><Key>E</Key><Key>S</Key></>, 'Coarser or finer grid; what notes snap to'],
      [<><Key>PgUp</Key><Key>PgDn</Key></>, 'A bar on, a bar back'],
      [<><Key>Ctrl</Key><span className="legend-plus">+</span><Key>↑</Key></>, 'To the next note; with Alt, the next sound'],
      [<><Key>Ctrl</Key><Key>Z</Key></>, 'Undo; with Shift, redo'],
      [<><Key>Ctrl</Key><Key>C</Key><Key>V</Key><Key>D</Key><Key>Q</Key></>, 'Copy, paste, repeat, snap to the grid'],
      [<><Key>O</Key><Key>H</Key><Key>L</Key></>, 'Overdrive phrase; let go on time; loop'],
      [<><Key>R</Key><Key>T</Key><Key>M</Key></>, 'Record; test play; menu'],
    ];
  }
  if (mode === 'touch') {
    return [
      ['Tap', 'a lane to set a note down; tap a note to take it away'],
      ['Hold', 'then drag up for a long note'],
      ['Tap', 'a long note, or drag one into a tile: it must be let go there'],
      ['Drag', 'to move through the song; pinch to zoom'],
      ['Select', 'tool: drag a box round notes, then move, copy or delete them'],
      ['Record', `plays the song; tap the lanes in time and every tap becomes a note`],
    ];
  }
  const keys = (lanes === 5 ? settings.keys5 : settings.keys4).map(keyLabel).join(' ');
  return [
    ['Click', 'a lane to set a note down; click a note to take it away'],
    ['Drag', 'up from a note for a long note'],
    ['Click', 'a long note, or drag one into a tile: it must be let go there'],
    ['Right-click', 'takes a note away'],
    ['Wheel', 'moves through the song; with Ctrl it zooms'],
    [<><Key>Shift</Key><span className="legend-plus">+</span>drag</>, 'or the Select tool: box notes in, then drag them'],
    [<><Key>1</Key>–<Key>{lanes}</Key></>, 'A note in that lane at the line'],
    [<><Key>S</Key><Key>L</Key></>, 'What notes snap to; loop the marked stretch'],
    [<><Key>R</Key></>, `Record: play ${keys} in time and every press becomes a note`],
  ];
}

const saveText = (s: EditorSnapshot) => (s.save === 'saved' ? 'Saved' : 'Saving…');

/** The track editor: one chart of a song on its lanes, to be changed note by note or played in. */
export function EditorScreen({ song, settings, tested, onTest, onBack }: Props) {
  const hints = useHints(settings);
  const { mode, style } = hints;
  const [ctrl, setCtrl] = useState<EditorController | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState('');
  const track = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overview = useRef<HTMLCanvasElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const status = useRef<HTMLSpanElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  /** Set when the player leaves the editor: it is then closed for good instead of put aside. */
  const closing = useRef(false);

  // The editor itself: picked up again after a test play, with its history, or opened afresh.
  useEffect(() => {
    const c = takeParked(song.id) ?? new EditorController(song, settingsRef.current);
    closing.current = false;
    c.attach({ track: track.current!, canvas: canvas.current!, overview: overview.current!, bar: bar.current!, time: time.current!, status: status.current! });
    if (c.snapshot().phase === 'loading') void c.load();
    // In development the editor can be reached from the console.
    if (import.meta.env.DEV) Object.assign(window, { __editor: c });
    setCtrl(c);
    return () => {
      c.detach();
      // Put aside rather than thrown away: it comes back with its history after a test play.
      if (closing.current) c.dispose();
      else parkEditor(c);
      setCtrl(null);
    };
  }, [song]);

  useEffect(() => ctrl?.applySettings(settings), [ctrl, settings]);

  // What is said in passing shows for a moment over the lanes.
  const noticeTimer = useRef(0);
  const say = (text: string) => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 3600);
  };
  useEffect(() => {
    if (!ctrl) return;
    ctrl.onNotice = say;
    ctrl.onSelectionMenu = () => setOpen('selection');
    return () => clearTimeout(noticeTimer.current);
  }, [ctrl]);

  // Directions on the track move the cursor instead of the focus; Q and E (the shoulder buttons) change the grid.
  useEffect(() => {
    const el = track.current;
    if (!ctrl || !el) return;
    const onNav = (e: Event) => {
      e.preventDefault();
      ctrl.direction((e as CustomEvent<{ dir: Dir }>).detail.dir);
    };
    const onTab = (e: Event) => {
      if (document.querySelector('[data-modal]')) return;
      ctrl.stepSnap((e as CustomEvent<number>).detail < 0 ? -1 : 1);
    };
    el.addEventListener(NAV_EVENT, onNav);
    window.addEventListener(TAB_EVENT, onTab);
    return () => {
      el.removeEventListener(NAV_EVENT, onNav);
      window.removeEventListener(TAB_EVENT, onTab);
    };
  }, [ctrl]);

  const snap = useSyncExternalStore(ctrl?.subscribe ?? noSubscribe, ctrl?.snapshot ?? noSnapshot);
  const ready = snap?.phase === 'ready';
  const recording = !!snap?.recording;

  const leave = () => {
    closing.current = true;
    void ctrl?.flush();
    onBack();
  };
  const test = (fromStart = false) => {
    if (!ctrl || !ready) return;
    const { chart, startAt } = ctrl.testChart(fromStart);
    if (!chart.notes.length) return say(snap.stats.notes ? 'There are no notes from here on. Move back, or test play from the start.' : 'There is nothing to play yet. Set some notes down first.');
    void ctrl.flush().then(() => onTest(chart, startAt));
  };
  const record = () => void ctrl?.startRecording();

  useActions(
    recording
      ? [
          // On a controller every other button is a lane: Options stops, as it pauses a song.
          { id: 'stop', label: 'Stop recording', icon: Square, ...(mode === 'pad' ? { pad: 'b9' } : { kbd: 'Escape' }), sfx: 'none', run: () => ctrl?.stopRecording() },
          { id: CONFIRM_HINT, label: '', icon: Circle, bar: false, run: () => {} },
        ]
      : [
          {
            id: 'back',
            label: snap?.selected || snap?.ranged ? 'Clear selection' : 'Back',
            icon: ArrowLeft,
            kbd: 'Escape',
            sfx: 'back',
            run: () => (ctrl?.hasSelection ? ctrl.clearSelection() : leave()),
          },
          // What the confirm button does here, beside Back.
          { id: CONFIRM_HINT, label: snap?.selected || snap?.ranged ? 'Selection' : 'Note', icon: Circle, bar: false, run: () => {} },
          { id: 'mark', label: snap?.marking ? 'Stop marking' : 'Mark', icon: SquareDashedMousePointer, kbd: 'KeyX', pad: 'b2', bar: mode === 'pad', disabled: !ready, sfx: 'none', run: () => ctrl?.toggleMark() },
          // Under a finger the play button beside the lanes is the one to press.
          { id: 'play', label: snap?.playing ? 'Pause' : 'Play', icon: snap?.playing ? Pause : Play, kbd: 'Space', pad: 'b3', bar: mode !== 'touch', disabled: !ready, sfx: 'none', run: () => ctrl?.togglePlay() },
          { id: 'record', label: 'Record', icon: Circle, kbd: 'KeyR', bar: false, disabled: !ready, sfx: 'none', run: record },
          { id: 'phrase', label: 'Overdrive phrase', icon: Zap, kbd: 'KeyO', bar: false, disabled: !ready, sfx: 'none', run: () => ctrl?.togglePhrase() },
          { id: 'release', label: 'Let go on time', icon: Zap, kbd: 'KeyH', bar: false, disabled: !ready, sfx: 'none', run: () => ctrl?.toggleRelease() },
          { id: 'snap-mode', label: 'Snap to', icon: Magnet, kbd: 'KeyS', bar: false, disabled: !ready, sfx: 'none', run: () => ctrl?.cycleSnapMode() },
          { id: 'loop', label: 'Loop', icon: Repeat, kbd: 'KeyL', bar: false, disabled: !ready, sfx: 'tab', run: () => ctrl?.setLoop(!snap.loop) },
          { id: 'menu', label: 'Menu', icon: Menu, kbd: 'KeyM', pad: 'b9', disabled: !ready, run: () => setOpen('menu') },
          // On a controller the menu's first button is the test play; the bar would have no button to show for it.
          { id: 'test', label: 'Test play', icon: Gamepad2, kbd: 'KeyT', primary: true, bar: mode !== 'pad', disabled: !ready || !snap.stats.notes, sfx: 'launch', run: () => test() },
        ],
  );

  const partRow = useSlide<HTMLDivElement>(snap?.part);
  const diffRow = useSlide<HTMLDivElement>(snap?.difficulty);
  const toolRow = useSlide<HTMLDivElement>(snap?.tool);
  const pointer = mode === 'mouse' || mode === 'touch';
  const PartIcon = PART_ICON[snap?.part ?? 'lead'];
  const legend = <Legend rows={legendFor(mode, style, snap?.lanes ?? 5, settings)} />;
  const snapIndex = snap ? SNAPS.indexOf(snap.snap) : 0;

  return (
    <div className={`page editor ${recording ? 'is-recording' : ''}`} data-nav-off={recording ? '' : undefined}>
      <header className="page-head editor-head">
        <h1 className="page-title">Track editor</h1>
        <p className="head-count editor-song">
          <b>{song.title}</b> · {song.artist}
        </p>
        {ready && (
          <p className="editor-save" role="status">
            {saveText(snap)}
          </p>
        )}
      </header>

      <div className="editor-bar" data-nav-skip role="toolbar" aria-label="Chart" inert={recording || !ready}>
        {/* Which chart: on a phone one button that opens the menu, elsewhere the choices themselves. */}
        <button type="button" className="btn editor-chart-btn" onClick={() => setOpen('menu')}>
          <PartIcon strokeWidth={ICON_STROKE} aria-hidden />
          <span className="btn-label">
            {PART_LABEL[snap?.part ?? 'lead']} · {DIFFICULTY_LABEL[snap?.difficulty ?? 'expert']}
          </span>
        </button>
        {mode === 'pad' && (
          <span className="editor-via" title="In the menu">
            <PadGlyph input="b9" style={style} className="hint-glyph mark" />
          </span>
        )}
        <div className="tab-row slide editor-pick" ref={partRow} role="radiogroup" aria-label="Part">
          <span className="sel" aria-hidden />
          {PARTS.map((p) => {
            const Icon = PART_ICON[p];
            const on = snap?.part === p;
            return (
              <button key={p} type="button" role="radio" aria-checked={on} aria-label={PART_LABEL[p]} title={PART_LABEL[p]} data-on={on} data-sfx="tab" className={`tab ${on ? 'on' : ''}`} onClick={() => snap && void ctrl?.setChart(p, snap.difficulty)}>
                <Icon strokeWidth={ICON_STROKE} aria-hidden />
                <span className="tab-label">{PART_LABEL[p]}</span>
              </button>
            );
          })}
        </div>
        <div className="tab-row slide editor-pick" ref={diffRow} role="radiogroup" aria-label="Difficulty">
          <span className="sel" aria-hidden />
          {DIFFICULTIES.map((d) => {
            const on = snap?.difficulty === d;
            return (
              <button key={d} type="button" role="radio" aria-checked={on} aria-label={DIFFICULTY_LABEL[d]} title={DIFFICULTY_LABEL[d]} data-on={on} data-sfx="tab" className={`tab ${on ? 'on' : ''}`} onClick={() => snap && void ctrl?.setChart(snap.part, d)}>
                <Pips difficulty={d} />
                <span className="tab-label">{DIFFICULTY_LABEL[d]}</span>
              </button>
            );
          })}
        </div>

        <div className="editor-snap" role="group" aria-label={`Grid: ${snap ? SNAP_NAME[snap.snap] : ''}`}>
          <button
            type="button"
            className={`btn small snap-mode ${snap?.snapMode !== 'off' ? 'on' : ''}`}
            data-sfx="none"
            aria-label={`Notes snap to: ${snap ? SNAP_WORD[snap.snapMode] : ''}. Press to change.`}
            title="What notes snap to: the grid, sounds in the song, or nothing"
            onClick={() => ctrl?.cycleSnapMode()}
          >
            <Mark keys="S" pad="b10" mode={mode} style={style} />
            <Magnet strokeWidth={ICON_STROKE} aria-hidden />
            <span className="snap-mode-text">
              <span className="label">Snap</span>
              <span className="num" key={snap?.snapMode}>{snap ? SNAP_WORD[snap.snapMode] : ''}</span>
            </span>
          </button>
          <Hint kbd="KeyQ" pad="b4" {...hints} />
          <button type="button" className="step" data-sfx="none" aria-label="Coarser grid" disabled={snapIndex <= 0} onClick={() => ctrl?.stepSnap(-1)}>
            <span aria-hidden>‹</span>
          </button>
          <span className="editor-snap-value" title={snap ? SNAP_NAME[snap.snap] : undefined}>
            <span className="label">Grid</span>
            <span className="num" key={snap?.snap}>{snap ? SNAP_LABEL[snap.snap] : ''}</span>
          </span>
          <button type="button" className="step" data-sfx="none" aria-label="Finer grid" disabled={snapIndex >= SNAPS.length - 1} onClick={() => ctrl?.stepSnap(1)}>
            <span aria-hidden>›</span>
          </button>
          <Hint kbd="KeyE" pad="b5" {...hints} />
        </div>

        {pointer && (
          <div className="tab-row slide editor-tools" ref={toolRow} role="radiogroup" aria-label="Tool">
            <span className="sel" aria-hidden />
            <button type="button" role="radio" aria-checked={snap?.tool === 'draw'} data-on={snap?.tool === 'draw'} data-sfx="tab" className={`tab ${snap?.tool === 'draw' ? 'on' : ''}`} title="Draw: set notes down and take them away" aria-label="Draw" onClick={() => ctrl?.setTool('draw')}>
              <Pencil strokeWidth={ICON_STROKE} aria-hidden />
              <span className="tab-label">Draw</span>
            </button>
            <button type="button" role="radio" aria-checked={snap?.tool === 'select'} data-on={snap?.tool === 'select'} data-sfx="tab" className={`tab ${snap?.tool === 'select' ? 'on' : ''}`} title="Select: box notes in, move, copy and delete them" aria-label="Select" onClick={() => ctrl?.setTool('select')}>
              <MousePointer2 strokeWidth={ICON_STROKE} aria-hidden />
              <span className="tab-label">Select</span>
            </button>
          </div>
        )}

        <div className="editor-quick">
          <Mark keys="Ctrl Z" pad="b8" mode={mode} style={style} />
          <button type="button" className="icon-btn" data-sfx="none" aria-label="Undo" title="Undo" disabled={!snap?.canUndo} onClick={() => ctrl?.undo()}>
            <Undo2 strokeWidth={ICON_STROKE} aria-hidden />
          </button>
          <button type="button" className="icon-btn editor-wide-only" data-sfx="none" aria-label="Redo" title="Redo" disabled={!snap?.canRedo} onClick={() => ctrl?.redo()}>
            <Redo2 strokeWidth={ICON_STROKE} aria-hidden />
          </button>
          <span className="editor-wide-only">
            <Mark keys="− +" pad="a2+" mode={mode} style={style} />
          </span>
          <button type="button" className="icon-btn editor-wide-only" aria-label="Zoom out" title="Zoom out" disabled={!snap || snap.zoom <= 0} onClick={() => ctrl?.zoomBy(-1)}>
            <ZoomOut strokeWidth={ICON_STROKE} aria-hidden />
          </button>
          <button type="button" className="icon-btn editor-wide-only" aria-label="Zoom in" title="Zoom in" disabled={!snap || snap.zoom >= snap.zoomSteps - 1} onClick={() => ctrl?.zoomBy(1)}>
            <ZoomIn strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>
      </div>

      <div className="editor-body">
        <aside className="editor-side" aria-label="This chart">
          <section className="editor-card editor-now">
            <Cover blob={song.cover} title={song.title} />
            <div className="now-text">
              <h2 className="now-title">{song.title}</h2>
              <p className="now-artist">
                {song.artist}
                {snap && snap.duration > 0 && ` · ${formatTime(snap.duration)}`}
              </p>
              {ready && <span className={`pill ${snap.edited ? 'lit' : ''}`}>{snap.edited ? 'Edited by hand' : snap.hasAnalysis ? 'Game’s chart' : 'Not charted yet'}</span>}
            </div>
          </section>
          {ready && (
            <section className="editor-card" aria-label="What is in the chart">
              <h2 className="label">
                <PartIcon strokeWidth={ICON_STROKE} aria-hidden />
                {PART_LABEL[snap.part]} · {DIFFICULTY_LABEL[snap.difficulty]}
              </h2>
              <dl className="editor-stats">
                <div>
                  <dt>Notes</dt>
                  <dd>{snap.stats.notes.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Long notes</dt>
                  <dd>{snap.stats.long.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Chords</dt>
                  <dd>{snap.stats.chords.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Overdrive</dt>
                  <dd>{snap.stats.phrases}</dd>
                </div>
              </dl>
              {snap.stats.peak > 0 && <p className="editor-fact">Up to {snap.stats.peak} {snap.stats.peak === 1 ? 'note' : 'notes'} in a second.</p>}
              {snap.issues > 0 && (
                <button type="button" className="btn small" data-nav-skip onClick={() => setOpen('check')}>
                  <ListChecks strokeWidth={ICON_STROKE} aria-hidden />
                  {snap.issues} worth a look
                </button>
              )}
              {tested && (
                <p className="editor-fact editor-tested">
                  Last test play <Stars n={tested.stars} /> {Math.round(tested.accuracy * 100)}%
                </p>
              )}
            </section>
          )}
          {ready && (
            <section className="editor-card" aria-label="Tempo">
              <h2 className="label">
                <Timer strokeWidth={ICON_STROKE} aria-hidden />
                Tempo
              </h2>
              <p className="editor-tempo">
                <span className="num">{snap.grid.bpm.toFixed(2).replace(/\.?0+$/, '')}</span> BPM
                <span className="dim"> · {snap.grid.beatsPerBar} beats in a bar</span>
              </p>
              <p className="editor-fact">{snap.grid.mode === 'song' ? 'The grid follows the beats heard in the song.' : 'One tempo for the whole song.'}</p>
              <button type="button" className="btn small" data-nav-skip onClick={() => setOpen('tempo')}>
                Tempo and bars
              </button>
            </section>
          )}
        </aside>

        <div className="editor-stage">
          <canvas
            ref={overview}
            className="editor-overview"
            role="slider"
            tabIndex={0}
            data-nav-skip
            aria-label="Position in the song"
            aria-valuemin={0}
            aria-valuemax={Math.round(snap?.duration ?? 0)}
            aria-valuenow={0}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              e.stopPropagation();
              ctrl?.overviewStep(e.key === 'ArrowLeft' ? -1 : 1);
            }}
          />
          <div
            ref={track}
            className="editor-track"
            tabIndex={0}
            role="application"
            aria-label={`${PART_LABEL[snap?.part ?? 'lead']} chart, ${DIFFICULTY_LABEL[snap?.difficulty ?? 'expert']}. Arrow keys move through the song and across the lanes; Enter sets a note down or takes it away.`}
            data-ring="none"
            data-autofocus
            data-sfx="none"
          >
            <canvas ref={canvas} className="editor-canvas" />
            <span ref={status} className="sr-only" aria-live="polite" />
            {snap?.phase === 'loading' && (
              <div className="editor-wait" role="status">
                <span className="meter busy" aria-hidden>
                  <span />
                </span>
                Opening the song…
              </div>
            )}
            {snap?.phase === 'error' && (
              <div className="editor-wait" role="alert">
                <p className="error">{snap.error}</p>
                <button type="button" className="btn" data-sfx="back" onClick={leave}>
                  Back
                </button>
              </div>
            )}
            {ready && snap.stats.notes === 0 && !recording && (
              <p className="editor-empty">
                {mode === 'touch' ? 'Tap a lane to set down the first note.' : mode === 'mouse' ? 'Click a lane to set down the first note.' : 'Move to where the first note goes and press confirm.'} Or record: play the song and tap along.
              </p>
            )}
            {recording && (
              <div className="editor-rec" role="status">
                <span className="rec-dot" aria-hidden />
                Recording
                <span className="rec-how">
                  {mode === 'touch'
                    ? 'Tap the lanes'
                    : mode === 'pad'
                      ? 'Play the lanes'
                      : `Play ${(snap.lanes === 5 ? settings.keys5 : settings.keys4).map(keyLabel).join(' ')}`}
                </span>
              </div>
            )}
            {notice && !recording && (
              <p className="editor-notice" role="status">
                {notice}
              </p>
            )}
            {ready && pointer && snap.selected > 0 && !recording && (
              <div className="editor-selbar" data-nav-skip role="toolbar" aria-label={`${snap.selected} notes selected`}>
                <span className="editor-selcount">
                  {snap.selected} {snap.selected === 1 ? 'note' : 'notes'}
                </span>
                {selectionActions(ctrl!, snap).map((a) => (
                  <button key={a.id} type="button" className="btn small" data-sfx={a.id === 'delete' ? 'back' : undefined} aria-label={a.label} title={a.label} disabled={a.disabled} onClick={a.run}>
                    <a.icon strokeWidth={ICON_STROKE} aria-hidden />
                    <span className="btn-label">{a.short}</span>
                  </button>
                ))}
                <button type="button" className="btn small" aria-label="More tools" title="More tools" onClick={() => setOpen('tools')}>
                  <Wrench strokeWidth={ICON_STROKE} aria-hidden />
                  <span className="btn-label">Tools</span>
                </button>
              </div>
            )}
          </div>

          <div className="editor-transport" data-nav-skip role="group" aria-label="Playback" inert={!ready}>
            <span className="editor-readout">
              <span className="label">Bar</span>
              <span className="num" ref={bar}>1.1</span>
            </span>
            <span className="editor-transport-mid">
              <Mark keys="PgDn" pad="b6" mode={mode} style={style} />
              <button type="button" className="icon-btn" aria-label="A bar back" title={`A bar back (${keyName('PageDown')})`} disabled={recording} onClick={() => ctrl?.moveBar(-1)}>
                <SkipBack strokeWidth={ICON_STROKE} aria-hidden />
              </button>
              <button type="button" className={`icon-btn editor-play ${snap?.playing && !recording ? 'live' : ''}`} data-sfx="none" aria-label={snap?.playing ? 'Pause' : 'Play from here'} disabled={recording} onClick={() => ctrl?.togglePlay()}>
                {snap?.playing && !recording ? <Pause strokeWidth={ICON_STROKE} aria-hidden /> : <Play strokeWidth={ICON_STROKE} aria-hidden />}
              </button>
              <button type="button" className="icon-btn" aria-label="A bar on" title={`A bar on (${keyName('PageUp')})`} disabled={recording} onClick={() => ctrl?.moveBar(1)}>
                <SkipForward strokeWidth={ICON_STROKE} aria-hidden />
              </button>
              <Mark keys="PgUp" pad="b7" mode={mode} style={style} />
              <button type="button" className={`icon-btn editor-loop ${snap?.loop ? 'on' : ''}`} data-sfx="tab" aria-pressed={!!snap?.loop} aria-label="Loop the marked stretch" title="Loop: playback goes round the marked stretch" disabled={recording} onClick={() => ctrl?.setLoop(!snap.loop)}>
                <Repeat strokeWidth={ICON_STROKE} aria-hidden />
              </button>
              <Mark keys="L" pad="b11" mode={mode} style={style} />
              <button type="button" className={`btn small editor-record ${recording ? 'live' : ''}`} data-sfx="none" aria-pressed={recording} onClick={() => (recording ? ctrl?.stopRecording() : record())}>
                {recording ? <Square strokeWidth={ICON_STROKE} aria-hidden /> : <Circle strokeWidth={ICON_STROKE} aria-hidden />}
                <span className="btn-label">{recording ? 'Stop' : 'Record'}</span>
                {!recording && <Mark keys="R" pad="b9" mode={mode} style={style} />}
              </button>
            </span>
            <span className="editor-readout end">
              {snap && snap.rate !== 1 && <span className="pill">{Math.round(snap.rate * 100)}%</span>}
              <span className="num" ref={time}>0:00.0</span>
            </span>
          </div>
        </div>

        <aside className="editor-help" aria-label="Controls">
          <section className="editor-card">
            <h2 className="label">Controls</h2>
            {legend}
          </section>
        </aside>
      </div>

      {ctrl && ready && open === 'menu' && <EditorMenu ctrl={ctrl} snap={snap} mode={mode} legend={legend} onTest={test} onRecord={record} onAsk={setOpen} onClose={() => setOpen(null)} />}
      {ctrl && ready && open === 'tempo' && <TempoSheet ctrl={ctrl} snap={snap} mode={mode} onClose={() => setOpen(null)} />}
      {ctrl && ready && open === 'selection' && <SelectionCard ctrl={ctrl} snap={snap} onTools={() => setOpen('tools')} onClose={() => setOpen((o) => (o === 'selection' ? null : o))} />}
      {ctrl && ready && open === 'tools' && <ToolsCard ctrl={ctrl} snap={snap} onClose={() => setOpen(null)} />}
      {ctrl && ready && open === 'check' && (
        <CheckCard
          issues={ctrl.issues()}
          where={(pos) => {
            const bb = ctrl.grid.barBeat(pos);
            return `${bb.bar}.${bb.beat}`;
          }}
          onGo={(issue) => ctrl.jumpTo(issue.pos, issue.lane)}
          onClose={() => setOpen(null)}
        />
      )}
      {ctrl && ready && open === 'simplify' && snap.harder && (
        <AskCard
          title={`Simplify from ${DIFFICULTY_LABEL[snap.harder]}?`}
          hint={`${PART_LABEL[snap.part]} · ${DIFFICULTY_LABEL[snap.difficulty]} is written again as a simpler version of ${DIFFICULTY_LABEL[snap.harder]}: fewer notes, smaller chords, the same skeleton. Undo brings the old chart back while the editor stays open.`}
          yes="Simplify"
          onYes={() => void ctrl.simplifyFrom(snap.harder!)}
          onClose={() => setOpen(null)}
        />
      )}
      {ctrl && ready && open === 'easier' && (
        <AskCard
          title="Write the easier charts?"
          hint={`${snap.easier.map((d) => DIFFICULTY_LABEL[d]).join(', ')} of ${PART_LABEL[snap.part]} ${snap.easier.length === 1 ? 'is' : 'are'} written again from this chart, each a simpler version of the one above it. What is in them now is replaced; undo in each chart brings it back while the editor stays open.`}
          yes="Write them"
          onYes={() => void ctrl.writeEasier().then((done) => done.length && say(`Wrote ${done.map((d) => DIFFICULTY_LABEL[d]).join(', ')} from this chart.`))}
          onClose={() => setOpen(null)}
        />
      )}
      {ctrl && ready && open === 'copy-from' && <CopyFromCard ctrl={ctrl} snap={snap} onClose={() => setOpen(null)} />}
      {ctrl && ready && open === 'clear' && (
        <AskCard
          title="Clear the chart?"
          hint={`Every note of ${PART_LABEL[snap.part]} · ${DIFFICULTY_LABEL[snap.difficulty]} is taken away. Undo brings them back while the editor stays open.`}
          yes="Clear the chart"
          onYes={() => ctrl.clearChart()}
          onClose={() => setOpen(null)}
        />
      )}
      {ctrl && ready && open === 'revert' && (
        <AskCard
          title="Put back the game’s chart?"
          hint={`What you changed in ${PART_LABEL[snap.part]} · ${DIFFICULTY_LABEL[snap.difficulty]} is replaced by the chart the game wrote from the song. Undo brings your version back while the editor stays open.`}
          yes="Put it back"
          onYes={() => void ctrl.revert()}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

const noSubscribe = () => () => {};
const noSnapshot = () => null as unknown as EditorSnapshot;
