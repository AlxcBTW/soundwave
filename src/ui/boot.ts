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

const reducedMotion = () => {
  const m = document.documentElement.dataset.motion;
  return m === 'reduced' || (m !== 'full' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
};

/**
 * Takes the loading screen away into the menu (see #boot.leaving in index.html): its title flies up
 * into the menu's own (the menu shows that once it has landed, see .scene.from-boot), while the rest
 * lifts away and the backdrop dissolves into the stage.
 */
export function bootDone() {
  const el = root();
  if (!el || el.classList.contains('leaving')) return;
  el.style.setProperty('--boot-p', '1');
  const word = el.querySelector<HTMLElement>('.boot-word');
  const target = document.querySelector<HTMLElement>('.scene .wordmark');
  if (word && target && !reducedMotion()) {
    const from = word.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    if (from.width > 0 && to.width > 0) {
      const scale = parseFloat(getComputedStyle(target).fontSize) / parseFloat(getComputedStyle(word).fontSize);
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      const landed = `translate(${dx}px, ${dy}px) scale(${scale})`;
      word.classList.add('flying');
      // It stays where it lands until the loading screen goes, over the wordmark that has shown under it.
      word.animate([{ transform: 'none' }, { transform: landed }], {
        duration: 680,
        easing: 'cubic-bezier(0.65, 0, 0.25, 1)',
        fill: 'forwards',
      });
      // Once the wordmark under it is in full, it gives way, so the glow of the two is never cut off.
      word.animate([{ opacity: 1 }, { opacity: 0 }], { delay: 720, duration: 150, fill: 'forwards' });
    }
  }
  el.classList.add('leaving');
  // A window that draws no frames never ends an animation, so a timer takes it away.
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
