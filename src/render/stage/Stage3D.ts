import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BandMeter, type BandLevels } from '../../audio/bands';
import type { Part } from '../../chart/types';
import { LEVEL_SHARE, type GraphicsSettings, type Level } from '../../game/graphics';
import { Director, buildShots } from './Director';
import { LightShow, type Rgb, type ShowState } from './LightShow';
import { loadStage, type LightSpec, type Scatter, type StageAssets, type StageData } from './assets';
import { Particles } from './Particles';

export interface StageOptions {
  mode: 'play' | 'menu';
  /** The part being played: that band member gets the close-ups. */
  part?: Part;
}

export interface StageFrame {
  beat: 'none' | 'beat' | 'downbeat';
  /** How busy the music is, 0..1. */
  intensity: number;
  overdrive: boolean;
  /** Seconds per bar, for pacing camera moves. */
  barSeconds: number;
}

/** Beam counts and particle budgets per level. */
const BEAM_SHARE: Record<Level, number> = { off: 0, low: 0.35, medium: 0.65, high: 1 };
const WASHES: Record<Level, number> = { off: 0, low: 3, medium: 6, high: 11 };
const SPARKS: Record<Level, number> = { off: 0, low: 1500, medium: 4000, high: 9000 };
const SPARKS_PER_RAY: Record<Level, number> = { off: 0, low: 6, medium: 12, high: 22 };
const SMOKE: Record<Level, number> = { off: 0, low: 250, medium: 700, high: 1400 };
/** Blender light watts to three.js candela (both renderers then agree on brightness). */
const WATT_TO_CD = 1 / (4 * Math.PI);
const EXPOSURE = 0.6;

interface Beam {
  pivot: THREE.Object3D;
  mat: THREE.ShaderMaterial;
  flare: THREE.Sprite;
  base: THREE.Quaternion;
  group: string;
  index: number;
  strength: number;
  color: THREE.Color;
}

/**
 * The 3D festival stage behind the highway: the exported palace, an instanced crowd and forest,
 * bulbs, moving-head beams in the haze, washes, CO2 and fireworks, all driven by the light show,
 * filmed by the camera director. It renders on its own canvas so the highway keeps full quality.
 */
export class Stage3D {
  /**
   * Loads the stage into a canvas of its own inside `host` (each stage owns its WebGL context, so
   * disposing one never takes another down). The canvas fades in once the first frame is drawn.
   */
  static async create(host: HTMLElement, g: GraphicsSettings, opts: StageOptions): Promise<Stage3D> {
    const canvas = document.createElement('canvas');
    canvas.className = 'stage3d';
    host.appendChild(canvas);
    try {
      return new Stage3D(canvas, await loadStage(), g, opts);
    } catch (err) {
      canvas.remove();
      throw err;
    }
  }

