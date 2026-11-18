/**
 * What opens over the track editor: its menu, the tempo sheet, the cards for a selection and its
 * tools, the chart check, copying from another chart, and the questions asked before a chart is
 * thrown away. The rows are the settings screen's rows (name on the left, control on the right,
 * left and right change the value), so a controller works them the same way, and every row and
 * button says in a line what it does.
 */
import {
  ArrowLeftRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Circle,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eraser,
  FastForward,
  FlipHorizontal2,
  Gamepad2,
  Grid3x3,
  Hand,
  ListChecks,
  ListMusic,
  Magnet,
  MoveVertical,
  Pause,
  Play,
  Redo2,
  Rewind,
  RotateCcw,
  Scissors,
  SquareDashedMousePointer,
  Timer,
  Trash2,
  TrendingDown,
  Undo2,
  Waves,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { playSfx } from '../audio/sfx';
import { DIFFICULTIES, lanesFor, PARTS, type Difficulty, type Part } from '../chart/types';
import { chartKey, type ChartKey } from '../editor/edits';
import { RATES, SOURCE_LABEL, type EditorController, type EditorSnapshot, type Issue, type SnapMode } from '../editor/EditorController';
import { MAX_BPM, MIN_BPM, SNAP_NAME, SNAPS, type Snap } from '../editor/grid';
import type { InputMode } from '../input/inputMode';
import { NAV_EVENT, type Dir } from '../input/menuNav';
import { Dialog } from './Dialog';
import { DIFFICULTY_LABEL, ICON_STROKE, PART_ICON, PART_LABEL } from './icons';

/* Rows ------------------------------------------------------------------------------------- */

/** Left and right on the focused row change its value instead of moving focus. */
function useSideways(ref: React.RefObject<HTMLElement | null>, step: (d: -1 | 1) => void) {
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onNav = (e: Event) => {
      const dir = (e as CustomEvent<{ dir: Dir }>).detail.dir;
      if (dir !== 'left' && dir !== 'right') return;
      e.preventDefault();
      stepRef.current(dir === 'left' ? -1 : 1);
    };
    el.addEventListener(NAV_EVENT, onNav);
    return () => el.removeEventListener(NAV_EVENT, onNav);
  }, [ref]);
}

/**
 * Which row is the lit one: the row focused or pointed at last. One at a time, so a row never stays
 * lit because it missed hearing that focus left it.
 */
let litRow: object | null = null;
const litListeners = new Set<() => void>();
const lightRow = (row: object | null) => {
  if (row === litRow) return;
  litRow = row;
  for (const l of litListeners) l();
};
const watchLit = (fn: () => void) => {
  litListeners.add(fn);
  return () => litListeners.delete(fn);
};

interface StepRowProps {
  label: string;
  /** What is shown as the value. */
  text: string;
  /** What the setting does, shown under the row while it is the lit one. */
  help?: string;
  /** For a value that is one of a few: which one, of how many (drawn as ticks). */
  index?: number;
  count?: number;
  atMin?: boolean;
  atMax?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  touch: boolean;
  /** Pressing the row itself steps forward and wraps round (for a choice); a number just steps. */
  wrap?: boolean;
  onStep(d: -1 | 1, wrap: boolean): void;
}

