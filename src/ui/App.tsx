import { useMemo, useState } from 'react';
import { DIFFICULTIES, type Chart, type Difficulty } from '../chart/types';
import { getEngine } from '../audio/engine';
import type { Results } from '../game/GameSession';
import { demoChart, renderDemoAudio } from '../game/demo';
import { loadSettings } from '../game/settings';
import { PlayScreen } from './PlayScreen';
import { ResultsScreen } from './ResultsScreen';

type View =
  | { name: 'menu' }
  | { name: 'play'; title: string; buffer: AudioBuffer; chart: Chart; key: number }
  | { name: 'results'; title: string; buffer: AudioBuffer; chart: Chart; results: Results };

function demoBuffer(): AudioBuffer {
  const engine = getEngine();
  const { channels, sampleRate } = renderDemoAudio(engine.ctx.sampleRate);
  const buf = engine.ctx.createBuffer(2, channels[0].length, sampleRate);
  channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return buf;
}

export function App() {
  const [view, setView] = useState<View>({ name: 'menu' });
  const settings = useMemo(loadSettings, []);

  const playDemo = (d: Difficulty) =>
    setView({ name: 'play', title: 'Demo Track', buffer: demoBuffer(), chart: demoChart(d), key: Date.now() });

  if (view.name === 'play') {
    return (
      <PlayScreen
        key={view.key}
        title={view.title}
        buffer={view.buffer}
        chart={view.chart}
        settings={settings}
        onQuit={() => setView({ name: 'menu' })}
        onFinish={(results) => setView({ ...view, name: 'results', results })}
      />
    );
  }
  if (view.name === 'results') {
    return (
      <ResultsScreen
        title={view.title}
        subtitle={`${view.chart.part} · ${view.chart.difficulty}`}
        results={view.results}
        onRetry={() => setView({ ...view, name: 'play', key: Date.now() })}
        onDone={() => setView({ name: 'menu' })}
      />
    );
  }
  return (
    <div className="screen">
      <div className="panel">
        <h1 className="logo">FESTIVAL</h1>
        <p className="dim">Demo track</p>
        <div className="row">
          {DIFFICULTIES.map((d) => (
            <button key={d} className="btn primary" onClick={() => playDemo(d)}>{d}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
