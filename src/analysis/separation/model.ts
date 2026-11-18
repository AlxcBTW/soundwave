import { openDB, type IDBPDatabase } from 'idb';

/**
 * The stem-separation model: where it is downloaded from, and the copy kept on this device.
 *
 * It is Demucs "htdemucs" (Défossez, Rouard, Massa; Meta). The game does not ship it: it is fetched
 * once, checked against the hashes below and kept in the browser's storage.
 */
export interface ModelFile {
  name: string;
  url: string;
  bytes: number;
  sha256: string;
}
export interface ModelSource {
  id: string;
  /** The graph; any other files are weight data it refers to by name. */
  entry: string;
  files: ModelFile[];
}

/**
 * The file this repository holds (models/htdemucs/htdemucs-v1.onnx, made by
 * tools/analysis/export_stem_model.py): half the size of the copy below, same numbers.
 * The download moves here once the repository can be read without signing in.
 */
export const REPO_MODEL: ModelSource = {
  id: 'htdemucs-v1',
  entry: 'htdemucs-v1.onnx',
  files: [
    {
      name: 'htdemucs-v1.onnx',
      url: 'https://raw.githubusercontent.com/DavidNiessen/soundwave/main/models/htdemucs/htdemucs-v1.onnx',
      bytes: 90415579,
      sha256: 'fee1c4f070dc290f3ce65c16cd0927279b5e23159d01bfb6c8a8a13bd734f276',
    },
  ],
};

/** Until then: the same model as Intel publishes it for its Audacity plugins, at a fixed revision. */
const INTEL = 'https://huggingface.co/Intel/demucs-openvino/resolve/efb3d2bc54f93899b13b72b12c57001e19f09ae2/htdemucs_v4/';
export const INTEL_MODEL: ModelSource = {
  id: 'htdemucs-intel-efb3d2b',
  entry: 'htdemucs_fwd.onnx',
  files: [
    { name: 'htdemucs_fwd.onnx', url: `${INTEL}htdemucs_fwd.onnx`, bytes: 2385507, sha256: '555f511fb653348a1c9495ab6b6091767d1920798f3fba68629a1fe5b135a45f' },
    { name: 'htdemucs_fwd.onnx.data', url: `${INTEL}htdemucs_fwd.onnx.data`, bytes: 168361984, sha256: '23a7c68669c041363caaef94641e961dc8c4e16b9891cb87f58f0e199a5e8820' },
  ],
};

function chosenSource(): ModelSource {
  // Development only: `localStorage['soundwave.dev.stem-model'] = 'repo'` loads the repository's file
  // from the dev server, to check it before the download moves there.
  if (import.meta.env.DEV) {
    try {
      if (localStorage.getItem('soundwave.dev.stem-model') === 'repo') {
        return { ...REPO_MODEL, files: REPO_MODEL.files.map((f) => ({ ...f, url: `/models/htdemucs/${f.name}` })) };
      }
    } catch {
      /* storage unavailable */
    }
  }
  return INTEL_MODEL;
}

export interface ModelStatus {
  state: 'unknown' | 'absent' | 'downloading' | 'ready' | 'error';
  /** Bytes here so far and bytes in all, while downloading. */
  received: number;
  total: number;
  error?: string;
}

export interface LoadedModel {
  entry: string;
  files: { name: string; data: ArrayBuffer }[];
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

class StemModel {
  readonly source = chosenSource();
  readonly bytes = this.source.files.reduce((n, f) => n + f.bytes, 0);
  private status: ModelStatus = { state: 'unknown', received: 0, total: this.bytes };
  private listeners = new Set<() => void>();
  private pending: Promise<void> | null = null;
  private dbPromise: Promise<IDBPDatabase> | null = null;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  snapshot = () => this.status;

  private set(patch: Partial<ModelStatus>) {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l();
  }

  private db() {
    this.dbPromise ??= openDB('soundwave-models', 1, { upgrade: (d) => void d.createObjectStore('files') });
    return this.dbPromise;
  }
  private key = (f: ModelFile) => `${this.source.id}/${f.name}`;

  private async stored(f: ModelFile): Promise<Blob | undefined> {
    const blob = (await (await this.db()).get('files', this.key(f))) as Blob | undefined;
    return blob && blob.size === f.bytes ? blob : undefined;
  }

  /** Looks at what is stored, without downloading anything. */
  async check(): Promise<ModelStatus['state']> {
    if (this.status.state === 'downloading' || this.status.state === 'ready') return this.status.state;
    try {
      const have = await Promise.all(this.source.files.map((f) => this.stored(f)));
      const ready = have.every(Boolean);
      this.set({ state: ready ? 'ready' : 'absent', received: ready ? this.bytes : 0, error: undefined });
    } catch (e) {
      this.set({ state: 'error', error: `Storage is not available here (${(e as Error).message}).` });
    }
    return this.status.state;
  }

  /** Resolves once the model is on this device, downloading what is missing. One download at a time. */
  ensure(): Promise<void> {
    if (this.status.state === 'ready') return Promise.resolve();
    this.pending ??= this.download().finally(() => (this.pending = null));
    return this.pending;
  }

  private async download(): Promise<void> {
    try {
      const have = await Promise.all(this.source.files.map((f) => this.stored(f)));
      let received = this.source.files.reduce((n, f, i) => n + (have[i] ? f.bytes : 0), 0);
      this.set({ state: 'downloading', received, error: undefined });
      for (const [i, file] of this.source.files.entries()) {
        if (have[i]) continue;
        const res = await fetch(file.url);
        if (!res.ok || !res.body) throw new Error(`the download answered ${res.status}`);
        const data = new Uint8Array(file.bytes);
        let at = 0;
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (at + value.length > data.length) throw new Error('the file is larger than expected');
          data.set(value, at);
          at += value.length;
          received += value.length;
          // Not for every network chunk: listeners redraw.
          if (received - this.status.received >= this.bytes / 200) this.set({ received });
        }
        if (at !== file.bytes) throw new Error('the file arrived incomplete');
        // Only a secure page can hash; elsewhere the size has to do.
        if (globalThis.crypto?.subtle && hex(await crypto.subtle.digest('SHA-256', data)) !== file.sha256) throw new Error('the file is not the expected one');
        await (await this.db()).put('files', new Blob([data]), this.key(file));
      }
      // Copies of an earlier model version are no longer needed.
      const d = await this.db();
      for (const key of (await d.getAllKeys('files')) as string[]) if (!key.startsWith(`${this.source.id}/`)) await d.delete('files', key);
      this.set({ state: 'ready', received: this.bytes });
    } catch (e) {
      this.set({ state: 'error', error: `The analysis model could not be downloaded: ${(e as Error).message}.` });
      throw new Error(this.status.error, { cause: e });
    }
  }

  /** The model's files, read from storage. */
  async load(): Promise<LoadedModel> {
    const files = await Promise.all(
      this.source.files.map(async (f) => {
        const blob = await this.stored(f);
        if (!blob) throw new Error('The analysis model is not on this device.');
        return { name: f.name, data: await blob.arrayBuffer() };
      }),
    );
    return { entry: this.source.entry, files };
  }
}

export const stemModel = new StemModel();
