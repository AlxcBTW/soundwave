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
uniform float uGlitter; uniform float uGlow;
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
  base *= mix(1.18, 0.8, face) * (1.0 - 0.3 * seam * face);

  vec3 toGlow = uGlowPos - vWPos;
  float gd = length(toGlow);
  float moonLit = (max(0.0, dot(n, toGlow / gd)) * 0.75 + 0.25) / (1.0 + gd * gd * 0.0022);
  vec3 moonCol = mix(uKey, vec3(1.0), 0.55) * uScreenLevel;
  float up = n.y * 0.5 + 0.5;
  vec3 light = mix(uWash * 0.5, vec3(0.1, 0.17, 0.46), up) + moonCol * min(0.5, moonLit) * 1.0;
  vec3 col = base * light * ao;
  col += base * uGlow * mix(0.55, 1.0, ao) * (0.7 + 0.3 * uBarPulse);

  float fres = pow(1.0 - ndv, 3.0);
  col += uRim * fres * (0.3 + 0.35 * uEnergy) * ao;
  col += uRim * pipe * (0.35 + 0.5 * (0.5 + 0.5 * sin(vUv.x * 14.0 - uTime * 1.6)) + 0.4 * uPulse) * mix(0.5, 1.0, ao);
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
  float fres = 0.05 + 0.95 * pow(1.0 - ndv, 4.0);
  if (n.y > 0.7) {
    // Lines of light following the deck's outline, running outward with the music.
    vec2 d = (vWPos.xz - uDeckC.xz) / uDeckShape.xy;
    float rr = pow(pow(abs(d.x), uDeckShape.z) + pow(abs(d.y), uDeckShape.z), 1.0 / uDeckShape.z);
    float ring = abs(fract(rr * 5.0 - uBeat * 0.25) - 0.5);
    float w = fwidth(rr * 5.0) + 0.012;
    col += mix(uAccent, uKey, 0.5 + 0.5 * sin(rr * 9.0)) * smoothstep(w, 0.0, ring - 0.006) * (0.5 + 0.7 * uPulse);
    // A polished floor: it mirrors the moon and the sky.
    vec3 r = reflect(-v, n);
    if (r.z < -1e-3) {
      float t = (uMoon.z - vWPos.z) / r.z;
      vec3 hit = vWPos + r * t;
      vec2 q = (hit.xy - uMoon.xy) / (2.0 * uMoon.w) + 0.5;
      col += moonContent(q) * step(length(q - 0.5), 0.5) * fres * 0.8;
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

const GROUND_FRAGMENT = /* glsl */ `
${COMMON}
varying vec3 vWPos; varying vec3 vWNorm; varying vec2 vUv; varying float vAo;
void main() {
  float gd = distance(vWPos, vec3(uGlowPos.x, 0.0, uGlowPos.z + 20.0));
  vec3 col = vec3(0.003, 0.005, 0.016) + mix(uWash, uKey, 0.3) * 0.05 / (1.0 + gd * gd * 0.0016);
  col *= 0.8 + 0.4 * vnoise(vWPos.xz * 0.35);
  gl_FragColor = vec4(applyHaze(col, vWPos), 1.0);
  ${OUTPUT}
}`;

const BLACK_FRAGMENT = /* glsl */ `
${COMMON}
varying vec3 vWPos; varying vec3 vWNorm; varying vec2 vUv; varying float vAo;
void main() {
  vec3 n = normalize(vWNorm);
  vec3 v = normalize(cameraPosition - vWPos);
  float fres = pow(1.0 - abs(dot(n, v)), 3.0);
  vec3 col = vec3(0.003, 0.003, 0.007) + (uWash * 0.25 + skyGradient(reflect(-v, n))) * fres * 0.6;
  gl_FragColor = vec4(applyHaze(col, vWPos), 1.0);
  ${OUTPUT}
}`;

const LED_FRAGMENT = /* glsl */ `
${COMMON}
varying vec3 vWPos; varying vec3 vWNorm; varying vec2 vUv; varying float vAo;
void main() {
  float run = 0.5 + 0.5 * sin(vUv.x * 60.0 - uTime * 2.5 - vWPos.y * 0.3);
  vec3 col = mix(uKey, uAccent, run) * (1.5 + 1.6 * uPulse + 0.8 * uEnergy);
  gl_FragColor = vec4(applyHaze(col, vWPos), 1.0);
  ${OUTPUT}
}`;

const LENS_FRAGMENT = /* glsl */ `
${COMMON}
varying vec3 vWPos; varying vec3 vWNorm; varying vec2 vUv; varying float vAo;
void main() {
  gl_FragColor = vec4(mix(uKey, vec3(1.0), 0.5) * (2.0 + 2.0 * uEnergy), 1.0);
  ${OUTPUT}
}`;

const SCREEN_FRAGMENT = /* glsl */ `
${COMMON}
uniform float uCells;
varying vec3 vWPos; varying vec3 vWNorm; varying vec2 vUv; varying float vAo;
void main() {
  #ifdef MOON
    vec3 col = moonContent(vUv) * 1.15;
    vec2 cells = vUv * uCells;
  #else
    vec3 col = wingContent(vUv) * 1.5;
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
  black: BLACK_FRAGMENT,
  led: LED_FRAGMENT,
  lens: LENS_FRAGMENT,
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
    const info = src.userData as { kind?: string; a?: string; b?: string; c?: string; rim?: string; glitter?: number; glow?: number };
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
      } else if (kind === 'deck') {
        uniforms.uDeckC = { value: new THREE.Vector3(...deck.center) };
        uniforms.uDeckShape = { value: new THREE.Vector3(deck.a, deck.b, deck.power) };
      } else if (kind === 'screen') {
        uniforms.uCells = { value: moon ? 150 : 60 };
      }
      mat = new THREE.ShaderMaterial({
        name: key,
        uniforms,
        vertexShader: STATIC_VERTEX,
        fragmentShader: FRAGMENTS[kind],
        vertexColors: !!mesh.geometry.getAttribute('color'),
        defines: moon ? { MOON: '' } : kind === 'paint' && glitter ? { GLITTER: '' } : {},
        side: kind === 'screen' || kind === 'lens' ? THREE.DoubleSide : THREE.FrontSide,
      });
      byName.set(key, mat);
      made.push(mat);
    }
    mesh.material = mat;
    mesh.frustumCulled = false;
  });
  return made;
}
