/**
 * Keeps the 3D stage within what the graphics chip can spare.
 *
 * The stage draws in a worker of its own, so it never holds up the page's own work. The graphics
 * chip, though, is shared by everything on screen: the menus, the highway and the stage. A stage
 * that asks for more of it than there is makes everything else wait, and nothing lets the page put
 * the menus first. So the stage measures how long the chip takes over each of its frames and keeps
 * its share of the chip's time in bounds: when it takes too much it steps down a rung (fewer frames
 * a second, a smaller picture), when there is room again it steps back up. A machine that can take
 * the full show never leaves the top rung.
 */

/** How the stage draws: its picture's scale (1 = as set) and frames a second (0 = every frame the display shows). */
export interface Pace {
  scale: number;
  fps: number;
}

export interface GovernorOptions {
  /** The frame rate set (0 = the display's). */
  fpsCap: number;
  /** Sharpness may go before smoothness (the Adaptive resolution setting); otherwise the other way round. */
  adaptiveResolution: boolean;
}

/** Above this share of the chip's time the stage steps down; below the second it may step up. */
const TOO_MUCH = 0.6;
const ROOM = 0.45;
/** Seconds between decisions, how many in a row it takes to step down or up, and the longest wait after a step up that failed. */
const EVERY = 0.5;
const DOWN_AFTER = 2;
const UP_AFTER = 6;
const MAX_BACKOFF = 8;
const SCALES = [0.9, 0.8, 0.7, 0.6, 0.5];

/** The rungs from the full show down, for these settings. */
export function rungs({ fpsCap, adaptiveResolution }: GovernorOptions): Pace[] {
  const out: Pace[] = [{ scale: 1, fps: fpsCap }];
  // Every frame of a fast display first goes down to 60 (a backdrop needs no more).
  if (fpsCap === 0 || fpsCap > 60) out.push({ scale: 1, fps: 60 });
  const top = Math.min(60, fpsCap || 60);
  const slower = [30, 20].filter((f) => f < top);
  if (adaptiveResolution) {
    for (const scale of SCALES) out.push({ scale, fps: top });
    for (const fps of slower) out.push({ scale: SCALES.at(-1)!, fps });
  } else {
    for (const fps of slower) out.push({ scale: 1, fps });
    for (const scale of SCALES) out.push({ scale, fps: slower.at(-1) ?? top });
  }
  return out;
}

export class Governor {
  readonly rungs: Pace[];
  private rung = 0;
  /** The chip's time per frame of the stage, ms (smoothed), and how many frames the stage draws a second. */
  private gpuMs = 0;
  private drawn = 0;
  private lastDrawn = 0;
  private drawnRate = 60;
  /** The display's own rate, from the shortest gaps between frames. */
  private displayHz = 60;
  private since = 0;
  private over = 0;
  private under = 0;
  /** After a step up that had to be taken back, it waits longer before trying again. */
  private backoff = 1;
  private steppedUpAt = -Infinity;
  private clock = 0;

  constructor(options: GovernorOptions) {
    this.rungs = rungs(options);
  }

  get pace(): Pace {
    return this.rungs[this.rung];
  }

  /** The chip's share of time going to the stage now (0..1, more when its frames queue up). */
  get share(): number {
    return (this.gpuMs * this.drawnRate) / 1000;
  }

  /** A frame the display showed (drawn or skipped by the frame cap), `gap` ms after the last. */
  tick(gap: number) {
    if (gap > 2 && gap < 100) {
      const hz = 1000 / gap;
      // Up quickly to the display's rate, down slowly (a long gap is a busy moment, not a slower display).
      this.displayHz += (hz - this.displayHz) * (hz > this.displayHz ? 0.2 : 0.01);
    }
  }

  /** A frame the stage drew, at `now` ms. */
  frame(now: number) {
    if (this.lastDrawn) {
      const gap = now - this.lastDrawn;
      if (gap > 0 && gap < 1000) this.drawnRate += (1000 / gap - this.drawnRate) * 0.1;
    }
    this.lastDrawn = now;
    this.drawn++;
  }

  /** How long the chip took over one of the stage's frames, ms. */
  gpu(ms: number) {
    this.gpuMs = this.gpuMs ? this.gpuMs + (ms - this.gpuMs) * 0.15 : ms;
  }

