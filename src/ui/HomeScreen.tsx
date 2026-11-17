import { ListMusic, Plus, Settings as SettingsIcon, Upload } from 'lucide-react';
import { useMemo } from 'react';
import type { AnalysisStatus } from '../analysis/manager';
import { formatTime, suggestSets, type SuggestedSet } from '../game/setlist';
import type { SongMeta } from '../storage/db';
import { useInputMode } from '../input/inputMode';
import { useActions } from './actions';
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
}

const total = (songs: SongMeta[]) => formatTime(songs.reduce((t, s) => t + s.duration, 0));
const count = (n: number) => `${n} ${n === 1 ? 'song' : 'songs'}`;

export function HomeScreen({ songs, status, setlist, played, seed, importing, empty, onLibrary, onSet, onAdd, onSettings }: Props) {
  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);
  const ready = useMemo(() => songs.filter((s) => status[s.id]?.state === 'ready'), [songs, status]);
  const sets: SuggestedSet[] = useMemo(() => suggestSets(ready, played, seed), [ready, played, seed]);
  const busy = songs.filter((s) => status[s.id]?.state === 'analyzing' || status[s.id]?.state === 'queued');
  const progress = busy.length ? busy.reduce((t, s) => t + (status[s.id]?.progress ?? 0), 0) / busy.length : 0;

  const touch = useInputMode() === 'touch';

  useActions([
    { id: 'add', label: importing ? `Importing ${importing}…` : 'Add songs', icon: Upload, kbd: 'KeyA', pad: 'b3', run: onAdd },
    { id: 'settings', label: 'Settings', icon: SettingsIcon, kbd: 'KeyS', pad: 'b9', run: onSettings },
  ]);

  return (
    <div className="page home">
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
      </header>
      <main className="page-body home-body">
        <h2 className="page-title">Pick a set</h2>
        <div className="tiles" data-nav-group="tiles">
          <button type="button" className="tile hero" data-autofocus onClick={onLibrary}>
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
            </span>
          </button>
          {sets.map((set, i) => {
            const list = set.songs.map((id) => byId.get(id)!).filter(Boolean);
            return (
              <button type="button" key={set.id} className="tile" style={{ ['--i' as string]: i + 1 }} onClick={() => onSet(set.songs)}>
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
            <button type="button" className="tile add" style={{ ['--i' as string]: sets.length + 1 }} onClick={onAdd}>
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
      </main>
    </div>
  );
}
