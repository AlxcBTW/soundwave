import { afterEach, describe, expect, it, vi } from 'vitest';

// A check that never answers: the request hangs on a stalled connection.
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn<() => Promise<never>>(() => new Promise(() => {})) }));

describe('update check', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('gives up on a check that never answers, after a few short tries, instead of checking for good', async () => {
    // The desktop app: the page has Tauri's internals.
    vi.stubGlobal('window', Object.assign(globalThis, { __TAURI_INTERNALS__: {} }));
    vi.useFakeTimers();
    const { checkForUpdates, updates } = await import('../src/app/updates');
    const done = checkForUpdates();
    expect(updates.snapshot().state).toBe('checking');
    // Three tries of eight seconds at most each.
    await vi.advanceTimersByTimeAsync(25_000);
    await done;
    expect(updates.snapshot()).toEqual({ state: 'error', message: 'Could not reach GitHub. Check the connection and try again.' });
    // And the next check can start.
    void checkForUpdates();
    expect(updates.snapshot().state).toBe('checking');
  });

  it('gets through on the next try when one request stalls', async () => {
    vi.stubGlobal('window', Object.assign(globalThis, { __TAURI_INTERNALS__: {} }));
    vi.useFakeTimers();
    const updater = await import('@tauri-apps/plugin-updater');
    // The first request stalls; the second answers with a newer release.
    vi.mocked(updater.check)
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(() => Promise.resolve({ version: '9.9.9', body: '' } as never));
    const { checkForUpdates, updates } = await import('../src/app/updates');
    const done = checkForUpdates();
    await vi.advanceTimersByTimeAsync(9_000);
    await done;
    expect(updates.snapshot()).toEqual({ state: 'available', version: '9.9.9', notes: '' });
  });
});
