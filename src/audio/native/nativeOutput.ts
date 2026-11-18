/**
 * The desktop app plays the game's sound itself, not the webview (src-tauri/src/audio_out.rs). All of
 * the sound is still made with Web Audio; here the finished mix (everything that reaches the
 * engine's master gain) is taken off the end of the graph and streamed to the app:
 *
 *     master → AudioWorklet "tap" → shared ring buffer → pump worker → http://swaudio.localhost/push
 *
 * The AudioContext itself plays to no device (`setSinkId({ type: 'none' })`), so nothing is heard
 * twice and the webview's helper process makes no sound at all: the sound comes from the game's own
 * process, where the system's volume mixer, per-app output routing and window capture find it.
 *
 * The worklet and the worker never wait on the main thread, so a busy frame cannot make the sound
 * stutter. Each push is answered with how long until it is heard; that keeps the game's clock on
 * what the player hears (AudioEngine.time).
 */
import { invoke } from '@tauri-apps/api/core';
import { CTRL, META } from './layout';

/** Seconds of sound the shared ring holds between the worklet and the worker. */
const RING_S = 0.5;
const PUSH_URL = 'http://swaudio.localhost/push';

/** The worklet: copies each block of the mix into the ring, and plays silence. */
const TAP_SOURCE = `
class SoundwaveTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.ring = new Float32Array(o.ring);
    this.ctrl = new Int32Array(o.ctrl);
    this.meta = new Float64Array(o.meta);
    this.cap = this.ring.length / 2;
  }
  process(inputs) {
    const input = inputs[0];
    const n = input && input.length ? input[0].length : 128;
    const w = Atomics.load(this.ctrl, ${CTRL.written});
    const r = Atomics.load(this.ctrl, ${CTRL.read});
    // A full ring (the worker has stalled) drops this block rather than overwrite what is unread.
    if (((w - r) | 0) + n > this.cap) return true;
    const left = input && input[0];
    const right = input && (input[1] || input[0]);
    for (let i = 0; i < n; i++) {
      const k = (((w + i) >>> 0) % this.cap) * 2;
      this.ring[k] = left ? left[i] : 0;
      this.ring[k + 1] = right ? right[i] : 0;
    }
    const end = (w + n) | 0;
    this.meta[${META.frameEnd}] = currentFrame + n;
    this.meta[${META.writtenAt}] = end;
    Atomics.store(this.ctrl, ${CTRL.written}, end);
    return true;
  }
}
registerProcessor('soundwave-tap', SoundwaveTap);
`;

export interface NativeOutput {
  /** The context time being heard at `perfNow` (a performance.now() time), or null while unknown. */
  heard(perfNow: number): number | null;
}

/** Whether the sound goes through the app (set once the start below has settled). */
let active = false;
let settled: Promise<boolean> | null = null;

/** Resolves to whether the game's sound plays through the app (false in a browser, or if that failed). */
export const whenNative = (): Promise<boolean> => settled ?? Promise.resolve(false);
export const isNative = () => active;

/**
 * Starts playing the mix that reaches `master` through the app. Resolves to the timing source the
 * engine needs, or null where it cannot (then the caller plays through the webview as before).
 * `onFail` is called should the app stop taking the sound later on.
 */
export function startNativeOutput(ctx: AudioContext, master: AudioNode, onFail: () => void): Promise<NativeOutput | null> {
  const run = async (): Promise<NativeOutput | null> => {
    if (!crossOriginIsolated || !ctx.audioWorklet || typeof SharedArrayBuffer === 'undefined') return null;
    const rate = ctx.sampleRate;
    const cap = Math.round(rate * RING_S);
    const ring = new SharedArrayBuffer(cap * 2 * Float32Array.BYTES_PER_ELEMENT);
    const ctrl = new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT);
    const meta = new SharedArrayBuffer(4 * Float64Array.BYTES_PER_ELEMENT);
    const url = URL.createObjectURL(new Blob([TAP_SOURCE], { type: 'text/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    // The app must answer before the webview lets go of the sound.
    const probe = await fetch(`${PUSH_URL}?rate=${rate}`, {
      method: 'POST',
      body: new Float32Array(0),
      headers: { 'Content-Type': 'text/plain' },
    });
    if (!probe.ok) return null;

    const tap = new AudioWorkletNode(ctx, 'soundwave-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      processorOptions: { ring, ctrl, meta },
    });
    // The tap is pulled by the destination (it plays silence there), and the context plays to no device.
    master.connect(tap);
    tap.connect(ctx.destination);
    const sink = ctx as AudioContext & { setSinkId?(id: string | { type: 'none' }): Promise<void> };
    await sink.setSinkId?.({ type: 'none' }).catch(() => {});

    const worker = new Worker(new URL('./pump.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<string>) => {
      if (e.data !== 'failed') return;
      // The app no longer takes the sound: back to the webview's output.
      active = false;
      worker.terminate();
      master.disconnect(tap);
      tap.disconnect();
      onFail();
    };
    worker.postMessage({ ring, ctrl, meta, rate, url: PUSH_URL });

    const m = new Float64Array(meta);
    return {
      heard(perfNow) {
        const stamp = m[META.heardStamp];
        if (!stamp) return null;
        const age = (performance.timeOrigin + perfNow - stamp) / 1000;
        // A measure more than half a second old is not trusted (the worker is stalled).
        if (age < -0.05 || age > 0.5) return null;
        return m[META.heardFrame] / rate + age;
      },
    };
  };
  const result = run().catch((err: unknown) => {
    console.warn('Playing through the app failed; the webview plays the sound.', err);
    return null;
  });
  settled = result.then((out) => (active = !!out));
  return result;
}

/** The outputs the app can play through, by name, and the system default's name. */
export const nativeDevices = () => invoke<{ devices: string[]; default: string }>('audio_devices');

/** Plays through the output with this name ('' = the system default). Resolves to whether it is connected. */
export const setNativeDevice = (name: string) => invoke<boolean>('audio_set_device', { name });
