import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analysisManager } from '../analysis/manager';
import type { AnalysisResult, PitchedNote, StemName } from '../analysis/types';
import { getEngine } from '../audio/engine';
import { loadSongBuffer } from '../audio/songAudio';
import { CHART_VERSION } from '../chart/generator';
import { DIFFICULTIES, PARTS, type Chart, type Difficulty, type Part } from '../chart/types';
import type { Settings } from '../game/settings';
import { getStem, listStems, type SongMeta } from '../storage/db';
import {
  CATEGORIES,
  exportJson,
  loadAnnotations,
  removeAnnotation,
  saveAnnotation,
  syncToProject,
  type Annotation,
  type Category,
} from './annotations';
import { NoteClicks } from './noteClicks';
import { computePeaks, Timeline, type Peaks } from './Timeline';

interface Props {
  song: SongMeta;
  settings: Settings;
  onBack(): void;
}

type AudioSource = 'song' | StemName;

/** Which stem belongs to a part (the instrument stem feeds Lead). */
const PART_STEM: Record<Part, StemName> = { lead: 'other', bass: 'bass', drums: 'drums', vocals: 'vocals' };
const SOURCE_LABEL: Record<AudioSource, string> = { song: 'Song', other: 'Instruments', bass: 'Bass', drums: 'Drums', vocals: 'Vocals' };
const RATES = [0.5, 0.75, 1];

const fmt = (s: number) => {
  const t = Math.max(0, s);
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
};

const lineFor = (a: AnalysisResult, part: Part): PitchedNote[] =>
  part === 'bass' ? a.bass : part === 'vocals' ? (a.vocals ?? []) : part === 'lead' ? a.lead : [];

/**
 * Chart debugger: plays the song (or a stem) with the generated notes on a timeline, and lets
 * the player mark notes or empty stretches with problems. Annotations carry their own context
 * and, in the dev build, are written to debug-annotations/ in the project.
 */
