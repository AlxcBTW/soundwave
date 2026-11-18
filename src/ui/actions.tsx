/**
 * The action bar: what the current screen (or the dialog on top of it) can do, as buttons along
 * the bottom edge. Each action has a key and, where it makes sense, a controller button; the bar
 * shows the hint that fits the input in use (a keycap, a controller glyph, or none for touch) and
 * every button also works by click or tap.
 */
import type { LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { Settings } from '../game/settings';
import { PadGlyph } from '../input/glyphs';
import { isTextField, useInputMode, type InputMode } from '../input/inputMode';
import { backInput, confirmInput, pads, type GlyphStyle, type PadInput } from '../input/pads';
import { useGlyphStyle } from '../input/usePads';
import { ICON_STROKE } from './icons';

export interface Action {
  id: string;
  label: string;
  icon: LucideIcon;
  /** `KeyboardEvent.code` of its key (Escape for back). */
  kbd?: string;
  /** Controller button by position (see input/pads). Back needs none: it follows Escape. */
  pad?: PadInput;
  /** False for an action whose button lives on the screen itself (marked `data-action`) instead of in the bar. */
  bar?: boolean;
  /** The screen's one forward step. */
  primary?: boolean;
  disabled?: boolean;
  /** Sound to make: `back`, `launch`, `none`; a plain select otherwise. */
  sfx?: string;
  run(): void;
}

interface Layer {
  id: number;
  actions: Action[];
}

const layers: Layer[] = [];
const listeners = new Set<() => void>();
let version = 0;
let nextId = 1;
const bump = () => {
  version++;
  for (const l of listeners) l();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const top = (): Action[] => layers[layers.length - 1]?.actions ?? [];

/**
 * An action with this id is not an action: its label says what the controller's confirm button does
 * on this screen, for the hint beside Back (which otherwise reads "Select").
 */
export const CONFIRM_HINT = 'confirm-hint';
const signature = (a: Action[]) => a.map((x) => `${x.id}|${x.label}|${x.kbd}|${x.pad}|${x.primary ? 1 : 0}|${x.disabled ? 1 : 0}|${x.bar === false ? 0 : 1}`).join(';');

/**
 * Declares the actions of a screen or dialog while it is mounted. The most recently mounted
 * declaration is the live one, so a dialog's actions replace its screen's until it closes.
 */
export function useActions(actions: Action[]) {
  const layer = useRef<Layer | null>(null);
  useLayoutEffect(() => {
    const mine: Layer = { id: nextId++, actions: [] };
    layer.current = mine;
    layers.push(mine);
    return () => {
      layers.splice(layers.indexOf(mine), 1);
      bump();
    };
  }, []);
  useLayoutEffect(() => {
    const mine = layer.current!;
    const changed = signature(mine.actions) !== signature(actions);
    mine.actions = actions;
    if (changed) bump();
  });
}

const KEY_NAMES: Record<string, string> = { Escape: 'Esc', Enter: 'Enter', Space: 'Space', Delete: 'Del', Backspace: 'Back', Slash: '/', Tab: 'Tab' };

/** A key as printed on its cap. */
export const keyName = (code: string) => KEY_NAMES[code] ?? (code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : code);

/** The hint for a control in the input in use: a keycap, a controller glyph, or nothing on touch. */
export function Hint({ kbd, pad, mode, style }: { kbd?: string; pad?: PadInput; mode: InputMode; style: GlyphStyle }) {
  if (mode === 'touch') return null;
  if (mode === 'pad') return pad ? <PadGlyph input={pad} style={style} className="hint-glyph" /> : null;
  return kbd ? <kbd className="keycap-hint">{keyName(kbd)}</kbd> : null;
}

/** Hint props for the settings and input in use, for hints outside the bar. */
export function useHints(settings: Settings) {
  return { mode: useInputMode(), style: useGlyphStyle(settings.glyphs) };
}

/** Runs an action through its button when it has one on screen (for its sound and pressed state). */
const trigger = (a: Action): boolean => {
  if (a.disabled) return false;
  const btn = document.querySelector<HTMLButtonElement>(`[data-action="${a.id}"]`);
  if (!btn) a.run();
  else if (btn.disabled) return false;
  else btn.click();
  return true;
};
export function ActionBar({ settings }: { settings: Settings }) {
  useSyncExternalStore(subscribe, () => version);
  const mode = useInputMode();
  const style = useGlyphStyle(settings.glyphs);
  const actions = top().filter((a) => a.bar !== false && a.id !== CONFIRM_HINT);
  const confirmLabel = top().find((a) => a.id === CONFIRM_HINT)?.label ?? 'Select';

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      // Typing never triggers a letter shortcut; Escape still leaves the field's screen.
      if (isTextField(e.target) && e.code !== 'Escape') return;
      // Enter on a focused control presses that control, not the bar's Enter action.
      if (e.code === 'Enter' && e.target instanceof HTMLElement && e.target.closest('button, a, input, [role="slider"]')) return;
      const a = top().find((x) => x.kbd === e.code);
      if (a && trigger(a)) e.preventDefault();
    };
    const release = pads.capture((e) => {
      if (!e.down) return false;
      const a = top().find((x) => x.pad === e.input);
      return a ? (trigger(a), true) : false;
    });
    window.addEventListener('keydown', key);
    return () => {
      release();
      window.removeEventListener('keydown', key);
    };
  }, []);

  if (!actions.length) return null;
  const back = actions.filter((a) => a.kbd === 'Escape');
  const rest = actions.filter((a) => a.kbd !== 'Escape' && !a.primary);
  const primary = actions.filter((a) => a.primary);
  // The bar only re-renders when an action's look changes, so a press always looks the action up afresh.
  const button = (a: Action) => (
    <button key={a.id} type="button" className={`act ${a.primary ? 'primary' : ''}`} data-action={a.id} data-sfx={a.sfx} aria-label={a.label} disabled={a.disabled} onClick={() => top().find((x) => x.id === a.id)?.run()}>
      <Hint kbd={a.kbd} pad={a.kbd === 'Escape' ? backInput(style) : a.kbd === 'Enter' ? confirmInput(style) : a.pad} mode={mode} style={style} />
      <a.icon className="act-icon" strokeWidth={ICON_STROKE} aria-hidden />
      <span className="act-label">{a.label}</span>
    </button>
  );
  return (
    <footer className="action-bar" data-nav-skip aria-label="Actions">
      <div className="act-group">
        {back.map(button)}
        {mode === 'pad' && !actions.some((a) => a.kbd === 'Enter') && (
          <span className="act-passive">
            <PadGlyph input={confirmInput(style)} style={style} className="hint-glyph" /> {confirmLabel}
          </span>
        )}
      </div>
      <div className="act-group end">
        {rest.map(button)}
        {primary.map(button)}
      </div>
    </footer>
  );
}
