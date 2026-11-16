import { useEffect, useRef, useState } from 'react';
import { getEngine } from '../audio/engine';

const fmt = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * Position and seek bar for whatever the song page is previewing. Reads the shared audio engine
 * every frame; dragging only seeks on release so playback doesn't stutter while scrubbing.
 */
export function PreviewBar({ active, label }: { active: boolean; label: string }) {
  const engine = getEngine();
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubRef = useRef<number | null>(null);
  scrubRef.current = scrub;

  useEffect(() => {
    if (!active) {
      setTime(0);
      return;
    }
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      setDuration(engine.duration);
      if (scrubRef.current === null) setTime(Math.min(engine.duration, Math.max(0, engine.time())));
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [active, engine]);

  const seek = (t: number) => {
    setScrub(null);
    if (!active) return;
    void engine.play(Math.max(0, Math.min(engine.duration - 0.05, t)), 0.02);
  };

  const shown = scrub ?? time;
  const pct = duration > 0 ? (shown / duration) * 100 : 0;

  return (
    <div className={`preview-bar ${active ? '' : 'idle'}`}>
      <div className="preview-meta">
        <span className="preview-label">{active ? label : 'Nothing playing'}</span>
        <span className="preview-time">
          {fmt(shown)} / {fmt(duration && active ? duration : 0)}
        </span>
      </div>
      <input
        type="range"
        className="seek"
        aria-label={`Seek ${label}`}
        min={0}
        max={duration || 1}
        step={0.1}
        value={active ? shown : 0}
        disabled={!active}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => setScrub(+e.target.value)}
        onPointerUp={(e) => seek(+(e.target as HTMLInputElement).value)}
        onKeyUp={(e) => {
          if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.startsWith('Page')) seek(+(e.target as HTMLInputElement).value);
        }}
      />
    </div>
  );
}
