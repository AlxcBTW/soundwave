import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { analysisManager } from '../analysis/manager';
import { DIFFICULTIES, PARTS, type Chart, type Difficulty, type Part } from '../chart/types';
import { getEngine } from '../audio/engine';
import { isAudioFile, readSongFile } from '../audio/importSong';
import { DEMO_ID, forgetSongBuffer, loadSongBuffer } from '../audio/songAudio';
import type { Results } from '../game/GameSession';
import { demoChart } from '../game/demo';
import { loadSettings, saveSettings, type Settings } from '../game/settings';
import { deleteSong, getSong, listSongs, putSong, submitScore, type SongMeta } from '../storage/db';
import { LibraryScreen, type SongStatus } from './LibraryScreen';
import { MenuBackground } from './MenuBackground';
import { PlayScreen } from './PlayScreen';
import { ResultsScreen } from './ResultsScreen';
import { SettingsScreen } from './SettingsScreen';
import { SongDetail } from './SongDetail';
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
          else await putSong(meta, new Blob([bytes], { type: meta.mime }));
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

  const preview = useCallback(
    async (song: SongMeta, on: boolean) => {
      const engine = getEngine();
      if (!on) return engine.stop();
      try {
        const buf = await loadSongBuffer(song.id);
        engine.load(buf);
        engine.offset = 0;
        engine.volume = settings.volume * 0.8;
        await engine.play(buf.duration / 3, 0.05);
      } catch (e) {
        toast((e as Error).message);
      }
    },
    [settings.volume, toast],
  );

  const play = async (song: SongMeta, part: Part, difficulty: Difficulty) => {
    try {
      getEngine().stop();
      const buffer = await loadSongBuffer(song.id);
      const chart = song.id === DEMO_ID ? { ...demoChart(difficulty), part } : await analysisManager.chart(song.id, part, difficulty);
      if (!chart) return toast('This song has not been analyzed yet.');
      if (chart.notes.length === 0) return toast('No notes were found for this part. Try another part.');
      setView({ name: 'play', song, buffer, chart, key: Date.now() });
    } catch (e) {
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

  const detailId = view.name === 'detail' ? view.song.id : null;
  const detailReady = detailId ? status[detailId]?.state === 'ready' : false;
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
    (on: boolean) => {
      if (view.name === 'detail') void preview(view.song, on);
    },
    [view.name === 'detail' ? view.song.id : null, preview],
  );

  let content: React.ReactNode;
  if (view.name === 'play') {
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
      <div className="screen">
        <MenuBackground />
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
        <MenuBackground />
        {view.name === 'settings' ? (
          <SettingsScreen settings={settings} mlStatus="off" onChange={updateSettings} onBack={() => setView(view.back)} />
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
    );
  }

  return (
    <>
      {content}
      <Toasts items={toasts.items} onDismiss={toasts.dismiss} />
    </>
  );
}
