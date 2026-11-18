import { inDesktopApp } from '../game/displayMode';
import type { Update } from '@tauri-apps/plugin-updater';

/**
 * Updates for the desktop app: it asks GitHub for the newest full release (pre-releases never
 * reach it), and on the player's word downloads it, checks its signature, installs it and starts
 * again. The website needs none of this: it is always the newest release.
 */
export type UpdateStatus =
  | { state: 'unsupported' }
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'current'; checkedAt: number }
  | { state: 'available'; version: string; notes: string }
  | { state: 'downloading'; version: string; received: number; total: number | null }
  | { state: 'installing'; version: string }
  | { state: 'error'; message: string };

type Listener = () => void;

let status: UpdateStatus = inDesktopApp() ? { state: 'idle' } : { state: 'unsupported' };
let pending: Update | null = null;
const listeners = new Set<Listener>();

function set(next: UpdateStatus) {
  status = next;
  for (const l of listeners) l();
}

export const updates = {
  subscribe(l: Listener) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  snapshot: () => status,
};

/** Asks whether a newer release is out. Quiet about failures when `quiet` (the check on start). */
export async function checkForUpdates(quiet = false): Promise<void> {
  if (status.state === 'unsupported' || status.state === 'checking' || status.state === 'downloading' || status.state === 'installing')
    return;
  const before = status;
  set({ state: 'checking' });
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    pending = update;
    set(
      update
        ? { state: 'available', version: update.version, notes: (update.body ?? '').trim() }
        : { state: 'current', checkedAt: Date.now() },
    );
  } catch (e) {
    console.warn('update check failed', e);
    if (quiet) set(before);
    else set({ state: 'error', message: friendly(e) });
  }
}

/** Downloads the update that was found, installs it and starts the new version. */
export async function installUpdate(): Promise<void> {
  const update = pending;
  if (!update || status.state !== 'available') return;
  const version = update.version;
  let total: number | null = null;
  let received = 0;
  set({ state: 'downloading', version, received, total });
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') total = event.data.contentLength ?? null;
      else if (event.event === 'Progress') received += event.data.chunkLength;
      else if (event.event === 'Finished') return set({ state: 'installing', version });
      set({ state: 'downloading', version, received, total });
    });
    set({ state: 'installing', version });
    // Windows closes the app itself to run the installer; elsewhere it starts again from here.
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (e) {
    console.warn('update failed', e);
    set({ state: 'error', message: `The update could not be installed: ${friendly(e)}` });
  }
}

function friendly(e: unknown): string {
  const text = String((e as Error)?.message ?? e);
  if (/valid release json|404|not found/i.test(text)) return 'No release has been published yet.';
  if (/signature/i.test(text)) return 'The download did not match the signature it should have, so it was not installed.';
  if (/network|connect|dns|timed? ?out|request/i.test(text)) return 'Could not reach GitHub. Check the connection and try again.';
  return text;
}
