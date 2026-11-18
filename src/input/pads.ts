/**
 * Game controllers through the Gamepad API: which kind of controller is connected, and button,
 * trigger and stick changes as timestamped events.
 *
 * Inputs are named by position in the standard mapping, so a binding means the same physical
 * button on every controller: `b0` is the bottom face button (A on Xbox, Cross on PlayStation,
 * B on Switch), `b6` the left trigger, `b12` D-pad up. Stick directions are `a<axis><sign>`,
 * e.g. `a1-` is the left stick pushed up.
 */

import { noteInput, setInputMode } from './inputMode';

export type PadFamily = 'xbox' | 'ps4' | 'ps5' | 'switch' | 'generic';
export type GlyphStyle = 'xbox' | 'ps4' | 'ps5' | 'switch';
export type PadInput = string;

export interface PadEvent {
  input: PadInput;
  down: boolean;
  /** performance.now()-based time of the controller report that carried the change. */
  t: number;
  pad: number;
}

export interface PadInfo {
  index: number;
  id: string;
  name: string;
  family: PadFamily;
  standard: boolean;
}

/** The Start-like button: pauses the game and is never bindable. */
export const PAUSE_INPUT = 'b9';
/** The system button (Guide, PS, Home), left to the system. */
export const SYSTEM_INPUT = 'b16';

const ids = (id: string) => {
  const m = /vendor:\s*([0-9a-f]{4}).*?product:\s*([0-9a-f]{4})/i.exec(id) ?? /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id);
  return m ? { vendor: m[1].toLowerCase().padStart(4, '0'), product: m[2].toLowerCase().padStart(4, '0') } : undefined;
};

const PS5_PRODUCTS = new Set(['0ce6', '0df2']);

/** Which controller a Gamepad id string describes (Chromium and Firefox formats). */
export function detectFamily(id: string): PadFamily {
  const v = ids(id);
  const name = id.toLowerCase();
  if (v?.vendor === '054c' || /dualsense|dualshock|playstation/.test(name)) {
    return (v && PS5_PRODUCTS.has(v.product)) || /dualsense|ps5/.test(name) ? 'ps5' : 'ps4';
  }
  if (v?.vendor === '057e' || /pro controller|joy-?con|nintendo|switch/.test(name)) return 'switch';
  if (v?.vendor === '045e' || /xbox|xinput/.test(name)) return 'xbox';
  return 'generic';
}

/** Glyphs to show for a controller family (unknown controllers use the most common layout). */
export const styleFor = (f: PadFamily): GlyphStyle => (f === 'generic' ? 'xbox' : f);

/** Readable controller name without the browser's vendor/product suffix. */
export function padName(id: string): string {
  const cleaned = id
    .replace(/\s*\((?:STANDARD GAMEPAD|XInput[^)]*|[^)]*Vendor:[^)]*)\)\s*/gi, ' ')
    .replace(/^[0-9a-f]{1,4}-[0-9a-f]{1,4}-/i, '')
    .trim();
  return cleaned || 'Controller';
}

export interface PadState {
  buttons: boolean[];
  axes: number[];
}

interface RawPad {
  buttons: readonly { pressed: boolean; value: number }[];
  axes: readonly number[];
}

/**
 * New state of one controller plus the inputs that changed. Triggers and sticks use hysteresis
 * so a resting finger or a worn stick doesn't chatter.
 */
export function readPad(gp: RawPad, prev: PadState | undefined): { state: PadState; changes: { input: PadInput; down: boolean }[] } {
  const changes: { input: PadInput; down: boolean }[] = [];
  const buttons = gp.buttons.map((b, i) => {
    const was = prev?.buttons[i] ?? false;
    const v = Math.max(b.value, b.pressed && b.value === 0 ? 1 : 0);
    const down = was ? v > 0.25 : v > 0.45;
    if (down !== was) changes.push({ input: `b${i}`, down });
    return down;
  });
  const axes = gp.axes.map((a, i) => {
    const was = prev?.axes[i] ?? 0;
    const dir = was !== 0 && Math.sign(a) === was && Math.abs(a) > 0.4 ? was : Math.abs(a) > 0.6 ? Math.sign(a) : 0;
    if (dir !== was) {
      if (was) changes.push({ input: `a${i}${was < 0 ? '-' : '+'}`, down: false });
      if (dir) changes.push({ input: `a${i}${dir < 0 ? '-' : '+'}`, down: true });
    }
    return dir;
  });
  return { state: { buttons, axes }, changes };
}

/** Handlers return false to pass an event on (to the next handler, finally to menu navigation). */
type Handler = (e: PadEvent) => boolean | void;

