import { useEffect, useRef, useState } from 'react';
import { getEngine } from '../audio/engine';
import { holdMenuMusic } from '../audio/menuMusic';
import { useInputMode } from '../input/inputMode';
import { pads, PAUSE_INPUT } from '../input/pads';
import { useActions } from './actions';

const BPM = 100;
const CLICKS = 20;
const LEAD = 4;

function metronome(ctx: BaseAudioContext): AudioBuffer {
  const spb = 60 / BPM;
  const len = Math.ceil((CLICKS + LEAD + 1) * spb * ctx.sampleRate);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let b = 0; b < CLICKS + LEAD; b++) {
    const s0 = Math.floor(b * spb * ctx.sampleRate);
    const f = b < LEAD ? 1500 : 1000;
    for (let i = 0; i < 0.05 * ctx.sampleRate && s0 + i < len; i++) {
      const t = i / ctx.sampleRate;
      d[s0 + i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 60) * 0.8;
    }
  }
  return buf;
}

/** Tap along to a click track; the median tap error becomes the audio offset. */
export function Calibration({ onDone }: { onDone(offsetMs: number | null): void }) {
  const [taps, setTaps] = useState<number[]>([]);
  const [beat, setBeat] = useState(-LEAD);
  const tapsRef = useRef<number[]>([]);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const tapRef = useRef<(timeStamp: number) => void>(() => {});

  useEffect(() => {
    const engine = getEngine();
    const releaseMusic = holdMenuMusic();
    const spb = 60 / BPM;
    const prevOffset = engine.offset;
    engine.offset = 0;
    engine.load(metronome(engine.ctx));
    void engine.play(0, 0.1);
    let raf = 0;
    const finish = (ok: boolean) => {
      cancelAnimationFrame(raf);
      engine.stop();
      engine.offset = prevOffset;
      const t = [...tapsRef.current].sort((a, b) => a - b);
      doneRef.current(ok && t.length >= 6 ? Math.round(t[Math.floor(t.length / 2)] * 1000) : null);
    };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = engine.time();
      setBeat(Math.floor(now / spb) - LEAD);
      if (now > (CLICKS + LEAD) * spb + 0.3) finish(true);
    };
    loop();
    const tap = (timeStamp: number) => {
      const t = engine.time(timeStamp);
      const idx = Math.round(t / spb);
      if (idx < LEAD || idx >= CLICKS + LEAD) return;
      const err = t - idx * spb;
      if (Math.abs(err) > 0.25) return;
      tapsRef.current.push(err);
      setTaps([...tapsRef.current]);
    };
    tapRef.current = tap;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        return finish(false);
      }
      if (e.repeat) return;
      e.preventDefault();
      tap(e.timeStamp);
    };
    const releasePad = pads.capture((e) => {
      if (!e.down) return true;
      if (e.input === PAUSE_INPUT) finish(false);
      else tap(e.t);
      return true;
    });
    window.addEventListener('keydown', onKey, true);
    return () => {
      releasePad();
      releaseMusic();
      window.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(raf);
      engine.stop();
      engine.offset = prevOffset;
    };
  }, []);

  const sorted = [...taps].sort((a, b) => a - b);
  const median = sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)] * 1000) : null;
  const mode = useInputMode();
  const how =
    mode === 'touch'
      ? 'Tap the pad exactly on each click.'
      : mode === 'pad'
        ? 'Press any button exactly on each click.'
        : 'Press any key exactly on each click, or click the pad.';
  // No bar actions while the clicks run: every key and button is a tap.
  useActions([]);
  return (
    <div className="overlay card" data-modal>
      <div className="dialog calib-card" role="dialog" aria-modal="true" aria-label="Calibration">
        <h2 className="display">Calibrate</h2>
        <p className="calib-how" role="status">
          {beat < 0 ? `Get ready… ${-beat}` : how}
        </p>
        <button
          type="button"
          className={`calib-pad ${beat >= 0 && beat % 2 === 0 ? 'on' : ''}`}
          data-sfx="none"
          data-ring="none"
          tabIndex={-1}
          aria-label="Tap here on each click"
          onPointerDown={(e) => tapRef.current(e.timeStamp)}
        >
          <span className="calib-dot" />
        </button>
        <p className="calib-count num">
          {taps.length} of {CLICKS} taps{median !== null ? ` · ${median} ms` : ''}
        </p>
        <button type="button" className="btn wide" data-sfx="back" onPointerDown={(e) => e.stopPropagation()} onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
