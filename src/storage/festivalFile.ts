/**
 * The .festival song file: one file that carries a song whole, so it can be kept, moved and shared.
 *
 * It holds the song's details (title, artist, album, length), its cover, the analysis its charts are
 * built from, any charts edited by hand, and the original audio file byte for byte. A friend who opens it plays the same charts
 * without analyzing the song again, and because the song's id is the hash of its audio, the same song
 * imported twice is recognised.
 *
 * Layout, every integer little-endian:
 *
 *     offset  size  field
 *     0       8     magic, the ASCII bytes "FESTIVAL"
 *     8       2     format version (FORMAT_VERSION)
 *     10      2     reserved, 0
 *     12      ...   chunks, one after another to the end of the file
 *
 *     chunk:  4     type, four ASCII letters
 *             4     payload length n
 *             n     payload
 *             4     CRC-32 of the type and the payload
 *
 * Chunk types:
 *
 *     META  required. UTF-8 JSON: { title, artist, album?, duration, fileName, addedAt? }.
 *     COVR  optional. The cover image: u8 length m, m bytes of ASCII MIME type, then the image.
 *     ANLS  optional. The analysis: u16 analysis version, then gzip-compressed UTF-8 JSON of it.
 *     EDIT  optional. Charts made or changed by hand in the track editor, and the beat grid they sit
 *           on: u16 edits version, then gzip-compressed UTF-8 JSON (src/editor/edits.ts).
 *     AUDI  required. The audio: u8 length m, m bytes of ASCII MIME type, then the audio file.
 *
 * Readers skip chunk types they do not know, so later versions can add chunks. AUDI is written
 * last: everything before it is small, and the audio can be sliced out without reading it.
 */

export const FESTIVAL_EXT = '.festival';
export const FESTIVAL_MIME = 'application/x-festival';
export const FORMAT_VERSION = 1;

const MAGIC = 'FESTIVAL';
const HEADER = 12;
const CHUNK_HEAD = 8;
const CRC = 4;

/** Longest text kept from a file's details; anything past it is cut. */
const MAX_TEXT = 300;
/** Largest META, ANLS or EDIT payload read (analysis JSON of a long song is well under this, compressed). */
const MAX_SMALL_CHUNK = 32 * 1024 * 1024;
const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export interface FestivalMeta {
  title: string;
  artist: string;
  album?: string;
  duration: number;
  fileName: string;
  addedAt?: number;
}

export interface FestivalAnalysis {
  version: number;
  data: unknown;
}

/** Hand-edited charts, as the editor stores them. Readers check `data` before using it. */
export interface FestivalEdits {
  version: number;
  data: unknown;
}

export interface FestivalContents {
  meta: FestivalMeta;
  cover?: Blob;
  analysis?: FestivalAnalysis;
  edits?: FestivalEdits;
  /** The original audio file, typed with its MIME type. */
  audio: Blob;
}

export class FestivalFileError extends Error {}

/* CRC-32 (IEEE) --------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* Writing --------------------------------------------------------------------------------- */

const ascii = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0x7f);
const utf8 = new TextEncoder();

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const typeBytes = ascii(type);
  const out = new Uint8Array(CHUNK_HEAD + payload.length + CRC);
  out.set(typeBytes, 0);
  const view = new DataView(out.buffer);
  view.setUint32(4, payload.length, true);
  out.set(payload, CHUNK_HEAD);
  view.setUint32(CHUNK_HEAD + payload.length, crc32([typeBytes, payload]), true);
  return out;
}

/** A payload that starts with its MIME type (COVR, AUDI). */
function typed(mime: string, data: Uint8Array): Uint8Array {
  const m = ascii(mime.slice(0, 255));
  const out = new Uint8Array(1 + m.length + data.length);
  out[0] = m.length;
  out.set(m, 1);
  out.set(data, 1 + m.length);
  return out;
}

