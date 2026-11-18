import * as THREE from 'three';
import type { Chart } from '../chart/types';
import type { GameEvent, GameSession } from '../game/GameSession';
import { MAX_MULTIPLIER, multiplierFor } from '../game/scoring';

export const LANE_COLORS = [0x3ddc5a, 0xff3b4e, 0xffd23d, 0x3a8bff, 0xff8a1f];
const OVERDRIVE_COLOR = new THREE.Color(0xeaf6ff);
/** While overdrive lasts every tile on the lane is this light blue, and glows. */
const OVERDRIVE_TILE = new THREE.Color(0x7fd2ff);
const MISSED_TINT = 0.28;
const WHITE = new THREE.Color(0xffffff);
/** The rails and the deck's front lip: violet, gold on a full streak, overdrive's blue over both. */
const RAIL = new THREE.Color(0xbd78ff);
const STREAK_GOLD = new THREE.Color(0xffd66b);
/** The motes' own gold: deeper than the rails, so their white-hot cores stand out of it. */
const MOTE_GOLD = new THREE.Color(0xffb52e);
/** Motes of light let go by the rails each second while they are gold or in overdrive, and how many can float at once. */
const MOTE_RATE = 150;
const MAX_MOTES = 420;

const LANE_W = 1;
/** Where the strike line sits down the canvas when the layout does not say (see resize). */
const STRIKE_AT = 0.8;
/** Share of the canvas width the deck spans at the strike line, on a wide screen and on a tall one. */
const WIDE_SHARE = 0.37;
/** The camera's distances below give a share of 0.485 at the strike line: this moves it back to WIDE_SHARE. */
const BACK = 0.485 / WIDE_SHARE;
const TALL_SHARE = 0.9;
const LENGTH = 24;
/**
 * How far the deck runs on past the strike line, toward the player: far enough to leave the foot
 * of the screen, so the multiplier dial and the lane labels stand on it.
 */
const FRONT = 3.6;
/** How far past the strike line a missed tile gets before it has shrunk away. */
const PAST = 0.72;
const MAX_GEMS = 512;
/** The stretch at the far end of the deck over which a note grows to its full size. */
const APPEAR = 4;
/** How far a thing far units in from the deck's far edge has arrived, 0..1, eased at both ends. */
const arrived = (far: number) => {
  const p = Math.min(1, Math.max(0, far / APPEAR));
  return p * p * (3 - 2 * p);
};

const MAX_TAILS = 128;
const MAX_LINES = 96;
const MAX_PARTICLES = 600;

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A sustain trail is a beam of light: a tight glow in the lane's colour round a thin white-hot
 * core. Both are drawn as light (additively), each with its own profile across the beam's width:
 * the glow falls away quickly and reaches nothing well inside its strip, so no light smears over
 * the deck; the core is a narrow line with soft edges.
 */