export function DebugScreen({ song, settings, onBack }: Props) {
  const engine = getEngine();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tlRef = useRef<Timeline | null>(null);
  const clicksRef = useRef<NoteClicks | null>(null);
  const [part, setPart] = useState<Part>('lead');
  const [difficulty, setDifficulty] = useState<Difficulty>('expert');
  const [analysis, setAnalysis] = useState<AnalysisResult>();
  const [chart, setChart] = useState<Chart>();
  const [stems, setStems] = useState<StemName[]>([]);
  const [source, setSource] = useState<AudioSource>('song');
  const [buffer, setBuffer] = useState<AudioBuffer>();
  const [peaks, setPeaks] = useState<Peaks>();
  const [rate, setRate] = useState(1);
  const [clicks, setClicks] = useState(true);
  const [follow, setFollow] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selection, setSelection] = useState<{ notes: number[]; range?: [number, number] }>({ notes: [] });
  const [category, setCategory] = useState<Category>('missing');
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState('');
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const followRef = useRef(follow);
  followRef.current = follow;

  // Data
  useEffect(() => {
    void analysisManager.analysis(song.id).then(setAnalysis);
    void listStems(song.id).then(setStems).catch(() => setStems([]));
    void loadAnnotations(song.id).then(setAnnotations);
  }, [song.id]);

  useEffect(() => {
    setChart(undefined);
    void analysisManager.chart(song.id, part, difficulty).then(setChart);
    setSelection({ notes: [] });
  }, [song.id, part, difficulty]);

  // Audio source
  useEffect(() => {
    let cancelled = false;
    engine.stop();
    setPlaying(false);
    void (async () => {
      try {
        const buf =
          source === 'song'
            ? await loadSongBuffer(song.id)
            : await getStem(song.id, source).then(async (b) => (b ? engine.decode(await b.arrayBuffer()) : undefined));
        if (cancelled || !buf) return;
        setBuffer(buf);
        setPeaks(computePeaks(buf));
        engine.load(buf);
        engine.offset = settings.offsetMs / 1000;
        engine.volume = settings.volume;
      } catch (e) {
        setStatus(`Could not load audio: ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [song.id, source, engine, settings.offsetMs, settings.volume]);

  // Timeline + frame loop
  useEffect(() => {
    const tl = new Timeline(canvasRef.current!);
    tlRef.current = tl;
    const onResize = () => tl.resize();
    window.addEventListener('resize', onResize);
    let raf = 0;
    let lastShown = -1;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = engine.time();
      if (engine.isPlaying && tl.data && followRef.current) {
        const vis = tl.visibleSeconds;
        if (t < tl.viewStart + vis * 0.1 || t > tl.viewStart + vis * 0.7) tl.viewStart = t - vis * 0.25;
      }
      tl.draw(t);
      if (Math.abs(t - lastShown) > 0.05) {
        lastShown = t;
        setTime(t);
      }
    };
    loop();
    engine.onEnded = () => setPlaying(false);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      engine.stop();
      engine.onEnded = null;
      clicksRef.current?.stop();
    };
  }, [engine]);

  // Push data into the timeline
  useEffect(() => {
    const tl = tlRef.current;
    if (!tl) return;
    tl.data = chart && analysis ? { chart, source: lineFor(analysis, part), drums: part === 'drums' ? analysis.drums : undefined, peaks, annotations } : null;
    tl.selection = { notes: new Set(selection.notes), range: selection.range };
    tl.resize();
  }, [chart, analysis, part, peaks, annotations, selection]);

  // Note clicks follow the chart
  useEffect(() => {
    clicksRef.current?.stop();
    clicksRef.current = chart ? new NoteClicks(engine, chart.notes) : null;
    if (playing && clicks) clicksRef.current?.start();
  }, [chart, engine, clicks, playing]);

  const play = useCallback(
    async (from?: number) => {
      if (!buffer) return;
      await engine.play(from ?? engine.time(), 0.05, rate);
      setPlaying(true);
      if (clicks) clicksRef.current?.start();
    },
    [buffer, engine, rate, clicks],
  );

  const pause = useCallback(() => {
    engine.pause();
    clicksRef.current?.stop();
    setPlaying(false);
  }, [engine]);

  const seek = useCallback(
    async (t: number) => {
      const clamped = Math.max(0, Math.min((buffer?.duration ?? analysis?.duration ?? Infinity) - 0.05, t));
      await engine.seek(clamped);
      clicksRef.current?.reset();
      const tl = tlRef.current;
      if (tl && (clamped < tl.viewStart || clamped > tl.viewStart + tl.visibleSeconds)) tl.viewStart = clamped - tl.visibleSeconds * 0.25;
    },
    [buffer, analysis, engine],
  );

  // Speed changes restart playback at the same spot.
  useEffect(() => {
    if (engine.isPlaying) void play(engine.time());
  }, [rate]);

  // Mouse: click a note to select it (shift adds), drag empty space to select a range, click the
  // ruler or empty space to seek; wheel pans, ctrl+wheel zooms.
  const drag = useRef<{ x: number; t: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const tl = tlRef.current;
    if (!tl?.data) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (tl.inRuler(y)) return void seek(tl.timeAt(x));
    const hit = tl.noteAt(x, y);
    if (hit !== null) {
      setSelection((s) => {
        const notes = e.shiftKey ? (s.notes.includes(hit) ? s.notes.filter((n) => n !== hit) : [...s.notes, hit]) : [hit];
        return { notes, range: e.shiftKey ? s.range : undefined };
      });
      return;
    }
    drag.current = { x, t: tl.timeAt(x) };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const tl = tlRef.current;
    if (!tl || !drag.current) return;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    if (Math.abs(x - drag.current.x) < 4) return;
    const t = tl.timeAt(x);
    setSelection((s) => ({ notes: e.shiftKey ? s.notes : [], range: [Math.min(t, drag.current!.t), Math.max(t, drag.current!.t)] }));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const tl = tlRef.current;
    if (!tl || !drag.current) return;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    if (Math.abs(x - drag.current.x) < 4) {
      setSelection({ notes: [] });
      void seek(tl.timeAt(x));
    }
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const tl = tlRef.current;
    if (!tl) return;
    if (e.ctrlKey) {
      const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
      const anchor = tl.timeAt(x);
      tl.pxPerSec = Math.max(20, Math.min(800, tl.pxPerSec * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      tl.viewStart = anchor - x / tl.pxPerSec;
    } else {
      setFollow(false);
      tl.viewStart += ((e.deltaX || e.deltaY) / tl.pxPerSec) * 1.5;
    }
  };

  const zoom = (f: number) => {
    const tl = tlRef.current;
    if (!tl) return;
    const center = tl.viewStart + tl.visibleSeconds / 2;
    tl.pxPerSec = Math.max(20, Math.min(800, tl.pxPerSec * f));
    tl.viewStart = center - tl.visibleSeconds / 2;
  };

  // What the current selection covers.
  const target = useMemo(() => {
    if (!chart) return null;
    const notes = selection.notes.map((i) => chart.notes[i]).filter(Boolean);
    let start = selection.range?.[0];
    let end = selection.range?.[1];
    if (notes.length) {
      start = Math.min(start ?? Infinity, ...notes.map((n) => n.t));
      end = Math.max(end ?? -Infinity, ...notes.map((n) => n.t + n.dur));
    }
    if (start === undefined || end === undefined) return null;
    return { notes, start, end: Math.max(end, start + 0.01) };
  }, [chart, selection]);

  const beatPos = (t: number) => {
    const b = chart?.beats ?? [];
    let i = 0;
    while (i + 1 < b.length && b[i + 1] <= t) i++;
    return b.length > 1 ? +(i + (t - b[i]) / ((b[i + 1] ?? b[i] + 0.5) - b[i])).toFixed(2) : 0;
  };

  const songRef = { songId: song.id, songTitle: `${song.artist} - ${song.title}` };

  const save = async () => {
    if (!target || !chart || !analysis) return;
    const near = (t: number, d = 0) => t + d >= target.start - 1 && t <= target.end + 1;
    const startBeat = beatPos(target.start);
    const bar = chart.downbeats.filter((i) => i <= Math.floor(startBeat)).length;
    const a: Annotation = {
      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      songId: song.id,
      songTitle: songRef.songTitle,
      part,
      difficulty,
      category,
      comment: comment.trim(),
      createdAt: new Date().toISOString(),
      range: { start: +target.start.toFixed(3), end: +target.end.toFixed(3), startBeat, endBeat: beatPos(target.end), bar },
      notes: target.notes,
      context: {
        chart: chart.notes.filter((n) => near(n.t, n.dur)),
        source: lineFor(analysis, part).filter((n) => near(n.t, n.dur)),
        ...(part === 'drums' ? { drums: analysis.drums.filter((h) => near(h.t)) } : {}),
      },
      analysis: { version: analysis.version, source: analysis.source, pitchSource: analysis.pitchSource, tempo: analysis.tempo, chartVersion: CHART_VERSION },
      audio: { source, rate },
    };
    const all = [...annotations, a].sort((x, y) => x.range.start - y.range.start);
    setAnnotations(all);
    setSelection({ notes: [] });
    setComment('');
    const path = await saveAnnotation(a, all);
    setStatus(path ? `Saved to ${path}` : 'Saved in this browser (use Export to share).');
  };

  const remove = async (id: string) => {
    const all = annotations.filter((a) => a.id !== id);
    setAnnotations(all);
    const path = await removeAnnotation(id, all, songRef);
    setStatus(path ? `Updated ${path}` : all.length ? 'Removed.' : 'All annotations removed.');
  };

  const exportAll = async () => {
    const json = exportJson(annotations);
    try {
      await navigator.clipboard.writeText(json);
      setStatus('Annotations copied to the clipboard.');
    } catch {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = `annotations-${song.title.replace(/[^\w-]+/g, '_')}.json`;
      a.click();
      setStatus('Annotations downloaded.');
    }
    const path = await syncToProject(annotations, songRef);
    if (path) setStatus((s) => `${s} Also saved to ${path}.`);
  };

  // Keyboard: space play/pause, arrows seek, +/- zoom, Esc clears, Enter saves (outside text boxes).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
      if (typing) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void save();
        }
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (engine.isPlaying) pause();
        else void play();
      } else if (e.key === 'ArrowLeft') void seek(engine.time() - (e.shiftKey ? 0.25 : 2));
      else if (e.key === 'ArrowRight') void seek(engine.time() + (e.shiftKey ? 0.25 : 2));
      else if (e.key === '+' || e.key === '=') zoom(1.25);
      else if (e.key === '-') zoom(0.8);
      else if (e.key === 'Escape') {
        if (selection.notes.length || selection.range) setSelection({ notes: [] });
        else onBack();
      } else if (e.key === 'Enter' && target) {
        e.preventDefault();
        commentRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const visibleAnnotations = annotations.filter((a) => a.part === part && a.difficulty === difficulty);
  const duration = buffer?.duration ?? analysis?.duration ?? 0;
  const sources: AudioSource[] = ['song', ...(stems.includes(PART_STEM[part]) ? [PART_STEM[part]] : []), ...stems.filter((s) => s !== PART_STEM[part])];

  return (
    <div className="debug">
      <header className="debug-bar">
        <button className="btn ghost small" onClick={onBack}>← Back</button>
        <div className="debug-title">
          <b>{song.title}</b> <span className="dim">· chart debugger</span>
        </div>
        <div className="seg small">
          {PARTS.map((p) => (
            <button key={p} className={`seg-btn ${part === p ? 'on' : ''}`} onClick={() => setPart(p)}>{p}</button>
          ))}
        </div>
        <div className="seg small">
          {DIFFICULTIES.map((d) => (
            <button key={d} className={`seg-btn ${difficulty === d ? 'on' : ''}`} onClick={() => setDifficulty(d)}>{d}</button>
          ))}
        </div>
      </header>

      <div className="debug-transport">
        <button className="btn primary small" onClick={() => (playing ? pause() : void play())} disabled={!buffer}>
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <span className="debug-time">{fmt(time)} / {fmt(duration)}</span>
        <label className="debug-field">
          Audio
          <select value={source} onChange={(e) => setSource(e.target.value as AudioSource)}>
            {sources.map((s) => (
              <option key={s} value={s}>{SOURCE_LABEL[s]}{s === PART_STEM[part] ? ' (this part)' : ''}</option>
            ))}
          </select>
        </label>
        <label className="debug-field">
          Speed
          <select value={rate} onChange={(e) => setRate(+e.target.value)}>
            {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
          </select>
        </label>
        <label className="debug-check"><input type="checkbox" checked={clicks} onChange={(e) => setClicks(e.target.checked)} /> Note clicks</label>
        <label className="debug-check"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow</label>
        <span className="debug-zoom">
          <button className="btn small ghost" onClick={() => zoom(0.8)} title="Zoom out (-)">−</button>
          <button className="btn small ghost" onClick={() => zoom(1.25)} title="Zoom in (+)">+</button>
        </span>
      </div>

      <div className="debug-overview" onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        void seek(((e.clientX - r.left) / r.width) * duration);
      }}>
        <div className="debug-overview-head" style={{ left: `${duration ? (time / duration) * 100 : 0}%` }} />
        {visibleAnnotations.map((a) => (
          <div key={a.id} className={`debug-overview-mark cat-${a.category}`} style={{ left: `${(a.range.start / Math.max(1, duration)) * 100}%` }} />
        ))}
      </div>

      <canvas
        ref={canvasRef}
        className="debug-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      />
      <p className="hint debug-help">
        Click a note to select it (Shift for more) · drag over empty space to mark a stretch · click empty space or the bar numbers to seek ·
        Space play/pause · ←/→ seek (Shift: fine) · Ctrl+wheel or +/− zoom · the top strip shows the transcribed pitches, the bottom the waveform of the selected audio
      </p>

      <div className="debug-panels">
        <section className="panel left debug-annotate">
          <h3>Annotate</h3>
          {target ? (
            <p className="dim small">
              {target.notes.length ? `${target.notes.length} note${target.notes.length > 1 ? 's' : ''}` : 'Empty stretch'} · {fmt(target.start)}–{fmt(target.end)} · beat {beatPos(target.start)}
            </p>
          ) : (
            <p className="dim small">Select notes or drag over a stretch of the timeline.</p>
          )}
          <div className="debug-cats">
            {CATEGORIES.map((c) => (
              <button key={c.id} title={c.hint} className={`chip cat-${c.id} ${category === c.id ? 'on' : ''}`} onClick={() => setCategory(c.id)}>{c.label}</button>
            ))}
          </div>
          <textarea
            ref={commentRef}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What's wrong? e.g. 'the synth plays 4 notes here, chart has 1' (Ctrl+Enter saves)"
            rows={3}
          />
          <div className="row left">
            <button className="btn primary small" disabled={!target} onClick={() => void save()}>Save annotation</button>
            <button className="btn small" disabled={!annotations.length} onClick={() => void exportAll()}>Export all</button>
          </div>
          {status && <p className="hint">{status}</p>}
        </section>

        <section className="panel left debug-list">
          <h3>Annotations <span className="dim">({visibleAnnotations.length} here, {annotations.length} total)</span></h3>
          {!visibleAnnotations.length && <p className="dim small">None for {part} / {difficulty} yet.</p>}
          {visibleAnnotations.map((a) => (
            <div key={a.id} className="debug-item">
              <span className={`chip cat-${a.category} on`}>{CATEGORIES.find((c) => c.id === a.category)?.label}</span>
              <button className="btn small ghost" onClick={() => void seek(a.range.start - 1)}>{fmt(a.range.start)} · bar {a.range.bar}</button>
              <span className="debug-comment">{a.comment || <i className="dim">no comment</i>}</span>
              <button className="btn small ghost" title="Delete" onClick={() => void remove(a.id)}>✕</button>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
