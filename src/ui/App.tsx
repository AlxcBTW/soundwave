import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { analysisManager } from '../analysis/manager';
import { checkHealth, mlAnalyzer } from '../analysis/mlClient';
import { DIFFICULTIES, PARTS, type Chart, type Difficulty, type Part } from '../chart/types';
import { getEngine } from '../audio/engine';
import { isAudioFile, readSongFile } from '../audio/importSong';
import { DEMO_ID, forgetSongBuffer, loadSongBuffer } from '../audio/songAudio';
import type { Results } from '../game/GameSession';
import { demoChart } from '../game/demo';
import { applyDisplayMode } from '../game/displayMode';
import { loadSettings, saveSettings, type Settings } from '../game/settings';
import { installMenuNav } from '../input/menuNav';
import { loadSfx, playSfx, setSfxVolume, sfxStatus } from '../audio/sfx';
import { menuMusicStatus, setMenuMusic, setMusicVolume } from '../audio/menuMusic';
import { installUiSounds } from './uiSounds';
import { setMenuRumble } from '../input/rumble';
import { pads, resolveStyle } from '../input/pads';
import { deleteSong, getSong, getStem, listSongs, listStems, putSong, submitScore, type SongMeta } from '../storage/db';
import type { StemName } from '../analysis/types';
import { LibraryScreen, type SongStatus } from './LibraryScreen';
import { MenuBackground } from './MenuBackground';
import { PadHints } from './PadHints';
import { PlayScreen } from './PlayScreen';
import { ResultsScreen } from './ResultsScreen';
import { DebugScreen } from '../debug/DebugScreen';
import { SettingsScreen } from './SettingsScreen';
import { SongDetail, type PreviewSource } from './SongDetail';
import { Toasts, useToasts } from './Toasts';

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

type View =
  | { name: 'library' }
  | { name: 'settings'; back: View }
  | { name: 'detail'; song: SongMeta }
  | { name: 'debug'; song: SongMeta }
  | { name: 'play'; song: SongMeta; buffer: AudioBuffer; chart: Chart; key: number }
  | { name: 'results'; song: SongMeta; buffer: AudioBuffer; chart: Chart; results: Results; best?: number };

