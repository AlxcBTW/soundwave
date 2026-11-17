import { ArrowRight, Repeat } from 'lucide-react';
import { useEffect, useState } from 'react';
import { playSfx } from '../audio/sfx';
import { menuPulse } from '../input/rumble';
import type { Results } from '../game/GameSession';
import { ICON_STROKE, Stars } from './icons';

interface Props {
  title: string;
  subtitle: string;
  results: Results;
  best?: number;
  onRetry(): void;
  onDone(): void;
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Counts from 0 to `target` with an exponential ease-out (instantly with reduced motion). */
function useCountUp(target: number, ms = 1300): number {
  const [value, setValue] = useState(() => (reducedMotion() ? target : 0));
  useEffect(() => {
    if (reducedMotion()) return setValue(target);
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      setValue(Math.round(target * (1 - Math.pow(2, -10 * p))));
      if (p < 0.75) playSfx('count');
      if (p < 1) raf = requestAnimationFrame(tick);
      else setValue(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

export function ResultsScreen({ title, subtitle, results: r, best, onRetry, onDone }: Props) {
  const newBest = r.score > 0 && (best === undefined || r.score > best);
  const score = useCountUp(r.score);
  // The stars land one by one (see .results-stars in styles.css); each rings a little higher.
  useEffect(() => {
    const timers = Array.from({ length: r.stars }, (_, k) =>
      window.setTimeout(() => {
        playSfx('star', { index: k });
        menuPulse('star');
      }, 250 + k * 140 + 120),
    );
    if (newBest)
      timers.push(
        window.setTimeout(() => {
          playSfx('best');
          menuPulse('select');
        }, 1250),
      );
    return () => timers.forEach(clearTimeout);
  }, [r.stars, newBest]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.code === 'Escape' && onDone();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onDone]);

  return (
    <div className="screen results">
      <div className="results-card">
        <h1 className="results-title">{title}</h1>
        <p className="results-sub">{subtitle}</p>
        <Stars n={r.stars} className="results-stars" />
        <div className="results-score" aria-label={`Score ${r.score.toLocaleString()}`}>
          {score.toLocaleString()}
        </div>
        {(newBest || r.fullCombo) && (
          <div className="results-tags">
            {newBest && <span className="tag hot">New best</span>}
            {r.fullCombo && <span className="tag gold">Full combo</span>}
          </div>
        )}
        <dl className="results-stats">
          <div><dt>Accuracy</dt><dd>{Math.round(r.accuracy * 100)}%</dd></div>
          <div><dt>Best streak</dt><dd>{r.bestStreak}</dd></div>
          <div><dt>Perfect</dt><dd>{r.counts.perfect}</dd></div>
          <div><dt>Great</dt><dd>{r.counts.great}</dd></div>
          <div><dt>Good</dt><dd>{r.counts.good}</dd></div>
          <div className="miss"><dt>Miss</dt><dd>{r.counts.miss}</dd></div>
          <div><dt>Overdrives</dt><dd>{r.overdriveActivations}</dd></div>
          <div><dt>Notes</dt><dd>{r.totalNotes}</dd></div>
        </dl>
        <div className="results-actions">
          <button className="btn" onClick={onRetry}>
            <Repeat strokeWidth={ICON_STROKE} aria-hidden />
            Play again
          </button>
          <button className="btn primary" autoFocus onClick={onDone}>
            Continue
            <ArrowRight strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
