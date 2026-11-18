/**
 * Where the game's sound goes: which output device it plays through, and whether it is silenced
 * while the window is in the background. Songs, menu music and interface sounds share one
 * AudioContext (see AudioEngine), so both apply to all of them at once.
 */
import { getEngine } from './engine';

export interface OutputDevice {
  id: string;
  label: string;
}

export interface OutputList {
  devices: OutputDevice[];
  /** False while the browser withholds the devices (it lists them only once microphone access is allowed). */
  listed: boolean;
}

type SinkContext = AudioContext & { setSinkId?(id: string): Promise<void>; sinkId?: unknown };

/** Whether this browser can send the game's sound to a chosen device at all. */
export const canPickOutput = () =>
  typeof AudioContext !== 'undefined' &&
  'setSinkId' in AudioContext.prototype &&
  typeof navigator.mediaDevices?.enumerateDevices === 'function';

/** The system's own aliases: "System default" stands for them. */
const ALIASES = new Set(['', 'default', 'communications']);

/** The outputs the browser lets the game see, without the system's default aliases. */
export async function listOutputs(): Promise<OutputList> {
  if (!canPickOutput()) return { devices: [], listed: false };
  try {
    const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
    const devices = all.filter((d) => !ALIASES.has(d.deviceId) && d.label).map((d) => ({ id: d.deviceId, label: d.label }));
    // Without permission the browser reports one nameless placeholder.
    return { devices, listed: all.some((d) => d.label !== '') };
  } catch {
    return { devices: [], listed: false };
  }
}

/**
 * Browsers name and list the outputs only after microphone access has been allowed. This asks for
 * it and closes the microphone again at once: nothing is recorded. Returns whether it was allowed.
 */
export async function allowOutputList(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return true;
  } catch {
    return false;
  }
}

/**
 * Plays through the device with this id ('' = the system's default). A device that is not there
 * (unplugged, or forgotten by the browser) falls back to the default; returns whether `id` is in use.
 */
export async function setOutputDevice(id: string): Promise<boolean> {
  if (!canPickOutput()) return id === '';
  const ctx = getEngine().ctx as SinkContext;
  const current = typeof ctx.sinkId === 'string' ? ctx.sinkId : '';
  if (current === id) return true;
  try {
    await ctx.setSinkId!(id);
    return true;
  } catch {
    if (current !== '') await ctx.setSinkId!('').catch(() => {});
    return false;
  }
}

/**
 * Follows the player's choice as devices come and go: the chosen device while it is connected, the
 * system's default while it is not, and the chosen one again when it returns. Returns the function
 * that stops following.
 */
export function followOutputDevice(id: string): () => void {
  if (!canPickOutput()) return () => {};
  let live = true;
  const apply = async () => {
    if (!id) return void setOutputDevice('');
    const { devices, listed } = await listOutputs();
    if (live) void setOutputDevice(!listed || devices.some((d) => d.id === id) ? id : '');
  };
  void apply();
  navigator.mediaDevices.addEventListener('devicechange', apply);
  return () => {
    live = false;
    navigator.mediaDevices.removeEventListener('devicechange', apply);
  };
}

/**
 * Silences the game while its window is not the focused one, and brings the sound back when it
 * is. Returns the function that stops watching (and unmutes).
 */
export function muteWhileUnfocused(): () => void {
  const engine = getEngine();
  const sync = () => (engine.muted = !document.hasFocus());
  sync();
  window.addEventListener('blur', sync);
  window.addEventListener('focus', sync);
  document.addEventListener('visibilitychange', sync);
  return () => {
    window.removeEventListener('blur', sync);
    window.removeEventListener('focus', sync);
    document.removeEventListener('visibilitychange', sync);
    engine.muted = false;
  };
}
