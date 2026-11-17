import { useEffect, useRef, useState } from 'react';
import type { Chart } from '../chart/types';
import { getEngine } from '../audio/engine';
import type { Results } from '../game/GameSession';
import { PlayController, type PlayPhase } from '../game/PlayController';
import { keyLabel, type Settings } from '../game/settings';
import { LogOut, Play, RotateCcw } from 'lucide-react';
import { playSfx } from '../audio/sfx';
import { menuPulse } from '../input/rumble';
import { PadGlyph } from '../input/glyphs';
import { ICON_STROKE, Stars } from './icons';
import { useGlyphStyle, usePads } from '../input/usePads';

interface Props {
  title: string;
  buffer: AudioBuffer;
  chart: Chart;
  settings: Settings;
  onFinish(r: Results): void;
  onQuit(): void;
}

export function PlayScreen({ title, buffer, chart, settings, onFinish, onQuit }: Props) {
  const bgRef = useRef<HTMLCanvasElement>(null);
  const hwRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<PlayController | null>(null);
  const [phase, setPhase] = useState<PlayPhase>('countdown');
  const [count, setCount] = useState(3);
  const [run, setRun] = useState(0);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  useEffect(() => {
    const root = hudRef.current!;
    const q = (s: string) => root.querySelector<HTMLElement>(s)!;
    const ctrl = new PlayController(getEngine(), buffer, chart, settings, hwRef.current!, bgRef.current!, {
      root,
      score: q('[data-hud=score]'),
      multiplier: q('[data-hud=mult]'),
      streak: q('[data-hud=streak]'),
      overdriveFill: q('[data-hud=od]'),
      stars: q('[data-hud=stars]'),
      progress: q('[data-hud=progress]'),
      feedback: q('[data-hud=feedback]'),
      keys: Array.from(root.querySelectorAll<HTMLElement>('.lane-key')),
      breakTimer: q('[data-hud=break]'),
      breakNumber: q('[data-hud=break-num]'),
      breakLabel: q('[data-hud=break-label]'),
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
    ctrl.onFinish = (r) => setTimeout(() => finishRef.current(r), 900);
    ctrlRef.current = ctrl;
    void ctrl.start();
    return () => {
      ctrl.dispose();
      ctrlRef.current = null;
    };
  }, [buffer, chart, settings, run]);

  const keys = chart.lanes === 5 ? settings.keys5 : settings.keys4;
  const padKeys = chart.lanes === 5 ? settings.pad5 : settings.pad4;
  const usingPad = usePads().lastDevice === 'pad';
  const style = useGlyphStyle(settings.glyphs);
  const odLabel = usingPad ? <PadGlyph input={settings.padOverdrive} style={style} /> : keyLabel(settings.overdriveKey);

  return (
    <div className="play">
      <canvas ref={bgRef} className="layer" />
      <div ref={stageRef} className="layer stage-host" />
      <canvas ref={hwRef} className="layer" />
      <div ref={hudRef} className="hud">
        <div className="hud-top">
          <div className="hud-title">{title}</div>
          <div className="hud-progress"><div data-hud="progress" /></div>
        </div>
        <div className="hud-left">
          <div className="hud-score" data-hud="score">0</div>
          <div className="hud-stars" data-hud="stars" data-count="0">
            <Stars n={5} />
          </div>
        </div>
        <div className="hud-right">
          <div className="hud-mult" data-hud="mult" data-level="1">×1</div>
          <div className="hud-streak" data-hud="streak" />
          <div className="hud-od" title="Overdrive">
            <div data-hud="od" />
          </div>
          <div className="hud-od-key">{odLabel}</div>
        </div>
        <div className="hud-feedback" data-hud="feedback" />
        <div className="hud-break" data-hud="break" aria-live="off">
          <svg viewBox="0 0 120 120" className="hud-break-ring">
            <circle cx="60" cy="60" r="52" className="track" />
            <circle cx="60" cy="60" r="52" className="fill" pathLength={1} data-hud="break-ring" />
          </svg>
          <div className="hud-break-num" data-hud="break-num" />
          <div className="hud-break-label" data-hud="break-label">Break</div>
        </div>
        {keys.map((k, i) => (
          <span key={i} className={`lane-key lane-${i} ${usingPad ? 'pad' : ''}`}>{usingPad ? <PadGlyph input={padKeys[i]} style={style} /> : keyLabel(k)}</span>
        ))}
      </div>
      {phase === 'countdown' && count > 0 && <div className="countdown" key={count}>{count}</div>}
      {phase === 'paused' && (
        <div className="overlay">
          <div className="pause-card" role="dialog" aria-label="Paused">
            <h2 className="pause-title">Paused</h2>
            <p className="pause-song">{title}</p>
            <button className="btn primary" data-sfx="none" autoFocus onClick={() => void ctrlRef.current?.resume()}>
              <Play strokeWidth={ICON_STROKE} aria-hidden />
              Resume
            </button>
            <button className="btn" onClick={() => setRun((r) => r + 1)}>
              <RotateCcw strokeWidth={ICON_STROKE} aria-hidden />
              Restart
            </button>
            <button className="btn" onClick={onQuit}>
              <LogOut strokeWidth={ICON_STROKE} aria-hidden />
              Quit to song
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
