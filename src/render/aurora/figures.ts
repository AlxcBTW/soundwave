import * as THREE from 'three';
import { COMMON, OUTPUT, shared } from './shared';
import type { Clip, FigureSet, VenueData } from './assets';
import type { Vec3 } from '../stage/Director';

/**
 * The people. A figure set (the band or the crowd) is a handful of characters whose meshes carry
 * up to four joints and weights per vertex, plus one small texture of baked joint matrices (a row
 * per frame of every animation loop). The vertex shader skins each instance from that texture, so
 * thousands of people play their own loop, at their own point in it, for a few texture reads per
 * vertex. Every instance has a calmer loop and a livelier one and switches as the music gets busier.
 */
export interface Person {
  pos: Vec3;
  yaw: number;
  scale: number;
  character: string;
  /** Use the character's lighter mesh (people far from every camera). */
  far?: boolean;
  calm: string;
  hype: string;
  /** Energy above which the livelier loop plays, 0..1. */
  threshold: number;
  /** Where in its loop this person starts, 0..1. */
  phase: number;
  /** Recolour for the top and the bottom garment, and how much of it to apply (0 keeps the original). */
  top?: THREE.ColorRepresentation;
  bottom?: THREE.ColorRepresentation;
  recolor?: number;
  /** Lit by the front spots (the band): 1 for a band member, more for the one picked out. */
  spot?: number;
}

const VERTEX = /* glsl */ `
uniform sampler2D uAnim;
uniform float uBeat;
uniform float uEnergy;
attribute vec2 uv1;
attribute vec2 uv2;
attribute vec3 aClipA;
attribute vec3 aClipB;
attribute vec4 aVar;
attribute vec3 aTop;
attribute vec3 aBottom;
varying vec3 vWPos; varying vec3 vWNorm; varying vec2 vUv; varying vec4 vCol;
varying vec3 vTop; varying vec3 vBottom; varying vec2 vLook;

mat4 jointAt(int joint, int row) {
  vec4 r0 = texelFetch(uAnim, ivec2(joint * 3, row), 0);
  vec4 r1 = texelFetch(uAnim, ivec2(joint * 3 + 1, row), 0);
  vec4 r2 = texelFetch(uAnim, ivec2(joint * 3 + 2, row), 0);
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}

void main() {
  vec3 clip = uEnergy > aVar.y ? aClipB : aClipA;
  float f = fract(uBeat / clip.z + aVar.x) * clip.y;
  float f0 = floor(f);
  int row0 = int(clip.x + f0);
  int row1 = int(clip.x + mod(f0 + 1.0, clip.y));
  float k = f - f0;
  // Each of uv1.xy, uv2.xy is one influence: joint + weight / 2.
  vec4 packed = vec4(uv1, uv2);
  mat4 pose = mat4(0.0);
  for (int i = 0; i < INFLUENCES; i++) {
    float w = fract(packed[i]) * 2.0;
    if (w > 0.0) {
      int joint = int(floor(packed[i]));
      #ifdef FAR
        pose += jointAt(joint, row0) * w;
      #else
        pose += (jointAt(joint, row0) * (1.0 - k) + jointAt(joint, row1) * k) * w;
      #endif
    }
  }
  pose /= max(1e-4, pose[3][3]);
  vec4 w = modelMatrix * instanceMatrix * (pose * vec4(position, 1.0));
  vWPos = w.xyz;
  vWNorm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * (mat3(pose) * normal));
  vUv = uv;
  #if defined(USE_COLOR_ALPHA)
    vCol = color;
  #elif defined(USE_COLOR)
    vCol = vec4(color, 0.0);
  #else
    vCol = vec4(1.0, 1.0, 1.0, 0.0);
  #endif
  vTop = aTop; vBottom = aBottom; vLook = aVar.zw;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAGMENT = /* glsl */ `
