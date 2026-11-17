/** Live bass / mid / treble levels of whatever the engine plays, 0..1, relative to the recent mix. */
export interface BandLevels {
  low: number;
  mid: number;
  high: number;
}

export class BandMeter {
  private analyser: AnalyserNode | null = null;
  private freq: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  readonly levels: BandLevels = { low: 0, mid: 0, high: 0 };
  private readonly avg: BandLevels = { low: 0.2, mid: 0.2, high: 0.2 };
  private readonly t0 = performance.now();

  setAnalyser(a: AnalyserNode | null) {
    this.analyser = a;
    this.freq = new Uint8Array(new ArrayBuffer(a ? a.frequencyBinCount : 0));
  }

  update(dt: number): Readonly<BandLevels> {
    const lv = this.levels;
    if (!this.analyser) {
      const t = (performance.now() - this.t0) / 1000;
      lv.low = 0.25 + 0.1 * Math.sin(t * 1.3);
      lv.mid = 0.25 + 0.1 * Math.sin(t * 0.7);
      lv.high = 0.2;
      return lv;
    }
    this.analyser.getByteFrequencyData(this.freq);
    const binHz = this.analyser.context.sampleRate / this.analyser.fftSize;
    const band = (lo: number, hi: number) => {
      const a = Math.max(1, Math.floor(lo / binHz));
      const b = Math.min(this.freq.length - 1, Math.ceil(hi / binHz));
      let s = 0;
      for (let i = a; i <= b; i++) s += this.freq[i];
      return s / ((b - a + 1) * 255);
    };
    const raw = { low: band(30, 160), mid: band(300, 2500), high: band(5000, 14000) };
    const k = Math.min(1, dt * 1.5);
    for (const key of ['low', 'mid', 'high'] as const) {
      this.avg[key] += (raw[key] - this.avg[key]) * k;
      // Emphasize the level relative to its recent average so quiet songs still move.
      const rel = Math.max(0, raw[key] - this.avg[key] * 0.8) / Math.max(0.08, this.avg[key]);
      const target = Math.min(1, raw[key] * 0.6 + rel * 0.6);
      lv[key] += (target - lv[key]) * Math.min(1, dt * (target > lv[key] ? 25 : 6));
    }
    return lv;
  }
}
