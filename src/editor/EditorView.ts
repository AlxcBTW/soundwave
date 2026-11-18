/**
 * Draws a chart for editing: the lanes seen from above, running up the screen as they do in a
 * song, with later notes higher. One line across the lanes is "now": the edit position and the
 * playhead. The chart moves past it; the line stays where it is.
 *
 * Left of the lanes stand the bar numbers and the song's waveform; right of them, when the song has
 * been analyzed, a guide to what the game heard in this part. Pure canvas: the controller decides
 * what is shown and handles all input.
 */
import { PHRASE_KIND, tileColour, type TileBand } from '../render/tilePalette';
import type { ChartDoc, DocNote } from './doc';
import type { EditorGrid, Snap } from './grid';
import type { Peaks } from './peaks';

export const LANE_HEX = ['#3ddc5a', '#ff3b4e', '#ffd23d', '#3a8bff', '#ff8a1f'];

const INK = '#f6f3ff';
const LIT = '#efeaff';
const MINT = '#5df2d6';
const PINK = '#ff4d9d';
const ICE = '#bfe6ff';
const FONT = "'Archivo Variable', 'Archivo', system-ui, sans-serif";

/** A mark in the guide strip: something the game heard in this part. */
export interface GuideMark {
  pos: number;
  len: number;
  /** Across the strip, 0..1 (pitch from low to high, or the drum: kick, snare, hi-hat). */
  x: number;
  /** 0..1 */
  strength: number;
}

export interface Scene {
  grid: EditorGrid;
  doc: ChartDoc;
  /** The position on the now line, in beats. */
  viewPos: number;
  pxPerBeat: number;
  snap: Snap;
  /** The lane the cursor is in, shown as the focus ring on the now line (keyboard and controller). */
  lane: number | null;
  selection: ReadonlySet<number>;
  /** A marked stretch, in beats. */
  range: [number, number] | null;
  /** A note that would be set down here (under the mouse). */
  ghost: { pos: number; lane: number } | null;
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  playing: boolean;
  recording: boolean;
  /** Per lane: when it was last struck (performance.now), for the flash on the now line. */
  struck: number[];
  /** Per lane: the note being held while recording. */
  held: (number | null)[];
  peaks?: Peaks;
  guide?: GuideMark[];
  /** Where sounds start in the song, in beats, in order. */
  sounds?: readonly number[];
  /** The stretch playback goes round, when looping is on. */
  loop: [number, number] | null;
  /** Larger hit areas and no hover. */
  touch: boolean;
}

export interface Hit {
  zone: 'deck' | 'side' | 'out';
  lane: number;
  /** Position under the pointer, in beats (not snapped). */
  pos: number;
  /** The note whose head is under the pointer. */
  note?: DocNote;
}

interface Layout {
  w: number;
  h: number;
  /** Root font size in px: every size here scales with the interface. */
  u: number;
  labelX: number;
  labelW: number;
  waveX: number;
  waveW: number;
  deckX: number;
  deckW: number;
  laneW: number;
  guideX: number;
  guideW: number;
  nowY: number;
  noteH: number;
  noteW: number;
}

const mix = (hex: string, with_: string, k: number) => {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(with_.slice(1), 16);
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
  return `rgb(${ch(16)} ${ch(8)} ${ch(0)})`;
};
const LANE_RIM = LANE_HEX.map((c) => mix(c, '#ffffff', 0.55));
const LANE_DARK = LANE_HEX.map((c) => mix(c, '#0e0828', 0.45));

/** A colour of the highway's tiles (see tilePalette), as red, green and blue 0..255. */
type Rgb = [number, number, number];
const tile = (n: DocNote, b: TileBand): Rgb => {
  const c = tileColour(n.phrase >= 0 ? PHRASE_KIND : n.lane, b);
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
};
const blend = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const scale = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];
const css = (a: Rgb, alpha = 1) => `rgb(${a.map((v) => Math.round(Math.min(255, Math.max(0, v)))).join(' ')} / ${alpha})`;
const WHITE: Rgb = [255, 255, 255];

