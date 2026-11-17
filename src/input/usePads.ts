import { useSyncExternalStore } from 'react';
import { pads, resolveStyle, type GlyphStyle, type PadSnapshot } from './pads';

const subscribe = (fn: () => void) => pads.subscribe(fn);

/** Connected controllers and which device the player used last (re-renders on change). */
export const usePads = (): PadSnapshot => useSyncExternalStore(subscribe, pads.snapshot);

/** The glyph style to draw for the given preference. */
export function useGlyphStyle(pref: 'auto' | GlyphStyle): GlyphStyle {
  return resolveStyle(pref, usePads().family);
}
