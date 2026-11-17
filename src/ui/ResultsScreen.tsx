import { useEffect } from 'react';
import type { Results } from '../game/GameSession';

interface Props {
  title: string;
  subtitle: string;
  results: Results;
  best?: number;
  onRetry(): void;
  onDone(): void;
}

export function ResultsScreen({ title, subtitle, results: r, best, onRetry, onDone }: Props) {
  const newBest = best === undefined || r.score > best;
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.code === 'Escape' && onDone();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onDone]);
  return (
    <div className="screen results">
      <div className="panel wide">
        <div className="eyebrow">{subtitle}</div>
        <h1>{title}</h1>
        <div className="results-stars">{'★'.repeat(r.stars)}<span className="dim">{'★'.repeat(5 - r.stars)}</span></div>
        <div className="results-score">{r.score.toLocaleString()}</div>
        {newBest && r.score > 0 && <div className="badge">New best</div>}
        {r.fullCombo && <div className="badge gold">Full combo</div>}
        <div className="results-grid">
          <div><b>{Math.round(r.accuracy * 100)}%</b><span>Accuracy</span></div>
          <div><b>{r.bestStreak}</b><span>Best streak</span></div>
          <div><b>{r.counts.perfect}</b><span>Perfect</span></div>
          <div><b>{r.counts.great}</b><span>Great</span></div>
          <div><b>{r.counts.good}</b><span>Good</span></div>
          <div><b>{r.counts.miss}</b><span>Miss</span></div>
          <div><b>{r.overdriveActivations}</b><span>Overdrives</span></div>
          <div><b>{r.totalNotes}</b><span>Notes</span></div>
        </div>
        <div className="row">
          <button className="btn" onClick={onRetry}>Play again</button>
          <button className="btn primary" autoFocus onClick={onDone}>Continue</button>
        </div>
      </div>
    </div>
  );
}
