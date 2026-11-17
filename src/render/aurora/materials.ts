import * as THREE from 'three';
import { COMMON, OUTPUT, STATIC_VERTEX, shared } from './shared';

/** The deck's outline, for the lines of light drawn on it (three.js coordinates). */
export interface DeckInfo {
  center: [number, number, number];
  a: number;
  b: number;
  power: number;
  height: number;
  barrier: number;
}

/**
 * Painted forms: a three-stop gradient along the form that partly glows by itself, lit by the sky,
 * the moon screen and the wash, with a coloured rim, a sheen of sky and glitter that stays a few
 * pixels wide at any distance.
 */
const PAINT_FRAGMENT = /* glsl */ `
${COMMON}
uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform vec3 uRim;
uniform float uGlitter; uniform float uGlow; uniform float uPanels; uniform float uVeins;
varying vec3 vWPos; varying vec3 vWNorm; varying vec2 vUv; varying float vAo;

float glitterLayer(vec3 p, vec3 n, vec3 v) {
  vec3 id = floor(p);
  float r = hash31(id);
  if (r > 0.5) return 0.0;
  vec3 facet = normalize(hash33(id + 7.0) - 0.5);
  float flash = pow(max(0.0, dot(normalize(n + facet * 0.85), normalize(v + vec3(0.0, 0.3, 0.0)))), 22.0);
  float twinkle = 0.55 + 0.45 * sin(uTime * (1.5 + r * 30.0) + r * 90.0);
  return flash * twinkle * smoothstep(0.34, 0.04, length(fract(p) - 0.5));
}
float glitter(vec3 wpos, vec3 n, vec3 v, float dist) {
  float lod = log2(max(1.0, dist / 5.0));
  float l0 = floor(lod);
  float s = 52.0 * exp2(-l0);
  return mix(glitterLayer(wpos * s, n, v), glitterLayer(wpos * s * 0.5, n, v), lod - l0);
}

void main() {
  vec3 n = normalize(vWNorm);
  vec3 toCam = cameraPosition - vWPos;
  float dist = length(toCam);
  vec3 v = toCam / dist;
  if (dot(n, v) < 0.0) n = -n;
  float ndv = max(0.0, dot(n, v));
  float g = clamp(vUv.x + 0.035 * sin(vUv.y * 12.566 + vUv.x * 9.0 + uTime * 0.35), 0.0, 1.0);
  vec3 base = g < 0.55 ? mix(uA, uB, smoothstep(0.0, 0.55, g)) : mix(uB, uC, smoothstep(0.55, 1.0, g));
  float ao = mix(0.28, 1.0, vAo);
  // Panel seams across the form, and an inset face framed by piping along both rims, give the
  // big surfaces scale and a second tone.
  float su = vUv.x * 16.0;
  float seam = 1.0 - smoothstep(0.0, fwidth(su) * 1.5 + 0.012, abs(fract(su) - 0.5) * 2.0 - 0.0);
  float vv = abs(fract(vUv.y * 2.0) - 0.5);
  float aa = fwidth(vv) * 1.5 + 0.004;
  float face = 1.0 - smoothstep(0.34 - aa, 0.34 + aa, vv);
  float pipe = 1.0 - smoothstep(0.012, 0.012 + aa, abs(vv - 0.34));
  base *= mix(1.18, 0.8, face) * (1.0 - 0.3 * seam * face * (1.0 - uPanels));
  if (uPanels > 0.5) {
    // Triangulated cladding on the shell: every panel a touch lighter or darker, fine joints between.
    vec2 pp = vec2(atan(vWPos.y, abs(vWPos.x) + 1e-3) * 13.0, vWPos.z * 0.42);
    vec2 sk = vec2(pp.x + pp.y * 0.5, pp.y);
    vec2 cell = floor(sk);
    vec2 f = fract(sk);
    float upper = step(1.0, f.x + f.y);
    vec2 g = mix(f, 1.0 - f, upper);
    float edge = min(min(g.x, g.y), abs(f.x + f.y - 1.0) * 0.7071);
    float joint = smoothstep(0.0, (fwidth(sk.x) + fwidth(sk.y)) * 1.2 + 0.02, edge);
    base *= (0.82 + 0.34 * hash21(cell + upper * 37.0)) * mix(0.55, 1.0, joint * face + (1.0 - face));
  }
  if (uVeins > 0.5) {
    // Ribs running the length of a crest, like the veins of a leaf.
    float rib = abs(fract(vv * 9.0) - 0.5);
    base *= 1.0 + 0.22 * face * (1.0 - smoothstep(0.03, 0.03 + fwidth(vv * 9.0) * 1.5, rib));
  }

  vec3 toGlow = uGlowPos - vWPos;
  float gd = length(toGlow);
  float moonLit = (max(0.0, dot(n, toGlow / gd)) * 0.75 + 0.25) / (1.0 + gd * gd * 0.0022);
  vec3 moonCol = mix(uKey, vec3(1.0), 0.55) * uScreenLevel;
  float up = n.y * 0.5 + 0.5;
  vec3 light = mix(uWash * 0.42, vec3(0.085, 0.145, 0.4), up) + moonCol * min(0.5, moonLit) * 0.8;
  vec3 col = base * light * ao;
  col += base * uGlow * mix(0.55, 1.0, ao) * (0.5 + 0.22 * uBarPulse);

  float fres = pow(max(0.0, 1.0 - ndv), 3.0);
  col += uRim * fres * (0.22 + 0.26 * uEnergy) * ao;
  col += uRim * pipe * (0.2 + 0.3 * (0.5 + 0.5 * sin(vUv.x * 14.0 - uTime * 1.6)) + 0.22 * uPulse) * mix(0.5, 1.0, ao);
  col += skyGradient(reflect(-v, n)) * (0.04 + fres) * 1.6;
  #ifdef GLITTER
    col += mix(uC, vec3(1.0), 0.5) * glitter(vWPos, n, v, dist) * uGlitter * 3.0 * mix(0.4, 1.0, ao);
  #endif

  gl_FragColor = vec4(applyHaze(col, vWPos), 1.0);
  ${OUTPUT}
}`;

