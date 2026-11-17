import { applyPreset, DEFAULT_GRAPHICS, type GraphicsPreset } from '../game/graphics';
import { Stage3D } from '../render/stage/Stage3D';

/**
 * Dev-only: the 3D stage full screen with a simulated song, for checking looks and performance
 * without playing. Open /#stage?preset=high&bpm=126&od=20&mode=play (od = seconds until overdrive).
 */
export async function runStagePreview(root: HTMLElement) {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const preset = (q.get('preset') ?? 'high') as GraphicsPreset;
  const g = applyPreset({ ...DEFAULT_GRAPHICS, camera: (q.get('camera') as 'auto') ?? 'auto' }, preset);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;background:#000';
  root.replaceChildren(host);
  const stage = await Stage3D.create(host, g, { mode: (q.get('mode') as 'play') ?? 'play', part: 'lead' });
  (window as unknown as { __stage: Stage3D }).__stage = stage;
  const bpm = Number(q.get('bpm') ?? 126);
  const od = Number(q.get('od') ?? -1);
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
    const intensity = bar < 8 ? 0.2 + bar * 0.08 : bar < 24 ? 0.95 : 0.4;
    stage.render({ beat: ev, intensity, overdrive: odOn && t < od + 12, barSeconds: spb * 4 });
  };
  loop();
  addEventListener('resize', () => stage.resize());
  document.title = 'stage ready';
}