  /**
   * Moves the clock on by `dt` seconds and decides now and then. Returns true when the pace changed.
   */
  update(dt: number): boolean {
    this.clock += dt;
    this.since += dt;
    if (this.since < EVERY || !this.gpuMs) return false;
    this.since = 0;
    const share = this.share;
    if (share > TOO_MUCH) {
      this.under = 0;
      if (++this.over < DOWN_AFTER || this.rung >= this.rungs.length - 1) return false;
      // A step up that is taken back soon after: try again later next time.
      if (this.clock - this.steppedUpAt < 4) this.backoff = Math.min(MAX_BACKOFF, this.backoff * 2);
      this.over = 0;
      this.rung++;
      return true;
    }
    this.over = 0;
    if (share < ROOM && this.rung > 0) {
      if (++this.under < UP_AFTER * this.backoff) return false;
      // Only when the rung above would still leave room.
      if (share * (this.cost(this.rung - 1) / this.cost(this.rung)) > TOO_MUCH * 0.9) return false;
      this.under = 0;
      this.rung--;
      this.steppedUpAt = this.clock;
      return true;
    }
    this.under = 0;
    if (this.clock - this.steppedUpAt > 30) this.backoff = 1;
    return false;
  }

  /** What a rung costs the chip, relative to the others: pixels times frames. */
  private cost(i: number): number {
    const { scale, fps } = this.rungs[i];
    return scale * scale * Math.min(fps || this.displayHz, this.displayHz);
  }
}

/**
 * Measures how long the graphics chip spends on each of the stage's frames. With GPU timer queries
 * (Chrome) that is the chip's own time for the frame's work. Without them (Safari), a fence after
 * the frame tells when the chip got through it: the time from handing the frame over to then, which
 * also counts any wait behind other work, so it reads a little high, and higher still when the
 * chip falls behind (which is what it is there to notice).
 */
export class GpuClock {
  private readonly timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private queries: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  private fences: { sync: WebGLSync; at: number }[] = [];
  private polling: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly report: (ms: number) => void,
  ) {
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as GpuClock['timer'];
  }

  /** Call before a frame's drawing. */
  begin() {
    this.collect();
    if (!this.timer || this.active || this.queries.length >= 4) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  /** Call after a frame's drawing. */
  end() {
    const gl = this.gl;
    if (this.timer) {
      if (!this.active) return;
      gl.endQuery(this.timer.TIME_ELAPSED_EXT);
      this.queries.push(this.active);
      this.active = null;
      return;
    }
    // A backlog of frames already means the chip is far behind: no need for more fences.
    if (this.fences.length >= 4) return;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) return;
    gl.flush();
    this.fences.push({ sync, at: performance.now() });
    this.poll();
  }

  /** Timer results that have come in. */
  private collect() {
    const gl = this.gl;
    if (!this.timer || !this.queries.length) return;
    // A disjoint event (the clock was reset, say) makes every result in flight meaningless.
    const disjoint = gl.getParameter(this.timer.GPU_DISJOINT_EXT) as boolean;
    while (this.queries.length) {
      const q = this.queries[0];
      if (!disjoint && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!disjoint) this.report((gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6);
      gl.deleteQuery(q);
      this.queries.shift();
    }
  }

  private readonly poll = () => {
    this.polling = null;
    const gl = this.gl;
    while (this.fences.length) {
      const f = this.fences[0];
      if (gl.getSyncParameter(f.sync, gl.SYNC_STATUS) !== gl.SIGNALED) break;
      this.report(performance.now() - f.at);
      gl.deleteSync(f.sync);
      this.fences.shift();
    }
    if (this.fences.length) this.polling = setTimeout(this.poll, 1);
  };

  dispose() {
    if (this.polling) clearTimeout(this.polling);
    for (const f of this.fences) this.gl.deleteSync(f.sync);
    for (const q of this.queries) this.gl.deleteQuery(q);
    if (this.active && this.timer) this.gl.endQuery(this.timer.TIME_ELAPSED_EXT);
    if (this.active) this.gl.deleteQuery(this.active);
    this.fences = [];
    this.queries = [];
    this.active = null;
  }
}
