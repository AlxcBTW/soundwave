import * as THREE from 'three';
import { COMMON, OUTPUT, shared } from './shared';

/** Seconds one shot burns, from the first lick to the last wisp. */
const LIFE = 1.3;
/** How far into a shot the flame stands at its full height, fuel still running (a share of LIFE). */
const FULL = 0.32;

/**
 * Flame jets: a row of projectors that each throw a column of fire a few metres high. A shot is a
 * sheet that turns to face the camera, and the fire is drawn on it: fuel runs for the first half of
 * the shot, so the front of the flame climbs fast, then the foot lets go and what is left rises and
 * burns out. The body is rolling noise, hottest and whitest in the core, orange to deep red at the
 * edges, and it is added to the picture so it glows.
 */
export class Flames {
  readonly mesh: THREE.Mesh;
  private readonly shots: THREE.InstancedBufferAttribute;
  private readonly count: number;
  /** 1 while the jets are held burning (see hold), 0 otherwise. */
  private readonly held = { value: 0 };

  constructor(bases: readonly (readonly [number, number, number])[]) {
    this.count = bases.length;
    const sheet = new THREE.PlaneGeometry(1, 1, 1, 12);
    sheet.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = sheet.index;
    geo.setAttribute('position', sheet.getAttribute('position'));
    geo.setAttribute('uv', sheet.getAttribute('uv'));
    geo.instanceCount = this.count;
    geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(new Float32Array(bases.flat()), 3));
    // per jet: when it was fired, a number of its own for the turbulence, and its size
    const shots = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) shots[i * 3] = -1e3;
    this.shots = new THREE.InstancedBufferAttribute(shots, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aShot', this.shots);
    const material = new THREE.ShaderMaterial({
      uniforms: { ...shared, uHeld: this.held },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uHeld;
        attribute vec3 aBase;
        attribute vec3 aShot;
        varying vec2 vUv; varying float vAge; varying float vSeed;
        void main() {
          vUv = uv;
          vAge = (uTime - aShot.x) / ${LIFE.toFixed(2)};
          // Held, a shot climbs to its full height and stays there: the fuel keeps running.
          if (uHeld > 0.5) vAge = min(vAge, ${FULL.toFixed(2)});
          vSeed = aShot.y;
          // A jet that is not burning is folded away to nothing.
          float live = step(0.0, vAge) * step(vAge, 1.0);
          vec3 toCam = cameraPosition - aBase;
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
          vec3 p = aBase + right * position.x * 3.6 * aShot.z + vec3(0.0, position.y * 10.5 * aShot.z, 0.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0) * live;
        }`,
      fragmentShader: /* glsl */ `
        ${COMMON}
        varying vec2 vUv; varying float vAge; varying float vSeed;
        void main() {
          float x = (vUv.x - 0.5) * 2.0;
          float y = vUv.y;
          float t = uTime * 3.4 + vSeed;
          float head = smoothstep(0.0, 0.2, vAge) * 1.08;
          float foot = smoothstep(0.42, 0.95, vAge) * 1.1;
          float big = fbm(vec2(x * 1.6 + vSeed, y * 3.4 - t));
          float fine = fbm(vec2(x * 4.2 - vSeed, y * 8.0 - t * 1.7));
          // the column leans and curls more the higher it gets
          float bent = x + (big - 0.5) * 0.75 * (0.2 + y);
          float width = mix(0.15, 0.6, smoothstep(0.0, 0.45, y)) * (1.0 - 0.75 * smoothstep(0.55, 1.0, y));
          float d = clamp(1.0 - abs(bent) / max(width, 1e-3), 0.0, 1.0);
          d *= smoothstep(head, head - 0.3, y) * smoothstep(foot - 0.05, foot + 0.2, y);
          d *= smoothstep(0.15, 0.72, big * 0.6 + fine * 0.5 + d * 0.55 - y * 0.25);
          d *= 1.0 - smoothstep(0.8, 1.0, vAge);
          float heat = d * (1.15 - 0.55 * y);
          vec3 col = vec3(1.0, 0.15, 0.02) * smoothstep(0.0, 0.35, heat) + vec3(0.9, 0.48, 0.05) * smoothstep(0.2, 0.7, heat)
            + vec3(0.9, 0.85, 0.6) * smoothstep(0.6, 1.0, heat);
          gl_FragColor = vec4(col * d * 2.0, 1.0);
          ${OUTPUT}
        }`,
    });
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  /** Fires the jets `which` picks (all of them by default), at show time `time`. */
  fire(time: number, which: (index: number) => boolean = () => true, size = 1) {
    const a = this.shots.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      if (!which(i)) continue;
      a[i * 3] = time;
      a[i * 3 + 1] = Math.random() * 100;
      a[i * 3 + 2] = size * (0.85 + 0.3 * Math.random());
    }
    this.shots.needsUpdate = true;
  }

  /**
   * One long burst: every jet fires and keeps burning at full height until it is let go, when the
   * fuel stops and the flames rise and burn out as after any shot.
   */
  hold(time: number, on: boolean, size = 1.15) {
    if (on === this.held.value > 0.5) return;
    if (on) this.fire(time, undefined, size);
    else {
      // Let go from full height: as if each shot had been fired just long enough ago to stand there.
      const a = this.shots.array as Float32Array;
      for (let i = 0; i < this.count; i++) a[i * 3] = Math.min(a[i * 3], time - FULL * LIFE);
      this.shots.needsUpdate = true;
    }
    this.held.value = on ? 1 : 0;
  }

  /** Whether the jets are being held burning. */
  get holding(): boolean {
    return this.held.value > 0.5;
  }

  /** How strongly the jets are burning at `time`, 0..1: the light they throw on what stands near. */
  glow(time: number): number {
    const a = this.shots.array as Float32Array;
    let most = 0;
    for (let i = 0; i < this.count; i++) {
      const age = Math.min((time - a[i * 3]) / LIFE, this.holding ? FULL : Infinity);
      if (age < 0 || age > 1) continue;
      most = Math.max(most, Math.min(1, age / 0.12) * Math.max(0, 1 - Math.max(0, age - 0.45) / 0.5) * Math.min(1, a[i * 3 + 2]));
    }
    return most;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
