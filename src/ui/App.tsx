import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { analysisManager } from '../analysis/manager';
import { checkHealth, mlAnalyzer } from '../analysis/mlClient';
import { getEngine } from '../audio/engine';
import { ACCEPTED, isAudioFile, readSongFile } from '../audio/importSong';
import { menuMusicStatus, setMenuMusic, setMusicVolume } from '../audio/menuMusic';
import { loadSfx, playSfx, setSfxVolume, sfxStatus } from '../audio/sfx';
import { DEMO_ID, forgetSongBuffer, loadSongBuffer } from '../audio/songAudio';
import type { Chart } from '../chart/types';
import { DebugScreen } from '../debug/DebugScreen';
import type { Results } from '../game/GameSession';
import { demoChart } from '../game/demo';
import { applyDisplayMode } from '../game/displayMode';
import { loadPick, loadSetlist, pruneSetlist, savePick, saveSetlist, SET_MAX, toggleSong, type Pick } from '../game/setlist';
import { loadSettings, saveSettings, type Settings } from '../game/settings';
import { getInputMode, installInputMode, setInputMode, usesFocus } from '../input/inputMode';
import { focusStart, installMenuNav } from '../input/menuNav';
import { pads, resolveStyle } from '../input/pads';
import { setMenuRumble } from '../input/rumble';
import { deleteSong, getSong, listAllScores, listSongs, putSong, submitScore, type BestScore, type SongMeta } from '../storage/db';
import { ActionBar } from './actions';
import { FocusRing } from './FocusRing';
import { HomeScreen } from './HomeScreen';
import { DIFFICULTY_LABEL, PART_LABEL } from './icons';
import { LibraryScreen, type SongStatus } from './LibraryScreen';
import { LobbyScreen } from './LobbyScreen';
import { MenuBackground } from './MenuBackground';
import { PlayScreen } from './PlayScreen';
import { ResultsScreen, SummaryScreen, type SetResult } from './ResultsScreen';
import { SettingsScreen } from './SettingsScreen';
import { SongSheet } from './SongSheet';
import { Toasts, useToasts } from './Toasts';
import { installUiSounds } from './uiSounds';

const DEMO_SONG: SongMeta = {
  id: DEMO_ID,
  title: 'Demo Track',
  artist: 'Festival',
  fileName: 'demo',
  mime: 'audio/wav',
  size: 0,
  duration: 42,
  addedAt: 0,
};

type LobbyView = { name: 'lobby'; ids: string[]; from: 'home' | 'library' };

/** A set being played: its songs with their charts, where it is, and what has been scored so far. */
interface Run {
  songs: SongMeta[];
  charts: Chart[];
  index: number;
  results: SetResult[];
  pick: Pick;
  lobby: LobbyView;
}

type View =
  | { name: 'home' }
  | { name: 'library' }
  | LobbyView
  | { name: 'settings'; back: View }
  | { name: 'debug'; song: SongMeta; back: View }
  | { name: 'play'; run: Run; buffer: AudioBuffer; key: number }
  | { name: 'results'; run: Run }
  | { name: 'summary'; run: Run };

const DEPTH: Record<View['name'], number> = { home: 0, library: 1, settings: 1, lobby: 2, debug: 2, play: 3, results: 4, summary: 5 };

