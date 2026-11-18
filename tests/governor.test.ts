import { describe, expect, it } from 'vitest';
import { Governor, rungs } from '../src/render/stage/governor';

/** Runs `seconds` of a display at `hz`, the stage drawing every frame its pace allows and the chip taking `gpuMs(pace)` over each. */
function run(g: Governor, seconds: number, hz: number, gpuMs: (scale: number, fps: number) => number) {
  const step = 1000 / hz;
  let last = -Infinity;
  for (let t = 0; t < seconds * 1000; t += step) {
    g.tick(step);
    const { fps, scale } = g.pace;
    if (fps && t - last < 1000 / fps - 2) continue;
    last = t;
    g.frame(t);
    g.gpu(gpuMs(scale, fps || hz));
    g.update(Math.min(0.1, (fps ? 1000 / fps : step) / 1000));
  }
}

describe('the stage governor', () => {
  it('first goes down to 60 frames a second on a fast display, then gives up sharpness or smoothness as set', () => {
    expect(rungs({ fpsCap: 0, adaptiveResolution: true }).slice(0, 3)).toEqual([
      { scale: 1, fps: 0 },
      { scale: 1, fps: 60 },
      { scale: 0.9, fps: 60 },
    ]);
    const sharp = rungs({ fpsCap: 0, adaptiveResolution: false });
    expect(sharp.slice(0, 4)).toEqual([
      { scale: 1, fps: 0 },
      { scale: 1, fps: 60 },
      { scale: 1, fps: 30 },
      { scale: 1, fps: 20 },
    ]);
    // Sharpness goes last, but it does go: the rest of the screen comes first.
    expect(sharp.at(-1)).toEqual({ scale: 0.5, fps: 20 });
    expect(rungs({ fpsCap: 30, adaptiveResolution: true })[0]).toEqual({ scale: 1, fps: 30 });
    expect(rungs({ fpsCap: 30, adaptiveResolution: true }).at(-1)).toEqual({ scale: 0.5, fps: 20 });
  });

  it('never leaves the top rung on a machine with room to spare', () => {
    const g = new Governor({ fpsCap: 0, adaptiveResolution: false });
    // A 120 Hz display; the stage takes 2 ms of the chip a frame (a quarter of its time).
    run(g, 30, 120, (scale) => 2 * scale * scale);
    expect(g.pace).toEqual({ scale: 1, fps: 0 });
  });

  it('steps down until the stage takes no more than its share, and stays there', () => {
    const g = new Governor({ fpsCap: 0, adaptiveResolution: false });
    // Ultra on a laptop: 30 ms of the chip a frame at full size, on a 120 Hz display.
    run(g, 40, 120, (scale) => 30 * scale * scale);
    expect(g.share).toBeLessThanOrEqual(0.6);
    const settled = g.pace;
    expect(settled.fps).toBe(20);
    run(g, 60, 120, (scale) => 30 * scale * scale);
    expect(g.pace).toEqual(settled);
  });

  it('comes back up once the chip has room again', () => {
    const g = new Governor({ fpsCap: 0, adaptiveResolution: true });
    let heavy = true;
    const cost = (scale: number) => (heavy ? 25 : 2) * scale * scale;
    run(g, 20, 120, cost);
    expect(g.pace.scale).toBeLessThan(1);
    heavy = false;
    run(g, 60, 120, cost);
    expect(g.pace).toEqual({ scale: 1, fps: 0 });
  });
});