async function bytesOf(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const gzip = (data: Uint8Array) => bytesOf(new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('gzip')));
const gunzip = (data: Uint8Array) => bytesOf(new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip')));

/** A payload that starts with a version and carries gzip-compressed JSON (ANLS, EDIT). */
async function versioned(v: { version: number; data: unknown }): Promise<Uint8Array> {
  const json = await gzip(utf8.encode(JSON.stringify(v.data)));
  const payload = new Uint8Array(2 + json.length);
  new DataView(payload.buffer).setUint16(0, v.version, true);
  payload.set(json, 2);
  return payload;
}

async function readVersioned(data: Uint8Array): Promise<{ version: number; data: unknown } | undefined> {
  try {
    const version = new DataView(data.buffer, data.byteOffset, 2).getUint16(0, true);
    const json = await gunzip(data.subarray(2));
    return { version, data: JSON.parse(new TextDecoder().decode(json)) };
  } catch {
    return undefined;
  }
}

/** Builds a .festival file. */
export async function writeFestival(c: FestivalContents): Promise<Blob> {
  const header = new Uint8Array(HEADER);
  header.set(ascii(MAGIC), 0);
  new DataView(header.buffer).setUint16(8, FORMAT_VERSION, true);
  const meta: FestivalMeta = {
    title: c.meta.title,
    artist: c.meta.artist,
    ...(c.meta.album ? { album: c.meta.album } : {}),
    duration: c.meta.duration,
    fileName: c.meta.fileName,
    ...(c.meta.addedAt ? { addedAt: c.meta.addedAt } : {}),
  };
  const parts: Uint8Array[] = [header, chunk('META', utf8.encode(JSON.stringify(meta)))];
  if (c.cover) parts.push(chunk('COVR', typed(c.cover.type || 'image/jpeg', new Uint8Array(await c.cover.arrayBuffer()))));
  if (c.analysis) parts.push(chunk('ANLS', await versioned(c.analysis)));
  if (c.edits) parts.push(chunk('EDIT', await versioned(c.edits)));
  parts.push(chunk('AUDI', typed(c.audio.type || 'application/octet-stream', new Uint8Array(await c.audio.arrayBuffer()))));
  return new Blob(parts as Uint8Array<ArrayBuffer>[], { type: FESTIVAL_MIME });
}

/* Reading --------------------------------------------------------------------------------- */

interface ChunkRef {
  type: string;
  /** Where the payload starts in the file. */
  offset: number;
  length: number;
}

async function read(blob: Blob, start: number, length: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}

/** Whether a blob starts like a .festival file. */
export async function isFestival(blob: Blob): Promise<boolean> {
  if (blob.size < HEADER) return false;
  const head = await read(blob, 0, MAGIC.length);
  return String.fromCharCode(...head) === MAGIC;
}

/** The file's chunks, found by reading only their headers. */
async function index(blob: Blob): Promise<ChunkRef[]> {
  if (!(await isFestival(blob))) throw new FestivalFileError('This is not a Festival song file.');
  const version = new DataView((await read(blob, 8, 2)).buffer).getUint16(0, true);
  if (version > FORMAT_VERSION) throw new FestivalFileError('This song file was made by a newer version of Festival. Update the game to open it.');
  const refs: ChunkRef[] = [];
  let at = HEADER;
  while (at < blob.size) {
    if (at + CHUNK_HEAD + CRC > blob.size) throw new FestivalFileError('This song file is cut short.');
    const head = await read(blob, at, CHUNK_HEAD);
    const type = String.fromCharCode(...head.subarray(0, 4));
    const length = new DataView(head.buffer).getUint32(4, true);
    if (!/^[A-Z0-9]{4}$/.test(type) || at + CHUNK_HEAD + length + CRC > blob.size) throw new FestivalFileError('This song file is damaged.');
    refs.push({ type, offset: at + CHUNK_HEAD, length });
    at += CHUNK_HEAD + length + CRC;
  }
  return refs;
}

async function payload(blob: Blob, ref: ChunkRef, verify: boolean): Promise<Uint8Array> {
  const data = await read(blob, ref.offset, ref.length);
  if (verify) {
    const stored = new DataView((await read(blob, ref.offset + ref.length, CRC)).buffer).getUint32(0, true);
    if (crc32([ascii(ref.type), data]) !== stored) throw new FestivalFileError('This song file is damaged.');
  }
  return data;
}

function splitTyped(data: Uint8Array): { mime: string; body: Uint8Array } {
  const m = data[0] ?? 0;
  if (1 + m > data.length) throw new FestivalFileError('This song file is damaged.');
  return { mime: String.fromCharCode(...data.subarray(1, 1 + m)), body: data.subarray(1 + m) };
}

const text = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_TEXT) : fallback);