export class EditorView {
  private readonly g: CanvasRenderingContext2D;
  private lay: Layout = {
    w: 0,
    h: 0,
    u: 16,
    labelX: 0,
    labelW: 0,
    waveX: 0,
    waveW: 0,
    deckX: 0,
    deckW: 0,
    laneW: 0,
    guideX: 0,
    guideW: 0,
    nowY: 0,
    noteH: 0,
    noteW: 0,
  };
  private lanes = 5;
  private hasGuide = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!;
  }

  /** Fits the canvas to its box. Call when the box, the lane count or the guide changes. */
  resize(lanes = this.lanes, guide = this.hasGuide) {
    this.lanes = lanes;
    this.hasGuide = guide;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const u = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const narrow = w < u * 30;
    const wide = w > u * 46;
    const labelW = u * (narrow ? 1.7 : 2.2);
    const waveW = u * (narrow ? 2 : wide ? 4.4 : 3.2);
    const guideW = guide ? u * (narrow ? 1.9 : wide ? 4.4 : 3.2) : 0;
    const gap = u * 0.45;
    const room = w - labelW - waveW - guideW - gap * (guide ? 2 : 1) - 4;
    const laneW = Math.max(u * 1.6, Math.min(u * 6.6, room / lanes));
    const deckW = laneW * lanes;
    const total = labelW + waveW + gap + deckW + (guide ? gap + guideW : 0);
    const x0 = Math.max(2, (w - total) / 2);
    const noteH = Math.max(11, Math.min(u * 1.05, laneW * 0.34));
    this.lay = {
      w,
      h,
      u,
      labelX: x0,
      labelW,
      waveX: x0 + labelW,
      waveW,
      deckX: x0 + labelW + waveW + gap,
      deckW,
      laneW,
      guideX: x0 + labelW + waveW + gap + deckW + gap,
      guideW,
      nowY: Math.round(h * 0.72),
      noteH,
      noteW: laneW * 0.76,
    };
  }

  get layout(): Readonly<Layout> {
    return this.lay;
  }

  /** Where the now line sits, as a share of the height (the controller reads it for its overlays). */
  y(pos: number, s: { viewPos: number; pxPerBeat: number }) {
    return this.lay.nowY - (pos - s.viewPos) * s.pxPerBeat;
  }

  posAt(y: number, s: { viewPos: number; pxPerBeat: number }) {
    return s.viewPos + (this.lay.nowY - y) / s.pxPerBeat;
  }

  laneAt(x: number) {
    const l = Math.floor((x - this.lay.deckX) / this.lay.laneW);
    return l >= 0 && l < this.lanes ? l : -1;
  }

  /** Centre of a lane's target on the now line, in canvas px. */
  target(lane: number) {
    return { x: this.lay.deckX + (lane + 0.5) * this.lay.laneW, y: this.lay.nowY };
  }

  hit(x: number, y: number, s: Scene): Hit {
    const L = this.lay;
    const pos = this.posAt(y, s);
    const lane = this.laneAt(x);
    if (lane < 0) return { zone: x >= L.labelX && x <= L.guideX + L.guideW ? 'side' : 'out', lane, pos };
    // The head nearest the pointer in this lane, within reach.
    const reach = (s.touch ? Math.max(L.noteH * 0.5 + 8, 20) : L.noteH * 0.5 + 4) / s.pxPerBeat;
    let best: DocNote | undefined;
    let bestD = reach;
    const notes = s.doc.notes;
    for (let i = s.doc.firstFrom(pos - reach); i < notes.length && notes[i].pos <= pos + reach; i++) {
      const n = notes[i];
      if (n.lane !== lane) continue;
      const d = Math.abs(n.pos - pos);
      if (d <= bestD) {
        bestD = d;
        best = n;
      }
    }
    return { zone: 'deck', lane, pos, note: best };
  }

  /** Ids of the notes whose heads lie inside a rectangle. */
  notesIn(x0: number, y0: number, x1: number, y1: number, s: Scene): number[] {
    const L = this.lay;
    const [l, r] = x0 < x1 ? [x0, x1] : [x1, x0];
    const [t, b] = y0 < y1 ? [y0, y1] : [y1, y0];
    const from = this.posAt(b, s);
    const to = this.posAt(t, s);
    const out: number[] = [];
    const notes = s.doc.notes;
    for (let i = s.doc.firstFrom(from); i < notes.length && notes[i].pos <= to; i++) {
      const cx = L.deckX + (notes[i].lane + 0.5) * L.laneW;
      if (cx >= l - L.noteW / 2 && cx <= r + L.noteW / 2) out.push(notes[i].id);
    }
    return out;
  }

  draw(s: Scene) {
    const { g } = this;
    const L = this.lay;
    if (!L.w || !L.h) return;
    g.clearRect(0, 0, L.w, L.h);
    const top = this.posAt(0, s);
    const bottom = this.posAt(L.h, s);
    const y = (pos: number) => L.nowY - (pos - s.viewPos) * s.pxPerBeat;
    const songTop = Math.max(0, y(s.grid.end));
    const songBottom = Math.min(L.h, y(s.grid.start));

    this.drawSides(s, songTop, songBottom);

    // The deck: one column per lane, a breath apart in tone, with lit rails.
    for (let l = 0; l < this.lanes; l++) {
      g.fillStyle = l % 2 ? 'rgb(44 28 136 / 0.94)' : 'rgb(37 23 118 / 0.94)';
      g.fillRect(L.deckX + l * L.laneW, 0, L.laneW, L.h);
    }
    // Violet glass: a little lighter toward both rails, darkest down the middle.
    const glass = g.createLinearGradient(L.deckX, 0, L.deckX + L.deckW, 0);
    glass.addColorStop(0, 'rgb(150 128 255 / 0.16)');
    glass.addColorStop(0.5, 'rgb(8 5 26 / 0.14)');
    glass.addColorStop(1, 'rgb(150 128 255 / 0.16)');
    g.fillStyle = glass;
    g.fillRect(L.deckX, 0, L.deckW, L.h);
    // The lane the cursor is in is a touch lighter all the way up, so it reads from across a room.
    if (s.lane !== null && !s.recording) {
      g.fillStyle = 'rgb(239 234 255 / 0.07)';
      g.fillRect(L.deckX + s.lane * L.laneW, 0, L.laneW, L.h);
    }
    // Outside the song there is nothing to chart.
    g.fillStyle = 'rgb(8 5 26 / 0.62)';
    if (songTop > 0) g.fillRect(L.deckX, 0, L.deckW, songTop);
    if (songBottom < L.h) g.fillRect(L.deckX, songBottom, L.deckW, L.h - songBottom);

    // Grid: snap lines where there is room, beats, bars.
    const sub = s.pxPerBeat / s.snap;
    const first = Math.max(Math.floor(s.grid.start), Math.floor(bottom) - 1);
    const last = Math.min(Math.ceil(s.grid.end), Math.ceil(top) + 1);
    g.lineWidth = 1;
    if (sub >= 7 && s.snap > 1) {
      g.strokeStyle = 'rgb(210 201 250 / 0.1)';
      g.beginPath();
      for (let b = first; b <= last; b++) {
        for (let k = 1; k < s.snap; k++) {
          const yy = Math.round(y(b + k / s.snap)) + 0.5;
          if (yy < songTop || yy > songBottom) continue;
          g.moveTo(L.deckX, yy);
          g.lineTo(L.deckX + L.deckW, yy);
        }
      }
      g.stroke();
    }
    g.font = `italic 900 ${Math.round(L.u * 0.8)}px ${FONT}`;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    let barNo = -1;
    let beatNo = s.grid.barBeat(first).beat - 1;
    const beatNumbers = s.pxPerBeat >= L.u * 2.4;
    for (let b = first; b <= last; b++) {
      const yy = Math.round(y(b)) + 0.5;
      const bar = s.grid.isBar(b);
      beatNo = bar ? 1 : beatNo + 1;
      if (yy < songTop - 1 || yy > songBottom + 1) continue;
      if (!bar && beatNumbers) {
        // The beats of the bar, counted quietly beside the lanes.
        g.font = `italic 800 ${Math.round(L.u * 0.62)}px ${FONT}`;
        g.fillStyle = 'rgb(171 161 230 / 0.55)';
        g.fillText(String(beatNo), L.labelX + L.labelW - L.u * 0.4, yy);
        g.font = `italic 900 ${Math.round(L.u * 0.8)}px ${FONT}`;
      }
      g.strokeStyle = bar ? 'rgb(246 243 255 / 0.5)' : 'rgb(210 201 250 / 0.2)';
      g.lineWidth = bar ? 2 : 1;
      g.beginPath();
      g.moveTo(L.deckX, yy);
      g.lineTo(L.deckX + L.deckW, yy);
      g.stroke();
      if (bar) {
        if (barNo < 0) barNo = s.grid.barBeat(b).bar;
        else barNo++;
        // Bar numbers thin out when the bars are close together.
        const barPx = s.grid.barLength(b) * s.pxPerBeat;
        const every = barPx >= L.u * 1.5 ? 1 : barPx >= L.u * 0.75 ? 2 : 4;
        if (barNo % every === 0 || barNo === 1) {
          g.fillStyle = 'rgb(210 201 250 / 0.85)';
          g.fillText(String(barNo), L.labelX + L.labelW - L.u * 0.4, yy);
        }
      }
    }
    // Lane dividers.
    g.strokeStyle = 'rgb(196 180 255 / 0.16)';
    g.lineWidth = 1;
    g.beginPath();
    for (let l = 1; l < this.lanes; l++) {
      const x = Math.round(L.deckX + l * L.laneW) + 0.5;
      g.moveTo(x, 0);
      g.lineTo(x, L.h);
    }
    g.stroke();

    // Overdrive phrases: a wash of ice over the deck with a bar of it along both rails.
    for (const p of s.doc.phrases()) {
      if (p.to < bottom || p.from > top) continue;
      const y0 = y(p.to) - L.noteH * 0.8;
      const y1 = y(p.from) + L.noteH * 0.8;
      g.fillStyle = 'rgb(191 230 255 / 0.1)';
      g.fillRect(L.deckX, y0, L.deckW, y1 - y0);
      g.fillStyle = ICE;
      g.fillRect(L.deckX - 4, y0, 4, y1 - y0);
      g.fillRect(L.deckX + L.deckW, y0, 4, y1 - y0);
    }

    // A marked stretch: the selection's lavender, laid over the lanes.
    if (s.range) {
      const y0 = y(s.range[1]);
      const y1 = y(s.range[0]);
      g.fillStyle = 'rgb(239 234 255 / 0.17)';
      g.fillRect(L.deckX, y0, L.deckW, y1 - y0);
      // Looped, its ends are pink: this is what is sounding, round and round.
      g.fillStyle = s.loop ? PINK : LIT;
      const edge = s.loop ? 3 : 2;
      g.fillRect(L.deckX, Math.round(y0) - edge / 2, L.deckW, edge);
      g.fillRect(L.deckX, Math.round(y1) - edge / 2, L.deckW, edge);
    }

    // What has gone by is a shade darker.
    if (L.nowY < L.h) {
      g.fillStyle = 'rgb(8 5 26 / 0.26)';
      g.fillRect(L.deckX, L.nowY, L.deckW, L.h - L.nowY);
    }

    // Rails.
    g.fillStyle = 'rgb(150 128 255 / 0.95)';
    g.fillRect(L.deckX - 2, 0, 2, L.h);
    g.fillRect(L.deckX + L.deckW, 0, 2, L.h);

    this.drawNow(s);

    // Notes: long ones first, so a head is never under a neighbour's tail.
    const notes = s.doc.notes;
    const from = s.doc.firstFrom(bottom - 64);
    const now = performance.now();
    for (let i = from; i < notes.length && notes[i].pos <= top + 1; i++) {
      const n = notes[i];
      const held = s.held[n.lane] === n.id;
      const len = held ? Math.max(n.len, s.viewPos - n.pos) : n.len;
      if (len <= 0 || n.pos + len < bottom - 1) continue;
      this.drawTail(n, len, y(n.pos), y(n.pos + len), s.selection.has(n.id));
    }
    for (let i = from; i < notes.length && notes[i].pos <= top + 1; i++) {
      const n = notes[i];
      if (n.pos < bottom - 1) continue;
      this.drawHead(n, y(n.pos), s.selection.has(n.id));
    }
    if (s.ghost && !s.playing) {
      const cx = L.deckX + (s.ghost.lane + 0.5) * L.laneW;
      g.globalAlpha = 0.4;
      this.pill(cx, y(s.ghost.pos), L.noteW, L.noteH);
      g.fillStyle = LANE_HEX[s.ghost.lane];
      g.fill();
      g.globalAlpha = 1;
    }

    // A lane that was just struck (a note passing in playback, a press while recording) flashes.
    for (let l = 0; l < this.lanes; l++) {
      const age = now - (s.struck[l] ?? -1e9);
      if (age > 220) continue;
      const t = this.target(l);
      g.globalAlpha = 1 - age / 220;
      g.shadowColor = LANE_HEX[l];
      g.shadowBlur = L.u * 1.2;
      this.pill(t.x, t.y, L.noteW + 6, L.noteH + 6);
      g.fillStyle = LANE_RIM[l];
      g.fill();
      g.shadowBlur = 0;
      g.globalAlpha = 1;
    }

    if (s.marquee) {
      const m = s.marquee;
      g.fillStyle = 'rgb(239 234 255 / 0.16)';
      g.fillRect(m.x0, m.y0, m.x1 - m.x0, m.y1 - m.y0);
      g.strokeStyle = LIT;
      g.lineWidth = 1.5;
      g.strokeRect(Math.round(m.x0) + 0.5, Math.round(m.y0) + 0.5, Math.round(m.x1 - m.x0), Math.round(m.y1 - m.y0));
    }
  }

  /** The now line with a target in every lane, and the cursor's ring on its lane. */
  private drawNow(s: Scene) {
    const { g } = this;
    const L = this.lay;
    const colour = s.recording ? PINK : INK;
    g.fillStyle = colour;
    g.globalAlpha = 0.92;
    g.fillRect(L.deckX - L.u * 0.5, L.nowY - 1.5, L.deckW + L.u, 3);
    g.globalAlpha = 1;
    for (let l = 0; l < this.lanes; l++) {
      const t = this.target(l);
      this.pill(t.x, t.y, L.noteW, L.noteH);
      g.fillStyle = 'rgb(12 7 40 / 0.86)';
      g.fill();
      g.strokeStyle = LANE_HEX[l];
      g.lineWidth = 2;
      g.stroke();
    }
    if (s.lane !== null && !s.recording) {
      const t = this.target(s.lane);
      g.shadowColor = 'rgb(93 242 214 / 0.55)';
      g.shadowBlur = L.u * 0.9;
      g.shadowOffsetY = L.u * 0.3;
      this.pill(t.x, t.y, L.noteW + 12, L.noteH + 12);
      g.strokeStyle = MINT;
      g.lineWidth = 3;
      g.stroke();
      g.shadowBlur = 0;
      g.shadowOffsetY = 0;
    }
  }

  private pill(cx: number, cy: number, w: number, h: number) {
    const { g } = this;
    g.beginPath();
    g.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2);
  }

  /**
   * A hold, as on the highway: a rod lit along both sides, glowing a little; or, for a hold that
   * must be let go on time, a wide neck of crystal with pale edges, deepening toward the arrow it
   * ends in where it is let go.
   */
  private drawTail(n: DocNote, len: number, yHead: number, yEnd: number, selected: boolean) {
    const { g } = this;
    const L = this.lay;
    const cx = L.deckX + (n.lane + 0.5) * L.laneW;
    if (len <= 0) return;
    if (!n.release) {
      const w = Math.max(4, L.noteW * 0.13);
      const hi = scale(tile(n, 'rodHi'), 1.2);
      const lo = tile(n, 'rodLo');
      const across = g.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
      across.addColorStop(0, css(scale(lo, 0.8)));
      across.addColorStop(0.25, css(hi));
      across.addColorStop(0.5, css(scale(lo, 1.2)));
      across.addColorStop(0.75, css(hi));
      across.addColorStop(1, css(scale(lo, 0.8)));
      g.shadowColor = css(tile(n, 'halo'), n.phrase >= 0 ? 0.8 : 0.6);
      g.shadowBlur = w * 1.6;
      g.fillStyle = across;
      g.fillRect(cx - w / 2, yEnd, w, yHead - yEnd);
      g.shadowBlur = 0;
      if (selected) {
        g.strokeStyle = LIT;
        g.lineWidth = 2;
        g.beginPath();
        g.roundRect(cx - w / 2 - 3, yEnd - 3, w + 6, yHead - yEnd + 3, [3, 3, 0, 0]);
        g.stroke();
      }
      return;
    }
    const hw = L.noteW / 3;
    const tip = Math.min(hw * 1.2, (yHead - yEnd) * 0.6);
    const shoulder = yEnd + tip;
    const up = tile(n, 'up');
    const low = tile(n, 'low');
    const base = tile(n, 'base');
    const neck = () => {
      g.beginPath();
      g.moveTo(cx - hw, yHead);
      g.lineTo(cx - hw, shoulder);
      g.lineTo(cx, yEnd);
      g.lineTo(cx + hw, shoulder);
      g.lineTo(cx + hw, yHead);
      g.closePath();
    };
    const along = g.createLinearGradient(0, shoulder + hw * 4, 0, shoulder);
    along.addColorStop(0, css(scale(blend(up, base, 0.3), 0.7)));
    along.addColorStop(1, css(scale(blend(low, base, 0.32), 0.88)));
    neck();
    g.fillStyle = along;
    g.globalAlpha = 0.95;
    g.fill();
    g.globalAlpha = 1;
    // A lighter strip inside its left edge.
    g.fillStyle = css(blend(up, base, 0.5), 0.6);
    g.fillRect(cx - hw + 3, shoulder, 1.5, Math.max(0, yHead - shoulder));
    // The arrow: darker inside, a pale line across its foot.
    g.beginPath();
    g.moveTo(cx - hw, shoulder);
    g.lineTo(cx, yEnd);
    g.lineTo(cx + hw, shoulder);
    g.closePath();
    g.fillStyle = css(scale(blend(low, base, 0.35), 0.9));
    g.fill();
    g.fillStyle = css(base);
    g.fillRect(cx - hw, shoulder - 1, hw * 2, 2);
    neck();
    g.strokeStyle = css(blend(base, WHITE, 0.35));
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.stroke();
    if (selected) {
      g.strokeStyle = LIT;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx - hw - 4, yHead);
      g.lineTo(cx - hw - 4, shoulder);
      g.lineTo(cx, yEnd - 5);
      g.lineTo(cx + hw + 4, shoulder);
      g.lineTo(cx + hw + 4, yHead);
      g.stroke();
    }
  }

  private drawHead(n: DocNote, cy: number, selected: boolean) {
    const { g } = this;
    const L = this.lay;
    const cx = L.deckX + (n.lane + 0.5) * L.laneW;
    const phrase = n.phrase >= 0;
    // The tile: a dark rim under a face in the lane's colour, with a short gloss line.
    this.pill(cx, cy + 1.5, L.noteW, L.noteH);
    g.fillStyle = LANE_DARK[n.lane];
    g.fill();
    this.pill(cx, cy, L.noteW, L.noteH);
    // The tile of a hold that must be let go on time is lighter glass with pale edges, as on the highway.
    const glass = n.release && n.len > 0 && !phrase;
    g.fillStyle = phrase ? '#eef8ff' : glass ? css(blend(tile(n, 'up'), scale(tile(n, 'base'), 0.72), 0.3)) : LANE_HEX[n.lane];
    g.fill();
    g.strokeStyle = phrase ? LANE_HEX[n.lane] : glass ? css(blend(tile(n, 'base'), WHITE, 0.2)) : LANE_RIM[n.lane];
    g.lineWidth = phrase || glass ? 2.5 : 1.5;
    g.stroke();
    g.fillStyle = phrase ? 'rgb(255 255 255 / 0.9)' : 'rgb(255 255 255 / 0.55)';
    g.fillRect(cx - L.noteW * 0.26, cy - L.noteH * 0.24, L.noteW * 0.52, Math.max(1.5, L.noteH * 0.12));
    if (selected) {
      g.shadowColor = 'rgb(0 0 0 / 0.6)';
      g.shadowBlur = 8;
      g.shadowOffsetY = 4;
      this.pill(cx, cy, L.noteW + 9, L.noteH + 9);
      g.strokeStyle = LIT;
      g.lineWidth = 3;
      g.stroke();
      g.shadowBlur = 0;
      g.shadowOffsetY = 0;
    }
  }

  /** The strips beside the deck: the waveform on the left, the guide on the right. */
  private drawSides(s: Scene, songTop: number, songBottom: number) {
    const { g } = this;
    const L = this.lay;
    const r = L.u * 0.45;
    g.fillStyle = 'rgb(46 30 132 / 0.42)';
    g.beginPath();
    g.roundRect(L.waveX, 0, L.waveW, L.h, r);
    g.fill();
    if (L.guideW) {
      g.beginPath();
      g.roundRect(L.guideX, 0, L.guideW, L.h, r);
      g.fill();
    }
    const p = s.peaks;
    if (p) {
      const mid = L.waveX + L.waveW / 2;
      const half = L.waveW / 2 - 3;
      const y0 = Math.max(0, Math.floor(songTop));
      const y1 = Math.min(L.h, Math.ceil(songBottom));
      // What has been played is pink, as everywhere audio has a position; what is ahead is pale.
      for (let pass = 0; pass < 2; pass++) {
        g.fillStyle = pass ? PINK : 'rgb(210 201 250 / 0.6)';
        const a = pass ? Math.max(y0, L.nowY) : y0;
        const b = pass ? y1 : Math.min(y1, L.nowY);
        let tPrev = s.grid.time(this.posAt(a - 1, s));
        for (let yy = a; yy < b; yy++) {
          const t = s.grid.time(this.posAt(yy, s));
          let i0 = Math.floor(Math.min(t, tPrev) * p.perSec);
          const i1 = Math.floor(Math.max(t, tPrev) * p.perSec);
          tPrev = t;
          if (i1 < 0 || i0 >= p.max.length) continue;
          i0 = Math.max(0, i0);
          const step = Math.max(1, Math.floor((i1 - i0) / 6));
          let amp = 0;
          for (let i = i0; i <= i1 && i < p.max.length; i += step) amp = Math.max(amp, p.max[i], -p.min[i]);
          const w = Math.max(1, amp * half);
          g.fillRect(mid - w, yy, w * 2, 1);
        }
      }
    }
    if (s.sounds?.length) {
      // Where sounds start: a tick on the lanes' side of the waveform (brighter when notes snap to them).
      const top = this.posAt(0, s);
      const bottom = this.posAt(L.h, s);
      const w = Math.max(5, L.u * 0.5);
      g.fillStyle = 'rgb(246 243 255 / 0.9)';
      let lo = 0;
      let hi = s.sounds.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (s.sounds[mid] < bottom) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < s.sounds.length && s.sounds[i] <= top; i++) {
        const yy = Math.round(this.y(s.sounds[i], s));
        if (yy < songTop || yy > songBottom) continue;
        g.fillRect(L.waveX + L.waveW - w, yy - 1, w, 2);
      }
    }
    if (L.guideW && s.guide) {
      const top = this.posAt(0, s);
      const bottom = this.posAt(L.h, s);
      const inner = L.guideW - L.u * 0.7;
      const x0 = L.guideX + L.u * 0.35;
      const bar = Math.max(4, L.u * 0.36);
      for (const m of s.guide) {
        if (m.pos + m.len < bottom || m.pos > top) continue;
        const yy = this.y(m.pos, s);
        // A mark is at least a dot, so a drum hit shows as clearly as a held note.
        const hgt = Math.max(bar, m.len * s.pxPerBeat);
        g.fillStyle = `rgb(226 219 255 / ${(0.45 + 0.5 * m.strength).toFixed(2)})`;
        g.beginPath();
        g.roundRect(x0 + m.x * (inner - bar), yy - hgt + bar / 2, bar, hgt, bar / 2);
        g.fill();
      }
    }
    // The now line runs through the strips as a hairline.
    g.fillStyle = 'rgb(246 243 255 / 0.5)';
    g.fillRect(L.waveX, L.nowY - 0.5, L.waveW, 1);
    if (L.guideW) g.fillRect(L.guideX, L.nowY - 0.5, L.guideW, 1);
  }
}

