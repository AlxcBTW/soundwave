import { useEffect, useRef, useState } from 'react';
import { ACCEPTED } from '../audio/importSong';
import type { SongMeta } from '../storage/db';
import { Cover } from './Cover';

import type { AnalysisStatus } from '../analysis/manager';

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
        <h1 className="logo small">FESTIVAL</h1>
        <div className="row">
          <button className="btn primary" onClick={() => input.current?.click()}>
            {importing ? `Importing ${importing}…` : 'Add songs'}
          </button>
          <button className="btn" onClick={onSettings}>Settings</button>
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
      <div className="song-grid">
        {songs.map((s) => {
          const st = status[s.id];
          return (
            <button key={s.id} className="song-card" onClick={() => onOpen(s)}>
              <Cover blob={s.cover} title={s.title} />
              <div className="song-info">
                <div className="song-title">{s.title}</div>
                <div className="song-artist">{s.artist}</div>
                <div className="song-meta">
                  <span>{fmtTime(s.duration)}</span>
                  {st && <StatusPill status={st} />}
                </div>
              </div>
              {st?.state === 'analyzing' && (
                <div className="card-progress"><div style={{ width: `${Math.round((st.progress ?? 0) * 100)}%` }} /></div>
              )}
            </button>
          );
        })}
        <button className="song-card add" onClick={() => input.current?.click()}>
          <div className="add-icon">+</div>
          <div className="dim">Drop audio files here or click to browse</div>
          <div className="dim small">MP3 · WAV · FLAC · OGG · M4A</div>
        </button>
      </div>
      {dragging && <div className="drop-overlay">Drop to add songs</div>}
    </div>
  );
}

export function StatusPill({ status }: { status: SongStatus }) {
  const label =
    status.state === 'analyzing'
      ? `${status.step ?? 'Analyzing'} · ${Math.round((status.progress ?? 0) * 100)}%`
      : status.state === 'queued'
        ? 'Queued'
        : status.state === 'ready'
          ? 'Ready'
          : status.state === 'error'
            ? 'Analysis failed'
            : 'Not analyzed';
  return <span className={`pill ${status.state}`} title={status.error}>{label}</span>;
}
