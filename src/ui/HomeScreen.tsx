import { FilePlus2, ListMusic, PencilRuler, Play, Plus, Power, Settings as SettingsIcon, Upload, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { analysisManager, type AnalysisStatus } from '../analysis/manager';
import { playSfx } from '../audio/sfx';
import { DEMO_ID } from '../audio/songAudio';
import { formatTime, SET_MAX, suggestSets, type SuggestedSet } from '../game/setlist';
import type { SongMeta } from '../storage/db';
import { getInputMode, useInputMode, usesFocus } from '../input/inputMode';
import type { Settings } from '../game/settings';
import { focusStart, TAB_EVENT } from '../input/menuNav';
import { backInput } from '../input/pads';
import { menuPulse } from '../input/rumble';
import { useGlyphStyle } from '../input/usePads';
import { Hint, useActions } from './actions';
import { Mosaic } from './Cover';
import { ICON_STROKE } from './icons';
import { useSlide } from './useSlide';

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
  /** Opens the list of tracks to edit; with `pick`, straight into choosing a file for a new one. */
  onEditor(pick?: boolean): void;
  /** Opens a song in the track editor. */
  onEditSong(song: SongMeta): void;
  onSettings(): void;
  /** Asks whether to close the game (absent where the game cannot close itself, as in a browser tab). */
  onExit?(): void;
  settings: Settings;
}

/** The two halves of the main menu: playing sets, and making charts. */
type Tab = 'play' | 'edit';
const TABS: [Tab, string, LucideIcon][] = [
  ['play', 'Play', Play],
  ['edit', 'Edit', PencilRuler],
];
const TAB_KEY = 'festival.home-tab';

function loadTab(): Tab {
  try {
    if (localStorage.getItem(TAB_KEY) === 'edit') return 'edit';
  } catch {
    /* storage unavailable */
  }
  return 'play';
}

const total = (songs: SongMeta[]) => formatTime(songs.reduce((t, s) => t + s.duration, 0));
/** "3 songs · 9:12", or just "3 songs" while the length is not known yet. */
const summary = (songs: SongMeta[]) => [count(songs.length), total(songs)].filter(Boolean).join(' · ');
const count = (n: number) => `${n} ${n === 1 ? 'song' : 'songs'}`;
const charts = (n: number) => `${n} ${n === 1 ? 'chart' : 'charts'} of your own`;

