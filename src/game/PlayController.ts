import type { Chart } from '../chart/types';
import { AudioEngine } from '../audio/AudioEngine';
import { Background2D } from '../render/Background2D';
import { Highway } from '../render/Highway';
import { AuroraStage } from '../render/aurora/AuroraStage';
import { barAt, barIntensity } from '../render/stage/LightShow';
import { resolveGraphics } from './graphics';
import { GameSession, type Results } from './GameSession';
import { Rumbler } from '../input/rumble';
import { barsLeft, findBreaks, type Break } from './breaks';
import { GamepadInput, KeyboardInput, TouchInput, type InputHandlers } from './input';
import { MAX_MULTIPLIER, multiplierFor, STREAK_PER_MULTIPLIER } from './scoring';
import type { Settings } from './settings';

export interface HudRefs {
  score: HTMLElement;
  multiplier: HTMLElement;
  stars: HTMLElement;
  progress: HTMLElement;
  feedback: HTMLElement;
  root: HTMLElement;
  /** One label per lane, positioned under its strike pad. */
  keys: HTMLElement[];
  /** The layer that takes touches for the lanes. */
  touchLayer: HTMLElement;
  /** The overdrive meter, which is also the button that starts overdrive. */
  overdriveButton: HTMLElement;
  /** Countdown shown during long breaks: the root, its number and its ring. */
  breakTimer: HTMLElement;
  breakNumber: HTMLElement;
  breakRing: SVGCircleElement;
}

export type PlayPhase = 'countdown' | 'playing' | 'paused' | 'finished';

const LEAD_IN = 3;

/**
 * Drives one play-through: audio, input, session and both renderers. Lives outside React
 * so the frame loop never triggers re-renders; React only sees phase changes and results.
 */
export class PlayController {
  readonly session: GameSession;
  private readonly highway: Highway;
  private readonly background: Background2D;
  /** The 3D stage, once loaded (the 2D backdrop runs until then, or instead when it is off). */
  private stage: AuroraStage | null = null;
  private readonly barLevels: number[];
  private readonly input: KeyboardInput;
  private readonly padInput: GamepadInput;
  private readonly touchInput: TouchInput;
  private readonly observer: ResizeObserver;
  private readonly rumble: Rumbler;
  private raf = 0;
  private phase: PlayPhase = 'countdown';
  private lastBeat = -1;
  private beatPulse = 0;
  private hudCache = { score: -1, mult: -1, streak: -1, od: -1, stars: -1, starP: -1, odActive: false, breakSec: -1 };
  private readonly breaks: Break[];
  /** A beat fell in the frame being drawn, and how much bass there is right now (0..1). */
  private beatNow = false;
  private bassNow = 0;
  private readonly barTimes: number[];
  private feedbackTimer = 0;
  private disposed = false;
  private lastCount = -1;
  private readonly downbeats: Set<number>;
  /** Overdrive meter when overdrive was activated, for the progressive rumble. */
  private odMeterAtStart = 1;

  onPhase: (p: PlayPhase, countdown?: number) => void = () => {};
  onFinish: (r: Results) => void = () => {};

