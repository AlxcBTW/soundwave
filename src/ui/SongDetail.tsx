import { ArrowLeft, Bug, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { StemName } from '../analysis/types';
import { DIFFICULTIES, PARTS, lanesFor, type Difficulty, type Part } from '../chart/types';
import { getScores, type BestScore, type SongMeta } from '../storage/db';
import { Cover } from './Cover';
import { ICON_STROKE, PART_ICON, PART_LABEL, Stars } from './icons';
import { PreviewBar } from './PreviewBar';
import { analysisLabel, StatusPill, type SongStatus } from './LibraryScreen';
import { useSlide } from './useSlide';

interface Props {
  song: SongMeta;
  builtin: boolean;
  status: SongStatus;
  noteCounts?: Partial<Record<Part, Partial<Record<Difficulty, number>>>>;
  onBack(): void;
  onPlay(part: Part, difficulty: Difficulty): void;
  onAnalyze(): void;
  onDelete(): void;
  /** Stems stored for this song (from the ML service), for listening while debugging charts. */
  stems: StemName[];
  /** What is playing right now: the mix, a stem, or nothing. */
  previewing: PreviewSource | null;
  onPreview(source: PreviewSource | null): void;
  /** Opens the chart debugger (play with notes, annotate problems). */
  onDebug(): void;
}

export type PreviewSource = 'mix' | StemName;

/** `other` is everything but drums, bass and vocals: the source of the Lead part. */
const STEM_LABEL: Record<StemName, string> = { drums: 'Drums', bass: 'Bass', vocals: 'Vocals', other: 'Instruments' };

/** Difficulty as a level of four pips. */
const LEVEL: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3, expert: 4 };


const PREFS_KEY = 'festival.lastPick';
function lastPick(): { part: Part; difficulty: Difficulty } {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '');
    if (PARTS.includes(v.part) && DIFFICULTIES.includes(v.difficulty)) return v;
  } catch {
    /* none saved */
  }
  return { part: 'lead', difficulty: 'medium' };
}

