import type { GlyphStyle, PadInput } from '../input/pads';

export interface Settings {
  /** Highway units per second. */
  noteSpeed: number;
  /** Audio/visual offset in milliseconds (positive = notes later). */
  offsetMs: number;
  volume: number;
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
  rumble: boolean;
  /** 0..1 */
  rumbleStrength: number;
  rumbleHits: boolean;
  rumbleMisses: boolean;
  rumbleSustains: boolean;
  rumbleOverdrive: boolean;
  /** PS5 DualSense over USB: drive its haptic actuators directly, panned to the lane. */
  dualSenseHaptics: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  noteSpeed: 9,
  offsetMs: 0,
  volume: 0.9,
  keys4: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
  keys5: ['KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'],
  overdriveKey: 'Space',
  mlEnabled: false,
  mlUrl: 'http://127.0.0.1:8765',
  // Index and middle fingers on the shoulders; the thumb takes the middle lane on Expert.
  pad4: ['b6', 'b4', 'b5', 'b7'],
  pad5: ['b6', 'b4', 'b0', 'b5', 'b7'],
  padOverdrive: 'b3',
  glyphs: 'auto',
  rumble: true,
  rumbleStrength: 0.7,
  rumbleHits: true,
  rumbleMisses: true,
  rumbleSustains: true,
  rumbleOverdrive: true,
  dualSenseHaptics: false,
};

/** Settings stored by an older version may lack fields or have bindings of the wrong length. */
export function normalizeSettings(raw: Partial<Settings>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...raw };
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
