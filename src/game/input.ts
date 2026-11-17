import { pads, PAUSE_INPUT, type PadInput } from '../input/pads';

export interface InputHandlers {
  press(lane: number, timeStamp: number): void;
  release(lane: number, timeStamp: number): void;
  overdrive(): void;
  pause(): void;
}

/** Maps keyboard codes to lanes. Timestamps are performance.now()-based. */
export class KeyboardInput {
  private readonly map = new Map<string, number>();

  constructor(
    keys: string[],
    private readonly overdriveKey: string,
    private readonly h: InputHandlers,
  ) {
    keys.forEach((k, i) => this.map.set(k, i));
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
    window.addEventListener('blur', this.blur);
  }

  private readonly down = (e: KeyboardEvent) => {
    if (e.code === 'Escape') {
      e.preventDefault();
      this.h.pause();
      return;
    }
    if (e.repeat) {
      if (this.map.has(e.code) || e.code === this.overdriveKey) e.preventDefault();
      return;
    }
    const lane = this.map.get(e.code);
    if (lane !== undefined) {
      e.preventDefault();
      this.h.press(lane, e.timeStamp);
    } else if (e.code === this.overdriveKey) {
      e.preventDefault();
      this.h.overdrive();
    }
  };

  private readonly up = (e: KeyboardEvent) => {
    const lane = this.map.get(e.code);
    if (lane !== undefined) this.h.release(lane, e.timeStamp);
  };

  private readonly blur = () => {
    const now = performance.now();
    for (const lane of this.map.values()) this.h.release(lane, now);
  };

  dispose() {
    window.removeEventListener('keydown', this.down);
    window.removeEventListener('keyup', this.up);
    window.removeEventListener('blur', this.blur);
  }
}

/**
 * Maps controller inputs to lanes. While `active()` is false (paused) only the pause button is
 * handled and everything else goes on to menu navigation.
 */
export class GamepadInput {
  private readonly map = new Map<PadInput, number>();
  private readonly release: () => void;

  constructor(
    bindings: PadInput[],
    private readonly overdriveInput: PadInput,
    private readonly h: InputHandlers,
    private readonly active: () => boolean,
  ) {
    bindings.forEach((b, i) => this.map.set(b, i));
    this.release = pads.capture((e) => {
      if (e.input === PAUSE_INPUT) {
        if (e.down) this.h.pause();
        return true;
      }
      if (!this.active()) return false;
      const lane = this.map.get(e.input);
      if (lane !== undefined) {
        if (e.down) this.h.press(lane, e.t);
        else this.h.release(lane, e.t);
      } else if (e.input === this.overdriveInput && e.down) this.h.overdrive();
      return true;
    });
  }

  dispose() {
    this.release();
  }
}

/**
 * Touch: every finger that lands on the layer plays the lane under it (`laneAt` maps a point,
 * relative to the layer, to a lane, or -1) and lets it go when it lifts. Several fingers at once
 * are chords; a mouse is ignored.
 */
export class TouchInput {
  private readonly fingers = new Map<number, number>();

  constructor(
    private readonly el: HTMLElement,
    private readonly laneAt: (x: number, y: number) => number,
    private readonly h: InputHandlers,
    private readonly onLane: (lane: number, down: boolean) => void,
  ) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
  }

  private readonly down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    const box = this.el.getBoundingClientRect();
    const lane = this.laneAt(e.clientX - box.left, e.clientY - box.top);
    if (lane < 0) return;
    const held = [...this.fingers.values()].includes(lane);
    this.fingers.set(e.pointerId, lane);
    if (held) return;
    this.h.press(lane, e.timeStamp);
    this.onLane(lane, true);
  };

  private readonly up = (e: PointerEvent) => {
    const lane = this.fingers.get(e.pointerId);
    if (lane === undefined) return;
    this.fingers.delete(e.pointerId);
    if ([...this.fingers.values()].includes(lane)) return;
    this.h.release(lane, e.timeStamp);
    this.onLane(lane, false);
  };

  dispose() {
    this.el.removeEventListener('pointerdown', this.down);
    this.el.removeEventListener('pointerup', this.up);
    this.el.removeEventListener('pointercancel', this.up);
    for (const lane of new Set(this.fingers.values())) this.onLane(lane, false);
    this.fingers.clear();
  }
}
