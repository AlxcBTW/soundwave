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
};

const KEY = 'festival.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
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
