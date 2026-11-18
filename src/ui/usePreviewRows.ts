import { useEffect, useRef } from 'react';
import { useInputMode } from '../input/inputMode';

/**
 * Follows which song the player is on in a list, for its preview: the row that has the focus (the
 * keyboard, a controller, a finger) or, with a mouse, the row under the pointer. Rows say which song
 * they are with `data-preview`. The moment the player is on no row (the search field, a button, the
 * pointer off the list), `onCurrent` hears null, and the preview stops.
 */
export function usePreviewRows(onCurrent: (id: string | null) => void) {
  const mode = useInputMode();
  const state = useRef({ focused: null as string | null, hovered: null as string | null, mode });
  state.current.mode = mode;

  useEffect(() => {
    const s = state.current;
    const idOf = (t: EventTarget | null) =>
      t instanceof Element ? (t.closest<HTMLElement>('[data-preview]')?.dataset.preview ?? null) : null;
    const tell = () => onCurrent(s.mode === 'mouse' ? s.hovered : s.focused);
    const focusin = (e: FocusEvent) => {
      s.focused = idOf(e.target);
      tell();
    };
    // Focus that goes nowhere (the window was left) is off every row as well.
    const focusout = (e: FocusEvent) => {
      if (e.relatedTarget) return;
      s.focused = null;
      tell();
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const id = idOf(e.target);
      if (id === s.hovered) return;
      s.hovered = id;
      tell();
    };
    const gone = () => {
      s.hovered = null;
      tell();
    };
    // A row that already has the focus when the list appears counts from the start.
    s.focused = idOf(document.activeElement);
    tell();
    document.addEventListener('focusin', focusin);
    document.addEventListener('focusout', focusout);
    document.addEventListener('pointerover', over);
    document.documentElement.addEventListener('pointerleave', gone);
    return () => {
      document.removeEventListener('focusin', focusin);
      document.removeEventListener('focusout', focusout);
      document.removeEventListener('pointerover', over);
      document.documentElement.removeEventListener('pointerleave', gone);
      s.focused = s.hovered = null;
      onCurrent(null);
    };
  }, [onCurrent]);

  // Changing from the mouse to the keys (or back) changes which of the two counts.
  useEffect(() => {
    const s = state.current;
    onCurrent(mode === 'mouse' ? s.hovered : s.focused);
  }, [mode, onCurrent]);
}