const DECK_FRAGMENT = /* glsl */ `
${COMMON}
uniform vec3 uDeckC; uniform vec3 uDeckShape;
varying vec3 vWPos; varying vec3 vWNorm; varying vec2 vUv; varying float vAo;
void main() {
  vec3 n = normalize(vWNorm);
  vec3 v = normalize(cameraPosition - vWPos);
  float ndv = max(0.0, dot(n, v));
  vec3 col = vec3(0.006, 0.008, 0.022);
  float fres = 0.05 + 0.95 * pow(max(0.0, 1.0 - ndv), 4.0);
  if (n.y > 0.7) {
    // Rings of light spreading from the band's island, running outward with the music.
    float rr = length((vWPos.xz - uIsland.xy) / uIsland.zw) * 2.0;
    float ring = abs(fract(rr - uBeat * 0.25) - 0.5);
    float w = fwidth(rr) + 0.012;
    col += mix(uAccent, uKey, 0.5 + 0.5 * sin(rr * 4.0)) * smoothstep(w, 0.0, ring - 0.006) * (0.26 + 0.36 * uPulse);
    // A pool of light under each player, strongest under the part being played.
    for (int i = 0; i < 4; i++) {
      vec2 q = vWPos.xz - uBand[i].xz;
      float near = step(abs(vWPos.y - uBand[i].y), 0.4);
      col += mix(vec3(1.0, 0.92, 0.84), uKey, 0.3) * exp(-dot(q, q) / 2.6) * near * (0.05 + 0.2 * uFeature[i]);
    }
    // A polished floor: it mirrors the moon and the sky.
    vec3 r = reflect(-v, n);
    if (r.z < -1e-3) {
      float t = (uMoon.z - vWPos.z) / r.z;
      vec3 hit = vWPos + r * t;
      vec2 q = (hit.xy - uMoon.xy) / (2.0 * uMoon.w) + 0.5;
      col += moonContent(q) * onScreen(hit.xy) * fres * 0.8;
    }
    col += skyGradient(r) * fres;
    col += uWash * 0.05;
  } else {
    // Risers: lit softly from the crowd side.
    col += uWash * 0.07 * max(0.0, n.z) + skyGradient(reflect(-v, n)) * fres * 0.6;
  }
  gl_FragColor = vec4(applyHaze(col, vWPos), 1.0);
  ${OUTPUT}
}`;

