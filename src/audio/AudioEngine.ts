/**
 * Owns the AudioContext and playback of one song. The context's output clock is
 * the master game clock: everything else asks this class for song time.
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;
  readonly gain: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  /** Context time at which song time 0 is heard. */
  private startCtxTime = 0;
  private pausedAt = 0;
  private playing = false;
  /** User calibration in seconds; positive = audio is heard later than reported. */
  offset = 0;
  onEnded: (() => void) | null = null;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.gain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.6;
    this.gain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  set volume(v: number) {
    this.gain.gain.value = v;
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(data.slice(0));
  }

  load(buffer: AudioBuffer) {
    this.stopSource();
    this.buffer = buffer;
    this.pausedAt = 0;
    this.playing = false;
  }

  get duration() {
    return this.buffer?.duration ?? 0;
  }

  get isPlaying() {
    return this.playing;
  }

  /** Starts playback so that song time `from` is heard `delay` seconds from now. Negative `from` = lead-in. */
  async play(from = this.pausedAt, delay = 0.1) {
    if (!this.buffer) return;
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.stopSource();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain);
    const startAt = this.ctx.currentTime + delay;
    this.startCtxTime = startAt - from;
    if (from >= 0) src.start(startAt, from);
    else src.start(startAt - from, 0);
    src.onended = () => {
      if (this.source === src && this.playing) {
        this.playing = false;
        this.onEnded?.();
      }
    };
    this.source = src;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.pausedAt = this.time();
    this.playing = false;
    this.stopSource();
  }

  stop() {
    this.playing = false;
    this.pausedAt = 0;
    this.stopSource();
  }

  /** Context time currently reaching the speakers, mapped to a performance.now() timestamp. */
  private heardContextTime(perfNow?: number) {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      const now = perfNow ?? performance.now();
      return ts.contextTime + (now - ts.performanceTime) / 1000;
    }
    return this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
  }

  /** Song time in seconds as heard by the player at `perfNow` (defaults to now). */
  time(perfNow?: number) {
    if (!this.playing) return this.pausedAt;
    return this.heardContextTime(perfNow) - this.startCtxTime - this.offset;
  }

  private stopSource() {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
  }

  dispose() {
    this.stop();
    void this.ctx.close();
  }
}