export function App() {
  const [view, setView] = useState<View>({ name: 'home' });
  const [songs, setSongs] = useState<SongMeta[]>([]);
  const [scores, setScores] = useState<BestScore[]>([]);
  const [importing, setImporting] = useState(0);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [setlist, setSetlistState] = useState<string[]>(loadSetlist);
  const [pick, setPickState] = useState<Pick>(loadPick);
  const [seed, setSeed] = useState(() => Date.now());
  const [sheet, setSheet] = useState<SongMeta | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const updateSettings = useCallback((s: Settings) => {
    setSettings(s);
    saveSettings(s);
  }, []);
  const toasts = useToasts();
  const { push: toast } = toasts;

  const setSetlist = useCallback((next: string[]) => {
    setSetlistState(next);
    saveSetlist(next);
  }, []);
  const setPick = useCallback((next: Pick) => {
    setPickState(next);
    savePick(next);
  }, []);

  // Input: controllers are polled from the start; the keyboard and controllers both move focus.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(() => {
    pads.start();
    const stopMode = installInputMode();
    const stopNav = installMenuNav(() => resolveStyle(settingsRef.current.glyphs, pads.snapshot().family));
    const stopSounds = installUiSounds();
    void loadSfx();
    if (import.meta.env.DEV) Object.assign(window, { __audio: { sfx: sfxStatus, music: menuMusicStatus }, __input: setInputMode });
    return () => {
      stopMode();
      stopNav();
      stopSounds();
    };
  }, []);
  useEffect(() => setSfxVolume(settings.sfxVolume), [settings.sfxVolume]);
  useEffect(() => setMusicVolume(settings.musicVolume), [settings.musicVolume]);
  useEffect(() => setMenuRumble(settings.rumble), [settings.rumble]);
  useEffect(() => void applyDisplayMode(settings.displayMode), [settings.displayMode]);
  useEffect(() => document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale)), [settings.uiScale]);
  // Motion: the player's choice, or the system's when they left it alone.
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      const reduced = settings.motion === 'reduced' || (settings.motion === 'system' && media.matches);
      document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.motion]);

  const refresh = useCallback(async () => {
    try {
      setSongs([...(await listSongs()), DEMO_SONG]);
    } catch {
      setSongs([DEMO_SONG]);
      toast('Song storage is unavailable in this browser window. Imported songs will not be saved.');
    }
  }, [toast]);
  const refreshScores = useCallback(async () => {
    try {
      setScores(await listAllScores());
    } catch {
      /* scores are best-effort */
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshScores();
  }, [refresh, refreshScores]);

  // Optional ML service: route analyses through it while it is enabled and reachable.
  const [mlStatus, setMlStatus] = useState<'off' | 'checking' | 'online' | 'offline'>('off');
  useEffect(() => {
    analysisManager.remote = settings.mlEnabled ? mlAnalyzer(settings.mlUrl) : null;
    if (!settings.mlEnabled) return setMlStatus('off');
    let cancelled = false;
    const check = async () => {
      const h = await checkHealth(settings.mlUrl);
      if (!cancelled) setMlStatus(h ? 'online' : 'offline');
    };
    setMlStatus('checking');
    void check();
    const timer = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [settings.mlEnabled, settings.mlUrl]);

  const analysisStatus = useSyncExternalStore(analysisManager.subscribe, analysisManager.snapshot);
  const status: Record<string, SongStatus> = useMemo(() => ({ ...analysisStatus, [DEMO_ID]: { state: 'ready' } }), [analysisStatus]);

  // Analyze new songs automatically; previously analyzed ones load from the cache.
  useEffect(() => {
    for (const s of songs) if (s.id !== DEMO_ID && !analysisStatus[s.id]) void analysisManager.check(s.id, true);
  }, [songs, analysisStatus]);

  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);
  // Songs that were removed leave the setlist with them.
  useEffect(() => {
    if (!songs.length) return;
    const kept = pruneSetlist(setlist, new Set(songs.map((s) => s.id)));
    if (kept.length !== setlist.length) setSetlist(kept);
  }, [songs, setlist, setSetlist]);
  const setSongs_ = useMemo(() => setlist.map((id) => byId.get(id)).filter((s): s is SongMeta => !!s), [setlist, byId]);
  const played = useMemo(() => new Set(scores.map((s) => s.songId)), [scores]);

  const importFiles = useCallback(
    async (files: File[]) => {
      const audio = files.filter(isAudioFile);
      if (audio.length < files.length) toast(`Skipped ${files.length - audio.length} file(s) that are not audio.`);
      setImporting((n) => n + audio.length);
      for (const f of audio) {
        try {
          const { meta, bytes } = await readSongFile(f);
          if (await getSong(meta.id)) toast(`"${meta.title}" is already in your library.`);
          else {
            await putSong(meta, new Blob([bytes], { type: meta.mime }));
            playSfx('add');
            // A re-import of a removed song starts clean: no stale status or failed analysis.
            forgetSongBuffer(meta.id);
            analysisManager.forget(meta.id);
          }
        } catch (e) {
          toast(`Could not import ${f.name}: ${(e as Error).message}`);
        } finally {
          setImporting((n) => n - 1);
        }
      }
      await refresh();
    },
    [refresh, toast],
  );
  const addSongs = useCallback(() => fileInput.current?.click(), []);

  // Files dropped anywhere on a menu are imported.
  const [dragging, setDragging] = useState(false);
  const inMenus = view.name !== 'play' && view.name !== 'debug';
  useEffect(() => {
    if (!inMenus) return;
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
      if (files.length) void importFiles(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      setDragging(false);
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [inMenus, importFiles]);

  const toggle = (song: SongMeta) => {
    if (!setlist.includes(song.id) && setlist.length >= SET_MAX) return toast(`The setlist holds ${SET_MAX} songs. Take one out to add another.`);
    setSetlist(toggleSong(setlist, song.id));
  };

  /* Playing a set ------------------------------------------------------------------------- */

  // A stage-light wipe covers the moment a song loads: it closes over the menu, the play screen
  // mounts behind it, and it opens again.
  const [launch, setLaunch] = useState<'in' | 'out' | null>(null);
  const playAt = async (run: Run, index: number) => {
    setLaunch('in');
    const minWipe = new Promise((r) => setTimeout(r, 620));
    try {
      getEngine().stop();
      const buffer = await loadSongBuffer(run.songs[index].id);
      await minWipe;
      setView({ name: 'play', run: { ...run, index }, buffer, key: Date.now() });
      setLaunch('out');
      setTimeout(() => setLaunch(null), 560);
    } catch (e) {
      setLaunch(null);
      toast((e as Error).message);
    }
  };

  const start = async (lobby: LobbyView) => {
    setLaunch('in');
    try {
      const entries: { song: SongMeta; chart: Chart }[] = [];
      for (const id of lobby.ids) {
        const song = byId.get(id);
        if (!song) continue;
        const chart = id === DEMO_ID ? { ...demoChart(pick.difficulty), part: pick.part } : await analysisManager.chart(id, pick.part, pick.difficulty);
        if (chart && chart.notes.length > 0) entries.push({ song, chart });
      }
      if (!entries.length) {
        setLaunch(null);
        return toast('No notes were found for this part. Try another part.');
      }
      await playAt({ songs: entries.map((e) => e.song), charts: entries.map((e) => e.chart), index: 0, results: [], pick, lobby }, 0);
    } catch (e) {
      setLaunch(null);
      toast((e as Error).message);
    }
  };

  const withResult = (run: Run, result: SetResult): Run => {
    const results = [...run.results];
    results[run.index] = result;
    return { ...run, results };
  };

  const finish = async (run: Run, results: Results) => {
    const song = run.songs[run.index];
    let best: number | undefined;
    try {
      best = await submitScore({
        songId: song.id,
        part: run.pick.part,
        difficulty: run.pick.difficulty,
        score: results.score,
        stars: results.stars,
        accuracy: results.accuracy,
        fullCombo: results.fullCombo,
      });
      void refreshScores();
    } catch {
      /* scores are best-effort */
    }
    setView({ name: 'results', run: withResult(run, { song, results, best }) });
  };

  /** Every song of the run with its result so far; songs not reached count as skipped. */
  const filled = (run: Run): Run => ({ ...run, results: run.songs.map((song, i) => run.results[i] ?? { song, results: null }) });
  const goHome = () => {
    setSeed(Date.now());
    setView({ name: 'home' });
  };
  const advance = (run: Run) => {
    if (run.index + 1 < run.songs.length) void playAt(run, run.index + 1);
    else if (run.songs.length > 1) setView({ name: 'summary', run: filled(run) });
    else setView(run.lobby.from === 'library' ? { name: 'library' } : { name: 'home' });
  };

  // The theme plays behind the menus and makes way for a preview, the launch and the song.
  const menuMusic = inMenus && !previewing && launch === null;
  useEffect(() => setMenuMusic(menuMusic, 0.45), [menuMusic]);

  // Going deeper enters from the right; going back, from the left.
  const prevDepth = useRef(DEPTH[view.name]);
  const sceneDirRef = useRef<'fwd' | 'back'>('fwd');
  if (DEPTH[view.name] !== prevDepth.current) {
    sceneDirRef.current = DEPTH[view.name] > prevDepth.current ? 'fwd' : 'back';
    prevDepth.current = DEPTH[view.name];
  }
  const sceneKey = view.name === 'results' ? `results:${view.run.index}` : view.name;

  // A new screen starts with focus on its first control for keyboard and controller players.
  useEffect(() => {
    if (view.name === 'play') return;
    const raf = requestAnimationFrame(() => {
      if (document.querySelector('[data-modal]')) return;
      if (usesFocus(getInputMode())) focusStart();
      else (document.activeElement as HTMLElement | null)?.blur?.();
    });
    return () => cancelAnimationFrame(raf);
  }, [sceneKey, view.name]);

  const subtitle = (run: Run) => `${PART_LABEL[run.pick.part]} · ${DIFFICULTY_LABEL[run.pick.difficulty]}`;

  let content: React.ReactNode;
  if (view.name === 'debug') {
    content = <DebugScreen song={view.song} settings={settings} onBack={() => setView(view.back)} />;
  } else if (view.name === 'play') {
    const { run } = view;
    const song = run.songs[run.index];
    const more = run.index + 1 < run.songs.length;
    content = (
      <PlayScreen
        key={view.key}
        title={song.title}
        artist={song.artist}
        position={run.index + 1}
        total={run.songs.length}
        buffer={view.buffer}
        chart={run.charts[run.index]}
        settings={settings}
        onQuit={() => setView(run.lobby)}
        onSkip={more ? () => void playAt(withResult(run, { song, results: null }), run.index + 1) : undefined}
        onFinish={(r) => void finish(run, r)}
      />
    );
  } else {
    let screen: React.ReactNode;
    if (view.name === 'settings') {
      screen = <SettingsScreen settings={settings} mlStatus={mlStatus} onChange={updateSettings} onBack={() => setView(view.back)} />;
    } else if (view.name === 'library') {
      screen = (
        <LibraryScreen
          songs={songs}
          status={status}
          setlist={setlist}
          scores={scores}
          importing={importing}
          settings={settings}
          onToggle={toggle}
          onDetails={setSheet}
          onReady={() => setView({ name: 'lobby', ids: setlist, from: 'library' })}
          onBack={goHome}
          onAdd={addSongs}
        />
      );
    } else if (view.name === 'lobby') {
      const list = view.ids.map((id) => byId.get(id)).filter((s): s is SongMeta => !!s);
      screen = (
        <LobbyScreen songs={list} pick={pick} scores={scores} settings={settings} onPick={setPick} onStart={() => void start(view)} onBack={() => (view.from === 'library' ? setView({ name: 'library' }) : goHome())} />
      );
    } else if (view.name === 'results') {
      const { run } = view;
      const r = run.results[run.index];
      screen = (
        <ResultsScreen
          song={r.song}
          subtitle={subtitle(run)}
          results={r.results!}
          best={r.best}
          position={run.index + 1}
          total={run.songs.length}
          next={run.songs[run.index + 1]}
          onRetry={() => void playAt(run, run.index)}
          onNext={() => advance(run)}
          onEnd={() => setView({ name: 'summary', run: filled(run) })}
        />
      );
    } else if (view.name === 'summary') {
      const { run } = view;
      screen = <SummaryScreen set={run.results} subtitle={subtitle(run)} onAgain={() => void playAt({ ...run, results: [] }, 0)} onDone={goHome} />;
    } else {
      screen = (
        <HomeScreen
          songs={songs}
          status={status}
          setlist={setSongs_}
          played={played}
          seed={seed}
          importing={importing}
          empty={songs.length <= 1}
          onLibrary={() => setView({ name: 'library' })}
          onSet={(ids) => setView({ name: 'lobby', ids, from: 'home' })}
          onAdd={addSongs}
          onSettings={() => setView({ name: 'settings', back: view })}
        />
      );
    }
    content = (
      <div className={`menu on-${view.name}`}>
        <MenuBackground graphics={settings.graphics} />
        <div className="veil" aria-hidden />
        {/* One entrance per screen change; the stage behind it stays. */}
        <div className={`scene ${sceneDirRef.current}`} key={sceneKey}>
          {screen}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {content}
      {sheet && inMenus && (
        <SongSheet
          song={byId.get(sheet.id) ?? sheet}
          builtin={sheet.id === DEMO_ID}
          status={status[sheet.id] ?? { state: 'idle' }}
          scores={scores}
          slot={setlist.indexOf(sheet.id)}
          setFull={setlist.length >= SET_MAX}
          volume={settings.volume}
          toast={toast}
          onPreviewing={setPreviewing}
          onToggle={() => toggle(sheet)}
          onAnalyze={() => analysisManager.enqueue(sheet.id, true)}
          onDebug={() => {
            setSheet(null);
            setView({ name: 'debug', song: sheet, back: view });
          }}
          onDelete={async () => {
            setSheet(null);
            getEngine().stop();
            forgetSongBuffer(sheet.id);
            analysisManager.forget(sheet.id);
            await deleteSong(sheet.id);
            await Promise.all([refresh(), refreshScores()]);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      <ActionBar settings={settings} />
      <FocusRing />
      {dragging && (
        <div className="drop-overlay" aria-hidden>
          <span>Drop to add to your library</span>
        </div>
      )}
      {launch && (
        <div className={`launch-wipe ${launch}`} aria-hidden>
          <span />
          <span />
          <span />
        </div>
      )}
      <Toasts items={toasts.items} onDismiss={toasts.dismiss} />
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) void importFiles(files);
        }}
      />
    </div>
  );
}
