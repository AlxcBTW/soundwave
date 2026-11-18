/**
 * The desktop app's display mode: fullscreen, a borderless window covering the monitor, or a normal
 * window. A browser tab has no window to manage, so there this does nothing and the setting is
 * hidden.
 */
import { invoke } from '@tauri-apps/api/core';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import type { DisplayMode } from './settings';

export const inDesktopApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** The smallest window the app allows (tauri.conf.json), in logical pixels. */
const MIN_SIZE = { width: 960, height: 600 };
/** The largest window that Window mode opens. */
const MAX_SIZE = { width: 1600, height: 1000 };

/** Window mode's size for a monitor (logical pixels): 16:10, within four fifths of the monitor. */
export function windowedSize(monitorWidth: number, monitorHeight: number): { width: number; height: number } {
  const scale = Math.min((monitorWidth * 0.8) / MAX_SIZE.width, (monitorHeight * 0.8) / MAX_SIZE.height, 1);
  return {
    width: Math.max(MIN_SIZE.width, Math.round(MAX_SIZE.width * scale)),
    height: Math.max(MIN_SIZE.height, Math.round(MAX_SIZE.height * scale)),
  };
}

/** Whether the game runs somewhere it can close itself: the desktop app, or a window installed from the browser. */
export const canExit = () =>
  inDesktopApp() || (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches);

/**
 * Closes the game. In the desktop app the app itself quits (its own exit_app command); should an
 * older build not know that command, the window is closed or, failing that, destroyed. The page's
 * own window.close() is only for a window installed from the browser: inside the desktop app it
 * would blank the page and leave the app running unseen.
 */
export async function exitApp() {
  if (!inDesktopApp()) return window.close();
  try {
    await invoke('exit_app');
  } catch (err) {
    console.warn('Could not quit through the app, closing the window instead', err);
    const win = getCurrentWindow();
    await win
      .close()
      .catch(() => win.destroy())
      .catch((e) => console.warn('Could not close the window', e));
  }
}

let queue: Promise<void> = Promise.resolve();
let applied: DisplayMode | null = null;
let shown = false;

/** Switches the window to a display mode. Calls run one after another, so quick changes end on the last one. */
export function applyDisplayMode(mode: DisplayMode): Promise<void> {
  if (!inDesktopApp()) return Promise.resolve();
  queue = queue.then(() => apply(mode)).catch((err) => console.warn('Could not change the display mode', err));
  return queue;
}

async function apply(mode: DisplayMode) {
  const win = getCurrentWindow();
  try {
    if (mode === applied) return;
    applied = null;
    if (mode === 'fullscreen') {
      await win.setFullscreen(true);
    } else {
      if (await win.isFullscreen()) await win.setFullscreen(false);
      if (await win.isMaximized()) await win.unmaximize();
      const monitor = await currentMonitor();
      if (mode === 'borderless') {
        // No frame, no shadow line and no resize edges: just the page over the whole monitor.
        await win.setDecorations(false);
        await win.setShadow(false);
        await win.setResizable(false);
        if (monitor) {
          await win.setPosition(monitor.position);
          await win.setSize(monitor.size);
        }
      } else {
        // No native title bar in any mode: the window keeps its shadow and its resize edges, and is
        // moved by the strip along its top edge (see the drag strip in App).
        await win.setDecorations(false);
        await win.setShadow(true);
        await win.setResizable(true);
        const area = monitor?.size.toLogical(monitor.scaleFactor);
        const size = area ? windowedSize(area.width, area.height) : { width: 1280, height: 800 };
        await win.setSize(new LogicalSize(size.width, size.height));
        await win.center();
      }
    }
    applied = mode;
  } finally {
    // The window starts hidden so it never appears in the wrong mode first.
    if (!shown) {
      shown = true;
      await win.show();
      await win.setFocus();
    }
  }
}
