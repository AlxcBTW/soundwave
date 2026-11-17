import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, keyLabel, type RumbleLevel, type Settings } from '../game/settings';
import { PadGlyph, STYLE_LABEL } from '../input/glyphs';
import { TAB_EVENT } from '../input/menuNav';
import { PAUSE_INPUT, pads, styleFor, SYSTEM_INPUT, type GlyphStyle } from '../input/pads';
import { dualSenseHaptics, Rumbler } from '../input/rumble';
import { usePads } from '../input/usePads';
import { Calibration } from './Calibration';

interface Props {
  settings: Settings;
  mlStatus: 'off' | 'checking' | 'online' | 'offline';
  onChange(s: Settings): void;
  onBack(): void;
}

type Tab = 'general' | 'keyboard' | 'controller' | 'analysis';
const TABS: [Tab, string][] = [
  ['general', 'General'],
  ['keyboard', 'Keyboard'],
  ['controller', 'Controller'],
  ['analysis', 'Analysis'],
];
const TAB_KEY = 'festival.settings-tab';

type KeyGroup = 'keys4' | 'keys5' | 'overdriveKey';
type PadGroup = 'pad4' | 'pad5' | 'padOverdrive';
type Binding = { kind: 'key'; group: KeyGroup; index: number } | { kind: 'pad'; group: PadGroup; index: number };

const RESERVED = new Set(['Escape', 'Enter', 'Tab']);
const GLYPH_CHOICES: ('auto' | GlyphStyle)[] = ['auto', 'xbox', 'ps4', 'ps5', 'switch'];

const KEYBOARD_FIELDS = ['keys4', 'keys5', 'overdriveKey'] as const;
const CONTROLLER_FIELDS = ['pad4', 'pad5', 'padOverdrive', 'glyphs', 'rumble', 'rumbleHits', 'rumbleMisses', 'rumbleSustains', 'rumbleOverdrive'] as const;
const RUMBLE_LEVELS: [RumbleLevel, string][] = [
  ['off', 'Off'],
  ['weak', 'Weak'],
  ['strong', 'Strong'],
];
const GENERAL_FIELDS = ['noteSpeed', 'volume', 'offsetMs'] as const;
const ANALYSIS_FIELDS = ['mlEnabled', 'mlUrl'] as const;
const FIELDS: Record<Tab, readonly (keyof Settings)[]> = { general: GENERAL_FIELDS, keyboard: KEYBOARD_FIELDS, controller: CONTROLLER_FIELDS, analysis: ANALYSIS_FIELDS };

function loadTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (TABS.some(([id]) => id === t)) return t as Tab;
  } catch {
    /* storage unavailable */
  }
  return 'general';
}

/** Swaps when the input is already used in the same layout, so every lane keeps one input. */
function assign(list: string[], index: number, input: string): string[] {
  const out = [...list];
  const existing = out.indexOf(input);
  if (existing >= 0) out[existing] = out[index];
  out[index] = input;
  return out;
}

