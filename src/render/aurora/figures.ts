import * as THREE from 'three';
import { COMMON, OUTPUT, shared } from './shared';
import type { Clip, FigureData, VenueData } from './assets';
import type { Vec3 } from '../stage/Director';

/**
 * The people: crowd and band are the same jointed figures, animated in the vertex shader from one
 * small texture of baked joint matrices (a row per frame). Every instance picks a calm loop and a
 * livelier one and switches between them as the music gets busier, so thousands of people move
 * with the beat for the cost of a few texture reads per vertex.
 */
export interface Person {
  pos: Vec3;
  yaw: number;
  scale: number;
  /** Mesh variant name. */
  mesh: string;
  calm: string;
  hype: string;
  /** Energy above which the livelier loop plays, 0..1. */
  threshold: number;
  /** Fraction of a loop this person runs late. */
  late: number;
  top: THREE.ColorRepresentation;
  bottom: THREE.ColorRepresentation;
  /** 0 light .. 1 dark. */
  skin: number;
  hair: number;
  /** Lit by the front spots (the band). */
  spot?: boolean;
}

const VERTEX = /* glsl */ `
uniform sampler2D uAnim;
uniform float uBeat;
uniform float uEnergy;
attribute vec3 aClipA;
attribute vec3 aClipB;
attribute vec4 aVar;
attribute vec3 aTop;
attribute vec3 aBottom;
attribute vec3 aLook;
varying vec3 vWPos; varying vec3 vWNorm; varying float vRegion;
varying vec3 vTop; varying vec3 vBottom; varying vec3 vLook;

mat4 jointAt(int joint, float row) {
  int y = int(row);
  vec4 r0 = texelFetch(uAnim, ivec2(joint * 3, y), 0);
  vec4 r1 = texelFetch(uAnim, ivec2(joint * 3 + 1, y), 0);
  vec4 r2 = texelFetch(uAnim, ivec2(joint * 3 + 2, y), 0);
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}

void main() {
  // glTF stores v flipped: undo it to get the joint the build wrote.
  int joint = int(floor((1.0 - uv.y) * 16.0));
  vRegion = floor(uv.x * 8.0);
  vec3 clip = uEnergy > aVar.y ? aClipB : aClipA;
  float f = fract(uBeat / clip.z + aVar.x) * clip.y;
  float f0 = floor(f);
  float f1 = mod(f0 + 1.0, clip.y);
  mat4 a = jointAt(joint, clip.x + f0);
  mat4 b = jointAt(joint, clip.x + f1);
  float k = f - f0;
  mat4 pose = a * (1.0 - k) + b * k;
  vec4 w = modelMatrix * instanceMatrix * (pose * vec4(position, 1.0));
  vWPos = w.xyz;
  vWNorm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * (mat3(pose) * normal));
  vTop = aTop; vBottom = aBottom; vLook = aLook;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAGMENT = /* glsl */ `
