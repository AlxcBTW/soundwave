import * as THREE from 'three';
import type { Chart } from '../chart/types';
import type { GameEvent, GameSession } from '../game/GameSession';

export const LANE_COLORS = [0x3ddc5a, 0xff3b4e, 0xffd23d, 0x3a8bff, 0xff8a1f];
const OVERDRIVE_COLOR = new THREE.Color(0xeaf6ff);
const MISSED_TINT = 0.28;

const LANE_W = 1;
const LENGTH = 24;
const MAX_GEMS = 512;
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
  varying vec2 vUv;
  void main() {
    float x = vUv.x * uLanes;
    float lane = fract(x);
    float divider = smoothstep(0.035, 0.0, min(lane, 1.0 - lane));
    float edge = smoothstep(0.06, 0.0, min(vUv.x, 1.0 - vUv.x));
    // vUv.y: 0 = near (strike line side), 1 = far end.
    float far = smoothstep(1.0, 0.55, vUv.y);
    float near = smoothstep(0.0, 0.04, vUv.y);
    float stripes = 0.5 + 0.5 * sin((vUv.y * 60.0 + uScroll) * 3.14159);
    vec3 base = mix(vec3(0.04, 0.035, 0.11), vec3(0.08, 0.06, 0.2), vUv.y);
    base += vec3(0.02, 0.02, 0.05) * stripes;
    vec3 od = vec3(0.35, 0.65, 1.0);
    vec3 edgeCol = mix(vec3(0.55, 0.35, 1.0), od, uOverdrive);
    vec3 col = base + divider * vec3(0.22, 0.2, 0.4) + edge * edgeCol * (1.2 + uPulse);
    col += od * uOverdrive * 0.12 * (0.6 + 0.4 * stripes);
    float alpha = (0.88 + edge * 0.12) * far * near;
    gl_FragColor = vec4(col, alpha);
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
  private readonly gems: THREE.InstancedMesh;
  private readonly shines: THREE.InstancedMesh;
  private readonly tails: THREE.InstancedMesh;
  private readonly lines: THREE.InstancedMesh;
  private readonly pads: THREE.Mesh[] = [];
  private readonly padGlows: THREE.Mesh[] = [];
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
  private readonly flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private firstNote = 0;
  private firstBeat = 0;
  private lastFrame = performance.now();
  private shake = 0;
  private pulse = 0;
  private readonly lanes: number;
  private readonly width: number;
  private unsub: (() => void) | null = null;

  /** Highway units per second. */
  speed = 9;

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
      },
    });
    const trackLen = LENGTH + 1.5;
    const track = new THREE.Mesh(new THREE.PlaneGeometry(this.width + 0.12, trackLen), this.trackMat);
    track.rotation.x = -Math.PI / 2;
    track.position.set(0, -0.02, -trackLen / 2 + 1.5);
    track.renderOrder = -2;
    this.root.add(track);

    // Beat / bar lines
    this.lines = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false }),
      MAX_LINES,
    );
    this.lines.renderOrder = -1;
    this.lines.frustumCulled = false;
    this.root.add(this.lines);

    // Strike pads
    const padGeo = new THREE.ShapeGeometry(roundedRect(0.86, 0.36, 0.12));
    const padRing = new THREE.ShapeGeometry(roundedRect(0.92, 0.42, 0.15));
    for (let i = 0; i < this.lanes; i++) {
      const x = this.laneX(i);
      const ring = new THREE.Mesh(padRing, new THREE.MeshBasicMaterial({ color: this.laneColors[i], transparent: true, opacity: 0.9 }));
      ring.quaternion.copy(this.flat);
      ring.position.set(x, 0.0, 0);
      const fill = new THREE.Mesh(padGeo, new THREE.MeshBasicMaterial({ color: 0x0a0818 }));
      fill.quaternion.copy(this.flat);
      fill.position.set(x, 0.005, 0);
      const glow = new THREE.Mesh(
        padGeo,
        new THREE.MeshBasicMaterial({ color: this.laneColors[i], transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      glow.quaternion.copy(this.flat);
      glow.position.set(x, 0.01, 0);
      this.root.add(ring, fill, glow);
      this.pads.push(fill);
      this.padGlows.push(glow);
    }

    // Gems: beveled rounded tiles with a glossy top highlight.
    const gemGeo = new THREE.ExtrudeGeometry(roundedRect(0.8, 0.3, 0.1), {
      depth: 0.08,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.035,
      bevelSegments: 3,
      curveSegments: 6,
    });
    gemGeo.rotateX(-Math.PI / 2);
    gemGeo.translate(0, 0.02, 0);
    this.gems = new THREE.InstancedMesh(
      gemGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.28, metalness: 0.15, emissive: 0x222222 }),
      MAX_GEMS,
    );
    this.gems.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GEMS * 3), 3);
    this.gems.frustumCulled = false;
    this.root.add(this.gems);

    const shineGeo = new THREE.ShapeGeometry(roundedRect(0.6, 0.1, 0.05));
    shineGeo.rotateX(-Math.PI / 2);
    shineGeo.translate(0, 0.165, -0.05);
    this.shines = new THREE.InstancedMesh(
      shineGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }),
      MAX_GEMS,
    );
    this.shines.frustumCulled = false;
    this.root.add(this.shines);

    // Sustain tails
    const tailGeo = new THREE.PlaneGeometry(1, 1);
    tailGeo.rotateX(-Math.PI / 2);
    tailGeo.translate(0, 0, -0.5); // extends from z=0 to z=-1 before scaling
    this.tails = new THREE.InstancedMesh(
      tailGeo,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
      MAX_TAILS,
    );
    this.tails.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TAILS * 3), 3);
    this.tails.frustumCulled = false;
    this.tails.renderOrder = 0;
    this.root.add(this.tails);

    // Hit flashes
    const tex = radialTexture();
    const flashGeo = new THREE.PlaneGeometry(1.6, 1.6);
    for (let i = 0; i < this.lanes; i++) {
      const f = new THREE.Mesh(
        flashGeo,
        new THREE.MeshBasicMaterial({ map: tex, color: this.laneColors[i], transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
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
      new THREE.PointsMaterial({ size: 0.16, map: tex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.particles.frustumCulled = false;
    this.root.add(this.particles);

    this.resize();
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
    // Fit the highway width; 5 lanes pull the camera back a little.
    const back = this.lanes === 5 ? 1.12 : 1;
    const narrow = Math.max(1, 1.5 / this.camera.aspect);
    this.camera.position.set(0, 3.3 * back * narrow, 4.1 * back * narrow);
    this.camera.lookAt(0, 0, -7);
    this.camera.updateProjectionMatrix();
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
      case 'phrase-complete':
        for (let i = 0; i < this.lanes; i++) this.burst(i, 6, OVERDRIVE_COLOR);
        break;
      case 'overdrive-start':
        this.pulse = 1.5;
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

  /** Renders the frame for song time `t`. `beatPulse` (0..1) lets the music drive the track glow. */
  render(t: number, session: GameSession, beatPulse = 0) {
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
    this.pulse = Math.max(0, this.pulse - dt * 2);
    u.uPulse.value = this.pulse + beatPulse * 0.6;

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
      this.s.set(this.width, isBar ? 0.06 : 0.025, 1);
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
    this.q.identity();
    for (let i = this.firstNote; i < notes.length; i++) {
      const n = notes[i];
      if (n.t - t > horizon) break;
      const x = this.laneX(n.lane);
      const hit = session.isHit(i);
      const missed = session.isMissed(i);
      const held = hit && session.holding[n.lane] === i;
      const od = n.phrase >= 0 && !session.isPhraseFailed(n.phrase);
      const color = od ? OVERDRIVE_COLOR : this.laneColors[n.lane];

      if (n.dur > 0 && ti < MAX_TAILS) {
        const startZ = held ? 0 : -(n.t - t) * speed;
        const endZ = Math.max(-LENGTH, -(n.t + n.dur - t) * speed);
        const len = startZ - endZ;
        if (len > 0.01 && (!hit || held)) {
          this.v.set(x, 0.01, startZ);
          this.s.set(held ? 0.3 : 0.22, 1, len);
          this.m.compose(this.v, this.q, this.s);
          this.tails.setMatrixAt(ti, this.m);
          this.c.copy(color).multiplyScalar(missed ? MISSED_TINT : held ? 1.3 : 0.75);
          this.tails.setColorAt(ti, this.c);
          ti++;
        }
        if (held) this.padLight[n.lane] = Math.max(this.padLight[n.lane], 0.8);
      }

      if (hit || gi >= MAX_GEMS) continue;
      const z = -(n.t - t) * speed;
      if (z > 2) continue;
      this.v.set(x, 0, z);
      this.s.set(1, 1, 1);
      this.m.compose(this.v, this.q, this.s);
      this.gems.setMatrixAt(gi, this.m);
      this.shines.setMatrixAt(gi, this.m);
      this.c.copy(color);
      if (missed) this.c.multiplyScalar(MISSED_TINT);
      this.gems.setColorAt(gi, this.c);
      gi++;
    }
    this.gems.count = gi;
    this.shines.count = gi;
    this.tails.count = ti;
    this.gems.instanceMatrix.needsUpdate = true;
    this.shines.instanceMatrix.needsUpdate = true;
    if (this.gems.instanceColor) this.gems.instanceColor.needsUpdate = true;
    this.tails.instanceMatrix.needsUpdate = true;
    if (this.tails.instanceColor) this.tails.instanceColor.needsUpdate = true;

    // Pads and flashes
    for (let i = 0; i < this.lanes; i++) {
      if (session.laneDown[i]) this.padLight[i] = Math.max(this.padLight[i], 0.55);
      this.padLight[i] = Math.max(0, this.padLight[i] - dt * 5);
      (this.padGlows[i].material as THREE.MeshBasicMaterial).opacity = this.padLight[i];
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
