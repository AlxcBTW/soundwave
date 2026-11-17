import { useLayoutEffect, useState } from 'react';

export function useObjectUrl(blob: Blob | undefined) {
  const [url, setUrl] = useState<string>();
  // Before the first paint, so a song with cover art never shows its lettered stand-in first.
  useLayoutEffect(() => {
    if (!blob) return setUrl(undefined);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}