export interface PadSnapshot {
  pads: PadInfo[];
  /** The device the player last touched. */
  lastDevice: 'keyboard' | 'pad';
  /** Family of the controller used last (or the first connected one). */
  family: PadFamily;
  lastPad: number;
}

class PadHub {
  private states = new Map<number, PadState>();
  private handlers: Handler[] = [];
  private listeners = new Set<() => void>();
  private started = false;
  private snap: PadSnapshot = { pads: [], lastDevice: 'keyboard', family: 'generic', lastPad: -1 };

  start() {
    if (this.started || typeof window === 'undefined' || !('getGamepads' in navigator)) return;
    this.started = true;
    window.addEventListener('gamepadconnected', () => this.poll());
    window.addEventListener('gamepaddisconnected', () => this.poll());
    // Only real input counts: menu navigation sends synthetic Esc presses for the controller's back.
    const usedKeyboard = (e: Event) => e.isTrusted && this.snap.lastDevice !== 'keyboard' && this.update({ lastDevice: 'keyboard' });
    window.addEventListener('keydown', usedKeyboard, true);
    window.addEventListener('pointerdown', usedKeyboard, true);
    const loop = () => {
      requestAnimationFrame(loop);
      this.poll();
    };
    loop();
  }

  /**
   * Handles controller input ahead of everything registered before it (menus register first,
   * gameplay and binding prompts on top). Returns a function that removes the handler.
   */
  capture(h: Handler): () => void {
    this.handlers.push(h);
    return () => {
      this.handlers = this.handlers.filter((x) => x !== h);
    };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot = (): PadSnapshot => this.snap;

  /** Whether any button, trigger or stick direction is held on any controller. */
  anyHeld(): boolean {
    for (const s of this.states.values()) if (s.buttons.some(Boolean) || s.axes.some(Boolean)) return true;
    return false;
  }

  gamepad(index: number): Gamepad | null {
    return navigator.getGamepads?.()[index] ?? null;
  }

  private update(patch: Partial<PadSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  private emit(e: PadEvent) {
    for (let i = this.handlers.length - 1; i >= 0; i--) if (this.handlers[i](e) !== false) return;
  }

  private poll() {
    const list = navigator.getGamepads?.() ?? [];
    const seen = new Set<number>();
    const now = performance.now();
    for (const gp of list) {
      if (!gp || !gp.connected) continue;
      seen.add(gp.index);
      const { state, changes } = readPad(gp, this.states.get(gp.index));
      this.states.set(gp.index, state);
      if (!changes.length) continue;
      // The report's own time is more precise than when this frame got to read it.
      const t = gp.timestamp > 0 && gp.timestamp <= now && now - gp.timestamp < 250 ? gp.timestamp : now;
      if (changes.some((c) => c.down)) setInputMode('pad');
      noteInput();
      if (changes.some((c) => c.down) && (this.snap.lastDevice !== 'pad' || this.snap.lastPad !== gp.index)) {
        this.update({ lastDevice: 'pad', lastPad: gp.index, family: detectFamily(gp.id) });
      }
      for (const c of changes) this.emit({ ...c, t, pad: gp.index });
    }
    // Disconnected controllers release whatever they were holding.
    for (const [index, s] of Array.from(this.states)) {
      if (seen.has(index)) continue;
      this.states.delete(index);
      s.buttons.forEach((d, i) => d && this.emit({ input: `b${i}`, down: false, t: now, pad: index }));
      s.axes.forEach((d, i) => d && this.emit({ input: `a${i}${d < 0 ? '-' : '+'}`, down: false, t: now, pad: index }));
    }
    const pads: PadInfo[] = [];
    for (const gp of list)
      if (gp?.connected)
        pads.push({ index: gp.index, id: gp.id, name: padName(gp.id), family: detectFamily(gp.id), standard: gp.mapping === 'standard' });
    const same =
      pads.length === this.snap.pads.length && pads.every((p, i) => p.id === this.snap.pads[i].id && p.index === this.snap.pads[i].index);
    if (!same) {
      const family = pads.some((p) => p.index === this.snap.lastPad) ? this.snap.family : (pads[0]?.family ?? 'generic');
      this.update({ pads, family, lastDevice: pads.length ? this.snap.lastDevice : 'keyboard' });
    }
  }
}

export const pads = new PadHub();

/** Glyph style to show: the chosen one, or the one matching the controller in use. */
export const resolveStyle = (pref: 'auto' | GlyphStyle, family: PadFamily): GlyphStyle => (pref === 'auto' ? styleFor(family) : pref);

/** Menu confirm and back buttons. Nintendo controllers confirm with A, the right face button. */
export const confirmInput = (s: GlyphStyle) => (s === 'switch' ? 'b1' : 'b0');
export const backInput = (s: GlyphStyle) => (s === 'switch' ? 'b0' : 'b1');
