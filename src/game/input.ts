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
