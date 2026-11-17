import { useEffect, useRef, useState } from 'react';
import type { Chart } from '../chart/types';
import { getEngine } from '../audio/engine';
import type { Results } from '../game/GameSession';
import { PlayController, type PlayPhase } from '../game/PlayController';
import { keyLabel, type Settings } from '../game/settings';
import { PadGlyph } from '../input/glyphs';
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
    });
    ctrl.onPhase = (p, n) => {
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
      <canvas ref={hwRef} className="layer" />
      <div ref={hudRef} className="hud">
        <div className="hud-top">
          <div className="hud-title">{title}</div>
          <div className="hud-progress"><div data-hud="progress" /></div>
        </div>
        <div className="hud-left">
          <div className="hud-score" data-hud="score">0</div>
          <div className="hud-stars" data-hud="stars">☆☆☆☆☆</div>
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
        {keys.map((k, i) => (
          <span key={i} className={`lane-key lane-${i} ${usingPad ? 'pad' : ''}`}>{usingPad ? <PadGlyph input={padKeys[i]} style={style} /> : keyLabel(k)}</span>
        ))}
      </div>
      {phase === 'countdown' && count > 0 && <div className="countdown" key={count}>{count}</div>}
      {phase === 'paused' && (
        <div className="overlay">
          <div className="panel">
            <h2>Paused</h2>
            <button className="btn primary" autoFocus onClick={() => void ctrlRef.current?.resume()}>Resume</button>
            <button className="btn" onClick={() => setRun((r) => r + 1)}>Restart</button>
            <button className="btn" onClick={onQuit}>Quit</button>
          </div>
        </div>
      )}
    </div>
  );
}
