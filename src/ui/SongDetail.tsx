import { useEffect, useState } from 'react';
import { DIFFICULTIES, PARTS, lanesFor, type Difficulty, type Part } from '../chart/types';
import { getScores, type BestScore, type SongMeta } from '../storage/db';
import { Cover } from './Cover';
import { StatusPill, type SongStatus } from './LibraryScreen';

interface Props {
  song: SongMeta;
  builtin: boolean;
  status: SongStatus;
  noteCounts?: Partial<Record<Part, Partial<Record<Difficulty, number>>>>;
  onBack(): void;
  onPlay(part: Part, difficulty: Difficulty): void;
  onAnalyze(): void;
  onDelete(): void;
  onPreview(on: boolean): void;
}

const PART_LABEL: Record<Part, string> = { lead: 'Lead', bass: 'Bass', drums: 'Drums', vocals: 'Vocals' };
const PART_ICON: Record<Part, string> = { lead: '🎹', bass: '🎸', drums: '🥁', vocals: '🎤' };

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

export function SongDetail({ song, builtin, status, noteCounts, onBack, onPlay, onAnalyze, onDelete, onPreview }: Props) {
  const [pick, setPick] = useState(lastPick);
  const [scores, setScores] = useState<BestScore[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    void getScores(song.id).then(setScores).catch(() => setScores([]));
  }, [song.id]);
  useEffect(() => () => onPreview(false), [onPreview]);

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

  return (
    <div className="detail">
      <header className="topbar">
        <button className="btn ghost" onClick={onBack}>← Library</button>
      </header>
      <div className="detail-body">
        <div className="detail-cover">
          <Cover blob={song.cover} title={song.title} />
          <button
            className="btn small"
            onClick={() => {
              onPreview(!previewing);
              setPreviewing(!previewing);
            }}
          >
            {previewing ? '■ Stop preview' : '▶ Preview'}
          </button>
        </div>
        <div className="detail-main panel left">
          <div className="eyebrow">{song.artist}{song.album ? ` · ${song.album}` : ''}</div>
          <h1 className="detail-title">{song.title}</h1>
          <StatusPill status={status} />
          {status.state === 'analyzing' && (
            <div className="card-progress inline"><div style={{ width: `${Math.round((status.progress ?? 0) * 100)}%` }} /></div>
          )}
          {status.state === 'error' && <p className="error">{status.error}</p>}

          <div className="section-label">Part</div>
          <div className="seg">
            {PARTS.map((p) => (
              <button key={p} className={`seg-btn ${pick.part === p ? 'on' : ''}`} onClick={() => choose({ part: p })}>
                <span className="seg-icon">{PART_ICON[p]}</span>
                {PART_LABEL[p]}
              </button>
            ))}
          </div>

          <div className="section-label">Difficulty</div>
          <div className="diff-list">
            {DIFFICULTIES.map((d) => {
              const b = best(pick.part, d);
              const count = noteCounts?.[pick.part]?.[d];
              return (
                <button key={d} className={`diff ${pick.difficulty === d ? 'on' : ''}`} onClick={() => choose({ difficulty: d })}>
                  <span className="diff-name">{d}</span>
                  <span className="diff-lanes">{lanesFor(d)} lanes{count !== undefined ? ` · ${count} notes` : ''}</span>
                  <span className="diff-best">
                    {b ? (
                      <>
                        <span className="stars">{'★'.repeat(b.stars)}</span> {b.score.toLocaleString()}
                        {b.fullCombo ? ' · FC' : ''}
                      </>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="row left">
            <button className="btn primary big" disabled={!ready} onClick={play}>Play</button>
            {!builtin && status.state !== 'analyzing' && status.state !== 'queued' && (
              <button className="btn" onClick={onAnalyze}>{status.state === 'ready' ? 'Re-analyze' : 'Analyze'}</button>
            )}
            {!builtin &&
              (confirmDelete ? (
                <>
                  <button className="btn danger" onClick={onDelete}>Delete song</button>
                  <button className="btn ghost" onClick={() => setConfirmDelete(false)}>Keep</button>
                </>
              ) : (
                <button className="btn ghost" onClick={() => setConfirmDelete(true)}>Remove</button>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
