import { applyPreset, DEFAULT_GRAPHICS, type GraphicsPreset } from '../game/graphics';
import { AuroraStage } from '../render/aurora/AuroraStage';

/**
 * Dev-only: the Moonrise venue full screen with a simulated song. Open
 * /#slice?preset=high&bpm=126&shot=hero&level=0.9 (shot pins one camera, level pins how busy the
 * music is, od = seconds until overdrive).
 */
export async function runSlicePreview(root: HTMLElement) {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const preset = (q.get('preset') ?? 'high') as GraphicsPreset;
  const g = applyPreset({ ...DEFAULT_GRAPHICS, camera: 'auto' }, preset);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;background:#000';
  root.replaceChildren(host);
  const stage = await AuroraStage.create(host, g, { mode: 'play', part: 'lead' });
  (window as unknown as { __stage: AuroraStage }).__stage = stage;
  // No fade-in here: a capture right after loading should show the stage, not the fade.
  const canvas = host.querySelector('canvas');
  if (canvas) canvas.style.cssText += ';opacity:1;transition:none';
  const shot = q.get('shot');
  if (shot) {
    const d = stage.director as unknown as { shots: { name: string }[]; current: unknown; update: () => boolean };
    const found = d.shots.find((s) => s.name === shot);
    if (found) {
      d.current = found;
      d.update = () => false;
    }
  }
  const bpm = Number(q.get('bpm') ?? 126);
  const od = Number(q.get('od') ?? -1);
  const level = q.get('level');
  const spb = 60 / bpm;
  const t0 = performance.now();
  let beat = -1;
  let odOn = false;
  const loop = () => {
    requestAnimationFrame(loop);
    const t = (performance.now() - t0) / 1000;
    const b = Math.floor(t / spb);
    let ev: 'none' | 'beat' | 'downbeat' = 'none';
    if (b !== beat) {
      beat = b;
      ev = b % 4 === 0 ? 'downbeat' : 'beat';
    }
    if (od >= 0 && t > od && !odOn) {
      odOn = true;
      stage.overdriveStart();
    }
    // A simulated song: builds for 8 bars, peaks, drops back.
    const bar = b / 4;
    const intensity = level !== null ? Number(level) : bar < 8 ? 0.2 + bar * 0.08 : bar < 24 ? 0.95 : 0.4;
    stage.render({ beat: ev, intensity, overdrive: odOn && t < od + 12, barSeconds: spb * 4 });
  };
  loop();
  addEventListener('resize', () => stage.resize());
  document.title = 'slice ready';
}
