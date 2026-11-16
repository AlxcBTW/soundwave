import { useCallback, useMemo, useRef, useState } from 'react';

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
      setItems((t) => [...t.slice(-3), { id, text }]);
      setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );
  return useMemo(() => ({ items, push, dismiss }), [items, push, dismiss]);
}

export function Toasts({ items, onDismiss }: { items: Toast[]; onDismiss(id: number): void }) {
  return (
    <div className="toasts" role="status">
      {items.map((t) => (
        <button key={t.id} className="toast" onClick={() => onDismiss(t.id)}>{t.text}</button>
      ))}
    </div>
  );
}