export function SettingsScreen({ settings, mlStatus, onChange, onBack }: Props) {
  const [tab, setTabState] = useState<Tab>(loadTab);
  const [binding, setBinding] = useState<Binding | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const setTab = (t: Tab) => {
    setTabState(t);
    setBinding(null);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  };

  // Controller shoulder buttons switch tabs.
  useEffect(() => {
    const step = (d: number) => setTabState((cur) => {
      const i = (TABS.findIndex(([id]) => id === cur) + d + TABS.length) % TABS.length;
      try {
        localStorage.setItem(TAB_KEY, TABS[i][0]);
      } catch {
        /* ignore */
      }
      return TABS[i][0];
    });
    const onPad = (e: Event) => step((e as CustomEvent<number>).detail);
    window.addEventListener(TAB_EVENT, onPad);
    return () => window.removeEventListener(TAB_EVENT, onPad);
  }, []);

  // Keyboard: Esc goes back, or cancels a binding prompt; a key press completes a key binding.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (calibrating) return;
      if (!binding) {
        if (e.code === 'Escape') onBack();
        return;
      }
      e.preventDefault();
      if (e.code === 'Escape') return setBinding(null);
      if (binding.kind !== 'key' || RESERVED.has(e.code)) return;
      const s = settingsRef.current;
      if (binding.group === 'overdriveKey') onChange({ ...s, overdriveKey: e.code });
      else onChange({ ...s, [binding.group]: assign(s[binding.group], binding.index, e.code) });
      setBinding(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [binding, calibrating, onBack, onChange]);

  // Controller binding prompt: the next input pressed after everything was let go.
  useEffect(() => {
    if (binding?.kind !== 'pad') return;
    let armed = !pads.anyHeld();
    return pads.capture((e) => {
      if (!e.down) {
        if (!pads.anyHeld()) armed = true;
        return true;
      }
      if (e.input === PAUSE_INPUT) {
        setBinding(null);
        return true;
      }
      if (!armed || e.input === SYSTEM_INPUT) return true;
      const s = settingsRef.current;
      if (binding.group === 'padOverdrive') onChange({ ...s, padOverdrive: e.input });
      else onChange({ ...s, [binding.group]: assign(s[binding.group], binding.index, e.input) });
      setBinding(null);
      return true;
    });
  }, [binding, onChange]);

  const resetTab = () => {
    const patch: Partial<Settings> = {};
    for (const f of FIELDS[tab]) (patch as Record<string, unknown>)[f] = structuredClone(DEFAULT_SETTINGS[f]);
    set(patch);
  };

  return (
    <div className="detail">
      <header className="topbar">
        <button className="btn ghost" onClick={onBack}>← Back</button>
        <h2>Settings</h2>
        <span />
      </header>
      <div className="settings panel left">
        <TabBar tab={tab} onTab={setTab} />
        {tab === 'general' && <GeneralTab settings={settings} set={set} onCalibrate={() => setCalibrating(true)} />}
        {tab === 'keyboard' && <KeyboardTab settings={settings} binding={binding} onBind={setBinding} />}
        {tab === 'controller' && <ControllerTab settings={settings} set={set} binding={binding} onBind={setBinding} />}
        {tab === 'analysis' && <AnalysisTab settings={settings} set={set} mlStatus={mlStatus} />}
        <div className="row left settings-footer">
          <button className="btn ghost small" onClick={resetTab}>Reset {TABS.find(([id]) => id === tab)![1].toLowerCase()} settings</button>
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

function TabBar({ tab, onTab }: { tab: Tab; onTab(t: Tab): void }) {
  const snap = usePads();
  const style = styleFor(snap.family);
  const showPad = snap.pads.length > 0;
  return (
    <div className="tabs" role="tablist">
      {showPad && <PadGlyph input="b4" style={style} className="tab-hint" />}
      {TABS.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => onTab(id)}>
          {label}
        </button>
      ))}
      {showPad && <PadGlyph input="b5" style={style} className="tab-hint" />}
    </div>
  );
}

type SetFn = (p: Partial<Settings>) => void;

function GeneralTab({ settings, set, onCalibrate }: { settings: Settings; set: SetFn; onCalibrate(): void }) {
  return (
    <>
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
        <button className="btn small" onClick={onCalibrate}>Calibrate by tapping</button>
        <span className="hint">If notes feel late, raise the offset. If they feel early, lower it.</span>
      </div>
    </>
  );
}

function KeyboardTab({ settings, binding, onBind }: { settings: Settings; binding: Binding | null; onBind(b: Binding): void }) {
  const keyButton = (group: KeyGroup, index: number, code: string, lane?: number) => {
    const active = binding?.kind === 'key' && binding.group === group && binding.index === index;
    return (
      <button key={`${group}${index}`} className={`keycap ${lane !== undefined ? `lane-${lane}` : ''} ${active ? 'listening' : ''}`} onClick={() => onBind({ kind: 'key', group, index })}>
        {active ? '…' : keyLabel(code)}
      </button>
    );
  };
  return (
    <>
      <div className="section-label">Easy, Medium, Hard (4 lanes)</div>
      <div className="row left">{settings.keys4.map((k, i) => keyButton('keys4', i, k, i))}</div>
      <div className="section-label">Expert (5 lanes)</div>
      <div className="row left">{settings.keys5.map((k, i) => keyButton('keys5', i, k, i))}</div>
      <div className="section-label">Overdrive</div>
      <div className="row left">{keyButton('overdriveKey', 0, settings.overdriveKey)}</div>
      <p className="hint">{binding?.kind === 'key' ? 'Press a key to bind it. Esc cancels.' : 'Select a key to change it. Esc pauses during a song.'}</p>
    </>
  );
}

