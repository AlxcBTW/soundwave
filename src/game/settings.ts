import type { GlyphStyle, PadInput } from '../input/pads';
import { DEFAULT_GRAPHICS, normalizeGraphics, type GraphicsSettings } from './graphics';

export interface Settings {
  /** Highway units per second. */
  noteSpeed: number;
  /** Audio/visual offset in milliseconds (positive = notes later). */
  offsetMs: number;
  volume: number;
  /** The orchestral theme behind the menus, 0..1. */
  musicVolume: number;
  /** Menu and interface sound effects, 0..1 (separate from the music). */
  sfxVolume: number;
  /** A song plays a preview by itself while its row is highlighted or its page is open. */
  songPreviews: boolean;
  /** Silence while the game's window is not the focused one. */
  muteUnfocused: boolean;
  /** The audio output to play through: a device id of this browser, or '' for the system's default. */
  outputDevice: string;
  /** That device's name, to show it while it is unplugged. */
  outputDeviceName: string;
  keys4: string[];
  keys5: string[];
  overdriveKey: string;
  /** Controller lanes (positional button names, see input/pads.ts) for 4 and 5 lanes. */
  pad4: PadInput[];
  pad5: PadInput[];
  padOverdrive: PadInput;
  /** Button glyphs: matched to the controller in use, or a fixed style. */
  glyphs: 'auto' | GlyphStyle;
  rumble: RumbleLevel;
  rumbleHits: boolean;
  rumbleMisses: boolean;
  rumbleSustains: boolean;
  rumbleOverdrive: boolean;
  /** The 3D stage behind the highway. */
  graphics: GraphicsSettings;
  /** How the desktop app's window fills the screen. */
  displayMode: DisplayMode;
  /** Interface size relative to the automatic one (which already grows with the window), 0.85..1.3. */
  uiScale: number;
  /** Menu motion: follow the system preference, or always calm / always full. */
  motion: MotionPref;
  /** A short vibration on every touch-pad press, where the device supports it. */
  touchHaptics: boolean;
  /** Which side of the screen the touch overdrive button sits on. */
  touchOverdriveSide: 'left' | 'right';
  /** Which volume defaults the stored volumes have been brought up to (not shown; see normalizeSettings). */
  volumeDefaults: number;
}

export type MotionPref = 'system' | 'reduced' | 'full';

export type RumbleLevel = 'off' | 'weak' | 'strong';
/** Fullscreen, a borderless window covering the monitor, or a normal window. */
export type DisplayMode = 'fullscreen' | 'borderless' | 'windowed';
export const DISPLAY_MODES: readonly DisplayMode[] = ['fullscreen', 'borderless', 'windowed'];

/**
 * The volume defaults in use. 1: menu music 60%, interface sounds 70%. 2: 30% and 90%. Settings are
 * stored whole, so a raised number lets stored volumes that were never changed follow, once.
 */
const VOLUME_DEFAULTS = 2;

export const DEFAULT_SETTINGS: Settings = {
  noteSpeed: 9,
  offsetMs: 0,
  volume: 0.9,
  musicVolume: 0.3,
  sfxVolume: 0.9,
  songPreviews: true,
  muteUnfocused: true,
  outputDevice: '',
  outputDeviceName: '',
  keys4: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
  keys5: ['KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'],
  overdriveKey: 'Space',
  // The usual five-lane controller layout: D-pad left and right for the left hand, the left, top
  // and right face buttons for the right hand (four lanes skip the top one), right trigger for
  // overdrive. Positional names, so the same buttons on every controller.
  pad4: ['b14', 'b15', 'b2', 'b1'],
  pad5: ['b14', 'b15', 'b2', 'b3', 'b1'],
  padOverdrive: 'b7',
  glyphs: 'auto',
  rumble: 'strong',
  rumbleHits: true,
  rumbleMisses: true,
  rumbleSustains: true,
  rumbleOverdrive: true,
  graphics: DEFAULT_GRAPHICS,
  displayMode: 'borderless',
  uiScale: 1,
  motion: 'system',
  touchHaptics: true,
  touchOverdriveSide: 'right',
  volumeDefaults: VOLUME_DEFAULTS,
};

/** Controller defaults of an earlier version, replaced by the current ones when stored unchanged. */
const OLD_PAD_DEFAULTS = { pad4: 'b6,b4,b5,b7', pad5: 'b6,b4,b0,b5,b7', padOverdrive: 'b3' };

/** Settings stored by an older version may lack fields or have bindings of the wrong length. */
export function normalizeSettings(raw: Partial<Settings>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  if (`${s.pad4}` === OLD_PAD_DEFAULTS.pad4 && `${s.pad5}` === OLD_PAD_DEFAULTS.pad5 && s.padOverdrive === OLD_PAD_DEFAULTS.padOverdrive) {
    Object.assign(s, { pad4: [...DEFAULT_SETTINGS.pad4], pad5: [...DEFAULT_SETTINGS.pad5], padOverdrive: DEFAULT_SETTINGS.padOverdrive });
  }
  // Rumble used to be on/off plus a strength.
  const r = s.rumble as unknown;
  if (r === true) s.rumble = 'strong';
  else if (r === false) s.rumble = 'off';
  else if (r !== 'off' && r !== 'weak' && r !== 'strong') s.rumble = DEFAULT_SETTINGS.rumble;
  // The analysis service's switch and address went when the analysis moved into the game.
  for (const old of ['rumbleStrength', 'dualSenseHaptics', 'mlEnabled', 'mlUrl']) delete (s as Record<string, unknown>)[old];
  // Volumes still at the first defaults move to the current ones, once; a choice made after that stays.
  if (!(Number(raw.volumeDefaults) >= 2) && s.musicVolume === 0.6 && s.sfxVolume === 0.7) {
    s.musicVolume = DEFAULT_SETTINGS.musicVolume;
    s.sfxVolume = DEFAULT_SETTINGS.sfxVolume;
  }
  s.volumeDefaults = VOLUME_DEFAULTS;
  s.graphics = normalizeGraphics(s.graphics);
  if (!DISPLAY_MODES.includes(s.displayMode)) s.displayMode = DEFAULT_SETTINGS.displayMode;
  s.uiScale = Math.min(1.3, Math.max(0.85, Number(s.uiScale) || 1));
  if (!['system', 'reduced', 'full'].includes(s.motion)) s.motion = 'system';
  s.touchHaptics = Boolean(s.touchHaptics);
  s.muteUnfocused = Boolean(s.muteUnfocused);
  s.songPreviews = Boolean(s.songPreviews);
  if (typeof s.outputDevice !== 'string') s.outputDevice = '';
  if (typeof s.outputDeviceName !== 'string' || !s.outputDevice) s.outputDeviceName = '';
  if (s.touchOverdriveSide !== 'left') s.touchOverdriveSide = 'right';
  for (const k of ['keys4', 'keys5', 'pad4', 'pad5'] as const) {
    if (!Array.isArray(s[k]) || s[k].length !== DEFAULT_SETTINGS[k].length) s[k] = [...DEFAULT_SETTINGS[k]];
  }
  return s;
}

const KEY = 'soundwave.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalizeSettings(JSON.parse(raw));
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export const keyLabel = (code: string) =>
  code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : code;
