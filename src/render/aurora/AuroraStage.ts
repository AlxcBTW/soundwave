import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BandMeter, type BandLevels } from '../../audio/bands';
import type { Part } from '../../chart/types';
import { LEVEL_SHARE, type GraphicsSettings } from '../../game/graphics';
import { Director, buildShots } from '../stage/Director';
import { LightShow, PALETTES, type Rgb, type ShowState } from '../stage/LightShow';
import type { StageFrame } from '../stage/Stage3D';
import { loadVenue, type VenueAssets, type VenueData } from './assets';
import { Beams } from './beams';
import { Figures, makeBand, makeCrowd } from './figures';
import { applyVenueMaterials } from './materials';
import { shared } from './shared';
import { buildSky } from './sky';

export interface AuroraOptions {
  mode: 'play' | 'menu';
  part?: Part;
}

/** The looks the show moves through; they stand in for the light show's own palettes one to one. */
const LOOKS: { key: Rgb; accent: Rgb; wash: Rgb }[] = [
  { key: [1, 0.4, 0.76], accent: [0.42, 0.9, 1], wash: [0.3, 0.2, 1] },
  { key: [0.4, 0.84, 1], accent: [0.92, 0.95, 1], wash: [0.08, 0.3, 1] },
  { key: [1, 0.3, 0.6], accent: [0.76, 0.52, 1], wash: [0.72, 0.15, 0.72] },
  { key: [0.62, 0.56, 1], accent: [1, 0.6, 0.86], wash: [0.08, 0.5, 0.78] },
];
const EXPOSURE = 1.0;

/**
 * The Moonrise venue in real time: painted forms, a polished deck, screens, haze, a clouded night
 * sky, moving beams with star flares, a band and a crowd that move with the beat. Same contract as
 * the first 3D stage, so the game and the menus can drive either.
 */
export class AuroraStage {
  static async create(host: HTMLElement, g: GraphicsSettings, opts: AuroraOptions): Promise<AuroraStage> {
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
  private readonly figures: Figures;
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

  private constructor(private readonly canvas: HTMLCanvasElement, assets: VenueAssets, private g: GraphicsSettings, opts: AuroraOptions) {
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
    this.owned.push(...applyVenueMaterials(venue, this.data.deck));
    this.scene.add(venue);

    this.figures = new Figures(assets.figures, assets.figureData, assets.anim);
    const clear = [this.data.cameras.crowd?.pos, this.data.cameras.close?.pos].filter((p): p is [number, number, number] => !!p);
    this.figures.add(makeCrowd(this.data, assets.figureData.crowd, LEVEL_SHARE[g.crowd], clear));
    this.figures.add(makeBand(this.data, assets.figureData.band));
    this.scene.add(this.figures.group);
    this.owned.push(this.figures);

    this.beams = new Beams(g.beams === 'off' ? [] : this.data.fixtures);
    this.scene.add(this.beams.group);
    this.owned.push(this.beams);

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
    this.show.update({ dt, beat, intensity: f.intensity, bands, overdrive: f.overdrive });
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
    this.beams.update(this.camera, this.renderer.domElement.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360)));
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    if (!this.shown) {
      this.shown = true;
      this.canvas.classList.add('on');
    }
  }

  /** Dev diagnostics. */
  debugInfo() {
    return { frameMs: +this.frameAvg.toFixed(1), people: this.figures.count, peopleTriangles: Math.round(this.figures.triangles), shot: this.director.shot.name, level: this.show.state.level, scale: this.dynScale, size: [this.renderer.domElement.width, this.renderer.domElement.height] };
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
    shared.uScreenLevel.value = 0.75 + 0.2 * s.washLevel + 0.25 * s.barPulse;
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
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.4, 0.6, 0.9));
    composer.addPass(new OutputPass());
    this.composer = composer;
  }
}

const TMP_C = new THREE.Color();
