import { LogOut, Pause, Play, RotateCcw, SkipForward, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getEngine } from '../audio/engine';
import { playSfx } from '../audio/sfx';
import type { Chart } from '../chart/types';
import type { Results } from '../game/GameSession';
import { PlayController, type PlayPhase } from '../game/PlayController';
import { keyLabel, type Settings } from '../game/settings';
import { PadGlyph } from '../input/glyphs';
import { useInputMode } from '../input/inputMode';
import { focusStart } from '../input/menuNav';
import { menuPulse } from '../input/rumble';
import { useGlyphStyle } from '../input/usePads';
import { useActions } from './actions';
import { ICON_STROKE, PART_LABEL } from './icons';

interface Props {
  title: string;
  artist: string;
  /** Position in the set, from 1, and how many songs the set has. */
  position: number;
  total: number;
  buffer: AudioBuffer;
  chart: Chart;
  settings: Settings;
  onFinish(r: Results): void;
  /** Leaves the song for the next one in the set (absent on the last song). */
  onSkip?(): void;
  onQuit(): void;
}

const STAR_PATH = 'M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z';

export function PlayScreen({ title, artist, position, total, buffer, chart, settings, onFinish, onSkip, onQuit }: Props) {
  const bgRef = useRef<HTMLCanvasElement>(null);
  const hwRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const pauseRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<PlayController | null>(null);
  const [phase, setPhase] = useState<PlayPhase>('countdown');
  const [count, setCount] = useState(3);
  const [run, setRun] = useState(0);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const mode = useInputMode();
  const style = useGlyphStyle(settings.glyphs);

  useEffect(() => {
    const root = hudRef.current!;
    const q = (s: string) => root.querySelector<HTMLElement>(s)!;
    const ctrl = new PlayController(getEngine(), buffer, chart, settings, hwRef.current!, bgRef.current!, {
      root,
      score: q('[data-hud=score]'),
      multiplier: q('[data-hud=mult]'),
      streak: q('[data-hud=streak]'),
      stars: q('[data-hud=stars]'),
      progress: q('[data-hud=progress]'),
      feedback: q('[data-hud=feedback]'),
      keys: Array.from(root.querySelectorAll<HTMLElement>('.lane-key')),
      touchLayer: q('[data-hud=touch]'),
      overdriveButton: q('[data-hud=od]'),
      breakTimer: q('[data-hud=break]'),
      breakNumber: q('[data-hud=break-num]'),
      breakRing: root.querySelector<SVGCircleElement>('[data-hud=break-ring]')!,
    }, stageRef.current!);
    let prev: PlayPhase = 'countdown';
    ctrl.onPhase = (p, n) => {
      if (p === 'paused' && prev !== 'paused') {
        playSfx('pause');
        menuPulse('back');
      } else if (prev === 'paused' && p !== 'paused') {
        playSfx('resume');
        menuPulse('select');
      }
      prev = p;
      setPhase(p);
      if (n !== undefined) setCount(n);
    };
    // The last chord rings out before the result; leaving in that moment cancels it.
    let finishTimer = 0;
    ctrl.onFinish = (r) => (finishTimer = window.setTimeout(() => finishRef.current(r), 900));
    ctrlRef.current = ctrl;
    void ctrl.start();
    // A song that loses the window (a call, another app) pauses instead of running on unseen.
    const hidden = () => document.hidden && ctrl.pause();
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      clearTimeout(finishTimer);
      ctrl.dispose();
      ctrlRef.current = null;
    };
  }, [buffer, chart, settings, run]);

  // The highway is laid out differently for touch (square targets at the foot of the screen).
  useEffect(() => {
    ctrlRef.current?.relayout();
  }, [mode]);

  const paused = phase === 'paused';
  // The pause menu takes focus as it opens, so the keyboard and a controller land on Resume, and
  // Tab stays inside it.
  useEffect(() => {
    if (!paused) return;
    focusStart();
    const box = pauseRef.current!;
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const all = Array.from(box.querySelectorAll<HTMLElement>('button:not([disabled])'));
      const i = all.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      all[e.shiftKey ? (i <= 0 ? all.length - 1 : i - 1) : i === all.length - 1 ? 0 : i + 1]?.focus();
    };
    window.addEventListener('keydown', trap, true);
    return () => window.removeEventListener('keydown', trap, true);
  }, [paused]);
  // No bar during a song: this keeps the menu actions of the screen underneath switched off.
  useActions([]);

  const keys = chart.lanes === 5 ? settings.keys5 : settings.keys4;
  const padKeys = chart.lanes === 5 ? settings.pad5 : settings.pad4;
  const usingPad = mode === 'pad';

  return (
    <div className={`play ${paused ? 'is-paused' : ''}`} data-lanes={chart.lanes} data-od-side={settings.touchOverdriveSide} data-nav-off={paused ? undefined : ''}>
      <canvas ref={bgRef} className="layer" />
      <div ref={stageRef} className="layer stage-host" />
      <canvas ref={hwRef} className="layer highway" />
      <div ref={hudRef} className="hud">
        <div className="touch-layer" data-hud="touch" />

        <div className="hud-top">
          <div className="hud-title">
            {total > 1 && <span className="hud-pos">{position}/{total}</span>}
            <span className="hud-song">{title}</span>
            <span className="hud-artist">{artist}</span>
          </div>
          <div className="hud-progress" aria-hidden><div data-hud="progress" /></div>
        </div>
        <button type="button" className="hud-pause" data-sfx="none" tabIndex={-1} aria-label="Pause" onClick={() => ctrlRef.current?.pause()}>
          <Pause strokeWidth={ICON_STROKE} aria-hidden />
        </button>

        <div className="hud-scorebox">
          <div className="hud-stars" data-hud="stars" data-count="0" role="img" aria-label="Stars earned">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="hud-star">
                <svg viewBox="0 0 24 24" aria-hidden><path d={STAR_PATH} /></svg>
              </span>
            ))}
          </div>
          <div className="hud-scorepanel">
            <span className="hud-part">{PART_LABEL[chart.part]} score</span>
            <span className="hud-score" data-hud="score">0</span>
          </div>
        </div>

        <div className="hud-dial">
          <svg viewBox="0 0 100 100" className="hud-dial-ring" aria-hidden>
            <circle cx="50" cy="50" r="44" className="track" pathLength={1} />
            <circle cx="50" cy="50" r="44" className="fill" pathLength={1} />
          </svg>
          <span className="hud-mult" data-hud="mult" data-level="1">×1</span>
          <span className="hud-streak" data-hud="streak" />
        </div>

        <button type="button" className="hud-od" data-hud="od" data-sfx="none" tabIndex={-1} aria-label="Start overdrive">
          <span className="hud-od-bar" aria-hidden><span /></span>
          <span className="hud-od-label">
            <Zap strokeWidth={ICON_STROKE} aria-hidden />
            <span className="hud-od-word">Overdrive</span>
            {mode !== 'touch' && <span className="hud-od-key">{usingPad ? <PadGlyph input={settings.padOverdrive} style={style} /> : <kbd>{keyLabel(settings.overdriveKey)}</kbd>}</span>}
          </span>
        </button>

        <div className="hud-feedback" data-hud="feedback" />
        <div className="hud-break" data-hud="break" aria-live="off">
          <svg viewBox="0 0 120 120" className="hud-break-ring">
            <circle cx="60" cy="60" r="52" className="track" />
            <circle cx="60" cy="60" r="52" className="fill" pathLength={1} data-hud="break-ring" />
          </svg>
          <div className="hud-break-num" data-hud="break-num" />
        </div>
        {keys.map((k, i) => (
          <span key={i} className={`lane-key lane-${i} ${usingPad ? 'pad' : ''}`}>{usingPad ? <PadGlyph input={padKeys[i]} style={style} /> : keyLabel(k)}</span>
        ))}
      </div>
      {phase === 'countdown' && count > 0 && <div className="countdown" key={count}>{count}</div>}
      {paused && (
        <div className="overlay card" data-modal ref={pauseRef}>
          <div className="dialog pause-card" role="dialog" aria-modal="true" aria-label="Paused">
            <h2 className="display pause-title">Paused</h2>
            <p className="pause-song">
              {title}
              {total > 1 && ` · song ${position} of ${total}`}
            </p>
            <button type="button" className="btn primary wide" data-sfx="none" data-autofocus onClick={() => void ctrlRef.current?.resume()}>
              <Play strokeWidth={ICON_STROKE} aria-hidden />
              Resume
            </button>
            <button type="button" className="btn wide" onClick={() => setRun((r) => r + 1)}>
              <RotateCcw strokeWidth={ICON_STROKE} aria-hidden />
              Restart song
            </button>
            {onSkip && (
              <button type="button" className="btn wide" onClick={onSkip}>
                <SkipForward strokeWidth={ICON_STROKE} aria-hidden />
                Skip to next song
              </button>
            )}
            <button type="button" className="btn wide" data-sfx="back" onClick={onQuit}>
              <LogOut strokeWidth={ICON_STROKE} aria-hidden />
              {total > 1 ? 'Leave the set' : 'Leave the song'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
