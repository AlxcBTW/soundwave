import { Plus, Settings, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AnalysisStatus } from '../analysis/manager';
import { ACCEPTED } from '../audio/importSong';
import type { SongMeta } from '../storage/db';
import { Cover } from './Cover';
import { ICON_STROKE } from './icons';

export type SongStatus = AnalysisStatus;

interface Props {
  songs: SongMeta[];
  status: Record<string, SongStatus>;
  importing: number;
  onImport(files: File[]): void;
  onOpen(song: SongMeta): void;
  onSettings(): void;
}

const fmtTime = (s: number) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');

export function LibraryScreen({ songs, status, importing, onImport, onOpen, onSettings }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) onImport(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [onImport]);

  return (
    <div className="library">
      <header className="topbar">
        <h1 className="wordmark">Festival</h1>
        <div className="topbar-actions">
          <button className="btn primary" onClick={() => input.current?.click()}>
            <Upload strokeWidth={ICON_STROKE} aria-hidden />
            {importing ? `Importing ${importing}…` : 'Add songs'}
          </button>
          <button className="btn" onClick={onSettings}>
            <Settings strokeWidth={ICON_STROKE} aria-hidden />
            Settings
          </button>
        </div>
        <input
          ref={input}
          type="file"
          accept={ACCEPTED}
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) onImport(files);
          }}
        />
      </header>
      <h2 className="setlist-title">
        Setlist <span className="setlist-count">{songs.length}</span>
      </h2>
      <div className="song-grid">
        {songs.map((s, i) => {
          const st = status[s.id];
          return (
            <button key={s.id} className="song-card" style={{ ['--i' as string]: Math.min(i, 14) }} onClick={() => onOpen(s)}>
              <span className="cover-frame">
                <Cover blob={s.cover} title={s.title} />
                <span className="sheen" aria-hidden />
              </span>
              <span className="song-title">{s.title}</span>
              <span className="song-artist">{s.artist}</span>
              <span className="song-meta">
                <span className="song-length">{fmtTime(s.duration)}</span>
                {st && <StatusPill status={st} />}
              </span>
              {(st?.state === 'analyzing' || st?.state === 'queued') && (
                <span className="card-progress" aria-hidden>
                  <span style={{ width: `${Math.round((st.progress ?? 0) * 100)}%` }} />
                </span>
              )}
            </button>
          );
        })}
        <button className="song-card add" style={{ ['--i' as string]: Math.min(songs.length, 14) }} onClick={() => input.current?.click()}>
          <span className="add-icon">
            <Plus strokeWidth={ICON_STROKE} aria-hidden />
          </span>
          <span className="song-title">Add your music</span>
          <span className="song-artist">Drop files here or browse. MP3, WAV, FLAC, OGG, M4A.</span>
        </button>
      </div>
      {dragging && <div className="drop-overlay">Drop to add to your setlist</div>}
    </div>
  );
}

/** Only problems get a pill: a ready song needs no label, and analysis shows as a lit bar. */
export function StatusPill({ status }: { status: SongStatus }) {
  if (status.state === 'ready' || status.state === 'analyzing' || status.state === 'queued') return null;
  return (
    <span className={`pill ${status.state}`} title={status.error}>
      {status.state === 'error' ? 'Analysis failed' : 'Not analyzed'}
    </span>
  );
}

/** What analysis is doing right now, for the label beside its progress bar. */
export const analysisLabel = (status: SongStatus) =>
  status.state === 'queued' ? 'Waiting to analyze' : `${status.step ?? 'Analyzing'} · ${Math.round((status.progress ?? 0) * 100)}%`;