  constructor(
    private readonly engine: AudioEngine,
    buffer: AudioBuffer,
    private readonly chart: Chart,
    settings: Settings,
    highwayCanvas: HTMLCanvasElement,
    backgroundCanvas: HTMLCanvasElement,
    private readonly hud: HudRefs,
    stageHost?: HTMLElement,
  ) {
    engine.load(buffer);
    engine.offset = settings.offsetMs / 1000;
    engine.volume = settings.volume;
    engine.onEnded = () => this.finish();

    this.downbeats = new Set(chart.downbeats);
    this.session = new GameSession(chart);
    // In development the running game can be reached from the console (to start overdrive, say).
    if (import.meta.env.DEV) (window as unknown as { __play?: PlayController }).__play = this;
    this.highway = new Highway(highwayCanvas, chart);
    this.highway.speed = settings.noteSpeed;
    this.breaks = findBreaks(chart);
    this.barTimes = chart.downbeats.map((i) => chart.beats[i]).filter((x) => x !== undefined);
    this.highway.attach(this.session);
    this.background = new Background2D(backgroundCanvas);
    this.background.setAnalyser(engine.analyser);
    this.barLevels = barIntensity(chart);
    const graphics = resolveGraphics(settings.graphics);
    if (graphics.stage3d && stageHost) {
      AuroraStage.create(stageHost, graphics, { mode: 'play', part: chart.part })
        .then((stage) => {
          if (this.disposed) return stage.dispose();
          stage.setAnalyser(engine.analyser);
          this.stage = stage;
        })
        .catch((err) => console.warn('3D stage unavailable, using the 2D backdrop', err));
    }

    const padBindings = chart.lanes === 5 ? settings.pad5 : settings.pad4;
    this.rumble = new Rumbler(settings, chart.lanes, padBindings);
    this.session.on((e) => {
      if (e.type === 'hit') {
        this.flashFeedback(e.grade.toUpperCase(), e.grade);
        this.rumble.hit(e.lane, e.grade);
        if (chart.notes[e.noteIndex].dur > 0) this.rumble.sustainStart(e.lane);
      } else if (e.type === 'miss') {
        this.flashFeedback('MISS', 'miss');
        this.rumble.miss(e.lane);
      } else if (e.type === 'release') {
        this.flashFeedback(`${e.grade.toUpperCase()} RELEASE`, e.grade);
        this.rumble.hit(e.lane, e.grade);
      } else if (e.type === 'release-miss') {
        this.flashFeedback(e.early ? 'TOO EARLY' : 'LET GO!', 'miss');
        this.rumble.miss(e.lane);
      } else if (e.type === 'sustain-end') this.rumble.sustainEnd(e.lane);
      else if (e.type === 'overdrive-start') {
        this.background.kick(1.2);
        this.stage?.overdriveStart();
        this.odMeterAtStart = Math.max(this.session.overdrive, 0.01);
        this.rumble.overdrive();
      } else if (e.type === 'overdrive-end') this.rumble.overdriveEnd(); else if (e.type === 'phrase-complete') {
        this.flashFeedback('OVERDRIVE READY', 'od');
        this.rumble.phraseComplete();
      }
    });

    const keys = chart.lanes === 5 ? settings.keys5 : settings.keys4;
    const handlers: InputHandlers = {
      press: (lane, ts) => {
        if (this.phase !== 'playing') return;
        this.session.press(lane, this.engine.time(ts));
      },
      release: (lane, ts) => {
        if (this.phase !== 'playing') return;
        this.session.release(lane, this.engine.time(ts));
      },
      overdrive: () => {
        if (this.phase === 'playing') this.session.activateOverdrive();
      },
      pause: () => (this.phase === 'paused' ? this.resume() : this.pause()),
    };
    this.input = new KeyboardInput(keys, settings.overdriveKey, handlers);
    // Controllers drive the menus while paused, so only take their input during play.
    this.padInput = new GamepadInput(padBindings, settings.padOverdrive, handlers, () => this.phase === 'playing' || this.phase === 'countdown');

    // Touch: a finger anywhere in a lane's column plays that lane (the highway lights the lane).
    const vibrate = settings.touchHaptics && typeof navigator.vibrate === 'function';
    this.touchInput = new TouchInput(hud.touchLayer, (x, y) => this.highway.laneAt(x, y), handlers, (_lane, down) => {
      if (down && vibrate && this.phase === 'playing') navigator.vibrate(8);
    });
    hud.overdriveButton.addEventListener('pointerdown', this.overdrivePress);

    // The canvas changes size with the window and when the touch pads take the bottom of the screen.
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(highwayCanvas);
    window.addEventListener('resize', this.resize);
    this.placeKeys();
  }

  private readonly resize = () => {
    this.highway.resize();
    this.background.resize();
    this.stage?.resize();
    this.placeKeys();
  };

  private readonly overdrivePress = (e: Event) => {
    e.preventDefault();
    if (this.phase === 'playing') this.session.activateOverdrive();
  };

  /** Lays the highway out again after the layout changed without the canvas changing size (another input in use). */
  relayout() {
    this.resize();
  }

