/**
 * Moves the game's sound from the shared ring (filled by the AudioWorklet tap, see nativeOutput.ts)
 * to the app, which plays it (src-tauri/src/audio_out.rs). It runs apart from the main thread, so a
 * busy frame in the game never holds the sound up. Each push is answered with how long until its
 * last frame is heard, and that is written back for the game's clock.
 */
import { CTRL, META } from './layout';

interface Init {
  ring: SharedArrayBuffer;
  ctrl: SharedArrayBuffer;
  meta: SharedArrayBuffer;
  rate: number;
  url: string;
}

/** Fewest frames worth a push: smaller gaps wait a moment for more. */
const MIN_FRAMES = 128;
/** After this many failed pushes in a row the app is taken to be gone. */
const MAX_FAILS = 25;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

self.onmessage = (e: MessageEvent<Init>) => void pump(e.data);

async function pump({ ring: ringBuf, ctrl: ctrlBuf, meta: metaBuf, rate, url }: Init) {
  const ring = new Float32Array(ringBuf);
  const ctrl = new Int32Array(ctrlBuf);
  const meta = new Float64Array(metaBuf);
  const cap = ring.length / 2;
  const endpoint = `${url}?rate=${rate}`;
  let fails = 0;
  for (;;) {
    const w = Atomics.load(ctrl, CTRL.written);
    const r = Atomics.load(ctrl, CTRL.read);
    const n = (w - r) | 0;
    if (n < MIN_FRAMES) {
      await sleep(3);
      continue;
    }
    const chunk = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const k = (((r + i) >>> 0) % cap) * 2;
      chunk[i * 2] = ring[k];
      chunk[i * 2 + 1] = ring[k + 1];
    }
    const end = (r + n) | 0;
    Atomics.store(ctrl, CTRL.read, end);
    // The context frame just past the last one sent: the newest write's, less what was written since.
    const frameEnd = meta[META.frameEnd] - ((meta[META.writtenAt] - end) | 0);
    try {
      const res = await fetch(endpoint, { method: 'POST', body: chunk, headers: { 'Content-Type': 'text/plain' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { behind } = (await res.json()) as { behind: number };
      meta[META.heardFrame] = frameEnd - behind * rate;
      meta[META.heardStamp] = performance.timeOrigin + performance.now();
      fails = 0;
    } catch {
      if (++fails >= MAX_FAILS) {
        Atomics.store(ctrl, CTRL.failed, 1);
        self.postMessage('failed');
        return;
      }
      await sleep(40);
    }
  }
}
