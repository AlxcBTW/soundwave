import type { AudioEngine } from '../audio/AudioEngine';

export interface Tick {
  /** Song time in seconds. */
  t: number;
  kind: 'note' | 'beat' | 'bar';
}

const VOICE: Record<Tick['kind'], { hz: number; level: number; ms: number }> = {
  note: { hz: 1800, level: 0.5, ms: 35 },
  beat: { hz: 880, level: 0.4, ms: 45 },
  bar: { hz: 1320, level: 0.55, ms: 60 },
};

/**
 * Short clicks in time with the song while it plays in the editor: one on every note, so timing can
 * be heard, and a metronome on the beat. They are scheduled a little ahead on the audio clock and
 * leave through the song's own volume.
 */
export class Clicks {
  private timer = 0;
  private until = -Infinity;
  private readonly nodes = new Set<AudioScheduledSourceNode>();

  /** `between` gives the ticks that fall in a stretch of song time (from exclusive, to inclusive). */
  constructor(
    private readonly engine: AudioEngine,
    private readonly between: (from: number, to: number) => Tick[],
  ) {}

  start() {
    this.stop();
    this.until = this.engine.time() - 0.01;
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  /** Forgets what was scheduled (after a seek, a change of speed or a change to the notes). */
  reset() {
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    this.nodes.clear();
    this.until = this.engine.time() - 0.01;
  }

  stop() {
    clearInterval(this.timer);
    this.timer = 0;
    this.reset();
  }

  private tick() {
    if (!this.engine.isPlaying) return;
    const now = this.engine.time();
    const to = now + 0.2 * this.engine.playbackRate;
    const ctx = this.engine.ctx;
    for (const tick of this.between(Math.max(this.until, now - 0.05), to)) {
      const when = this.engine.contextTimeFor(tick.t);
      if (when < ctx.currentTime) continue;
      const v = VOICE[tick.kind];
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = v.hz;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(v.level, when + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + v.ms / 1000);
      osc.connect(gain).connect(this.engine.gain);
      osc.start(when);
      osc.stop(when + v.ms / 1000 + 0.005);
      osc.onended = () => this.nodes.delete(osc);
      this.nodes.add(osc);
    }
    this.until = Math.max(this.until, to);
  }
}
