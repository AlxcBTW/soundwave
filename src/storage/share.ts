/**
 * Getting .festival files in and out: saving a song's file to disk to share it, and, in the desktop
 * app, the files the system opens the game with (a song file double-clicked in Explorer).
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { inDesktopApp } from '../game/displayMode';
import { FESTIVAL_EXT, FESTIVAL_MIME } from './festivalFile';

/** Asks where to save a song file and writes it. False when the player cancelled. */
export async function saveSongFile(file: Blob, name: string): Promise<boolean> {
  if (inDesktopApp()) {
    // The app's own command shows the system's save dialog and writes the file there.
    const saved = await invoke<string | null>('save_song_file', new Uint8Array(await file.arrayBuffer()), {
      headers: { 'x-file-name': encodeURIComponent(name) },
    });
    return saved !== null;
  }
  const picker = (window as { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (picker) {
    let handle: FileSystemFileHandle;
    try {
      handle = await picker({ suggestedName: name, types: [{ description: 'Festival song', accept: { [FESTIVAL_MIME]: [FESTIVAL_EXT] } }] });
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return false;
      throw e;
    }
    const out = await handle.createWritable();
    await out.write(file);
    await out.close();
    return true;
  }
  // Browsers without a save dialog download it.
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

interface OpenedFile {
  id: number;
  name: string;
}

let handler: ((files: File[]) => void) | null = null;
/** Files read while nothing was listening, handed over when something does. */
let waiting: File[] = [];
let queue: Promise<void> = Promise.resolve();
let listening = false;

function deliver(files: File[]) {
  if (!files.length) return;
  if (handler) handler(files);
  else waiting.push(...files);
}

/** Reads the files the app has been asked to open and not yet handed over. */
function take() {
  queue = queue.then(async () => {
    const opened = await invoke<OpenedFile[]>('take_opened_files').catch(() => [] as OpenedFile[]);
    const files: File[] = [];
    for (const f of opened) {
      try {
        const bytes = await invoke<ArrayBuffer>('read_opened_file', { id: f.id });
        files.push(new File([bytes], f.name, { type: FESTIVAL_MIME }));
      } catch (e) {
        console.warn(`could not read ${f.name}`, e);
      }
    }
    deliver(files);
  });
}

/**
 * Hands every song file the system opens the desktop app with to `onFiles`: the ones it was started
 * with, and any opened while it runs (the app stays one window; a second launch passes its files
 * on to this one). Returns a function that stops handing them over.
 */
export function watchOpenedFiles(onFiles: (files: File[]) => void): () => void {
  if (!inDesktopApp()) return () => {};
  handler = onFiles;
  if (waiting.length) {
    const files = waiting;
    waiting = [];
    onFiles(files);
  }
  if (!listening) {
    listening = true;
    // Listen first, then take what is already waiting: a file that arrives in between is still taken.
    void listen('festival://opened', take).then(take, take);
  }
  return () => {
    if (handler === onFiles) handler = null;
  };
}
