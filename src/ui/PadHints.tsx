import type { Settings } from '../game/settings';
import { PadGlyph } from '../input/glyphs';
import { backInput, confirmInput } from '../input/pads';
import { useGlyphStyle, usePads } from '../input/usePads';

/** Confirm / back legend while the player navigates menus with a controller. */
export function PadHints({ settings }: { settings: Settings }) {
  const snap = usePads();
  const style = useGlyphStyle(settings.glyphs);
  if (snap.lastDevice !== 'pad' || !snap.pads.length) return null;
  return (
    <div className="pad-hints" aria-hidden>
      <span><PadGlyph input={confirmInput(style)} style={style} /> Select</span>
      <span><PadGlyph input={backInput(style)} style={style} /> Back</span>
    </div>
  );
}
