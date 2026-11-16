import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, keyLabel, type Settings } from '../game/settings';
import { Calibration } from './Calibration';

interface Props {
  settings: Settings;
  mlStatus: 'off' | 'checking' | 'online' | 'offline';
  onChange(s: Settings): void;
  onBack(): void;
}

type Binding = { group: 'keys4' | 'keys5' | 'overdriveKey'; index: number };

const RESERVED = new Set(['Escape', 'Enter', 'Tab']);

export function SettingsScreen({ settings, mlStatus, onChange, onBack }: Props) {
  const [binding, setBinding] = useState<Binding | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  useEffect(() => {
    if (!binding) {
      const esc = (e: KeyboardEvent) => e.code === 'Escape' && !calibrating && onBack();
      window.addEventListener('keydown', esc);
      return () => window.removeEventListener('keydown', esc);
    }
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code === 'Escape') return setBinding(null);
      if (RESERVED.has(e.code)) return;
      if (binding.group === 'overdriveKey') set({ overdriveKey: e.code });
      else {
        const keys = [...settings[binding.group]];
        // Swap if the key is already used in this layout.
        const existing = keys.indexOf(e.code);
        if (existing >= 0) keys[existing] = keys[binding.index];
        keys[binding.index] = e.code;
        set({ [binding.group]: keys });
      }
      setBinding(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const keyButton = (group: Binding['group'], index: number, code: string, lane?: number) => {
    const active = binding?.group === group && binding.index === index;
    return (
      <button key={`${group}${index}`} className={`keycap ${lane !== undefined ? `lane-${lane}` : ''} ${active ? 'listening' : ''}`} onClick={() => setBinding({ group, index })}>
        {active ? '…' : keyLabel(code)}
      </button>
    );
  };

  return (
    <div className="detail">
      <header className="topbar">
        <button className="btn ghost" onClick={onBack}>← Back</button>
        <h2>Settings</h2>
        <span />
      </header>
      <div className="settings panel left">
        <div className="setting">
          <label htmlFor="speed">Note speed</label>
          <input id="speed" type="range" min={5} max={16} step={0.5} value={settings.noteSpeed} onChange={(e) => set({ noteSpeed: +e.target.value })} />
          <span className="value">{settings.noteSpeed.toFixed(1)}</span>
        </div>
        <div className="setting">
          <label htmlFor="volume">Volume</label>
          <input id="volume" type="range" min={0} max={1} step={0.05} value={settings.volume} onChange={(e) => set({ volume: +e.target.value })} />
          <span className="value">{Math.round(settings.volume * 100)}%</span>
        </div>
        <div className="setting">
          <label htmlFor="offset">Audio offset</label>
          <input id="offset" type="range" min={-200} max={300} step={1} value={settings.offsetMs} onChange={(e) => set({ offsetMs: +e.target.value })} />
          <span className="value">{settings.offsetMs} ms</span>
        </div>
        <div className="setting-actions">
          <button className="btn small" onClick={() => setCalibrating(true)}>Calibrate by tapping</button>
          <span className="hint">If notes feel late, raise the offset. If they feel early, lower it.</span>
        </div>

        <div className="section-label">Keys · Easy, Medium, Hard (4 lanes)</div>
        <div className="row left">{settings.keys4.map((k, i) => keyButton('keys4', i, k, i))}</div>
        <div className="section-label">Keys · Expert (5 lanes)</div>
        <div className="row left">{settings.keys5.map((k, i) => keyButton('keys5', i, k, i))}</div>
        <div className="section-label">Overdrive</div>
        <div className="row left">{keyButton('overdriveKey', 0, settings.overdriveKey)}</div>
        {binding && <p className="hint">Press a key to bind it. Esc cancels.</p>}

        <div className="section-label">Analysis service (optional)</div>
        <div className="setting">
          <label htmlFor="ml">
            <input id="ml" type="checkbox" checked={settings.mlEnabled} onChange={(e) => set({ mlEnabled: e.target.checked })} /> Use local ML analyzer
          </label>
          <input className="text" value={settings.mlUrl} onChange={(e) => set({ mlUrl: e.target.value.trim() })} spellCheck={false} />
          <span className={`pill ${mlStatus === 'online' ? 'ready' : mlStatus === 'offline' ? 'error' : ''}`}>{mlStatus}</span>
        </div>
        <p className="hint">
          With the service running, new analyses use stem separation for more accurate charts. Without it, analysis runs in the app.
        </p>

        <div className="row left">
          <button className="btn ghost" onClick={() => onChange({ ...DEFAULT_SETTINGS })}>Reset to defaults</button>
        </div>
      </div>
      {calibrating && (
        <Calibration
          onDone={(ms) => {
            setCalibrating(false);
            if (ms !== null) set({ offsetMs: ms });
          }}
        />
      )}
    </div>
  );
}
