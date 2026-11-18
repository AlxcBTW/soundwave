/**
 * The loading screen is part of index.html, so it is on screen before any script has run. The game
 * moves its progress line while it gets ready (the library, then the stage) and takes it away when
 * everything is there.
 */
const root = () => document.getElementById('boot');
let shown = 0;

/** Moves the progress line (0..1; it never goes back) and says what is being loaded. */
export function bootStep(progress: number, label: string) {
  const el = root();
  if (!el) return;
  shown = Math.max(shown, Math.min(1, progress));
  el.style.setProperty('--boot-p', shown.toFixed(3));
  const step = el.querySelector('.boot-step');
  if (step && step.textContent !== label) step.textContent = label;
}

/** Fades the loading screen out and removes it. */
export function bootDone() {
  const el = root();
  if (!el || el.classList.contains('leaving')) return;
  el.style.setProperty('--boot-p', '1');
  el.classList.add('leaving');
  // The fade is a transition; a window that draws no frames never ends one, so a timer backs it up.
  window.setTimeout(() => el.remove(), 900);
}

/**
 * The words on the loading screen wait for the game's typeface, so they never show in a stand-in
 * one first (the animation needs no type and runs from the first frame).
 */
export function bootFonts() {
  const show = () => document.documentElement.classList.add('fonts');
  const late = window.setTimeout(show, 2500);
  void Promise.all([document.fonts.load("italic 900 1em 'Archivo Variable'"), document.fonts.load("700 1em 'Archivo Variable'")])
    .catch(() => undefined)
    .then(() => {
      clearTimeout(late);
      show();
    });
}