  /** Puts the lane labels under their lanes and tells the HUD where the highway is. */
  private placeKeys() {
    const pos = this.highway.padScreenPositions();
    if (!pos.length) return;
    pos.forEach((p, i) => {
      const at = `translate(${p.x}px, ${p.y}px) translate(-50%, 0)`;
      const key = this.hud.keys[i];
      if (key) key.style.transform = at;
    });
    const first = pos[0];
    const last = pos[pos.length - 1];
    const laneW = pos.length > 1 ? (last.x - first.x) / (pos.length - 1) : 90;
    // On the play screen itself, so the highway canvas can read them as well as the HUD.
    const root = (this.hud.root.parentElement ?? this.hud.root).style;
    root.setProperty('--hw-x', `${((first.x + last.x) / 2).toFixed(1)}px`);
    root.setProperty('--hw-y', `${first.y.toFixed(1)}px`);
    root.setProperty('--lane-w', `${laneW.toFixed(1)}px`);
    root.setProperty('--hw-w', `${(laneW * pos.length).toFixed(1)}px`);
  }

  async start() {
    this.setPhase('countdown');
    await this.engine.play(-LEAD_IN, 0.05);
    this.loop();
  }

  pause() {
    if (this.phase !== 'playing' && this.phase !== 'countdown') return;
    this.engine.pause();
    for (let l = 0; l < this.chart.lanes; l++) this.rumble.sustainEnd(l);
    this.rumble.overdriveEnd(true);
    this.setPhase('paused');
  }

  async resume() {
    if (this.phase !== 'paused') return;
    // Rewind slightly so the player can re-enter the groove.
    const at = Math.max(-LEAD_IN, this.engine.time() - 1.5);
    this.session.dropHolds();
    await this.engine.play(at, 0.05);
    this.highway.reset();
    this.lastCount = -1;
    this.lastBeat = -1;
    while (this.lastBeat + 1 < this.chart.beats.length && this.chart.beats[this.lastBeat + 1] <= at) this.lastBeat++;
    this.setPhase(at < 0 ? 'countdown' : 'playing');
  }

  private setPhase(p: PlayPhase, countdown?: number) {
    this.phase = p;
    this.onPhase(p, countdown);
  }

  private finish() {
    if (this.phase === 'finished') return;
    this.session.update(Number.POSITIVE_INFINITY);
    this.setPhase('finished');
    this.stage?.finale();
    this.onFinish(this.session.results());
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const t = this.engine.time();

    if (this.phase === 'countdown') {
      const n = Math.ceil(-t);
      if (t >= 0) this.setPhase('playing');
      else if (n !== this.lastCount) {
        this.lastCount = n;
        this.onPhase('countdown', n);
      }
    }
    if (this.phase === 'playing') {
      this.session.update(t);
      if (t > this.chart.duration + 0.5 && t > this.engine.duration) this.finish();
    }

    // Beat accents for the track glow and background.
    const beats = this.chart.beats;
    let beat: 'none' | 'beat' | 'downbeat' = 'none';
    while (this.lastBeat + 1 < beats.length && beats[this.lastBeat + 1] <= t) {
      this.lastBeat++;
      this.beatPulse = 1;
      beat = this.downbeats.has(this.lastBeat) ? 'downbeat' : 'beat';
      if (beat === 'downbeat') this.background.kick(0.6);
    }
    const stage = this.stage;
    if (this.phase === 'playing' && this.session.overdriveActive) this.rumble.overdriveTick(this.session.overdrive / this.odMeterAtStart, beat);
    this.beatPulse = Math.max(0, this.beatPulse - 0.08);

    let low: number;
    if (stage) {
      const bar = barAt(this.barTimes, t);
      const busy = bar >= 0 ? (this.barLevels[bar] ?? 0.3) : 0.15;
      low = stage.bands.low;
      stage.render({ beat, intensity: busy * 0.75 + low * 0.25, overdrive: this.session.overdriveActive, barSeconds: this.chart.secondsPerBeat * 4 });
    } else {
      this.background.render();
      low = this.background.bands.low;
    }
    this.highway.render(t, this.session, this.beatPulse * 0.5 + low * 0.5);
    this.beatNow = beat !== 'none';
    this.bassNow = low;
    this.updateHud(t);
  };

  private flashFeedback(text: string, kind: string) {
    const el = this.hud.feedback;
    el.textContent = text;
    el.dataset.kind = kind;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    clearTimeout(this.feedbackTimer);
    this.feedbackTimer = window.setTimeout(() => el.classList.remove('pop'), 450);
  }

