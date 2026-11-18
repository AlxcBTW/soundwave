import { afterEach, describe, expect, it } from 'vitest';
import { bound, chordOf, clashes, commandFor, keysOf, normalizeBindings, padCommandFor, setBindings } from '../src/input/bindings';

const key = (code: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('shortcut bindings', () => {
  afterEach(() => setBindings({}));

  it('writes a key press with what is held, Cmd counting as Ctrl', () => {
    expect(chordOf(key('KeyZ'))).toBe('KeyZ');
    expect(chordOf(key('KeyZ', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+KeyZ');
    expect(chordOf(key('KeyZ', { metaKey: true }))).toBe('Ctrl+KeyZ');
    expect(chordOf(key('ArrowUp', { altKey: true }))).toBe('Alt+ArrowUp');
  });

  it('answers to the defaults, and to the second key until a key of the player’s own is chosen', () => {
    expect(commandFor(key('KeyZ', { ctrlKey: true }), 'editor')).toBe('editor.undo');
    expect(commandFor(key('Backspace'), 'editor')).toBe('editor.delete');
    expect(padCommandFor('b8', 'editor')).toBe('editor.undo');
    setBindings({ 'editor.delete': { key: 'KeyQ' } });
    expect(commandFor(key('KeyQ'), 'editor')).toBe('editor.delete');
    expect(commandFor(key('Backspace'), 'editor')).toBeNull();
    expect(bound('editor.delete').key2).toBeNull();
  });

  it('lays the player’s choices over the defaults, null clearing one', () => {
    setBindings({ 'library.options': { key: 'Ctrl+KeyK', pad: null } });
    expect(keysOf('library.options')).toEqual({ kbd: 'Ctrl+KeyK', pad: undefined, mouse: 'm1' });
  });

  it('keeps Esc on Back whatever is stored', () => {
    setBindings({ 'menus.back': { key: 'KeyB', mouse: 'm4' } });
    expect(bound('menus.back').key).toBe('Escape');
    expect(bound('menus.back').mouse).toBe('m4');
  });

  it('says which other shortcuts nearby answer to the same input', () => {
    setBindings({ 'library.sort': { key: 'KeyO' } });
    expect(clashes('library.sort', 'key').map((c) => c.id)).toEqual(['library.options']);
    // The editor's own keys are not the library's.
    expect(clashes('editor.phrase', 'key').map((c) => c.id)).toEqual([]);
  });

  it('keeps only known shortcuts with inputs of the right shape from stored settings', () => {
    expect(
      normalizeBindings({
        'editor.undo': { key: 'Ctrl+KeyU', pad: null, mouse: 'm9' },
        'not.a.command': { key: 'KeyA' },
        'home.add': 'nonsense',
      }),
    ).toEqual({ 'editor.undo': { key: 'Ctrl+KeyU', pad: null } });
    expect(normalizeBindings(undefined)).toEqual({});
  });
});
