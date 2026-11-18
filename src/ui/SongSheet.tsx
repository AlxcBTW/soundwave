import { ListMinus, ListPlus, PencilRuler, RotateCcw, Share, Star, Trash2, Volume2 } from 'lucide-react';
import { canPlay } from '../analysis/manager';
import { useState } from 'react';
import { DIFFICULTIES, PARTS } from '../chart/types';
import { formatTime } from '../game/setlist';
import type { BestScore, SongMeta } from '../storage/db';
import { Cover } from './Cover';
import { Dialog } from './Dialog';
import { isGold, shownStars } from '../game/scoring';
import { DIFFICULTY_LABEL, ICON_STROKE, PART_ICON, PART_LABEL, starsLabel } from './icons';
import { analysisLabel, StatusPill, type SongStatus } from './LibraryScreen';

interface Props {
  song: SongMeta;
  status: SongStatus;
  scores: BestScore[];
  /** Position in the setlist, or -1. */
  slot: number;
  setFull: boolean;
  /** Whether the song's preview is sounding (it plays by itself while the page is open). */
  previewing: boolean;
  onToggle(): void;
  onAnalyze(): void;
  /** Opens the song's charts in the track editor. */
  onEdit(): void;
  /** Saves the song as a .soundwave file, to share it. */
  onExport(): void;
  onDelete(): void;
  onClose(): void;
}

/** Everything about one song: its best scores, its place in the setlist, analysis, editing, sharing and removal. */
export function SongSheet({
  song,
  status,
  scores,
  slot,
  setFull,
  previewing,
  onToggle,
  onAnalyze,
  onEdit,
  onExport,
  onDelete,
  onClose,
}: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Playable: analysed, with notes on some part (only such a song goes in the setlist).
  const ready = canPlay(status);
  const busy = status.state === 'analyzing' || status.state === 'queued';
  const mine = scores.filter((s) => s.songId === song.id);

  return (
    <>
      <Dialog title={`${song.title} details`} onClose={onClose}>
        {(close) => (
          <div className="sheet-body">
            <div className="sheet-head">
              <Cover blob={song.cover} title={song.title} />
              <div className="sheet-title">
                <h2 className="display">{song.title}</h2>
                <p className="sheet-artist">
                  {song.artist}
                  {song.album ? ` · ${song.album}` : ''}
                  {song.duration > 0 ? ` · ${formatTime(song.duration)}` : ''}
                </p>
                <div className="sheet-status">
                  <StatusPill status={status} />
                  {!!status.edited && (
                    <span className="pill lit">
                      {status.edited} {status.edited === 1 ? 'chart' : 'charts'} edited by hand
                    </span>
                  )}
                  {busy && (
                    <>
                      <span className="meter" aria-hidden>
                        <span style={{ width: `${Math.round((status.progress ?? 0) * 100)}%` }} />
                      </span>
                      <span role="status">{analysisLabel(status)}</span>
                    </>
                  )}
                  {/* The song plays by itself while its page is open: this says that it is what is heard. */}
                  {previewing && (
                    <span className="now-playing" role="status">
                      <Volume2 strokeWidth={ICON_STROKE} aria-hidden />
                      Playing a preview
                    </span>
                  )}
                </div>
                {status.state === 'error' && <p className="error">{status.error}</p>}
              </div>
            </div>

            <div className="sheet-actions">
              <button
                type="button"
                className={`btn ${slot < 0 ? 'primary' : ''}`}
                data-autofocus
                data-sfx={slot >= 0 ? 'back' : undefined}
                disabled={!ready || (slot < 0 && setFull)}
                onClick={() => (onToggle(), close())}
              >
                {slot >= 0 ? <ListMinus strokeWidth={ICON_STROKE} aria-hidden /> : <ListPlus strokeWidth={ICON_STROKE} aria-hidden />}
                {slot >= 0 ? 'Remove from setlist' : setFull ? 'Setlist is full' : 'Add to setlist'}
              </button>
            </div>

            <section className="sheet-section" aria-label="Best scores">
              <h3 className="label">Best scores</h3>
              <table className="bests">
                <thead>
                  <tr>
                    <td />
                    {DIFFICULTIES.map((d) => (
                      <th key={d} scope="col">
                        {DIFFICULTY_LABEL[d]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PARTS.map((p) => {
                    const Icon = PART_ICON[p];
                    return (
                      <tr key={p}>
                        <th scope="row">
                          <Icon strokeWidth={ICON_STROKE} aria-hidden />
                          {PART_LABEL[p]}
                        </th>
                        {DIFFICULTIES.map((d) => {
                          const b = mine.find((s) => s.part === p && s.difficulty === d);
                          return (
                            <td key={d} className={b ? (b.fullCombo ? 'fc' : '') : 'none'}>
                              {b ? (
                                <>
                                  <span className={`best-stars ${isGold(b.stars) ? 'gold' : ''}`} aria-label={starsLabel(b.stars)}>
                                    {shownStars(b.stars)}
                                    <Star strokeWidth={ICON_STROKE} aria-hidden />
                                  </span>
                                  <span className="best-score">{b.score.toLocaleString()}</span>
                                </>
                              ) : (
                                <span aria-label="Not played">·</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            <section className="sheet-section quiet-actions" aria-label="Manage">
              {!busy && (
                <button type="button" className="btn quiet small" onClick={onAnalyze}>
                  <RotateCcw strokeWidth={ICON_STROKE} aria-hidden />
                  {ready && !status.manual ? 'Analyze again' : 'Analyze'}
                </button>
              )}
              <button
                type="button"
                className="btn quiet small"
                disabled={!ready}
                onClick={onEdit}
                title="Change the song's charts note by note in the track editor"
              >
                <PencilRuler strokeWidth={ICON_STROKE} aria-hidden />
                Edit charts
              </button>
              <button
                type="button"
                className="btn quiet small"
                onClick={onExport}
                title="Save the song with its charts as one .soundwave file, to share it"
              >
                <Share strokeWidth={ICON_STROKE} aria-hidden />
                Export
              </button>
              <button type="button" className="btn quiet small" onClick={() => setConfirmDelete(true)}>
                <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
                Remove
              </button>
            </section>
          </div>
        )}
      </Dialog>
      {/* Removing asks first, in a card of its own over the sheet: Keep is where the focus lands. */}
      {confirmDelete && (
        <Dialog title={`Remove ${song.title}`} variant="card" closeLabel="Keep" onClose={() => setConfirmDelete(false)}>
          {(close) => (
            <div className="pause-card">
              <h2 className="display">Remove this song?</h2>
              <p className="hint">
                <b>{song.title}</b> leaves your library together with its charts and its best scores. This cannot be undone.
              </p>
              <button type="button" className="btn wide" data-autofocus data-sfx="back" onClick={close}>
                Keep
              </button>
              <button type="button" className="btn danger wide" onClick={onDelete}>
                <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
                Delete song and scores
              </button>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
