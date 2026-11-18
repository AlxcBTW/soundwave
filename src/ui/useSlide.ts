import { useLayoutEffect, useState } from 'react';

/**
 * The travelling selection light: measures the child marked `data-on="true"` inside the container
 * the returned ref is put on and publishes its box as CSS variables (--sel-x/y/w/h, --sel-o), which
 * a `.sel` element in the container uses to slide to the chosen item.
 *
 * The ref is a callback, so a container that only appears later (a row shown for the mouse but not
 * for a controller) is measured when it does, not only when the selection changes.
 */
export function useSlide<T extends HTMLElement>(selected: unknown) {
  const [el, setEl] = useState<T | null>(null);
  useLayoutEffect(() => {
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
    // The chosen item changes size too (its name appears beside its icon), not only the container.
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of el.children) if (!child.classList.contains('sel')) ro.observe(child);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [el, selected]);
  return setEl;
}
