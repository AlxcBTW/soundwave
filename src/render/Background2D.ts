import { BandMeter, type BandLevels } from '../audio/bands';

/**
 * Simple music-reactive 2D backdrop: gradient sky, stage glow, sweeping light beams,
 * sparkles and a crowd silhouette. Live band levels come from an AnalyserNode.
 * The fallback when the 3D stage is off.
 */
export type { BandLevels };

const STAR_COUNT = 140;

export class Background2D {
  private readonly g: CanvasRenderingContext2D;
  private readonly meter = new BandMeter();
  private readonly stars = new Float32Array(STAR_COUNT * 3);
  private crowd: Float32Array = new Float32Array(0);
  private accent = 0;
  private hue = 265;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private last = performance.now();
  private readonly t0 = performance.now();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!;
    for (let i = 0; i < STAR_COUNT; i++) {
      this.stars[i * 3] = Math.random();
      this.stars[i * 3 + 1] = Math.random() * 0.7;
      this.stars[i * 3 + 2] = Math.random();
    }
    this.resize();
  }

  setAnalyser(a: AnalyserNode | null) {
    this.meter.setAnalyser(a);
  }

  /** Short flash, e.g. on a downbeat or overdrive activation. */
  kick(amount = 1) {
    this.accent = Math.max(this.accent, amount);
  }

  get bands(): Readonly<BandLevels> {
    return this.meter.levels;
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    const n = Math.ceil(this.w / 18) + 2;
    this.crowd = new Float32Array(n);
    for (let i = 0; i < n; i++) this.crowd[i] = Math.random();
  }

  render() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = (now - this.t0) / 1000;
    this.meter.update(dt);
    this.accent = Math.max(0, this.accent - dt * 3);
    const { low, mid, high } = this.meter.levels;
    const g = this.g;
    const w = this.w;
    const h = this.h;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Sky: mids slowly push the hue around.
    this.hue += (250 + mid * 70 - this.hue) * Math.min(1, dt * 0.8);
    const hue = this.hue;
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, `hsl(${hue + 20}, 70%, ${6 + low * 6}%)`);
    sky.addColorStop(0.6, `hsl(${hue}, 75%, ${12 + low * 10 + this.accent * 6}%)`);
    sky.addColorStop(1, `hsl(${hue - 30}, 80%, ${18 + low * 14}%)`);
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);

    // Sparkles respond to highs.
    for (let i = 0; i < STAR_COUNT; i++) {
      const x = this.stars[i * 3] * w;
      const y = this.stars[i * 3 + 1] * h;
      const p = this.stars[i * 3 + 2];
      const tw = 0.3 + 0.7 * Math.abs(Math.sin(t * (1 + p * 3) + p * 10));
      const a = Math.min(1, tw * (0.25 + high * 1.4));
      g.fillStyle = `rgba(255,255,255,${a})`;
      const r = 0.6 + p * 1.4 + high * 1.5 * p;
      g.fillRect(x - r / 2, y - r / 2, r, r);
    }

    // Stage glow pulses with the bass.
    const cx = w / 2;
    const cy = h * 0.62;
    const glowR = Math.max(w, h) * (0.35 + low * 0.25 + this.accent * 0.1);
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    glow.addColorStop(0, `hsla(${hue + 60}, 100%, 65%, ${0.25 + low * 0.45 + this.accent * 0.2})`);
    glow.addColorStop(1, 'hsla(0,0%,0%,0)');
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);

    // Light beams sweep; intensity follows the bass, spread follows the mids.
    const beams = 6;
    for (let i = 0; i < beams; i++) {
      const side = i < beams / 2 ? -1 : 1;
      const k = i % (beams / 2);
      const ox = cx + side * w * (0.18 + k * 0.14);
      const oy = h * 0.95;
      const ang = -Math.PI / 2 + side * (0.25 + 0.2 * Math.sin(t * (0.6 + k * 0.25) + i)) * (0.8 + mid);
      const len = h * 1.3;
      const spread = 0.05 + mid * 0.04;
      const a = 0.06 + low * 0.22 + this.accent * 0.15;
      const beamHue = hue + 40 + k * 40;
      const grad = g.createLinearGradient(ox, oy, ox + Math.cos(ang) * len, oy + Math.sin(ang) * len);
      grad.addColorStop(0, `hsla(${beamHue}, 100%, 70%, ${a})`);
      grad.addColorStop(1, `hsla(${beamHue}, 100%, 70%, 0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(ox, oy);
      g.lineTo(ox + Math.cos(ang - spread) * len, oy + Math.sin(ang - spread) * len);
      g.lineTo(ox + Math.cos(ang + spread) * len, oy + Math.sin(ang + spread) * len);
      g.closePath();
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';

    // Crowd silhouette bounces with the bass.
    g.fillStyle = `hsl(${hue - 20}, 50%, 4%)`;
    g.beginPath();
    g.moveTo(0, h);
    const step = 18;
    for (let i = 0; i < this.crowd.length; i++) {
      const r = this.crowd[i];
      const x = i * step - 9;
      const bounce = Math.max(0, Math.sin(t * 8 + r * 6)) * (4 + low * 16) * (0.4 + r);
      const head = h - 40 - r * 22 - bounce;
      g.lineTo(x, h - 28 - bounce * 0.5);
      g.arc(x + step / 2, head, 7 + r * 3, Math.PI, 0);
      g.lineTo(x + step, h - 28 - bounce * 0.5);
    }
    g.lineTo(w, h);
    g.closePath();
    g.fill();
  }
}
