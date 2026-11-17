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
  keys4: string[];
  keys5: string[];
  overdriveKey: string;
  mlEnabled: boolean;
  mlUrl: string;
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
}

export type RumbleLevel = 'off' | 'weak' | 'strong';

export const DEFAULT_SETTINGS: Settings = {
  noteSpeed: 9,
  offsetMs: 0,
  volume: 0.9,
  musicVolume: 0.6,
  sfxVolume: 0.7,
  keys4: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
  keys5: ['KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'],
  overdriveKey: 'Space',
  mlEnabled: false,
  mlUrl: 'http://127.0.0.1:8765',
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
  for (const old of ['rumbleStrength', 'dualSenseHaptics']) delete (s as Record<string, unknown>)[old];
  s.graphics = normalizeGraphics(s.graphics);
  for (const k of ['keys4', 'keys5', 'pad4', 'pad5'] as const) {
    if (!Array.isArray(s[k]) || s[k].length !== DEFAULT_SETTINGS[k].length) s[k] = [...DEFAULT_SETTINGS[k]];
  }
  return s;
}

const KEY = 'festival.settings.v1';

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
