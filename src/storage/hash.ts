/** Content hash used as the song id and cache key. */
export async function hashBytes(data: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Insecure contexts have no SubtleCrypto; fall back to two FNV-1a passes.
  const bytes = new Uint8Array(data);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193);
    h2 = Math.imul(h2 ^ bytes[bytes.length - 1 - i], 0x811c9dc5);
  }
  return `fnv${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}${bytes.length.toString(16)}`;
}
