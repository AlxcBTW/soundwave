/**
 * Half the sample rate (44.1 kHz stems to the 22.05 kHz the analysis works at): a windowed-sinc
 * low-pass that is flat to about 10 kHz and down 80 dB by 12 kHz, then every second sample.
 */
const TAPS = 191;
const CUTOFF = 0.25 * 0.985; // of the input rate
const BETA = 8;

function bessel0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 30; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
  }
  return sum;
}

const KERNEL = (() => {
  const mid = (TAPS - 1) / 2;
  const k = new Float32Array(TAPS);
  let total = 0;
  for (let n = 0; n < TAPS; n++) {
    const t = n - mid;
    const sinc = t === 0 ? 2 * CUTOFF : Math.sin(2 * Math.PI * CUTOFF * t) / (Math.PI * t);
    k[n] = sinc * (bessel0(BETA * Math.sqrt(1 - (t / mid) ** 2)) / bessel0(BETA));
    total += k[n];
  }
  for (let n = 0; n < TAPS; n++) k[n] /= total;
  return k;
})();

export function halve(x: Float32Array): Float32Array {
  const out = new Float32Array(Math.ceil(x.length / 2));
  const mid = (TAPS - 1) / 2;
  for (let i = 0; i < out.length; i++) {
    const centre = 2 * i;
    const from = Math.max(0, mid - centre);
    const to = Math.min(TAPS, x.length + mid - centre);
    let v = 0;
    for (let n = from; n < to; n++) v += KERNEL[n] * x[centre - mid + n];
    out[i] = v;
  }
  return out;
}
