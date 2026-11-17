/**
 * Controller feedback: rumble through the Gamepad API on every controller that supports it, and
 * on a PS5 DualSense connected by USB in the desktop app, its haptic actuators driven natively
 * (src-tauri/src/haptics.rs): positional, textured feedback instead of plain rumble.
 */
import { invoke } from '@tauri-apps/api/core';
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

let holdIds = 1;

/** Game feedback for one play-through (or a settings test). */
export class Rumbler {
  /** Native DualSense haptics are open: PS5 controllers get those instead of rumble. */
  private native = false;
  private held = new Map<number, number>();
  private holdTimer = 0;
  private disposed = false;
  private readonly checked: Promise<boolean>;

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

  hit(lane: number) {
    if (this.s.rumbleHits) this.fire({ pan: this.panFor(lane), amp: 1, ms: 55, kind: 'click', input: this.bindings[lane] });
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

  overdrive() {
    if (this.s.rumbleOverdrive) this.fire({ pan: 0, amp: 1, ms: 450, kind: 'sweep' });
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
    clearTimeout(this.holdTimer);
    for (const p of pads.snapshot().pads) void actuator(p.index)?.reset?.().catch(() => {});
  }
}