  readonly meter = new BandMeter();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3000);
  private composer: EffectComposer | null = null;
  private readonly show: LightShow;
  private readonly director: Director;
  private readonly beams: Beam[] = [];
  private readonly washes: { light: THREE.SpotLight; base: number; cool: boolean }[] = [];
  private readonly glowMats: { mat: THREE.MeshStandardMaterial; base: number; kind: 'window' | 'bay' | 'lantern' | 'bulb' }[] = [];
  private readonly screens: THREE.ShaderMaterial[] = [];
  private readonly bulbMat: THREE.ShaderMaterial;
  private readonly crowdUniforms = { uPhase: { value: 0 }, uBounce: { value: 0 } };
  private readonly sparks: Particles;
  private readonly smoke: Particles;
  private readonly sky: THREE.ShaderMaterial;
  private readonly blinders: THREE.Sprite[] = [];
  private wheel: THREE.Object3D | null = null;
  private armillary: THREE.Object3D | null = null;
  private readonly band: { obj: THREE.Object3D; y: number; seed: number }[] = [];
  private readonly data: StageData;
  private readonly owned: { dispose(): void }[] = [];
  private lastFrame = performance.now();
  private lastRender = 0;
  private frameAvg = 16;
  private dynScale = 1;
  private sinceResize = 0;
  private beatPeriod = 0.5;
  private lastBeatAt = 0;
  private beats = 0;
  private disposed = false;

  private constructor(private readonly canvas: HTMLCanvasElement, assets: StageAssets, private g: GraphicsSettings, opts: StageOptions) {
    this.data = assets.data;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: g.antialias, powerPreference: 'high-performance', alpha: false });
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = EXPOSURE;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.fog = new THREE.FogExp2(0x07060b, 0.0016);
    const menu = opts.mode === 'menu';
    this.show = new LightShow(menu);
    this.director = new Director(buildShots(this.data.cameras, this.data.band, opts.part), menu ? 'calm' : g.camera, 7, menu);

    this.sky = this.buildSky();
    this.buildStage(assets.scene);
    this.bulbMat = this.buildBulbs();
    this.buildBeams();
    this.buildWashes();
    this.sparks = new Particles(SPARKS[g.effects] || 1, THREE.AdditiveBlending);
    this.smoke = new Particles(SMOKE[g.effects] || 1, THREE.NormalBlending);
    this.scene.add(this.sparks.points, this.smoke.points);
    this.owned.push(this.sparks, this.smoke);
    if (g.glow) this.buildComposer();
    this.resize();
  }

  get bands(): Readonly<BandLevels> {
    return this.meter.levels;
  }

  setAnalyser(a: AnalyserNode | null) {
    this.meter.setAnalyser(a);
  }

  setCameraMode(mode: GraphicsSettings['camera']) {
    this.director.setMode(mode);
  }

  overdriveStart() {
    this.show.overdriveStart();
  }

  finale() {
    this.show.finale();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const ratio = Math.min(2, window.devicePixelRatio || 1) * this.g.resolution * this.dynScale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(ratio);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** One frame. Respects the frame-rate cap and adapts the resolution when frames run long. */
  render(f: StageFrame) {
    if (this.disposed) return;
    const now = performance.now();
    const interval = now - this.lastFrame;
    this.lastFrame = now;
    this.frameAvg += (Math.min(100, interval) - this.frameAvg) * 0.05;
    if (f.beat !== 'none') {
      const t = now / 1000;
      if (this.lastBeatAt && t - this.lastBeatAt < 1.5) this.beatPeriod += (t - this.lastBeatAt - this.beatPeriod) * 0.3;
      this.lastBeatAt = t;
      this.beats++;
    }
    // Beats and bars must reach the show even on frames the cap skips.
    this.pendingBeat = f.beat === 'downbeat' || this.pendingBeat === 'downbeat' ? 'downbeat' : f.beat === 'beat' || this.pendingBeat === 'beat' ? 'beat' : 'none';
    if (this.g.fpsCap && now - this.lastRender < 1000 / this.g.fpsCap - 2) return;
    const dt = Math.min(0.1, (now - (this.lastRender || now)) / 1000) || 1 / 60;
    this.lastRender = now;
    this.adaptResolution(dt);
    const beat = this.pendingBeat;
    this.pendingBeat = 'none';
    const bands = this.meter.update(dt);
    const events = this.show.update({ dt, beat, intensity: f.intensity, bands, overdrive: f.overdrive });
    for (const e of events) {
      if (e.type === 'fireworks') this.fireworks(e.which);
      else this.co2(e.strength);
    }
    this.director.update(dt, beat === 'downbeat', this.show.state.level, f.barSeconds);
    this.applyShow(this.show.state, bands, dt);
    this.sparks.update(dt, -9);
    this.smoke.update(dt, 0.4);
    const pose = this.director.pose();
    this.camera.position.set(...pose.pos);
    this.camera.lookAt(...pose.target);
    const vfov = (2 * Math.atan(Math.tan((pose.hfov * Math.PI) / 360) / this.camera.aspect) * 180) / Math.PI;
    if (Math.abs(vfov - this.camera.fov) > 0.01) {
      this.camera.fov = vfov;
      this.camera.updateProjectionMatrix();
    }
    const scale = this.renderer.domElement.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.bulbMat.uniforms.uScale.value = scale;
    this.sparks.setScale(scale);
    this.smoke.setScale(scale);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    if (!this.shown) {
      this.shown = true;
      this.canvas.classList.add('on');
    }
  }

  private shown = false;

  private pendingBeat: StageFrame['beat'] = 'none';

  /** Dev diagnostics. */
  debugInfo() {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, cam: this.camera.position.toArray().map((v) => +v.toFixed(1)), fov: +this.camera.fov.toFixed(1), shot: this.director.shot.name, level: this.show.state.level, scale: this.dynScale, size: [this.renderer.domElement.width, this.renderer.domElement.height], children: this.scene.children.length };
  }

  dispose() {
    this.disposed = true;
    for (const o of this.owned) o.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  // ------------------------------------------------------------------ show → scene
  private applyShow(s: ShowState, bands: Readonly<BandLevels>, dt: number) {
    const t = s.time;
    const key = rgb(s.palette.key);
    const accent = rgb(s.palette.accent);
    const wash = rgb(s.palette.wash);
    // Beams
    for (const b of this.beams) {
      let pan = 0;
      let tilt = 0;
      let level = s.beamLevel;
      const i = b.index;
      switch (b.group) {
        case 'Sky':
          pan = Math.sin(t * 0.25 + i) * 0.18;
          tilt = Math.sin(t * 0.2 + i * 1.7) * 0.1;
          level *= 0.8;
          break;
        case 'Back':
          level = 0.35 + 0.35 * s.barPulse + 0.3 * bands.low;
          break;
        default:
          if (s.beamMode === 'sweep') {
            pan = Math.sin(t * 0.7 + i * 0.45) * 0.38;
            tilt = Math.sin(t * 0.5 + i) * 0.14;
          } else if (s.beamMode === 'fan') {
            const sgn = i % 2 ? 1 : -1;
            pan = sgn * (0.12 + 0.22 * Math.sin(t * 1.1)) * (1 + s.pulse * 0.4);
            tilt = Math.cos(t * 0.8) * 0.08;
          } else if (s.beamMode === 'chase') {
            level *= (this.beats + i) % 4 === 0 ? 1 : 0.15;
            pan = Math.sin(t * 0.4 + i) * 0.1;
          } else {
            tilt = Math.sin(t * 0.3 + i) * 0.03;
          }
          level *= 0.75 + 0.25 * s.pulse;
      }
      b.pivot.quaternion.copy(b.base).multiply(TMP_Q.setFromEuler(TMP_E.set(tilt, 0, pan)));
      const c = b.group === 'Back' ? TMP_C.copy(b.color).lerp(wash, 0.5) : i % 2 ? accent : key;
      b.mat.uniforms.uColor.value.copy(c);
      b.mat.uniforms.uIntensity.value = level * b.strength;
      b.flare.material.color.copy(c);
      b.flare.material.opacity = Math.min(1, level * 1.2);
    }
    for (const w of this.washes) {
      w.light.color.copy(w.cool ? TMP_C.setRGB(0.3, 0.65, 1).lerp(wash, 0.3) : wash);
      w.light.intensity = w.base * s.washLevel;
    }
    for (const gm of this.glowMats) {
      const k = gm.kind === 'window' ? 0.85 + 0.15 * bands.mid : gm.kind === 'bay' ? 0.8 + 0.4 * s.barPulse : gm.kind === 'lantern' ? 0.9 + 0.1 * Math.sin(t * 7.3) : s.bulbLevel;
      gm.mat.emissiveIntensity = gm.base * k;
    }
    const u = this.bulbMat.uniforms;
    u.uTime.value = t;
    u.uChase.value += dt * s.chase;
    u.uLevel.value = s.bulbLevel;
    for (const sc of this.screens) {
      sc.uniforms.uTime.value = t;
      sc.uniforms.uEnergy.value = bands.low;
      sc.uniforms.uPulse.value = s.pulse;
      sc.uniforms.uKey.value.copy(key);
      sc.uniforms.uWash.value.copy(wash);
    }
    for (const b of this.blinders) b.material.opacity = s.blinder;
    this.sky.uniforms.uTime.value = t;
    // The crowd jumps on the beat, harder when the music is busy.
    const sinceBeat = performance.now() / 1000 - this.lastBeatAt;
    this.crowdUniforms.uPhase.value = this.beats + Math.min(1, sinceBeat / Math.max(0.2, this.beatPeriod));
    this.crowdUniforms.uBounce.value = { calm: 0.25, groove: 0.6, peak: 1 }[s.level] * (1 + s.overdrive * 0.5);
    if (this.wheel) this.wheel.rotation.z -= dt * 0.08;
    if (this.armillary) this.armillary.rotation.y += dt * 0.12;
    for (const m of this.band) m.obj.position.y = m.y + Math.max(0, Math.sin((this.crowdUniforms.uPhase.value + m.seed) * Math.PI)) * 0.12;
  }

  private adaptResolution(dt: number) {
    this.sinceResize += dt;
    if (!this.g.dynamicResolution || this.sinceResize < 1.5) return;
    // Aim for the display's refresh (or the cap); the highway shares the GPU, so leave headroom.
    const budget = this.g.fpsCap ? 1000 / this.g.fpsCap : 1000 / 60;
    let next = this.dynScale;
    if (this.frameAvg > budget * 1.15) next = Math.max(0.5, this.dynScale - 0.1);
    else if (this.frameAvg < budget * 1.02 && this.dynScale < 1) next = Math.min(1, this.dynScale + 0.05);
    if (next !== this.dynScale) {
      this.dynScale = next;
      this.sinceResize = 0;
      this.resize();
    }
  }

  // ------------------------------------------------------------------ effects
  private fireworks(which: 'all' | 'center' | 'sides') {
    const perRay = SPARKS_PER_RAY[this.g.effects];
    if (!perRay) return;
    for (const f of this.data.fireworks) {
      const x = Math.abs(f.origin[0]);
      if (which === 'center' && x > 25) continue;
      if (which === 'sides' && x < 40) continue;
      const o = new THREE.Vector3(...f.origin);
      const gold = f.gold ? [1, 0.68, 0.32] : [1, 0.93, 0.82];
      this.sparks.spawn(o, ZERO, [1, 0.9, 0.7], 9, 0.35, 0, 0);
      for (let k = 0; k < f.n; k++) {
        const ang = ((-f.spread + (2 * f.spread * k) / Math.max(1, f.n - 1) + (Math.random() - 0.5) * 8 + f.lean) * Math.PI) / 180;
        const dir = new THREE.Vector3(Math.sin(ang), Math.cos(ang), 0.25).normalize();
        const len = f.length[0] + Math.random() * (f.length[1] - f.length[0]);
        for (let j = 0; j < perRay; j++) {
          const speed = (len / 1.3) * (0.25 + 0.85 * (j / perRay)) * (0.95 + Math.random() * 0.1);
          this.sparks.spawn(o, dir.clone().multiplyScalar(speed), gold, 0.55 + Math.random() * 0.35, 1.6 + Math.random() * 0.9, 0.9, 0);
        }
      }
    }
  }

  private co2(strength: number) {
    const per = Math.round(strength * { off: 0, low: 6, medium: 14, high: 24 }[this.g.effects]);
    for (const c of this.data.co2) {
      const o = new THREE.Vector3(...c);
      for (let k = 0; k < per; k++) {
        const v = new THREE.Vector3((Math.random() - 0.5) * 2.2, 9 + Math.random() * 7, (Math.random() - 0.5) * 2.2 + 0.8);
        this.smoke.spawn(o, v, [0.85, 0.87, 0.95], 1.5 + Math.random() * 1.5, 2.2 + Math.random() * 1.3, 1.6, 4.0, 0.18);
      }
    }
  }

  // ------------------------------------------------------------------ building
  private buildComposer() {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.32, 0.35, 1.6));
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  private buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vDir;
        float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main() {
          float h = vDir.y;
          vec3 col = mix(vec3(0.03, 0.04, 0.1), vec3(0.002, 0.003, 0.012), smoothstep(0.0, 0.45, h));
          vec3 d = vDir * 260.0;
          float r = hash(floor(d));
          if (r > 0.986 && h > 0.06) {
            float s = smoothstep(0.12, 0.0, length(fract(d) - 0.5));
            col += s * (0.45 + 0.35 * sin(uTime * 1.7 + r * 60.0));
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.scene.add(sky);
    this.owned.push(sky.geometry, mat);
    return mat;
  }

  private buildStage(source: THREE.Group) {
    const root = source.clone(true);
    // Materials are cloned per stage so two stages (menu and game) can light them differently.
    const cloned = new Map<THREE.Material, THREE.Material>();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const swap = (m: THREE.Material) => {
        let c = cloned.get(m);
        if (!c) {
          c = m.clone();
          cloned.set(m, c);
          this.owned.push(c);
        }
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
    for (const m of cloned.values()) {
      const sm = m as THREE.MeshStandardMaterial;
      if (!sm.isMeshStandardMaterial) continue;
      const kind = /^Win/.test(sm.name) ? 'window' : /^Bay/.test(sm.name) ? 'bay' : /^Lantern/.test(sm.name) ? 'lantern' : /^Bulbs/.test(sm.name) ? 'bulb' : null;
      // Emissive strengths come from the offline render; real time needs them gentler.
      if (kind) this.glowMats.push({ mat: sm, base: sm.emissiveIntensity * (kind === 'lantern' ? 0.12 : kind === 'window' ? 0.7 : 0.6), kind });
    }
    const variants = new Map<string, THREE.Object3D>();
    for (const name of [...this.data.crowd.variants, ...this.data.trees.variants]) {
      const v = root.getObjectByName(name);
      if (v) {
        variants.set(name, v);
        v.removeFromParent();
      }
    }
    // Screens get live content.
    for (const name of ['GateScreen', 'SunFace']) {
      const mesh = root.getObjectByName(name) as THREE.Mesh | undefined;
      if (mesh?.isMesh) mesh.material = this.screenMaterial(mesh.geometry, name === 'SunFace');
    }
    // The wheel turns, the armillary spins, the band moves.
    const pivotAt = (p: [number, number, number], names: string[]) => {
      const pivot = new THREE.Object3D();
      pivot.position.set(...p);
      root.add(pivot);
      pivot.updateMatrixWorld();
      for (const n of names) {
        const o = root.getObjectByName(n);
        if (o) pivot.attach(o);
      }
      return pivot;
    };
    this.wheel = pivotAt(this.data.wheel, ['Wheel', 'WheelCars', 'WheelBulbs']);
    this.armillary = pivotAt(this.data.armillary, ['Armillary', 'ArmillaryLights']);
    root.traverse((o) => {
      if (o.name.startsWith('Band_')) this.band.push({ obj: o, y: o.position.y, seed: Math.random() * 2 });
    });
    this.scene.add(root);
    this.scene.add(new THREE.HemisphereLight(0x2a3870, 0x3a2414, 0.5));
    this.scene.add(new THREE.AmbientLight(0x1a1420, 0.3));

    const crowdShare = LEVEL_SHARE[this.g.crowd];
    this.instance(this.data.crowd, crowdShare, variants, true);
    this.instance(this.data.trees, Math.max(0.35, crowdShare), variants, false);

    // Blinders at the stage front.
    const tex = glowTexture();
    this.owned.push(tex);
    for (const gl of this.data.glows.filter((x) => x.group === 'Blinder')) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xfff0d8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.position.set(...gl.pos);
      sp.scale.setScalar(9);
      this.blinders.push(sp);
      this.scene.add(sp);
      this.owned.push(sp.material);
    }
  }

  /** Instances a scatter (crowd or trees) per variant mesh, thinned to `share`. */
  private instance(sc: Scatter, share: number, variants: Map<string, THREE.Object3D>, crowd: boolean) {
    if (share <= 0) return;
    const n = sc.points.length / 5;
    const nv = sc.variants.length;
    const buckets: number[][] = sc.variants.map(() => []);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += share;
      if (acc < 1) continue;
      acc -= 1;
      buckets[(i * 2654435761) % nv >>> 0].push(i);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const local = new THREE.Matrix4();
    const cloth = [0x15151a, 0x3a3a44, 0x6a1820, 0x1a2a66, 0x8a8a90, 0x24402a, 0x7a5420, 0x5a2a6a].map((c) => new THREE.Color(c));
    sc.variants.forEach((name, vi) => {
      const node = variants.get(name);
      const idx = buckets[vi];
      if (!node || !idx.length) return;
      node.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      node.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
      for (const mesh of meshes) {
        let mat = mesh.material as THREE.MeshStandardMaterial;
        if (crowd) mat = this.crowdMaterial(mat);
        const im = new THREE.InstancedMesh(mesh.geometry, mat, idx.length);
        local.copy(mesh.matrixWorld);
        const tint = crowd && /Cloth/.test(mat.name);
        idx.forEach((p, k) => {
          const o = p * 5;
          pos.set(sc.points[o], sc.points[o + 1], sc.points[o + 2]);
          q.setFromAxisAngle(UP, sc.points[o + 3]);
          scl.setScalar(sc.points[o + 4]);
          m.compose(pos, q, scl).multiply(local);
          im.setMatrixAt(k, m);
          if (tint) im.setColorAt(k, cloth[(p * 7919) % cloth.length]);
        });
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        this.scene.add(im);
        this.owned.push({ dispose: () => im.dispose() });
      }
    });
  }

  /** Crowd materials bounce their instances on the beat (in the vertex shader, no per-frame CPU). */
  private crowdMaterial(src: THREE.MeshStandardMaterial) {
    const mat = src.clone();
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.crowdUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uPhase;\nuniform float uBounce;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float hr = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
            float jump = max(0.0, sin((uPhase + hr * 0.35) * 3.14159265));
            transformed.y += jump * uBounce * (0.12 + 0.2 * hr);
          #endif`,
        );
    };
    this.owned.push(mat);
    return mat;
  }

  private screenMaterial(geo: THREE.BufferGeometry, sun: boolean) {
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const size = bb.getSize(new THREE.Vector3());
    // A screen is flat; its two largest extents span the image.
    const axes = [size.x, size.y, size.z];
    const thin = axes.indexOf(Math.min(...axes));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uPulse: { value: 0 },
        uKey: { value: new THREE.Color(1, 0.75, 0.4) },
        uWash: { value: new THREE.Color(0.1, 0.3, 1) },
        uMin: { value: bb.min.clone() },
        uSize: { value: size.clone().max(new THREE.Vector3(1e-3, 1e-3, 1e-3)) },
        uThin: { value: thin },
        uSun: { value: sun ? 1 : 0 },
        uAspect: { value: thin === 0 ? size.z / size.y : size.x / size.y },
      },
      vertexShader: /* glsl */ `
        uniform vec3 uMin; uniform vec3 uSize; uniform int uThin;
        varying vec2 vUv;
        void main() {
          vec3 l = (position - uMin) / uSize;
          vUv = uThin == 0 ? vec2(1.0 - l.z, l.y) : vec2(l.x, l.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uEnergy; uniform float uPulse; uniform float uSun; uniform float uAspect;
        uniform vec3 uKey; uniform vec3 uWash;
        varying vec2 vUv;
        void main() {
          vec2 p = vUv - vec2(0.5, uSun > 0.5 ? 0.5 : 0.42);
          p.x *= uSun > 0.5 ? 1.0 : uAspect;
          float r = length(p);
          float a = atan(p.y, p.x) + uTime * (uSun > 0.5 ? 0.15 : 0.08);
          float rays = pow(abs(sin(a * (uSun > 0.5 ? 9.0 : 14.0))), 6.0);
          float rings = pow(abs(sin(r * 26.0 - uTime * 1.6 - uEnergy * 2.0)), 10.0);
          float core = pow(max(0.0, 1.0 - r * 2.4), 2.0) * (1.0 + uPulse);
          float v = (rays * 0.7 + rings * 0.5) * max(0.15, 1.0 - r * 0.9) + core;
          vec3 base = uSun > 0.5 ? vec3(0.9, 0.35, 0.05) : uWash * 0.25;
          vec3 col = mix(base, uKey, clamp(v, 0.0, 1.0)) + vec3(1.0, 0.95, 0.85) * max(0.0, v - 1.0);
          // LED pixel grid
          vec2 g = fract(vUv * vec2(140.0 * uAspect, 140.0));
          col *= 0.55 + 0.45 * step(0.12, g.x) * step(0.12, g.y);
          gl_FragColor = vec4(col * (uSun > 0.5 ? 1.6 : 0.9), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.screens.push(mat);
    this.owned.push(mat);
    return mat;
  }

  private buildBulbs() {
    // Bulbs are cheap point sprites: even the lowest setting keeps half of them.
    const share = Math.max(0.5, LEVEL_SHARE[this.g.lights]);
    const b = this.data.bulbs;
    const pos: number[] = [];
    const seed: number[] = [];
    let acc = 0;
    for (let i = 0; i < b.length; i += 4) {
      acc += share;
      if (acc < 1) continue;
      acc -= 1;
      pos.push(b[i], b[i + 1], b[i + 2]);
      seed.push(b[i + 3], Math.random());
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 2));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 800 }, uTime: { value: 0 }, uChase: { value: 0 }, uLevel: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uScale; uniform float uChase; uniform float uLevel;
        attribute vec2 seed;
        varying float vB;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float wave = 0.5 + 0.5 * sin(dot(position, vec3(0.35, 0.22, 0.1)) - uChase * 6.2831853);
          vB = uLevel * (0.55 + 0.45 * wave) * (0.85 + 0.3 * seed.y);
          gl_PointSize = max(1.5, (seed.x * 5.0 + 0.3) * uScale / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vB;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float core = smoothstep(0.22, 0.0, d);
          float halo = smoothstep(0.5, 0.0, d) * 0.35;
          vec3 c = vec3(1.0, 0.72, 0.4) * (core * 1.8 + halo * 0.6) * vB;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
    this.owned.push(geo, mat);
    return mat;
  }

  private buildBeams() {
    const share = BEAM_SHARE[this.g.beams];
    if (!share) return;
    const geo = new THREE.CylinderGeometry(0.06, 1, 1, 28, 1, true);
    geo.translate(0, -0.5, 0);
    const tex = glowTexture();
    this.owned.push(geo, tex);
    const lengths: Record<string, number> = { Sky: 170, Back: 75, GateHead: 95, TrussHead: 85 };
    const strengths: Record<string, number> = { Sky: 0.75, Back: 0.28, GateHead: 0.7, TrussHead: 0.6 };
    let acc = 0;
    this.data.beams.forEach((spec: LightSpec) => {
      acc += share;
      if (acc < 1) return;
      acc -= 1;
      const len = lengths[spec.group] ?? 90;
      const half = (((spec.angle ?? 3) * (spec.group === 'Back' ? 0.9 : 1.9)) / 2) * (Math.PI / 180);
      const radius = Math.max(0.6, Math.tan(half) * len);
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color(...spec.color) }, uIntensity: { value: 0.5 } },
        vertexShader: /* glsl */ `
          varying float vAlong; varying vec3 vN; varying vec3 vV;
          void main() {
            vAlong = -position.y;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vV = -mv.xyz;
            vN = normalMatrix * normal;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uIntensity;
          varying float vAlong; varying vec3 vN; varying vec3 vV;
          void main() {
            float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
            float along = pow(1.0 - clamp(vAlong, 0.0, 1.0), 1.5);
            gl_FragColor = vec4(uColor * uIntensity * edge * along * 0.55, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.set(radius, len, radius);
      mesh.frustumCulled = false;
      const pivot = new THREE.Object3D();
      pivot.position.set(...spec.pos);
      const base = new THREE.Quaternion().setFromUnitVectors(DOWN, new THREE.Vector3(...spec.dir).normalize());
      pivot.quaternion.copy(base);
      pivot.add(mesh);
      const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      flare.position.set(...spec.pos);
      flare.scale.setScalar(spec.group === 'Back' ? 0.1 : 2.4);
      this.scene.add(pivot, flare);
      this.owned.push(mat, flare.material);
      this.beams.push({ pivot, mat, flare, base, group: spec.group, index: this.beams.length, strength: strengths[spec.group] ?? 0.6, color: new THREE.Color(...spec.color) });
    });
  }

  private buildWashes() {
    const n = WASHES[this.g.lights];
    const list = this.data.washes.filter((w) => w.group === 'Wash' || w.group === 'WashCool');
    const pick = pickWashes(list, n);
    const boost = list.length / Math.max(1, pick.length);
    for (const w of pick) {
      const light = new THREE.SpotLight(new THREE.Color(...w.color), 0, 0, (((w.angle ?? 16) / 2) * Math.PI) / 180 * 1.15, 0.7, 2);
      light.position.set(...w.pos);
      light.target.position.set(w.pos[0] + w.dir[0] * 100, w.pos[1] + w.dir[1] * 100, w.pos[2] + w.dir[2] * 100);
      this.scene.add(light, light.target);
      this.washes.push({ light, base: w.energy * WATT_TO_CD * Math.min(2.2, Math.sqrt(boost)), cool: w.group === 'WashCool' });
    }
  }
}

/**
 * The washes to keep when the light budget allows `n`: warm ones from the middle outward, with a
 * cool one every third pick (and the rest of the cool ones once the warm run out).
 */
export function pickWashes(list: LightSpec[], n: number): LightSpec[] {
  const warm = list.filter((w) => w.group === 'Wash');
  const cool = list.filter((w) => w.group === 'WashCool');
  const pick: LightSpec[] = [];
  while (pick.length < n && (warm.length || cool.length)) {
    const coolTurn = cool.length > 0 && (!warm.length || pick.length % 3 === 2);
    pick.push(coolTurn ? cool.shift()! : warm.splice(Math.floor(warm.length / 2), 1)[0]);
  }
  return pick;
}

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const ZERO = new THREE.Vector3();
const TMP_Q = new THREE.Quaternion();
const TMP_E = new THREE.Euler();
const TMP_C = new THREE.Color();
const rgb = (c: Rgb) => new THREE.Color(c[0], c[1], c[2]);

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
