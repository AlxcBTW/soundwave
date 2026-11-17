import type { Chart } from '../chart/types';
import { AudioEngine } from '../audio/AudioEngine';
import { Background2D } from '../render/Background2D';
import { Highway } from '../render/Highway';
import { GameSession, type Results } from './GameSession';
import { Rumbler } from '../input/rumble';
import { findBreaks, type Break } from './breaks';
import { GamepadInput, KeyboardInput, type InputHandlers } from './input';
import type { Settings } from './settings';

export interface HudRefs {
  score: HTMLElement;
  multiplier: HTMLElement;
  streak: HTMLElement;
  overdriveFill: HTMLElement;
  stars: HTMLElement;
  progress: HTMLElement;
  feedback: HTMLElement;
  root: HTMLElement;
  /** One label per lane, positioned under its strike pad. */
  keys: HTMLElement[];
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
  private readonly input: KeyboardInput;
  private readonly padInput: GamepadInput;
  private readonly rumble: Rumbler;
  private raf = 0;
  private phase: PlayPhase = 'countdown';
  private lastBeat = -1;
  private beatPulse = 0;
  private hudCache = { score: -1, mult: -1, streak: -1, od: -1, stars: -1, odActive: false, breakSec: -1 };
  private readonly breaks: Break[];
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
  ) {
    engine.load(buffer);
    engine.offset = settings.offsetMs / 1000;
    engine.volume = settings.volume;
    engine.onEnded = () => this.finish();

    this.downbeats = new Set(chart.downbeats);
    this.breaks = findBreaks(chart);
    this.session = new GameSession(chart);
    this.highway = new Highway(highwayCanvas, chart);
    this.highway.speed = settings.noteSpeed;
    this.highway.attach(this.session);
    this.background = new Background2D(backgroundCanvas);
    this.background.setAnalyser(engine.analyser);

    const padBindings = chart.lanes === 5 ? settings.pad5 : settings.pad4;
    this.rumble = new Rumbler(settings, chart.lanes, padBindings);
    this.session.on((e) => {
      if (e.type === 'hit') {
        this.flashFeedback(e.grade.toUpperCase(), e.grade);
        this.rumble.hit(e.lane);
        if (chart.notes[e.noteIndex].dur > 0) this.rumble.sustainStart(e.lane);
      } else if (e.type === 'miss') {
        this.flashFeedback('MISS', 'miss');
        this.rumble.miss(e.lane);
      } else if (e.type === 'sustain-end') this.rumble.sustainEnd(e.lane);
      else if (e.type === 'overdrive-start') {
        this.background.kick(1.2);
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

    window.addEventListener('resize', this.resize);
    this.placeKeys();
  }

  private readonly resize = () => {
    this.highway.resize();
    this.background.resize();
    this.placeKeys();
  };

  private placeKeys() {
    this.highway.padScreenPositions().forEach((p, i) => {
      const el = this.hud.keys[i];
      if (el) el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, 0)`;
    });
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
    for (let l = 0; l < this.chart.lanes; l++) this.session.release(l, this.engine.time());
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
    if (this.phase === 'playing' && this.session.overdriveActive) this.rumble.overdriveTick(this.session.overdrive / this.odMeterAtStart, beat);
    this.beatPulse = Math.max(0, this.beatPulse - 0.08);

    this.background.render();
    this.highway.render(t, this.session, this.beatPulse * 0.5 + this.background.bands.low * 0.5);
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
    if (s.streak !== c.streak) this.hud.streak.textContent = s.streak > 0 ? `${s.streak}` : '';
    const od = Math.round(s.overdrive * 100);
    if (od !== c.od) {
      this.hud.overdriveFill.style.height = `${od}%`;
      this.hud.root.classList.toggle('od-ready', od >= 25 && !s.overdriveActive);
    }
    if (s.overdriveActive !== c.odActive) this.hud.root.classList.toggle('overdrive', s.overdriveActive);
    const stars = s.progressStars;
    if (stars !== c.stars) this.hud.stars.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
    this.hud.progress.style.width = `${Math.max(0, Math.min(1, t / this.chart.duration)) * 100}%`;
    this.updateBreak(t);
    Object.assign(c, { score, mult, streak: s.streak, od, stars, odActive: s.overdriveActive });
  }

  /** The break countdown: whole seconds to the next note, a ring draining over the break. */
  private updateBreak(t: number) {
    const b = this.phase === 'playing' || this.phase === 'paused' ? this.breaks.find((x) => t >= x.from && t < x.to) : undefined;
    const el = this.hud.breakTimer;
    const c = this.hudCache;
    if (!b) {
      if (c.breakSec !== -1) {
        el.classList.remove('on', 'final');
        c.breakSec = -1;
      }
      return;
    }
    const left = b.next - t;
    const sec = Math.max(1, Math.ceil(left));
    this.hud.breakRing.style.strokeDashoffset = String(1 - Math.max(0, Math.min(1, left / b.length)));
    if (sec === c.breakSec) return;
    c.breakSec = sec;
    this.hud.breakNumber.textContent = String(sec);
    el.classList.add('on');
    el.classList.toggle('final', sec <= 3);
    // Restart the pop on every new second.
    this.hud.breakNumber.classList.remove('tick');
    void this.hud.breakNumber.offsetWidth;
    this.hud.breakNumber.classList.add('tick');
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.feedbackTimer);
    window.removeEventListener('resize', this.resize);
    this.input.dispose();
    this.padInput.dispose();
    this.rumble.dispose();
    this.engine.stop();
    this.engine.onEnded = null;
    this.highway.dispose();
  }
}
