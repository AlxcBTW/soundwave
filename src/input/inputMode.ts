/**
 * Which kind of input the player used last: mouse, keyboard, controller or touch. The interface
 * reads it (as `data-input` on the root element and through `useInputMode`) to pick its variant:
 * key hints or controller glyphs, hover or a travelling focus ring, larger touch targets.
 */
import { useSyncExternalStore } from 'react';

export type InputMode = 'mouse' | 'keyboard' | 'pad' | 'touch';

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'OS', 'AltGraph']);
const NAV_KEYS = new Set(['Tab', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function isTextField(el: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement || el.isContentEditable) return true;
  return el instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'submit', 'file'].includes(el.type);
}

/**
 * The mode a key press implies, or null when it says nothing: modifier keys alone, and typing into
 * a text field (which a touch player does on an on-screen keyboard).
 */
export function modeForKey(key: string, typing: boolean): InputMode | null {
  if (MODIFIERS.has(key)) return null;
  if (typing && !NAV_KEYS.has(key)) return null;
  return 'keyboard';
}

/** The mode a pointer implies. A mouse only counts once it has really moved. */
export function modeForPointer(pointerType: string): InputMode {
  return pointerType === 'touch' || pointerType === 'pen' ? 'touch' : 'mouse';
}

function initialMode(): InputMode {
  if (typeof matchMedia === 'undefined') return 'mouse';
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches ? 'touch' : 'mouse';
}

let mode: InputMode = initialMode();
const listeners = new Set<() => void>();

export const getInputMode = (): InputMode => mode;

const inputListeners = new Set<() => void>();

/** A controller was used (keys and pointers are seen as events). Tells those who watch for it. */
export function noteInput() {
  for (const l of inputListeners) l();
}

/** Calls `fn` whenever a controller is used. */
export const onPadInput = (fn: () => void) => {
  inputListeners.add(fn);
  return () => inputListeners.delete(fn);
};

export function setInputMode(next: InputMode) {
  if (next === mode) return;
  mode = next;
  if (typeof document !== 'undefined') document.documentElement.dataset.input = next;
  for (const l of listeners) l();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const useInputMode = (): InputMode => useSyncExternalStore(subscribe, getInputMode);

/** Whether focus is shown and moved with directions (keyboard or controller). */
export const usesFocus = (m: InputMode = mode) => m === 'keyboard' || m === 'pad';

/** Starts following the player's input. Controllers report through `setInputMode('pad')` (see pads). */
export function installInputMode(): () => void {
  document.documentElement.dataset.input = mode;
  let lastX = -1;
  let lastY = -1;
  const key = (e: KeyboardEvent) => {
    if (!e.isTrusted) return;
    const m = modeForKey(e.key, isTextField(e.target));
    if (m) setInputMode(m);
  };
  const down = (e: PointerEvent) => setInputMode(modeForPointer(e.pointerType));
  const move = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return setInputMode('touch');
    // A mouse that is nudged by a keystroke or a bumped desk should not take the interface over.
    const far = Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > 6;
    if (lastX < 0 || far) {
      if (lastX >= 0) setInputMode('mouse');
      lastX = e.clientX;
      lastY = e.clientY;
    }
  };
  window.addEventListener('keydown', key, true);
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, true);
  return () => {
    window.removeEventListener('keydown', key, true);
    window.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointermove', move, true);
  };
}
