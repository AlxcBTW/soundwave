import { useObjectUrl } from './useObjectUrl';

const hueFor = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

/** Cover art, or a generated gradient tile with the song's initial. */
export function Cover({ blob, title, size }: { blob?: Blob; title: string; size?: number }) {
  const url = useObjectUrl(blob);
  const style = size ? { width: size, height: size } : undefined;
  if (url) return <img className="cover" src={url} alt="" style={style} draggable={false} />;
  const h = hueFor(title);
  return (
    <div className="cover generated" style={{ ...style, background: `linear-gradient(135deg, hsl(${h} 80% 55%), hsl(${(h + 70) % 360} 80% 35%))` }}>
      {title.slice(0, 1).toUpperCase()}
    </div>
  );
}
