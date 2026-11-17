/**
 * Menu navigation with a controller: the D-pad or left stick moves focus to the nearest control
 * in that direction, confirm clicks it, back acts like Esc, the shoulder buttons switch tabs.
 * Runs underneath everything else, so gameplay and binding prompts take precedence.
 */
import { backInput, confirmInput, pads, type GlyphStyle } from './pads';

type Dir = 'up' | 'down' | 'left' | 'right';

const DIRS: Record<string, Dir> = { b12: 'up', b13: 'down', b14: 'left', b15: 'right', 'a1-': 'up', 'a1+': 'down', 'a0-': 'left', 'a0+': 'right' };
const FOCUSABLE = 'button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Event the settings screen listens to for tab switching (detail: -1 or 1). */
export const TAB_EVENT = 'pad-tab';

function scope(): ParentNode {
  const overlays = document.querySelectorAll('.overlay');
  return overlays.length ? overlays[overlays.length - 1] : document;
}

function candidates(): HTMLElement[] {
  return Array.from(scope().querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
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

let ringed: HTMLElement | null = null;

/** Focuses a control and marks it, so the ring shows even when the window itself isn't focused. */
function focus(el: HTMLElement) {
  document.documentElement.classList.add('pad-nav');
  ringed?.classList.remove('pad-focus');
  ringed = el;
  el.classList.add('pad-focus');
  el.addEventListener('blur', () => el.classList.remove('pad-focus'), { once: true });
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function start(): HTMLElement | undefined {
  const list = candidates();
  return list.find((el) => el.classList.contains('primary')) ?? list[0];
}

function move(dir: Dir) {
  const active = document.activeElement as HTMLElement | null;
  const list = candidates();
  if (!active || active === document.body || !list.includes(active)) {
    const s = start();
    if (s) focus(s);
    return;
  }
  // Sliders take left/right as value changes.
  if (active instanceof HTMLInputElement && active.type === 'range' && (dir === 'left' || dir === 'right')) {
    const step = Number(active.step) || 1;
    const v = Math.min(Number(active.max), Math.max(Number(active.min), Number(active.value) + (dir === 'right' ? step : -step)));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(active, String(v));
    active.dispatchEvent(new Event('input', { bubbles: true }));
    document.documentElement.classList.add('pad-nav');
    return;
  }
  const others = list.filter((el) => el !== active);
  const i = nearest(active.getBoundingClientRect(), dir, others.map((el) => el.getBoundingClientRect()));
  if (i >= 0) focus(others[i]);
}

function confirm() {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body || !candidates().includes(active)) {
    const s = start();
    if (s) focus(s);
    return;
  }
  if (active instanceof HTMLInputElement && (active.type === 'range' || active.type === 'text')) return;
  document.documentElement.classList.add('pad-nav');
  active.click();
}

function back() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
}

/** Installs controller menu navigation; returns an uninstall function. */
export function installMenuNav(style: () => GlyphStyle): () => void {
  let repeat = 0;
  let held: string | null = null;
  const stopRepeat = () => {
    clearTimeout(repeat);
    held = null;
  };
  const release = pads.capture((e) => {
    const dir = DIRS[e.input];
    if (dir) {
      if (!e.down) {
        if (held === e.input) stopRepeat();
        return true;
      }
      stopRepeat();
      held = e.input;
      move(dir);
      const again = (delay: number) => {
        repeat = window.setTimeout(() => {
          if (held !== e.input) return;
          move(dir);
          again(110);
        }, delay);
      };
      again(380);
      return true;
    }
    if (!e.down) return true;
    const s = style();
    if (e.input === confirmInput(s)) confirm();
    else if (e.input === backInput(s)) back();
    else if (e.input === 'b4' || e.input === 'b5') window.dispatchEvent(new CustomEvent(TAB_EVENT, { detail: e.input === 'b4' ? -1 : 1 }));
    return true;
  });
  const mouse = () => document.documentElement.classList.remove('pad-nav');
  window.addEventListener('pointermove', mouse);
  return () => {
    stopRepeat();
    release();
    window.removeEventListener('pointermove', mouse);
  };
}
