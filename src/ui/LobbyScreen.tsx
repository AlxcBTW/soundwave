import { ArrowLeft, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { analysisManager } from '../analysis/manager';
import { DEMO_ID } from '../audio/songAudio';
import { DIFFICULTIES, lanesFor, PARTS, type Difficulty, type Part } from '../chart/types';
import { demoChart } from '../game/demo';
import { keyLabel, type Settings } from '../game/settings';
import { formatTime, type Pick } from '../game/setlist';
import { PadGlyph } from '../input/glyphs';
import { TAB_EVENT } from '../input/menuNav';
import { playSfx } from '../audio/sfx';
import { menuPulse } from '../input/rumble';
import type { BestScore, SongMeta } from '../storage/db';
import { Hint, useActions, useHints } from './actions';
import { Cover } from './Cover';
import { HoldButton } from './HoldButton';
import { DIFFICULTY_LABEL, ICON_STROKE, PART_ICON, PART_LABEL, Pips, Stars } from './icons';
import { useSlide } from './useSlide';

interface Props {
  songs: SongMeta[];
  pick: Pick;
  scores: BestScore[];
  settings: Settings;
  onPick(pick: Pick): void;
  onStart(): void;
  onBack(): void;
}

type Counts = Record<string, number | undefined>;

/** Ready up: the set in order, the part and difficulty to play it on, and the button that starts it. */
export function LobbyScreen({ songs, pick, scores, settings, onPick, onStart, onBack }: Props) {
  const hints = useHints(settings);
  const [counts, setCounts] = useState<Counts>({});

  // Notes each song has on the chosen part and difficulty.
  useEffect(() => {
    let cancelled = false;
    setCounts({});
    void (async () => {
      for (const s of songs) {
        const chart = s.id === DEMO_ID ? demoChart(pick.difficulty) : await analysisManager.chart(s.id, pick.part, pick.difficulty).catch(() => undefined);
        if (cancelled) return;
        setCounts((c) => ({ ...c, [s.id]: chart?.notes.length ?? 0 }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [songs, pick.part, pick.difficulty]);

  // Shoulder buttons (Q and E) step through the difficulties.
  useEffect(() => {
    const onTab = (e: Event) => {
      const d = (e as CustomEvent<number>).detail;
      const i = DIFFICULTIES.indexOf(pick.difficulty) + d;
      if (i < 0 || i >= DIFFICULTIES.length) return;
      playSfx('tab');
      menuPulse(d < 0 ? 'tab-left' : 'tab-right');
      onPick({ ...pick, difficulty: DIFFICULTIES[i] });
    };
    window.addEventListener(TAB_EVENT, onTab);
    return () => window.removeEventListener(TAB_EVENT, onTab);
  }, [pick, onPick]);

  useActions([
    { id: 'back', label: 'Back', icon: ArrowLeft, kbd: 'Escape', sfx: 'back', run: onBack },
    ...PARTS.map((p, i) => ({ id: `part-${p}`, label: PART_LABEL[p], icon: PART_ICON[p], kbd: `Digit${i + 1}`, bar: false, run: () => onPick({ ...pick, part: p }) })),
  ]);

  const partRow = useSlide<HTMLDivElement>(pick.part);
  const diffRow = useSlide<HTMLDivElement>(pick.difficulty);
  const lanes = lanesFor(pick.difficulty);
  const keys = lanes === 5 ? settings.keys5 : settings.keys4;
  const padKeys = lanes === 5 ? settings.pad5 : settings.pad4;
  const known = songs.every((s) => counts[s.id] !== undefined);
  const playable = songs.filter((s) => (counts[s.id] ?? 0) > 0).length;
  const total = formatTime(songs.reduce((t, s) => t + s.duration, 0));
  const best = (s: SongMeta) => scores.find((b) => b.songId === s.id && b.part === pick.part && b.difficulty === pick.difficulty);

  return (
    <div className="page lobby">
      <header className="page-head">
        <h1 className="page-title">Ready up</h1>
        <p className="head-count">
          {songs.length} {songs.length === 1 ? 'song' : 'songs'}
          {total && ` · ${total}`}
        </p>
      </header>
      <div className="lobby-body">
        <ol className="set-cards" aria-label="Setlist">
          {songs.map((s, i) => {
            const n = counts[s.id];
            const b = best(s);
            return (
              <li key={s.id} className={`set-card ${n === 0 ? 'skipped' : ''}`} style={{ ['--i' as string]: i }}>
                <span className="slot-num" aria-hidden>{i + 1}</span>
                <Cover blob={s.cover} title={s.title} />
                <span className="song-text">
                  <span className="song-title">{s.title}</span>
                  <span className="song-artist">
                    {s.artist}
                    {s.duration > 0 && ` · ${formatTime(s.duration)}`}
                  </span>
                  <span className="set-notes">
                    {n === undefined ? (
                      'Counting notes…'
                    ) : n === 0 ? (
                      <span className="warn">
                        <TriangleAlert strokeWidth={ICON_STROKE} aria-hidden />
                        No {PART_LABEL[pick.part].toLowerCase()} notes found. This song will be skipped.
                      </span>
                    ) : (
                      `${n.toLocaleString()} notes`
                    )}
                  </span>
                </span>
                <span className="set-best">
                  {b ? (
                    <>
                      <Stars n={b.stars} />
                      <span className="num">{b.score.toLocaleString()}</span>
                    </>
                  ) : (
                    <span className="dim">Not played</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>

        <section className="ready-panel" data-nav-group="ready" aria-label="Part and difficulty">
          <h2 className="label" id="part-label">Part</h2>
          <div className="part-row slide" ref={partRow} role="radiogroup" aria-labelledby="part-label">
            <span className="sel" aria-hidden />
            {PARTS.map((p, i) => {
              const Icon = PART_ICON[p];
              const on = pick.part === p;
              return (
                <button key={p} type="button" className={`choice part ${on ? 'on' : ''}`} data-on={on} data-action={`part-${p}`} role="radio" aria-checked={on} onClick={() => onPick({ ...pick, part: p })}>
                  <Icon strokeWidth={ICON_STROKE} aria-hidden />
                  <span>{PART_LABEL[p]}</span>
                  <Hint kbd={`Digit${i + 1}`} mode={hints.mode === 'pad' ? 'touch' : hints.mode} style={hints.style} />
                </button>
              );
            })}
          </div>

          <h2 className="label" id="diff-label">
            Difficulty
            <span className="label-hints" aria-hidden>
              <Hint kbd="KeyQ" pad="b4" {...hints} />
              <Hint kbd="KeyE" pad="b5" {...hints} />
            </span>
          </h2>
          <div className="diff-row slide" ref={diffRow} role="radiogroup" aria-labelledby="diff-label">
            <span className="sel" aria-hidden />
            {DIFFICULTIES.map((d: Difficulty) => {
              const on = pick.difficulty === d;
              return (
                <button key={d} type="button" className={`choice diff ${on ? 'on' : ''}`} data-on={on} role="radio" aria-checked={on} onClick={() => onPick({ ...pick, difficulty: d })}>
                  <Pips difficulty={d} />
                  <span>{DIFFICULTY_LABEL[d]}</span>
                </button>
              );
            })}
          </div>

          <p className="lane-info">
            <span>{lanes} lanes</span>
            {hints.mode === 'touch' ? (
              <span className="dim">Tap the lanes to play</span>
            ) : (
              <span className="lane-keys" aria-label={hints.mode === 'pad' ? 'Controller buttons' : `Keys ${keys.map(keyLabel).join(', ')}`}>
                {(hints.mode === 'pad' ? padKeys : keys).map((k, i) =>
                  hints.mode === 'pad' ? (
                    <span key={i} className={`mini-key pad lane-${i}`}><PadGlyph input={k} style={hints.style} /></span>
                  ) : (
                    <kbd key={i} className={`mini-key lane-${i}`}>{keyLabel(k)}</kbd>
                  ),
                )}
              </span>
            )}
          </p>

          <HoldButton
            label={(PART_LABEL[pick.part] as Part | string) + ' · ' + DIFFICULTY_LABEL[pick.difficulty]}
            hint={!known ? 'Getting the charts ready…' : playable === 0 ? 'No notes on this part. Pick another one.' : hints.mode === 'keyboard' ? 'Hold Enter to start' : 'Hold to start'}
            disabled={!known || playable === 0}
            glyphStyle={hints.style}
            onComplete={onStart}
          />
        </section>
      </div>
    </div>
  );
}