export function SongDetail({ song, builtin, status, noteCounts, stems, previewing, onBack, onPlay, onAnalyze, onDelete, onPreview, onDebug }: Props) {
  const [pick, setPick] = useState(lastPick);
  const [scores, setScores] = useState<BestScore[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    void getScores(song.id).then(setScores).catch(() => setScores([]));
  }, [song.id]);
  useEffect(() => () => onPreview(null), [onPreview]);

  const choose = (p: Partial<typeof pick>) => {
    const next = { ...pick, ...p };
    setPick(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const best = (part: Part, d: Difficulty) => scores.find((s) => s.part === part && s.difficulty === d);
  const ready = status.state === 'ready';
  const play = () => ready && onPlay(pick.part, pick.difficulty);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onBack();
      else if (e.code === 'Enter' && ready && !(e.target instanceof HTMLButtonElement)) play();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const partRow = useSlide<HTMLDivElement>(pick.part);
  const diffList = useSlide<HTMLDivElement>(`${pick.part}:${pick.difficulty}`);
  const busy = status.state === 'analyzing' || status.state === 'queued';

  return (
    <div className="detail">
      <header className="topbar">
        <button className="btn ghost" data-sfx="back" onClick={onBack}>
          <ArrowLeft strokeWidth={ICON_STROKE} aria-hidden />
          Setlist
        </button>
      </header>
      <div className="detail-body">
        <aside className="detail-cover">
          <Cover blob={song.cover} title={song.title} />
          <section className="listen" aria-label="Listen">
            <h2 className="section-label">Listen</h2>
            <div className="listen-row">
              {(['mix', ...stems] as PreviewSource[]).map((src) => {
                const on = previewing === src;
                const Icon = on ? Square : Play;
                return (
                  <button
                    key={src}
                    className={`btn small ${on ? 'live' : ''}`}
                    aria-pressed={on}
                    title={src === 'mix' ? 'Preview the song' : `Play the separated ${STEM_LABEL[src as StemName].toLowerCase()} stem`}
                    onClick={() => onPreview(on ? null : src)}
                  >
                    <Icon strokeWidth={ICON_STROKE} aria-hidden />
                    {src === 'mix' ? 'Song' : STEM_LABEL[src as StemName]}
                  </button>
                );
              })}
            </div>
            <PreviewBar active={previewing !== null} label={previewing === 'mix' || previewing === null ? 'Song' : STEM_LABEL[previewing]} />
            {!builtin && stems.length === 0 && <p className="hint">Separated stems appear here after an analysis with the analysis service (Settings, Analysis).</p>}
          </section>
        </aside>

        <div className="detail-main">
          <div className="title-block">
            <h1 className="detail-title">{song.title}</h1>
            <p className="detail-artist">
              {song.artist}
              {song.album ? <span className="dim"> · {song.album}</span> : null}
            </p>
            <div className="detail-status">
              <StatusPill status={status} />
              {busy && (
                <>
                  <span className="card-progress inline" aria-hidden>
                    <span style={{ width: `${Math.round((status.progress ?? 0) * 100)}%` }} />
                  </span>
                  <span className="analysis-label" role="status">{analysisLabel(status)}</span>
                </>
              )}
            </div>
            {status.state === 'error' && <p className="error">{status.error}</p>}
            {status.state === 'ready' && status.warning && <p className="error">{status.warning}</p>}
          </div>

          <h2 className="section-label">Part</h2>
          <div className="part-row slide" ref={partRow} role="radiogroup" aria-label="Part">
            <span className="sel" aria-hidden />
            {PARTS.map((p) => {
              const Icon = PART_ICON[p];
              const on = pick.part === p;
              return (
                <button key={p} className={`riser part ${on ? 'on' : ''}`} data-on={on} role="radio" aria-checked={on} onClick={() => choose({ part: p })}>
                  <Icon strokeWidth={ICON_STROKE} aria-hidden />
                  <span>{PART_LABEL[p]}</span>
                </button>
              );
            })}
          </div>

          <h2 className="section-label">Difficulty</h2>
          <div className="diff-list slide" ref={diffList} role="radiogroup" aria-label="Difficulty">
            <span className="sel" aria-hidden />
            {DIFFICULTIES.map((d) => {
              const b = best(pick.part, d);
              const count = noteCounts?.[pick.part]?.[d];
              const on = pick.difficulty === d;
              return (
                <button key={d} className={`riser diff ${on ? 'on' : ''}`} data-on={on} role="radio" aria-checked={on} onClick={() => choose({ difficulty: d })}>
                  <span className="diff-pips" aria-hidden>
                    {[1, 2, 3, 4].map((k) => (
                      <span key={k} className={k <= LEVEL[d] ? `lit l${LEVEL[d]}` : ''} />
                    ))}
                  </span>
                  <span className="diff-name">{d}</span>
                  <span className="diff-lanes">
                    {lanesFor(d)} lanes{count !== undefined ? ` · ${count.toLocaleString()} notes` : ''}
                  </span>
                  <span className="diff-best">
                    {b ? (
                      <>
                        <Stars n={b.stars} />
                        <span className="diff-score">{b.score.toLocaleString()}</span>
                        {b.fullCombo && <span className="tag">Full combo</span>}
                      </>
                    ) : (
                      <span className="dim">Not played</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="detail-actions">
            <button className="btn primary big launch" data-sfx="launch" disabled={!ready} onClick={play}>
              <Play strokeWidth={ICON_STROKE} aria-hidden />
              Play {PART_LABEL[pick.part]} · {pick.difficulty}
            </button>
            {!builtin && (
              <div className="quiet-actions">
                {!busy && (
                  <button className="btn ghost small" onClick={onAnalyze}>
                    <RotateCcw strokeWidth={ICON_STROKE} aria-hidden />
                    {status.state === 'ready' ? 'Re-analyze' : 'Analyze'}
                  </button>
                )}
                <button className="btn ghost small" disabled={!ready} onClick={onDebug} title="Play the song with its notes on a timeline and mark problems">
                  <Bug strokeWidth={ICON_STROKE} aria-hidden />
                  Debug chart
                </button>
                {confirmDelete ? (
                  <>
                    <button className="btn danger small" onClick={onDelete}>
                      <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
                      Delete song
                    </button>
                    <button className="btn ghost small" onClick={() => setConfirmDelete(false)}>Keep</button>
                  </>
                ) : (
                  <button className="btn ghost small" onClick={() => setConfirmDelete(true)}>
                    <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
