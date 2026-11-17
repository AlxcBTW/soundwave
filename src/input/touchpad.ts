/**
 * A finger on a controller's touchpad. Browsers report it through the Gamepad API (`touches`) where
 * they support that; the desktop app's web view does not, so there the app reads the controller
 * itself (src-tauri/src/touchpad.rs) and this asks it where the finger is.
 */
import { invoke } from '@tauri-apps/api/core';
import { pads } from './pads';

/** -1..1 across the pad and down it. */
export interface PadFinger {
  x: number;
  y: number;
}

interface WebTouch {
  position: PadFinger;
}

const inDesktopApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** The finger the browser itself reports for the controller in use, if it reports any. */
function webFinger(): PadFinger | null {
  const gp = pads.gamepad(pads.snapshot().lastPad) as (Gamepad & { touches?: WebTouch[] | null; touchEvents?: WebTouch[] | null }) | null;
  return (gp?.touches ?? gp?.touchEvents)?.[0]?.position ?? null;
}

/**
 * Follows the touchpad until `stop` is called. `read` gives the finger's position right now, or
 * null while no finger is on the pad (or no touchpad can be read).
 */
export function watchTouchpad(): { read(): PadFinger | null; stop(): void } {
  let native: PadFinger | null = null;
  let asking = false;
  let poll = 0;
  let keep = 0;
  if (inDesktopApp()) {
    const on = () => void invoke('touchpad_watch', { on: true }).catch(() => {});
    on();
    // The app lets go of the controller when it is told to; saying so again keeps it reading.
    keep = window.setInterval(on, 2000);
    poll = window.setInterval(() => {
      if (asking) return;
      asking = true;
      invoke<PadFinger | null>('touchpad_finger')
        .then(
          (f) => (native = f),
          () => (native = null),
        )
        .finally(() => (asking = false));
    }, 16);
  }
  return {
    read: () => webFinger() ?? native,
    stop() {
      clearInterval(poll);
      clearInterval(keep);
      native = null;
      if (inDesktopApp()) void invoke('touchpad_watch', { on: false }).catch(() => {});
    },
  };
}
