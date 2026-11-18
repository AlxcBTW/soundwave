import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Hand,
  Keyboard,
  Monitor,
  RotateCcw,
  SlidersHorizontal,
  Target,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { stemModel, type ModelStatus } from '../analysis/separation/model';
import type { AnalysisDevice } from '../analysis/separation/support';
import { allowOutputList, canPickOutput, listOutputs, type OutputList } from '../audio/output';
import { playSfx } from '../audio/sfx';
import { inDesktopApp } from '../game/displayMode';
import { applyPreset, autoTier, resolveGraphics, type GraphicsPreset, type GraphicsSettings, type Level } from '../game/graphics';
import { DEFAULT_SETTINGS, keyLabel, type DisplayMode, type MotionPref, type RumbleLevel, type Settings } from '../game/settings';
import { PadGlyph, STYLE_LABEL } from '../input/glyphs';
import { getInputMode, usesFocus } from '../input/inputMode';
import { focusEl, focusStart, NAV_EVENT, nearest, TAB_EVENT, type Dir } from '../input/menuNav';
import { PAUSE_INPUT, pads, styleFor, SYSTEM_INPUT, type GlyphStyle } from '../input/pads';
import { dualSenseHaptics, menuPulse, Rumbler } from '../input/rumble';
import { usePads } from '../input/usePads';
import { Hint, useActions, useHints } from './actions';
import { Calibration } from './Calibration';
import { Dialog } from './Dialog';
import { ICON_STROKE } from './icons';
import { useLibraryBackup, type LibraryBackup } from './LibraryBackup';
import { APP_VERSION } from '../app/release';
import { checkForUpdates, updates, type UpdateStatus } from '../app/updates';
import { UpdateCard } from './AppUpdates';

/** What the Updates row says about the update, in a word or two. */
function updateNote(u: UpdateStatus): string {
  switch (u.state) {
    case 'available':
      return `${u.version} is out`;
    case 'downloading':
      return u.total ? `Downloading ${Math.round((u.received / u.total) * 100)}%` : 'Downloading';
    case 'installing':
      return 'Installing';
    case 'checking':
      return 'Checking';
    case 'error':
      return 'Check failed';
    default:
      return APP_VERSION;
  }
}
import { useSlide } from './useSlide';

interface Props {
  settings: Settings;
  /** The stem model on this device, and what it would run on (null while that is being found out). */
  model: ModelStatus;
  device: AnalysisDevice | null;
  onChange(s: Settings): void;
  onBack(): void;
  /** Opened from a paused song: what would disturb the song is switched off. */
  inSong?: boolean;
}

type Tab = 'video' | 'audio' | 'game' | 'keyboard' | 'controller' | 'touch' | 'advanced';
const TABS: [Tab, string, LucideIcon][] = [
  ['video', 'Video', Monitor],
  ['audio', 'Audio', Volume2],
  ['game', 'Gameplay', Target],
  ['keyboard', 'Keyboard', Keyboard],
  ['controller', 'Controller', Gamepad2],
  ['touch', 'Touch', Hand],
  ['advanced', 'Advanced', SlidersHorizontal],
];
const TAB_KEY = 'soundwave.settings-tab';

type KeyGroup = 'keys4' | 'keys5' | 'overdriveKey';
type PadGroup = 'pad4' | 'pad5' | 'padOverdrive';
type Binding = { kind: 'key'; group: KeyGroup; index: number } | { kind: 'pad'; group: PadGroup; index: number };

const RESERVED = new Set(['Escape', 'Enter', 'Tab']);

/** The settings each tab's Restore defaults puts back. */
const FIELDS: Record<Tab, readonly (keyof Settings)[]> = {
  video: ['graphics', 'displayMode', 'uiScale', 'motion'],
  audio: ['volume', 'musicVolume', 'sfxVolume', 'songPreviews', 'muteUnfocused', 'outputDevice', 'outputDeviceName'],
  game: ['noteSpeed', 'offsetMs'],
  keyboard: ['keys4', 'keys5', 'overdriveKey'],
  controller: ['pad4', 'pad5', 'padOverdrive', 'glyphs', 'rumble', 'rumbleHits', 'rumbleMisses', 'rumbleSustains', 'rumbleOverdrive'],
  touch: ['touchHaptics', 'touchOverdriveSide'],
  advanced: ['checkUpdates'],
};

interface Option {
  value: string;
  label: string;
  help?: string;
}
interface Cap {
  id: string;
  name: string;
  content: ReactNode;
  lane?: number;
  listening?: boolean;
  bind?(): void;
}
interface Base {
  id: string;
  label: string;
  help: string;
  disabled?: boolean;
}
type Row =
  | (Base & { kind: 'choice'; value: string; options: Option[]; set(v: string): void })
  | (Base & { kind: 'slider'; value: number; min: number; max: number; step: number; format(v: number): string; set(v: number): void })
  | (Base & { kind: 'action'; button: string; run(): void; note?: ReactNode; danger?: boolean })
  | (Base & { kind: 'keys'; caps: Cap[] })
  | (Base & { kind: 'text'; value: string; set(v: string): void; note?: ReactNode })
  | (Base & { kind: 'info'; body: ReactNode });
interface Section {
  title: string;
  rows: Row[];
}

function loadTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (TABS.some(([id]) => id === t)) return t as Tab;
  } catch {
    /* storage unavailable */
  }
  return 'video';
}

/** Swaps when the input is already used in the same layout, so every lane keeps one input. */
function assign(list: string[], index: number, input: string): string[] {
  const out = [...list];
  const existing = out.indexOf(input);
  if (existing >= 0) out[existing] = out[index];
  out[index] = input;
  return out;
}