/** The land: trodden grass under moonlight, warmed by the stage where it is near. */
const GROUND_FRAGMENT = /* glsl */ `
${COMMON}
varying vec3 vWPos; varying vec3 vWNorm; varying vec2 vUv; varying float vAo;
void main() {
  vec3 n = normalize(vWNorm);
  float gd = distance(vWPos, vec3(uGlowPos.x, 0.0, uGlowPos.z + 20.0));
  vec3 grass = mix(vec3(0.012, 0.022, 0.026), vec3(0.022, 0.04, 0.03), vnoise(vWPos.xz * 0.07)) * (0.7 + 0.6 * vnoise(vWPos.xz * 0.8));
  vec3 light = vec3(0.3, 0.42, 0.85) * 0.55 + uMoonCol * max(0.0, dot(n, uMoonDir)) * 1.6;
  vec3 col = grass * light + mix(uWash, uKey, 0.3) * 0.05 / (1.0 + gd * gd * 0.0016);
  gl_FragColor = vec4(applyHaze(col, vWPos), 1.0);
  ${OUTPUT}
}`;

/**
 * The lake: dark water with a moving surface. It mirrors the sky, lays the moon down as a path of
 * glitter, streaks the far shore's lights toward the viewer and flashes with every firework.
 */
const WATER_FRAGMENT = /* glsl */ `
${COMMON}
varying vec3 vWPos; varying vec3 vWNorm; varying vec2 vUv; varying float vAo;
void main() {
  vec3 toCam = cameraPosition - vWPos;
  float dist = length(toCam);
  vec3 v = toCam / dist;
  vec2 p = vWPos.xz;
  float t = uTime;
  vec2 big = vec2(vnoise(p * 0.11 + vec2(t * 0.05, t * 0.02)), vnoise(p * 0.11 + vec2(-t * 0.03, t * 0.045) + 31.7)) - 0.5;
  vec2 small = vec2(vnoise(p * 0.7 + t * 0.22), vnoise(p * 0.7 - t * 0.19 + 11.1)) - 0.5;
  // Ripples flatten into one sheen far away, where they would only shimmer.
  vec2 g = big * 0.3 + small * 0.2 / (1.0 + dist * 0.01);
  vec3 n = normalize(vec3(g.x, 1.0, g.y));
  vec3 r = reflect(-v, n);
  r.y = abs(r.y);
  float fres = 0.03 + 0.97 * pow(clamp(1.0 - dot(n, v), 0.0, 1.0), 5.0);
  vec3 col = vec3(0.002, 0.005, 0.016) + skyGradient(r) * fres * 1.4;
  float toMoon = max(0.0, dot(r, uMoonDir));
  col += uMoonCol * (pow(toMoon, 420.0) * 2.6 + pow(toMoon, 60.0) * 0.3);
  for (int i = 0; i < 8; i++) {
    vec3 l = uShore[i] - vWPos;
    float d = length(l);
    col += uShoreCol[i] * pow(max(0.0, dot(r, l / d)), 900.0) * 3.2;
  }
  vec3 b = uBurst.xyz - vWPos;
  col += mix(uKey, vec3(1.0), 0.5) * pow(max(0.0, dot(r, normalize(b))), 60.0) * uBurst.w * 1.2;
  gl_FragColor = vec4(applyHaze(col, vWPos), 1.0);
  ${OUTPUT}
}`;

/** Steady lamps: stalls, strings, the campsite, the far shore. They glow through the haze. */
const LAMP_FRAGMENT = /* glsl */ `
${COMMON}
uniform vec3 uTint; uniform float uTwinkle;
varying vec3 vWPos; varying vec3 vWNorm; varying vec2 vUv; varying float vAo;
void main() {
  float h = hash31(floor(vWPos * 0.9));
  float twinkle = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * (1.2 + h * 3.0) + h * 60.0));
  vec3 col = uTint * 1.5 * twinkle;
  gl_FragColor = vec4(mix(col, applyHaze(col, vWPos), 0.55), 1.0);
  ${OUTPUT}
}`;

/** Cloth lit from inside: stalls, the arch, flags, the wheel's cabins. */
const CANVAS_FRAGMENT = /* glsl */ `
${COMMON}
uniform vec3 uTint;
varying vec3 vWPos; varying vec3 vWNorm; varying vec2 vUv; varying float vAo;
void main() {
  vec3 n = normalize(vWNorm);
  vec3 v = normalize(cameraPosition - vWPos);
  if (dot(n, v) < 0.0) n = -n;
  vec3 col = uTint * (0.34 + 0.16 * n.y) + uTint * uMoonCol * max(0.0, dot(n, uMoonDir)) * 0.3;
  gl_FragColor = vec4(applyHaze(col, vWPos), 1.0);
  ${OUTPUT}
}`;