export function HomeScreen({ songs, status, setlist, played, seed, importing, empty, onLibrary, onSet, onAdd, onEditor, onEditSong, onSettings, onExit, settings }: Props) {
  const style = useGlyphStyle(settings.glyphs);
  const mode = useInputMode();
  const [tab, setTabState] = useState<Tab>(loadTab);
  const [turn, setTurn] = useState<'fwd' | 'back'>('fwd');
  const tabRef = useRef(tab);
  tabRef.current = tab;
  /** Set when the tab was switched from the shoulder buttons (Q and E): focus then follows onto its first tile. */
  const follow = useRef(false);
  const setTab = (t: Tab) => {
    if (t === tabRef.current) return;
    setTurn(t === 'edit' ? 'fwd' : 'back');
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    const onTab = (e: Event) => {
      if (document.querySelector('[data-modal]')) return;
      const next = TABS[TABS.findIndex(([id]) => id === tabRef.current) + (e as CustomEvent<number>).detail]?.[0];
      if (!next) return;
      playSfx('tab');
      menuPulse(next === 'edit' ? 'tab-right' : 'tab-left');
      follow.current = true;
      setTab(next);
    };
    window.addEventListener(TAB_EVENT, onTab);
    return () => window.removeEventListener(TAB_EVENT, onTab);
  }, []);
  useEffect(() => {
    if (!follow.current) return;
    follow.current = false;
    const body = document.querySelector('.home-body');
    if (body && usesFocus(getInputMode())) focusStart(body);
  }, [tab]);

  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);
  const ready = useMemo(() => songs.filter((s) => status[s.id]?.state === 'ready'), [songs, status]);
  const sets: SuggestedSet[] = useMemo(() => suggestSets(ready, played, seed), [ready, played, seed]);
  const busy = songs.filter((s) => status[s.id]?.state === 'analyzing' || status[s.id]?.state === 'queued');

  // The Edit tab: the player's own songs, and the ones with charts of their own, latest first.
  const own = useMemo(() => songs.filter((s) => s.id !== DEMO_ID), [songs]);
  const editedKey = own.map((s) => `${s.id}:${status[s.id]?.edited ?? 0}`).join();
  const [edited, setEdited] = useState<{ song: SongMeta; charts: number }[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const list: { song: SongMeta; charts: number; at: number }[] = [];
      for (const song of own) {
        const n = status[song.id]?.edited;
        if (!n) continue;
        const e = await analysisManager.editsOf(song.id);
        list.push({ song, charts: n, at: e?.updatedAt ?? 0 });
      }
      if (live) setEdited(list.sort((a, b) => b.at - a.at));
    })();
    return () => {
      live = false;
    };
  }, [editedKey]);

  const touch = mode === 'touch';
  // Tiles that were here when the screen opened arrive together; one that turns up later (a set
  // that became possible after an import) opens its own space instead of shoving the others aside.
  const opening = useRef<Set<string> | null>(null);
  opening.current ??= new Set([...sets.map((s) => s.id), ...(empty ? ['add'] : [])]);
  const late = (id: string) => (opening.current!.has(id) ? '' : 'late');

  useActions([
    tab === 'play'
      ? { id: 'add', label: importing ? `Importing ${importing}…` : 'Add songs', icon: Upload, kbd: 'KeyA', pad: 'b3', run: onAdd }
      : { id: 'new', label: 'New track', icon: FilePlus2, kbd: 'KeyN', pad: 'b3', run: () => onEditor(true) },
    { id: 'settings', label: 'Settings', icon: SettingsIcon, kbd: 'KeyS', pad: 'b9', run: onSettings },
    // Esc and the controller's back button: there is nowhere further back than out.
    ...(onExit ? [{ id: 'exit', label: 'Exit', icon: Power, kbd: 'Escape', bar: false, run: onExit }] : []),
  ]);

  const tabRow = useSlide<HTMLDivElement>(tab);
  const recent = edited.slice(0, 2);

  return (
    <div className="page home" data-nav-bar>
      <header className="page-head home-head">
        <h1 className="wordmark">Festival</h1>
        <div className="tabs home-tabs">
          <Hint kbd="KeyQ" pad="b4" mode={mode} style={style} />
          <div className="tab-row slide" role="tablist" aria-label="Main menu" ref={tabRow} data-nav-group="home-tabs">
            <span className="sel" aria-hidden />
            {TABS.map(([id, label, Icon]) => (
              <button key={id} type="button" role="tab" id={`home-tab-${id}`} aria-selected={tab === id} aria-controls="home-panel" data-on={tab === id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
                <Icon strokeWidth={ICON_STROKE} aria-hidden />
                <span className="tab-label">{label}</span>
              </button>
            ))}
          </div>
          <Hint kbd="KeyE" pad="b5" mode={mode} style={style} />
        </div>
        {busy.length > 0 && (
          // Just the count: each song's progress is shown with the song itself.
          <p className="head-status" role="status">
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
      <main className={`page-body home-body ${turn}`} key={tab} id="home-panel" role="tabpanel" aria-labelledby={`home-tab-${tab}`}>
        {tab === 'play' ? (
          <>
            <h2 className="page-title">Pick a set</h2>
            <div className="tiles" data-nav-group="tiles">
              {/* The feature: the player's own set, with its covers, and its songs in order. */}
              <button type="button" className="tile hero" data-autofocus aria-label={setlist.length ? `Your setlist: ${summary(setlist).replace(' · ', ', ')}` : 'Your setlist: empty. Pick up to four songs from your library.'} onClick={onLibrary}>
                {setlist.length ? (
                  <Mosaic songs={setlist} />
                ) : (
                  <span className="mosaic blank" aria-hidden>
                    <ListMusic strokeWidth={ICON_STROKE} />
                  </span>
                )}
                <span className="tile-text">
                  <span className="tile-title">Your setlist</span>
                  <span className="tile-cap">{setlist.length ? summary(setlist) : 'Pick up to four songs from your library'}</span>
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
                          <span className="tile-meta">{summary(list)}</span>
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
          </>
        ) : (
          <>
            <h2 className="page-title">Make your own charts</h2>
            <div className="tiles" data-nav-group="tiles">
              {/* The feature: the track editor, with the tracks that already have charts of the player's own. */}
              <button type="button" className="tile hero" data-autofocus aria-label={`Track editor: ${own.length ? `${own.length} ${own.length === 1 ? 'track' : 'tracks'}, ${edited.length} with charts of your own` : 'no tracks yet'}. Opens your tracks.`} onClick={() => onEditor()}>
                {(edited.length ? edited.map((e) => e.song) : own).length ? (
                  <Mosaic songs={edited.length ? edited.map((e) => e.song) : own} />
                ) : (
                  <span className="mosaic blank" aria-hidden>
                    <PencilRuler strokeWidth={ICON_STROKE} />
                  </span>
                )}
                <span className="tile-text">
                  <span className="tile-title">Track editor</span>
                  <span className="tile-cap">{own.length ? 'Change the charts the game wrote, or write your own from nothing. The game plays yours.' : 'Bring in a song and write its charts, note by note or by playing along.'}</span>
                  <span className="hero-songs">
                    {Array.from({ length: SET_MAX }, (_, i) => {
                      const e = edited[i];
                      return (
                        <span key={i} className={`hero-song ${e ? '' : 'open'}`}>
                          <span className="hero-num">{i + 1}</span>
                          <span className="hero-name">{e ? e.song.title : i === edited.length ? 'Nothing edited yet' : ''}</span>
                          {e && <span className="hero-by">{charts(e.charts)}</span>}
                        </span>
                      );
                    })}
                  </span>
                </span>
              </button>
              <div className="tile-stack">
                {recent.map((e, i) => (
                  <button type="button" key={e.song.id} className="tile" style={{ ['--i' as string]: i + 1 }} aria-label={`Carry on with ${e.song.title} by ${e.song.artist}: ${charts(e.charts)}`} onClick={() => onEditSong(e.song)}>
                    <Mosaic songs={[e.song]} />
                    <span className="tile-text">
                      <span className="tile-title">Carry on</span>
                      <span className="tile-cap tile-song">
                        {e.song.title} · {e.song.artist}
                      </span>
                      <span className="tile-meta">{charts(e.charts)}</span>
                    </span>
                  </button>
                ))}
                <button type="button" className="tile add" style={{ ['--i' as string]: recent.length + 1 }} onClick={() => onEditor(true)}>
                  <span className="mosaic blank dashed" aria-hidden>
                    <Plus strokeWidth={ICON_STROKE} />
                  </span>
                  <span className="tile-text">
                    <span className="tile-title">New track</span>
                    <span className="tile-cap">Bring in a song. Let the game chart it for you to edit, or start with empty lanes.</span>
                  </span>
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
