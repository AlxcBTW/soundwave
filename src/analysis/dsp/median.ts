/**
 * Sliding-window median over `n` values read with a stride, written to `dst` with the same stride.
 * Keeps a sorted window and updates it incrementally (O(win) per sample).
 */
export function medianFilter(
  src: Float32Array,
  dst: Float32Array,
  offset: number,
  stride: number,
  n: number,
  win: number,
  sorted: Float32Array,
) {
  const half = win >> 1;
  const at = (i: number) => src[offset + Math.min(n - 1, Math.max(0, i)) * stride];
  let len = 0;
  const insert = (v: number) => {
    let i = len++;
    while (i > 0 && sorted[i - 1] > v) {
      sorted[i] = sorted[i - 1];
      i--;
    }
    sorted[i] = v;
  };
  const remove = (v: number) => {
    let lo = 0;
    let hi = len - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < len - 1; i++) sorted[i] = sorted[i + 1];
    len--;
  };
  for (let i = -half; i <= half; i++) insert(at(i));
  for (let i = 0; i < n; i++) {
    dst[offset + i * stride] = sorted[half];
    remove(at(i - half));
    insert(at(i + half + 1));
  }
}
