/**
 * Menu navigation by direction, shared by the keyboard's arrow keys and a controller's D-pad or
 * left stick: focus moves to the nearest control that way, confirm clicks it, back acts like Esc,
 * and the shoulder buttons (Q and E on a keyboard) switch tabs.
 *
 * A control can take a direction for itself: every move is first offered to the focused element as
 * a cancelable `nav-move` event (a settings row uses left and right to change its value).
 * Containers marked `data-nav-group` remember their last focused control, so crossing from a list
 * to a side panel and back returns to the same row. `data-nav-skip` keeps a control out of
 * directional navigation (it stays reachable with Tab).
 */
import { isTextField, setInputMode } from './inputMode';
import { backInput, confirmInput, pads, type GlyphStyle } from './pads';

export type Dir = 'up' | 'down' | 'left' | 'right';

const DIRS: Record<string, Dir> = { b12: 'up', b13: 'down', b14: 'left', b15: 'right', 'a1-': 'up', 'a1+': 'down', 'a0-': 'left', 'a0+': 'right' };
const ARROWS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const FOCUSABLE = 'button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Sent to switch tabs (detail: -1 or 1). */
export const TAB_EVENT = 'nav-tab';
/** Sent after directional navigation moved focus (for move sounds and pulses). */
export const MOVE_EVENT = 'nav-moved';
/** Offered to the focused control before focus moves (detail: { dir }); cancel it to keep focus. */
export const NAV_EVENT = 'nav-move';

/** The topmost open dialog, or the whole document. */
export function navScope(): ParentNode {
  const modals = document.querySelectorAll('[data-modal]');
  return modals.length ? modals[modals.length - 1] : document;
}

/** Menus take directions unless a song is running (the pause menu takes them again). */
const navLive = () => !document.querySelector('[data-nav-off]');

export function focusables(scope: ParentNode = navScope()): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    // Out of the tab order means out of directional navigation too (a row's own step arrows).
    if (el.tabIndex < 0 || el.closest('[data-nav-skip]')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  });
}

const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** The control nearest in a direction, favouring ones in line with the current one. */
export function nearest(from: DOMRect, dir: Dir, rects: DOMRect[]): number {
  const c = center(from);
  let best = -1;
  let bestScore = Infinity;
  rects.forEach((r, i) => {
    const p = center(r);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    // Must lie beyond the current control's edge in that direction.
    const ahead = dir === 'up' ? r.bottom <= from.top + 4 : dir === 'down' ? r.top >= from.bottom - 4 : dir === 'left' ? r.right <= from.left + 4 : r.left >= from.right - 4;
    if (!ahead) return;
    const main = dir === 'up' || dir === 'down' ? Math.abs(dy) : Math.abs(dx);
    // Overlap on the cross axis counts as perfectly in line.
    const overlap = dir === 'up' || dir === 'down' ? Math.min(r.right, from.right) - Math.max(r.left, from.left) : Math.min(r.bottom, from.bottom) - Math.max(r.top, from.top);
    const cross = overlap > 0 ? 0 : dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    const score = main + cross * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

const groupOf = (el: Element | null) => el?.closest('[data-nav-group]') ?? null;
const remembered = new WeakMap<Element, HTMLElement>();

function focusEl(el: HTMLElement, announce = true) {
  el.focus({ preventScroll: true });
  // A window without focus (a controller used right after switching apps) moves focus silently:
  // say so, for the screens that follow the focused control.
  if (!document.hasFocus()) el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: document.documentElement.dataset.motion === 'reduced' ? 'auto' : 'smooth' });
  if (announce) window.dispatchEvent(new Event(MOVE_EVENT));
}

/** A scope's starting control: the one marked `data-autofocus` (or the first control inside it), else its primary one, else its first. */
function startEl(list = focusables(), scope: ParentNode = navScope()): HTMLElement | undefined {
  const marked = scope.querySelector('[data-autofocus]');
  return (marked && list.find((el) => el === marked || marked.contains(el))) ?? list.find((el) => el.classList.contains('primary')) ?? list[0];
}

/** Puts focus on the starting control of the screen, or of a part of it. */
export function focusStart(scope?: ParentNode) {
  const el = scope ? startEl(focusables(scope), scope) : startEl();
  if (el) focusEl(el, false);
}
/** Whether focus sits on a control of the current scope. */
function current(list: HTMLElement[]): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  return active && active !== document.body && list.includes(active) ? active : null;
}