export function App() {
  const [view, setView] = useState<View>({ name: 'library' });
  const [songs, setSongs] = useState<SongMeta[]>([]);
  const [importing, setImporting] = useState(0);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const updateSettings = useCallback((s: Settings) => {
    setSettings(s);
    saveSettings(s);
  }, []);
  const toasts = useToasts();
  const { push: toast } = toasts;

  // Controllers: polled from the start; menus are navigable with the D-pad or left stick.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(() => {
    pads.start();
    const stopNav = installMenuNav(() => resolveStyle(settingsRef.current.glyphs, pads.snapshot().family));
    const stopSounds = installUiSounds();
    void loadSfx();
    if (import.meta.env.DEV) Object.assign(window, { __audio: { sfx: sfxStatus, music: menuMusicStatus } });
    return () => {
      stopNav();
      stopSounds();
    };
  }, []);
  useEffect(() => setSfxVolume(settings.sfxVolume), [settings.sfxVolume]);
  useEffect(() => setMusicVolume(settings.musicVolume), [settings.musicVolume]);
  useEffect(() => setMenuRumble(settings.rumble), [settings.rumble]);
  useEffect(() => void applyDisplayMode(settings.displayMode), [settings.displayMode]);

  const refresh = useCallback(async () => {
    try {
      setSongs([...(await listSongs()), DEMO_SONG]);
    } catch {
      setSongs([DEMO_SONG]);
      toast('Song storage is unavailable in this browser window. Imported songs will not be saved.');
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const [previewing, setPreviewing] = useState<PreviewSource | null>(null);
  const preview = useCallback(
    async (song: SongMeta, source: PreviewSource | null) => {
      const engine = getEngine();
      engine.stop();
      setPreviewing(source);
      if (!source) return;
      try {
        let buf: AudioBuffer;
        if (source === 'mix') {
          buf = await loadSongBuffer(song.id);
        } else {
          const blob = await getStem(song.id, source);
          if (!blob) throw new Error('This stem is no longer stored. Re-analyze with the ML service.');
          buf = await engine.decode(await blob.arrayBuffer());
        }
        engine.load(buf);
        engine.offset = 0;
        engine.volume = settings.volume * 0.8;
        engine.onEnded = () => setPreviewing((p) => (p === source ? null : p));
        // The song preview starts a third in; stems play in full for checking the separation.
        await engine.play(source === 'mix' ? buf.duration / 3 : 0, 0.05);
      } catch (e) {
        setPreviewing(null);
        toast((e as Error).message);
      }
    },
    [settings.volume, toast],
  );

  // Stage-light wipe while a song loads: bands sweep in, the play screen mounts behind them,
  // and they sweep out.
  const [launch, setLaunch] = useState<'in' | 'out' | null>(null);
  const play = async (song: SongMeta, part: Part, difficulty: Difficulty) => {
    setLaunch('in');
    const minWipe = new Promise((r) => setTimeout(r, 620));
    try {
      getEngine().stop();
      const buffer = await loadSongBuffer(song.id);
      const chart = song.id === DEMO_ID ? { ...demoChart(difficulty), part } : await analysisManager.chart(song.id, part, difficulty);
      if (!chart || chart.notes.length === 0) {
        setLaunch(null);
        return toast(chart ? 'No notes were found for this part. Try another part.' : 'This song has not been analyzed yet.');
      }
      await minWipe;
      setView({ name: 'play', song, buffer, chart, key: Date.now() });
      setLaunch('out');
      setTimeout(() => setLaunch(null), 560);
    } catch (e) {
      setLaunch(null);
      toast((e as Error).message);
    }
  };

  const finish = async (v: Extract<View, { name: 'play' }>, results: Results) => {
    let best: number | undefined;
    try {
      best = await submitScore({
        songId: v.song.id,
        part: v.chart.part,
        difficulty: v.chart.difficulty,
        score: results.score,
        stars: results.stars,
        accuracy: results.accuracy,
        fullCombo: results.fullCombo,
      });
    } catch {
      /* scores are best-effort */
    }
    setView({ name: 'results', song: v.song, buffer: v.buffer, chart: v.chart, results, best });
  };

  // The theme plays behind the menus and makes way for a preview, the launch and the song.
  const menuMusic = view.name !== 'play' && view.name !== 'debug' && previewing === null && launch === null;
  useEffect(() => setMenuMusic(menuMusic, 0.45), [menuMusic]);

  const detailId = view.name === 'detail' ? view.song.id : null;
  const detailReady = detailId ? status[detailId]?.state === 'ready' : false;
  // Stems stored for the open song (refreshed when its analysis finishes).
  const [stems, setStems] = useState<StemName[]>([]);
  useEffect(() => {
    setStems([]);
    if (!detailId || detailId === DEMO_ID) return;
    let cancelled = false;
    void listStems(detailId)
      .then((s) => !cancelled && setStems(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [detailId, detailReady]);

  const [noteCounts, setNoteCounts] = useState<Partial<Record<Part, Partial<Record<Difficulty, number>>>>>();
  useEffect(() => {
    setNoteCounts(undefined);
    if (!detailId || !detailReady) return;
    let cancelled = false;
    void (async () => {
      const counts: Partial<Record<Part, Partial<Record<Difficulty, number>>>> = {};
      for (const p of PARTS) {
        counts[p] = {};
        for (const d of DIFFICULTIES) {
          const c = detailId === DEMO_ID ? demoChart(d) : await analysisManager.chart(detailId, p, d);
          counts[p]![d] = c?.notes.length ?? 0;
        }
      }
      if (!cancelled) setNoteCounts(counts);
    })();
    return () => {
      cancelled = true;
    };
  }, [detailId, detailReady]);

  const detailPreview = useCallback(
    (source: PreviewSource | null) => {
      if (view.name === 'detail') void preview(view.song, source);
    },
    [view.name === 'detail' ? view.song.id : null, preview],
  );

  // Going deeper (setlist → song → results) enters from the right; going back, from the left.
  const depth = (v: View) => (v.name === 'library' ? 0 : v.name === 'results' ? 2 : 1);
  const prevDepth = useRef(depth(view));
  const sceneDirRef = useRef<'fwd' | 'back'>('fwd');
  if (depth(view) !== prevDepth.current) {
    sceneDirRef.current = depth(view) > prevDepth.current ? 'fwd' : 'back';
    prevDepth.current = depth(view);
  }
  const sceneDir = sceneDirRef.current;

  let content: React.ReactNode;
  if (view.name === 'debug') {
    content = <DebugScreen song={view.song} settings={settings} onBack={() => setView({ name: 'detail', song: view.song })} />;
  } else if (view.name === 'play') {
    content = (
      <PlayScreen
        key={view.key}
        title={`${view.song.title} — ${view.song.artist}`}
        buffer={view.buffer}
        chart={view.chart}
        settings={settings}
        onQuit={() => setView({ name: 'detail', song: view.song })}
        onFinish={(r) => void finish(view, r)}
      />
    );
  } else if (view.name === 'results') {
    content = (
      <div className="menu">
        <MenuBackground graphics={settings.graphics} />
        <ResultsScreen
          title={view.song.title}
          subtitle={`${view.chart.part} · ${view.chart.difficulty}`}
          results={view.results}
          best={view.best}
          onRetry={() => setView({ name: 'play', song: view.song, buffer: view.buffer, chart: view.chart, key: Date.now() })}
          onDone={() => setView({ name: 'detail', song: view.song })}
        />
      </div>
    );
  } else {
    content = (
      <div className="menu">
        <MenuBackground graphics={settings.graphics} />
        {/* One entrance per screen change; the stage behind it stays. */}
        <div className={`scene ${sceneDir}`} key={view.name === 'detail' ? `detail:${view.song.id}` : view.name}>
          {view.name === 'settings' ? (
            <SettingsScreen settings={settings} mlStatus={mlStatus} onChange={updateSettings} onBack={() => setView(view.back)} />
          ) : view.name === 'library' ? (
            <LibraryScreen
              songs={songs}
              status={status}
              importing={importing}
              onImport={(f) => void importFiles(f)}
              onOpen={(song) => setView({ name: 'detail', song })}
              onSettings={() => setView({ name: 'settings', back: view })}
            />
          ) : (
            <SongDetail
              song={view.song}
              builtin={view.song.id === DEMO_ID}
              status={status[view.song.id] ?? { state: 'idle' }}
              noteCounts={noteCounts}
              stems={stems}
              previewing={previewing}
              onDebug={() => {
                void preview(view.song, null);
                setView({ name: 'debug', song: view.song });
              }}
              onBack={() => setView({ name: 'library' })}
              onPlay={(p, d) => void play(view.song, p, d)}
              onAnalyze={() => analysisManager.enqueue(view.song.id, true)}
              onPreview={detailPreview}
              onDelete={async () => {
                getEngine().stop();
                forgetSongBuffer(view.song.id);
                analysisManager.forget(view.song.id);
                await deleteSong(view.song.id);
                await refresh();
                setView({ name: 'library' });
              }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {content}
      {view.name !== 'play' && <PadHints settings={settings} />}
      {launch && (
        <div className={`launch-wipe ${launch}`} aria-hidden>
          <span />
          <span />
          <span />
        </div>
      )}
      <Toasts items={toasts.items} onDismiss={toasts.dismiss} />
    </>
  );
}