/** Trees: dark shapes against the sky, edged by the moon. */
const FOLIAGE_FRAGMENT = /* glsl */ `
${COMMON}
varying vec3 vWPos; varying vec3 vWNorm; varying vec2 vUv; varying float vAo;
void main() {
  vec3 n = normalize(vWNorm);
  vec3 base = vec3(0.01, 0.026, 0.022) * (0.7 + 0.6 * hash31(floor(vWPos * 0.25)));
  vec3 col = base * (vec3(0.3, 0.42, 0.85) * (0.5 + 0.3 * n.y) + uMoonCol * max(0.0, dot(n, uMoonDir)) * 2.2);
  gl_FragColor = vec4(applyHaze(col, vWPos), 1.0);
  ${OUTPUT}
}`;

/**
 * Stage equipment (trusses, cabinets, fixtures) and its grilles: satin black that still takes the
 * stage's light and a highlight, so the shapes read instead of sinking into silhouettes. Grilles
 * are perforated metal, with holes that melt into an even tone with distance.
 */
const GEAR_FRAGMENT = /* glsl */ `
${COMMON}
varying vec3 vWPos; varying vec3 vWNorm; varying vec2 vUv; varying float vAo;
void main() {
  vec3 n = normalize(vWNorm);
  vec3 v = normalize(cameraPosition - vWPos);
  if (dot(n, v) < 0.0) n = -n;
  vec3 base = vec3(0.058, 0.06, 0.07);
  float gloss = 0.45;
  #ifdef GRILLE
    vec3 an = abs(n);
    vec2 p = an.y > 0.75 ? vWPos.xz : (an.x > an.z ? vWPos.zy : vWPos.xy);
    vec2 g = p * 52.0;
    g.x += 0.5 * floor(g.y);
    float hole = smoothstep(0.36, 0.26, length(fract(g) - 0.5));
    float far = clamp(max(fwidth(g.x), fwidth(g.y)) * 1.3, 0.0, 1.0);
    base = vec3(0.14, 0.145, 0.165) * mix(1.0 - 0.8 * hole, 0.6, far);
    gloss = 0.6;
  #endif
  vec3 toGlow = uGlowPos - vWPos;
  float gd = length(toGlow);
  toGlow /= gd;
  float stage = 1.0 / (1.0 + gd * gd * 0.0008);
  vec3 stageCol = mix(uKey, vec3(1.0), 0.4) * uScreenLevel;
  vec3 light = vec3(0.05, 0.07, 0.16) * (0.55 + 0.45 * n.y) + stageCol * (max(0.0, dot(n, toGlow)) * 0.7 + 0.3) * stage * 1.5 + uWash * 0.3 * stage;
  vec3 col = base * light;
  float fres = pow(clamp(1.0 - dot(n, v), 0.0, 1.0), 3.0);
  col += stageCol * pow(max(0.0, dot(n, normalize(toGlow + v))), 36.0) * gloss * stage * 0.5;
  col += (uWash * 0.2 + skyGradient(reflect(-v, n))) * fres * gloss;
  gl_FragColor = vec4(applyHaze(col, vWPos), 1.0);
  ${OUTPUT}
}`;

const LED_FRAGMENT = /* glsl */ `
${COMMON}
varying vec3 vWPos; varying vec3 vWNorm; varying vec2 vUv; varying float vAo;
void main() {
  float run = 0.5 + 0.5 * sin(vUv.x * 60.0 - uTime * 2.5 - vWPos.y * 0.3);
  vec3 col = mix(uKey, uAccent, run) * (0.8 + 0.7 * uPulse + 0.35 * uEnergy);
  gl_FragColor = vec4(applyHaze(col, vWPos), 1.0);
  ${OUTPUT}
}`;

const LENS_FRAGMENT = /* glsl */ `
${COMMON}
varying vec3 vWPos; varying vec3 vWNorm; varying vec2 vUv; varying float vAo;
void main() {
  gl_FragColor = vec4(mix(uKey, vec3(1.0), 0.5) * (1.1 + 0.9 * uEnergy), 1.0);
  ${OUTPUT}
}`;