function Check({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="check" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

function ControllerTab({ settings, set, binding, onBind }: { settings: Settings; set: SetFn; binding: Binding | null; onBind(b: Binding): void }) {
  const snap = usePads();
  const detected = styleFor(snap.family);
  const style = settings.glyphs === 'auto' ? detected : settings.glyphs;
  // A PS5 controller gets 3D haptics when the desktop app can reach it (USB); say which it is.
  const ps5 = snap.pads.some((p) => p.family === 'ps5');
  const [haptics, setHaptics] = useState<boolean | null>(null);
  useEffect(() => {
    if (!ps5) return setHaptics(null);
    let live = true;
    const check = () => void dualSenseHaptics().then((ok) => live && setHaptics(ok));
    check();
    const timer = setInterval(check, 4000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [ps5]);

  const padButton = (group: PadGroup, index: number, input: string, lane?: number) => {
    const active = binding?.kind === 'pad' && binding.group === group && binding.index === index;
    return (
      <button key={`${group}${index}`} className={`keycap pad ${lane !== undefined ? `lane-${lane}` : ''} ${active ? 'listening' : ''}`} onClick={() => onBind({ kind: 'pad', group, index })}>
        {active ? '…' : <PadGlyph input={input} style={style} />}
      </button>
    );
  };

  const testRumble = (lanes: number) => {
    const r = new Rumbler(settings, lanes, settings.pad5);
    void r.test().then(() => setTimeout(() => r.dispose(), lanes * 160 + 600));
  };

  return (
    <>
      <div className="section-label">Connected</div>
      {snap.pads.length ? (
        <ul className="pad-list">
          {snap.pads.map((p) => (
            <li key={p.index}>
              <span className="pad-name">{p.name}</span>
              <span className="pill">{p.family === 'generic' ? 'Other controller' : STYLE_LABEL[styleFor(p.family)]}</span>
              {!p.standard && <span className="hint">Unusual button layout: bind its buttons below.</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">No controller found. Connect one and press any button on it.</p>
      )}

      <div className="section-label">Button glyphs</div>
      <div className="seg small wrap">
        {GLYPH_CHOICES.map((g) => (
          <button key={g} className={`seg-btn ${settings.glyphs === g ? 'on' : ''}`} onClick={() => set({ glyphs: g })}>
            {g === 'auto' ? `Auto (${STYLE_LABEL[detected]})` : STYLE_LABEL[g]}
          </button>
        ))}
      </div>
      <div className="glyph-preview">
        {['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b12', 'b8', 'b9'].map((b) => <PadGlyph key={b} input={b} style={style} />)}
      </div>

      <div className="section-label">Easy, Medium, Hard (4 lanes)</div>
      <div className="row left">{settings.pad4.map((b, i) => padButton('pad4', i, b, i))}</div>
      <div className="section-label">Expert (5 lanes)</div>
      <div className="row left">{settings.pad5.map((b, i) => padButton('pad5', i, b, i))}</div>
      <div className="section-label">Overdrive · Pause</div>
      <div className="row left">
        {padButton('padOverdrive', 0, settings.padOverdrive)}
        <span className="keycap pad fixed" title="Pause is always this button">
          <PadGlyph input={PAUSE_INPUT} style={style} />
        </span>
      </div>
      <p className="hint">
        {binding?.kind === 'pad'
          ? 'Press a button, trigger or stick direction to bind it. The pause button or Esc cancels.'
          : 'Select a button to change it. Buttons, triggers and stick directions can all be bound.'}
      </p>

      <div className="section-label">Rumble</div>
      <div className="seg small">
        {RUMBLE_LEVELS.map(([level, label]) => (
          <button key={level} className={`seg-btn ${settings.rumble === level ? 'on' : ''}`} onClick={() => set({ rumble: level })}>
            {label}
          </button>
        ))}
      </div>
      <div className="check-row">
        <Check id="rumble-hits" label="Hits" checked={settings.rumbleHits} onChange={(v) => set({ rumbleHits: v })} />
        <Check id="rumble-misses" label="Misses" checked={settings.rumbleMisses} onChange={(v) => set({ rumbleMisses: v })} />
        <Check id="rumble-sustains" label="Held notes" checked={settings.rumbleSustains} onChange={(v) => set({ rumbleSustains: v })} />
        <Check id="rumble-od" label="Overdrive" checked={settings.rumbleOverdrive} onChange={(v) => set({ rumbleOverdrive: v })} />
      </div>
      {ps5 && (
        <p className="hint">
          {haptics === null
            ? 'Checking the PS5 controller…'
            : haptics
              ? 'PS5 controller: 3D haptics on. Hits play on the left or right motor, following the lane, with a different feel for hits, misses, held notes and overdrive.'
              : '__TAURI_INTERNALS__' in window
                ? 'PS5 controller: connect it with a USB cable for 3D haptics. Over Bluetooth it uses standard rumble.'
                : 'PS5 controller: 3D haptics work in the desktop app with a USB cable. Here it uses standard rumble.'}
        </p>
      )}
      <div className="row left">
        <button className="btn small" disabled={!snap.pads.length || settings.rumble === 'off'} onClick={() => testRumble(5)}>Test rumble</button>
      </div>
    </>
  );
}

function AnalysisTab({ settings, set, mlStatus }: { settings: Settings; set: SetFn; mlStatus: Props['mlStatus'] }) {
  return (
    <>
      <div className="section-label">Analysis service (optional)</div>
      <div className="setting">
        <label htmlFor="ml">
          <input id="ml" type="checkbox" checked={settings.mlEnabled} onChange={(e) => set({ mlEnabled: e.target.checked })} /> Use local ML analyzer
        </label>
        <input className="text" value={settings.mlUrl} onChange={(e) => set({ mlUrl: e.target.value.trim() })} spellCheck={false} />
        <span className={`pill ${mlStatus === 'online' ? 'ready' : mlStatus === 'offline' ? 'error' : ''}`}>{mlStatus}</span>
      </div>
      <p className="hint">With the service running, new analyses use stem separation for more accurate charts. Without it, analysis runs in the app.</p>
    </>
  );
}
