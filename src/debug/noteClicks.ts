import type { AudioEngine } from '../audio/AudioEngine';
import type { Note } from '../chart/types';

/**
 * Plays a short tick at every chart note while the song plays, so timing problems are audible.
 * Ticks are scheduled a little ahead on the audio clock and go through the engine's volume.
 */
export class NoteClicks {
  private timer = 0;
  private scheduledUntil = -Infinity;
  private readonly nodes = new Set<AudioScheduledSourceNode>();

  constructor(
    private readonly engine: AudioEngine,
    private notes: Note[],
  ) {}

  setNotes(notes: Note[]) {
    this.notes = notes;
    this.reset();
  }

  start() {
    this.stop();
    this.scheduledUntil = this.engine.time() - 0.01;
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  /** Forget what was scheduled (after a seek or speed change). */
  reset() {
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    this.nodes.clear();
    this.scheduledUntil = this.engine.time() - 0.01;
  }

  stop() {
    clearInterval(this.timer);
    this.reset();
  }

  private tick() {
    if (!this.engine.isPlaying) return;
    const now = this.engine.time();
    const until = now + 0.2 * this.engine.playbackRate;
    const ctx = this.engine.ctx;
    const times = new Set<number>();
    for (const n of this.notes) if (n.t > this.scheduledUntil && n.t <= until) times.add(n.t);
    for (const t of times) {
      const when = this.engine.contextTimeFor(t);
      if (when < ctx.currentTime) continue;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 1800;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(0.5, when + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);
      osc.connect(gain).connect(this.engine.gain);
      osc.start(when);
      osc.stop(when + 0.04);
      osc.onended = () => this.nodes.delete(osc);
      this.nodes.add(osc);
    }
    this.scheduledUntil = Math.max(this.scheduledUntil, until);
  }
}