  private updateHud(t: number) {
    const s = this.session;
    const c = this.hudCache;
    const score = Math.round(s.score);
    if (score !== c.score) this.hud.score.textContent = score.toLocaleString();
    const mult = s.multiplier;
    if (mult !== c.mult) {
      this.hud.multiplier.textContent = `×${mult}`;
      this.hud.multiplier.dataset.level = String(Math.min(mult, 8));
    }
    if (s.streak !== c.streak) {
      // The dial's ring: how far the streak is toward the next multiplier step (full at the top one).
      const top = multiplierFor(s.streak) >= MAX_MULTIPLIER;
      this.hud.root.style.setProperty('--streak-p', top ? '1' : ((s.streak % STREAK_PER_MULTIPLIER) / STREAK_PER_MULTIPLIER).toFixed(2));
    }
    const od = Math.round(s.overdrive * 100);
    if (od !== c.od) {
      // (--od itself is the overdrive colour.)
      this.hud.root.style.setProperty('--od-level', (od / 100).toFixed(2));
      this.hud.root.classList.toggle('od-ready', od >= 25 && !s.overdriveActive);
    }
    if (s.overdriveActive !== c.odActive) this.hud.root.classList.toggle('overdrive', s.overdriveActive);
    const stars = s.progressStars;
    if (stars !== c.stars) this.hud.stars.dataset.count = String(stars);
    const starP = Math.round(s.nextStarProgress * 50) / 50;
    if (starP !== c.starP) this.hud.stars.style.setProperty('--star-p', String(starP));
    this.hud.progress.style.width = `${Math.max(0, Math.min(1, t / this.chart.duration)) * 100}%`;
    this.updateBreak(t);
    Object.assign(c, { score, mult, streak: s.streak, od, stars, starP, odActive: s.overdriveActive });
  }

  /**
   * The break countdown: bars left until the next note, with a ring that drains until the note is
   * due. It jumps on every beat by as much as there is bass, bounces and glows on every bar line,
   * and takes its last two beats to leave, gone just before the notes kick in.
   */
  private updateBreak(t: number) {
    const b = this.phase === 'playing' || this.phase === 'paused' ? this.breaks.find((x) => t >= x.from && t < x.to) : undefined;
    const el = this.hud.breakTimer;
    const c = this.hudCache;
    if (!b) {
      if (c.breakSec !== -1) {
        el.classList.remove('on', 'final', 'leaving', 'beat', 'bounce');
        c.breakSec = -1;
      }
      return;
    }
    this.hud.breakRing.style.strokeDashoffset = String(1 - Math.max(0, Math.min(1, (b.to - t) / (b.to - b.from))));
    // The last two beats of the countdown are spent going, within reason.
    const fade = Math.max(0.7, Math.min(1.5, this.chart.secondsPerBeat * 2));
    const leaving = t >= b.to - fade;
    if (leaving && !el.classList.contains('leaving')) el.style.setProperty('--break-fade', `${fade.toFixed(2)}s`);
    el.classList.toggle('leaving', leaving);
    const restart = (node: HTMLElement, cls: string) => {
      node.classList.remove(cls);
      void node.offsetWidth;
      node.classList.add(cls);
    };
    // Without a bar grid, fall back to seconds.
    const bars = this.barTimes.length > 1 ? barsLeft(t, b.next, this.barTimes) : Math.max(1, Math.ceil(b.next - t));
    if (bars === c.breakSec) {
      // A beat inside the bar: a jump as big as the bass is loud, next to nothing in a quiet passage.
      if (this.beatNow && !leaving) {
        el.style.setProperty('--break-kick', Math.max(0, Math.min(1, 0.06 + this.bassNow * 1.15)).toFixed(2));
        el.classList.remove('bounce');
        restart(el, 'beat');
      }
      return;
    }
    const first = c.breakSec === -1;
    c.breakSec = bars;
    this.hud.breakNumber.textContent = String(bars);
    el.classList.add('on');
    el.classList.toggle('final', bars <= 1);
    // A new bar: the number pops and the whole timer bounces.
    if (!first && !leaving) {
      el.classList.remove('beat');
      restart(this.hud.breakNumber, 'tick');
      restart(el, 'bounce');
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.feedbackTimer);
    window.removeEventListener('resize', this.resize);
    this.observer.disconnect();
    this.hud.overdriveButton.removeEventListener('pointerdown', this.overdrivePress);
    this.touchInput.dispose();
    this.input.dispose();
    this.padInput.dispose();
    this.rumble.dispose();
    this.engine.stop();
    this.engine.onEnded = null;
    this.highway.dispose();
    this.stage?.dispose();
  }
}