/** A setting changed in steps: arrows either side of its value. */
export function StepRow({ label, text, help, index, count, atMin, atMax, disabled, autoFocus, touch, wrap = false, onStep }: StepRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [me] = useState(() => ({}));
  const active = useSyncExternalStore(watchLit, () => litRow === me);
  useEffect(() => () => lightRow(litRow === me ? null : litRow), [me]);
  const step = (d: -1 | 1, round = false) => {
    if (disabled || (!round && ((d < 0 && atMin) || (d > 0 && atMax)))) return;
    playSfx(d > 0 ? 'toggle-on' : 'toggle-off');
    onStep(d, round);
  };
  useSideways(ref, (d) => step(d));
  const value = touch
    ? ({ role: 'group', 'aria-label': `${label}: ${text}` } as const)
    : ({
        role: 'slider',
        'aria-label': label,
        'aria-valuetext': text,
        'aria-valuenow': index ?? 0,
        'aria-valuemin': 0,
        'aria-valuemax': count !== undefined ? count - 1 : undefined,
      } as const);
  return (
    <div
      ref={ref}
      className={`set-row choice ${active ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
      {...value}
      tabIndex={0}
      data-sfx="none"
      data-autofocus={autoFocus ? '' : undefined}
      aria-disabled={disabled}
      aria-description={help}
      onFocus={() => lightRow(me)}
      onPointerEnter={(e) => e.pointerType === 'mouse' && lightRow(me)}
      onPointerDown={() => lightRow(me)}
      onClick={() => wrap && step(1, true)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && wrap && (e.preventDefault(), step(1, true))}
    >
      <span className="set-label">{label}</span>
      <span className="set-control">
        <button
          type="button"
          className="step"
          tabIndex={-1}
          data-sfx="none"
          aria-label={touch ? `Lower ${label}` : undefined}
          aria-hidden={!touch}
          disabled={disabled || atMin}
          onClick={(e) => (e.stopPropagation(), step(-1))}
        >
          <ChevronLeft strokeWidth={3} />
        </button>
        <span className="set-value">
          <span className="set-value-text" key={text}>
            {text}
          </span>
          {count !== undefined && (
            <span className="ticks" aria-hidden>
              {Array.from({ length: count }, (_, i) => (
                <span key={i} className={i === index ? 'on' : ''} />
              ))}
            </span>
          )}
        </span>
        <button
          type="button"
          className="step"
          tabIndex={-1}
          data-sfx="none"
          aria-label={touch ? `Raise ${label}` : undefined}
          aria-hidden={!touch}
          disabled={disabled || atMax}
          onClick={(e) => (e.stopPropagation(), step(1))}
        >
          <ChevronRight strokeWidth={3} />
        </button>
      </span>
      {help && <p className="set-help">{help}</p>}
    </div>
  );
}

interface ChoiceRowProps<T> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  help?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  touch: boolean;
  onChange(v: T): void;
}

/** One of a few named values. */
export function ChoiceRow<T>({ label, value, options, help, disabled, autoFocus, touch, onChange }: ChoiceRowProps<T>) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <StepRow
      label={label}
      text={options[index]?.label ?? ''}
      help={help}
      index={index}
      count={options.length}
      atMin={index === 0}
      atMax={index === options.length - 1}
      disabled={disabled}
      autoFocus={autoFocus}
      touch={touch}
      wrap
      onStep={(d, round) => {
        const n = options.length;
        const next = round ? (index + d + n) % n : Math.min(n - 1, Math.max(0, index + d));
        if (next !== index) onChange(options[next].value);
      }}
    />
  );
}

const ON_OFF = [
  { value: false, label: 'Off' },
  { value: true, label: 'On' },
] as const;

export const SNAP_MODE_LABEL: Record<SnapMode, string> = { grid: 'The grid', sounds: 'Sounds in the song', off: 'Nothing' };

/** A full-width button with its name and, under it, a line that says what it does. */
function MenuButton({
  icon: Icon,
  help,
  children,
  className = '',
  ...rest
}: { icon: LucideIcon; help?: string; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`btn wide ${help ? 'menu-btn' : ''} ${className}`} {...rest}>
      <Icon strokeWidth={ICON_STROKE} aria-hidden />
      {help ? (
        <span className="pick-text">
          <span>{children}</span>
          <span className="pick-help">{help}</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}

/* The menu --------------------------------------------------------------------------------- */

export type MenuAsk = 'tempo' | 'copy-from' | 'clear' | 'revert' | 'tools' | 'check' | 'simplify' | 'easier';

interface MenuProps {
  ctrl: EditorController;
  snap: EditorSnapshot;
  mode: InputMode;
  /** The key legend for the input in use, shown at the foot on screens too narrow for it elsewhere. */
  legend: ReactNode;
  onTest(fromStart: boolean): void;
  onRecord(): void;
  onAsk(what: MenuAsk): void;
  onClose(): void;
}

/** Everything the editor can do, in one place a controller can reach. */
export function EditorMenu({ ctrl, snap, mode, legend, onTest, onRecord, onAsk, onClose }: MenuProps) {
  const touch = mode === 'touch';
  const snapModes = (['grid', 'sounds', 'off'] as SnapMode[]).filter((m) => m !== 'sounds' || snap.hasSounds);
  // With nothing selected, the note the cursor is on can be changed from here (a selection has its own card).
  const here = snap.selected ? null : ctrl.cursorNote();
  return (
    <Dialog title="Editor menu" onClose={onClose}>
      {(close) => {
        const then = (fn: () => void) => () => {
          close();
          fn();
        };
        return (
          <div className="sheet-body editor-menu">
            <div className="sheet-title">
              <h2 className="display">Editor</h2>
              <p className="sheet-artist">
                {PART_LABEL[snap.part]} · {DIFFICULTY_LABEL[snap.difficulty]} · {snap.stats.notes.toLocaleString()}{' '}
                {snap.stats.notes === 1 ? 'note' : 'notes'}
              </p>
            </div>
            <div className="menu-section">
              <MenuButton
                icon={Gamepad2}
                className="primary"
                help="Play the chart in the game from the bar the cursor is in, then come back here."
                data-autofocus
                data-sfx="launch"
                disabled={snap.stats.notes === 0}
                onClick={then(() => onTest(false))}
              >
                Test play from here
              </MenuButton>
              <MenuButton
                icon={Circle}
                help="The song plays from a bar before the cursor. Play the lanes as you would in a song: every press becomes a note."
                data-sfx="none"
                onClick={then(onRecord)}
              >
                Record
              </MenuButton>
            </div>

            {here && (
              <section className="menu-section" aria-label="The note under the cursor">
                <h3 className="label">The note under the cursor</h3>
                <MenuButton
                  icon={Hand}
                  help={
                    !here.long
                      ? 'Only a long note can be a hold-and-release note. Stretch it first: hold confirm on it and move up.'
                      : here.release
                        ? 'It is a hold-and-release note: it must be let go when it ends. Press to make it a plain long note.'
                        : 'Makes it a hold-and-release note: it must also be let go on time, when it ends.'
                  }
                  aria-pressed={here.release}
                  disabled={!here.long}
                  onClick={() => ctrl.toggleRelease()}
                >
                  {here.release ? 'Let go on time: on' : 'Let go on time: off'}
                </MenuButton>
                <MenuButton
                  icon={Zap}
                  help={
                    here.phrase
                      ? 'It is part of an overdrive phrase. Press to take it out.'
                      : 'Makes it an overdrive note. Mark a stretch to make a whole phrase.'
                  }
                  aria-pressed={here.phrase}
                  onClick={() => ctrl.togglePhrase()}
                >
                  {here.phrase ? 'Overdrive: on' : 'Overdrive: off'}
                </MenuButton>
              </section>
            )}

            <section className="menu-section set-list" aria-label="Chart">
              <h3 className="label">Chart</h3>
              <ChoiceRow
                label="Part"
                help="Each part has its own four charts."
                value={snap.part}
                options={PARTS.map((p) => ({ value: p, label: PART_LABEL[p] }))}
                touch={touch}
                onChange={(p) => void ctrl.setChart(p, snap.difficulty)}
              />
              <ChoiceRow
                label="Difficulty"
                help="Easy, Medium and Hard have four lanes, Expert five. Each is a chart of its own."
                value={snap.difficulty}
                options={DIFFICULTIES.map((d) => ({ value: d, label: `${DIFFICULTY_LABEL[d]} · ${lanesFor(d)} lanes` }))}
                touch={touch}
                onChange={(d) => void ctrl.setChart(snap.part, d)}
              />
            </section>

            <section className="menu-section set-list" aria-label="Snapping">
              <h3 className="label">Snapping</h3>
              <ChoiceRow
                label="Notes snap to"
                help="The grid: every note lands on a grid line. Sounds: on the nearest sound heard in the song, and the cursor steps from sound to sound. Nothing: exactly where you put it."
                value={snap.snapMode}
                options={snapModes.map((m) => ({ value: m, label: SNAP_MODE_LABEL[m] }))}
                touch={touch}
                onChange={(m) => ctrl.setSnapMode(m)}
              />
              <ChoiceRow
                label="Grid"
                help="How finely a beat is divided: the lines notes snap to and the size of a cursor step."
                value={snap.snap}
                options={SNAPS.map((s) => ({ value: s, label: SNAP_NAME[s] }))}
                touch={touch}
                onChange={(s: Snap) => ctrl.setSnap(s)}
              />
              <MenuButton
                icon={Timer}
                help="Where the beats and bar lines are: follow the song or set a tempo, tap it, move the first beat."
                onClick={then(() => onAsk('tempo'))}
              >
                Tempo and bars
              </MenuButton>
            </section>

            <section className="menu-section set-list" aria-label="Writing">
              <h3 className="label">Writing</h3>
              <ChoiceRow
                label="After a note"
                help="Move on a step: the cursor goes to the next grid line after each note you set down, for writing a run quickly."
                value={snap.advance}
                options={[
                  { value: false, label: 'Stay' },
                  { value: true, label: 'Move on a step' },
                ]}
                touch={touch}
                onChange={(v) => ctrl.setAdvance(v)}
              />
              <ChoiceRow
                label="A recording"
                help="Adds its notes to what is there, or replaces the notes it plays past."
                value={snap.replace}
                options={[
                  { value: false, label: 'Adds notes' },
                  { value: true, label: 'Replaces notes' },
                ]}
                touch={touch}
                onChange={(v) => ctrl.setReplace(v)}
              />
            </section>

            <section className="menu-section set-list" aria-label="Listening">
              <h3 className="label">Listening</h3>
              <ChoiceRow
                label="Speed"
                help="Slower playback for fast passages. Recording works at every speed."
                value={snap.rate}
                options={RATES.map((r) => ({ value: r as number, label: `${Math.round(r * 100)}%` })).reverse()}
                touch={touch}
                onChange={(r) => ctrl.setRate(r)}
              />
              {snap.sources.length > 1 && (
                <ChoiceRow
                  label="Play"
                  help="The whole song, or one of its separated instruments on its own."
                  value={snap.source}
                  options={snap.sources.map((s) => ({ value: s, label: SOURCE_LABEL[s] }))}
                  touch={touch}
                  onChange={(s) => void ctrl.setSource(s)}
                />
              )}
              <ChoiceRow
                label="Loop"
                help="Playback goes round the marked stretch until you stop it."
                value={snap.loop}
                options={ON_OFF}
                touch={touch}
                onChange={(v) => ctrl.setLoop(v)}
              />
              <ChoiceRow
                label="Click on every note"
                help="A tick as each note passes the line, to hear whether it sits on the music."
                value={snap.clicks}
                options={ON_OFF}
                touch={touch}
                onChange={(v) => ctrl.setClicks(v)}
              />
              <ChoiceRow
                label="Metronome"
                help="A click on every beat, higher on the first beat of a bar."
                value={snap.metronome}
                options={ON_OFF}
                touch={touch}
                onChange={(v) => ctrl.setMetronome(v)}
              />
              <StepRow
                label="Zoom"
                help="How much of the song the lanes show."
                text={`${snap.zoom + 1} of ${snap.zoomSteps}`}
                index={snap.zoom}
                count={snap.zoomSteps}
                atMin={snap.zoom <= 0}
                atMax={snap.zoom >= snap.zoomSteps - 1}
                touch={touch}
                onStep={(d) => ctrl.zoomBy(d)}
              />
            </section>

            <section className="menu-section" aria-label="Edit">
              <h3 className="label">Edit</h3>
              <div className="menu-grid">
                <MenuButton icon={Undo2} data-sfx="none" disabled={!snap.canUndo} onClick={() => ctrl.undo()}>
                  Undo
                </MenuButton>
                <MenuButton icon={Redo2} data-sfx="none" disabled={!snap.canRedo} onClick={() => ctrl.redo()}>
                  Redo
                </MenuButton>
                <MenuButton icon={ClipboardPaste} data-sfx="none" disabled={!snap.clipboard} onClick={then(() => ctrl.paste())}>
                  Paste{snap.clipboard ? ` ${snap.clipboard}` : ''}
                </MenuButton>
                <MenuButton icon={SquareDashedMousePointer} disabled={!snap.stats.notes} onClick={then(() => ctrl.selectAll())}>
                  Select all
                </MenuButton>
              </div>
              <MenuButton
                icon={Wrench}
                help={
                  snap.selected
                    ? `Snap, move, reverse, thin out or stretch the ${snap.selected} selected notes.`
                    : 'Snap every note to the grid or to the sounds of the song. Select notes first for more.'
                }
                disabled={!snap.stats.notes && !snap.ranged}
                onClick={then(() => onAsk('tools'))}
              >
                Tools
              </MenuButton>
            </section>

            <section className="menu-section" aria-label="This chart">
              <h3 className="label">This chart</h3>
              <MenuButton
                icon={ListChecks}
                help={
                  snap.issues
                    ? `${snap.issues} ${snap.issues === 1 ? 'place' : 'places'} worth a second look. Pick one to go there.`
                    : 'Nothing stands out in this chart.'
                }
                disabled={!snap.issues}
                onClick={then(() => onAsk('check'))}
              >
                Check the chart
              </MenuButton>
              <MenuButton
                icon={Play}
                help="Play the whole chart in the game, from the top."
                data-sfx="launch"
                disabled={snap.stats.notes === 0}
                onClick={then(() => onTest(true))}
              >
                Test play from the start
              </MenuButton>
              {snap.easier.length > 0 && (
                <MenuButton
                  icon={TrendingDown}
                  help={`Writes ${snap.easier.map((d) => DIFFICULTY_LABEL[d]).join(', ')} as simpler versions of this chart.`}
                  disabled={snap.stats.notes === 0}
                  onClick={then(() => onAsk('easier'))}
                >
                  Write the easier charts from this one
                </MenuButton>
              )}
              {snap.harder && (
                <MenuButton
                  icon={TrendingDown}
                  help={`Replaces this chart with a simpler version of ${DIFFICULTY_LABEL[snap.harder]}.`}
                  onClick={then(() => onAsk('simplify'))}
                >
                  Simplify from {DIFFICULTY_LABEL[snap.harder]}
                </MenuButton>
              )}
              <MenuButton
                icon={CopyPlus}
                help="Replaces this chart with a copy of another part or difficulty."
                onClick={then(() => onAsk('copy-from'))}
              >
                Copy from another chart
              </MenuButton>
              {snap.canRevert && (
                <MenuButton
                  icon={RotateCcw}
                  help="Drops your version for the chart the game wrote from the song."
                  onClick={then(() => onAsk('revert'))}
                >
                  Put back the game’s chart
                </MenuButton>
              )}
              <MenuButton
                icon={Grid3x3}
                help={`Puts every note of this chart on the nearest grid line (${SNAP_NAME[snap.snap].toLowerCase()}).`}
                disabled={snap.stats.notes === 0}
                onClick={then(() => void ctrl.quantizeAll())}
              >
                Quantize all notes
              </MenuButton>
              <MenuButton
                icon={Eraser}
                help="Takes every note out of this chart. It asks first."
                disabled={snap.stats.notes === 0}
                onClick={then(() => onAsk('clear'))}
              >
                Clear all notes
              </MenuButton>
            </section>

            <section className="menu-section menu-legend" aria-label="Controls">
              <h3 className="label">Controls</h3>
              {legend}
            </section>
          </div>
        );
      }}
    </Dialog>
  );
}

/* Tempo ------------------------------------------------------------------------------------ */

/** The beat grid: follow the song or one tempo, the tempo itself, where the bar starts, beats in a bar. */
export function TempoSheet({
  ctrl,
  snap,
  mode,
  onClose,
}: {
  ctrl: EditorController;
  snap: EditorSnapshot;
  mode: InputMode;
  onClose(): void;
}) {
  const touch = mode === 'touch';
  const g = snap.grid;
  const fixed = g.mode === 'fixed';
  const [taps, setTaps] = useState(0);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<boolean | null>(null);
  const live = useRef(true);
  useEffect(() => () => void (live.current = false), []);
  const whole = Math.floor(g.bpm + 1e-6);
  const bpmText = `${g.bpm.toFixed(2).replace(/\.00$/, '')} BPM`;

  return (
    <Dialog
      title="Tempo and bars"
      className="see-through"
      onClose={onClose}
      actions={[
        {
          id: 'play',
          label: snap.playing ? 'Pause' : 'Play',
          icon: snap.playing ? Pause : Play,
          kbd: 'Space',
          pad: 'b3',
          sfx: 'none',
          run: () => ctrl.togglePlay(),
        },
      ]}
    >
      {(close) => (
        <div className="sheet-body editor-menu">
          <div className="sheet-title">
            <h2 className="display">Tempo and bars</h2>
            <p className="hint">
              The grid is what notes snap to. Play the song with the metronome on: when the clicks sit on the beat and the bright lines on
              the first beat of each bar, it is right. Notes stay on their beats when the grid moves.
            </p>
          </div>

          <section className="menu-section set-list" aria-label="Grid">
            {g.canFollow && (
              <ChoiceRow
                label="The grid"
                help="Follows the song: the beats as they were heard, which may drift. One tempo: a steady grid you set yourself."
                value={g.mode}
                autoFocus
                options={[
                  { value: 'song' as const, label: 'Follows the song' },
                  { value: 'fixed' as const, label: 'One tempo' },
                ]}
                touch={touch}
                onChange={(m) => (m === 'song' ? ctrl.followSong() : ctrl.setFixed({}))}
              />
            )}
            <StepRow
              label="Tempo"
              help="Beats a minute, in whole steps."
              text={bpmText}
              autoFocus={!g.canFollow}
              atMin={g.bpm <= MIN_BPM}
              atMax={g.bpm >= MAX_BPM}
              disabled={!fixed}
              touch={touch}
              onStep={(d) => ctrl.setFixed({ bpm: (d > 0 ? whole : Math.ceil(g.bpm - 1e-6)) + d })}
            />
            <StepRow
              label="Tempo, fine"
              help="The same tempo in hundredths, for a grid that drifts off the song near its end."
              text={`${g.bpm.toFixed(2)} BPM`}
              atMin={g.bpm <= MIN_BPM}
              atMax={g.bpm >= MAX_BPM}
              disabled={!fixed}
              touch={touch}
              onStep={(d) => ctrl.setFixed({ bpm: g.bpm + d * 0.01 })}
            />
            <StepRow
              label="First beat"
              help="Moves the whole grid earlier or later, 5 milliseconds a step."
              text={`${Math.round(g.offset * 1000)} ms`}
              atMin={g.offset <= 0}
              disabled={!fixed}
              touch={touch}
              onStep={(d) => ctrl.setFixed({ offset: g.offset + d * 0.005 })}
            />
            <StepRow
              label="Beats in a bar"
              help="How many beats lie between two bar lines."
              text={String(g.beatsPerBar)}
              atMin={g.beatsPerBar <= 2}
              atMax={g.beatsPerBar >= 9}
              disabled={!fixed}
              touch={touch}
              onStep={(d) => ctrl.setFixed({ beatsPerBar: g.beatsPerBar + d })}
            />
            {!fixed && (
              <p className="hint menu-note">
                The grid follows the beats heard in the song, about {Math.round(g.bpm)} BPM. Choose One tempo to set it yourself.
              </p>
            )}
          </section>

          <section className="menu-section" aria-label="Find the tempo">
            <h3 className="label">Find it</h3>
            <button
              type="button"
              className="btn wide menu-btn"
              data-sfx="none"
              onPointerDown={(e) => {
                // Timed from the press itself, not from when the click arrives.
                if (e.pointerType !== 'mouse' || e.button === 0) setTaps(ctrl.tap(e.timeStamp));
              }}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !e.repeat && (e.preventDefault(), setTaps(ctrl.tap(e.timeStamp)))}
              onClick={(e) => e.detail === 0 && setTaps(ctrl.tap())}
            >
              <Hand strokeWidth={ICON_STROKE} aria-hidden />
              <span className="pick-text">
                <span>Tap the beat</span>
                <span className="pick-help">
                  {taps < 1
                    ? 'Press in time with the song, four times or more.'
                    : taps < 4
                      ? `${4 - taps} more…`
                      : `${bpmText}. Keep tapping to steady it.`}
                </span>
              </span>
            </button>
            <MenuButton icon={MoveVertical} help="The bar line moves to where the cursor is." onClick={() => ctrl.firstBeatHere()}>
              A bar starts at the cursor
            </MenuButton>
            <MenuButton
              icon={ListMusic}
              help="The game listens to the song again and sets the tempo it hears."
              disabled={listening}
              onClick={() => {
                setListening(true);
                setHeard(null);
                void ctrl.detect().then((ok) => {
                  if (!live.current) return;
                  setListening(false);
                  setHeard(ok);
                });
              }}
            >
              {listening ? 'Listening…' : 'Listen for the tempo'}
            </MenuButton>
            {heard === false && <p className="error">No steady beat could be heard in this song. Tap it, or set the tempo by hand.</p>}
          </section>

          <section className="menu-section set-list" aria-label="Listening">
            <ChoiceRow
              label="Metronome"
              help="A click on every beat while the song plays, to check the grid by ear."
              value={snap.metronome}
              options={ON_OFF}
              touch={touch}
              onChange={(v) => ctrl.setMetronome(v)}
            />
            <MenuButton icon={snap.playing ? Pause : Play} data-sfx="none" onClick={() => ctrl.togglePlay()}>
              {snap.playing ? 'Pause' : 'Play from the cursor'}
            </MenuButton>
            <MenuButton icon={Check} data-sfx="back" onClick={close}>
              Done
            </MenuButton>
          </section>
        </div>
      )}
    </Dialog>
  );
}

/* Selection -------------------------------------------------------------------------------- */

export interface SelectionAction {
  id: string;
  label: string;
  /** One word for it, where there is room for no more. */
  short: string;
  icon: LucideIcon;
  /** Stays open after it ran (it can be pressed again). */
  stay?: boolean;
  disabled?: boolean;
  run(): void;
}

/** What can be done with the selected notes, the same list wherever it is shown. */
export function selectionActions(ctrl: EditorController, snap: EditorSnapshot): SelectionAction[] {
  return [
    { id: 'repeat', label: 'Repeat after itself', short: 'Repeat', icon: CopyPlus, stay: true, run: () => ctrl.repeat() },
    { id: 'copy', label: 'Copy', short: 'Copy', icon: Copy, run: () => void ctrl.copy() },
    { id: 'cut', label: 'Cut', short: 'Cut', icon: Scissors, run: () => ctrl.cut() },
    {
      id: 'phrase',
      label: snap.selPhrase ? 'Take out of overdrive' : 'Make an overdrive phrase',
      short: 'Overdrive',
      icon: Zap,
      run: () => ctrl.togglePhrase(),
    },
    {
      id: 'release',
      label: snap.selRelease ? 'No need to let go on time' : 'Let go on time',
      short: 'Let go',
      icon: Hand,
      disabled: !snap.selLong,
      run: () => ctrl.toggleRelease(),
    },
    { id: 'mirror', label: 'Mirror left and right', short: 'Mirror', icon: FlipHorizontal2, stay: true, run: () => ctrl.mirror() },
    { id: 'delete', label: 'Delete', short: 'Delete', icon: Trash2, run: () => ctrl.remove() },
  ];
}

/** The selection's actions as a card: what the confirm button opens on a marked stretch. */
export function SelectionCard({
  ctrl,
  snap,
  onTools,
  onClose,
}: {
  ctrl: EditorController;
  snap: EditorSnapshot;
  onTools(): void;
  onClose(): void;
}) {
  return (
    <Dialog title="Selected notes" variant="card" closeLabel="Go back" onClose={onClose}>
      {(close) => (
        <div className="pause-card">
          <h2 className="display">
            {snap.selected} {snap.selected === 1 ? 'note' : 'notes'}
          </h2>
          {snap.selected === 0 && (
            <p className="hint">
              There are no notes in the stretch you marked. Paste sets copied notes down here; Fill, under More tools, writes a note on
              every grid line.
            </p>
          )}
          {snap.selected === 0 && (
            <button type="button" className="btn wide" data-autofocus disabled={!snap.clipboard} onClick={() => (close(), ctrl.paste())}>
              <ClipboardPaste strokeWidth={ICON_STROKE} aria-hidden />
              Paste{snap.clipboard ? ` ${snap.clipboard} notes` : ''}
            </button>
          )}
          {snap.selected > 0 &&
            selectionActions(ctrl, snap).map((a, i) => (
              <button
                key={a.id}
                type="button"
                className="btn wide"
                data-autofocus={i === 0 ? '' : undefined}
                data-sfx={a.id === 'delete' ? 'back' : undefined}
                disabled={a.disabled}
                onClick={() => (a.stay || close(), a.run())}
              >
                <a.icon strokeWidth={ICON_STROKE} aria-hidden />
                {a.label}
              </button>
            ))}
          <button
            type="button"
            className="btn wide"
            data-autofocus={snap.selected === 0 && !snap.clipboard ? '' : undefined}
            onClick={() => (close(), onTools())}
          >
            <Wrench strokeWidth={ICON_STROKE} aria-hidden />
            More tools
          </button>
          <button type="button" className="btn quiet wide" data-sfx="back" onClick={close}>
            Go back
          </button>
        </div>
      )}
    </Dialog>
  );
}

/** Tools that reshape notes: the selection, or for the snapping ones the whole chart when nothing is selected. */
export function ToolsCard({ ctrl, snap, onClose }: { ctrl: EditorController; snap: EditorSnapshot; onClose(): void }) {
  const some = snap.selected > 0;
  const what = some ? `the ${snap.selected} selected ${snap.selected === 1 ? 'note' : 'notes'}` : 'every note of the chart';
  return (
    <Dialog title="Tools" variant="card" className="wide-card" closeLabel="Done" onClose={onClose}>
      {(close) => (
        <div className="pause-card">
          <h2 className="display">Tools</h2>
          <p className="hint">
            {some
              ? `These work on ${what}. Each can be undone.`
              : 'The snapping tools work on the whole chart. Mark or select notes for the others.'}
          </p>
          <MenuButton
            icon={Grid3x3}
            help={`Puts ${what} on the nearest grid line (${SNAP_NAME[snap.snap].toLowerCase()}).`}
            data-autofocus
            disabled={!snap.stats.notes}
            onClick={() => ctrl.quantizeNotes()}
          >
            Snap to the grid
          </MenuButton>
          {snap.hasSounds && (
            <MenuButton
              icon={Waves}
              help={`Moves ${what} onto the nearest sound heard in the song, where one is close.`}
              disabled={!snap.stats.notes}
              onClick={() => ctrl.snapToSounds()}
            >
              Snap to sounds
            </MenuButton>
          )}
          <MenuButton
            icon={Magnet}
            help="A note on every grid line of the marked stretch, in the cursor’s lane."
            disabled={!snap.ranged}
            onClick={() => ctrl.fill()}
          >
            Fill the marked stretch
          </MenuButton>
          <div className="menu-grid">
            <MenuButton icon={ChevronsLeft} disabled={!some} onClick={() => ctrl.shiftLanes(-1)}>
              A lane left
            </MenuButton>
            <MenuButton icon={ChevronsRight} disabled={!some} onClick={() => ctrl.shiftLanes(1)}>
              A lane right
            </MenuButton>
            <MenuButton icon={FastForward} disabled={!some} onClick={() => ctrl.stretch(0.5)}>
              Twice as fast
            </MenuButton>
            <MenuButton icon={Rewind} disabled={!some} onClick={() => ctrl.stretch(2)}>
              Half as fast
            </MenuButton>
          </div>
          <MenuButton
            icon={ArrowLeftRight}
            help="The same rhythm with the lanes in the opposite order."
            disabled={!some}
            onClick={() => ctrl.reverse()}
          >
            Play it backwards
          </MenuButton>
          <MenuButton
            icon={Scissors}
            help="Takes out every other moment, to make a busy passage half as busy."
            disabled={!some}
            onClick={() => ctrl.thin()}
          >
            Thin out
          </MenuButton>
          <button type="button" className="btn quiet wide" data-sfx="back" onClick={close}>
            Done
          </button>
        </div>
      )}
    </Dialog>
  );
}

/* Checking --------------------------------------------------------------------------------- */

/** What stands out in the chart, each a button that goes there. */
export function CheckCard({
  issues,
  where,
  onGo,
  onClose,
}: {
  issues: Issue[];
  where(pos: number): string;
  onGo(issue: Issue): void;
  onClose(): void;
}) {
  const shown = issues.slice(0, 80);
  return (
    <Dialog title="Check the chart" variant="card" className="wide-card" closeLabel="Go back" onClose={onClose}>
      {(close) => (
        <div className="pause-card">
          <h2 className="display">Worth a look</h2>
          <p className="hint">
            {issues.length ? 'None of these stops the chart from being played. Pick one to go there.' : 'Nothing stands out in this chart.'}
          </p>
          <ul className="check-list">
            {shown.map((issue, i) => (
              <li key={i}>
                <button type="button" className="btn wide" data-autofocus={i === 0 ? '' : undefined} onClick={() => (close(), onGo(issue))}>
                  <span className="num check-where">{where(issue.pos)}</span>
                  <span className="check-text">{issue.text}</span>
                </button>
              </li>
            ))}
          </ul>
          {issues.length > shown.length && <p className="hint">And {issues.length - shown.length} more further on.</p>}
          <button type="button" className="btn quiet wide" data-autofocus={issues.length ? undefined : ''} data-sfx="back" onClick={close}>
            Go back
          </button>
        </div>
      )}
    </Dialog>
  );
}

/* Copy from another chart ------------------------------------------------------------------ */

export function CopyFromCard({ ctrl, snap, onClose }: { ctrl: EditorController; snap: EditorSnapshot; onClose(): void }) {
  const [info, setInfo] = useState<Record<ChartKey, { notes: number; edited: boolean }> | null>(null);
  useEffect(() => {
    let live = true;
    void ctrl.summaries().then((s) => live && setInfo(s));
    return () => {
      live = false;
    };
  }, [ctrl]);
  const here = chartKey(snap.part, snap.difficulty);
  return (
    <Dialog title="Copy from another chart" variant="card" className="wide-card" closeLabel="Go back" onClose={onClose}>
      {(close) => (
        <div className="pause-card">
          <h2 className="display">Copy from</h2>
          <p className="hint">
            The chart you pick replaces {PART_LABEL[snap.part]} · {DIFFICULTY_LABEL[snap.difficulty]}. Undo brings the old one back.
          </p>
          <table className="bests copy-grid">
            <thead>
              <tr>
                <td />
                {DIFFICULTIES.map((d) => (
                  <th key={d} scope="col">
                    {DIFFICULTY_LABEL[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PARTS.map((p: Part) => {
                const Icon = PART_ICON[p];
                return (
                  <tr key={p}>
                    <th scope="row">
                      <Icon strokeWidth={ICON_STROKE} aria-hidden />
                      {PART_LABEL[p]}
                    </th>
                    {DIFFICULTIES.map((d: Difficulty) => {
                      const key = chartKey(p, d);
                      const c = info?.[key];
                      // Still being counted, a chart can be picked already; an empty one has nothing to give.
                      const off = key === here || c?.notes === 0;
                      return (
                        <td key={d} className={off ? 'none' : ''}>
                          <button
                            type="button"
                            className="copy-cell"
                            data-autofocus={!off && (p === snap.part || (p === 'lead' && d === 'expert')) ? '' : undefined}
                            disabled={off}
                            aria-label={`${PART_LABEL[p]}, ${DIFFICULTY_LABEL[d]}: ${key === here ? 'this chart' : c ? `${c.notes} notes${c.edited ? ', edited by hand' : ''}` : 'counting'}`}
                            onClick={() => {
                              close();
                              void ctrl.copyFrom(p, d);
                            }}
                          >
                            <span className="num">{key === here ? '·' : c ? c.notes.toLocaleString() : '…'}</span>
                            {c?.edited && key !== here && <span className="copy-edited">Edited</span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button type="button" className="btn quiet wide" data-sfx="back" onClick={close}>
            Go back
          </button>
        </div>
      )}
    </Dialog>
  );
}

/* Questions -------------------------------------------------------------------------------- */

export function AskCard({
  title,
  hint,
  yes,
  onYes,
  onClose,
}: {
  title: string;
  hint: string;
  yes: string;
  onYes(): void;
  onClose(): void;
}) {
  return (
    <Dialog title={title} variant="card" closeLabel="Go back" onClose={onClose}>
      {(close) => (
        <div className="pause-card">
          <h2 className="display">{title}</h2>
          <p className="hint">{hint}</p>
          <button type="button" className="btn wide" data-autofocus data-sfx="back" onClick={close}>
            Go back
          </button>
          <button type="button" className="btn primary wide" onClick={() => (close(), onYes())}>
            {yes}
          </button>
        </div>
      )}
    </Dialog>
  );
}
