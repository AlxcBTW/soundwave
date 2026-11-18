import { ImageOff, ImagePlus, Save } from 'lucide-react';
import { useRef, useState } from 'react';
import { prepareCover } from '../storage/coverImage';
import type { SongMeta } from '../storage/db';
import type { MetaChange } from '../storage/songFile';
import { Cover } from './Cover';
import { Dialog } from './Dialog';
import { ICON_STROKE } from './icons';

interface Props {
  song: SongMeta;
  /** Stores the change (in the game's own copy of the song). */
  onSave(change: MetaChange): Promise<void>;
  onClose(): void;
}

/**
 * A song's details, to change: title, artist, album and artwork (a new picture, or none at all).
 * They are kept in the game's .soundwave copy of the song; the audio file it came from is never
 * written to.
 */
export function MetadataSheet({ song, onSave, onClose }: Props) {
  const [title, setTitle] = useState(song.title);
  const [artist, setArtist] = useState(song.artist);
  const [album, setAlbum] = useState(song.album ?? '');
  // The artwork: unchanged (undefined), taken away (null) or a new picture.
  const [cover, setCover] = useState<Blob | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const shown = cover === undefined ? song.cover : (cover ?? undefined);

  const pick = async (file: File) => {
    setError(null);
    try {
      setCover(await prepareCover(file));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const save = async (close: () => void) => {
    if (busy || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ title, artist, album, ...(cover !== undefined ? { cover } : {}) });
      close();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Edit the details of ${song.title}`} onClose={onClose} closeLabel="Cancel">
      {(close) => (
        <form
          className="sheet-body meta-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save(close);
          }}
        >
          <h2 className="display meta-heading">Edit metadata</h2>

          <div className="meta-art">
            <Cover blob={shown} title={title.trim() || song.title} />
            <div className="meta-art-actions">
              <button type="button" className="btn" onClick={() => picker.current?.click()}>
                <ImagePlus strokeWidth={ICON_STROKE} aria-hidden />
                {shown ? 'Change artwork' : 'Add artwork'}
              </button>
              <button type="button" className="btn" data-sfx="back" disabled={!shown} onClick={() => setCover(null)}>
                <ImageOff strokeWidth={ICON_STROKE} aria-hidden />
                Remove artwork
              </button>
            </div>
          </div>

          <label className="meta-field">
            <span className="label">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} spellCheck={false} data-autofocus />
          </label>
          <label className="meta-field">
            <span className="label">Artist</span>
            <input value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={300} spellCheck={false} />
          </label>
          <label className="meta-field">
            <span className="label">Album</span>
            <input value={album} onChange={(e) => setAlbum(e.target.value)} maxLength={300} spellCheck={false} placeholder="None" />
          </label>

          <p className="hint">Saved in the game&rsquo;s copy of the song. Your original audio file stays as it is.</p>
          {error && <p className="error">{error}</p>}

          <div className="sheet-actions">
            <button type="button" className="btn" data-sfx="back" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy || !title.trim()}>
              <Save strokeWidth={ICON_STROKE} aria-hidden />
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>

          <input
            ref={picker}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void pick(f);
            }}
          />
        </form>
      )}
    </Dialog>
  );
}
