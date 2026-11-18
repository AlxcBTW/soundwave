import * as THREE from 'three';
import type { Person } from './figures';

/** The stretch of ground the map covers, in metres: its corner (x, z) and its size. */
export const CROWD_RECT = { x: -136, z: -18, w: 272, d: 156 };

type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A 2D canvas: off-screen where there is one (always, in the stage's worker), else on the page. */
function canvas2d(width: number, height: number): [Canvas, Context] {
  const c: Canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
  c.width = width;
  c.height = height;
  return [c, c.getContext('2d') as Context];
}

/** A soft round stamp in red, fading from `alpha` at the middle to nothing. */
function stamp(radius: number, alpha: number): Canvas {
  const size = Math.max(2, Math.ceil(radius * 2));
  const [c, ctx] = canvas2d(size, size);
  const fade = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  fade.addColorStop(0, `rgba(255,0,0,${alpha})`);
  fade.addColorStop(0.45, `rgba(255,0,0,${alpha * 0.55})`);
  fade.addColorStop(1, 'rgba(255,0,0,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/** People per square metre at which the ground counts as fully packed, with the whole audience there. */
const PACKED = 1.05;

/**
 * How packed the ground is, in green, one pixel a metre: people counted per cell, then smoothed over
 * several metres so a gap of a few steps (around a camera, say) still counts as crowd. `share` is
 * the part of the audience drawn: the grass is as worn on settings that show fewer people.
 */
function density(people: Person[], share: number): Canvas {
  const w = Math.ceil(CROWD_RECT.w);
  const h = Math.ceil(CROWD_RECT.d);
  let cells = new Float32Array(w * h);
  for (const p of people) {
    const x = Math.floor(p.pos[0] - CROWD_RECT.x);
    const z = Math.floor(p.pos[2] - CROWD_RECT.z);
    if (x >= 0 && x < w && z >= 0 && z < h) cells[z * w + x] += 1;
  }
  // Three passes of a box blur come close to a Gaussian one.
  const reach = 3;
  for (let pass = 0; pass < 3; pass++) {
    for (const [step, count, lines] of [
      [1, w, h],
      [w, h, w],
    ] as const) {
      const out = new Float32Array(w * h);
      for (let line = 0; line < lines; line++) {
        const start = step === 1 ? line * w : line;
        for (let i = 0; i < count; i++) {
          let sum = 0;
          for (let k = -reach; k <= reach; k++) sum += cells[start + Math.min(count - 1, Math.max(0, i + k)) * step];
          out[start + i * step] = sum / (2 * reach + 1);
        }
      }
      cells = out;
    }
  }
  const [c, ctx] = canvas2d(w, h);
  const image = ctx.createImageData(w, h);
  for (let i = 0; i < cells.length; i++) {
    image.data[i * 4 + 1] = Math.min(255, (cells[i] / (PACKED * share)) * 255);
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return c;
}

/**
 * The audience seen from straight above, painted once: red is the shade under each person, green
 * how packed the ground around them is. The ground reads it to seat people on the grass instead of
 * leaving them hovering over it, and to wear the grass down to earth where the crowd is thickest.
 */
export function buildCrowdMap(people: Person[], share = 1, width = 2048): THREE.Texture {
  const perMetre = width / CROWD_RECT.w;
  const [canvas, ctx] = canvas2d(width, Math.round(CROWD_RECT.d * perMetre));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(density(people, Math.max(0.05, share)), 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'lighter';
  const shade = stamp(0.62 * perMetre, 0.95);
  for (const p of people) {
    const size = shade.width * p.scale;
    ctx.drawImage(shade, (p.pos[0] - CROWD_RECT.x) * perMetre - size / 2, (p.pos[2] - CROWD_RECT.z) * perMetre - size / 2, size, size);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.flipY = false;
  map.colorSpace = THREE.NoColorSpace;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  // The ground is mostly seen at a shallow angle.
  map.anisotropy = 8;
  return map;
}
