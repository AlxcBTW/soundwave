import { ArrowLeft, ArrowUpDown, Check, Info, Play, Plus, Search, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnalysisStatus } from '../analysis/manager';
import { PARTS } from '../chart/types';
import type { Settings } from '../game/settings';
import { formatTime, SET_MAX } from '../game/setlist';
import type { BestScore, SongMeta } from '../storage/db';
import { Hint, useActions, useHints } from './actions';
import { Cover } from './Cover';
import { DIFFICULTY_LABEL, ICON_STROKE, PART_ICON, PART_LABEL, Stars } from './icons';

export type SongStatus = AnalysisStatus;

interface Props {
  songs: SongMeta[];
  status: Record<string, SongStatus>;
  /** Ids of the songs in the setlist, in order. */
  setlist: string[];
  scores: BestScore[];
  importing: number;
  settings: Settings;
  onToggle(song: SongMeta): void;
  onDetails(song: SongMeta): void;
  onReady(): void;
  onBack(): void;
  onAdd(): void;
}

type Sort = 'title' | 'artist' | 'newest' | 'length' | 'stars';
const SORTS: [Sort, string][] = [
  ['title', 'Title'],
  ['artist', 'Artist'],
  ['newest', 'Newest'],
  ['length', 'Length'],
  ['stars', 'Stars'],
];
const SORT_KEY = 'festival.library-sort';

function loadSort(): Sort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    if (SORTS.some(([id]) => id === v)) return v as Sort;
  } catch {
    /* storage unavailable */
  }
  return 'title';
}

/** What analysis is doing right now, for the label beside its progress bar. */
export const analysisLabel = (status: SongStatus) =>
  status.state === 'queued' ? 'Waiting to analyze' : `${status.step ?? 'Analyzing'} · ${Math.round((status.progress ?? 0) * 100)}%`;

/** Only problems get a pill: a ready song needs no label, and analysis shows as a lit bar. */
export function StatusPill({ status }: { status: SongStatus }) {
  if (status.state === 'ready' || status.state === 'analyzing' || status.state === 'queued') return null;
  return (
    <span className={`pill ${status.state}`} title={status.error}>
      {status.state === 'error' ? 'Analysis failed' : 'Not analyzed'}
    </span>
  );
}

