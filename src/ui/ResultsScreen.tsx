import { ArrowRight, Flag, Home, Repeat } from 'lucide-react';
import { useEffect, useState } from 'react';
import { playSfx } from '../audio/sfx';
import type { Results } from '../game/GameSession';
import { menuPulse } from '../input/rumble';
import type { SongMeta } from '../storage/db';
import { useActions } from './actions';
import { Cover } from './Cover';
import { shownStars, isGold } from '../game/scoring';
import { Stars } from './icons';

/** One song of a set once it has been played (or skipped). */
export interface SetResult {
  song: SongMeta;
  results: Results | null;
  /** The best score before this run, when there was one. */
  best?: number;
}

const reducedMotion = () => document.documentElement.dataset.motion === 'reduced';

/** Counts from 0 to `target` with an exponential ease-out (instantly with reduced motion). */
function useCountUp(target: number, ms = 1300, delay = 0): number {
  const [value, setValue] = useState(() => (reducedMotion() ? target : 0));
  useEffect(() => {
    if (reducedMotion()) return setValue(target);
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - start) / ms));
      setValue(Math.round(target * (1 - Math.pow(2, -10 * p))));
      if (p > 0 && p < 0.75) playSfx('count');
      if (p < 1) raf = requestAnimationFrame(tick);
      else setValue(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, delay]);
  return value;
}

interface Props {
  song: SongMeta;
  subtitle: string;
  results: Results;
  best?: number;
  /** Position in the set, from 1, and its size. */
  position: number;
  total: number;
  /** The song that follows, if any. */
  next?: SongMeta;
  onRetry(): void;
  onNext(): void;
  /** Ends the set here (only offered while songs remain). */
  onEnd(): void;
}