/** The whole song on one line: where the notes are, what is marked and where "now" is. */
export function drawOverview(canvas: HTMLCanvasElement, s: Scene, visibleBeats: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const d = Math.max(0.001, s.grid.duration);
  const x = (pos: number) => (Math.min(d, Math.max(0, s.grid.time(pos))) / d) * w;
  const nowX = x(s.viewPos);
  const p = s.peaks;
  if (p) {
    // The waveform, in a column per pixel: pink up to now, pale beyond it.
    const mid = h / 2;
    for (let px = 0; px < w; px++) {
      const i0 = Math.floor((px / w) * d * p.perSec);
      const i1 = Math.min(p.max.length - 1, Math.floor(((px + 1) / w) * d * p.perSec));
      const step = Math.max(1, Math.floor((i1 - i0) / 8));
      let amp = 0;
      for (let i = i0; i <= i1; i += step) amp = Math.max(amp, p.max[i] ?? 0, -(p.min[i] ?? 0));
      const hh = Math.max(1, amp * (h / 2 - 3));
      g.fillStyle = px < nowX ? PINK : 'rgb(210 201 250 / 0.45)';
      g.fillRect(px, mid - hh, 1, hh * 2);
    }
  }
  // Notes as a row of ticks along the foot, phrases in ice above them.
  const notes = s.doc.notes;
  g.fillStyle = INK;
  let lastPx = -1;
  for (const n of notes) {
    const px = Math.floor(x(n.pos));
    if (px === lastPx) continue;
    lastPx = px;
    g.fillRect(px, h - 4, 1, 4);
  }
  g.fillStyle = ICE;
  for (const ph of s.doc.phrases()) g.fillRect(x(ph.from), 0, Math.max(2, x(ph.to) - x(ph.from)), 3);
  if (s.range) {
    g.fillStyle = 'rgb(239 234 255 / 0.3)';
    g.fillRect(x(s.range[0]), 0, Math.max(2, x(s.range[1]) - x(s.range[0])), h);
  }
  // What the lanes show right now, and the now line itself.
  const a = x(s.viewPos - visibleBeats * 0.28);
  const b = x(s.viewPos + visibleBeats * 0.72);
  g.strokeStyle = 'rgb(246 243 255 / 0.75)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.roundRect(Math.min(a, w - 4) + 0.75, 0.75, Math.max(3, b - a) - 1.5, h - 1.5, 3);
  g.stroke();
  g.fillStyle = INK;
  g.fillRect(Math.round(nowX) - 1, 0, 2, h);
}
