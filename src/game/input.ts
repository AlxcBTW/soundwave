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