${COMMON}
uniform sampler2D uMap;
uniform vec3 uBase;
uniform float uGloss;
uniform float uGlow;
varying vec3 vWPos; varying vec3 vWNorm; varying vec2 vUv; varying vec4 vCol;
varying vec3 vTop; varying vec3 vBottom; varying vec2 vLook;
void main() {
  vec3 base = uBase * vCol.rgb;
  #ifdef TEXTURED
    vec4 tex = texture2D(uMap, vUv);
    #ifdef CUTOUT
      if (tex.a < 0.5) discard;
    #endif
    base *= tex.rgb;
  #endif
  // Recolour the garments the build marked (alpha 1 = top, 0.7 = bottom), keeping their shading.
  float top = step(0.85, vCol.a);
  float bottom = step(0.5, vCol.a) * (1.0 - top);
  float lum = dot(base, vec3(0.3, 0.6, 0.1));
  base = mix(base, vTop * (0.25 + 1.7 * lum), top * vLook.x);
  base = mix(base, vBottom * (0.25 + 1.7 * lum), bottom * vLook.x);

  vec3 n = normalize(vWNorm);
  vec3 v = normalize(cameraPosition - vWPos);
  if (dot(n, v) < 0.0) n = -n;
  vec3 toGlow = uGlowPos - vWPos;
  float gd = length(toGlow);
  toGlow /= gd;
  float stage = 1.0 / (1.0 + gd * gd * 0.0006);
  float wrap = max(0.0, dot(n, toGlow) * 0.6 + 0.4);
  vec3 stageCol = mix(uKey, vec3(1.0), 0.35) * uScreenLevel;
  // People standing shoulder to shoulder shade each other below the shoulders.
  float packed = mix(smoothstep(0.2, 1.7, vWPos.y) * 0.85 + 0.15, 1.0, min(1.0, vLook.y));
  vec3 light = (vec3(0.02, 0.035, 0.11) * (0.6 + 0.4 * n.y) + stageCol * wrap * stage * 0.95 + uWash * 0.16 * stage) * packed;
  // The band stands in the front spots.
  vec3 spotDir = normalize(vec3(0.25, 0.75, 0.6));
  light += vLook.y * vec3(1.0, 0.92, 0.86) * (max(0.0, dot(n, spotDir)) * 0.85 + 0.22);
  vec3 col = base * light;
  float fres = pow(1.0 - max(0.0, dot(n, v)), 2.5);
  col += mix(uKey, uAccent, 0.5) * fres * (stage * 0.55 + vLook.y * 0.45) * max(0.0, dot(n, toGlow) + 0.35);
  col += uGloss * (skyGradient(reflect(-v, n)) * (0.2 + fres) + vLook.y * pow(max(0.0, dot(reflect(-v, n), spotDir)), 30.0));
  col += base * uGlow * (0.25 + 0.5 * uPulse);
  gl_FragColor = vec4(applyHaze(col, vWPos), 1.0);
  ${OUTPUT}
}`;

export class Figures {
  readonly group = new THREE.Group();
  private readonly texture: THREE.DataTexture;
  private readonly materials = new Map<string, THREE.ShaderMaterial>();
  private readonly owned: { dispose(): void }[] = [];
  count = 0;
  triangles = 0;

  constructor(private readonly set: FigureSet) {
    this.texture = new THREE.DataTexture(set.anim, set.data.joints * 3, set.data.frames, THREE.RGBAFormat, THREE.HalfFloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }

  get characters(): string[] {
    return Object.keys(this.set.data.characters);
  }

  /** Adds people; one instanced draw per character mesh part. */
  add(people: Person[]) {
    const groups = new Map<string, Person[]>();
    for (const p of people) {
      const key = `${p.character}|${p.far ? 'far' : 'near'}`;
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const c = new THREE.Color();
    for (const [key, list] of groups) {
      const far = key.endsWith('|far');
      const info = this.set.data.characters[list[0].character];
      const source = info && this.set.scene.getObjectByName((far && info.far) || info.mesh);
      if (!info || !source) continue;
      const clips = new Map(info.clips.map((cl) => [cl.name, cl]));
      const n = list.length;
      const clipA = new Float32Array(n * 3);
      const clipB = new Float32Array(n * 3);
      const vary = new Float32Array(n * 4);
      const top = new Float32Array(n * 3);
      const bottom = new Float32Array(n * 3);
      const matrices: THREE.Matrix4[] = [];
      list.forEach((p, i) => {
        const a: Clip = clips.get(p.calm) ?? info.clips[0];
        const b: Clip = clips.get(p.hype) ?? a;
        clipA.set([a.start, a.frames, a.beats], i * 3);
        clipB.set([b.start, b.frames, b.beats], i * 3);
        vary.set([p.phase, p.threshold, p.recolor ?? 0, p.spot ?? 0], i * 4);
        top.set(c.set(p.top ?? '#ffffff').toArray(), i * 3);
        bottom.set(c.set(p.bottom ?? '#ffffff').toArray(), i * 3);
        matrices.push(m.compose(pos.set(...p.pos), q.setFromAxisAngle(UP, p.yaw), scl.setScalar(p.scale)).clone());
      });
      source.traverse((o) => {
        const part = o as THREE.Mesh;
        if (!part.isMesh) return;
        const geo = part.geometry.clone();
        const inst = (arr: Float32Array, size: number) => new THREE.InstancedBufferAttribute(arr, size);
        geo.setAttribute('aClipA', inst(clipA, 3));
        geo.setAttribute('aClipB', inst(clipB, 3));
        geo.setAttribute('aVar', inst(vary, 4));
        geo.setAttribute('aTop', inst(top, 3));
        geo.setAttribute('aBottom', inst(bottom, 3));
        const mesh = new THREE.InstancedMesh(geo, this.materialFor(part, far), n);
        matrices.forEach((mat, i) => mesh.setMatrixAt(i, mat));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        this.owned.push(geo, mesh);
        this.triangles += n * ((geo.index ? geo.index.count : geo.attributes.position.count) / 3);
      });
      this.count += n;
    }
  }

  /** The figure shader set up for one mesh part: its texture or colour, cut-out and gloss. */
  private materialFor(part: THREE.Mesh, far: boolean): THREE.ShaderMaterial {
    const src = part.material as THREE.MeshStandardMaterial;
    const hasColor = !!part.geometry.getAttribute('color');
    const key = `${src.uuid}|${far}|${hasColor}`;
    let mat = this.materials.get(key);
    if (mat) return mat;
    const textured = !!src.map;
    const cutout = textured && (src.transparent || src.alphaTest > 0);
    const defines: Record<string, string | number> = { INFLUENCES: far ? 2 : 4 };
    if (far) defines.FAR = '';
    if (textured) defines.TEXTURED = '';
    if (cutout) defines.CUTOUT = '';
    mat = new THREE.ShaderMaterial({
      name: src.name,
      uniforms: {
        ...shared,
        uAnim: { value: this.texture },
        uMap: { value: src.map ?? null },
        uBase: { value: textured ? new THREE.Color(1, 1, 1) : src.color.clone() },
        uGloss: { value: /^Prop(Body|Metal|Glow)/.test(src.name) ? 1 : 0 },
        uGlow: { value: /^PropGlow/.test(src.name) ? 1 : 0 },
      },
      defines,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      vertexColors: hasColor,
      side: cutout ? THREE.DoubleSide : THREE.FrontSide,
    });
    this.materials.set(key, mat);
    return mat;
  }

  dispose() {
    for (const o of this.owned) o.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.texture.dispose();
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** Small deterministic generator, so the same crowd turns up every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BRIGHT = ['#ff3d9a', '#33d8ff', '#b6ff3d', '#ffffff', '#9a5cff', '#ff8a2a', '#ffd23d', '#2a6bff', '#ff4d4d'];
const DARK = ['#101018', '#1c1c28', '#2a2a36', '#14203a'];
const BOTTOMS = ['#10142a', '#1a2a55', '#15151a', '#2a3460', '#3a3a44', '#4a3a2a'];
const CALM = ['dance', 'dance', 'clap', 'headbang'];
const HYPE = ['cheer', 'cheer', 'fistpump', 'excited', 'excited', 'headbang'];
/** People closer than this to a low camera are drawn with the detailed mesh, metres. */
const NEAR_CAMERA = 12;

/**
 * The crowd: a jittered grid in front of the barrier, fanning out from the stage, thinning toward
 * the back and sides. `share` (0..1) thins it further for lighter graphics settings. People within
 * a few metres of a low camera get the detailed mesh and a little room is kept around the lens;
 * everybody else is the light mesh. With `sync` the loops are made to the beat and everyone plays
 * them nearly in time; otherwise each person starts at a point of their own.
 */
export function makeCrowd(data: VenueData, characters: string[], share: number, cameras: Vec3[] = [], sync = false): Person[] {
  const rand = rng(31);
  const people: Person[] = [];
  if (!characters.length) return people;
  const { center, a, b, power, barrier } = data.deck;
  const step = 0.92;
  for (let z = center[2]; z < 128; z += step) {
    for (let x = -125; x < 125; x += step) {
      const r = rand();
      const px = x + (rand() - 0.5) * step * 0.8;
      const pz = z + (rand() - 0.5) * step * 0.8;
      const dx = Math.abs(px - center[0]) / (a * (barrier + 0.05));
      const dz = Math.abs(pz - center[2]) / (b * (barrier + 0.05));
      if (dx ** power + dz ** power < 1) continue; // inside the barrier
      // Behind the wing screens and the ribbon there is no audience.
      if (pz < -5 + (Math.abs(px) - 30) * 0.44 + 4) continue;
      const front = pz - (center[2] + b * barrier);
      if (Math.abs(px) > 58 + front * 0.62) continue;
      const dist = Math.hypot(px, front);
      const keep = Math.max(0.28, 1.08 - dist / 150) * share;
      if (r > keep) continue;
      let nearest = Infinity;
      for (const c of cameras) nearest = Math.min(nearest, Math.hypot(px - c[0], pz - c[2]));
      if (nearest < 2.2) continue;
      if (data.clear?.some((c) => Math.hypot(px - c.pos[0], pz - c.pos[2]) < c.radius)) continue;
      const style = rand();
      people.push({
        pos: [px, 0, pz],
        yaw: Math.atan2(center[0] - px, center[2] - 6 - pz) + (rand() - 0.5) * 0.5,
        scale: 0.94 + rand() * 0.12,
        character: characters[Math.floor(rand() * characters.length)],
        far: nearest >= NEAR_CAMERA,
        calm: CALM[Math.floor(rand() * CALM.length)],
        hype: HYPE[Math.floor(rand() * HYPE.length)],
        threshold: 0.3 + rand() * 0.5,
        phase: sync ? rand() * 0.1 : rand(),
        // A third keep their own clothes; the rest get a bright or a dark top of their own.
        recolor: style < 0.3 ? 0 : 1,
        top: style < 0.62 ? DARK[Math.floor(rand() * DARK.length)] : BRIGHT[Math.floor(rand() * BRIGHT.length)],
        bottom: BOTTOMS[Math.floor(rand() * BOTTOMS.length)],
      });
    }
  }
  return people;
}

/** The band on its marks: guitar and bass turned in toward the singer, `focus` (a band key) lit a little more. */
export function makeBand(data: VenueData, band: Record<string, { character: string; clip: string }>, focus?: string): Person[] {
  const turn: Record<string, number> = { lead: 0.42, bass: -0.42 };
  return Object.entries(band).flatMap(([part, who]) => {
    const pos = data.band[part];
    if (!pos) return [];
    return [{ pos, yaw: turn[part] ?? 0, scale: 1, character: who.character, calm: who.clip, hype: who.clip, threshold: 2, phase: 0, spot: part === focus ? 1.3 : 1 }];
  });
}
