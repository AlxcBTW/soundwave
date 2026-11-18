/**
 * Moving the desktop app's window by its background. In Window mode a press on the menus' backdrop
 * (anywhere nothing else is: around the panels, on a bare heading) drags the window, as a title bar
 * would. Anything with a use of its own keeps its press: controls, and any surface with a fill or a
 * frame of its own (panels, cards, rows), along with everything on it.
 */

/** Elements that take presses themselves. */
const CONTROLS = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  'canvas',
  'video',
  'dialog',
  // Roles that are controls (not a page's landmarks, panels or lists).
  ...[
    'button',
    'link',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'tab',
    'checkbox',
    'radio',
    'switch',
    'option',
    'slider',
    'spinbutton',
    'textbox',
    'searchbox',
    'combobox',
    'gridcell',
    'row',
    'treeitem',
    'scrollbar',
    'dialog',
  ].map((r) => `[role="${r}"]`),
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]:not([contenteditable="false"])',
  '[draggable="true"]',
].join(', ');

/** Whether a computed colour shows at all. */
const shows = (color: string) => {
  if (!color || color === 'transparent') return false;
  const alpha = color.match(/rgba?\([^)]*[,/]\s*([\d.]+%?)\s*\)/);
  return !alpha || Number.parseFloat(alpha[1]) > 0;
};

/** Whether an element is a surface of its own: filled, framed or frosted. */
function isSurface(el: Element): boolean {
  const css = getComputedStyle(el);
  if (shows(css.backgroundColor) || css.backgroundImage !== 'none') return true;
  if (css.backdropFilter && css.backdropFilter !== 'none') return true;
  for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const)
    if (
      Number.parseFloat(css.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 &&
      shows(css.getPropertyValue(`border-${side.toLowerCase()}-color`))
    )
      return true;
  return css.cursor === 'pointer';
}

/**
 * Whether a press on `target` falls on the backdrop of `root`: nothing between them is a control or
 * a surface of its own.
 */
export function onBackdrop(target: Element, root: Element): boolean {
  if (!root.contains(target)) return false;
  for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
    if (el.matches(CONTROLS) || isSurface(el)) return false;
  }
  return true;
}