const SCREEN_FRAGMENT = /* glsl */ `
${COMMON}
uniform float uCells;
varying vec3 vWPos; varying vec3 vWNorm; varying vec2 vUv; varying float vAo;
void main() {
  #ifdef MOON
    vec3 col = moonContent(vUv) * 0.8;
    vec2 cells = vUv * uCells;
  #else
    vec3 col = wingContent(vUv) * 1.0;
    vec2 cells = vUv * vec2(uCells * 5.0, uCells);
  #endif
  // The LED grid shows up close and melts away with distance.
  vec2 gcell = abs(fract(cells) - 0.5);
  float grid = smoothstep(0.5, 0.38, max(gcell.x, gcell.y));
  float soft = clamp(max(fwidth(cells.x), fwidth(cells.y)) * 1.6, 0.0, 1.0);
  col *= mix(0.55 + 0.6 * grid, 1.0, soft);
  gl_FragColor = vec4(applyHaze(col, vWPos), 1.0);
  ${OUTPUT}
}`;

const FRAGMENTS: Record<string, string> = {
  paint: PAINT_FRAGMENT,
  deck: DECK_FRAGMENT,
  ground: GROUND_FRAGMENT,
  black: GEAR_FRAGMENT,
  grille: GEAR_FRAGMENT,
  led: LED_FRAGMENT,
  lens: LENS_FRAGMENT,
  water: WATER_FRAGMENT,
  lamp: LAMP_FRAGMENT,
  canvas: CANVAS_FRAGMENT,
  foliage: FOLIAGE_FRAGMENT,
  screen: SCREEN_FRAGMENT,
};

/**
 * Swaps the exported placeholder materials for the venue's shaders, by the role and colours the
 * Blender build stored on each material (`glitter` off spares the sparkle on light settings).
 * Returns everything that needs disposing.
 */
export function applyVenueMaterials(root: THREE.Object3D, deck: DeckInfo, glitter = true): THREE.Material[] {
  const made: THREE.Material[] = [];
  const byName = new Map<string, THREE.ShaderMaterial>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as THREE.Material;
    const info = src.userData as { kind?: string; a?: string; b?: string; c?: string; rim?: string; glitter?: number; glow?: number; panels?: number; veins?: number; tint?: string; twinkle?: number };
    const kind = info.kind && FRAGMENTS[info.kind] ? info.kind : 'black';
    const moon = kind === 'screen' && /Moon/.test(mesh.name);
    const key = kind === 'screen' ? `screen-${moon}` : src.name;
    let mat = byName.get(key);
    if (!mat) {
      const uniforms: Record<string, THREE.IUniform> = { ...shared };
      if (kind === 'paint') {
        uniforms.uA = { value: new THREE.Color(info.a ?? '#101060') };
        uniforms.uB = { value: new THREE.Color(info.b ?? '#3050e0') };
        uniforms.uC = { value: new THREE.Color(info.c ?? '#80d0ff') };
        uniforms.uRim = { value: new THREE.Color(info.rim ?? '#ffffff') };
        uniforms.uGlitter = { value: info.glitter ?? 0.5 };
        uniforms.uGlow = { value: info.glow ?? 0.3 };
        uniforms.uPanels = { value: info.panels ?? 0 };
        uniforms.uVeins = { value: info.veins ?? 0 };
      } else if (kind === 'deck') {
        uniforms.uDeckC = { value: new THREE.Vector3(...deck.center) };
        uniforms.uDeckShape = { value: new THREE.Vector3(deck.a, deck.b, deck.power) };
      } else if (kind === 'screen') {
        uniforms.uCells = { value: moon ? 150 : 60 };
      } else if (kind === 'lamp' || kind === 'canvas') {
        uniforms.uTint = { value: new THREE.Color(info.tint ?? '#ffffff') };
        uniforms.uTwinkle = { value: info.twinkle ?? 0 };
      }
      mat = new THREE.ShaderMaterial({
        name: key,
        uniforms,
        vertexShader: STATIC_VERTEX,
        fragmentShader: FRAGMENTS[kind],
        vertexColors: !!mesh.geometry.getAttribute('color'),
        defines: moon ? { MOON: '' } : kind === 'paint' && glitter ? { GLITTER: '' } : kind === 'grille' ? { GRILLE: '' } : {},
        side: kind === 'screen' || kind === 'lens' || kind === 'canvas' ? THREE.DoubleSide : THREE.FrontSide,
      });
      byName.set(key, mat);
      made.push(mat);
    }
    mesh.material = mat;
    mesh.frustumCulled = false;
  });
  return made;
}
