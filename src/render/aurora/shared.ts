import * as THREE from 'three';

/**
 * Uniforms every venue material shares: the clock, the music, the three colours of the light show,
 * the haze and where the stage's glow comes from. One object, so the show sets them once a frame.
 */
export const shared = {
  uTime: { value: 0 },
  /** Beats since the show started, fractional. */
  uBeat: { value: 0 },
  /** 1 on a beat, decaying. */
  uPulse: { value: 0 },
  uBarPulse: { value: 0 },
  /** How busy the music is, 0..1 (smoothed). */
  uEnergy: { value: 0.3 },
  uLow: { value: 0.2 },
  uKey: { value: new THREE.Color(1, 0.45, 0.8) },
  uAccent: { value: new THREE.Color(0.4, 0.9, 1) },
  uWash: { value: new THREE.Color(0.25, 0.2, 1) },
  /** Haze far from the stage (also the sky at the horizon) and haze soaked in the stage's light. */
  uHazeFar: { value: new THREE.Color(0.007, 0.018, 0.08) },
  uHazeNear: { value: new THREE.Color(0.1, 0.09, 0.42) },
  uHazeDensity: { value: 0.0024 },
  /** Centre of the stage's glow (the moon screen). */
  uGlowPos: { value: new THREE.Vector3(0, 16, -25.5) },
  /** Moon screen: centre x, y, z and radius. */
  uMoon: { value: new THREE.Vector4(0, 16, -25.5, 11.5) },
  /** Overall brightness of the screens. */
  uScreenLevel: { value: 1 },
};

/** Noise, haze and the screen content, shared by the fragment shaders. */
export const COMMON = /* glsl */ `
uniform float uTime;
uniform float uBeat;
uniform float uPulse;
uniform float uBarPulse;
uniform float uEnergy;
uniform float uLow;
uniform vec3 uKey;
uniform vec3 uAccent;
uniform vec3 uWash;
uniform vec3 uHazeFar;
uniform vec3 uHazeNear;
uniform float uHazeDensity;
uniform vec3 uGlowPos;
uniform vec4 uMoon;
uniform float uScreenLevel;

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 hash33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5; float s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5; }
  return s;
}

/** The sky without its clouds: what glossy surfaces reflect and what the haze fades into. */
vec3 skyGradient(vec3 d) {
  float h = max(0.0, d.y);
  vec3 col = mix(uHazeFar * 1.25, vec3(0.003, 0.006, 0.04), pow(h, 0.5));
  // The stage side of the sky is soaked in its light.
  float toStage = max(0.0, dot(normalize(vec3(d.x, 0.0, d.z) + 1e-4), vec3(0.0, 0.0, -1.0)));
  col += uHazeNear * 0.5 * pow(toStage, 3.0) * exp(-h * 4.5);
  return col;
}

/** Distance and height haze that picks up the stage's light near it. */
vec3 applyHaze(vec3 col, vec3 wpos) {
  vec3 v = wpos - cameraPosition;
  float d = length(v);
  float h = max(0.0, 0.5 * (wpos.y + cameraPosition.y));
  float f = 1.0 - exp(-d * uHazeDensity * exp(-h * 0.02));
  float lit = exp(-distance(wpos, uGlowPos) * 0.014);
  return mix(col, mix(uHazeFar, uHazeNear, lit), f);
}

/** The moon screen's picture; q runs 0..1 across its square. */
vec3 moonContent(vec2 q) {
  vec2 p = (q - 0.5) * 2.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float rip = pow(0.5 + 0.5 * sin(r * 16.0 - uBeat * 6.2831853), 5.0) * smoothstep(1.0, 0.25, r);
  float swirl = 0.5 + 0.5 * sin(a * 3.0 + r * 6.0 - uTime * 0.5);
  vec3 col = mix(uWash * 0.9, uKey, swirl * 0.7);
  col = mix(col, uAccent * 1.3, rip * 0.85);
  // The lit side of the moon: a soft crescent that drifts.
  vec2 c = p - 0.42 * vec2(cos(uTime * 0.07), sin(uTime * 0.07));
  float lune = smoothstep(0.95, 0.35, length(c));
  col += vec3(1.0, 0.96, 1.0) * lune * (0.25 + 0.3 * uPulse);
  col *= smoothstep(1.0, 0.985, r);
  return col * uScreenLevel;
}

/** The wing screens' picture: flowing bands with a bright crest, and dotted lines riding them. */
vec3 wingContent(vec2 q) {
  float t = uTime * 0.3;
  float y = q.y + 0.09 * sin(q.x * 7.0 + t * 2.0) + 0.04 * sin(q.x * 19.0 - t * 3.1);
  float v = y * 2.6 - t * 0.35 + 0.1 * uLow;
  float id = floor(v);
  float f = fract(v);
  float k = hash11(id * 7.31 + 2.0);
  vec3 col = mix(uWash, uKey, smoothstep(0.35, 0.65, k)) * (0.22 + 0.78 * f * f);
  col += uAccent * smoothstep(0.9, 1.0, f) * 1.5;
  float dots = step(0.55, fract(q.x * 40.0 + t * (k - 0.5) * 6.0)) * smoothstep(0.06, 0.0, abs(f - 0.45));
  col += uAccent * dots * 1.2;
  col *= 0.7 + 0.5 * uPulse * step(0.5, k);
  return col * uScreenLevel;
}
`;

/** Vertex shader for the static venue meshes: world position and normal, AO from vertex colour. */
export const STATIC_VERTEX = /* glsl */ `
varying vec3 vWPos;
varying vec3 vWNorm;
varying vec2 vUv;
varying float vAo;
void main() {
  // glTF stores v flipped; the build's v is the one the shaders mean.
  vUv = vec2(uv.x, 1.0 - uv.y);
  #ifdef USE_COLOR
    vAo = color.r;
  #else
    vAo = 1.0;
  #endif
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWPos = w.xyz;
  vWNorm = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const OUTPUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;