const ON_OFF: Option[] = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
];
const LEVELS: Option[] = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];
const PRESET_LABEL: Record<Exclude<GraphicsPreset, 'auto' | 'custom'>, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  ultra: 'Ultra',
};
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function SettingsScreen({ settings, model, device, onChange, onBack, inSong = false }: Props) {
  const [tab, setTabState] = useState<Tab>(loadTab);
  const [binding, setBinding] = useState<Binding | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  /** Asking whether to put the open tab's settings back to their defaults. */
  const [askReset, setAskReset] = useState(false);
  const library = useLibraryBackup(settings);
  const update = useSyncExternalStore(updates.subscribe, updates.snapshot);
  const [updateOpen, setUpdateOpen] = useState(false);
  // A check that found nothing new says so on its button for a few seconds, then the button is
  // ready to check again.
  const [upToDate, setUpToDate] = useState(false);
  const updateWas = useRef(update.state);
  useEffect(() => {
    const was = updateWas.current;
    updateWas.current = update.state;
    if (was !== 'checking' || update.state !== 'current') return;
    setUpToDate(true);
    const done = window.setTimeout(() => setUpToDate(false), 3000);
    return () => {
      clearTimeout(done);
      setUpToDate(false);
    };
  }, [update.state]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [turn, setTurn] = useState<'fwd' | 'back'>('fwd');
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const set = (patch: Partial<Settings>) => onChange({ ...settingsRef.current, ...patch });
  const hints = useHints(settings);
  const snap = usePads();

  const setTab = (t: Tab) => {
    setTurn(TABS.findIndex(([id]) => id === t) >= TABS.findIndex(([id]) => id === tabRef.current) ? 'fwd' : 'back');
    setTabState(t);
    setBinding(null);
    setActiveId(null);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  };
  const tabRef = useRef(tab);
  tabRef.current = tab;

  // Shoulder buttons (Q and E) switch tabs.
  useEffect(() => {
    const onTab = (e: Event) => {
      if (document.querySelector('.calib-card')) return;
      const d = (e as CustomEvent<number>).detail;
      const i = (TABS.findIndex(([id]) => id === tabRef.current) + d + TABS.length) % TABS.length;
      playSfx('tab');
      menuPulse(d < 0 ? 'tab-left' : 'tab-right');
      follow.current = true;
      setTab(TABS[i][0]);
    };
    window.addEventListener(TAB_EVENT, onTab);
    return () => window.removeEventListener(TAB_EVENT, onTab);
  }, []);

  // Switched from the shoulder buttons, focus follows onto the new tab's first setting.
  const follow = useRef(false);
  useEffect(() => {
    // On a narrow screen the tab row scrolls: keep the chosen tab in view.
    document.getElementById(`tab-${tab}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (!follow.current) return;
    follow.current = false;
    const list = document.querySelector('.set-list');
    if (list && usesFocus(getInputMode())) focusStart(list);
  }, [tab]);

  // A key press completes a key binding; Esc cancels the prompt. Nothing else hears the key.
  useEffect(() => {
    if (!binding) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') return setBinding(null);
      if (binding.kind !== 'key' || RESERVED.has(e.code)) return;
      const s = settingsRef.current;
      if (binding.group === 'overdriveKey') onChange({ ...s, overdriveKey: e.code });
      else onChange({ ...s, [binding.group]: assign(s[binding.group], binding.index, e.code) });
      setBinding(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [binding, onChange]);

  // Controller binding prompt: the next input pressed after everything was let go.
  useEffect(() => {
    if (binding?.kind !== 'pad') return;
    let armed = !pads.anyHeld();
    return pads.capture((e) => {
      if (!e.down) {
        if (!pads.anyHeld()) armed = true;
        return true;
      }
      if (e.input === PAUSE_INPUT) {
        setBinding(null);
        return true;
      }
      if (!armed || e.input === SYSTEM_INPUT) return true;
      const s = settingsRef.current;
      if (binding.group === 'padOverdrive') onChange({ ...s, padOverdrive: e.input });
      else onChange({ ...s, [binding.group]: assign(s[binding.group], binding.index, e.input) });
      setBinding(null);
      return true;
    });
  }, [binding, onChange]);

  // A PS5 controller gets 3D haptics when the desktop app can reach it (USB); say which it is.
  const ps5 = snap.pads.some((p) => p.family === 'ps5');
  const [haptics, setHaptics] = useState<boolean | null>(null);
  useEffect(() => {
    if (!ps5 || tab !== 'controller') return setHaptics(null);
    let live = true;
    const check = () => void dualSenseHaptics().then((ok) => live && setHaptics(ok));
    check();
    const timer = setInterval(check, 4000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [ps5, tab]);

  // The audio outputs, kept current while the Audio tab is open (plugging one in changes the list).
  const [outputs, setOutputs] = useState<OutputList>({ devices: [], listed: false });
  const [outputsRefused, setOutputsRefused] = useState(false);
  useEffect(() => {
    if (tab !== 'audio' || !canPickOutput()) return;
    let live = true;
    const load = () => void listOutputs().then((o) => live && setOutputs(o));
    load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => {
      live = false;
      navigator.mediaDevices.removeEventListener('devicechange', load);
    };
  }, [tab]);
  const askOutputs = async () => {
    const ok = await allowOutputList();
    setOutputsRefused(!ok);
    if (ok) setOutputs(await listOutputs());
  };

  const resetTab = () => {
    const patch: Partial<Settings> = {};
    for (const f of FIELDS[tab]) (patch as Record<string, unknown>)[f] = structuredClone(DEFAULT_SETTINGS[f]);
    set(patch);
  };

  useActions([
    { id: 'back', label: 'Back', icon: ArrowLeft, kbd: 'Escape', sfx: 'back', run: onBack },
    { id: 'reset', label: 'Restore defaults', icon: RotateCcw, kbd: 'KeyR', pad: 'b3', run: () => setAskReset(true) },
  ]);

  const sections = buildSections(tab, {
    settings,
    set,
    binding,
    setBinding,
    snap,
    haptics,
    model,
    device,
    library,
    update,
    upToDate,
    showUpdate: () => setUpdateOpen(true),
    calibrate: () => setCalibrating(true),
    inSong,
    outputs,
    outputsRefused,
    askOutputs: () => void askOutputs(),
  });
  const rows = sections.flatMap((s) => s.rows);
  const active = rows.find((r) => r.id === activeId) ?? rows[0];
  const tabRow = useSlide<HTMLDivElement>(tab);
  const tabName = TABS.find(([id]) => id === tab)![1];

  return (
    <div className="page settings">
      <header className="page-head settings-head">
        <h1 className="page-title">Settings</h1>
        <p className="head-count tab-name" aria-hidden>
          {tabName}
        </p>
        <div className="tabs">
          <Hint kbd="KeyQ" pad="b4" {...hints} />
          <div className="tab-row slide" role="tablist" aria-label="Settings sections" ref={tabRow} data-nav-group="tabs">
            <span className="sel" aria-hidden />
            {TABS.map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={tab === id}
                aria-controls="settings-panel"
                aria-label={label}
                title={label}
                data-on={tab === id}
                className={`tab ${tab === id ? 'on' : ''}`}
                onClick={() => setTab(id)}
              >
                <Icon strokeWidth={ICON_STROKE} aria-hidden />
                <span className="tab-label">{label}</span>
              </button>
            ))}
          </div>
          <Hint kbd="KeyE" pad="b5" {...hints} />
        </div>
      </header>

      <div className="settings-body">
        <div
          className={`set-list ${turn}`}
          key={tab}
          id="settings-panel"
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          data-nav-group="settings"
        >
          {sections.map((sec) => (
            <section key={sec.title} className="set-section">
              <h2 className="set-heading">{sec.title}</h2>
              {sec.rows.map((row, i) => (
                <RowView
                  key={row.id}
                  row={row}
                  active={active?.id === row.id}
                  first={sec === sections[0] && i === 0}
                  touch={hints.mode === 'touch'}
                  onActive={() => setActiveId(row.id)}
                />
              ))}
            </section>
          ))}
        </div>
        <aside className="set-detail" aria-live="polite">
          {active && <Detail row={active} key={active.id} />}
        </aside>
      </div>

      {askReset && (
        <Dialog title="Restore defaults" variant="card" closeLabel="Keep my settings" onClose={() => setAskReset(false)}>
          {(close) => (
            <div className="pause-card">
              <h2 className="display">Restore the {tabName} defaults?</h2>
              <p className="hint">Every setting on this tab goes back to how the game came. The other tabs stay as they are.</p>
              <button type="button" className="btn wide" data-autofocus data-sfx="back" onClick={close}>
                Keep my settings
              </button>
              <button
                type="button"
                className="btn primary wide"
                onClick={() => {
                  resetTab();
                  setAskReset(false);
                }}
              >
                Restore defaults
              </button>
            </div>
          )}
        </Dialog>
      )}
      {library.ui}
      {updateOpen && <UpdateCard onClose={() => setUpdateOpen(false)} />}
      {calibrating && (
        <Calibration
          onDone={(ms) => {
            setCalibrating(false);
            if (ms !== null) set({ offsetMs: ms });
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */
/* What each tab holds                                                                          */

interface Ctx {
  settings: Settings;
  set(patch: Partial<Settings>): void;
  binding: Binding | null;
  setBinding(b: Binding): void;
  snap: ReturnType<typeof usePads>;
  haptics: boolean | null;
  model: ModelStatus;
  device: AnalysisDevice | null;
  library: LibraryBackup;
  update: UpdateStatus;
  /** A check just found nothing new (for a few seconds after it). */
  upToDate: boolean;
  /** Opens the card that offers the update found. */
  showUpdate(): void;
  calibrate(): void;
  inSong: boolean;
  outputs: OutputList;
  outputsRefused: boolean;
  askOutputs(): void;
}

function buildSections(tab: Tab, c: Ctx): Section[] {
  const { settings: s, set } = c;
  const toggle = (id: string, label: string, help: string, value: boolean, change: (v: boolean) => void, disabled = false): Row => ({
    kind: 'choice',
    id,
    label,
    help,
    disabled,
    value: value ? 'on' : 'off',
    options: ON_OFF,
    set: (v) => change(v === 'on'),
  });

  if (tab === 'video') {
    const g = s.graphics;
    // Auto shows what it picked; touching any option turns that into a custom setup.
    const shown = resolveGraphics(g);
    const setG = (patch: Partial<GraphicsSettings>) =>
      set({ graphics: { ...shown, ...patch, preset: 'custom', camera: patch.camera ?? g.camera } });
    const level = (id: 'crowd' | 'beams' | 'lights' | 'effects', label: string, help: string): Row => ({
      kind: 'choice',
      id,
      label,
      help,
      value: shown[id],
      options: LEVELS,
      set: (v) => setG({ [id]: v as Level }),
    });
    const presets: Option[] = [
      { value: 'auto', label: `Auto (${PRESET_LABEL[autoTier()]})`, help: 'Picked for this device’s graphics hardware.' },
      ...(['low', 'medium', 'high', 'ultra'] as const).map((p) => ({ value: p, label: PRESET_LABEL[p] })),
      ...(g.preset === 'custom' ? [{ value: 'custom', label: 'Custom', help: 'Your own mix of the options below.' }] : []),
    ];
    const display: Section[] = inDesktopApp()
      ? [
          {
            title: 'Display',
            rows: [
              {
                kind: 'choice',
                id: 'displayMode',
                label: 'Window mode',
                help: 'How the game fills the screen. Alt+Enter or F11 switches between fullscreen and the window mode you used last.',
                value: s.displayMode,
                options: [
                  { value: 'fullscreen', label: 'Fullscreen', help: 'The game takes over the whole screen.' },
                  {
                    value: 'borderless',
                    label: 'Windowed fullscreen',
                    help: 'A borderless window that fills the screen. Switching to other apps stays instant.',
                  },
                  {
                    value: 'windowed',
                    label: 'Window',
                    help: 'A window without a title bar. Drag its top edge to move it and its sides to resize it.',
                  },
                ],
                set: (v) => set({ displayMode: v as DisplayMode }),
              },
            ],
          },
        ]
      : [];
    return [
      ...display,
      {
        title: 'Interface',
        rows: [
          {
            kind: 'slider',
            id: 'uiScale',
            label: 'Interface size',
            help: 'Makes every menu larger or smaller. The interface already grows with the window; this adjusts it for your eyes and your distance from the screen.',
            value: s.uiScale,
            min: 0.85,
            max: 1.3,
            step: 0.05,
            format: pct,
            set: (v) => set({ uiScale: v }),
          },
          {
            kind: 'choice',
            id: 'motion',
            label: 'Menu motion',
            help: 'How much the menus move.',
            value: s.motion,
            options: [
              { value: 'system', label: 'System', help: 'Follows the reduced motion setting of your device.' },
              { value: 'full', label: 'Full', help: 'Screens slide, the focus ring travels, results count up.' },
              { value: 'reduced', label: 'Reduced', help: 'Changes appear in place without sliding or bouncing.' },
            ],
            set: (v) => set({ motion: v as MotionPref }),
          },
        ],
      },
      {
        title: 'Stage',
        rows: [
          {
            kind: 'choice',
            id: 'preset',
            label: 'Quality',
            help: 'The highway always runs at full quality. These settings only change the stage behind it.',
            value: g.preset,
            options: presets,
            set: (v) => set({ graphics: applyPreset(g, v as GraphicsPreset) }),
          },
          {
            kind: 'slider',
            id: 'resolution',
            label: 'Stage resolution',
            help: 'Render size of the stage relative to the screen. Lower is faster and softer.',
            value: shown.resolution,
            min: 0.5,
            max: 1,
            step: 0.05,
            format: pct,
            set: (v) => setG({ resolution: v }),
          },
          toggle(
            'dynamicResolution',
            'Adaptive resolution',
            'Lowers the stage resolution for a moment when frames run long.',
            shown.dynamicResolution,
            (v) => setG({ dynamicResolution: v }),
          ),
          {
            kind: 'choice',
            id: 'fpsCap',
            label: 'Stage frame rate',
            help: 'Caps how often the stage redraws. The highway is never capped.',
            value: String(shown.fpsCap),
            options: [
              { value: '0', label: 'Display' },
              { value: '30', label: '30' },
              { value: '60', label: '60' },
              { value: '120', label: '120' },
            ],
            set: (v) => setG({ fpsCap: Number(v) as GraphicsSettings['fpsCap'] }),
          },
          toggle('antialias', 'Smooth edges', 'Removes jagged edges on the stage.', shown.antialias, (v) => setG({ antialias: v })),
          toggle('glow', 'Glow', 'A bloom around bright lights.', shown.glow, (v) => setG({ glow: v })),
          level('crowd', 'Crowd', 'How many people fill the field.'),
          level('beams', 'Beams', 'Moving light beams in the haze.'),
          level('lights', 'Lights and bulbs', 'Washes, bulbs and glowing details.'),
          level('effects', 'Fireworks and smoke', 'Fireworks and smoke jets on big moments.'),
          {
            kind: 'choice',
            id: 'camera',
            label: 'Camera',
            help: 'How the camera moves around the stage.',
            value: g.camera,
            options: [
              { value: 'auto', label: 'Director', help: 'Cuts between shots with the music.' },
              { value: 'calm', label: 'Calm', help: 'Slow wide shots, few cuts.' },
              { value: 'fixed', label: 'Fixed', help: 'One view from the crowd.' },
            ],
            set: (v) => set({ graphics: { ...g, camera: v as GraphicsSettings['camera'] } }),
          },
        ],
      },
    ];
  }

  if (tab === 'audio') {
    const volume = (id: 'volume' | 'musicVolume' | 'sfxVolume', label: string, help: string): Row => ({
      kind: 'slider',
      id,
      label,
      help,
      value: s[id],
      min: 0,
      max: 1,
      step: 0.05,
      format: pct,
      set: (v) => set({ [id]: v }),
    });
    // Browsers add the USB id to a device's name: "Headset (046d:0a44)".
    const tidy = (label: string) => label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');
    const outputRow = (): Row => {
      const base = { id: 'outputDevice', label: 'Output device' };
      if (!canPickOutput()) {
        return {
          ...base,
          kind: 'info',
          help: 'This browser always plays through the system’s default output. To hear the game somewhere else, change the output in the system’s sound settings.',
          body: 'System default',
        };
      }
      if (!c.outputs.listed) {
        return {
          ...base,
          kind: 'action',
          button: 'Show devices',
          run: c.askOutputs,
          help: c.outputsRefused
            ? 'Microphone access was refused, so the outputs cannot be listed. The game plays through the system’s default output.'
            : 'The game plays through the system’s default output. To list speakers and headphones by name, the browser first asks for microphone access. The microphone is closed again at once and nothing is recorded.',
        };
      }
      const options: Option[] = [
        { value: '', label: 'System default', help: 'Follows the output the system is set to.' },
        ...c.outputs.devices.map((d) => ({ value: d.id, label: tidy(d.label) })),
      ];
      if (s.outputDevice && !options.some((o) => o.value === s.outputDevice)) {
        options.push({
          value: s.outputDevice,
          label: s.outputDeviceName || 'Unknown device',
          help: 'Not connected. The system default plays until it is back.',
        });
      }
      return {
        ...base,
        kind: 'choice',
        help: 'Where the game’s sound plays: songs, menu music and interface sounds together.',
        value: s.outputDevice,
        options,
        set: (v) => set({ outputDevice: v, outputDeviceName: v ? (options.find((o) => o.value === v)?.label ?? '') : '' }),
      };
    };
    return [
      {
        title: 'Volume',
        rows: [
          volume('volume', 'Songs', 'The songs you play and their previews.'),
          volume('musicVolume', 'Menu music', 'The theme behind the menus.'),
          volume('sfxVolume', 'Interface sounds', 'Moves, presses and the results fanfare.'),
        ],
      },
      {
        title: 'Menus',
        rows: [
          toggle(
            'songPreviews',
            'Song previews',
            'Plays a part of a song while you are on it in the music library or on the Edit tab, or while its page is open. Off, the menu music keeps playing there.',
            s.songPreviews,
            (v) => set({ songPreviews: v }),
          ),
        ],
      },
      {
        title: 'Output',
        rows: [
          outputRow(),
          toggle(
            'muteUnfocused',
            'Mute in the background',
            'Silences the game while its window is not the one in front, and brings the sound back when you return to it. A song keeps running unless the window is hidden, which pauses it.',
            s.muteUnfocused,
            (v) => set({ muteUnfocused: v }),
          ),
        ],
      },
    ];
  }

  if (tab === 'game') {
    return [
      {
        title: 'Highway',
        rows: [
          {
            kind: 'slider',
            id: 'noteSpeed',
            label: 'Note speed',
            help: 'How fast notes travel down the highway. Faster spreads dense passages apart; slower gives more time to read.',
            value: s.noteSpeed,
            min: 5,
            max: 16,
            step: 0.5,
            format: (v) => v.toFixed(1),
            set: (v) => set({ noteSpeed: v }),
          },
        ],
      },
      {
        title: 'Timing',
        rows: [
          {
            kind: 'slider',
            id: 'offsetMs',
            label: 'Audio offset',
            help: 'If notes feel late, raise the offset. If they feel early, lower it. Wireless speakers and TVs usually need a higher value.',
            value: s.offsetMs,
            min: -200,
            max: 300,
            step: 5,
            format: (v) => `${Math.round(v)} ms`,
            set: (v) => set({ offsetMs: Math.round(v) }),
          },
          {
            kind: 'action',
            id: 'calibrate',
            label: 'Calibrate by tapping',
            help: c.inSong
              ? 'Tap along to twenty clicks. This needs the song out of the way: open it from the main menu.'
              : 'Tap along to twenty clicks. The offset is set from how early or late you tapped.',
            button: 'Start',
            disabled: c.inSong,
            run: c.calibrate,
          },
        ],
      },
    ];
  }

  if (tab === 'keyboard') {
    const cap = (group: KeyGroup, index: number, code: string, lane?: number): Cap => ({
      id: `${group}${index}`,
      name: lane !== undefined ? `Lane ${lane + 1}: ${keyLabel(code)}` : `Overdrive: ${keyLabel(code)}`,
      lane,
      listening: c.binding?.kind === 'key' && c.binding.group === group && c.binding.index === index,
      content: keyLabel(code),
      bind: () => c.setBinding({ kind: 'key', group, index }),
    });
    const help =
      c.binding?.kind === 'key'
        ? 'Press the key to use. Esc cancels.'
        : 'Select a key, then press the key to use instead. A key already in the row swaps places.';
    return [
      {
        title: 'Lane keys',
        rows: [
          {
            kind: 'keys',
            id: 'keys4',
            label: 'Easy, Medium, Hard',
            help: `Four lanes. ${help}`,
            caps: s.keys4.map((k, i) => cap('keys4', i, k, i)),
          },
          { kind: 'keys', id: 'keys5', label: 'Expert', help: `Five lanes. ${help}`, caps: s.keys5.map((k, i) => cap('keys5', i, k, i)) },
          {
            kind: 'keys',
            id: 'overdriveKey',
            label: 'Overdrive',
            help: `Starts overdrive when the meter is at least a quarter full. ${help} Esc always pauses.`,
            caps: [cap('overdriveKey', 0, s.overdriveKey)],
          },
        ],
      },
    ];
  }

  if (tab === 'controller') {
    const detected = styleFor(c.snap.family);
    const style: GlyphStyle = s.glyphs === 'auto' ? detected : s.glyphs;
    const cap = (group: PadGroup, index: number, input: string, lane?: number): Cap => ({
      id: `${group}${index}`,
      name: lane !== undefined ? `Lane ${lane + 1}` : 'Overdrive',
      lane,
      listening: c.binding?.kind === 'pad' && c.binding.group === group && c.binding.index === index,
      content: <PadGlyph input={input} style={style} />,
      bind: () => c.setBinding({ kind: 'pad', group, index }),
    });
    const help =
      c.binding?.kind === 'pad'
        ? 'Press a button, trigger or stick direction. The pause button or Esc cancels.'
        : 'Select a button, then press the one to use instead. Buttons, triggers and stick directions can all be bound.';
    const none = !c.snap.pads.length;
    const ps5 = c.snap.pads.some((p) => p.family === 'ps5');
    return [
      {
        title: 'Controllers',
        rows: [
          {
            kind: 'info',
            id: 'connected',
            label: 'Connected',
            help: 'Every controller the game can see. Press any button on a controller to wake it.',
            body: none ? (
              <span className="dim">None found. Connect one and press any button on it.</span>
            ) : (
              <ul className="pad-list">
                {c.snap.pads.map((p) => (
                  <li key={p.index}>
                    <span className="pad-name">{p.name}</span>
                    <span className="pill">{p.family === 'generic' ? 'Other controller' : STYLE_LABEL[styleFor(p.family)]}</span>
                    {!p.standard && <span className="dim">Unusual layout: bind its buttons below.</span>}
                  </li>
                ))}
              </ul>
            ),
          },
          {
            kind: 'choice',
            id: 'glyphs',
            label: 'Button symbols',
            help: 'Which controller’s symbols the game shows.',
            value: s.glyphs,
            options: [
              { value: 'auto', label: `Auto (${STYLE_LABEL[detected]})`, help: 'Matches the controller you used last.' },
              ...(['xbox', 'ps4', 'ps5', 'switch'] as const).map((v) => ({ value: v, label: STYLE_LABEL[v] })),
            ],
            set: (v) => set({ glyphs: v as Settings['glyphs'] }),
          },
        ],
      },
      {
        title: 'Lane buttons',
        rows: [
          {
            kind: 'keys',
            id: 'pad4',
            label: 'Easy, Medium, Hard',
            help: `Four lanes. ${help}`,
            caps: s.pad4.map((b, i) => cap('pad4', i, b, i)),
          },
          { kind: 'keys', id: 'pad5', label: 'Expert', help: `Five lanes. ${help}`, caps: s.pad5.map((b, i) => cap('pad5', i, b, i)) },
          {
            kind: 'keys',
            id: 'padOverdrive',
            label: 'Overdrive and pause',
            help: `${help} Pause is always the same button.`,
            caps: [
              cap('padOverdrive', 0, s.padOverdrive),
              { id: 'pause', name: 'Pause (fixed)', content: <PadGlyph input={PAUSE_INPUT} style={style} /> },
            ],
          },
        ],
      },
      {
        title: 'Rumble',
        rows: [
          {
            kind: 'choice',
            id: 'rumble',
            label: 'Strength',
            help: 'How hard the controller shakes, in menus and in songs.',
            value: s.rumble,
            options: [
              { value: 'off', label: 'Off' },
              { value: 'weak', label: 'Weak' },
              { value: 'strong', label: 'Strong' },
            ],
            set: (v) => set({ rumble: v as RumbleLevel }),
          },
          toggle('rumbleHits', 'Hits', 'A pulse on every note you hit.', s.rumbleHits, (v) => set({ rumbleHits: v }), s.rumble === 'off'),
          toggle(
            'rumbleMisses',
            'Misses',
            'A dull thud on a missed note.',
            s.rumbleMisses,
            (v) => set({ rumbleMisses: v }),
            s.rumble === 'off',
          ),
          toggle(
            'rumbleSustains',
            'Held notes',
            'A hum while a long note is held.',
            s.rumbleSustains,
            (v) => set({ rumbleSustains: v }),
            s.rumble === 'off',
          ),
          toggle(
            'rumbleOverdrive',
            'Overdrive',
            'A pulse on every beat while overdrive lasts.',
            s.rumbleOverdrive,
            (v) => set({ rumbleOverdrive: v }),
            s.rumble === 'off',
          ),
          {
            kind: 'action',
            id: 'testRumble',
            label: 'Test rumble',
            help: 'Plays one pulse per lane, left to right.',
            button: 'Test',
            disabled: none || s.rumble === 'off',
            run: () => {
              const r = new Rumbler(s, 5, s.pad5);
              void r.test().then(() => setTimeout(() => r.dispose(), 5 * 160 + 600));
            },
          },
          ...(ps5
            ? [
                {
                  kind: 'info' as const,
                  id: 'haptics',
                  label: 'PS5 haptics',
                  help: 'With 3D haptics, hits play on the left or right motor following the lane, with a different feel for hits, misses, held notes and overdrive.',
                  body:
                    c.haptics === null
                      ? 'Checking the controller…'
                      : c.haptics
                        ? '3D haptics on.'
                        : inDesktopApp()
                          ? 'Connect the controller with a USB cable for 3D haptics. Over Bluetooth it uses standard rumble.'
                          : '3D haptics work in the desktop app with a USB cable. Here it uses standard rumble.',
                },
              ]
            : []),
        ],
      },
    ];
  }

  if (tab === 'touch') {
    return [
      {
        title: 'Touch play',
        rows: [
          {
            kind: 'info',
            id: 'touchHow',
            label: 'How it works',
            help: 'On a touchscreen the lanes are the controls. A tap anywhere along a lane plays it, several fingers at once play chords, and a finger that stays down holds a long note. The squares at the foot of the lanes show where the notes are due.',
            body: 'Tap a lane to play it. Hold for long notes.',
          },
          toggle(
            'touchHaptics',
            'Tap vibration',
            'A short vibration on every pad press, on devices that can vibrate.',
            s.touchHaptics,
            (v) => set({ touchHaptics: v }),
          ),
          {
            kind: 'choice',
            id: 'touchOverdriveSide',
            label: 'Overdrive button',
            help: 'Which side of the screen the overdrive button sits on during a song.',
            value: s.touchOverdriveSide,
            options: [
              { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' },
            ],
            set: (v) => set({ touchOverdriveSide: v as Settings['touchOverdriveSide'] }),
          },
        ],
      },
    ];
  }

  const m = c.model;
  const mb = (n: number) => `${Math.round(n / 1e6)} MB`;
  const unsupported = c.device === 'none';
  const modelNote = unsupported ? (
    <span className="pill">Not used here</span>
  ) : m.state === 'ready' ? (
    <span className="pill ready">Ready</span>
  ) : m.state === 'downloading' ? (
    <span className="pill">{`${Math.round((m.received / m.total) * 100)}% of ${mb(m.total)}`}</span>
  ) : m.state === 'error' ? (
    <span className="pill error">Failed</span>
  ) : (
    <span className="pill">{m.state === 'absent' ? 'Not downloaded' : 'Checking…'}</span>
  );
  const modelHelp = `Before a song is charted it is split into drums, bass, vocals and the other instruments, so each part follows its own instrument. The model that does this (Demucs, ${mb(stemModel.bytes)}) is downloaded once and kept on this device.${m.state === 'error' && m.error ? ` ${m.error}` : ''}`;
  const lib = c.library;
  const u = c.update;
  const updateRows: Row[] =
    u.state === 'unsupported'
      ? [
          {
            kind: 'info',
            id: 'version',
            label: 'Version',
            help: 'The game in the browser is always the newest release: there is nothing to update here. The desktop app looks for updates itself.',
            body: APP_VERSION,
          },
        ]
      : [
          {
            kind: 'action',
            id: 'checkForUpdates',
            label: 'Updates',
            button:
              u.state === 'available'
                ? 'Install'
                : u.state === 'checking'
                  ? 'Checking…'
                  : u.state === 'current' && c.upToDate
                    ? 'Up to date'
                    : 'Check now',
            disabled: u.state === 'checking' || u.state === 'downloading' || u.state === 'installing',
            run:
              u.state === 'available' || u.state === 'downloading' || u.state === 'installing'
                ? c.showUpdate
                : () => void checkForUpdates(),
            // Being up to date is said on the button, for a moment (see upToDate), not beside it.
            note:
              u.state === 'current' ? undefined : (
                <span className={`pill ${u.state === 'available' ? 'lit' : u.state === 'error' ? 'error' : ''}`}>{updateNote(u)}</span>
              ),
            help: `You have version ${APP_VERSION}. The game looks for a newer release on GitHub and, when you say so, downloads it, checks that it is genuine, installs it and starts again. Your library, scores and settings stay.${u.state === 'error' ? ` ${u.message}` : ''}`,
          },
          toggle(
            'checkUpdates',
            'Look for updates on start',
            'When the game starts it asks GitHub whether a new release is out, and the main menu shows an Update button when there is one. Nothing is installed until you choose to.',
            s.checkUpdates,
            (v) => set({ checkUpdates: v }),
          ),
        ];
  return [
    { title: 'Updates', rows: updateRows },
    {
      title: 'Your library',
      rows: [
        {
          kind: 'action',
          id: 'exportLibrary',
          label: 'Export library',
          button: 'Export',
          disabled: lib.busy,
          run: lib.exportLibrary,
          note: lib.exportNote,
          help: 'Saves every song with its charts, the charts you edited by hand, your best scores and your settings in one file, to move the game to another computer or keep a copy safe. Separated stems are left out: a song makes them again when it is analyzed again.',
        },
        {
          kind: 'action',
          id: 'importLibrary',
          label: 'Import library',
          button: 'Import',
          disabled: lib.busy || c.inSong,
          run: lib.importLibrary,
          note: lib.importNote,
          help: c.inSong
            ? 'Leave the song first: importing restarts the game.'
            : 'Adds the songs from a library backup with their charts, keeps the better of each best score, and takes over the backup’s settings. Songs you already have stay as they are. The game restarts afterwards.',
        },
        {
          kind: 'action',
          id: 'deleteEverything',
          label: 'Delete everything',
          button: 'Delete',
          danger: true,
          disabled: lib.busy || c.inSong,
          run: lib.deleteEverything,
          help: c.inSong
            ? 'Leave the song first: deleting everything restarts the game.'
            : 'Deletes every song with its charts, the charts you edited by hand and all best scores, and puts every setting back to how the game came. It asks first, and you hold the button to confirm. The downloaded analysis model stays.',
        },
      ],
    },
    {
      title: 'Song analysis',
      rows: [
        // A button only while there is something to press it for.
        m.state === 'absent' || m.state === 'error'
          ? {
              kind: 'action',
              id: 'stemModel',
              label: 'Analysis model',
              help: modelHelp,
              button: m.state === 'error' ? 'Try again' : 'Download',
              disabled: unsupported,
              run: () => void stemModel.ensure().catch(() => {}),
              note: modelNote,
            }
          : { kind: 'info', id: 'stemModel', label: 'Analysis model', help: modelHelp, body: modelNote },
        {
          kind: 'info',
          id: 'analysisDevice',
          label: 'Runs on',
          help: 'On a graphics card a song takes about a minute. Without one the processor does the work, which takes several minutes per song. Phones and tablets do not have the memory for it: they can play songs that were analyzed elsewhere or charted by hand, but not analyze songs.',
          body:
            c.device === 'gpu'
              ? 'Graphics card'
              : c.device === 'cpu'
                ? 'Processor (slower)'
                : c.device === 'none'
                  ? 'Not available on this device'
                  : 'Checking…',
        },
      ],
    },
  ];
}

/* ------------------------------------------------------------------------------------------- */
/* Rows                                                                                         */

/** Lets a row answer left and right itself (see menuNav), for the keyboard and controllers alike. */
function useSideways(ref: React.RefObject<HTMLElement | null>, step: (d: -1 | 1) => void, on = true) {
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    const onNav = (e: Event) => {
      const dir = (e as CustomEvent<{ dir: Dir }>).detail.dir;
      if (dir !== 'left' && dir !== 'right') return;
      e.preventDefault();
      stepRef.current(dir === 'left' ? -1 : 1);
    };
    el.addEventListener(NAV_EVENT, onNav);
    return () => el.removeEventListener(NAV_EVENT, onNav);
  }, [ref, on]);
}

/**
 * A row of bindings moves the focus itself. Left and right go through its buttons in order (also
 * onto a second line where the row wraps) and stop at its ends. Up and down go to the button above
 * or below: on another line of this row, else in the next row when that holds bindings too, so a
 * short row (overdrive, one button) is not passed over from a button that is not right above it.
 */
function useBindingMoves(ref: React.RefObject<HTMLElement | null>, on: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    const capsOf = (row: Element) => [...row.querySelectorAll<HTMLElement>('button.keycap')];
    const onNav = (e: Event) => {
      const dir = (e as CustomEvent<{ dir: Dir }>).detail.dir;
      const from = e.target as HTMLElement;
      const caps = capsOf(el);
      const at = caps.indexOf(from);
      if (at < 0) return;
      if (dir === 'left' || dir === 'right') {
        e.preventDefault();
        const next = caps[at + (dir === 'left' ? -1 : 1)];
        if (next) focusEl(next);
        return;
      }
      const pick = (list: HTMLElement[]) =>
        list[
          nearest(
            from.getBoundingClientRect(),
            dir,
            list.map((c) => c.getBoundingClientRect()),
          )
        ];
      let to = pick(caps.filter((c) => c !== from));
      if (!to) {
        const rows = [...(el.closest('.set-list')?.querySelectorAll<HTMLElement>('.set-row') ?? [])].filter(
          (r) => r.tabIndex >= 0 || r.querySelector('button:not([disabled]):not([tabindex="-1"])'),
        );
        const next = rows[rows.indexOf(el) + (dir === 'down' ? 1 : -1)];
        if (next?.classList.contains('keys')) to = pick(capsOf(next));
      }
      if (!to) return;
      e.preventDefault();
      focusEl(to);
    };
    el.addEventListener(NAV_EVENT, onNav);
    return () => el.removeEventListener(NAV_EVENT, onNav);
  }, [ref, on]);
}

function RowView({ row, active, first, touch, onActive }: { row: Row; active: boolean; first: boolean; touch: boolean; onActive(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const index =
    row.kind === 'choice'
      ? Math.max(
          0,
          row.options.findIndex((o) => o.value === row.value),
        )
      : 0;

  const step = (d: -1 | 1, wrap = false) => {
    if (row.disabled) return;
    if (row.kind === 'choice') {
      const n = row.options.length;
      const next = wrap ? (index + d + n) % n : Math.min(n - 1, Math.max(0, index + d));
      if (next === index) return;
      playSfx(d > 0 ? 'toggle-on' : 'toggle-off');
      row.set(row.options[next].value);
    } else if (row.kind === 'slider') {
      const next = Math.min(row.max, Math.max(row.min, Math.round((row.value + d * row.step) / row.step) * row.step));
      if (next === row.value) return;
      playSfx('move');
      row.set(Number(next.toFixed(4)));
    }
  };
  useSideways(ref, (d) => step(d), row.kind !== 'keys');
  useBindingMoves(ref, row.kind === 'keys');

  // A touch screen reader cannot send a slider its arrow keys, so on touch the row is a group whose
  // step buttons are the controls; everywhere else the row itself is the slider.
  const valueProps = (min: number, max: number, now: number, text: string) =>
    touch
      ? ({ role: 'group', 'aria-label': `${row.label}: ${text}` } as const)
      : ({
          role: 'slider',
          'aria-label': row.label,
          'aria-valuemin': min,
          'aria-valuemax': max,
          'aria-valuenow': now,
          'aria-valuetext': text,
        } as const);
  const stepProps = (d: -1 | 1) => (touch ? { 'aria-label': `${d < 0 ? 'Lower' : 'Raise'} ${row.label}` } : { 'aria-hidden': true });

  const common = {
    ref,
    className: `set-row ${row.kind} ${active ? 'active' : ''} ${row.disabled ? 'disabled' : ''}`,
    onFocus: onActive,
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === 'mouse' && onActive(),
    onPointerDown: onActive,
    'data-autofocus': first ? '' : undefined,
  };
  const help = <p className="set-help">{row.help}</p>;

  if (row.kind === 'choice') {
    const opt = row.options[index];
    return (
      <div
        {...common}
        {...valueProps(0, row.options.length - 1, index, opt?.label ?? '')}
        tabIndex={0}
        data-sfx="none"
        aria-disabled={row.disabled}
        onClick={() => step(1, true)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), step(1, true))}
      >
        <span className="set-label">{row.label}</span>
        <span className="set-control">
          <button
            type="button"
            className="step"
            tabIndex={-1}
            data-sfx="none"
            {...stepProps(-1)}
            disabled={row.disabled || index === 0}
            onClick={(e) => (e.stopPropagation(), step(-1))}
          >
            <ChevronLeft strokeWidth={3} />
          </button>
          <span className="set-value">
            <span className="set-value-text" key={row.value}>
              {opt?.label}
            </span>
            <span className="ticks" aria-hidden>
              {row.options.map((o, i) => (
                <span key={o.value} className={i === index ? 'on' : ''} />
              ))}
            </span>
          </span>
          <button
            type="button"
            className="step"
            tabIndex={-1}
            data-sfx="none"
            {...stepProps(1)}
            disabled={row.disabled || index === row.options.length - 1}
            onClick={(e) => (e.stopPropagation(), step(1))}
          >
            <ChevronRight strokeWidth={3} />
          </button>
        </span>
        {help}
      </div>
    );
  }

  if (row.kind === 'slider') {
    const p = (row.value - row.min) / (row.max - row.min);
    const drag = (e: React.PointerEvent) => {
      if (row.disabled || !(e.buttons & 1 || e.pointerType !== 'mouse')) return;
      const r = bar.current!.getBoundingClientRect();
      const raw = row.min + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (row.max - row.min);
      const v = Number((Math.round(raw / row.step) * row.step).toFixed(4));
      if (v !== row.value) row.set(Math.min(row.max, Math.max(row.min, v)));
    };
    return (
      <div
        {...common}
        {...valueProps(row.min, row.max, row.value, row.format(row.value))}
        tabIndex={0}
        data-sfx="none"
        aria-disabled={row.disabled}
        onKeyDown={(e) => (e.key === 'Home' ? row.set(row.min) : e.key === 'End' ? row.set(row.max) : undefined)}
      >
        <span className="set-label">{row.label}</span>
        <span className="set-control">
          <button
            type="button"
            className="step"
            tabIndex={-1}
            data-sfx="none"
            {...stepProps(-1)}
            disabled={row.disabled || row.value <= row.min}
            onClick={() => step(-1)}
          >
            <ChevronLeft strokeWidth={3} />
          </button>
          <span
            className="set-bar"
            ref={bar}
            style={{ ['--p' as string]: p }}
            onPointerDown={(e) => {
              if (row.disabled) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drag(e);
            }}
            onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && drag(e)}
          >
            <span className="set-bar-fill" />
            <span className="set-bar-value">{row.format(row.value)}</span>
          </span>
          <button
            type="button"
            className="step"
            tabIndex={-1}
            data-sfx="none"
            {...stepProps(1)}
            disabled={row.disabled || row.value >= row.max}
            onClick={() => step(1)}
          >
            <ChevronRight strokeWidth={3} />
          </button>
        </span>
        {help}
      </div>
    );
  }

  if (row.kind === 'action') {
    return (
      <div {...common}>
        <span className="set-label">{row.label}</span>
        <span className="set-control">
          <button type="button" className={`btn small ${row.danger ? 'danger' : ''}`} disabled={row.disabled} onClick={row.run}>
            {row.button}
          </button>
          {row.note}
        </span>
        {help}
      </div>
    );
  }

  if (row.kind === 'keys') {
    return (
      <div {...common} role="group" aria-label={row.label}>
        <span className="set-label">{row.label}</span>
        <span className="set-control caps">
          {row.caps.map((cap) =>
            cap.bind ? (
              <button
                key={cap.id}
                type="button"
                className={`keycap ${cap.lane !== undefined ? `lane-${cap.lane}` : ''} ${cap.listening ? 'listening' : ''}`}
                aria-label={cap.listening ? 'Waiting for a press' : `${cap.name}. Press to change.`}
                onClick={cap.bind}
              >
                {cap.listening ? '…' : cap.content}
              </button>
            ) : (
              <span key={cap.id} className="keycap fixed" title={cap.name}>
                {cap.content}
              </span>
            ),
          )}
        </span>
        {help}
      </div>
    );
  }

  if (row.kind === 'text') {
    return (
      <div {...common}>
        <label className="set-label" htmlFor={`set-${row.id}`}>
          {row.label}
        </label>
        <span className="set-control">
          <input
            id={`set-${row.id}`}
            className="text"
            value={row.value}
            disabled={row.disabled}
            spellCheck={false}
            inputMode="url"
            autoCapitalize="off"
            onChange={(e) => row.set(e.target.value)}
          />
          {row.note}
        </span>
        {help}
      </div>
    );
  }

  return (
    <div {...common} tabIndex={0} role="group" aria-label={row.label}>
      <span className="set-label">{row.label}</span>
      <span className="set-control info">{row.body}</span>
      {help}
    </div>
  );
}

/** The side pane on wide screens: what the highlighted setting does, and its choices to pick directly. */
function Detail({ row }: { row: Row }) {
  return (
    <div className="detail-card">
      <h2 className="panel-title">{row.label}</h2>
      <p className="detail-help">{row.help}</p>
      {row.kind === 'choice' && (
        <ul className="option-list">
          {row.options.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                className={`option ${o.value === row.value ? 'on' : ''}`}
                tabIndex={-1}
                data-nav-skip
                disabled={row.disabled}
                aria-pressed={o.value === row.value}
                onClick={() => row.set(o.value)}
              >
                <span className="option-label">{o.label}</span>
                {o.help && <span className="option-help">{o.help}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {row.kind === 'slider' && (
        <p className="detail-range">
          <span className="num">{row.format(row.value)}</span>
          <span className="dim">
            {row.format(row.min)} to {row.format(row.max)}
          </span>
        </p>
      )}
      {row.disabled && (
        <p className="detail-note">{row.kind === 'action' ? 'Not available right now.' : 'Turned off by another setting on this page.'}</p>
      )}
    </div>
  );
}
