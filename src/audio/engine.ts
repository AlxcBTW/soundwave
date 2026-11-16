import { AudioEngine } from './AudioEngine';

let engine: AudioEngine | null = null;

/** One AudioContext for the whole app; browsers limit how many can exist. */
export function getEngine(): AudioEngine {
  engine ??= new AudioEngine();
  return engine;
}
