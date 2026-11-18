import { describe, expect, it } from 'vitest';
import { inputName } from '../src/input/glyphs';
import { nearest } from '../src/input/menuNav';
import { backInput, confirmInput, detectFamily, padName, readPad } from '../src/input/pads';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/game/settings';

describe('detectFamily', () => {
  it.each([
    ['Xbox 360 Controller (XInput STANDARD GAMEPAD)', 'xbox'],
    ['Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', 'xbox'],
    ['Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', 'ps4'],
    ['DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', 'ps5'],
    ['054c-0df2-DualSense Edge Wireless Controller', 'ps5'],
    ['Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)', 'switch'],
    ['057e-2006-Joy-Con (L)', 'switch'],
    ['USB Gamepad (Vendor: 0079 Product: 0011)', 'generic'],
  ])('%s → %s', (id, family) => {
    expect(detectFamily(id)).toBe(family);
  });

  it('cleans up names', () => {
    expect(padName('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('DualSense Wireless Controller');
    expect(padName('054c-0ce6-DualSense Wireless Controller')).toBe('DualSense Wireless Controller');
  });
});

describe('readPad', () => {
  const btn = (value: number) => ({ pressed: value > 0.5, value });
  const pad = (buttons: number[], axes: number[] = [0, 0, 0, 0]) => ({ buttons: buttons.map(btn), axes });

  it('reports presses and releases, with hysteresis on triggers', () => {
    let r = readPad(pad([0, 0, 0, 0, 0, 0, 0.5, 0]), undefined);
    expect(r.changes).toEqual([{ input: 'b6', down: true }]);
    // Easing off a little doesn't release the trigger.
    r = readPad(pad([0, 0, 0, 0, 0, 0, 0.3, 0]), r.state);
    expect(r.changes).toEqual([]);
    r = readPad(pad([0, 0, 0, 0, 0, 0, 0.1, 0]), r.state);
    expect(r.changes).toEqual([{ input: 'b6', down: false }]);
  });

  it('turns stick directions into inputs', () => {
    let r = readPad(pad([], [0, -0.9]), undefined);
    expect(r.changes).toEqual([{ input: 'a1-', down: true }]);
    // Flicking straight to the other side releases the first direction first.
    r = readPad(pad([], [0, 0.95]), r.state);
    expect(r.changes).toEqual([
      { input: 'a1-', down: false },
      { input: 'a1+', down: true },
    ]);
  });
});

describe('glyphs', () => {
  it('names the same position per controller family', () => {
    expect(['xbox', 'ps4', 'ps5', 'switch'].map((s) => inputName('b0', s as never))).toEqual(['A', 'Cross', 'Cross', 'B']);
    expect(inputName('b6', 'ps5')).toBe('L2');
    expect(inputName('b6', 'switch')).toBe('ZL');
    expect(inputName('b8', 'ps4')).toBe('Share');
    expect(inputName('b8', 'ps5')).toBe('Create');
    expect(inputName('a1-', 'xbox')).toBe('Left stick Up');
  });

  it('confirms with A on every family (the right face button on Switch)', () => {
    expect(confirmInput('xbox')).toBe('b0');
    expect(confirmInput('switch')).toBe('b1');
    expect(backInput('switch')).toBe('b0');
  });
});

describe('menu navigation', () => {
  const rect = (x: number, y: number, w = 100, h = 40) =>
    ({ x, y, width: w, height: h, left: x, top: y, right: x + w, bottom: y + h }) as DOMRect;
  it('moves to the nearest control in line', () => {
    const from = rect(100, 100);
    const others = [rect(100, 200), rect(400, 160), rect(260, 100), rect(100, 0)];
    expect(nearest(from, 'down', others)).toBe(0);
    expect(nearest(from, 'right', others)).toBe(2);
    expect(nearest(from, 'up', others)).toBe(3);
    expect(nearest(from, 'left', others)).toBe(-1);
  });
});

describe('settings', () => {
  it('repairs bindings stored by older versions', () => {
    const s = normalizeSettings({ keys4: ['KeyA'], trackSpeed: 1.5 });
    expect(s.keys4).toEqual(DEFAULT_SETTINGS.keys4);
    expect(s.pad5).toHaveLength(5);
    expect(s.trackSpeed).toBe(1.5);
  });

  it('turns a stored note speed into the track speed, within its range', () => {
    expect(DEFAULT_SETTINGS.trackSpeed).toBe(1);
    expect(normalizeSettings({ noteSpeed: 9 } as never).trackSpeed).toBe(1);
    const old = normalizeSettings({ noteSpeed: 12 } as never);
    expect(old.trackSpeed).toBe(1.35);
    expect('noteSpeed' in old).toBe(false);
    expect(normalizeSettings({ noteSpeed: 16, trackSpeed: 2 } as never).trackSpeed).toBe(2);
    expect(normalizeSettings({ trackSpeed: 7 }).trackSpeed).toBe(3);
    expect(normalizeSettings({ trackSpeed: 0.1 }).trackSpeed).toBe(0.5);
    expect(normalizeSettings({ trackSpeed: Number.NaN }).trackSpeed).toBe(1);
  });

  it('moves unchanged old controller defaults to the current ones, keeping custom bindings', () => {
    const old = normalizeSettings({ pad4: ['b6', 'b4', 'b5', 'b7'], pad5: ['b6', 'b4', 'b0', 'b5', 'b7'], padOverdrive: 'b3' });
    expect(old.pad5).toEqual(['b14', 'b15', 'b2', 'b3', 'b1']);
    expect(old.padOverdrive).toBe('b7');
    const custom = normalizeSettings({ pad4: ['b0', 'b1', 'b2', 'b3'] });
    expect(custom.pad4).toEqual(['b0', 'b1', 'b2', 'b3']);
  });

  it('turns the old rumble switch into a level', () => {
    expect(normalizeSettings({ rumble: true } as never).rumble).toBe('strong');
    expect(normalizeSettings({ rumble: false } as never).rumble).toBe('off');
    expect('rumbleStrength' in normalizeSettings({ rumbleStrength: 0.3 } as never)).toBe(false);
  });
});

describe('GamepadInput', () => {
  it('routes lanes, overdrive and pause, and hands input to the menus while paused', async () => {
    const { GamepadInput } = await import('../src/game/input');
    const { pads } = await import('../src/input/pads');
    const log: string[] = [];
    const menus: string[] = [];
    let active = true;
    const releaseMenus = pads.capture((e) => void menus.push(e.input));
    const input = new GamepadInput(
      ['b6', 'b4', 'b5', 'b7'],
      'b3',
      {
        press: (l, t) => log.push(`press ${l} @${t}`),
        release: (l) => log.push(`release ${l}`),
        overdrive: () => log.push('overdrive'),
        pause: () => log.push('pause'),
      },
      () => active,
    );
    const emit = (input: string, down: boolean, t = 1) => (pads as unknown as { emit(e: object): void }).emit({ input, down, t, pad: 0 });
    emit('b6', true, 5);
    emit('b6', false);
    emit('b3', true);
    emit('b12', true); // unbound during play: swallowed, not a menu move
    active = false;
    emit('b4', true); // paused: goes to the menus
    emit('b9', true); // pause button still works
    expect(log).toEqual(['press 0 @5', 'release 0', 'overdrive', 'pause']);
    expect(menus).toEqual(['b4']);
    input.dispose();
    releaseMenus();
  });
});
