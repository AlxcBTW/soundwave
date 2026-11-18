import { playSfx, type Sfx } from '../audio/sfx';
import { MOVE_EVENT } from '../input/menuNav';
import { menuPulse, type MenuPulse } from '../input/rumble';

const PULSE: Partial<Record<Sfx, MenuPulse>> = {
  move: 'move',
  select: 'select',
  back: 'back',
  launch: 'launch',
  'toggle-on': 'select',
  'toggle-off': 'back',
};

/** A menu sound plus, on a controller, its matching pulse. */
function feedback(kind: Sfx) {
  playSfx(kind);
  const pulse = PULSE[kind];
  if (pulse) menuPulse(pulse);
}

const CONTROL = 'button, [role="tab"], [role="slider"], input[type="checkbox"], input[type="range"]';

/** During a song, only the pause menu's controls make menu sounds. */
function inGame(el: Element) {
  return !!document.querySelector('.play') && !el.closest('.overlay');
}

/** Buttons inside a row (a step arrow, say) leave the sound to their own handler. */
function quiet(el: HTMLElement) {
  return el.dataset.sfx === 'none';
}

/**
 * Menu sounds for every screen, from one place: a tick when focus moves (keyboard, controller)
 * or the pointer enters a control, and a sound when one is used. A control picks its own sound
 * with `data-sfx` (back, tab, launch, none); checkboxes toggle; everything else selects.
 */
export function installUiSounds(): () => void {
  let lastPointer = 0;
  let lastNav = 0;
  let hovered: Element | null = null;

  const pointerdown = () => (lastPointer = performance.now());
  const focusin = (e: FocusEvent) => {
    const el = (e.target as Element | null)?.closest?.(CONTROL);
    // Clicks make their own sound, and controller moves already announced theirs (MOVE_EVENT).
    if (!el || inGame(el) || performance.now() - lastPointer < 150 || performance.now() - lastNav < 60) return;
    feedback('move');
  };
  const navMove = () => {
    lastNav = performance.now();
    feedback('move');
  };
  const pointerover = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const el = (e.target as Element | null)?.closest?.(CONTROL) ?? null;
    if (el === hovered) return;
    hovered = el;
    if (el && !inGame(el) && !(el as HTMLButtonElement).disabled) playSfx('move');
  };
  const click = (e: MouseEvent) => {
    const el = (e.target as Element | null)?.closest?.(CONTROL) as HTMLElement | null;
    if (!el || inGame(el) || (el as HTMLButtonElement).disabled) return;
    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox') feedback(el.checked ? 'toggle-on' : 'toggle-off');
      return;
    }
    if (quiet(el)) return;
    feedback((el.dataset.sfx ?? (el.getAttribute('role') === 'tab' ? 'tab' : 'select')) as Sfx);
  };
  window.addEventListener('pointerdown', pointerdown, true);
  window.addEventListener('focusin', focusin, true);
  window.addEventListener('pointerover', pointerover, true);
  window.addEventListener('click', click, true);
  window.addEventListener(MOVE_EVENT, navMove);
  return () => {
    window.removeEventListener(MOVE_EVENT, navMove);
    window.removeEventListener('pointerdown', pointerdown, true);
    window.removeEventListener('focusin', focusin, true);
    window.removeEventListener('pointerover', pointerover, true);
    window.removeEventListener('click', click, true);
  };
}
