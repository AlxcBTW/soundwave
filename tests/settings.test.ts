import { describe, expect, it } from 'vitest';
import { windowedSize } from '../src/game/displayMode';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../src/game/settings';

describe('display mode setting', () => {
  it('defaults to windowed fullscreen', () => {
    expect(DEFAULT_SETTINGS.displayMode).toBe('borderless');
  });

  it('gives settings stored before the option existed the default', () => {
    const { displayMode: _, ...stored } = DEFAULT_SETTINGS;
    expect(normalizeSettings(stored).displayMode).toBe('borderless');
  });

  it('keeps a stored choice and replaces an unknown one', () => {
    expect(normalizeSettings({ displayMode: 'windowed' }).displayMode).toBe('windowed');
    expect(normalizeSettings({ displayMode: 'fullscreen' }).displayMode).toBe('fullscreen');
    expect(normalizeSettings({ displayMode: 'exclusive' } as unknown as Partial<Settings>).displayMode).toBe('borderless');
  });
});

describe('windowedSize', () => {
  it.each([
    [1920, 1080, 1382, 864],
    [2560, 1440, 1600, 1000],
    [3840, 2160, 1600, 1000],
    [1366, 768, 983, 614],
  ])('fits a %i×%i monitor', (w, h, width, height) => {
    expect(windowedSize(w, h)).toEqual({ width, height });
  });

  it('never goes below the smallest window the app allows', () => {
    expect(windowedSize(1024, 600)).toEqual({ width: 960, height: 600 });
  });
});
