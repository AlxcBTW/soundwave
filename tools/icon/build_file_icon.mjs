/**
 * Renders the icon for .soundwave song files: a page with its corner folded over, and on it the
 * game's note highway in small, five tiles in the lane colours on the strike line and the middle
 * one struck.
 *
 *     node tools/icon/build_file_icon.mjs
 *
 * Writes src-tauri/icons/soundwave-file.ico (every size Explorer asks for, 16 to 256 px) and
 * soundwave-file.png (256 px, for looking at). Plain Node, no packages: each size is drawn from
 * the shapes below with 8×8 samples a pixel and stored as a PNG inside the .ico.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

const hex = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// The game's colours (DESIGN.md).
const NIGHT = hex(0x0e0828);
const DEEP = hex(0x1a0f4c);
const VIOLET = hex(0x5b3ee0);
const LIT = hex(0xefeaff);
const RAIL = hex(0xbd78ff);
const LANES = [0x3ddc5a, 0xff3b4e, 0xffd23d, 0x3a8bff, 0xff8a1f].map(hex);

// The page, in a unit square (y down).
const PAGE = { x0: 0.15, x1: 0.85, y0: 0.04, y1: 0.96, r: 0.075 };
const FOLD = 0.22;
// The highway on it: wide at the strike line, narrowing as it runs up the page.
const ROAD = { yNear: 0.84, yFar: 0.3, wNear: 0.6, wFar: 0.2 };
const STRIKE = 0.76;
// Tiles further up the highway: lane, where along it (0 the strike line, 1 the far end).
const TILES = [
  [0, 0.28],
  [3, 0.46],
  [1, 0.64],
  [4, 0.8],
];

function inRoundRect(x, y, { x0, x1, y0, y1, r }) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Above the diagonal that cuts the page's top right corner off. */
const beyondFold = (x, y) => x - (PAGE.x1 - FOLD) > y - PAGE.y0;

function inPage(x, y) {
  return inRoundRect(x, y, PAGE) && !beyondFold(x, y);
}

/** The folded-over corner: the triangle under the cut, its inner corner slightly rounded off. */
function inFold(x, y) {
  const fx = PAGE.x1 - FOLD;
  const fy = PAGE.y0 + FOLD;
  return x >= fx && y <= fy && x - fx <= y - PAGE.y0 && x - fx + (fy - y) >= 0.012;
}

/** Half the highway's width at height y, and how far along it y is (0 near, 1 far). */
function road(y) {
  const t = (ROAD.yNear - y) / (ROAD.yNear - ROAD.yFar);
  return { half: (ROAD.wNear + (ROAD.wFar - ROAD.wNear) * t) / 2, t };
}

function inPill(x, y, cx, cy, w, h) {
  const r = h / 2;
  const dx = Math.max(Math.abs(x - cx) - (w / 2 - r), 0);
  return dx * dx + (y - cy) ** 2 <= r * r;
}

/** A tile's centre and size: lane i at distance t up the highway. */
function tile(i, t) {
  const y = STRIKE - (STRIKE - ROAD.yFar) * t * 0.92;
  const { half } = road(y);
  const lane = (half * 2) / 5;
  return { cx: 0.5 + (i - 2) * lane, cy: y, w: lane * 0.84, h: lane * 0.5 };
}

/** The colour at a point, painted back to front; null outside the icon. */
function shade(x, y) {
  if (inFold(x, y)) {
    // The back of the page: lighter, lit from the corner.
    const t = (y - PAGE.y0) / FOLD;
    return [...mix(LIT, hex(0xb9a8ff), t * 0.7), 1];
  }
  if (!inPage(x, y)) return null;
  // The page: violet at the top into deep night at the foot, with a thin lit edge.
  let c = mix(mix(VIOLET, DEEP, 0.15), NIGHT, Math.min(1, Math.max(0, (y - 0.1) / 0.85)));
  const edge =
    !inRoundRect(x, y, { x0: PAGE.x0 + 0.022, x1: PAGE.x1 - 0.022, y0: PAGE.y0 + 0.022, y1: PAGE.y1 - 0.022, r: PAGE.r - 0.022 }) ||
    beyondFold(x + 0.03, y - 0.03);
  if (edge) c = mix(c, RAIL, 0.55);
  // Shadow the fold casts on the page below the cut.
  const d = y - PAGE.y0 - (x - (PAGE.x1 - FOLD));
  if (d > 0 && d < 0.05 && x > PAGE.x1 - FOLD - 0.02) c = mix(c, NIGHT, 0.5 * (1 - d / 0.05));

  if (y <= ROAD.yNear && y >= ROAD.yFar) {
    const { half, t } = road(y);
    const off = Math.abs(x - 0.5);
    if (off <= half) {
      // The deck, darker than the page, and fading out up the highway.
      c = mix(c, mix(NIGHT, DEEP, 0.4), 0.85 * (1 - t * 0.6));
      const rail = half * 0.09 + 0.004;
      if (off >= half - rail) c = mix(c, RAIL, 1 - t * 0.55);
      else {
        // Lane lines.
        const lane = (half * 2) / 5;
        const u = (x - (0.5 - half)) / lane;
        if (Math.abs(u - Math.round(u)) * lane < 0.0045 + 0.002 * (1 - t)) c = mix(c, RAIL, 0.35 * (1 - t));
      }
    }
  }
  // The strike line, glowing round the struck tile.
  const near = road(STRIKE).half;
  if (Math.abs(y - STRIKE) < 0.012 && Math.abs(x - 0.5) <= near) c = mix(c, LIT, 0.55);
  const glow = Math.hypot((x - 0.5) / 1.6, y - STRIKE);
  if (glow < 0.2) c = mix(c, LANES[2], 0.5 * (1 - glow / 0.2) ** 2);

  for (const [i, t] of TILES) {
    const p = tile(i, t);
    if (inPill(x, y, p.cx, p.cy, p.w, p.h)) c = mix(LANES[i], NIGHT, t * 0.3);
  }
  for (let i = 0; i < 5; i++) {
    const p = tile(i, 0);
    const struck = i === 2;
    const s = struck ? 1.2 : 1;
    if (inPill(x, y, p.cx, p.cy, p.w * s, p.h * s)) {
      // A lit band across the top of each tile; the struck one is nearly white-hot.
      const top = y < p.cy - p.h * 0.1;
      c = struck ? mix(LANES[i], LIT, top ? 0.75 : 0.45) : mix(LANES[i], LIT, top ? 0.3 : 0);
    }
  }
  return [...c, 1];
}

function render(size) {
  const n = 8;
  const px = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const c = shade((pxl + (sx + 0.5) / n) / size, (py + (sy + 0.5) / n) / size);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const o = (py * size + pxl) * 4;
      if (a) {
        px[o] = Math.round(r / a);
        px[o + 1] = Math.round(g / a);
        px[o + 2] = Math.round(b / a);
        px[o + 3] = Math.round((a / (n * n)) * 255);
      }
    }
  }
  return px;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function png(size, rgba) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head[e] = size >= 256 ? 0 : size;
    head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.data)]);
}

const images = SIZES.map((size) => ({ size, data: png(size, render(size)) }));
const icons = join(root, 'src-tauri', 'icons');
writeFileSync(join(icons, 'soundwave-file.ico'), ico(images));
writeFileSync(join(icons, 'soundwave-file.png'), images.at(-1).data);
console.log('wrote src-tauri/icons/soundwave-file.ico and soundwave-file.png');
