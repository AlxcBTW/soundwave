import { useLayoutEffect, useRef } from 'react';

/**
 * The travelling selection light: measures the child marked `data-on="true"` inside the
 * returned container and publishes its box as CSS variables (--sel-x/y/w/h, --sel-o), which a
 * `.sel` element in the container uses to slide to the chosen item.
 */
export function useSlide<T extends HTMLElement>(selected: unknown) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const on = el.querySelector<HTMLElement>(':scope > [data-on="true"]');
      if (!on) return el.style.setProperty('--sel-o', '0');
      el.style.setProperty('--sel-x', `${on.offsetLeft}px`);
      el.style.setProperty('--sel-y', `${on.offsetTop}px`);
      el.style.setProperty('--sel-w', `${on.offsetWidth}px`);
      el.style.setProperty('--sel-h', `${on.offsetHeight}px`);
      el.style.setProperty('--sel-o', '1');
    };
    update();
    // The first placement appears in place; later ones travel.
    const raf = requestAnimationFrame(() => el.classList.add('ready'));
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [selected]);
  return ref;
}
