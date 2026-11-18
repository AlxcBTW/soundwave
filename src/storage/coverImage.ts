/**
 * A picture chosen as a song's cover: decoded, scaled down to at most COVER_MAX pixels a side (a
 * photo straight off a phone would otherwise make every copy of the song's file megabytes larger)
 * and stored as a JPEG. A picture already small enough in a format the song file takes is kept.
 */
const COVER_MAX = 1000;
const KEEP = ['image/jpeg', 'image/png', 'image/webp'];

export async function prepareCover(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That file is not a picture this game can read. Try a JPEG, PNG or WebP.');
  }
  try {
    const scale = Math.min(1, COVER_MAX / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && KEEP.includes(file.type)) return file;
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('The picture could not be prepared.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new Error('The picture could not be prepared.');
    return blob;
  } finally {
    bitmap.close();
  }
}
