import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BandMeter, type BandLevels } from '../../audio/bands';
import type { Part } from '../../chart/types';
import { LEVEL_SHARE, type GraphicsSettings, type Level } from '../../game/graphics';
import { Director, buildShots } from '../stage/Director';
import { LightShow, PALETTES, type Rgb, type ShowState } from '../stage/LightShow';
import { Particles } from '../stage/Particles';
import { loadVenue, type VenueAssets, type VenueData } from './assets';
import { Beams } from './beams';
import { Figures, makeBand, makeCrowd } from './figures';
import { applyVenueMaterials } from './materials';
import { shared } from './shared';
import { buildSky } from './sky';

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

/** Share of the moving heads lit, and particle budgets, per level. */
const BEAM_SHARE: Record<Level, number> = { off: 0, low: 0.34, medium: 0.67, high: 1 };
const SPARKS: Record<Level, number> = { off: 0, low: 1500, medium: 4000, high: 9000 };
const SPARKS_PER_RAY: Record<Level, number> = { off: 0, low: 6, medium: 12, high: 22 };
const SMOKE: Record<Level, number> = { off: 0, low: 250, medium: 700, high: 1400 };
const CO2_PER_JET: Record<Level, number> = { off: 0, low: 6, medium: 14, high: 24 };
/** Camera spots the director adds itself (see buildShots), for placing detailed crowd figures. */
const EXTRA_CAMERAS: [number, number, number][] = [[-62, 7, 48], [62, 7, 48], [0, 1.6, 26], [-8, 7, 26], [8, 7, 26], [0, 7, 27]];

/** The looks the show moves through; they stand in for the light show's own palettes one to one. */
const LOOKS: { key: Rgb; accent: Rgb; wash: Rgb }[] = [
  { key: [1, 0.4, 0.76], accent: [0.42, 0.9, 1], wash: [0.3, 0.2, 1] },
  { key: [0.4, 0.84, 1], accent: [0.92, 0.95, 1], wash: [0.08, 0.3, 1] },
  { key: [1, 0.3, 0.6], accent: [0.76, 0.52, 1], wash: [0.72, 0.15, 0.72] },
  { key: [0.62, 0.56, 1], accent: [1, 0.6, 0.86], wash: [0.08, 0.5, 0.78] },
];
const EXPOSURE = 0.86;

/**
 * The Moonrise venue in real time: painted forms, a polished deck, screens, haze, a clouded night
 * sky, moving beams with star flares, a band and a crowd that move with the beat. Same contract as
 * the first 3D stage, so the game and the menus can drive either.
 */
export class AuroraStage {
  static async create(host: HTMLElement, g: GraphicsSettings, opts: StageOptions): Promise<AuroraStage> {
    const canvas = document.createElement('canvas');
    canvas.className = 'stage3d';
    host.appendChild(canvas);
    try {
      return new AuroraStage(canvas, await loadVenue(), g, opts);
    } catch (err) {
      canvas.remove();
      throw err;
    }
  }