function beamTexture(kind: 'glow' | 'core'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 4;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 64, 0);
  const stops: [number, number][] =
    kind === 'glow'
      ? [
          [0, 0],
          [0.14, 0],
          [0.28, 26],
          [0.39, 110],
          [0.46, 215],
          [0.5, 255],
        ]
      : [
          [0, 0],
          [0.2, 0],
          [0.38, 150],
          [0.5, 255],
        ];
  for (const [at, v] of stops) {
    grad.addColorStop(at, `rgb(${v},${v},${v})`);
    if (at < 0.5) grad.addColorStop(1 - at, `rgb(${v},${v},${v})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Blending for things that are pure light on the deck: their colour is added, and the canvas's own
 * opacity is left exactly as it was. (Plain additive blending also adds the quad's alpha, which
 * makes the slightly see-through deck fully opaque across the whole quad: a darker rectangle round
 * the light wherever the stage behind is bright.)
 */
const LIGHT = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;

const highwayVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const highwayFragment = /* glsl */ `
  uniform float uLanes;
  uniform float uScroll;
  uniform float uOverdrive;
  uniform float uPulse;
  uniform float uGold;
  uniform float uLight[5];
  uniform vec3 uLaneCol[5];
  uniform float uLen;
  uniform float uFront;
  uniform float uTime;
  uniform float uTravel;
  varying vec2 vUv;
  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    float x = vUv.x * uLanes;
    float lane = fract(x);
    // z: distance beyond the strike line in highway units (negative on the player's side of it).
    float z = vUv.y * uLen - uFront;
    float run = uLen - uFront;
    float depth = clamp(z / run, 0.0, 1.0);
    float ahead = step(0.0, z);
    // Hairlines between lanes (none along the outer edges, which have their rails), fainter in front of the strike line.
    float divider = smoothstep(0.024, 0.0, min(lane, 1.0 - lane)) * step(0.5, x) * step(x, uLanes - 0.5) * mix(0.45, 1.0, ahead);
    float edgeDist = min(vUv.x, 1.0 - vUv.x) * uLanes;
    float rail = smoothstep(0.075, 0.045, edgeDist);
    float railGlow = smoothstep(0.55, 0.0, edgeDist);
    float far = smoothstep(run, run * 0.6, z);
    // A solid violet deck, a shade lighter toward the far end, with a slow sheen running to the player.
    float sheen = 0.5 + 0.5 * sin((depth * 9.0 + uScroll) * 3.14159);
    vec3 base = mix(vec3(0.07, 0.038, 0.19), vec3(0.115, 0.062, 0.31), depth) + vec3(0.012, 0.008, 0.03) * sheen;
    // Neighbouring lanes differ by a breath, so each reads as its own strip.
    base *= 1.0 + 0.07 * (mod(floor(x), 2.0) - 0.5);
    // Like glass under stage light, the deck is lighter toward both rails and darkest down the middle.
    float side = 1.0 - min(vUv.x, 1.0 - vUv.x) * 2.0;
    base += vec3(0.085, 0.06, 0.2) * pow(side, 2.4);
    // Its surface is cut in large facets that travel with the notes; each catches the light a little
    // differently and brightens and fades on its own, a slow wave of light rolls across them toward
    // the player, and all of them answer the beat.
    vec2 g = vec2(x * 0.5 + 0.25, (z + uTravel) * 0.5);
    vec2 cell = floor(g);
    vec2 f = fract(g);
    vec2 id = vec2(cell.x, mod(cell.y, 8.0)) + step(f.x + f.y, 1.0) * 7.3;
    float facet = hash(id);
    float tone = hash(id + 17.7);
    float own = sin(uTime * (0.8 + 1.2 * tone) + tone * 6.2832);
    // The wave's phase steps a whole turn over the 8 rows the pattern repeats in, so it never jumps.
    float wave = sin(uTime * 1.6 + id.y * 0.7854 - cell.x * 1.1);
    base *= 1.0 + (facet - 0.5) * (0.16 + 0.2 * uPulse) + 0.13 * own + 0.09 * wave;
    // The glass is never quite still: soft patches of stage light drift slowly across it, sideways and
    // toward the player, on the clock rather than the song, so it lives on through a pause or a break.
    vec2 q = vec2(x * 0.8, z * 0.24);
    float drift = noise(q + vec2(uTime * 0.09, uTime * 0.16)) * 0.6 + noise(q * 2.3 + vec2(-uTime * 0.06, uTime * 0.27)) * 0.4;
    base += vec3(0.05, 0.034, 0.13) * smoothstep(0.42, 0.9, drift) * (0.45 + 0.55 * depth);
    // Every few seconds a faint, leaning glint runs down the deck, as if a light swept over it.
    float sweep = 1.25 - fract(uTime / 7.5) * 2.2;
    float glint = exp(-pow((depth + (vUv.x - 0.5) * 0.35 - sweep) * 9.0, 2.0));
    base += vec3(0.07, 0.06, 0.15) * glint * ahead;
    vec3 od = vec3(0.35, 0.65, 1.0);
    // The rails are violet, gold while the streak holds the top multiplier, and overdrive's blue over both.
    vec3 railCol = mix(mix(vec3(0.74, 0.47, 1.0), vec3(1.0, 0.9, 0.56), uGold), od, uOverdrive) * (1.0 + 0.55 * uPulse + 0.55 * uGold);
    vec3 col = base + divider * vec3(0.17, 0.14, 0.36) + railGlow * railGlow * railCol * (0.2 + 0.26 * uPulse + 0.45 * uGold);
    col = mix(col, railCol, rail);
    // In overdrive the edges light up light blue from inside too, in swells that run toward the player.
    float inner = smoothstep(0.16, 0.0, min(vUv.x, 1.0 - vUv.x));
    col += vec3(0.32, 0.7, 1.0) * inner * inner * uOverdrive * (0.45 + 0.4 * (0.5 + 0.5 * sin((vUv.y * 6.0 + uScroll) * 3.14159)));
    col += od * uOverdrive * 0.1 * (0.6 + 0.4 * sheen);
    // A lane that is played lights up along its length in its own colour, brightest at the player's end.
    float l = floor(x);
    vec3 beam = vec3(0.0);
    for (int i = 0; i < 5; i++) { if (float(i) == l) beam = uLaneCol[i] * uLight[i]; }
    float inLane = smoothstep(0.0, 0.06, lane) * smoothstep(1.0, 0.94, lane);
    col += beam * inLane * (0.1 + 0.42 * (1.0 - smoothstep(0.0, 17.0, max(z, 0.0))));
    // While it is lit, dashes of light run up its middle, away from the player.
    float dash = smoothstep(0.72, 0.8, fract(z * 0.7 - uTime * 4.0 + l * 0.31)) * smoothstep(0.17, 0.09, abs(lane - 0.5));
    col += beam * dash * 0.7 * (1.0 - smoothstep(0.0, 7.0, max(z, 0.0))) * ahead;
    gl_FragColor = vec4(col, 0.965 * far);
  }
`;
/**
 * Overdrive's light: a soft light-blue glow lying along the outside of both edges of the lane,
 * brightest at the edge, with slow swells running down it toward the player and a fine shimmer.
 */
const glowFragment = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform float uFlare;
  uniform float uSide;
  uniform float uBlue;
  varying vec2 vUv;
  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    // out: 0 at the lane's edge, 1 at the strip's outer rim; along: 0 at the strike line, 1 at the far end.
    float out_ = uSide > 0.0 ? vUv.x : 1.0 - vUv.x;
    float along = vUv.y;
    float swell = 0.5 + 0.5 * sin(along * 16.0 + uTime * 4.2);
    float shimmer = noise(vec2(along * 46.0 + uTime * 5.0, out_ * 3.0 - uTime * 1.3));
    float reach = 5.5 - 2.6 * swell - 1.5 * uFlare;
    float glow = exp(-out_ * reach) * (1.0 - out_) * (0.55 + 0.3 * swell + 0.3 * shimmer);
    float line = exp(-out_ * 40.0);
    // Gold for a full streak, light blue for overdrive.
    vec3 deep = mix(vec3(1.0, 0.62, 0.14), vec3(0.22, 0.6, 1.0), uBlue);
    vec3 pale = mix(vec3(1.0, 0.93, 0.66), vec3(0.55, 0.86, 1.0), uBlue);
    vec3 col = mix(deep, pale, line + 0.35 * swell * (1.0 - out_));
    float ends = smoothstep(1.0, 0.55, along) * smoothstep(0.0, 0.04, along);
    gl_FragColor = vec4(col * (1.0 + 0.8 * uFlare), (glow * 1.25 + 0.4 * line) * uLevel * ends);
  }
`;

/**
 * Neon pills: tiles and strike targets drawn from each point's distance to the pill's edge, so the
 * rim, the light inside it and the glow around it are all smooth at any size. The plane is larger
 * than the pill by the glow's reach; `uExtent` is its size, `uHalf` the pill's half size, `uRad` the
 * radius of its ends.
 */
const neonVertex = /* glsl */ `
uniform vec2 uExtent;
varying vec2 vP;
varying vec3 vCol;
void main() {
  vP = (uv - 0.5) * uExtent;
#ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
#else
  vCol = vec3(1.0);
#endif
  vec4 p = vec4(position, 1.0);
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * p;
}
`;
const neonPill = /* glsl */ `
uniform vec2 uHalf;
uniform float uRad;
float pill(vec2 p) {
  vec2 q = abs(p) - uHalf + uRad;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRad;
}
`;
/**
 * A tile: a bar of coloured glass lit from within, seen from above and in front. Its top face has
 * a bright rim in its colour with a white-hot line just inside it, a body deepening toward its
 * middle and a reflection running along its far side; below it, the bar's front face, darker; and
 * its light spills out around both. Premultiplied: the glow adds light, the bar covers.
 */
const tileFragment = /* glsl */ `
${neonPill}
uniform float uSide;
varying vec2 vP;
varying vec3 vCol;
void main() {
  vec3 c = vCol;
  float d = pill(vP);
  float ds = pill(vP + vec2(0.0, uSide));
  float du = min(d, ds);
  float aa = fwidth(d);
  float top = 1.0 - smoothstep(-aa, aa, d);
  float bar = 1.0 - smoothstep(-aa, aa, du);
  float side = bar * (1.0 - top);
  float depth = clamp(-d / uHalf.y, 0.0, 1.0);
  vec3 face = c * mix(1.05, 0.62, sqrt(depth));
  // The front face: lit along its top where the light comes over the edge, darker below.
  float down = clamp((-vP.y - uHalf.y + uSide) / uSide, 0.0, 1.0);
  vec3 front = c * mix(0.55, 0.28, down);
  float rimTop = exp(-pow(d / 0.02, 2.0));
  float rimOut = exp(-pow(du / 0.022, 2.0));
  float hot = exp(-pow((d + 0.032) / 0.015, 2.0)) * top;
  float along = 1.0 - smoothstep(uHalf.x - uRad * 1.2, uHalf.x - uRad * 0.55, abs(vP.x));
  float streak = exp(-pow((vP.y - uHalf.y * 0.4) / 0.016, 2.0)) * along * top;
  float halo = du > 0.0 ? exp(-du / 0.075) * (1.0 - smoothstep(0.1, 0.2, du)) : 0.0;
  vec3 white = mix(c, vec3(1.0), 0.8);
  vec3 col = face * top + front * side + c * (rimOut * 1.3 + rimTop * 0.9) + white * (hot * 0.9 + streak * 0.55) + c * halo * 0.85;
  float a = clamp(max(bar * 0.97, rimOut * 0.6 + halo * 0.22), 0.0, 1.0);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;
/**
 * A release marker's pointer: an upright crystal in its lane's colour, see-through, lighter toward
 * its tip, with bright edges and a faint inner facet line, glowing a little around it.
 */
const pointerFragment = /* glsl */ `
uniform vec2 uSize;
uniform float uPeak;
varying vec2 vP;
varying vec3 vCol;
float shape(vec2 p) {
  vec2 v[5];
  float hw = uSize.x * 0.5;
  float hh = uSize.y * 0.5;
  v[0] = vec2(-hw, -hh);
  v[1] = vec2(hw, -hh);
  v[2] = vec2(hw, hh - uPeak);
  v[3] = vec2(0.0, hh);
  v[4] = vec2(-hw, hh - uPeak);
  float d = dot(p - v[0], p - v[0]);
  float s = 1.0;
  for (int i = 0; i < 5; i++) {
    int j = i == 0 ? 4 : i - 1;
    vec2 e = v[j] - v[i];
    vec2 w = p - v[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 k = bvec3(p.y >= v[i].y, p.y < v[j].y, e.x * w.y > e.y * w.x);
    if (all(k) || all(not(k))) s *= -1.0;
  }
  return s * sqrt(d);
}
void main() {
  vec3 c = vCol;
  float d = shape(vP);
  float aa = fwidth(d);
  float inside = 1.0 - smoothstep(-aa, aa, d);
  float up = clamp(vP.y / uSize.y + 0.5, 0.0, 1.0);
  vec3 fill = c * mix(0.35, 0.75, up);
  float rim = exp(-pow(d / 0.016, 2.0));
  float facet = exp(-pow((d + 0.055) / 0.01, 2.0)) * inside;
  float halo = d > 0.0 ? exp(-d / 0.06) * (1.0 - smoothstep(0.06, 0.11, d)) : 0.0;
  vec3 white = mix(c, vec3(1.0), 0.75);
  vec3 col = fill * inside * 0.75 + white * (rim * 1.1 + facet * 0.35) + c * halo * 0.5;
  float a = clamp(inside * 0.5 + rim * 0.7 + halo * 0.12, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;
/**
 * A strike target: a neon outline in its lane's colour, glowing inside and out, its inside dark.
 * Struck (`uLight`, 0..1), it floods white-hot.
 */
const targetFragment = /* glsl */ `
${neonPill}
uniform vec3 uBase;
uniform vec3 uLane;
uniform float uLight;
varying vec2 vP;
void main() {
  float d = pill(vP);
  float aa = fwidth(d);
  float inside = 1.0 - smoothstep(-aa, aa, d);
  float rim = exp(-pow(d / 0.02, 2.0));
  float glowIn = inside * exp(d / 0.07);
  float halo = d > 0.0 ? exp(-d / 0.06) * (1.0 - smoothstep(0.08, 0.16, d)) : 0.0;
  vec3 lit = mix(uLane, vec3(1.0), 0.6);
  vec3 rimCol = mix(uBase * 1.3, vec3(1.0), uLight * 0.8);
  vec3 col = rimCol * rim * 1.25 + uBase * (glowIn * 0.5 + halo * 0.6 + inside * 0.05);
  col += lit * uLight * (inside * 0.85 + halo * 1.1);
  float a = clamp(inside * (0.6 + 0.35 * uLight) + rim * 0.65 + halo * 0.18, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;
/** How far beyond a pill its plane reaches: room for its glow, which fades out before the plane's edge. */
const GLOW_REACH = 0.24;
/** How far a tile leans back from lying flat, radians. */
const TILE_LEAN = 0.7;
/** Tile and target sizes (half width, half depth, end radius); a tile's front face shows this deep. */
const TILE = { half: [0.43, 0.14], rad: 0.14, side: 0.075 } as const;
/** A release marker's pointer: width, height and the height of its tip. */
const POINTER = { w: 0.5, h: 0.78, peak: 0.22 } as const;
const TARGETS = {
  pill: { half: [0.43, 0.14], rad: 0.14 },
  square: { half: [0.45, 0.42], rad: 0.16 },
} as const;

const moteVertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aStar;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStar;
  void main() {
    vColor = color;
    vAlpha = aAlpha;
    vStar = aStar;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(3.0, aSize * uScale / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

/**
 * A mote of fairy dust: a small solid core, white hot in the middle, in a tight halo of its own
 * colour. Some carry a four-pointed glint.
 */
const moteFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStar;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    float core = smoothstep(0.36, 0.16, d);
    float halo = exp(-d * d * 5.5) * 0.6;
    float rays = max(0.0, 1.0 - abs(p.x) * 30.0) * max(0.0, 1.0 - abs(p.y) * 2.3) + max(0.0, 1.0 - abs(p.y) * 30.0) * max(0.0, 1.0 - abs(p.x) * 2.3);
    float a = clamp(core + halo + rays * vStar, 0.0, 1.0) * vAlpha;
    gl_FragColor = vec4(mix(vColor, vec3(1.0, 0.98, 0.9), core * 0.75), a);
  }
`;
/**
 * The 3D note highway: track, strike pads, gems, sustain tails, beat lines and hit effects.
 * The canvas is transparent so a 2D background can sit behind it.
 */
export class Highway {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
  private readonly root = new THREE.Group();
  private readonly trackMat: THREE.ShaderMaterial;
  private readonly glowMats: THREE.ShaderMaterial[] = [];
  private readonly glow = new THREE.Group();
  private lip!: THREE.MeshBasicMaterial;
  /** The motes of light beside the rails (see floatMotes). */
  private motes!: THREE.Points;
  private readonly mPos = new Float32Array(MAX_MOTES * 3);
  private readonly mVel = new Float32Array(MAX_MOTES * 3);
  private readonly mCol = new Float32Array(MAX_MOTES * 3);
  private readonly mSize = new Float32Array(MAX_MOTES);
  private readonly mAlpha = new Float32Array(MAX_MOTES);
  private readonly mStar = new Float32Array(MAX_MOTES);
  private readonly mPeak = new Float32Array(MAX_MOTES);
  private readonly mSpan = new Float32Array(MAX_MOTES);
  private readonly mLife = new Float32Array(MAX_MOTES);
  private moteNext = 0;
  /** Motes owed since the last frame (a fraction carries over). */
  private moteDebt = 0;
  private flare = 0;
  /** The tiles: neon glass capsules (see tileFragment). */
  private readonly gems: THREE.InstancedMesh;
  /** Sustain trails: the beam's glow, and the white-hot line down its middle. */
  private readonly tails: THREE.InstancedMesh;
  private readonly tailCores: THREE.InstancedMesh;
  /** Release markers: a light tile at the end of the hold with an upright pointer standing on it. */
  private readonly capTiles: THREE.InstancedMesh;
  private readonly capPointers: THREE.InstancedMesh;
  private readonly lines: THREE.InstancedMesh;
  /** The strike targets: neon outlines in their lanes' colours (see targetFragment). */
  private readonly pads: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private padStyle: 'pill' | 'square' = 'pill';
  private readonly flashes: THREE.Mesh[] = [];
  private readonly flashLife: Float32Array;
  private readonly padLight: Float32Array;
  private readonly particles: THREE.Points;
  private readonly pPos: Float32Array;
  private readonly pVel: Float32Array;
  private readonly pCol: Float32Array;
  private readonly pLife: Float32Array;
  private pNext = 0;
  private readonly laneColors: THREE.Color[];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly tint = new THREE.Color();
  private readonly flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private firstNote = 0;
  private firstBeat = 0;
  private lastFrame = performance.now();
  private shake = 0;
  private pulse = 0;
  /** The music's push on the deck's light, eased (see render). */
  private beatGlow = 0;
  private readonly lanes: number;
  private readonly width: number;
  private unsub: (() => void) | null = null;
  /**
   * Resolves once every shader the highway uses is compiled. Until then nothing is drawn: compiled
   * on the first frame instead, they would hold the page up for a good part of a second as the song
   * starts. Compiled in parallel, they are done well inside the countdown.
   */
  readonly ready: Promise<void>;
  private compiled = false;

  /** Highway units per second. */
  speed = 9;

  /** How far ahead (seconds) notes are on screen at the current speed. */
  get horizon(): number {
    return LENGTH / this.speed;
  }

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly chart: Chart,
  ) {
    this.lanes = chart.lanes;
    this.width = this.lanes * LANE_W;
    this.laneColors = LANE_COLORS.slice(0, this.lanes).map((c) => new THREE.Color(c));
    this.flashLife = new Float32Array(this.lanes);
    this.padLight = new Float32Array(this.lanes);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setClearColor(0x000000, 0);

    this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xbfc8ff, 0x1a1030, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(0, 6, 4);
    this.scene.add(key);

    // Track
    this.trackMat = new THREE.ShaderMaterial({
      vertexShader: highwayVertex,
      fragmentShader: highwayFragment,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uLanes: { value: this.lanes },
        uScroll: { value: 0 },
        uOverdrive: { value: 0 },
        uPulse: { value: 0 },
        uGold: { value: 0 },
        uLight: { value: [0, 0, 0, 0, 0] },
        uLaneCol: { value: LANE_COLORS.map((c) => new THREE.Color(c)) },
        uLen: { value: LENGTH + FRONT },
        uFront: { value: FRONT },
        uTime: { value: 0 },
        uTravel: { value: 0 },
      },
    });
    const trackLen = LENGTH + FRONT;
    const track = new THREE.Mesh(new THREE.PlaneGeometry(this.width + 0.12, trackLen), this.trackMat);
    track.rotation.x = -Math.PI / 2;
    track.position.set(0, -0.02, -trackLen / 2 + FRONT);
    // The deck ends in a lit lip, the same light as its rails.
    const lip = new THREE.Mesh(new THREE.BoxGeometry(this.width + 0.12, 0.05, 0.07), new THREE.MeshBasicMaterial({ color: RAIL }));
    lip.position.set(0, -0.02, FRONT);
    this.root.add(lip);
    this.lip = lip.material as THREE.MeshBasicMaterial;
    track.renderOrder = -2;
    this.root.add(track);

    // Overdrive's light: a strip of glow lying flat along the outside of each edge.
    const glowWidth = 1.1;
    for (const side of [-1, 1]) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: highwayVertex,
        fragmentShader: glowFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uFlare: { value: 0 }, uSide: { value: side }, uBlue: { value: 1 } },
      });
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(glowWidth, trackLen), mat);
      strip.rotation.x = -Math.PI / 2;
      // it starts just inside the edge, so no dark line shows between the lane and its glow
      strip.position.set(side * (this.width / 2 + 0.03 + glowWidth / 2), -0.015, -trackLen / 2 + FRONT);
      strip.renderOrder = -1.5;
      this.glowMats.push(mat);
      this.glow.add(strip);
    }
    this.glow.visible = false;
    this.root.add(this.glow);

    // Beat / bar lines
    this.lines = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xd9c8ff, transparent: true, opacity: 0.2, depthWrite: false }),
      MAX_LINES,
    );
    this.lines.renderOrder = -1;
    this.lines.frustumCulled = false;
    this.root.add(this.lines);

    // Strike targets: a neon outline per lane in its colour, dark inside until the lane is played. On a
    // touchscreen the targets are the buttons, so there they are squares a finger fits on.
    for (let i = 0; i < this.lanes; i++) {
      const pad = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
          vertexShader: neonVertex,
          fragmentShader: targetFragment,
          transparent: true,
          premultipliedAlpha: true,
          depthWrite: false,
          uniforms: {
            uExtent: { value: new THREE.Vector2() },
            uHalf: { value: new THREE.Vector2() },
            uRad: { value: 0 },
            uBase: { value: this.laneColors[i] },
            uLane: { value: this.laneColors[i] },
            uLight: { value: 0 },
          },
        }),
      );
      pad.quaternion.copy(this.flat);
      pad.position.set(this.laneX(i), 0.004, 0);
      pad.renderOrder = -0.5;
      this.root.add(pad);
      this.pads.push(pad);
    }
    this.shapePads('pill');

    // Release markers keep a solid tile under their pointer.
    const gemGeo = new THREE.ExtrudeGeometry(roundedRect(0.84, 0.34, 0.12), {
      depth: 0.09,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.03,
      bevelSegments: 3,
      curveSegments: 10,
    });
    gemGeo.rotateX(-Math.PI / 2);
    gemGeo.translate(0, 0.02, 0);
    // Tiles: neon glass capsules lying just above the deck, over the start of their tails.
    const tileExtent = new THREE.Vector2(TILE.half[0] * 2 + GLOW_REACH * 2, TILE.half[1] * 2 + TILE.side * 2 + GLOW_REACH * 2);
    const tileGeo = new THREE.PlaneGeometry(tileExtent.x, tileExtent.y);
    // Leaning back toward the player, so a tile reads as a bar of light rather than a line on the deck.
    tileGeo.rotateX(-Math.PI / 2 + TILE_LEAN);
    tileGeo.translate(0, TILE.half[1] * Math.cos(-Math.PI / 2 + TILE_LEAN) + 0.02, 0);
    this.gems = new THREE.InstancedMesh(
      tileGeo,
      new THREE.ShaderMaterial({
        vertexShader: neonVertex,
        fragmentShader: tileFragment,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
        uniforms: {
          uExtent: { value: tileExtent },
          uHalf: { value: new THREE.Vector2(TILE.half[0], TILE.half[1]) },
          uRad: { value: TILE.rad },
          uSide: { value: TILE.side },
        },
      }),
      MAX_GEMS,
    );
    this.gems.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GEMS * 3), 3);
    this.gems.frustumCulled = false;
    this.gems.renderOrder = 1;
    this.root.add(this.gems);
    // Sustain tails
    const tailGeo = new THREE.PlaneGeometry(1, 1);
    tailGeo.rotateX(-Math.PI / 2);
    tailGeo.translate(0, 0, -0.5); // extends from z=0 to z=-1 before scaling
    this.tails = new THREE.InstancedMesh(tailGeo, new THREE.MeshBasicMaterial({ map: beamTexture('glow'), ...LIGHT }), MAX_TAILS);
    this.tailCores = new THREE.InstancedMesh(tailGeo, new THREE.MeshBasicMaterial({ map: beamTexture('core'), ...LIGHT }), MAX_TAILS);
    for (const mesh of [this.tails, this.tailCores]) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TAILS * 3), 3);
      mesh.frustumCulled = false;
      mesh.renderOrder = 0;
      this.root.add(mesh);
    }

    // Release markers at the end of hold-and-release tails: a tile of light glass (the tiles' own
    // shader) with an upright crystal pointer standing on it.
    this.capTiles = new THREE.InstancedMesh(tileGeo, this.gems.material, MAX_TAILS);
    const pointerGeo = new THREE.PlaneGeometry(POINTER.w + GLOW_REACH, POINTER.h + GLOW_REACH);
    pointerGeo.translate(0, 0.1 + POINTER.h / 2, -0.02);
    this.capPointers = new THREE.InstancedMesh(
      pointerGeo,
      new THREE.ShaderMaterial({
        vertexShader: neonVertex,
        fragmentShader: pointerFragment,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
        uniforms: {
          uExtent: { value: new THREE.Vector2(POINTER.w + GLOW_REACH, POINTER.h + GLOW_REACH) },
          uSize: { value: new THREE.Vector2(POINTER.w, POINTER.h) },
          uPeak: { value: POINTER.peak },
        },
      }),
      MAX_TAILS,
    );
    for (const mesh of [this.capTiles, this.capPointers]) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TAILS * 3), 3);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      this.root.add(mesh);
    }

    // Hit flashes
    const tex = radialTexture();
    const flashGeo = new THREE.PlaneGeometry(1.6, 1.6);
    for (let i = 0; i < this.lanes; i++) {
      const f = new THREE.Mesh(
        flashGeo,
        new THREE.MeshBasicMaterial({
          map: tex,
          color: this.laneColors[i],
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      f.position.set(this.laneX(i), 0.35, 0.05);
      this.root.add(f);
      this.flashes.push(f);
    }

    // Particles
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.particles = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({
        size: 0.16,
        map: tex,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.particles.frustumCulled = false;
    this.root.add(this.particles);

    // Motes: points drawn as soft discs, each with its own size (in highway units) and strength.
    const mGeo = new THREE.BufferGeometry();
    mGeo.setAttribute('position', new THREE.BufferAttribute(this.mPos, 3));
    mGeo.setAttribute('color', new THREE.BufferAttribute(this.mCol, 3));
    mGeo.setAttribute('aSize', new THREE.BufferAttribute(this.mSize, 1));
    mGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.mAlpha, 1));
    mGeo.setAttribute('aStar', new THREE.BufferAttribute(this.mStar, 1));
    this.motes = new THREE.Points(
      mGeo,
      new THREE.ShaderMaterial({
        vertexShader: moteVertex,
        fragmentShader: moteFragment,
        uniforms: { uScale: { value: 600 } },
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.motes.frustumCulled = false;
    this.motes.visible = false;
    this.motes.renderOrder = 3;
    this.root.add(this.motes);

    this.resize();
    this.ready = this.compile();
  }

  private compile(): Promise<void> {
    // Three only compiles what is visible: what starts hidden (the overdrive glow, the motes) is
    // shown just while the materials are gathered (that part is immediate).
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    const done = this.renderer.compileAsync(this.scene, this.camera);
    for (const o of hidden) o.visible = false;
    return done.then(
      () => void (this.compiled = true),
      () => void (this.compiled = true),
    );
  }

  attach(session: GameSession) {
    this.unsub?.();
    this.unsub = session.on((e) => this.onEvent(e));
  }

  private laneX(i: number) {
    return (i - (this.lanes - 1) / 2) * LANE_W;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // How much of the width the strike line takes: under half on a wide screen, nearly all of it
    // on a tall one, where the lanes also have to be wide enough for fingers.
    const a = this.camera.aspect;
    const css = getComputedStyle(this.canvas);
    // A layout played by touch asks for a minimum share (--deck-share), on wide screens too.
    const asked = Number.parseFloat(css.getPropertyValue('--deck-share')) || 0;
    const share = Math.max(asked, WIDE_SHARE + (TALL_SHARE - WIDE_SHARE) * Math.min(1, Math.max(0, (1.5 - a) / (1.5 - 0.65))));
    // The camera's distance: 5 lanes pull it back a little, a narrow screen brings it in. Without
    // a share asked for, a screen wider than 3:2 keeps the deck at its size and gains room at the sides.
    const back = this.lanes === 5 ? 1.12 : 1;
    const fit = (asked ? 1.5 / a : Math.max(1, 1.5 / a)) * (WIDE_SHARE / share);
    this.camera.position.set(0, 3.6 * back * fit * BACK, 6 * back * fit * BACK);
    this.camera.lookAt(0, 0, -7.5);
    // The picture is then slid up or down so the strike line sits where the layout wants it (a
    // share of the canvas height, from the canvas's own --strike), with the lane labels, the
    // multiplier dial or the touch pads below.
    this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    const strike = Number.parseFloat(css.getPropertyValue('--strike')) || STRIKE_AT;
    this.setPadStyle(css.getPropertyValue('--pads').trim() === 'square' ? 'square' : 'pill');
    // What --strike places: the strike line itself, or for touch the foot of the square targets.
    const anchor = this.padStyle === 'square' ? PAST + 0.16 : 0;
    const now = ((1 - new THREE.Vector3(0, 0, anchor).project(this.camera).y) / 2) * h;
    this.camera.setViewOffset(w, h, 0, Math.round(now - strike * h), w, h);
    this.camera.updateProjectionMatrix();
    // A mote's size is in highway units: this turns it into pixels at its distance.
    (this.motes.material as THREE.ShaderMaterial).uniforms.uScale.value =
      (h * this.renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }
  /** Strike targets as thin pills, or as finger-sized squares set a little toward the player. */
  private setPadStyle(style: 'pill' | 'square') {
    if (style === this.padStyle) return;
    this.padStyle = style;
    this.shapePads(style);
  }

  private shapePads(style: 'pill' | 'square') {
    const { half, rad } = TARGETS[style];
    const w = half[0] * 2 + GLOW_REACH * 2;
    const h = half[1] * 2 + GLOW_REACH * 2;
    for (const pad of this.pads) {
      pad.scale.set(w, h, 1);
      pad.position.z = style === 'square' ? 0.2 : 0;
      const u = pad.material.uniforms;
      (u.uExtent.value as THREE.Vector2).set(w, h);
      (u.uHalf.value as THREE.Vector2).set(half[0], half[1]);
      u.uRad.value = rad;
    }
  }

  /**
   * Screen positions (CSS px, relative to the canvas) of each lane's middle, `z` highway units on
   * the player's side of the strike line (0 = on the line).
   */
  padScreenPositions(z = 0): { x: number; y: number }[] {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.camera.updateMatrixWorld();
    return Array.from({ length: this.lanes }, (_, i) => {
      const p = new THREE.Vector3(this.laneX(i), 0, z).project(this.camera);
      return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
    });
  }

  /**
   * Where the lanes' labels stand: each lane's middle on the deck, `margin` CSS px above the foot
   * of the canvas (or at the deck's front edge, should that come first).
   */
  footRow(margin: number): { x: number; y: number }[] {
    const h = this.canvas.clientHeight || 1;
    const eye = this.camera.position;
    this.camera.updateMatrixWorld();
    this.v
      .set(0, 1 - ((h - margin) / h) * 2, 0.5)
      .unproject(this.camera)
      .sub(eye);
    const z = this.v.y < -1e-4 ? eye.z + this.v.z * (-eye.y / this.v.y) : 1.4;
    return this.padScreenPositions(Math.min(FRONT - 0.3, Math.max(0.9, z)));
  }

  /**
   * The lane under a point of the canvas (CSS px): the lane drawn there, following the deck's
   * perspective. Beside the deck it is the nearest outer lane; above the horizon, the lane whose
   * foot is nearest.
   */
  laneAt(x: number, y: number): number {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const eye = this.camera.position;
    this.v
      .set((x / w) * 2 - 1, 1 - (y / h) * 2, 0.5)
      .unproject(this.camera)
      .sub(eye);
    if (this.v.y < -1e-4) {
      const worldX = eye.x + this.v.x * (-eye.y / this.v.y);
      return Math.min(this.lanes - 1, Math.max(0, Math.round(worldX / LANE_W + (this.lanes - 1) / 2)));
    }
    let best = 0;
    this.padScreenPositions().forEach((p, i, all) => {
      if (Math.abs(p.x - x) < Math.abs(all[best].x - x)) best = i;
    });
    return best;
  }

  setLaneDown(lane: number, down: boolean) {
    if (down) this.padLight[lane] = 1;
  }

  private onEvent(e: GameEvent) {
    switch (e.type) {
      case 'hit':
        this.flashLife[e.lane] = 1;
        this.burst(e.lane, e.grade === 'perfect' ? 18 : 10);
        break;
      case 'miss':
        this.shake = Math.max(this.shake, 0.4);
        break;
      case 'release':
        this.flashLife[e.lane] = 1;
        this.burst(e.lane, e.grade === 'perfect' ? 22 : 12, WHITE);
        break;
      case 'release-miss':
        this.shake = Math.max(this.shake, 0.3);
        break;
      case 'phrase-complete':
        for (let i = 0; i < this.lanes; i++) this.burst(i, 6, OVERDRIVE_COLOR);
        break;
      case 'overdrive-start':
        this.pulse = 1.5;
        this.flare = 1;
        break;
    }
  }

  private burst(lane: number, count: number, color?: THREE.Color) {
    const col = color ?? this.laneColors[lane];
    const x = this.laneX(lane);
    for (let k = 0; k < count; k++) {
      const i = this.pNext;
      this.pNext = (this.pNext + 1) % MAX_PARTICLES;
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3;
      this.pPos[i * 3] = x + (Math.random() - 0.5) * 0.5;
      this.pPos[i * 3 + 1] = 0.15;
      this.pPos[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
      this.pVel[i * 3] = Math.cos(a) * sp * 0.5;
      this.pVel[i * 3 + 1] = 2 + Math.random() * 3.5;
      this.pVel[i * 3 + 2] = Math.sin(a) * sp * 0.3;
      this.pCol[i * 3] = col.r;
      this.pCol[i * 3 + 1] = col.g;
      this.pCol[i * 3 + 2] = col.b;
      this.pLife[i] = 0.5 + Math.random() * 0.35;
    }
  }

  /**
   * Motes of light rising from the rails, like dust in lantern light: small solid sparks with a
   * white-hot core and a tight halo, some with a glint, swaying a little and sparkling as they
   * fade. `color` is null when none are due; the ones already afloat still live out their time.
   */
  private floatMotes(dt: number, now: number, color: THREE.Color | null) {
    if (color) {
      this.moteDebt += dt * MOTE_RATE;
      while (this.moteDebt >= 1) {
        this.moteDebt -= 1;
        const i = this.moteNext;
        this.moteNext = (this.moteNext + 1) % MAX_MOTES;
        const k = i * 3;
        const side = Math.random() < 0.5 ? -1 : 1;
        // They keep close to the rail they rise from.
        this.mPos[k] = side * (this.width / 2 - 0.05 + Math.random() * 0.38);
        this.mPos[k + 1] = Math.random() * 0.25;
        // More of them toward the player, where the rails are widest on screen.
        this.mPos[k + 2] = PAST - Math.pow(Math.random(), 1.5) * LENGTH * 0.8;
        this.mVel[k] = side * Math.random() * 0.08;
        this.mVel[k + 1] = 0.1 + Math.random() * 0.34;
        this.mVel[k + 2] = (Math.random() - 0.5) * 0.3;
        // Each a slightly different gold (or blue), from deep to pale.
        const pale = Math.random() * 0.35;
        this.mCol[k] = color.r + (1 - color.r) * pale;
        this.mCol[k + 1] = color.g * (0.82 + Math.random() * 0.18) + (1 - color.g) * pale;
        this.mCol[k + 2] = color.b * (0.6 + Math.random() * 0.4) + (1 - color.b) * pale;
        // The point is three times its core across: the rest is halo and glint.
        this.mSize[i] = 0.09 + Math.random() * 0.1;
        this.mStar[i] = Math.random() < 0.3 ? 1 : 0;
        this.mPeak[i] = 1;
        this.mSpan[i] = 1.0 + Math.random() * 1.4;
        this.mLife[i] = this.mSpan[i];
      }
    } else this.moteDebt = 0;

    let alive = false;
    for (let i = 0; i < MAX_MOTES; i++) {
      if (this.mLife[i] <= 0) continue;
      alive = true;
      this.mLife[i] -= dt;
      const k = i * 3;
      // They sway a little as they rise.
      this.mPos[k] += (this.mVel[k] + Math.sin(now / 420 + i * 2.1) * 0.07) * dt;
      this.mPos[k + 1] += this.mVel[k + 1] * dt;
      this.mPos[k + 2] += this.mVel[k + 2] * dt;
      const age = 1 - Math.max(0, this.mLife[i]) / this.mSpan[i];
      // In over the first fifth, out over the rest, with a slow twinkle.
      const fade = Math.min(1, age / 0.12) * Math.min(1, (1 - age) / 0.35);
      // A quick sparkle on top of the fade.
      this.mAlpha[i] = this.mLife[i] > 0 ? this.mPeak[i] * fade * (0.7 + 0.3 * Math.sin(now / 85 + i * 1.7)) : 0;
    }
    this.motes.visible = alive;
    if (!alive) return;
    const g = this.motes.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aStar.needsUpdate = true;
  }
  /** Renders the frame for song time `t`. `beatPulse` (0..1) lets the music drive the track glow. */
  render(t: number, session: GameSession, beatPulse = 0) {
    if (!this.compiled) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const speed = this.speed;
    const horizon = LENGTH / speed;
    const notes = this.chart.notes;

    // Track uniforms
    const odTarget = session.overdriveActive ? 1 : 0;
    const u = this.trackMat.uniforms;
    u.uOverdrive.value += (odTarget - u.uOverdrive.value) * Math.min(1, dt * 6);
    u.uScroll.value = (t * speed * 0.5) % 2;
    u.uTime.value = (now / 1000) % 1000;
    // The facets move with the notes; 16 units is a whole number of their repeats.
    u.uTravel.value = (t * speed) % 16;
    this.pulse = Math.max(0, this.pulse - dt * 2);
    // The music's push (beats and bass) is eased before it reaches the deck: it rises over a few
    // hundredths of a second and settles over a few tenths, so the light swells and ebbs with the
    // song instead of flickering with every jump in the bass level.
    const ease = beatPulse > this.beatGlow ? 22 : 5;
    this.beatGlow += (beatPulse - this.beatGlow) * (1 - Math.exp(-dt * ease));
    u.uPulse.value = this.pulse + this.beatGlow * 0.6;
    this.flare = Math.max(0, this.flare - dt * 1.1);
    // A streak long enough for the top multiplier turns the rails a light, glowing gold and sets
    // motes of light floating up from them. Overdrive takes the rails over in its own blue, and
    // its motes are blue.
    const fullStreak = multiplierFor(session.streak) >= MAX_MULTIPLIER;
    u.uGold.value += ((fullStreak ? 1 : 0) - u.uGold.value) * Math.min(1, dt * 5);
    this.lip.color.copy(RAIL).lerp(STREAK_GOLD, u.uGold.value).lerp(OVERDRIVE_TILE, u.uOverdrive.value);
    const glowLevel = Math.max(u.uGold.value * 0.85, u.uOverdrive.value);
    this.floatMotes(dt, now, session.overdriveActive ? OVERDRIVE_TILE : fullStreak ? MOTE_GOLD : null);
    for (const mat of this.glowMats) {
      mat.uniforms.uTime.value = now / 1000;
      mat.uniforms.uLevel.value = glowLevel;
      mat.uniforms.uBlue.value = u.uOverdrive.value;
      mat.uniforms.uFlare.value = this.flare;
    }
    this.glow.visible = glowLevel > 0.01;

    // Camera shake on misses
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.root.position.x = (Math.random() - 0.5) * 0.06 * this.shake;

    // Beat lines
    const beats = this.chart.beats;
    while (this.firstBeat < beats.length && beats[this.firstBeat] < t - 0.2) this.firstBeat++;
    let li = 0;
    let di = 0;
    const downs = this.chart.downbeats;
    while (di < downs.length && downs[di] < this.firstBeat) di++;
    for (let b = this.firstBeat; b < beats.length && li < MAX_LINES; b++) {
      const dz = (beats[b] - t) * speed;
      if (dz > LENGTH) break;
      const isBar = di < downs.length && downs[di] === b;
      if (isBar) di++;
      this.q.copy(this.flat);
      this.v.set(0, 0, -dz);
      // A line draws itself in at the far end instead of snapping onto the deck.
      this.s.set(this.width, (isBar ? 0.05 : 0.02) * arrived(LENGTH - dz), 1);
      this.m.compose(this.v, this.q, this.s);
      this.lines.setMatrixAt(li++, this.m);
    }
    this.lines.count = li;
    this.lines.instanceMatrix.needsUpdate = true;

    // Notes
    while (this.firstNote < notes.length) {
      const n = notes[this.firstNote];
      if (n.t + n.dur >= t - 0.4) break;
      this.firstNote++;
    }
    let gi = 0;
    let ti = 0;
    let ci = 0;
    // How far overdrive has come on (it eases in and out with the lane's own glow).
    const drive = this.trackMat.uniforms.uOverdrive.value as number;
    // Pending release pointers breathe, so they read as an instruction rather than a note to hit.
    const breathe = 1 + 0.06 * Math.sin(now / 140);
    this.q.identity();
    for (let i = this.firstNote; i < notes.length; i++) {
      const n = notes[i];
      if (n.t - t > horizon) break;
      const x = this.laneX(n.lane);
      const hit = session.isHit(i);
      const missed = session.isMissed(i);
      const held = hit && session.holding[n.lane] === i;
      const od = n.phrase >= 0 && !session.isPhraseFailed(n.phrase);
      const own = od ? OVERDRIVE_COLOR : this.laneColors[n.lane];
      // In overdrive every tile turns light blue.
      const color = drive > 0.01 ? this.tint.copy(own).lerp(OVERDRIVE_TILE, drive) : own;

      if (n.dur > 0 && ti < MAX_TAILS) {
        const startZ = held ? 0 : -(n.t - t) * speed;
        const endZ = Math.max(-LENGTH, -(n.t + n.dur - t) * speed);
        const len = startZ - endZ;
        if (len > 0.01 && (!hit || held)) {
          this.v.set(x, 0.01, startZ);
          // The glow in the lane's colour, then the core, near white. A held beam burns brighter
          // and a touch wider, and breathes; a missed one is all but out.
          const burn = missed ? MISSED_TINT * 0.6 : held ? 1.15 + 0.15 * Math.sin(now / 90) : 0.8;
          this.s.set(held ? 0.24 : 0.18, 1, len);
          this.m.compose(this.v, this.q, this.s);
          this.tails.setMatrixAt(ti, this.m);
          this.c.copy(color).multiplyScalar(burn);
          this.tails.setColorAt(ti, this.c);
          this.v.y = 0.012;
          this.s.set(held ? 0.075 : 0.055, 1, len);
          this.m.compose(this.v, this.q, this.s);
          this.tailCores.setMatrixAt(ti, this.m);
          this.c
            .copy(color)
            .lerp(WHITE, 0.72)
            .multiplyScalar(burn * (missed ? 0.5 : 0.9));
          this.tailCores.setColorAt(ti, this.c);
          ti++;
        }
        if (held) this.padLight[n.lane] = Math.max(this.padLight[n.lane], 0.8);

        // The release marker sits at the tail's end until the release is judged.
        const capZ = -(n.t + n.dur - t) * speed;
        if (n.release && !session.isReleased(i) && capZ > -LENGTH && capZ < 1.5 && ci < MAX_TAILS) {
          const dim = session.isReleaseMissed(i) || missed ? MISSED_TINT : 1;
          // Like the notes, the marker grows in at the far end.
          const grown = arrived(capZ + LENGTH);
          this.v.set(x, 0, capZ);
          this.s.set(grown, grown, grown);
          this.m.compose(this.v, this.q, this.s);
          this.capTiles.setMatrixAt(ci, this.m);
          this.c.copy(color).lerp(WHITE, 0.35).multiplyScalar(dim);
          this.capTiles.setColorAt(ci, this.c);
          // The pointer stands on the tile and breathes.
          const k = (dim < 1 ? 1 : breathe) * grown;
          this.s.set(k, k, grown);
          this.m.compose(this.v, this.q, this.s);
          this.capPointers.setMatrixAt(ci, this.m);
          this.c.copy(color).lerp(WHITE, 0.15).multiplyScalar(dim);
          this.capPointers.setColorAt(ci, this.c);
          ci++;
        }
      }

      if (hit || gi >= MAX_GEMS) continue;
      const z = -(n.t - t) * speed;
      if (z > PAST) continue;
      // A tile that got past the strike line shrinks away before the deck ends.
      const gone = z > 0.2 ? Math.max(0, 1 - (z - 0.2) / (PAST - 0.25)) : 1;
      // At the far end it grows from nothing to its size, solid all the way, so it arrives instead
      // of popping up (and never lies half see-through over the stage behind).
      const here = arrived(z + LENGTH);
      const k = gone * here;
      this.v.set(x, 0, z);
      this.s.set(k, k, k);
      this.m.compose(this.v, this.q, this.s);
      this.gems.setMatrixAt(gi, this.m);
      // Their light swells and ebbs, a wave running down the lane toward the player.
      const swell = 0.5 + 0.5 * Math.sin(now / 150 + z * 0.8);
      this.c.copy(color);
      if (missed) this.c.multiplyScalar(MISSED_TINT);
      else if (drive > 0.01) this.c.multiplyScalar(1 + drive * (0.08 + 0.2 * swell));
      this.gems.setColorAt(gi, this.c);
      gi++;
    }
    this.gems.count = gi;
    this.tails.count = ti;
    this.tailCores.count = ti;
    for (const mesh of [this.capTiles, this.capPointers]) {
      mesh.count = ci;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.gems.instanceMatrix.needsUpdate = true;
    if (this.gems.instanceColor) this.gems.instanceColor.needsUpdate = true;
    for (const mesh of [this.tails, this.tailCores]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // Pads and flashes
    for (let i = 0; i < this.lanes; i++) {
      if (session.laneDown[i]) this.padLight[i] = Math.max(this.padLight[i], 0.55);
      this.padLight[i] = Math.max(0, this.padLight[i] - dt * 5);
      this.pads[i].material.uniforms.uLight.value = this.padLight[i];
      (u.uLight.value as number[])[i] = this.padLight[i];
      this.flashLife[i] = Math.max(0, this.flashLife[i] - dt * 4.5);
      const f = this.flashes[i];
      const fl = this.flashLife[i];
      (f.material as THREE.MeshBasicMaterial).opacity = fl;
      f.scale.setScalar(0.6 + (1 - fl) * 0.9);
      f.quaternion.copy(this.camera.quaternion);
    }

    // Particles
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const k = i * 3;
      this.pVel[k + 1] -= 9 * dt;
      this.pPos[k] += this.pVel[k] * dt;
      this.pPos[k + 1] += this.pVel[k + 1] * dt;
      this.pPos[k + 2] += this.pVel[k + 2] * dt;
      if (this.pLife[i] <= 0) this.pPos[k + 1] = -100;
      const fade = this.pLife[i] < 0.2 ? 0.85 : 1;
      this.pCol[k] *= fade;
      this.pCol[k + 1] *= fade;
      this.pCol[k + 2] *= fade;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.geometry.attributes.color.needsUpdate = true;

    this.renderer.render(this.scene, this.camera);
  }

  /** Call after seeking backwards (restart). */
  reset() {
    this.firstNote = 0;
    this.firstBeat = 0;
  }

  dispose() {
    this.unsub?.();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
  }
}