${COMMON}
varying vec3 vWPos; varying vec3 vWNorm; varying float vRegion;
varying vec3 vTop; varying vec3 vBottom; varying vec3 vLook;
void main() {
  int region = int(vRegion + 0.5);
  vec3 base;
  float glow = 0.0;
  float gloss = 0.0;
  if (region == 0) base = mix(vec3(0.9, 0.62, 0.48), vec3(0.2, 0.11, 0.07), vLook.x);
  else if (region == 1) base = vTop;
  else if (region == 2) base = vBottom;
  else if (region == 3) base = vLook.y > 0.6 ? vec3(0.32) : vec3(0.03);
  else if (region == 4) base = vLook.y < 0.3 ? vec3(0.015, 0.012, 0.012) : vLook.y < 0.55 ? vec3(0.12, 0.06, 0.03) : vLook.y < 0.8 ? vec3(0.6, 0.42, 0.18) : mix(vTop, vec3(1.0), 0.3);
  else if (region == 5) { base = mix(vTop, uKey, 0.5) * 0.55; gloss = 1.0; }
  else if (region == 6) base = vec3(0.012);
  else { base = uAccent; glow = 1.6 + 1.2 * uPulse; }

  vec3 n = normalize(vWNorm);
  vec3 v = normalize(cameraPosition - vWPos);
  vec3 toGlow = uGlowPos - vWPos;
  float gd = length(toGlow);
  toGlow /= gd;
  float stage = 1.0 / (1.0 + gd * gd * 0.0006);
  float wrap = max(0.0, dot(n, toGlow) * 0.6 + 0.4);
  vec3 stageCol = mix(uKey, vec3(1.0), 0.35) * uScreenLevel;
  // People standing shoulder to shoulder shade each other below the shoulders.
  float packed = mix(smoothstep(0.2, 1.7, vWPos.y) * 0.85 + 0.15, 1.0, vLook.z);
  vec3 light = (vec3(0.02, 0.035, 0.11) * (0.6 + 0.4 * n.y) + stageCol * wrap * stage * 0.95 + uWash * 0.16 * stage) * packed;
  // The band stands in the front spots.
  vec3 spotDir = normalize(vec3(0.25, 0.75, 0.6));
  light += vLook.z * vec3(1.0, 0.9, 0.84) * (max(0.0, dot(n, spotDir)) * 1.5 + 0.2);
  vec3 col = base * light;
  float fres = pow(1.0 - max(0.0, dot(n, v)), 2.5);
  col += mix(uKey, uAccent, 0.5) * fres * (stage * 0.55 + vLook.z * 0.5) * max(0.0, dot(n, toGlow) + 0.35);
  col += gloss * skyGradient(reflect(-v, n)) * (0.2 + fres) + gloss * vLook.z * pow(max(0.0, dot(reflect(-v, n), spotDir)), 30.0);
  col += base * glow;
  gl_FragColor = vec4(applyHaze(col, vWPos), 1.0);
  ${OUTPUT}
}`;

export class Figures {
  readonly group = new THREE.Group();
  private readonly texture: THREE.DataTexture;
  private readonly material: THREE.ShaderMaterial;
  private readonly clips: Map<string, Clip>;
  private readonly owned: { dispose(): void }[] = [];
  count = 0;
  triangles = 0;

  constructor(private readonly source: THREE.Object3D, data: FigureData, anim: Float32Array) {
    this.texture = new THREE.DataTexture(anim, data.joints * 3, data.frames, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.clips = new Map(data.clips.map((c) => [c.name, c]));
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...shared, uAnim: { value: this.texture } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });
  }

  /** Adds people; one instanced draw per mesh variant. */
  add(people: Person[]) {
    const byMesh = new Map<string, Person[]>();
    for (const p of people) byMesh.set(p.mesh, [...(byMesh.get(p.mesh) ?? []), p]);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const c = new THREE.Color();
    for (const [name, list] of byMesh) {
      const src = this.source.getObjectByName(name) as THREE.Mesh | undefined;
      if (!src?.isMesh) continue;
      const geo = src.geometry.clone();
      const n = list.length;
      const clipA = new Float32Array(n * 3);
      const clipB = new Float32Array(n * 3);
      const vary = new Float32Array(n * 4);
      const top = new Float32Array(n * 3);
      const bottom = new Float32Array(n * 3);
      const look = new Float32Array(n * 3);
      const mesh = new THREE.InstancedMesh(geo, this.material, n);
      list.forEach((p, i) => {
        const a = this.clips.get(p.calm) ?? this.clips.values().next().value!;
        const b = this.clips.get(p.hype) ?? a;
        clipA.set([a.start, a.frames, a.beats], i * 3);
        clipB.set([b.start, b.frames, b.beats], i * 3);
        vary.set([p.late, p.threshold, 0, 0], i * 4);
        top.set(c.set(p.top).toArray(), i * 3);
        bottom.set(c.set(p.bottom).toArray(), i * 3);
        look.set([p.skin, p.hair, p.spot ? 1 : 0], i * 3);
        mesh.setMatrixAt(i, m.compose(pos.set(...p.pos), q.setFromAxisAngle(UP, p.yaw), scl.setScalar(p.scale)));
      });
      const inst = (arr: Float32Array, size: number) => new THREE.InstancedBufferAttribute(arr, size);
      geo.setAttribute('aClipA', inst(clipA, 3));
      geo.setAttribute('aClipB', inst(clipB, 3));
      geo.setAttribute('aVar', inst(vary, 4));
      geo.setAttribute('aTop', inst(top, 3));
      geo.setAttribute('aBottom', inst(bottom, 3));
      geo.setAttribute('aLook', inst(look, 3));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.owned.push(geo, mesh);
      this.count += n;
      this.triangles += n * ((geo.index ? geo.index.count : geo.attributes.position.count) / 3);
    }
  }

  dispose() {
    for (const o of this.owned) o.dispose();
    this.material.dispose();
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

const BRIGHT = ['#ff3d9a', '#33d8ff', '#b6ff3d', '#ffffff', '#9a5cff', '#ff8a2a', '#ffd23d', '#2a6bff'];
const DARK = ['#0b0b12', '#15151f', '#1c1c2a', '#101828'];
const BOTTOMS = ['#0a0c18', '#111a33', '#0d0d10', '#1d2440', '#2a2a30'];

/**
 * The crowd: a jittered grid in front of the barrier, fanning out from the stage, thinning toward
 * the back and sides. `share` (0..1) thins it further for lighter graphics settings.
 */
export function makeCrowd(data: VenueData, meshes: string[], share: number, clear: Vec3[] = []): Person[] {
  const rand = rng(31);
  const people: Person[] = [];
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
      if (clear.some((c) => Math.hypot(px - c[0], pz - c[2]) < 2.2)) continue;
      const lively = rand();
      const dark = rand() < 0.68;
      people.push({
        pos: [px, 0, pz],
        yaw: Math.atan2(center[0] - px, center[2] - 6 - pz) + (rand() - 0.5) * 0.5,
        scale: 0.92 + rand() * 0.16,
        mesh: meshes[Math.floor(rand() * meshes.length)],
        calm: lively < 0.62 ? 'bounce' : lively < 0.82 ? 'pump' : 'clap',
        hype: ['jump', 'jump', 'hands_up', 'hands_up', 'pump', 'clap'][Math.floor(rand() * 6)],
        threshold: 0.3 + rand() * 0.5,
        late: rand() * 0.1,
        top: dark ? DARK[Math.floor(rand() * DARK.length)] : BRIGHT[Math.floor(rand() * BRIGHT.length)],
        bottom: BOTTOMS[Math.floor(rand() * BOTTOMS.length)],
        skin: rand(),
        hair: rand(),
      });
    }
  }
  return people;
}

/** The band on its marks, facing the crowd. */
export function makeBand(data: VenueData, band: Record<string, string>): Person[] {
  const looks: Record<string, Partial<Person>> = {
    lead: { top: '#ff3d9a', bottom: '#0d0d14', skin: 0.25, hair: 0.9, calm: 'guitar', yaw: 0.3 },
    bass: { top: '#33d8ff', bottom: '#14142a', skin: 0.7, hair: 0.1, calm: 'guitar', yaw: -0.3, late: 0.5 },
    vox: { top: '#f4f0ff', bottom: '#1a1030', skin: 0.45, hair: 0.45, calm: 'sing' },
    drums: { top: '#9a5cff', bottom: '#0d0d14', skin: 0.15, hair: 0.2, calm: 'drums' },
  };
  return Object.entries(band).flatMap(([part, mesh]) => {
    const pos = data.band[part];
    const look = looks[part];
    if (!pos || !look) return [];
    return [{ pos, yaw: 0, scale: 1.06, mesh, hype: look.calm!, threshold: 2, late: 0, top: '#fff', bottom: '#111', skin: 0.4, hair: 0.3, spot: true, ...look } as Person];
  });
}