export function LibraryScreen({ songs, status, setlist, scores, importing, settings, onToggle, onDetails, onReady, onBack, onAdd }: Props) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>(loadSort);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const hints = useHints(settings);

  /** Best stars per song, over every part and difficulty. */
  const bestStars = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of scores) m.set(s.songId, Math.max(m.get(s.songId) ?? 0, s.stars));
    return m;
  }, [scores]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? songs.filter((s) => `${s.title} ${s.artist} ${s.album ?? ''}`.toLowerCase().includes(q)) : [...songs];
    const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
    list.sort((a, b) =>
      sort === 'artist' ? text(a.artist, b.artist) || text(a.title, b.title)
      : sort === 'newest' ? b.addedAt - a.addedAt
      : sort === 'length' ? a.duration - b.duration
      : sort === 'stars' ? (bestStars.get(b.id) ?? -1) - (bestStars.get(a.id) ?? -1) || text(a.title, b.title)
      : text(a.title, b.title),
    );
    return list;
  }, [songs, query, sort, bestStars]);

  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);
  const current = (currentId && byId.get(currentId)) || shown[0] || null;
  const picked = setlist.map((id) => byId.get(id)).filter((s): s is SongMeta => !!s);
  const setTime = formatTime(picked.reduce((t, s) => t + s.duration, 0));

  const cycleSort = () => {
    const next = SORTS[(SORTS.findIndex(([id]) => id === sort) + 1) % SORTS.length][0];
    setSort(next);
    try {
      localStorage.setItem(SORT_KEY, next);
    } catch {
      /* ignore */
    }
  };

  // Esc in the search field clears it first, then leaves the field.
  useEffect(() => {
    const el = search.current!;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (el.value) setQuery('');
      else document.querySelector<HTMLElement>('.song-row')?.focus();
    };
    el.addEventListener('keydown', key);
    return () => el.removeEventListener('keydown', key);
  }, []);

  useActions([
    { id: 'back', label: 'Back', icon: ArrowLeft, kbd: 'Escape', sfx: 'back', run: onBack },
    { id: 'details', label: 'Song details', icon: Info, kbd: 'KeyD', pad: 'b2', disabled: !current, run: () => current && onDetails(current) },
    { id: 'search', label: 'Search', icon: Search, kbd: 'Slash', bar: false, run: () => search.current?.focus() },
    { id: 'sort', label: 'Sort', icon: ArrowUpDown, kbd: 'KeyS', pad: 'b3', bar: false, run: cycleSort },
    { id: 'add', label: 'Add songs', icon: Upload, kbd: 'KeyA', pad: 'b8', bar: false, run: onAdd },
    { id: 'ready', label: 'Ready up', icon: Play, kbd: 'KeyR', pad: 'b9', primary: true, disabled: picked.length === 0, run: onReady },
  ]);

  const sortLabel = SORTS.find(([id]) => id === sort)![1];

  return (
    <div className="page library">
      <header className="page-head">
        <h1 className="page-title">Music library</h1>
        <p className="head-count">
          {songs.length} {songs.length === 1 ? 'song' : 'songs'}
        </p>
      </header>
      <div className="toolbar" data-nav-group="toolbar">
        <label className="search">
          <Search strokeWidth={ICON_STROKE} aria-hidden />
          <input ref={search} type="search" placeholder="Search title, artist or album" aria-label="Search your library" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} enterKeyHint="search" />
          {query ? (
            <button type="button" className="icon-btn small" aria-label="Clear search" data-nav-skip onClick={() => (setQuery(''), search.current?.focus())}>
              <X strokeWidth={ICON_STROKE} aria-hidden />
            </button>
          ) : (
            <Hint kbd="Slash" mode={hints.mode === 'keyboard' || hints.mode === 'mouse' ? hints.mode : 'touch'} style={hints.style} />
          )}
        </label>
        <button type="button" className="btn" data-action="sort" onClick={cycleSort} aria-label={`Sort by ${sortLabel}. Press to change.`}>
          <Hint kbd="KeyS" pad="b3" {...hints} />
          <ArrowUpDown strokeWidth={ICON_STROKE} aria-hidden />
          <span className="btn-label">{sortLabel}</span>
        </button>
        <button type="button" className="btn" data-action="add" onClick={onAdd}>
          <Hint kbd="KeyA" pad="b8" {...hints} />
          <Upload strokeWidth={ICON_STROKE} aria-hidden />
          <span className="btn-label">{importing ? `Importing ${importing}…` : 'Add songs'}</span>
        </button>
      </div>

      <div className="library-body">
        <ul className="song-list" data-nav-group="songs" aria-label="Songs">
          {shown.map((s, i) => {
            const st = status[s.id] ?? { state: 'idle' };
            const slot = setlist.indexOf(s.id);
            const ready = st.state === 'ready';
            const busy = st.state === 'analyzing' || st.state === 'queued';
            const full = setlist.length >= SET_MAX && slot < 0;
            return (
              <li key={s.id} className={`song-item ${slot >= 0 ? 'picked' : ''} ${current?.id === s.id ? 'current' : ''}`} style={{ ['--i' as string]: Math.min(i, 12) }}>
                <button
                  type="button"
                  className="song-row"
                  data-autofocus={i === 0 ? '' : undefined}
                  aria-pressed={ready ? slot >= 0 : undefined}
                  aria-label={`${s.title} by ${s.artist}. ${!ready ? (busy ? 'Being analyzed.' : 'Not ready to play.') + ' Opens song details.' : slot >= 0 ? `In the setlist at ${slot + 1}. Press to remove.` : full ? 'The setlist is full.' : 'Press to add to the setlist.'}`}
                  onFocus={() => setCurrentId(s.id)}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && setCurrentId(s.id)}
                  onClick={() => (setCurrentId(s.id), ready ? onToggle(s) : onDetails(s))}
                >
                  <Cover blob={s.cover} title={s.title} />
                  <span className="song-text">
                    <span className="song-title">{s.title}</span>
                    <span className="song-artist">{s.artist}</span>
                  </span>
                  <span className="song-side">
                    {busy ? <span className="song-busy">{st.state === 'queued' ? 'Waiting' : `${Math.round((st.progress ?? 0) * 100)}%`}</span> : ready ? bestStars.has(s.id) && <Stars n={bestStars.get(s.id)!} /> : <StatusPill status={st} />}
                    <span className="song-length">{formatTime(s.duration)}</span>
                  </span>
                  <span className={`slot-badge ${slot >= 0 ? 'on' : ''}`} aria-hidden>
                    {slot >= 0 ? slot + 1 : ready && !full ? <Plus strokeWidth={ICON_STROKE} /> : null}
                  </span>
                  {busy && (
                    <span className="meter row-meter" aria-hidden>
                      <span style={{ width: `${Math.round((st.progress ?? 0) * 100)}%` }} />
                    </span>
                  )}
                </button>
                <button type="button" className="icon-btn row-info" data-nav-skip aria-label={`Details for ${s.title}`} onClick={() => (setCurrentId(s.id), onDetails(s))}>
                  <Info strokeWidth={ICON_STROKE} aria-hidden />
                </button>
              </li>
            );
          })}
          {shown.length === 0 && (
            <li className="empty-note">
              <p>No song matches “{query.trim()}”.</p>
              <button type="button" className="btn" onClick={() => setQuery('')}>
                Clear search
              </button>
            </li>
          )}
          {!query && (
            <li className="song-item add">
              <button type="button" className="song-row" onClick={onAdd}>
                <span className="cover add-cover" aria-hidden>
                  <Plus strokeWidth={ICON_STROKE} />
                </span>
                <span className="song-text">
                  <span className="song-title">Add your music</span>
                  <span className="song-artist">Drop files anywhere or browse. MP3, WAV, FLAC, OGG, M4A.</span>
                </span>
              </button>
            </li>
          )}
        </ul>

        <aside className="side" aria-label="Setlist">
          {current && <NowCard song={current} status={status[current.id] ?? { state: 'idle' }} scores={scores} />}
          <section className="setlist" data-nav-group="setlist">
            <header className="setlist-head">
              <h2 className="panel-title">Setlist</h2>
              <p className="setlist-count" role="status">
                {picked.length} of {SET_MAX}
                {setTime && ` · ${setTime}`}
              </p>
            </header>
            <ol className="slots">
              {Array.from({ length: SET_MAX }, (_, i) => {
                const s = picked[i];
                return (
                  <li key={s ? s.id : `empty-${i}`}>
                    {s ? (
                      <button type="button" className="slot filled" data-sfx="back" aria-label={`Remove ${s.title} from the setlist`} onClick={() => onToggle(s)}>
                        <span className="slot-num" aria-hidden>{i + 1}</span>
                        <Cover blob={s.cover} title={s.title} />
                        <span className="song-text">
                          <span className="song-title">{s.title}</span>
                          <span className="song-artist">{s.artist}</span>
                        </span>
                        <X className="slot-x" strokeWidth={ICON_STROKE} aria-hidden />
                      </button>
                    ) : (
                      <div className="slot empty">
                        <span className="slot-num" aria-hidden>{i + 1}</span>
                        <span className="slot-blank">{i === picked.length ? 'Pick a song' : 'Empty'}</span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** The highlighted song at a glance: cover, length and the best result on each part. */
function NowCard({ song, status, scores }: { song: SongMeta; status: SongStatus; scores: BestScore[] }) {
  const mine = scores.filter((s) => s.songId === song.id);
  const busy = status.state === 'analyzing' || status.state === 'queued';
  return (
    <section className="now" aria-label="Highlighted song" aria-live="off">
      <Cover blob={song.cover} title={song.title} />
      <div className="now-text">
        <h2 className="now-title">{song.title}</h2>
        <p className="now-artist">
          {song.artist}
          {song.duration > 0 && ` · ${formatTime(song.duration)}`}
        </p>
        {busy ? (
          <p className="now-status">{analysisLabel(status)}</p>
        ) : status.state !== 'ready' ? (
          <p className="now-status">
            <StatusPill status={status} />
          </p>
        ) : (
          <ul className="now-bests">
            {PARTS.map((p) => {
              const Icon = PART_ICON[p];
              const best = mine.filter((s) => s.part === p).sort((a, b) => b.stars - a.stars || b.score - a.score)[0];
              return (
                <li key={p} className={best ? '' : 'none'} title={best ? `${PART_LABEL[p]}: ${best.score.toLocaleString()} on ${DIFFICULTY_LABEL[best.difficulty]}` : `${PART_LABEL[p]}: not played`}>
                  <Icon strokeWidth={ICON_STROKE} aria-hidden />
                  <span className="sr-only">{PART_LABEL[p]}</span>
                  {best ? (
                    <>
                      <Stars n={best.stars} />
                      {best.fullCombo && <Check className="fc" strokeWidth={3} aria-label="Full combo" />}
                    </>
                  ) : (
                    <span className="dim">Not played</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
