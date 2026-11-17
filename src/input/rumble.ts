/**
 * Controller feedback: rumble through the Gamepad API on every controller that supports it, and
 * on a PS5 DualSense connected by USB in the desktop app, its haptic actuators driven natively
 * (src-tauri/src/haptics.rs): positional, textured feedback instead of plain rumble.
 */
import { invoke } from '@tauri-apps/api/core';
import type { Grade } from '../game/judge';
import type { RumbleLevel, Settings } from '../game/settings';
import { pads, type PadInput } from './pads';

type Kind = 'click' | 'thud' | 'buzz' | 'sweep';

interface Effect {
  /** -1 = left grip, 1 = right grip. */
  pan: number;
  /** Relative intensity of the event, 0..1; scaled by the rumble level. */
  amp: number;
  ms: number;
  kind: Kind;
  /** Lane binding, so a trigger-bound lane can rumble in that trigger. */
  input?: PadInput;
}

/** Hit feedback by timing: a perfect hit is the full-strength, slightly longer pulse. */
export const HIT_FEEL: Record<Grade, { amp: number; ms: number }> = {
  perfect: { amp: 1, ms: 70 },
  great: { amp: 0.65, ms: 50 },
  good: { amp: 0.45, ms: 45 },
};

/** Output scale per level; strong is full output. */
export const RUMBLE_SCALE: Record<RumbleLevel, number> = { off: 0, weak: 0.45, strong: 1 };

type Actuator = {
  effects?: string[];
  playEffect?(type: string, params: Record<string, number>): Promise<unknown>;
  reset?(): Promise<unknown>;
};

const actuator = (index: number): Actuator | undefined => (pads.gamepad(index) as (Gamepad & { vibrationActuator?: Actuator }) | null)?.vibrationActuator;

/**
 * Rumble one controller. The heavy motor sits in the left grip and the light one in the right,
 * so the side away from the lane is turned down; the middle lanes get both at full.
 */