export function navMove(dir: Dir, fromPad = false) {
  if (!navLive()) return;
  const all = focusables();
  const active = current(all);
  if (!active) {
    // A control kept out of directional navigation may still hold focus (reached with Tab).
    const stray = document.activeElement as HTMLElement | null;
    const near = stray && stray !== document.body && navScope().contains(stray) ? stray.getBoundingClientRect() : null;
    const i = near ? nearest(near, dir, all.map((el) => el.getBoundingClientRect())) : -1;
    const el = i >= 0 ? all[i] : startEl(all);
    if (el) focusEl(el);
    return;
  }
  if (!active.dispatchEvent(new CustomEvent(NAV_EVENT, { detail: { dir }, bubbles: true, cancelable: true }))) return;
  const horizontal = dir === 'left' || dir === 'right';
  // A controller has no arrow keys for a native slider: step it here.
  if (fromPad && horizontal && active instanceof HTMLInputElement && active.type === 'range') {
    const step = Number(active.step) || 1;
    const v = Math.min(Number(active.max), Math.max(Number(active.min), Number(active.value) + (dir === 'right' ? step : -step)));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(active, String(v));
    active.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  const others = all.filter((el) => el !== active);
  const i = nearest(active.getBoundingClientRect(), dir, others.map((el) => el.getBoundingClientRect()));
  if (i < 0) return;
  let target = others[i];
  const group = groupOf(target);
  if (group && group !== groupOf(active)) {
    const last = remembered.get(group);
    if (last && last.isConnected && others.includes(last)) target = last;
  }
  focusEl(target);
}

function confirm() {
  if (!navLive()) return;
  // A control kept out of directional navigation still counts when it holds focus (reached with Tab).
  const stray = document.activeElement as HTMLElement | null;
  const active = current(focusables()) ?? (stray && stray !== document.body && navScope().contains(stray) && stray.matches(FOCUSABLE) ? stray : null);
  if (!active) {
    const start = startEl();
    if (start) return focusEl(start, false);
    // A screen with nothing to focus (results): confirm is its forward action, the Enter key's.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    return;
  }
  if (isTextField(active)) return;
  active.click();
}

function back() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
}

const tab = (d: -1 | 1) => window.dispatchEvent(new CustomEvent(TAB_EVENT, { detail: d }));

/** Installs menu navigation for the keyboard and controllers; returns an uninstall function. */
export function installMenuNav(style: () => GlyphStyle): () => void {
  let repeat = 0;
  let held: string | null = null;
  const stopRepeat = () => {
    clearTimeout(repeat);
    held = null;
  };
  const release = pads.capture((e) => {
    if (e.down) setInputMode('pad');
    const dir = DIRS[e.input];
    if (dir) {
      if (!e.down) {
        if (held === e.input) stopRepeat();
        return true;
      }
      stopRepeat();
      held = e.input;
      navMove(dir, true);
      const again = (delay: number) => {
        repeat = window.setTimeout(() => {
          if (held !== e.input) return;
          navMove(dir, true);
          again(110);
        }, delay);
      };
      again(380);
      return true;
    }
    const s = style();
    // Every other button is left to whoever listens underneath (the action bar's own shortcuts).
    if (e.input !== confirmInput(s) && e.input !== backInput(s) && e.input !== 'b4' && e.input !== 'b5') return false;
    if (!e.down) return true;
    if (e.input === confirmInput(s)) confirm();
    else if (e.input === backInput(s)) back();
    else if (e.input === 'b4' || e.input === 'b5') tab(e.input === 'b4' ? -1 : 1);
    return true;
  });

  const key = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !navLive()) return;
    const target = e.target as HTMLElement | null;
    const dir = ARROWS[e.key];
    if (dir) {
      const horizontal = dir === 'left' || dir === 'right';
      // Text keeps its caret keys, a slider its own steps.
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (horizontal && (isTextField(target) || (target instanceof HTMLInputElement && target.type === 'range'))) return;
      e.preventDefault();
      navMove(dir);
    } else if ((e.code === 'KeyQ' || e.code === 'KeyE') && !e.repeat && !isTextField(target)) {
      tab(e.code === 'KeyQ' ? -1 : 1);
    }
  };
  const focusin = (e: FocusEvent) => {
    const el = e.target as HTMLElement | null;
    const group = groupOf(el);
    if (el && group) remembered.set(group, el);
  };
  window.addEventListener('keydown', key);
  window.addEventListener('focusin', focusin);
  return () => {
    stopRepeat();
    release();
    window.removeEventListener('keydown', key);
    window.removeEventListener('focusin', focusin);
  };
}
