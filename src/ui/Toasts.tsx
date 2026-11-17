import { Check, CircleAlert, Download } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { playSfx } from '../audio/sfx';
import { menuPulse } from '../input/rumble';
import { ICON_STROKE } from './icons';

interface Toast {
  id: number;
  text: string;
  /** A notice that is kept up to date under this name instead of being followed by new ones. */
  key?: string;
  kind: 'error' | 'progress' | 'done';
  /** 0..1, for a progress notice. */
  progress?: number;
  /** A short figure beside the bar ("64 of 171 MB"). */
  detail?: string;
}

/** What a notice kept under one name shows now. */
export type Notice =
  | { kind: 'progress'; text: string; progress: number; detail?: string }
  | { kind: 'done'; text: string }
  | { kind: 'error'; text: string };

const STAY_MS = 6000;

export function useToasts() {
  const [items, setItems] = useState<Toast[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, number>());
  /** Progress notices the player put away: they stay away until they have something new to say. */
  const hidden = useRef(new Set<string>());

  const remove = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setItems((t) => t.filter((x) => x.id !== id));
  }, []);
  const leaveAfter = useCallback(
    (id: number) => {
      clearTimeout(timers.current.get(id));
      timers.current.set(id, window.setTimeout(() => remove(id), STAY_MS));
    },
    [remove],
  );
  const dismiss = useCallback(
    (id: number) => {
      setItems((t) => {
        const item = t.find((x) => x.id === id);
        if (item?.key && item.kind === 'progress') hidden.current.add(item.key);
        return t;
      });
      remove(id);
    },
    [remove],
  );

  /** A problem: a new card each time, with the error sound. */
  const push = useCallback(
    (text: string) => {
      const id = next.current++;
      playSfx('error');
      menuPulse('error');
      setItems((t) => [...t.slice(-3), { id, text, kind: 'error' }]);
      leaveAfter(id);
    },
    [leaveAfter],
  );

  /**
   * One card per name, changed in place: a download shows its bar filling in the same card, which
   * then says how it ended. Progress stays until it ends; the end leaves like any other toast.
   */
  const notify = useCallback(
    (key: string, notice: Notice) => {
      if (notice.kind === 'progress' && hidden.current.has(key)) return;
      if (notice.kind !== 'progress') hidden.current.delete(key);
      if (notice.kind === 'error') {
        playSfx('error');
        menuPulse('error');
      }
      setItems((t) => {
        const at = t.findIndex((x) => x.key === key);
        const id = at >= 0 ? t[at].id : next.current++;
        const item: Toast = { id, key, ...notice };
        if (notice.kind === 'progress') clearTimeout(timers.current.get(id));
        else leaveAfter(id);
        return at >= 0 ? t.map((x, i) => (i === at ? item : x)) : [...t.slice(-3), item];
      });
    },
    [leaveAfter],
  );

  return useMemo(() => ({ items, push, notify, dismiss }), [items, push, notify, dismiss]);
}

export function Toasts({ items, onDismiss }: { items: Toast[]; onDismiss(id: number): void }) {
  return (
    <div className="toasts" role="status" data-nav-skip>
      {items.map((t) => {
        const Icon = t.kind === 'progress' ? Download : t.kind === 'done' ? Check : CircleAlert;
        return (
          <button key={t.id} type="button" className={`toast ${t.kind}`} data-sfx="none" aria-label={`${t.text} Dismiss.`} onClick={() => onDismiss(t.id)}>
            <Icon strokeWidth={ICON_STROKE} aria-hidden />
            <span className="toast-body">
              <span>{t.text}</span>
              {t.kind === 'progress' && (
                <span className="toast-progress">
                  <span className="meter" role="progressbar" aria-label={t.text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((t.progress ?? 0) * 100)}>
                    <span style={{ width: `${Math.round((t.progress ?? 0) * 1000) / 10}%` }} />
                  </span>
                  {/* The figure changes many times a second: for the eyes only. */}
                  {t.detail && <span className="toast-detail" aria-hidden>{t.detail}</span>}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
