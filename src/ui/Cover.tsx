import { useObjectUrl } from './useObjectUrl';

const hueFor = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

/**
 * Cover art, or a typographic cover for songs without one: two flat colour fields split on the
 * diagonal, the song's initial set large in the display face.
 */
export function Cover({ blob, title, size }: { blob?: Blob; title: string; size?: number }) {
  const url = useObjectUrl(blob);
  const style = size ? { width: size, height: size } : undefined;
  if (url) return <img className="cover" src={url} alt="" style={style} draggable={false} />;
  const h = hueFor(title);
  return (
    <div
      className="cover generated"
      aria-hidden
      style={{ ...style, ['--c1' as string]: `hsl(${h} 72% 52%)`, ['--c2' as string]: `hsl(${(h + 50) % 360} 70% 30%)` }}
    >
      <span>{title.trim().slice(0, 1).toUpperCase() || '?'}</span>
    </div>
  );
}
