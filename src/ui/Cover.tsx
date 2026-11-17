import type { SongMeta } from '../storage/db';
import { useObjectUrl } from './useObjectUrl';

const hueFor = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

/**
 * Cover art, or a typographic cover for songs without one: two colour fields split on the
 * diagonal, the song's initial set large in the display face.
 */
export function Cover({ blob, title, className = '' }: { blob?: Blob; title: string; className?: string }) {
  const url = useObjectUrl(blob);
  if (url) return <img className={`cover ${className}`} src={url} alt="" draggable={false} />;
  const h = hueFor(title);
  return (
    <div className={`cover generated ${className}`} aria-hidden style={{ ['--c1' as string]: `hsl(${h} 72% 52%)`, ['--c2' as string]: `hsl(${(h + 50) % 360} 70% 30%)` }}>
      <span>{title.trim().slice(0, 1).toUpperCase() || '?'}</span>
    </div>
  );
}

/** Up to four covers as one square: a single cover fills it, two split it, three or four tile it. */
export function Mosaic({ songs }: { songs: SongMeta[] }) {
  const shown = songs.slice(0, 4);
  return (
    <span className="mosaic" data-count={shown.length} aria-hidden>
      {shown.map((s) => (
        <Cover key={s.id} blob={s.cover} title={s.title} />
      ))}
    </span>
  );
}