function rumblePad(index: number, e: Effect, k: number) {
  const act = actuator(index);
  if (!act?.playEffect) return;
  const amp = Math.min(1, e.amp * k);
  const strong = amp * Math.max(0.35, Math.min(1, 1 - e.pan));
  const weak = amp * Math.max(0.35, Math.min(1, 1 + e.pan));
  const trigger = e.input === 'b6' ? 'left' : e.input === 'b7' ? 'right' : undefined;
  if (trigger && act.effects?.includes('trigger-rumble')) {
    void act
      .playEffect('trigger-rumble', { duration: e.ms, strongMagnitude: strong * 0.6, weakMagnitude: weak * 0.6, leftTrigger: trigger === 'left' ? amp : 0, rightTrigger: trigger === 'right' ? amp : 0 })
      .catch(() => {});
    return;
  }
  void act.playEffect('dual-rumble', { startDelay: 0, duration: e.ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
}

const inDesktopApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Whether a USB DualSense's haptic actuators can be driven (desktop app only, no permission needed). */
export async function dualSenseHaptics(): Promise<boolean> {
  if (!inDesktopApp()) return false;
  try {
    return await invoke<boolean>('haptics_available');
  } catch {
    return false;
  }
}

const nativePlay = (e: Effect, k: number, hold?: number) =>
  void invoke('haptics_play', { effect: { pan: e.pan, amp: Math.min(1, e.amp * k), ms: e.ms, kind: e.kind, hold: hold ?? null } }).catch(() => {});
const nativeRelease = (id: number) => void invoke('haptics_release', { id }).catch(() => {});
const nativeUpdate = (id: number, amp: number) => void invoke('haptics_update', { id, amp }).catch(() => {});

let holdIds = 1;

/** Game feedback for one play-through (or a settings test). */
export class Rumbler {
  /** Native DualSense haptics are open: PS5 controllers get those instead of rumble. */
  private native = false;
  private held = new Map<number, number>();
  private holdTimer = 0;
  private disposed = false;
  private readonly checked: Promise<boolean>;
  /** Overdrive rumble: when it started, the last gamepad renewal, the native bed voice. */
  private od = { active: false, start: 0, last: 0, hold: 0, amp: -1, sent: 0 };

  constructor(
    private readonly s: Settings,
    private readonly lanes: number,
    private readonly bindings: PadInput[] = [],
  ) {
    const ps5 = pads.snapshot().pads.some((p) => p.family === 'ps5');
    this.checked = ps5 && s.rumble !== 'off' ? dualSenseHaptics().then((ok) => (this.native = ok && !this.disposed)) : Promise.resolve(false);
  }

  private get k() {
    return RUMBLE_SCALE[this.s.rumble];
  }

  private panFor(lane: number) {
    return this.lanes > 1 ? (lane / (this.lanes - 1)) * 2 - 1 : 0;
  }

  /** Controllers to rumble: the one in use, or all of them before any was used. */
  private targets(): number[] {
    const snap = pads.snapshot();
    const last = snap.pads.find((p) => p.index === snap.lastPad);
    return (last ? [last] : snap.pads).filter((p) => !(this.native && p.family === 'ps5')).map((p) => p.index);
  }

  private fire(e: Effect) {
    const k = this.k;
    if (k <= 0) return;
    for (const i of this.targets()) rumblePad(i, e, k);
    if (this.native) nativePlay(e, k);
  }

  hit(lane: number, grade: Grade = 'perfect') {
    if (!this.s.rumbleHits) return;
    const { amp, ms } = HIT_FEEL[grade];
    this.fire({ pan: this.panFor(lane), amp, ms, kind: 'click', input: this.bindings[lane] });
  }

  miss(lane: number) {
    if (this.s.rumbleMisses) this.fire({ pan: this.panFor(lane), amp: 1, ms: 130, kind: 'thud', input: this.bindings[lane] });
  }

  sustainStart(lane: number) {
    if (!this.s.rumbleSustains || this.k <= 0) return;
    this.sustainEnd(lane);
    const id = holdIds++;
    this.held.set(lane, id);
    if (this.native) nativePlay({ pan: this.panFor(lane), amp: 0.7, ms: 0, kind: 'buzz' }, this.k, id);
    // Gamepad rumble has no "until stopped"; renew a short buzz while anything is held.
    if (!this.holdTimer) {
      const tick = () => {
        if (!this.held.size || this.disposed) {
          this.holdTimer = 0;
          return;
        }
        const lanes = [...this.held.keys()];
        const pan = lanes.reduce((s, l) => s + this.panFor(l), 0) / lanes.length;
        for (const i of this.targets()) rumblePad(i, { pan, amp: 0.4, ms: 140, kind: 'buzz', input: this.bindings[lanes[0]] }, this.k);
        this.holdTimer = window.setTimeout(tick, 100);
      };
      tick();
    }
  }

  sustainEnd(lane: number) {
    const id = this.held.get(lane);
    if (id === undefined) return;
    this.held.delete(lane);
    if (this.native) nativeRelease(id);
  }

  /** Overdrive kicks in: a rising sweep, then the progressive rumble (see overdriveTick). */
  overdrive() {
    if (!this.s.rumbleOverdrive) return;
    this.fire({ pan: 0, amp: 1, ms: 450, kind: 'sweep' });
    this.od = { active: true, start: performance.now(), last: 0, hold: 0, amp: -1, sent: 0 };
  }

  /**
   * Called every frame while overdrive runs. `remaining` is the share of the meter left
   * (1 at activation, 0 when it runs out): the rumble starts at full strength and eases off as
   * the meter drains, with a pulse on every beat (stronger on downbeats) riding on top.
   */
  overdriveTick(remaining: number, beat: 'none' | 'beat' | 'downbeat') {
    const k = this.k;
    if (!this.od.active || !this.s.rumbleOverdrive || k <= 0) return;
    const now = performance.now();
    // Let the activation sweep finish first.
    if (now - this.od.start < 420) return;
    const level = 0.3 + 0.7 * Math.max(0, Math.min(1, remaining));
    if (beat !== 'none') {
      const pulse = { pan: 0, amp: level * (beat === 'downbeat' ? 1 : 0.8), ms: 90, kind: 'thud' as const };
      for (const i of this.targets()) rumblePad(i, pulse, k);
      if (this.native) nativePlay(pulse, k);
      this.od.last = now;
    } else if (now - this.od.last > 100) {
      // Gamepad rumble can't be held, so the bed is renewed in short overlapping pieces.
      for (const i of this.targets()) rumblePad(i, { pan: 0, amp: level * 0.5, ms: 140, kind: 'buzz' }, k);
      this.od.last = now;
    }
    if (this.native) {
      const bed = level * 0.6;
      if (!this.od.hold) {
        this.od.hold = holdIds++;
        nativePlay({ pan: 0, amp: bed, ms: 0, kind: 'buzz' }, k, this.od.hold);
        this.od.amp = bed;
      } else if (Math.abs(bed - this.od.amp) > 0.02 && now - this.od.sent > 50) {
        nativeUpdate(this.od.hold, Math.min(1, bed * k));
        this.od.amp = bed;
        this.od.sent = now;
      }
    }
  }

  /** Overdrive ran out (or the game paused): the progressive rumble stops. */
  overdriveEnd(keepActive = false) {
    if (this.od.hold) nativeRelease(this.od.hold);
    this.od = { ...this.od, active: keepActive && this.od.active, hold: 0, amp: -1 };
  }

  phraseComplete() {
    if (!this.s.rumbleOverdrive) return;
    this.fire({ pan: 0, amp: 0.7, ms: 60, kind: 'click' });
    window.setTimeout(() => !this.disposed && this.fire({ pan: 0, amp: 0.7, ms: 60, kind: 'click' }), 130);
  }

  /** Settings preview: a click travelling across the lanes, then a thud. Resolves with whether DualSense haptics were used. */
  async test(): Promise<boolean> {
    await this.checked;
    for (let l = 0; l < this.lanes; l++) window.setTimeout(() => this.fire({ pan: this.panFor(l), amp: 1, ms: 60, kind: 'click' }), l * 160);
    window.setTimeout(() => this.fire({ pan: 0, amp: 1, ms: 160, kind: 'thud' }), this.lanes * 160 + 120);
    return this.native;
  }

  dispose() {
    this.disposed = true;
    for (const lane of [...this.held.keys()]) this.sustainEnd(lane);
    this.overdriveEnd();
    clearTimeout(this.holdTimer);
    for (const p of pads.snapshot().pads) void actuator(p.index)?.reset?.().catch(() => {});
  }
}

export type MenuPulse = 'move' | 'select' | 'back' | 'tab-left' | 'tab-right' | 'launch' | 'star' | 'error';

const MENU_PULSES: Record<MenuPulse, Effect> = {
  move: { pan: 0, amp: 0.22, ms: 22, kind: 'click' },
  select: { pan: 0, amp: 0.55, ms: 45, kind: 'click' },
  back: { pan: -0.3, amp: 0.4, ms: 40, kind: 'click' },
  'tab-left': { pan: -1, amp: 0.45, ms: 40, kind: 'click' },
  'tab-right': { pan: 1, amp: 0.45, ms: 40, kind: 'click' },
  launch: { pan: 0, amp: 1, ms: 480, kind: 'sweep' },
  star: { pan: 0, amp: 0.5, ms: 50, kind: 'click' },
  error: { pan: 0, amp: 0.6, ms: 120, kind: 'thud' },
};

let nativeChecked: { at: number; ok: Promise<boolean> } | null = null;
let menuLevel: RumbleLevel = 'strong';

/** The rumble level menu pulses use (the player's setting). */
export function setMenuRumble(level: RumbleLevel) {
  menuLevel = level;
}

/**
 * A short pulse for a menu action, on the controller in use only (a mouse or keyboard user
 * feels nothing). DualSense haptics play it natively when available.
 */
export function menuPulse(kind: MenuPulse) {
  const k = RUMBLE_SCALE[menuLevel];
  const snap = pads.snapshot();
  if (k <= 0 || snap.lastDevice !== 'pad') return;
  const pad = snap.pads.find((p) => p.index === snap.lastPad);
  if (!pad) return;
  const e = MENU_PULSES[kind];
  if (pad.family === 'ps5') {
    // Re-check now and then: the controller may have been plugged in by cable since.
    if (!nativeChecked || performance.now() - nativeChecked.at > 5000) nativeChecked = { at: performance.now(), ok: dualSenseHaptics() };
    void nativeChecked.ok.then((ok) => (ok ? nativePlay(e, k) : rumblePad(pad.index, e, k)));
    return;
  }
  rumblePad(pad.index, e, k);
}