  readonly meter = new BandMeter();
  readonly director: Director;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.3, 4000);
  private composer: EffectComposer | null = null;
  private readonly show: LightShow;
  private readonly beams: Beams;
  private readonly crowd: Figures;
  private readonly band: Figures;
  private readonly sparks: Particles;
  private readonly smoke: Particles;
  private readonly data: VenueData;
  private readonly owned: { dispose(): void }[] = [];
  private readonly key = new THREE.Color();
  private readonly accent = new THREE.Color();
  private readonly wash = new THREE.Color();
  private lastFrame = performance.now();
  private lastRender = 0;
  private frameAvg = 16;
  private dynScale = 1;
  private sinceResize = 0;
  private beatPeriod = 0.5;
  private lastBeatAt = 0;
  private beats = 0;
  private energy = 0.3;
  private pendingBeat: StageFrame['beat'] = 'none';
  private shown = false;
  private disposed = false;

  private constructor(private readonly canvas: HTMLCanvasElement, assets: VenueAssets, private g: GraphicsSettings, opts: StageOptions) {
    this.data = assets.data;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: g.antialias, powerPreference: 'high-performance', alpha: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = EXPOSURE;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const menu = opts.mode === 'menu';
    this.show = new LightShow(menu);
    this.director = new Director(buildShots(this.data.cameras, this.data.band, opts.part), menu ? 'calm' : g.camera, 7, menu);

    const moon = this.data.moon;
    shared.uGlowPos.value.set(...moon.center);
    shared.uMoon.value.set(moon.center[0], moon.center[1], moon.center[2], moon.radius);

    const sky = buildSky();
    this.scene.add(sky);
    this.owned.push(sky.geometry, sky.material);

    const venue = assets.scene.clone(true);
    this.owned.push(...applyVenueMaterials(venue, this.data.deck, g.lights === 'medium' || g.lights === 'high'));
    this.scene.add(venue);

    this.crowd = new Figures(assets.crowd);
    const low = [...Object.values(this.data.cameras).map((c) => c.pos).filter((p) => p[1] < 10), ...EXTRA_CAMERAS];
    this.crowd.add(makeCrowd(this.data, this.crowd.characters, LEVEL_SHARE[g.crowd], low, assets.crowd.data.sync));
    this.band = new Figures(assets.band);
    this.band.add(makeBand(this.data, assets.band.data.band ?? {}));
    this.scene.add(this.crowd.group, this.band.group);
    this.owned.push(this.crowd, this.band);

    // Lighter settings keep an even share of the moving heads.
    const share = BEAM_SHARE[g.beams];
    this.beams = new Beams(this.data.fixtures.filter((_, i) => Math.floor((i + 1) * share) > Math.floor(i * share)));
    this.scene.add(this.beams.group);
    this.owned.push(this.beams);

    this.sparks = new Particles(SPARKS[g.effects] || 1, THREE.AdditiveBlending);
    this.smoke = new Particles(SMOKE[g.effects] || 1, THREE.NormalBlending);
    this.scene.add(this.sparks.points, this.smoke.points);
    this.owned.push(this.sparks, this.smoke);

    this.setLook(LOOKS[0], 1);
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
    this.frameAvg += (Math.min(100, now - this.lastFrame) - this.frameAvg) * 0.05;
    this.lastFrame = now;
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
    for (const e of this.show.update({ dt, beat, intensity: f.intensity, bands, overdrive: f.overdrive })) {
      if (e.type === 'fireworks') this.fireworks(e.which);
      else this.co2(e.strength);
    }
    this.sparks.update(dt, -9);
    this.smoke.update(dt, 0.4);
    this.director.update(dt, beat === 'downbeat', this.show.state.level, f.barSeconds);
    this.energy += (f.intensity - this.energy) * Math.min(1, dt * 1.2);
    this.applyShow(this.show.state, bands, dt);

    const pose = this.director.pose();
    this.camera.position.set(...pose.pos);
    this.camera.lookAt(...pose.target);
    const vfov = (2 * Math.atan(Math.tan((pose.hfov * Math.PI) / 360) / this.camera.aspect) * 180) / Math.PI;
    if (Math.abs(vfov - this.camera.fov) > 0.01) {
      this.camera.fov = vfov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
    const scale = this.renderer.domElement.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.beams.update(this.camera, scale);
    this.sparks.setScale(scale);
    this.smoke.setScale(scale);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    if (!this.shown) {
      this.shown = true;
      this.canvas.classList.add('on');
    }
  }

  /** Dev diagnostics. */
  debugInfo() {
    return { frameMs: +this.frameAvg.toFixed(1), people: this.crowd.count, peopleTriangles: Math.round(this.crowd.triangles + this.band.triangles), shot: this.director.shot.name, level: this.show.state.level, scale: this.dynScale, size: [this.renderer.domElement.width, this.renderer.domElement.height] };
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
  private setLook(look: { key: Rgb; accent: Rgb; wash: Rgb }, k: number) {
    this.key.lerp(TMP_C.setRGB(...look.key), k);
    this.accent.lerp(TMP_C.setRGB(...look.accent), k);
    this.wash.lerp(TMP_C.setRGB(...look.wash), k);
  }

  private applyShow(s: ShowState, bands: Readonly<BandLevels>, dt: number) {
    const t = s.time;
    const index = PALETTES.indexOf(s.palette);
    // Overdrive hands over a rainbow palette of its own: take its colours as they are.
    this.setLook(index >= 0 ? LOOKS[index] : { key: s.palette.key, accent: LOOKS[0].accent, wash: s.palette.wash }, Math.min(1, dt * 2.5));
    const sinceBeat = performance.now() / 1000 - this.lastBeatAt;
    shared.uTime.value = t;
    shared.uBeat.value = this.beats + Math.min(1, sinceBeat / Math.max(0.2, this.beatPeriod));
    shared.uPulse.value = s.pulse;
    shared.uBarPulse.value = s.barPulse;
    shared.uEnergy.value = Math.min(1, this.energy + 0.4 * s.overdrive);
    shared.uLow.value = bands.low;
    shared.uKey.value.copy(this.key);
    shared.uAccent.value.copy(this.accent);
    shared.uWash.value.copy(this.wash);
    shared.uScreenLevel.value = 0.62 + 0.16 * s.washLevel + 0.18 * s.barPulse;
    shared.uHazeNear.value.setRGB(0.03, 0.035, 0.15).lerp(this.wash, 0.14).multiplyScalar(0.6 + 0.35 * s.beamLevel);

    for (let i = 0; i < this.beams.states.length; i++) {
      const b = this.beams.states[i];
      const group = this.beams.fixtures[i].group;
      let level = s.beamLevel;
      b.pan = 0;
      b.tilt = 0;
      switch (group) {
        case 'Sky':
          b.pan = Math.sin(t * 0.22 + i) * 0.16;
          b.tilt = Math.sin(t * 0.17 + i * 1.7) * 0.1;
          level *= i % 2 ? 0.7 : 0;
          break;
        case 'Ribbon':
          // Glints along the ribbon: lenses without a beam worth the name.
          level *= 0.12;
          break;
        case 'Truss':
          level = 0.25 + 0.2 * s.barPulse;
          break;
        case 'Halo':
          // The ring over the band breathes with the bar and opens on the beat.
          b.tilt = 0.12 * s.pulse + Math.sin(t * 0.4 + i) * 0.05;
          level *= 0.3 + 0.35 * s.barPulse;
          break;
        case 'Delay':
        case 'Foh':
          level = 0.14;
          break;
        case 'Floor':
          b.pan = Math.sin(t * 0.5 + i * 0.6) * 0.25;
          level *= 0.35 + 0.4 * s.pulse;
          break;
        default:
          if (s.beamMode === 'sweep') {
            b.pan = Math.sin(t * 0.6 + i * 0.45) * 0.36;
            b.tilt = Math.sin(t * 0.45 + i) * 0.14;
          } else if (s.beamMode === 'fan') {
            b.pan = (i % 2 ? 1 : -1) * (0.1 + 0.22 * Math.sin(t * 1.0)) * (1 + s.pulse * 0.4);
            b.tilt = Math.cos(t * 0.8) * 0.08;
          } else if (s.beamMode === 'chase') {
            level *= (this.beats + i) % 4 === 0 ? 1 : 0.12;
            b.pan = Math.sin(t * 0.4 + i) * 0.1;
          } else {
            b.tilt = Math.sin(t * 0.3 + i) * 0.04;
          }
          level *= 0.7 + 0.3 * s.pulse;
      }
      b.color.copy(group === 'Sky' || i % 3 === 0 ? this.accent : this.key);
      b.level = level * (i % 2 ? 1 : 0.55);
    }
  }

  // ------------------------------------------------------------------ effects
  private fireworks(which: 'all' | 'center' | 'sides') {
    const perRay = SPARKS_PER_RAY[this.g.effects];
    if (!perRay) return;
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    this.data.fireworks.forEach((f, index) => {
      const x = Math.abs(f.origin[0]);
      if (which === 'center' && x > 35) return;
      if (which === 'sides' && x < 40) return;
      origin.set(...f.origin);
      const c = (index % 2 ? this.accent : this.key).clone().lerp(WHITE, 0.45);
      this.sparks.spawn(origin, ZERO, [1, 0.95, 1], 9, 0.35, 0, 0);
      for (let k = 0; k < f.n; k++) {
        const ang = ((-f.spread + (2 * f.spread * k) / Math.max(1, f.n - 1) + (Math.random() - 0.5) * 8 + f.lean) * Math.PI) / 180;
        dir.set(Math.sin(ang), Math.cos(ang), 0.25).normalize();
        const len = f.length[0] + Math.random() * (f.length[1] - f.length[0]);
        for (let j = 0; j < perRay; j++) {
          const speed = (len / 1.3) * (0.25 + 0.85 * (j / perRay)) * (0.95 + Math.random() * 0.1);
          this.sparks.spawn(origin, TMP_V.copy(dir).multiplyScalar(speed), [c.r, c.g, c.b], 0.55 + Math.random() * 0.35, 1.6 + Math.random() * 0.9, 0.9, 0);
        }
      }
    });
  }

  private co2(strength: number) {
    const per = Math.round(strength * CO2_PER_JET[this.g.effects]);
    const origin = new THREE.Vector3();
    const tint = this.wash.clone().lerp(WHITE, 0.75);
    for (const c of this.data.co2) {
      origin.set(...c);
      for (let k = 0; k < per; k++) {
        TMP_V.set((Math.random() - 0.5) * 2.2, 9 + Math.random() * 7, (Math.random() - 0.5) * 2.2 + 0.8);
        this.smoke.spawn(origin, TMP_V, [tint.r * 0.8, tint.g * 0.8, tint.b * 0.85], 1.5 + Math.random() * 1.5, 2.2 + Math.random() * 1.3, 1.6, 4.0, 0.16);
      }
    }
  }

  private adaptResolution(dt: number) {
    this.sinceResize += dt;
    if (!this.g.dynamicResolution || this.sinceResize < 1.5) return;
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

  private buildComposer() {
    // The composer renders into its own buffer; give it MSAA so edges stay smooth with glow on.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.g.antialias ? 4 : 0 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.2, 0.45, 1.0));
    composer.addPass(new OutputPass());
    this.composer = composer;
  }
}

const TMP_C = new THREE.Color();
const TMP_V = new THREE.Vector3();
const ZERO = new THREE.Vector3();
const WHITE = new THREE.Color(1, 1, 1);
