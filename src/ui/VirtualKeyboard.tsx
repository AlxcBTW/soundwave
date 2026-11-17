import { ArrowBigUp, ChevronLeft, ChevronRight, Check, Delete, Space, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings } from '../game/settings';
import { PadGlyph } from '../input/glyphs';
import { pads, type PadInput } from '../input/pads';
import { watchTouchpad } from '../input/touchpad';
import { useGlyphStyle } from '../input/usePads';
import { useActions } from './actions';
import { ICON_STROKE } from './icons';

type Field = HTMLInputElement | HTMLTextAreaElement;

interface Props {
  /** The field being typed into. It is updated with every key, so a search narrows as it is typed. */
  target: Field;
  settings: Settings;
  onClose(): void;
}

/** The layout of a console keyboard: digits, three rows of letters ending in the commonest marks, and a page of symbols. */
const LETTERS = ['1234567890', 'qwertyuiop', "asdfghjkl'", 'zxcvbnm,.?'];
const SYMBOLS = ['1234567890', '-/:;()$&@"', ".,?!'#%^*+", '=_\\|~<>[]`'];

/** The buttons that work the keyboard without moving onto a key, named by position (see input/pads.ts). */
const PAD = { del: 'b2', space: 'b3', left: 'b4', right: 'b5', shift: 'b6', done: 'b7', symbols: 'b10' } as const satisfies Record<string, PadInput>;

/** How far the focus travels for a swipe across the whole touchpad, in keyboard widths (and heights). */
const SWIPE_REACH = 1.35;

