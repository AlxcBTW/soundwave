import { useEffect, useRef } from 'react';
import { getInputMode, usesFocus } from '../input/inputMode';

/** How long the ring takes to travel to a newly focused control, ms (matches --ring-ms in the CSS). */
const GLIDE = 200;

/**
 * The focus light: one ring that travels from control to control as focus moves with the keyboard
 * or a controller, taking each control's size and corner radius as it lands. Mouse and touch
 * players never see it. The focused control also carries `.is-focus` for its own lit state.
 */
export function FocusRing() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ring = ref.current!;
    let target: HTMLElement | null = null;
    let shown = false;
    let movedAt = 0;
    let last = '';
    let raf = 0;

    const pick = (): HTMLElement | null => {
      if (!usesFocus(getInputMode()) || document.querySelector('[data-nav-off]')) return null;
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || !el.isConnected || el.dataset.ring === 'none') return null;
      return el;
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const el = pick();
      if (el !== target) {
        target?.classList.remove('is-focus');
        el?.classList.add('is-focus');
        // Arriving from nowhere the ring fades in on the spot; between controls it glides.
        // Onto a new screen it lands with the control instead of flying across the change.
        ring.classList.toggle('glide', !!el && shown && !!target?.isConnected);
        movedAt = performance.now();
        target = el;
        last = '';
      }
      if (!el) {
        if (shown) {
          shown = false;
          ring.classList.remove('on', 'glide');
        }
        return;
      }
      if (ring.classList.contains('glide') && performance.now() - movedAt > GLIDE) ring.classList.remove('glide');
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      const radius = getComputedStyle(el).borderTopLeftRadius;
      const next = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)},${radius}`;
      if (next !== last) {
        last = next;
        ring.style.transform = `translate(${Math.round(r.left)}px, ${Math.round(r.top)}px)`;
        ring.style.width = `${Math.round(r.width)}px`;
        ring.style.height = `${Math.round(r.height)}px`;
        ring.style.setProperty('--ring-radius', radius);
      }
      if (!shown) {
        shown = true;
        ring.classList.add('on');
      }
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      target?.classList.remove('is-focus');
    };
  }, []);
  return <div ref={ref} className="focus-ring" aria-hidden />;
}
