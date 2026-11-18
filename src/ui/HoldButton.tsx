import { useEffect, useRef, type ReactNode } from 'react';
import { startSfx } from '../audio/sfx';
import { confirmInput, pads, type GlyphStyle } from '../input/pads';

/** How long the button must be held, ms. */
const HOLD_MS = 650;

interface Props {
  label: string;
  hint: ReactNode;
  /** A large symbol at the button's left end (the controller button to hold). */
  glyph?: ReactNode;
  disabled?: boolean;
  /** `danger` for a hold that destroys something. */
  tone?: 'primary' | 'danger';
  glyphStyle: GlyphStyle;
  onComplete(): void;
}

/**
 * A button that starts something big, so it asks to be held: it fills while a pointer, the Enter
 * or Space key, or the controller's confirm button is down, and fires when full. Letting go early
 * drains it. A click that comes without a press (a screen reader, switch access) fires at once.
 */
export function HoldButton({ label, hint, glyph, disabled, tone = 'primary', glyphStyle, onComplete }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const done = useRef(onComplete);
  done.current = onComplete;
  const styleRef = useRef(glyphStyle);
  styleRef.current = glyphStyle;

  useEffect(() => {
    const btn = ref.current!;
    let raf = 0;
    let start = 0;
    let level = 0;
    let holding = false;
    let fired = false;
    let reset = 0;
    /** Fades the swell out (it runs on into the launch when the hold completes). */
    let quiet = () => {};
    /** A press was seen, so the click that follows it is not a bare activation. */
    let pressed = 0;

    const paint = () => btn.style.setProperty('--hold', level.toFixed(3));
    const tick = (now: number) => {
      if (holding) {
        level = Math.min(1, (now - start) / HOLD_MS);
        if (level >= 1 && !fired) {
          fired = true;
          holding = false;
          btn.classList.add('fired');
          done.current();
          // Still here a moment later means nothing started (no notes, a file that would not load):
          // the button empties and can be held again.
          reset = window.setTimeout(() => {
            fired = false;
            level = 0;
            btn.classList.remove('fired', 'holding');
            paint();
          }, 2600);
        }
      } else if (!fired) {
        level = Math.max(0, level - 0.06);
      }
      paint();
      if (holding || (level > 0 && !fired)) raf = requestAnimationFrame(tick);
    };
    const begin = () => {
      pressed = performance.now();
      if (btn.disabled || holding || fired) return;
      holding = true;
      // The swell picks up where the fill is, so a press that resumes does not start over.
      quiet();
      quiet = startSfx('hold', (level * HOLD_MS) / 1000);
      start = performance.now() - level * HOLD_MS;
      btn.classList.add('holding');
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const end = () => {
      if (!holding) return;
      quiet();
      holding = false;
      btn.classList.remove('holding');
    };

    const pointerdown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer that is already gone cannot be captured; the hold still counts */
      }
      begin();
    };
    const keydown = (e: KeyboardEvent) => {
      if (e.code !== 'Enter' && e.code !== 'Space') return;
      e.preventDefault();
      if (!e.repeat) begin();
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        end();
      }
    };
    const click = () => {
      // No press came first: activated by assistive technology, which cannot hold.
      if (performance.now() - pressed > 1500 && !btn.disabled && !fired) {
        fired = true;
        level = 1;
        paint();
        done.current();
      }
    };
    const releasePad = pads.capture((e) => {
      if (document.activeElement !== btn || e.input !== confirmInput(styleRef.current)) return false;
      if (e.down) begin();
      else end();
      return true;
    });

    btn.addEventListener('pointerdown', pointerdown);
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('keydown', keydown);
    btn.addEventListener('keyup', keyup);
    btn.addEventListener('blur', end);
    btn.addEventListener('click', click);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(reset);
      quiet();
      releasePad();
      btn.removeEventListener('pointerdown', pointerdown);
      btn.removeEventListener('pointerup', end);
      btn.removeEventListener('pointercancel', end);
      btn.removeEventListener('keydown', keydown);
      btn.removeEventListener('keyup', keyup);
      btn.removeEventListener('blur', end);
      btn.removeEventListener('click', click);
    };
  }, []);

  return (
    <button ref={ref} type="button" className={`hold-btn ${tone}`} data-sfx="none" data-autofocus disabled={disabled}>
      <span className="hold-fill" aria-hidden />
      {glyph && (
        <span className="hold-glyph" aria-hidden>
          {glyph}
        </span>
      )}
      <span className="hold-text">
        <span className="hold-label">{label}</span>
        <span className="hold-hint">{hint}</span>
      </span>
    </button>
  );
}
