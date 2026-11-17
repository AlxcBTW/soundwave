import { CircleAlert } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { playSfx } from '../audio/sfx';
import { menuPulse } from '../input/rumble';
import { ICON_STROKE } from './icons';

interface Toast {
  id: number;
  text: string;
}

export function useToasts() {
  const [items, setItems] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (text: string) => {
      const id = next.current++;
      playSfx('error');
      menuPulse('error');
      setItems((t) => [...t.slice(-3), { id, text }]);
      setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );
  return useMemo(() => ({ items, push, dismiss }), [items, push, dismiss]);
}

export function Toasts({ items, onDismiss }: { items: Toast[]; onDismiss(id: number): void }) {
  return (
    <div className="toasts" role="status" data-nav-skip>
      {items.map((t) => (
        <button key={t.id} type="button" className="toast" data-sfx="none" aria-label={`${t.text} Dismiss.`} onClick={() => onDismiss(t.id)}>
          <CircleAlert strokeWidth={ICON_STROKE} aria-hidden />
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}
