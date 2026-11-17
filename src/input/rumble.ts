/**
 * Controller feedback: rumble through the Gamepad API on every controller that supports it, and
 * on a PS5 DualSense connected by USB, its haptic actuators driven directly.
 *
 * A wired DualSense is also a 4-channel audio device; channels 3 and 4 drive the left and right
 * voice-coil actuators. Playing short tuned waveforms there gives positional, textured haptics
 * (a click on the side of the lane you hit, a low thud for a miss) instead of plain rumble.
 */
import type { Settings } from '../game/settings';
import { pads, type PadInput } from './pads';

interface Effect {
  /** -1 = left grip, 1 = right grip. */
  pan: number;
  /** 0..1 before the strength setting. */
  amp: number;
  ms: number;
  kind: 'click' | 'thud' | 'buzz' | 'sweep';
  /** Lane binding, so a trigger-bound lane can rumble in that trigger. */
  input?: PadInput;
}

type Actuator = {
  effects?: string[];
  playEffect?(type: string, params: Record<string, number>): Promise<unknown>;
  reset?(): Promise<unknown>;
};

const actuator = (index: number): Actuator | undefined => (pads.gamepad(index) as (Gamepad & { vibrationActuator?: Actuator }) | null)?.vibrationActuator;

/** Rumble one controller. Heavy motor left, light motor right, so pan shifts the weight. */
function rumblePad(index: number, e: Effect, k: number) {
  const act = actuator(index);
  if (!act?.playEffect) return;
  const left = (1 - e.pan) / 2;
  const right = (1 + e.pan) / 2;
  const heavy = e.kind === 'thud' || e.kind === 'sweep' ? 1 : 0.55;
  const strong = Math.min(1, e.amp * k * heavy * (0.35 + 0.65 * left));
  const weak = Math.min(1, e.amp * k * (0.35 + 0.65 * right));
  const trigger = e.input === 'b6' ? 'left' : e.input === 'b7' ? 'right' : undefined;
  if (trigger && act.effects?.includes('trigger-rumble')) {
    void act
      .playEffect('trigger-rumble', {
        duration: e.ms,
        strongMagnitude: strong * 0.5,
        weakMagnitude: weak * 0.5,
        leftTrigger: trigger === 'left' ? Math.min(1, e.amp * k) : 0,
        rightTrigger: trigger === 'right' ? Math.min(1, e.amp * k) : 0,
      })
      .catch(() => {});
    return;
  }
  void act.playEffect('dual-rumble', { startDelay: 0, duration: e.ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
}

/** Finds the audio output of a USB-connected DualSense. Asks for media permission to see device names. */
export async function findDualSense(): Promise<string | null> {
  const md = navigator.mediaDevices;
  if (!md?.enumerateDevices) return null;
  const match = (d: MediaDeviceInfo) => d.kind === 'audiooutput' && /dualsense|wireless controller/i.test(d.label);
  let devices = await md.enumerateDevices();
  if (!devices.some((d) => d.kind === 'audiooutput' && d.label)) {
    // Device names are hidden until the page has media permission; the stream is closed at once.
    const s = await md.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    devices = await md.enumerateDevices();
  }
  return devices.find(match)?.deviceId ?? null;
}

/** The DualSense's haptic channels as an audio graph. */
export class DualSenseHaptics {
  private constructor(
    private readonly ctx: AudioContext,
    private readonly out: ChannelMergerNode,
  ) {}

  /** Opens the controller's audio device; null when it isn't a 4-channel DualSense output. */
  static async open(deviceId: string): Promise<DualSenseHaptics | null> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    try {
      await (ctx as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(deviceId);
      if (ctx.destination.maxChannelCount < 4) {
        void ctx.close();
        return null;
      }
      ctx.destination.channelCount = 4;
      ctx.destination.channelCountMode = 'explicit';
      ctx.destination.channelInterpretation = 'discrete';
      const out = ctx.createChannelMerger(4);
      out.connect(ctx.destination);
      if (ctx.state !== 'running') await ctx.resume();
      return new DualSenseHaptics(ctx, out);
    } catch {
      void ctx.close();
      return null;
    }
  }

  /** One haptic event; returns a stop function (used by held notes). */
  play(e: Effect, k: number): () => void {
    const { ctx } = this;
    const t0 = ctx.currentTime + 0.005;
    const dur = e.ms / 1000;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const l = ctx.createGain();
    const r = ctx.createGain();
    // Constant-power pan between the two actuators.
    const a = ((e.pan + 1) / 2) * (Math.PI / 2);
    l.gain.value = Math.cos(a);
    r.gain.value = Math.sin(a);
    const amp = Math.min(1, e.amp * k);
    if (e.kind === 'click') {
      osc.frequency.value = 230;
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(amp, t0 + 0.004);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    } else if (e.kind === 'thud') {
      osc.frequency.setValueAtTime(90, t0);
      osc.frequency.exponentialRampToValueAtTime(50, t0 + dur);
      env.gain.setValueAtTime(amp, t0);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    } else if (e.kind === 'sweep') {
      osc.frequency.setValueAtTime(70, t0);
      osc.frequency.exponentialRampToValueAtTime(280, t0 + dur);
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(amp, t0 + dur * 0.3);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    } else {
      osc.frequency.value = 160;
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(amp * 0.5, t0 + 0.03);
    }
    osc.connect(env);
    env.connect(l).connect(this.out, 0, 2);
    env.connect(r).connect(this.out, 0, 3);
    osc.start(t0);
    const stop = () => {
      const t = ctx.currentTime;
      env.gain.cancelScheduledValues(t);
      env.gain.setTargetAtTime(0, t, 0.02);
      osc.stop(t + 0.1);
    };
    if (e.kind !== 'buzz') osc.stop(t0 + dur + 0.02);
    return stop;
  }

  close() {
    void this.ctx.close();
  }
}

/** Game feedback for one play-through (or a settings test). */
export class Rumbler {
  private haptics: DualSenseHaptics | null = null;
  private held = new Map<number, () => void>();
  private holdTimer = 0;
  private disposed = false;

  constructor(
    private readonly s: Settings,
    private readonly lanes: number,
    private readonly bindings: PadInput[] = [],
  ) {
    if (s.rumble && s.dualSenseHaptics) {
      void findDualSense()
        .then((id) => (id ? DualSenseHaptics.open(id) : null))
        .then((h) => {
          if (this.disposed) h?.close();
          else this.haptics = h;
        })
        .catch(() => {});
    }
  }

  private get k() {
    return this.s.rumble ? this.s.rumbleStrength : 0;
  }

  private panFor(lane: number) {
    return this.lanes > 1 ? (lane / (this.lanes - 1)) * 2 - 1 : 0;
  }

  /** Controllers to rumble: the one in use, or all of them before any was used. */
  private targets(): number[] {
    const snap = pads.snapshot();
    const last = snap.pads.find((p) => p.index === snap.lastPad);
    return (last ? [last] : snap.pads).filter((p) => !(this.haptics && p.family === 'ps5')).map((p) => p.index);
  }

  private fire(e: Effect): (() => void) | undefined {
    const k = this.k;
    if (k <= 0) return undefined;
    for (const i of this.targets()) rumblePad(i, e, k);
    return this.haptics?.play(e, k);
  }

  hit(lane: number) {
    if (this.s.rumbleHits) this.fire({ pan: this.panFor(lane), amp: 0.45, ms: 45, kind: 'click', input: this.bindings[lane] });
  }

  miss(lane: number) {
    if (this.s.rumbleMisses) this.fire({ pan: this.panFor(lane), amp: 0.7, ms: 120, kind: 'thud', input: this.bindings[lane] });
  }

  sustainStart(lane: number) {
    if (!this.s.rumbleSustains || this.k <= 0) return;
    this.held.get(lane)?.();
    this.held.set(lane, this.haptics?.play({ pan: this.panFor(lane), amp: 0.4, ms: 0, kind: 'buzz' }, this.k) ?? (() => {}));
    // Gamepad rumble has no "until stopped"; renew a short buzz while anything is held.
    if (!this.holdTimer) {
      const tick = () => {
        if (!this.held.size) {
          this.holdTimer = 0;
          return;
        }
        const lanes = [...this.held.keys()];
        const pan = lanes.reduce((s, l) => s + this.panFor(l), 0) / lanes.length;
        for (const i of this.targets()) rumblePad(i, { pan, amp: 0.25, ms: 140, kind: 'buzz', input: this.bindings[lanes[0]] }, this.k);
        this.holdTimer = window.setTimeout(tick, 100);
      };
      tick();
    }
  }

  sustainEnd(lane: number) {
    this.held.get(lane)?.();
    this.held.delete(lane);
  }

  overdrive() {
    if (this.s.rumbleOverdrive) this.fire({ pan: 0, amp: 0.9, ms: 450, kind: 'sweep' });
  }

  phraseComplete() {
    if (!this.s.rumbleOverdrive) return;
    this.fire({ pan: 0, amp: 0.5, ms: 60, kind: 'click' });
    window.setTimeout(() => !this.disposed && this.fire({ pan: 0, amp: 0.5, ms: 60, kind: 'click' }), 130);
  }

  /** Settings preview: a click travelling across the lanes, then a thud. */
  test() {
    for (let l = 0; l < this.lanes; l++) window.setTimeout(() => this.fire({ pan: this.panFor(l), amp: 0.6, ms: 60, kind: 'click' }), l * 160);
    window.setTimeout(() => this.fire({ pan: 0, amp: 0.8, ms: 160, kind: 'thud' }), this.lanes * 160 + 120);
  }

  /** Resolves once the DualSense haptics are open (or failed). */
  async ready(timeoutMs = 4000): Promise<boolean> {
    const until = performance.now() + timeoutMs;
    while (!this.haptics && performance.now() < until) await new Promise((r) => setTimeout(r, 100));
    return !!this.haptics;
  }

  dispose() {
    this.disposed = true;
    for (const stop of this.held.values()) stop();
    this.held.clear();
    clearTimeout(this.holdTimer);
    this.haptics?.close();
    for (const p of pads.snapshot().pads) void actuator(p.index)?.reset?.().catch(() => {});
  }
}