export function ResultsScreen({ song, subtitle, results: r, best, position, total, next, onRetry, onNext, onEnd }: Props) {
  const newBest = r.score > 0 && (best === undefined || r.score > best);
  const score = useCountUp(r.score);
  // (The crowd has already had its say: it claps through the finale before this screen comes up.)
  // The stars land one by one (see .results-stars in styles.css); each rings a little higher.
  useEffect(() => {
    const timers = Array.from({ length: shownStars(r.stars) }, (_, k) =>
      window.setTimeout(
        () => {
          playSfx('star', { index: k });
          menuPulse('star');
        },
        250 + k * 140 + 120,
      ),
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

  const last = !next;
  useActions([
    ...(last ? [] : [{ id: 'end', label: 'End the set', icon: Flag, kbd: 'Escape', sfx: 'back', run: onEnd }]),
    { id: 'retry', label: 'Play again', icon: Repeat, kbd: 'KeyR', pad: 'b3', sfx: 'launch', run: onRetry },
    {
      id: 'next',
      label: last ? (total > 1 ? 'Set summary' : 'Done') : 'Next song',
      icon: last && total === 1 ? Home : ArrowRight,
      kbd: 'Enter',
      primary: true,
      sfx: last ? undefined : 'launch',
      run: onNext,
    },
  ]);

  return (
    <div className="page results">
      <div className="results-body">
        <section className="results-main" aria-label="Result">
          <div className="results-song">
            <Cover blob={song.cover} title={song.title} />
            <div>
              <h1 className="display results-title">{song.title}</h1>
              <p className="results-sub">
                {subtitle}
                {total > 1 && ` · song ${position} of ${total}`}
              </p>
            </div>
          </div>
          <Stars n={r.stars} className="results-stars" />
          <div className="results-score num" role="img" aria-label={`Score ${r.score.toLocaleString()}`}>
            {score.toLocaleString()}
          </div>
          <div className="results-tags">
            {newBest && <span className="tag hot">New best</span>}
            {isGold(r.stars) && <span className="tag gold">Gold stars</span>}
            {r.fullCombo && <span className="tag gold">Full combo</span>}
            {!newBest && best !== undefined && <span className="tag">Best {best.toLocaleString()}</span>}
          </div>
        </section>

        <section className="results-side" aria-label="Details">
          <dl className="results-stats">
            <div>
              <dt>Accuracy</dt>
              <dd>{Math.round(r.accuracy * 100)}%</dd>
            </div>
            <div>
              <dt>Best streak</dt>
              <dd>{r.bestStreak}</dd>
            </div>
            <div>
              <dt>Perfect</dt>
              <dd>{r.counts.perfect}</dd>
            </div>
            <div>
              <dt>Great</dt>
              <dd>{r.counts.great}</dd>
            </div>
            <div>
              <dt>Good</dt>
              <dd>{r.counts.good}</dd>
            </div>
            <div className="miss">
              <dt>Miss</dt>
              <dd>{r.counts.miss}</dd>
            </div>
            <div>
              <dt>Overdrives</dt>
              <dd>{r.overdriveActivations}</dd>
            </div>
            {r.releases.total > 0 && (
              <div>
                <dt>Releases</dt>
                <dd>
                  {r.releases.hit}/{r.releases.total}
                </dd>
              </div>
            )}
            <div>
              <dt>Notes</dt>
              <dd>{r.totalNotes}</dd>
            </div>
          </dl>
          {next && (
            <div className="next-up">
              <span className="label">Next up</span>
              <Cover blob={next.cover} title={next.title} />
              <span className="song-text">
                <span className="song-title">{next.title}</span>
                <span className="song-artist">{next.artist}</span>
              </span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

interface SummaryProps {
  set: SetResult[];
  subtitle: string;
  onAgain(): void;
  onDone(): void;
}

/** The whole set at the end: every song's stars and score, and the totals. */
export function SummaryScreen({ set, subtitle, onAgain, onDone }: SummaryProps) {
  const played = set.filter((s) => s.results);
  const totalScore = played.reduce((t, s) => t + s.results!.score, 0);
  const stars = played.reduce((t, s) => t + shownStars(s.results!.stars), 0);
  const score = useCountUp(totalScore, 1400, 300);
  useEffect(() => {
    const timer = window.setTimeout(() => playSfx(stars >= played.length * 3 ? 'cheer' : 'applause'), 60);
    return () => clearTimeout(timer);
  }, [stars, played.length]);

  useActions([
    { id: 'again', label: 'Play the set again', icon: Repeat, kbd: 'KeyR', pad: 'b3', sfx: 'launch', run: onAgain },
    { id: 'done', label: 'Done', icon: Home, kbd: 'Enter', primary: true, run: onDone },
  ]);

  return (
    <div className="page results summary">
      <div className="summary-body">
        <header className="summary-head">
          <h1 className="display">Set complete</h1>
          <p className="results-sub">{subtitle}</p>
        </header>
        <div className="summary-total">
          <div className="results-score num" role="img" aria-label={`Total score ${totalScore.toLocaleString()}`}>
            {score.toLocaleString()}
          </div>
          <p className="summary-stars">
            <span className="num">{stars}</span> of {set.length * 5} stars
          </p>
        </div>
        <ol className="summary-list">
          {set.map((s, i) => {
            const newBest = s.results && s.results.score > 0 && (s.best === undefined || s.results.score > s.best);
            return (
              <li key={s.song.id} className={`set-card ${s.results ? '' : 'skipped'}`} style={{ ['--i' as string]: i }}>
                <span className="slot-num" aria-hidden>
                  {i + 1}
                </span>
                <Cover blob={s.song.cover} title={s.song.title} />
                <span className="song-text">
                  <span className="song-title">{s.song.title}</span>
                  <span className="song-artist">{s.song.artist}</span>
                </span>
                <span className="set-best">
                  {s.results ? (
                    <>
                      {newBest && <span className="tag hot">New best</span>}
                      {s.results.fullCombo && <span className="tag gold">Full combo</span>}
                      <Stars n={s.results.stars} />
                      <span className="num">{s.results.score.toLocaleString()}</span>
                    </>
                  ) : (
                    <span className="dim">Skipped</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
