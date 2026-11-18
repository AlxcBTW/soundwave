/**
 * The memory the worklet tap, the pump worker and the engine share (see nativeOutput.ts).
 *
 * Control words (Int32): the frames written to the ring and read from it, as counters that wrap, and
 * a flag set when the app stopped taking the sound.
 */
export const CTRL = { written: 0, read: 1, failed: 2 } as const;
/**
 * Timing words (Float64): the context frame just past the newest frame written and the write count
 * it goes with, then the context frame being heard and when that was measured (ms since the epoch,
 * from performance.timeOrigin + now()).
 */
export const META = { frameEnd: 0, writtenAt: 1, heardFrame: 2, heardStamp: 3 } as const;