function parseMeta(data: Uint8Array): FestivalMeta {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new FestivalFileError('This song file is damaged.');
  }
  if (!raw || typeof raw !== 'object') throw new FestivalFileError('This song file is damaged.');
  const duration = typeof raw.duration === 'number' && Number.isFinite(raw.duration) && raw.duration > 0 ? raw.duration : 0;
  const addedAt = typeof raw.addedAt === 'number' && Number.isFinite(raw.addedAt) ? raw.addedAt : undefined;
  const album = text(raw.album, '');
  return {
    title: text(raw.title, 'Untitled'),
    artist: text(raw.artist, 'Unknown artist'),
    ...(album ? { album } : {}),
    duration,
    fileName: text(raw.fileName, 'song'),
    ...(addedAt ? { addedAt } : {}),
  };
}

const MIME = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i;

/**
 * Reads a whole .festival file and checks every chunk. For files from elsewhere: whatever is
 * malformed throws a FestivalFileError, and a cover or analysis that cannot be used is left out.
 */
export async function readFestival(blob: Blob): Promise<FestivalContents> {
  const refs = await index(blob);
  const find = (type: string) => refs.find((r) => r.type === type);
  const metaRef = find('META');
  const audioRef = find('AUDI');
  if (!metaRef || !audioRef) throw new FestivalFileError('This song file has no song in it.');
  if (metaRef.length > MAX_SMALL_CHUNK) throw new FestivalFileError('This song file is damaged.');
  const meta = parseMeta(await payload(blob, metaRef, true));

  const audioData = splitTyped(await payload(blob, audioRef, true));
  if (!audioData.body.length) throw new FestivalFileError('This song file has no song in it.');
  const audio = new Blob([audioData.body as Uint8Array<ArrayBuffer>], { type: MIME.test(audioData.mime) ? audioData.mime : 'application/octet-stream' });

  let cover: Blob | undefined;
  const coverRef = find('COVR');
  if (coverRef) {
    const c = splitTyped(await payload(blob, coverRef, true));
    if (COVER_TYPES.includes(c.mime.toLowerCase()) && c.body.length) cover = new Blob([c.body as Uint8Array<ArrayBuffer>], { type: c.mime.toLowerCase() });
  }

  // An analysis or edits that cannot be read are left out: the song is analyzed again when played.
  const small = async (type: string) => {
    const ref = find(type);
    if (!ref || ref.length <= 2 || ref.length > MAX_SMALL_CHUNK) return undefined;
    return readVersioned(await payload(blob, ref, true));
  };
  const analysis: FestivalAnalysis | undefined = await small('ANLS');
  const edits: FestivalEdits | undefined = await small('EDIT');
  return { meta, cover, analysis, edits, audio };
}

/**
 * The audio inside a .festival file, sliced out without reading or checking the rest: for the
 * game's own stored files, read every time a song plays.
 */
export async function festivalAudio(blob: Blob): Promise<Blob> {
  const ref = (await index(blob)).find((r) => r.type === 'AUDI');
  if (!ref) throw new FestivalFileError('This song file has no song in it.');
  const m = (await read(blob, ref.offset, 1))[0];
  const mime = String.fromCharCode(...(await read(blob, ref.offset + 1, m)));
  return blob.slice(ref.offset + 1 + m, ref.offset + ref.length, MIME.test(mime) ? mime : 'application/octet-stream');
}

/** A file name for a song's .festival file: "Artist - Title.festival" (or the title alone), safe on every system. */
export function festivalFileName(meta: { title: string; artist: string }): string {
  const known = meta.artist.trim() && meta.artist !== 'Unknown artist';
  const name = (known ? `${meta.artist} - ${meta.title}` : meta.title)
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120);
  return `${/[\p{L}\p{N}]/u.test(name) ? name : 'song'}${FESTIVAL_EXT}`;
}

export const isFestivalFile = (f: File) => f.name.toLowerCase().endsWith(FESTIVAL_EXT);
