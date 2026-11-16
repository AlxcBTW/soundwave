import type { DrumHit, PitchedNote } from '../analysis/types';
import type { Chart } from '../chart/types';
import { LANE_COLORS } from '../render/Highway';
import { CATEGORIES, type Annotation } from './annotations';

/** Min/max sample per bucket for drawing a waveform quickly. */
export interface Peaks {
  perSec: number;
  min: Float32Array;
  max: Float32Array;
}

export function computePeaks(buffer: AudioBuffer, perSec = 200): Peaks {
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(buffer.sampleRate / perSec));
  const n = Math.ceil(data.length / step);
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    let lo = 0;
    let hi = 0;
    const end = Math.min(data.length, (b + 1) * step);
    for (let i = b * step; i < end; i++) {
      const v = data[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { perSec: buffer.sampleRate / step, min, max };
}

export interface TimelineData {
  chart: Chart;
  /** The part's source notes (transcription after line extraction). */
  source: PitchedNote[];
  drums?: DrumHit[];
  peaks?: Peaks;
  annotations: Annotation[];
}

export interface Selection {
  notes: Set<number>;
  range?: [number, number];
}

const CAT_COLORS: Record<string, string> = {
  missing: '#3ad4ff',
  extra: '#ff5c7a',
  timing: '#ffb84d',
  lane: '#b48cff',
  pitch: '#7dffa0',
  chord: '#ff8af0',
  sustain: '#ffe66d',
  density: '#ff8a1f',
  other: '#d0d0d0',
};

const RULER = 22;
const PITCH = 120;
const LANE_H = 30;
const WAVE = 56;
const GAP = 8;

/**
 * Debug timeline: beat grid, the part's source notes (by pitch), the chart's lanes, the audio
 * waveform and annotation ranges, with the playhead. Pure canvas; the screen handles input.
 */
export class Timeline {
  private readonly g: CanvasRenderingContext2D;
  data: TimelineData | null = null;
  selection: Selection = { notes: new Set() };
  /** Left edge of the view (seconds) and zoom. */
  viewStart = 0;
  pxPerSec = 120;
  private w = 0;
  private h = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!;
  }

  get height() {
    const lanes = this.data?.chart.lanes ?? 5;
    return RULER + PITCH + GAP + lanes * LANE_H + GAP + WAVE + 4;
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = this.canvas.clientWidth;
    this.h = this.height;
    this.canvas.style.height = `${this.h}px`;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  get visibleSeconds() {
    return this.w / this.pxPerSec;
  }

  x(t: number) {
    return (t - this.viewStart) * this.pxPerSec;
  }

  timeAt(x: number) {
    return this.viewStart + x / this.pxPerSec;
  }

  /** Highest lane on top, so lane moves read in the same direction as the pitch strip. */
  private laneTop(lane: number) {
    const lanes = this.data?.chart.lanes ?? 5;
    return RULER + PITCH + GAP + (lanes - 1 - lane) * LANE_H;
  }

  /** Index of the chart note under (x, y), if any. */
  noteAt(x: number, y: number): number | null {
    const c = this.data?.chart;
    if (!c) return null;
    for (let i = c.notes.length - 1; i >= 0; i--) {
      const n = c.notes[i];
      const top = this.laneTop(n.lane);
      if (y < top || y > top + LANE_H) continue;
      const x0 = this.x(n.t) - 5;
      const x1 = Math.max(this.x(n.t + n.dur), this.x(n.t) + 10);
      if (x >= x0 && x <= x1) return i;
    }
    return null;
  }

  inRuler(y: number) {
    return y < RULER;
  }

  draw(playhead: number) {
    const { g, w, h } = this;
    const d = this.data;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#0b0820';
    g.fillRect(0, 0, w, h);
    if (!d) return;
    const c = d.chart;
    const t0 = this.viewStart;
    const t1 = t0 + this.visibleSeconds;

    // Annotation ranges behind everything.
    for (const a of d.annotations) {
      if (a.part !== c.part || a.difficulty !== c.difficulty) continue;
      if (a.range.end < t0 || a.range.start > t1) continue;
      const x0 = this.x(a.range.start);
      const x1 = Math.max(x0 + 3, this.x(a.range.end));
      g.fillStyle = `${CAT_COLORS[a.category] ?? '#fff'}22`;
      g.fillRect(x0, RULER, x1 - x0, h - RULER);
      g.fillStyle = CAT_COLORS[a.category] ?? '#fff';
      g.fillRect(x0, RULER, x1 - x0, 3);
      g.font = '600 10px system-ui';
      g.fillText(CATEGORIES.find((k) => k.id === a.category)?.label ?? a.category, x0 + 3, RULER + 14);
    }

    // Beat grid and bar numbers.
    const downs = new Set(c.downbeats);
    g.font = '11px system-ui';
    c.beats.forEach((b, i) => {
      if (b < t0 - 1 || b > t1 + 1) return;
      const x = this.x(b);
      const bar = downs.has(i);
      g.strokeStyle = bar ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.09)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x + 0.5, RULER);
      g.lineTo(x + 0.5, h);
      g.stroke();
      if (bar) {
        g.fillStyle = 'rgba(255,255,255,0.6)';
        g.fillText(String(c.downbeats.indexOf(i) + 1), x + 3, 15);
      }
    });
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(0, 0, w, RULER);

    // Source notes by pitch (or drum hits by kind).
    const py = RULER;
    g.fillStyle = 'rgba(255,255,255,0.03)';
    g.fillRect(0, py, w, PITCH);
    if (c.part === 'drums' && d.drums) {
      const rows = { kick: 0, snare: 1, hat: 2 } as const;
      for (const hit of d.drums) {
        if (hit.t < t0 - 0.1 || hit.t > t1) continue;
        const y = py + 20 + rows[hit.kind] * 35;
        g.fillStyle = ['#3ddc5a', '#ffd23d', '#ff8a1f'][rows[hit.kind]];
        g.globalAlpha = 0.3 + hit.strength * 0.7;
        g.beginPath();
        g.arc(this.x(hit.t), y, 4, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.fillText('kick', 4, py + 24);
      g.fillText('snare', 4, py + 59);
      g.fillText('hat', 4, py + 94);
    } else if (d.source.length) {
      const pitches = d.source.flatMap((n) => n.chord ?? [n.midi]);
      const lo = Math.min(...pitches) - 1;
      const hi = Math.max(...pitches) + 1;
      const yOf = (m: number) => py + PITCH - 6 - ((m - lo) / Math.max(1, hi - lo)) * (PITCH - 12);
      for (const n of d.source) {
        if (n.t + n.dur < t0 || n.t > t1) continue;
        const x0 = this.x(n.t);
        const x1 = Math.max(x0 + 3, this.x(n.t + n.dur));
        for (const m of n.chord ?? [n.midi]) {
          g.fillStyle = m === n.midi ? `rgba(160,220,255,${0.35 + 0.65 * n.strength})` : 'rgba(160,220,255,0.25)';
          g.fillRect(x0, yOf(m) - 2, x1 - x0, 4);
        }
      }
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.fillText(`pitch ${lo + 1}–${hi - 1}`, 4, py + 12);
    }

    // Lanes and chart notes.
    for (let l = 0; l < c.lanes; l++) {
      g.fillStyle = l % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.05)';
      g.fillRect(0, this.laneTop(l), w, LANE_H);
    }
    c.notes.forEach((n, i) => {
      if (n.t + n.dur < t0 - 0.1 || n.t > t1) return;
      const top = this.laneTop(n.lane);
      const x = this.x(n.t);
      const color = `#${LANE_COLORS[n.lane].toString(16).padStart(6, '0')}`;
      if (n.dur > 0) {
        g.fillStyle = `${color}88`;
        g.fillRect(x, top + LANE_H / 2 - 4, this.x(n.t + n.dur) - x, 8);
      }
      g.fillStyle = n.phrase >= 0 ? '#eaf6ff' : color;
      g.beginPath();
      g.roundRect(x - 5, top + 5, 10, LANE_H - 10, 3);
      g.fill();
      if (this.selection.notes.has(i)) {
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2;
        g.strokeRect(x - 7, top + 3, 14, LANE_H - 6);
      }
    });

    // Waveform of what is playing.
    const wy = RULER + PITCH + GAP + c.lanes * LANE_H + GAP;
    g.fillStyle = 'rgba(255,255,255,0.03)';
    g.fillRect(0, wy, w, WAVE);
    if (d.peaks) {
      const mid = wy + WAVE / 2;
      g.fillStyle = 'rgba(139,92,255,0.75)';
      for (let x = 0; x < w; x++) {
        const b = Math.floor(this.timeAt(x) * d.peaks.perSec);
        if (b < 0 || b >= d.peaks.max.length) continue;
        const top = mid - d.peaks.max[b] * (WAVE / 2);
        const bot = mid - d.peaks.min[b] * (WAVE / 2);
        g.fillRect(x, top, 1, Math.max(1, bot - top));
      }
    }

    // Selection range.
    if (this.selection.range) {
      const [a, b] = this.selection.range;
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(this.x(a), RULER, this.x(b) - this.x(a), h - RULER);
      g.strokeStyle = 'rgba(255,255,255,0.6)';
      g.strokeRect(this.x(a) + 0.5, RULER + 0.5, this.x(b) - this.x(a), h - RULER - 1);
    }

    // Playhead.
    const px = this.x(playhead);
    g.strokeStyle = '#3ad4ff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px, 0);
    g.lineTo(px, h);
    g.stroke();
  }
}