/** Sets a field's value the way typing would, so the screen that owns the field hears about it. */
function write(field: Field, value: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** What the field is for, in a few words: its own label, or its placeholder. */
function nameOf(field: Field): string {
  const id = field.id && document.querySelector<HTMLElement>(`label[for="${CSS.escape(field.id)}"]`)?.textContent;
  return (id || field.placeholder || field.getAttribute('aria-label') || 'Text').trim();
}

/**
 * The on-screen keyboard for a controller: it opens when a text field is pressed with the
 * controller's confirm button. Keys are moved between and pressed like any other control, and the
 * usual console shortcuts work from anywhere on it: the right trigger is done, the left trigger
 * shifts, the left face button deletes, the top one is a space, the shoulder buttons move the
 * cursor and a click of the left stick turns to the symbols. Back cancels and puts the text back.
 */
export function VirtualKeyboard({ target, settings, onClose }: Props) {
  const style = useGlyphStyle(settings.glyphs);
  const original = useRef(target.value);
  const [value, setValue] = useState(target.value);
  const [caret, setCaret] = useState(target.value.length);
  const [shift, setShift] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  /** The touchpad's cursor. */
  const pointer = useRef<HTMLDivElement>(null);
  const live = useRef({ value, caret, shift });
  live.current = { value, caret, shift };
  const max = target.maxLength > 0 ? target.maxLength : Infinity;

  const change = useCallback(
    (next: string, at: number) => {
      setValue(next);
      setCaret(Math.max(0, Math.min(next.length, at)));
      write(target, next);
    },
    [target],
  );
  const type = useCallback(
    (ch: string) => {
      const { value: v, caret: c, shift: up } = live.current;
      if (v.length >= max) return;
      change(v.slice(0, c) + (up ? ch.toUpperCase() : ch) + v.slice(c), c + 1);
      // Shift holds for one letter, as on a phone.
      if (up) setShift(false);
    },
    [change, max],
  );
  const del = useCallback(() => {
    const { value: v, caret: c } = live.current;
    if (c > 0) change(v.slice(0, c - 1) + v.slice(c), c - 1);
  }, [change]);
  const move = useCallback((d: -1 | 1) => setCaret((c) => Math.max(0, Math.min(live.current.value.length, c + d))), []);
  const finish = useCallback(
    (keep: boolean) => {
      if (!keep) write(target, original.current);
      onClose();
      // Focus goes back to the field, where the controller left it.
      requestAnimationFrame(() => target.isConnected && target.focus({ preventScroll: true }));
    },
    [onClose, target],
  );

  useActions([
    { id: 'vk-cancel', label: 'Cancel', icon: X, kbd: 'Escape', sfx: 'back', run: () => finish(false) },
    { id: 'vk-del', label: 'Delete', icon: Delete, pad: PAD.del, bar: false, run: del },
    { id: 'vk-space', label: 'Space', icon: Space, pad: PAD.space, bar: false, run: () => type(' ') },
    { id: 'vk-done', label: 'Done', icon: Check, pad: PAD.done, bar: false, run: () => finish(true) },
  ]);

  // The triggers, shoulder buttons and stick click belong to the keyboard while it is open (the
  // screen underneath would otherwise switch tabs on the shoulder buttons).
  useEffect(
    () =>
      pads.capture((e) => {
        if (e.input === PAD.left || e.input === PAD.right) {
          if (e.down) move(e.input === PAD.left ? -1 : 1);
          return true;
        }
        if (e.input === PAD.shift) {
          if (e.down) setShift((s) => !s);
          return true;
        }
        if (e.input === PAD.symbols) {
          if (e.down) setSymbols((s) => !s);
          return true;
        }
        return false;
      }),
    [move],
  );

  // A controller's touchpad works a cursor: a finger sliding over the pad moves a pointer across
  // the keyboard from where it was (like a laptop's trackpad), the key under it takes the focus,
  // and a click of the pad presses that key. The finger comes from the browser where it reports
  // the touchpad, and from the desktop app itself otherwise (see input/touchpad.ts); where neither
  // can, the click alone still presses the key in focus.
  useEffect(() => {
    let raf = 0;
    let pointed: HTMLElement | null = null;
    // Where the finger came down, and where the cursor was at that moment.
    let origin: { fx: number; fy: number; x: number; y: number } | null = null;
    // Where the cursor was left, so the next swipe carries on from there.
    let cursor: { x: number; y: number } | null = null;
    let hide = 0;
    const touchpad = watchTouchpad();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const finger = touchpad.read();
      const keys = box.current?.querySelector<HTMLElement>('.vk-keys');
      const dot = pointer.current;
      if (!finger || !keys || !dot) {
        // The finger is off the pad: the cursor stays a moment, then fades.
        if (origin) hide = window.setTimeout(() => dot?.classList.remove('on'), 900);
        pointed = null;
        origin = null;
        return;
      }
      const area = keys.getBoundingClientRect();
      if (!origin) {
        clearTimeout(hide);
        // It starts from where it was left, or from the key in focus the first time.
        const from = (box.current?.contains(document.activeElement) ? (document.activeElement as HTMLElement) : keys).getBoundingClientRect();
        const at = cursor && dot.classList.contains('on') ? cursor : { x: from.left + from.width / 2, y: from.top + from.height / 2 };
        origin = { fx: finger.x, fy: finger.y, x: at.x, y: at.y };
      }
      // The pad's surface is -1..1 both ways; a swipe across most of it crosses the whole keyboard.
      const x = Math.max(area.left, Math.min(area.right, origin.x + ((finger.x - origin.fx) / 2) * area.width * SWIPE_REACH));
      const y = Math.max(area.top, Math.min(area.bottom, origin.y + ((finger.y - origin.fy) / 2) * area.height * SWIPE_REACH));
      cursor = { x, y };
      dot.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      dot.classList.add('on');
      let best: HTMLElement | null = null;
      let near = Infinity;
      for (const key of keys.querySelectorAll<HTMLElement>('.vk-key:not(:disabled)')) {
        const r = key.getBoundingClientRect();
        const dx = Math.max(r.left - x, 0, x - r.right);
        const dy = Math.max(r.top - y, 0, y - r.bottom);
        const d = dx * dx + dy * dy;
        if (d < near) {
          near = d;
          best = key;
        }
      }
      if (best && best !== pointed) {
        pointed = best;
        best.focus({ preventScroll: true });
      }
    };
    tick();
    const release = pads.capture((e) => {
      if (e.input !== 'b17') return false;
      const key = document.activeElement as HTMLElement | null;
      if (e.down && key && box.current?.contains(key)) key.click();
      return true;
    });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(hide);
      touchpad.stop();
      release();
    };
  }, []);

  // It opens with focus on the first letter.
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
  }, []);

  const rows = symbols ? SYMBOLS : LETTERS;
  const glyph = (input: PadInput) => <PadGlyph input={input} style={style} className="hint-glyph" />;
  const shown = target instanceof HTMLInputElement && target.type === 'password' ? '•'.repeat(value.length) : value;

  return (
    <div className="vk-over" data-modal>
      <div className="vk-pointer" ref={pointer} aria-hidden />
      <div className="vk" ref={box} role="dialog" aria-modal="true" aria-label={`Keyboard: ${nameOf(target)}`}>
        <div className="vk-head">
          <span className="label">{nameOf(target)}</span>
          <div className="vk-field" aria-live="polite" aria-atomic>
            <span className="vk-text">{shown.slice(0, caret)}</span>
            <span className="vk-caret" aria-hidden />
            <span className="vk-text">{shown.slice(caret)}</span>
          </div>
        </div>
        <div className="vk-keys" data-nav-group="vk">
          {rows.map((row, r) => (
            <div className="vk-row" key={r}>
              {[...row].map((ch, i) => {
                const face = shift && !symbols ? ch.toUpperCase() : ch;
                return (
                  <button key={ch} type="button" className="vk-key" data-autofocus={r === 1 && i === 0 ? '' : undefined} aria-label={ch === ' ' ? 'Space' : face} onClick={() => type(ch)}>
                    {face}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="vk-row vk-bottom">
            <button type="button" className={`vk-key wide ${shift ? 'on' : ''}`} aria-pressed={shift} aria-label="Shift" disabled={symbols} onClick={() => setShift((s) => !s)}>
              {glyph(PAD.shift)}
              <ArrowBigUp strokeWidth={ICON_STROKE} aria-hidden />
            </button>
            <button type="button" className={`vk-key wide ${symbols ? 'on' : ''}`} aria-pressed={symbols} aria-label={symbols ? 'Letters' : 'Symbols'} onClick={() => setSymbols((s) => !s)}>
              {glyph(PAD.symbols)}
              {symbols ? 'abc' : '#+='}
            </button>
            <button type="button" className="vk-key space" data-action="vk-space" aria-label="Space" onClick={() => type(' ')}>
              {glyph(PAD.space)}
              <Space strokeWidth={ICON_STROKE} aria-hidden />
            </button>
            <button type="button" className="vk-key" aria-label="Cursor left" onClick={() => move(-1)}>
              {glyph(PAD.left)}
              <ChevronLeft strokeWidth={3} aria-hidden />
            </button>
            <button type="button" className="vk-key" aria-label="Cursor right" onClick={() => move(1)}>
              <ChevronRight strokeWidth={3} aria-hidden />
              {glyph(PAD.right)}
            </button>
            <button type="button" className="vk-key wide" data-action="vk-del" aria-label="Delete" onClick={del}>
              {glyph(PAD.del)}
              <Delete strokeWidth={ICON_STROKE} aria-hidden />
            </button>
            <button type="button" className="vk-key wide done" data-action="vk-done" onClick={() => finish(true)}>
              {glyph(PAD.done)}
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
