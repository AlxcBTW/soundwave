import { useRef, useState, type ReactNode } from 'react';
import { backupFileName, BACKUP_EXT, readBackup, restoreBackup, writeBackup, type BackupContents, type RestoreResult } from '../storage/backup';
import { chooseSaveTarget } from '../storage/share';
import { Dialog } from './Dialog';

type State =
  | { kind: 'idle' }
  | { kind: 'exporting'; done: number; total: number }
  | { kind: 'saving' }
  | { kind: 'exported'; songs: number }
  | { kind: 'reading' }
  | { kind: 'confirm'; backup: BackupContents }
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'imported'; result: RestoreResult }
  | { kind: 'error'; message: string };

export interface LibraryBackup {
  exportLibrary(): void;
  importLibrary(): void;
  busy: boolean;
  /** How the last export or import went, for beside its button. */
  exportNote?: ReactNode;
  importNote?: ReactNode;
  /** The file picker and dialogs, rendered by the screen. */
  ui: ReactNode;
}

const count = (n: number, one: string, many = `${one}s`) => (n === 0 ? `no ${many}` : `${n} ${n === 1 ? one : many}`);
const songs = (n: number) => count(n, 'song');
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function dateLabel(t: number | undefined) {
  return t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : undefined;
}

/** Exporting the whole library to one backup file and importing one, for the Advanced settings. */
export function useLibraryBackup(): LibraryBackup {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [last, setLast] = useState<'export' | 'import' | null>(null);
  const [hideProgress, setHideProgress] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const busy = state.kind === 'exporting' || state.kind === 'saving' || state.kind === 'reading' || state.kind === 'importing';

  const exportLibrary = async () => {
    if (busy) return;
    setLast('export');
    let target;
    try {
      target = await chooseSaveTarget(backupFileName(), 'backup');
    } catch (e) {
      return setState({ kind: 'error', message: (e as Error).message });
    }
    if (!target) return;
    try {
      setState({ kind: 'exporting', done: 0, total: 0 });
      const { file, songs: n } = await writeBackup((p) => setState({ kind: 'exporting', ...p }));
      setState({ kind: 'saving' });
      await target.write(file);
      await target.close();
      setState({ kind: 'exported', songs: n });
    } catch (e) {
      await target.abort().catch(() => {});
      setState({ kind: 'error', message: `The library could not be exported: ${(e as Error).message}` });
    }
  };

  const chosen = async (file: File) => {
    setLast('import');
    setState({ kind: 'reading' });
    try {
      setState({ kind: 'confirm', backup: await readBackup(file) });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  };

  const restore = async (backup: BackupContents) => {
    setHideProgress(false);
    setState({ kind: 'importing', done: 0, total: backup.songs.length });
    try {
      const result = await restoreBackup(backup, (p) => setState({ kind: 'importing', ...p }));
      setState({ kind: 'imported', result });
    } catch (e) {
      setState({ kind: 'error', message: `The library could not be imported: ${(e as Error).message}` });
    }
  };

  const pill = (text: string, tone = '') => <span className={`pill ${tone}`}>{text}</span>;
  const progress = (done: number, total: number) => (total ? `${done} of ${total}` : 'Starting…');
  const exportNote =
    state.kind === 'exporting' ? pill(`Packing ${progress(state.done, state.total)}`)
    : state.kind === 'saving' ? pill('Saving…')
    : state.kind === 'exported' ? pill(`Saved ${songs(state.songs)}`, 'ready')
    : state.kind === 'error' && last === 'export' ? pill('Failed', 'error')
    : undefined;
  const importNote =
    state.kind === 'reading' ? pill('Reading…')
    : state.kind === 'importing' ? pill(`Adding ${progress(state.done, state.total)}`)
    : state.kind === 'error' && last === 'import' ? pill('Failed', 'error')
    : undefined;

  const done = state.kind === 'imported' ? state.result : null;
  const ui = (
    <>
      <input
        ref={input}
        type="file"
        accept={BACKUP_EXT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void chosen(f);
        }}
      />
      {state.kind === 'confirm' && (
        <Dialog title="Import library" variant="card" closeLabel="Cancel" onClose={() => setState({ kind: 'idle' })}>
          {(close) => {
            const b = state.backup;
            const made = dateLabel(b.createdAt);
            return (
              <div className="pause-card">
                <h2 className="display">Import this library?</h2>
                <p className="hint">
                  {made ? `Backed up ${made}: ` : 'This backup holds '}
                  {songs(b.songs.length)}, {count(b.scores.length, 'best score')}
                  {Object.keys(b.preferences).length ? ' and settings' : ''}.
                </p>
                <p className="hint">Songs you already have stay as they are; the others are added with their charts. Better scores are kept, and your settings are replaced by the backup’s. The game restarts afterwards.</p>
                <button type="button" className="btn wide" data-autofocus data-sfx="back" onClick={close}>
                  Cancel
                </button>
                <button type="button" className="btn primary wide" onClick={() => void restore(b)}>
                  Import
                </button>
              </div>
            );
          }}
        </Dialog>
      )}
      {state.kind === 'importing' && !hideProgress && (
        // Closing this only hides it: the songs go on being added, and the row shows how far it is.
        <Dialog title="Import library" variant="card" closeLabel="Hide" onClose={() => setHideProgress(true)}>
          <div className="pause-card">
            <h2 className="display">Importing…</h2>
            <p className="hint" role="status">Adding songs: {progress(state.done, state.total)}</p>
          </div>
        </Dialog>
      )}
      {done && (
        // Closing it restarts too: the game has to load the new songs and settings.
        <Dialog title="Import library" variant="card" closeLabel="Restart" onClose={() => location.reload()}>
          <div className="pause-card">
            <h2 className="display">Library imported</h2>
            <p className="hint" role="status">
              {done.added ? `${capital(songs(done.added))} added` : 'No new songs'}
              {done.kept ? `, ${songs(done.kept)} already here` : ''}
              {done.failed ? `, ${songs(done.failed)} could not be read` : ''}. The game restarts to load them and the backup’s settings.
            </p>
            <button type="button" className="btn primary wide" data-autofocus onClick={() => location.reload()}>
              Restart
            </button>
          </div>
        </Dialog>
      )}
      {state.kind === 'error' && (
        <Dialog title={last === 'import' ? 'Import library' : 'Export library'} variant="card" closeLabel="OK" onClose={() => setState({ kind: 'idle' })}>
          {(close) => (
            <div className="pause-card">
              <h2 className="display">{last === 'import' ? 'Could not import' : 'Could not export'}</h2>
              <p className="hint">{state.message}</p>
              <button type="button" className="btn primary wide" data-autofocus onClick={close}>
                OK
              </button>
            </div>
          )}
        </Dialog>
      )}
    </>
  );

  return {
    exportLibrary: () => void exportLibrary(),
    importLibrary: () => !busy && input.current?.click(),
    busy,
    exportNote,
    importNote,
    ui,
  };
}
