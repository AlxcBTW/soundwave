import * as THREE from 'three';

/**
 * A small CPU particle system drawn as one Points object: fireworks sparks (additive) and CO2
 * smoke (alpha blended). A ring buffer, so new particles quietly replace the oldest when full.
 */
export class Particles {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly drag: Float32Array;
  private readonly grow: Float32Array;
  private readonly peak: Float32Array;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private cursor = 0;
  private live = 0;

  constructor(private readonly max: number, blending: THREE.Blending) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.peak = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const additive = blending === THREE.AdditiveBlending;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending,
      vertexColors: true,
      uniforms: { uScale: { value: 800 } },
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute float aSize; attribute float aAlpha;
        varying vec3 vC; varying float vA;
        void main() {
          vC = color; vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aAlpha > 0.0 ? max(1.0, aSize * uScale / -mv.z) : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: additive
        ? /* glsl */ `
        varying vec3 vC; varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float k = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vC * (k * k * 4.0) * vA, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
        : /* glsl */ `
        varying vec3 vC; varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          // Soft, uneven puffs: a wide falloff with a little swirl so neighbours don't tile.
          float k = pow(max(0.0, 1.0 - d * 2.0), 2.2);
          float n = 0.75 + 0.25 * sin(gl_PointCoord.x * 9.0 + gl_PointCoord.y * 7.0);
          gl_FragColor = vec4(vC, k * n * vA);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }

  setScale(s: number) {
    this.mat.uniforms.uScale.value = s;
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, color: ArrayLike<number>, size: number, life: number, drag: number, grow: number, alpha = 1) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    if (this.life[i] <= 0) this.live++;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color[0], color[1], color[2]], i * 3);
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.drag[i] = drag;
    this.grow[i] = grow;
    this.peak[i] = alpha;
    this.alpha[i] = alpha;
  }

  update(dt: number, gravity: number) {
    if (!this.live) return;
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      live++;
      const o = i * 3;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[o] *= k;
      this.vel[o + 1] = this.vel[o + 1] * k + gravity * dt;
      this.vel[o + 2] *= k;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const f = this.life[i] / this.maxLife[i];
      // Sparks fade as they burn out; smoke swells in, then thins.
      this.alpha[i] = this.peak[i] * Math.min(1, f * 2.5) * Math.min(1, (1 - f) * 12 + 0.2);
    }
    this.live = live;
    for (const name of ['position', 'aSize', 'aAlpha', 'color'] as const) this.geo.getAttribute(name).needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}
