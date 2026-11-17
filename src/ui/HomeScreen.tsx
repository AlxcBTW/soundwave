import { ListMusic, Plus, Power, Settings as SettingsIcon, Upload } from 'lucide-react';
import { useMemo, useRef } from 'react';
import type { AnalysisStatus } from '../analysis/manager';
import { formatTime, SET_MAX, suggestSets, type SuggestedSet } from '../game/setlist';
import type { SongMeta } from '../storage/db';
import { useInputMode } from '../input/inputMode';
import type { Settings } from '../game/settings';
import { backInput } from '../input/pads';
import { useGlyphStyle } from '../input/usePads';
import { Hint, useActions } from './actions';
import { Mosaic } from './Cover';
import { ICON_STROKE } from './icons';

interface Props {
  songs: SongMeta[];
  status: Record<string, AnalysisStatus>;
  /** The player's own setlist, as songs. */
  setlist: SongMeta[];
  /** Songs with at least one score. */
  played: ReadonlySet<string>;
  /** Changes when the shuffle should deal again. */
  seed: number;
  importing: number;
  /** Whether the library holds only the built-in track. */
  empty: boolean;
  onLibrary(): void;
  onSet(ids: string[]): void;
  onAdd(): void;
  onSettings(): void;
  /** Asks whether to close the game (absent where the game cannot close itself, as in a browser tab). */
  onExit?(): void;
  settings: Settings;
}

const total = (songs: SongMeta[]) => formatTime(songs.reduce((t, s) => t + s.duration, 0));
const count = (n: number) => `${n} ${n === 1 ? 'song' : 'songs'}`;

export function HomeScreen({ songs, status, setlist, played, seed, importing, empty, onLibrary, onSet, onAdd, onSettings, onExit, settings }: Props) {
  const style = useGlyphStyle(settings.glyphs);
  const mode = useInputMode();
  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);
  const ready = useMemo(() => songs.filter((s) => status[s.id]?.state === 'ready'), [songs, status]);
  const sets: SuggestedSet[] = useMemo(() => suggestSets(ready, played, seed), [ready, played, seed]);
  const busy = songs.filter((s) => status[s.id]?.state === 'analyzing' || status[s.id]?.state === 'queued');
  const progress = busy.length ? busy.reduce((t, s) => t + (status[s.id]?.progress ?? 0), 0) / busy.length : 0;

  const touch = mode === 'touch';
  // Tiles that were here when the screen opened arrive together; one that turns up later (a set
  // that became possible after an import) opens its own space instead of shoving the others aside.
  const opening = useRef<Set<string> | null>(null);
  opening.current ??= new Set([...sets.map((s) => s.id), ...(empty ? ['add'] : [])]);
  const late = (id: string) => (opening.current!.has(id) ? '' : 'late');

  useActions([
    { id: 'add', label: importing ? `Importing ${importing}…` : 'Add songs', icon: Upload, kbd: 'KeyA', pad: 'b3', run: onAdd },
    { id: 'settings', label: 'Settings', icon: SettingsIcon, kbd: 'KeyS', pad: 'b9', run: onSettings },
    // Esc and the controller's back button: there is nowhere further back than out.
    ...(onExit ? [{ id: 'exit', label: 'Exit', icon: Power, kbd: 'Escape', bar: false, run: onExit }] : []),
  ]);

  return (
    <div className="page home" data-nav-bar>
      <header className="page-head">
        <h1 className="wordmark">Festival</h1>
        {busy.length > 0 && (
          <p className="head-status" role="status">
            <span className="meter" aria-hidden>
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </span>
            Analyzing {count(busy.length)}
          </p>
        )}
        {onExit && (
          <button type="button" className="btn exit-btn" data-action="exit" data-sfx="back" onClick={onExit}>
            <Hint kbd="Escape" pad={backInput(style)} mode={mode} style={style} />
            <Power strokeWidth={ICON_STROKE} aria-hidden />
            Exit
          </button>
        )}
      </header>
      <main className="page-body home-body">
        <h2 className="page-title">Pick a set</h2>
        <div className="tiles" data-nav-group="tiles">
          {/* The feature: the player's own set, with its covers, and its songs in order. */}
          <button type="button" className="tile hero" data-autofocus aria-label={setlist.length ? `Your setlist: ${count(setlist.length)}, ${total(setlist)}` : 'Your setlist: empty. Pick up to four songs from your library.'} onClick={onLibrary}>
            {setlist.length ? (
              <Mosaic songs={setlist} />
            ) : (
              <span className="mosaic blank" aria-hidden>
                <ListMusic strokeWidth={ICON_STROKE} />
              </span>
            )}
            <span className="tile-text">
              <span className="tile-title">Your setlist</span>
              <span className="tile-cap">{setlist.length ? `${count(setlist.length)} · ${total(setlist)}` : 'Pick up to four songs from your library'}</span>
              <span className="hero-songs">
                {Array.from({ length: SET_MAX }, (_, i) => {
                  const s = setlist[i];
                  return (
                    <span key={i} className={`hero-song ${s ? '' : 'open'}`}>
                      <span className="hero-num">{i + 1}</span>
                      <span className="hero-name">{s ? s.title : 'Open slot'}</span>
                      {s && <span className="hero-by">{s.artist}</span>}
                    </span>
                  );
                })}
              </span>
            </span>
          </button>
          {(sets.length > 0 || empty) && (
          <div className="tile-stack">
          {sets.map((set, i) => {
            const list = set.songs.map((id) => byId.get(id)!).filter(Boolean);
            return (
              <button type="button" key={set.id} className={`tile ${late(set.id)}`} style={{ ['--i' as string]: i + 1 }} onClick={() => onSet(set.songs)}>
                <Mosaic songs={list} />
                <span className="tile-text">
                  <span className="tile-title">{set.title}</span>
                  <span className="tile-cap">{set.caption}</span>
                  <span className="tile-meta">
                    {count(list.length)} · {total(list)}
                  </span>
                </span>
              </button>
            );
          })}
          {empty && (
            <button type="button" className={`tile add ${late('add')}`} style={{ ['--i' as string]: sets.length + 1 }} onClick={onAdd}>
              <span className="mosaic blank dashed" aria-hidden>
                <Plus strokeWidth={ICON_STROKE} />
              </span>
              <span className="tile-text">
                <span className="tile-title">Add your music</span>
                <span className="tile-cap">{touch ? 'Pick files from this device.' : 'Drop files anywhere or browse.'} MP3, WAV, FLAC, OGG and M4A. Each song takes about a minute to turn into charts.</span>
              </span>
            </button>
          )}
          </div>
          )}
        </div>
      </main>
    </div>
  );
}
