import { Circle, Info, ListMinus, ListPlus, PencilRuler, RotateCcw, Share, Trash2, X, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SET_MAX } from '../game/setlist';
import { getInputMode, usesFocus } from '../input/inputMode';
import { focusables } from '../input/menuNav';
import type { SongMeta } from '../storage/db';
import { CONFIRM_HINT, useActions } from './actions';
import { Dialog, useExit } from './Dialog';
import { ICON_STROKE } from './icons';
import type { SongStatus } from './LibraryScreen';

/** What can be done with songs, from their detail sheet or their menu. */
export interface SongActions {
  details(song: SongMeta): void;
  addToSet(songs: SongMeta[]): void;
  removeFromSet(songs: SongMeta[]): void;
  analyze(songs: SongMeta[]): void;
  edit(song: SongMeta): void;
  exportSong(song: SongMeta): void;
  remove(songs: SongMeta[]): Promise<void>;
}

interface Item {
  id: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  danger?: boolean;
  run(): void;
}

interface Props {
  /** The songs it is for: one, or every song selected. */
  songs: SongMeta[];
  status: Record<string, SongStatus>;
  setlist: string[];
  /** Where it opens: the pointer, or beside the song for keys and controllers. */
  at: { x: number; y: number };
  actions: SongActions;
  onClose(): void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * A song's menu (right-click, a long press, or the Options button): what its detail sheet offers,
 * at hand. For several selected songs it offers what makes sense for all of them at once.
 */
export function SongMenu({ songs, status, setlist, at, actions, onClose }: Props) {
  const [confirm, setConfirm] = useState(false);
  const [leaving, close] = useExit(onClose);
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  const one = songs.length === 1 ? songs[0] : null;
  const st = (s: SongMeta) => status[s.id] ?? { state: 'idle' as const };
  const ready = songs.filter((s) => st(s).state === 'ready');
  const inSet = songs.filter((s) => setlist.includes(s.id));
  const busy = (s: SongMeta) => st(s).state === 'analyzing' || st(s).state === 'queued';
  const room = SET_MAX - setlist.length;
  const addable = ready.filter((s) => !setlist.includes(s.id));
  const analyzable = songs.filter((s) => !busy(s));

  // Every item closes the menu as it runs, except Remove, which asks first.
  const item = (i: Item): Item => ({ ...i, run: i.id === 'remove' ? i.run : () => (close(), i.run()) });
  const items: Item[] = one
    ? [
        { id: 'details', label: 'Song details', icon: Info, run: () => actions.details(one) },
        inSet.length
          ? { id: 'set', label: 'Remove from setlist', icon: ListMinus, run: () => actions.removeFromSet(songs) }
          : {
              id: 'set',
              label: room <= 0 ? 'Setlist is full' : 'Add to setlist',
              icon: ListPlus,
              disabled: !ready.length || room <= 0,
              run: () => actions.addToSet(songs),
            },
        ...(busy(one)
          ? []
          : [
              {
                id: 'analyze',
                label: st(one).state === 'ready' && !st(one).manual ? 'Analyze again' : 'Analyze',
                icon: RotateCcw,
                run: () => actions.analyze(songs),
              },
            ]),
        { id: 'edit', label: 'Edit charts', icon: PencilRuler, disabled: st(one).state !== 'ready', run: () => actions.edit(one) },
        { id: 'export', label: 'Export', icon: Share, run: () => actions.exportSong(one) },
        { id: 'remove', label: 'Remove…', icon: Trash2, danger: true, run: () => setConfirm(true) },
      ].map(item)
    : [
        ...(addable.length || !inSet.length
          ? [
              {
                id: 'add',
                label:
                  room <= 0 ? 'Setlist is full' : addable.length ? `Add ${Math.min(room, addable.length)} to setlist` : 'Add to setlist',
                icon: ListPlus,
                disabled: !addable.length || room <= 0,
                run: () => actions.addToSet(addable.slice(0, Math.max(0, room))),
              },
            ]
          : []),
        ...(inSet.length
          ? [{ id: 'unset', label: `Remove ${inSet.length} from setlist`, icon: ListMinus, run: () => actions.removeFromSet(inSet) }]
          : []),
        ...(analyzable.length
          ? [
              {
                id: 'analyze',
                label: `Analyze ${plural(analyzable.length, 'song')}${analyzable.every((x) => st(x).state === 'ready' && !st(x).manual) ? ' again' : ''}`,
                icon: RotateCcw,
                run: () => actions.analyze(analyzable),
              },
            ]
          : []),
        { id: 'remove', label: `Remove ${plural(songs.length, 'song')}…`, icon: Trash2, danger: true, run: () => setConfirm(true) },
      ].map(item);

  useActions(
    confirm
      ? []
      : [
          { id: CONFIRM_HINT, label: 'Choose', icon: Circle, bar: false, run: () => {} },
          { id: 'close', label: 'Close', icon: X, kbd: 'Escape', sfx: 'back', run: close },
        ],
  );

  // Placed at the pointer, kept on screen (measured before it is first painted).
  useLayoutEffect(() => {
    const menu = ref.current?.querySelector<HTMLElement>('.ctx-menu');
    if (!menu) return;
    const r = menu.getBoundingClientRect();
    const margin = 8;
    setPlace({
      left: Math.max(margin, Math.min(at.x, innerWidth - r.width - margin)),
      top: Math.max(margin, Math.min(at.y, innerHeight - r.height - margin)),
    });
  }, [at.x, at.y, confirm]);

  // Focus moves in (the first item for keys and controllers), stays in, and goes back where it was.
  useEffect(() => {
    if (confirm) return;
    const before = document.activeElement as HTMLElement | null;
    const box = ref.current!;
    const first = usesFocus(getInputMode()) ? focusables(box)[0] : undefined;
    (first ?? box.querySelector<HTMLElement>('.ctx-menu')!).focus({ preventScroll: true });
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const all = focusables(box);
      if (!all.length) return e.preventDefault();
      const i = all.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      all[e.shiftKey ? (i <= 0 ? all.length - 1 : i - 1) : i === all.length - 1 ? 0 : i + 1].focus();
    };
    box.addEventListener('keydown', trap);
    return () => {
      box.removeEventListener('keydown', trap);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [confirm]);

  if (confirm)
    return (
      <Dialog
        title={one ? `Remove ${one.title}` : `Remove ${plural(songs.length, 'song')}`}
        variant="card"
        closeLabel="Keep"
        onClose={onClose}
      >
        {(keep) => (
          <div className="pause-card">
            <h2 className="display">{one ? 'Remove this song?' : `Remove ${plural(songs.length, 'song')}?`}</h2>
            <p className="hint">
              {one ? <b>{one.title}</b> : `These ${songs.length} songs`} {one ? 'leaves' : 'leave'} your library together with{' '}
              {one ? 'its' : 'their'} charts and best scores. This cannot be undone.
            </p>
            <button type="button" className="btn wide" data-autofocus data-sfx="back" onClick={keep}>
              Keep
            </button>
            <button type="button" className="btn danger wide" onClick={() => void actions.remove(songs).finally(onClose)}>
              <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
              {one ? 'Delete song and scores' : `Delete ${plural(songs.length, 'song')} and scores`}
            </button>
          </div>
        )}
      </Dialog>
    );

  return (
    <div
      ref={ref}
      className={`overlay popover ${leaving ? 'leaving' : ''}`}
      data-modal
      onPointerDown={(e) => e.target === e.currentTarget && close()}
      onContextMenu={(e) => {
        // A right-click outside closes this menu (the browser's own never shows).
        e.preventDefault();
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="ctx-menu"
        role="menu"
        aria-label={one ? `${one.title} options` : `${plural(songs.length, 'song')} options`}
        tabIndex={-1}
        data-ring="none"
        style={place ?? { left: at.x, top: at.y }}
      >
        <p className="ctx-title">{one ? one.title : `${plural(songs.length, 'song')} selected`}</p>
        {items.map((i) => (
          <button
            key={i.id}
            type="button"
            role="menuitem"
            className={`ctx-item ${i.danger ? 'danger' : ''}`}
            disabled={i.disabled}
            onClick={i.run}
          >
            <i.icon strokeWidth={ICON_STROKE} aria-hidden />
            {i.label}
          </button>
        ))}
      </div>
    </div>
  );
}
