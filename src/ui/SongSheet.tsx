import { Bug, ListMinus, ListPlus, PencilRuler, Play, RotateCcw, Share, Square, Star, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StemName } from '../analysis/types';
import { getEngine } from '../audio/engine';
import { loadSongBuffer } from '../audio/songAudio';
import { DIFFICULTIES, PARTS } from '../chart/types';
import { formatTime } from '../game/setlist';
import { getStem, listStems, type BestScore, type SongMeta } from '../storage/db';
import { Cover } from './Cover';
import { Dialog } from './Dialog';
import { isGold, shownStars } from '../game/scoring';
import { DIFFICULTY_LABEL, ICON_STROKE, PART_ICON, PART_LABEL, starsLabel } from './icons';
import { analysisLabel, StatusPill, type SongStatus } from './LibraryScreen';
import { PreviewBar } from './PreviewBar';

export type PreviewSource = 'mix' | StemName;

/** `other` is everything but drums, bass and vocals: the source of the Lead part. */
const STEM_LABEL: Record<StemName, string> = { drums: 'Drums', bass: 'Bass', vocals: 'Vocals', other: 'Instruments' };

interface Props {
  song: SongMeta;
  builtin: boolean;
  status: SongStatus;
  scores: BestScore[];
  /** Position in the setlist, or -1. */
  slot: number;
  setFull: boolean;
  volume: number;
  onToggle(): void;
  onAnalyze(): void;
  onDebug(): void;
  /** Opens the song's charts in the track editor. */
  onEdit(): void;
  /** Saves the song as a .festival file, to share it. */
  onExport(): void;
  onDelete(): void;
  onClose(): void;
  /** Tells the app that a preview is sounding, so the menu music makes way. */
  onPreviewing(on: boolean): void;
  toast(text: string): void;
}

/** Everything about one song: listening to it and its stems, best scores, analysis, sharing and removal. */
export function SongSheet({ song, builtin, status, scores, slot, setFull, volume, onToggle, onAnalyze, onDebug, onEdit, onExport, onDelete, onClose, onPreviewing, toast }: Props) {
  const [previewing, setPreviewing] = useState<PreviewSource | null>(null);
  const [stems, setStems] = useState<StemName[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ready = status.state === 'ready';
  const busy = status.state === 'analyzing' || status.state === 'queued';
  const mine = scores.filter((s) => s.songId === song.id);
  const live = useRef(true);

  // Stems stored for the song (refreshed when its analysis finishes).
  useEffect(() => {
    setStems([]);
    if (builtin) return;
    let cancelled = false;
    void listStems(song.id)
      .then((s) => !cancelled && setStems(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [song.id, builtin, ready]);

  const preview = useCallback(
    async (source: PreviewSource | null) => {
      const engine = getEngine();
      engine.stop();
      setPreviewing(source);
      if (!source) return;
      try {
        let buf: AudioBuffer;
        if (source === 'mix') buf = await loadSongBuffer(song.id);
        else {
          const blob = await getStem(song.id, source);
          if (!blob) throw new Error('This stem is no longer stored. Analyze the song again.');
          buf = await engine.decode(await blob.arrayBuffer());
        }
        if (!live.current) return;
        engine.load(buf);
        engine.offset = 0;
        engine.volume = volume * 0.8;
        engine.onEnded = () => setPreviewing((p) => (p === source ? null : p));
        // The song preview starts a third in; stems play in full for checking the separation.
        await engine.play(source === 'mix' ? buf.duration / 3 : 0, 0.05);
      } catch (e) {
        setPreviewing(null);
        toast((e as Error).message);
      }
    },
    [song.id, volume, toast],
  );

  useEffect(() => onPreviewing(previewing !== null), [previewing, onPreviewing]);
  useEffect(
    () => () => {
      live.current = false;
      getEngine().stop();
      onPreviewing(false);
    },
    [onPreviewing],
  );

  return (
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
                {!!status.edited && <span className="pill lit">{status.edited} {status.edited === 1 ? 'chart' : 'charts'} edited by hand</span>}
                {busy && (
                  <>
                    <span className="meter" aria-hidden>
                      <span style={{ width: `${Math.round((status.progress ?? 0) * 100)}%` }} />
                    </span>
                    <span role="status">{analysisLabel(status)}</span>
                  </>
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

          <section className="sheet-section" aria-label="Listen">
            <h3 className="label">Listen</h3>
            <div className="listen-row">
              {(['mix', ...stems] as PreviewSource[]).map((src) => {
                const on = previewing === src;
                const Icon = on ? Square : Play;
                return (
                  <button key={src} type="button" className={`btn small ${on ? 'live' : ''}`} data-sfx="none" aria-pressed={on} onClick={() => void preview(on ? null : src)}>
                    <Icon strokeWidth={ICON_STROKE} aria-hidden />
                    {src === 'mix' ? 'Song' : STEM_LABEL[src as StemName]}
                  </button>
                );
              })}
            </div>
            <PreviewBar active={previewing !== null} label={previewing === 'mix' || previewing === null ? 'Song' : STEM_LABEL[previewing]} />
            {!builtin && stems.length === 0 && <p className="hint">The song’s separated stems appear here once it is analyzed.</p>}
          </section>

          <section className="sheet-section" aria-label="Best scores">
            <h3 className="label">Best scores</h3>
            <table className="bests">
              <thead>
                <tr>
                  <td />
                  {DIFFICULTIES.map((d) => (
                    <th key={d} scope="col">{DIFFICULTY_LABEL[d]}</th>
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

          {!builtin && (
            <section className="sheet-section quiet-actions" aria-label="Manage">
              {!busy && (
                <button type="button" className="btn quiet small" onClick={onAnalyze}>
                  <RotateCcw strokeWidth={ICON_STROKE} aria-hidden />
                  {ready ? 'Analyze again' : 'Analyze'}
                </button>
              )}
              <button type="button" className="btn quiet small" disabled={!ready} onClick={onEdit} title="Change the song's charts note by note in the track editor">
                <PencilRuler strokeWidth={ICON_STROKE} aria-hidden />
                Edit charts
              </button>
              <button type="button" className="btn quiet small" disabled={!ready} onClick={onDebug} title="Play the song with its notes on a timeline and mark problems">
                <Bug strokeWidth={ICON_STROKE} aria-hidden />
                Debug chart
              </button>
              <button type="button" className="btn quiet small" onClick={onExport} title="Save the song with its charts as one .festival file, to share it">
                <Share strokeWidth={ICON_STROKE} aria-hidden />
                Export
              </button>
              {confirmDelete ? (
                <>
                  <button type="button" className="btn danger small" onClick={onDelete}>
                    <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
                    Delete song and scores
                  </button>
                  <button type="button" className="btn quiet small" data-sfx="back" onClick={() => setConfirmDelete(false)}>
                    Keep
                  </button>
                </>
              ) : (
                <button type="button" className="btn quiet small" onClick={() => setConfirmDelete(true)}>
                  <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
                  Remove
                </button>
              )}
            </section>
          )}
        </div>
      )}
    </Dialog>
  );
}
