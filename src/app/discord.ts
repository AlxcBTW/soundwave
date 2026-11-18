/**
 * What the player is doing, for their Discord profile (desktop app only; the app talks to Discord,
 * see src-tauri/src/discord.rs). The screens say where the player is (`showScene`); the play screen
 * adds whether the song is paused and how much of it is left (`showSong`). Only changes are sent.
 */
import { invoke } from '@tauri-apps/api/core';
import { inDesktopApp } from '../game/displayMode';

export interface Presence {
  /** The first line: the song, or where in the game the player is. */
  details: string;
  /** The second line. */
  state?: string;
  /** Discord counts up from `start` or down to `end` (ms since the epoch). */
  start?: number;
  end?: number;
}

/** Where the song being played stands: paused, or how many seconds of it are left. */
export interface SongState {
  paused: boolean;
  left: number;
}

/** Time in the menus counts from when the game started. */
const OPENED = Date.now();

let enabled = true;
let scene: Presence | null = null;
let song: SongState | null = null;
let sent: string | undefined;

function update() {
  if (!inDesktopApp()) return;
  let p: Presence | null = null;
  if (enabled && scene) {
    p = { ...scene };
    if (song?.paused) {
      p.state = p.state ? `Paused · ${p.state}` : 'Paused';
    } else if (song) {
      // Whole seconds, so the same moment reported twice is the same status.
      p.end = Math.round((Date.now() + song.left * 1000) / 1000) * 1000;
    } else if (p.start === undefined) {
      p.start = OPENED;
    }
  }
  const json = JSON.stringify(p);
  if (json === sent) return;
  sent = json;
  void invoke('discord_presence', { presence: p }).catch(() => {});
}

/** Shows the status or not (the player's setting). */
export function setDiscordEnabled(on: boolean) {
  enabled = on;
  update();
}

/** Where the player is: a screen, or the song being played. */
export function showScene(p: Presence | null) {
  scene = p;
  update();
}

/** The song being played: paused, or how long is left. `null` once it is left. */
export function showSong(s: SongState | null) {
  song = s;
  update();
}
