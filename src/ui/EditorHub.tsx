import { ArrowLeft, FilePlus2, PencilRuler, Plus, ScanSearch, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { analysisManager } from '../analysis/manager';
import type { AnalysisDevice } from '../analysis/separation/support';
import { ACCEPTED, isAudioFile, readSongFile } from '../audio/importSong';
import { DEMO_ID } from '../audio/songAudio';
import { DIFFICULTIES, PARTS } from '../chart/types';
import { chartKey, type SongEdits } from '../editor/edits';
import type { Settings } from '../game/settings';
import { formatTime } from '../game/setlist';
import type { SongMeta } from '../storage/db';
import { isFestivalFile } from '../storage/festivalFile';
import { Hint, useActions, useHints } from './actions';
import { Cover } from './Cover';
import { Dialog } from './Dialog';
import { DIFFICULTY_LABEL, ICON_STROKE, PART_ICON, PART_LABEL } from './icons';
import { analysisLabel, type SongStatus } from './LibraryScreen';

/** An audio file that was picked and read, but is not in the library yet. */
export interface PickedSong {
  meta: SongMeta;
  bytes: ArrayBuffer;
}

interface Props {
  songs: SongMeta[];
  status: Record<string, SongStatus>;
  settings: Settings;
  /** What this device can analyze on (`none`: it cannot), or null while that is being found out. */
  device: AnalysisDevice | null;
  /** Adds a picked audio file to the library: to be analyzed, or with empty charts on its own tempo. */
  onNew(song: PickedSong, how: 'analyze' | 'scratch'): Promise<SongMeta>;
  /** Adds a .festival song file. */
  onPackage(file: File): Promise<SongMeta | undefined>;
  /** Analyzes a song of the library that has no charts. */
  onAnalyze(song: SongMeta): void;
  /** Gives a song of the library empty charts on its own tempo, without analyzing it. */
  onScratch(song: SongMeta): Promise<void>;
  onOpen(song: SongMeta): void;
  onBack(): void;
  toast(text: string): void;
}

/** What the setup card is about: a song of the library, or a file not added yet. */
type Subject = { song: SongMeta; picked?: undefined } | { song: SongMeta; picked: PickedSong };

const editable = (st: SongStatus | undefined) => st?.state === 'ready';
const busy = (st: SongStatus | undefined) => st?.state === 'queued' || st?.state === 'analyzing';

/** The track editor's front door: pick a song to edit, or bring in a new one. */
export function EditorHub({ songs, status, settings, device, onNew, onPackage, onAnalyze, onScratch, onOpen, onBack, toast }: Props) {
  const hints = useHints(settings);
  const [query, setQuery] = useState('');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [subject, setSubject] = useState<Subject | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);

  // The built-in track is made by the game as it plays: there is no file of it to edit.
  const own = useMemo(() => songs.filter((s) => s.id !== DEMO_ID), [songs]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? own.filter((s) => `${s.title} ${s.artist} ${s.album ?? ''}`.toLowerCase().includes(q)) : [...own];
    // Songs with charts of your own first, then by title.
    return list.sort((a, b) => (status[b.id]?.edited ? 1 : 0) - (status[a.id]?.edited ? 1 : 0) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  }, [own, query, status]);
  const current = shown.find((s) => s.id === currentId) ?? shown[0] ?? null;

  /** Opens a song in the editor, or asks how to chart it when it has nothing to edit yet. */
  const choose = (song: SongMeta) => (editable(status[song.id]) ? onOpen(song) : setSubject({ song }));

  const pick = async (f: File) => {
    try {
      if (isFestivalFile(f)) {
        const song = await onPackage(f);
        if (song) setSubject({ song });
        return;
      }
      if (!isAudioFile(f)) return toast(`${f.name} is not an audio file or a Festival song file.`);
      const picked = await readSongFile(f);
      const had = songs.find((s) => s.id === picked.meta.id);
      if (had) choose(had);
      else setSubject({ song: picked.meta, picked });
    } catch (e) {
      toast(`Could not open ${f.name}: ${(e as Error).message}`);
    }
  };

  // Esc in the search field clears it first, then leaves the field.
  useEffect(() => {
    const el = search.current;
    if (!el) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (el.value) setQuery('');
      else document.querySelector<HTMLElement>('.song-row')?.focus();
    };
    el.addEventListener('keydown', key);
    return () => el.removeEventListener('keydown', key);
  }, []);

  const add = () => file.current?.click();
  useActions([
    { id: 'back', label: 'Back', icon: ArrowLeft, kbd: 'Escape', sfx: 'back', run: onBack },
    { id: 'search', label: 'Search', icon: Search, kbd: 'Slash', bar: false, run: () => search.current?.focus() },
    { id: 'new', label: 'New track', icon: FilePlus2, kbd: 'KeyN', pad: 'b3', primary: true, run: add },
  ]);

  return (
    <div className="page library editor-hub">
      <header className="page-head">
        <h1 className="page-title">Track editor</h1>
        <p className="head-count">{own.length ? `${own.length} ${own.length === 1 ? 'track' : 'tracks'}` : 'Write the notes yourself'}</p>
      </header>
      <div className="toolbar" data-nav-group="toolbar">
        <label className="search">
          <Search strokeWidth={ICON_STROKE} aria-hidden />
          <input ref={search} type="search" placeholder="Search tracks" aria-label="Search your tracks by title, artist or album" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} enterKeyHint="search" />
          {query ? (
            <button type="button" className="icon-btn small" aria-label="Clear search" data-nav-skip onClick={() => (setQuery(''), search.current?.focus())}>
              <X strokeWidth={ICON_STROKE} aria-hidden />
            </button>
          ) : (
            <Hint kbd="Slash" mode={hints.mode === 'keyboard' || hints.mode === 'mouse' ? hints.mode : 'touch'} style={hints.style} />
          )}
        </label>
      </div>

      <div className="library-body">
        <ul className="song-list" data-nav-group="songs" aria-label="Tracks">
          {!query && (
            <li className="song-item add">
              <button type="button" className="song-row" data-autofocus={shown.length ? undefined : ''} onClick={add}>
                <span className="cover add-cover" aria-hidden>
                  <Plus strokeWidth={ICON_STROKE} />
                </span>
                <span className="song-text">
                  <span className="song-title">New track</span>
                  <span className="song-artist">Bring in a song, then let the game chart it for you to edit, or start with empty lanes.</span>
                </span>
              </button>
            </li>
          )}
          {shown.map((s, i) => {
            const st = status[s.id];
            const working = busy(st);
            const state = working ? `Being analyzed, ${Math.round((st?.progress ?? 0) * 100)}%.` : editable(st) ? (st?.edited ? `${st.edited} of its charts edited by hand.` : 'Charts written by the game.') : 'No charts yet.';
            return (
              <li key={s.id} className={`song-item ${current?.id === s.id ? 'current' : ''}`} style={{ ['--i' as string]: Math.min(i, 12) }}>
                <button type="button" className="song-row" data-autofocus={i === 0 ? '' : undefined} aria-label={`${s.title} by ${s.artist}. ${state} Opens it in the editor.`} onFocus={() => setCurrentId(s.id)} onPointerEnter={(e) => e.pointerType === 'mouse' && setCurrentId(s.id)} onClick={() => (setCurrentId(s.id), choose(s))}>
                  <Cover blob={s.cover} title={s.title} />
                  <span className="song-text">
                    <span className="song-title">{s.title}</span>
                    <span className="song-artist">{s.artist}</span>
                  </span>
                  <span className="song-side">
                    {working ? (
                      <span className="song-busy">{st?.state === 'queued' ? 'Waiting' : `${Math.round((st?.progress ?? 0) * 100)}%`}</span>
                    ) : st?.edited ? (
                      <span className="pill lit">{st.edited} edited</span>
                    ) : !editable(st) ? (
                      <span className="pill">No charts yet</span>
                    ) : null}
                    <span className="song-length">{formatTime(s.duration)}</span>
                  </span>
                  <span className="slot-badge" aria-hidden>
                    <PencilRuler strokeWidth={ICON_STROKE} />
                  </span>
                  {working && (
                    <span className="meter row-meter" aria-hidden>
                      <span style={{ width: `${Math.round((st?.progress ?? 0) * 100)}%` }} />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {shown.length === 0 && query && (
            <li className="empty-note">
              <p>No track matches “{query.trim()}”.</p>
              <button type="button" className="btn" onClick={() => setQuery('')}>
                Clear search
              </button>
            </li>
          )}
        </ul>

        <aside className="side" aria-label="Highlighted track">
          {current ? (
            <TrackCard song={current} status={status[current.id]} />
          ) : (
            <section className="now hub-intro">
              <div className="now-text">
                <h2 className="now-title">Your own charts</h2>
                <p className="now-artist">Every song has sixteen charts: four parts at four difficulties. Change the ones the game wrote, or write them from nothing. The game plays yours in place of its own.</p>
              </div>
            </section>
          )}
        </aside>
      </div>

      {subject && (
        <TrackSetup
          subject={subject}
          status={status[subject.song.id]}
          canAnalyze={device !== 'none'}
          onNew={onNew}
          onAnalyze={onAnalyze}
          onScratch={onScratch}
          onOpen={(song) => {
            setSubject(null);
            onOpen(song);
          }}
          onStored={(song) => setSubject({ song })}
          onClose={() => setSubject(null)}
          toast={toast}
        />
      )}
      <input
        ref={file}
        type="file"
        accept={ACCEPTED}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void pick(f);
        }}
      />
    </div>
  );
}

/** The highlighted track: which of its sixteen charts are the game's and which are the player's own. */
function TrackCard({ song, status }: { song: SongMeta; status: SongStatus | undefined }) {
  const [edits, setEdits] = useState<SongEdits | undefined>();
  useEffect(() => {
    let live = true;
    setEdits(undefined);
    void analysisManager.editsOf(song.id).then((e) => live && setEdits(e));
    return () => {
      live = false;
    };
  }, [song.id, status?.edited]);
  const working = busy(status);
  const ready = editable(status);
  return (
    <section className="now hub-card" aria-live="off">
      <Cover blob={song.cover} title={song.title} />
      <div className="now-text">
        <h2 className="now-title">{song.title}</h2>
        <p className="now-artist">
          {song.artist}
          {song.duration > 0 && ` · ${formatTime(song.duration)}`}
        </p>
        {working && <p className="now-status">{analysisLabel(status!)}</p>}
        {!working && !ready && <p className="now-status">No charts yet. Open it to choose how to chart it.</p>}
      </div>
      {ready && (
        <table className="bests hub-charts" aria-label="Charts">
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
                    const mine = edits?.charts[chartKey(p, d)];
                    const empty = status?.manual && !mine;
                    return (
                      <td key={d} className={mine ? 'mine' : 'none'}>
                        {mine ? 'Yours' : empty ? <span aria-label="Empty">·</span> : 'Game'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

interface SetupProps {
  subject: Subject;
  status: SongStatus | undefined;
  canAnalyze: boolean;
  onNew: Props['onNew'];
  onAnalyze: Props['onAnalyze'];
  onScratch: Props['onScratch'];
  onOpen(song: SongMeta): void;
  /** The picked file is in the library now. */
  onStored(song: SongMeta): void;
  onClose(): void;
  toast(text: string): void;
}

/**
 * How a song without charts gets them: analyzed by the game (and edited afterwards), or started
 * from scratch on its own tempo. While the analysis runs the card waits with it, and the song opens
 * in the editor when it is done.
 */
function TrackSetup({ subject, status, canAnalyze, onNew, onAnalyze, onScratch, onOpen, onStored, onClose, toast }: SetupProps) {
  const { song, picked } = subject;
  /** Listening for the tempo of a song that is started from scratch. */
  const [finding, setFinding] = useState(false);
  /** The analysis was asked for here, so the editor opens when it finishes. */
  const [waiting, setWaiting] = useState(() => !picked && busy(status));
  const analyzing = !picked && busy(status);
  const failed = !picked && status?.state === 'error';
  const live = useRef(true);
  useEffect(() => () => void (live.current = false), []);

  // A song that became ready while the card is open goes straight into the editor.
  useEffect(() => {
    if (!picked && editable(status) && !finding) onOpen(song);
  }, [picked, status, finding, onOpen, song]);

  const analyze = async () => {
    setWaiting(true);
    try {
      if (picked) onStored(await onNew(picked, 'analyze'));
      else onAnalyze(song);
    } catch (e) {
      toast(`Could not add ${song.title}: ${(e as Error).message}`);
      onClose();
    }
  };
  const scratch = async () => {
    setFinding(true);
    try {
      if (picked) onOpen(await onNew(picked, 'scratch'));
      else {
        await onScratch(song);
        onOpen(song);
      }
    } catch (e) {
      if (!live.current) return;
      setFinding(false);
      toast(`Could not open ${song.title}: ${(e as Error).message}`);
    }
  };

  const work = finding || analyzing || (waiting && !failed);
  return (
    <Dialog title={`Chart ${song.title}`} variant="card" className="wide-card" closeLabel={work ? 'Wait in the background' : 'Cancel'} onClose={onClose}>
      {(close) => (
        <div className="pause-card setup-card">
          <div className="setup-song">
            <Cover blob={song.cover} title={song.title} />
            <div className="song-text">
              <span className="song-title">{song.title}</span>
              <span className="song-artist">{song.artist}</span>
            </div>
          </div>
          {finding ? (
            <>
              <h2 className="display">Finding the tempo</h2>
              <span className="meter busy" aria-hidden>
                <span />
              </span>
              <p className="hint" role="status">Listening for the beat, so the lanes come with bar lines in the right places. A few seconds.</p>
            </>
          ) : work ? (
            <>
              <h2 className="display">Analyzing</h2>
              <span className="meter" aria-hidden>
                <span style={{ width: `${Math.round((status?.progress ?? 0) * 100)}%` }} />
              </span>
              <p className="hint" role="status">
                {status && busy(status) ? analysisLabel(status) : 'Getting started…'} The song opens in the editor when its charts are written.
              </p>
              <button type="button" className="btn wide" data-autofocus data-sfx="back" onClick={close}>
                Wait in the background
              </button>
              <button type="button" className="btn quiet wide" onClick={() => void scratch()}>
                Start from scratch instead
              </button>
            </>
          ) : (
            <>
              <h2 className="display">How do you want to chart it?</h2>
              {failed && <p className="error">The analysis did not finish: {status?.error}</p>}
              <button type="button" className={`btn wide pick-btn ${canAnalyze ? 'primary' : ''}`} data-autofocus={canAnalyze ? '' : undefined} disabled={!canAnalyze} onClick={() => void analyze()}>
                <ScanSearch strokeWidth={ICON_STROKE} aria-hidden />
                <span className="pick-text">
                  <span>{failed ? 'Analyze again' : 'Analyze'}</span>
                  <span className="pick-help">{canAnalyze ? 'The game listens to the song and writes charts for all four parts. You change what you like.' : 'This device cannot analyze songs. It can still chart them by hand.'}</span>
                </span>
              </button>
              <button type="button" className="btn wide pick-btn" data-autofocus={canAnalyze ? undefined : ''} onClick={() => void scratch()}>
                <PencilRuler strokeWidth={ICON_STROKE} aria-hidden />
                <span className="pick-text">
                  <span>Start from scratch</span>
                  <span className="pick-help">Empty lanes on the song’s own beat. You set down every note.</span>
                </span>
              </button>
              <button type="button" className="btn quiet wide" data-sfx="back" onClick={close}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
