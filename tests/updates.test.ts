import { afterEach, describe, expect, it, vi } from 'vitest';

// A check that never answers: the request hangs on a stalled connection.
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn(() => new Promise(() => {})) }));

describe('update check', () => {
  afterEach(() => vi.useRealTimers());

  it('gives up on a check that never answers, instead of checking for good', async () => {
    // The desktop app: the page has Tauri's internals.
    vi.stubGlobal('window', Object.assign(globalThis, { __TAURI_INTERNALS__: {} }));
    vi.useFakeTimers();
    const { checkForUpdates, updates } = await import('../src/app/updates');
    const done = checkForUpdates();
    expect(updates.snapshot().state).toBe('checking');
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
    expect(updates.snapshot()).toEqual({ state: 'error', message: 'Could not reach GitHub. Check the connection and try again.' });
    // And the next check can start.
    void checkForUpdates();
    expect(updates.snapshot().state).toBe('checking');
  });
});
