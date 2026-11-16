import { useEffect, useState } from 'react';
import type { StemName } from '../analysis/types';
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
  /** Stems stored for this song (from the ML service), for listening while debugging charts. */
  stems: StemName[];
  /** What is playing right now: the mix, a stem, or nothing. */
  previewing: PreviewSource | null;
  onPreview(source: PreviewSource | null): void;
}

export type PreviewSource = 'mix' | StemName;

/** `other` is everything but drums, bass and vocals: the source of the Lead part. */
const STEM_LABEL: Record<StemName, string> = { drums: 'Drums', bass: 'Bass', vocals: 'Vocals', other: 'Instruments' };

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

export function SongDetail({ song, builtin, status, noteCounts, stems, previewing, onBack, onPlay, onAnalyze, onDelete, onPreview }: Props) {
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

  return (
    <div className="detail">
      <header className="topbar">
        <button className="btn ghost" onClick={onBack}>← Library</button>
      </header>
      <div className="detail-body">
        <div className="detail-cover">
          <Cover blob={song.cover} title={song.title} />
          <div className="listen">
            <div className="section-label">Listen</div>
            <div className="listen-row">
              {(['mix', ...stems] as PreviewSource[]).map((src) => {
                const on = previewing === src;
                return (
                  <button
                    key={src}
                    className={`btn small ${on ? 'primary' : ''}`}
                    title={src === 'mix' ? 'Preview the song' : `Play the separated ${STEM_LABEL[src as StemName].toLowerCase()} stem`}
                    onClick={() => onPreview(on ? null : src)}
                  >
                    {on ? '■' : '▶'} {src === 'mix' ? 'Song' : STEM_LABEL[src as StemName]}
                  </button>
                );
              })}
            </div>
            {!builtin && stems.length === 0 && (
              <p className="hint">Stems appear here after analyzing with the ML service (Settings → Analysis service).</p>
            )}
          </div>
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
