"""
A festival crowd, synthesized: a roar of shaped noise, a few hundred individual shouts built
from a voice model (a pulse train through vowel formants), whistles and applause. A real
recording of crowd murmur can be layered underneath for texture when it is available
(local-audio/samples/crowd/crowd.wav, public domain, see "Music and sound" in the README).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

from orchestra import ROOT, SR, db

WALLA = ROOT / "local-audio" / "samples" / "crowd" / "crowd.wav"

# Vowel formants (Hz) with their bandwidths, roughly: "ah", "oh", "oo", "eh", "ay"
VOWELS = {
    "a": [(800, 90), (1200, 110), (2600, 170)],
    "o": [(520, 80), (900, 100), (2500, 170)],
    "u": [(380, 70), (850, 100), (2400, 170)],
    "e": [(560, 80), (1800, 130), (2600, 180)],
}


def envelope(n: int, attack: float, hold: float, decay: float, start: float = 0.0, curve: float = 2.0) -> np.ndarray:
    """Rise over `attack`, stay for `hold`, fall over `decay` (seconds), beginning at `start`."""
    t = np.arange(n) / SR - start
    up = np.clip(t / max(attack, 1e-4), 0, 1) ** 1.5
    down = np.clip(1 - (t - attack - hold) / max(decay, 1e-4), 0, 1) ** curve
    return (up * down).astype(np.float32)


def _wander(n: int, rng, rate: float, depth: float) -> np.ndarray:
    """A slow random gain curve around 1: low-passed noise."""
    k = max(2, int(n / SR * rate) + 2)
    pts = rng.normal(0, 1, k)
    x = np.interp(np.linspace(0, k - 1, n), np.arange(k), pts)
    return np.exp(x * depth).astype(np.float32)


def roar(n: int, rng) -> np.ndarray:
    """The mass of the crowd: noise through moving vowel-shaped bands, different in each ear."""
    out = np.zeros((n, 2), dtype=np.float32)
    bands = [(450, 0.9, 0.7), (750, 0.8, 1.0), (1150, 0.7, 1.0), (1700, 0.7, 0.75), (2600, 0.6, 0.5), (3800, 0.6, 0.22), (6000, 0.7, 0.07)]
    for ch in range(2):
        for fc, width, gain in bands:
            noise = rng.standard_normal(n).astype(np.float32)
            lo, hi = fc / (1 + width / 2), fc * (1 + width / 2)
            sos = signal.butter(2, [lo, hi], "bandpass", fs=SR, output="sos")
            band = signal.sosfilt(sos, noise)
            band /= np.sqrt((band**2).mean()) + 1e-9
            out[:, ch] += band * gain * _wander(n, rng, 2.5, 0.35) * _wander(n, rng, 0.4, 0.25)
    return out / 3.0


def shout(rng, kind: str = "woo") -> np.ndarray:
    """One person: 'woo', 'yeah' or a long 'aaah', mono."""
    dur = {"woo": rng.uniform(0.5, 1.5), "yeah": rng.uniform(0.35, 0.8), "aah": rng.uniform(1.0, 2.4)}[kind]
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    female = rng.random() < 0.5
    base = rng.uniform(300, 520) if female else rng.uniform(170, 300)
    if kind == "woo":
        f0 = base * (1 + 0.45 * np.sin(np.pi * np.clip(t * 1.25, 0, 1)) ** 2) * (1 - 0.18 * t**3)
    elif kind == "yeah":
        f0 = base * (1.15 - 0.3 * t**1.5)
    else:
        f0 = base * (1 + 0.12 * np.sin(np.pi * t)) * (1 - 0.1 * t**2)
    f0 = f0 * (1 + 0.012 * np.sin(2 * np.pi * rng.uniform(4.5, 6.5) * t * dur + rng.uniform(0, 6))) * _wander(n, rng, 12, 0.01)
    phase = 2 * np.pi * np.cumsum(f0) / SR
    # A glottal-ish source: band-limited pulse made of decaying harmonics, plus breath.
    src = np.zeros(n, dtype=np.float32)
    k = 1
    while k * f0.max() < 7000 and k < 40:
        src += (np.sin(k * phase + rng.uniform(0, 6)) / k**1.15).astype(np.float32)
        k += 1
    src += rng.standard_normal(n).astype(np.float32) * 0.12 * rng.uniform(0.5, 1.5)
    # Vowel: "woo" moves from oo towards oh/ah, "yeah" from eh to ah.
    a, b = {"woo": ("u", rng.choice(["o", "u", "a"])), "yeah": ("e", "a"), "aah": ("a", rng.choice(["a", "o"]))}[kind]
    shift = rng.uniform(0.92, 1.18) * (1.12 if female else 1.0)
    out = np.zeros(n, dtype=np.float32)
    half = n // 2
    for (f1, w1), (f2, w2) in zip(VOWELS[a], VOWELS[b]):
        # Two fixed resonators cross-faded: cheaper than a moving filter and close enough in a crowd.
        ya = signal.lfilter(*signal.iirpeak(f1 * shift, f1 / w1, fs=SR), src)
        yb = signal.lfilter(*signal.iirpeak(f2 * shift, f2 / w2, fs=SR), src)
        mixc = np.clip((np.arange(n) - half * 0.5) / max(1, half), 0, 1)
        out += (ya * (1 - mixc) + yb * mixc).astype(np.float32)
    out *= envelope(n, dur * rng.uniform(0.06, 0.2), dur * rng.uniform(0.3, 0.5), dur * 0.5, curve=1.6)
    out *= _wander(n, rng, 9, 0.12)
    return out / (np.abs(out).max() + 1e-9)


def whistle(rng) -> np.ndarray:
    dur = rng.uniform(0.25, 0.8)
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    f = rng.uniform(1700, 2600) * (1 + rng.uniform(0.15, 0.5) * t ** rng.uniform(0.6, 2)) * (1 + 0.01 * np.sin(2 * np.pi * rng.uniform(18, 30) * t * dur))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.25 * signal.lfilter(*signal.iirpeak(float(f.mean()), 8, fs=SR), rng.standard_normal(n))
    return (x * envelope(n, 0.04, dur * 0.6, dur * 0.3)).astype(np.float32) / 1.3


def applause(n: int, rng, density: np.ndarray) -> np.ndarray:
    """Hand claps as a random process: `density` is claps per second over time."""
    out = np.zeros((n, 2), dtype=np.float32)
    # A few dozen clap "voices", each a short band of noise with its own colour.
    kinds = []
    for _ in range(40):
        m = int(SR * rng.uniform(0.012, 0.035))
        burst = rng.standard_normal(m) * np.exp(-np.arange(m) / (m * rng.uniform(0.12, 0.3)))
        fc = rng.uniform(900, 2800)
        sos = signal.butter(2, [fc / 1.6, fc * 1.6], "bandpass", fs=SR, output="sos")
        kinds.append(signal.sosfilt(sos, burst).astype(np.float32))
    expected = density / SR
    times = np.nonzero(rng.random(n) < expected)[0]
    for i in times:
        c = kinds[rng.integers(len(kinds))] * rng.uniform(0.3, 1.0)
        pan = rng.uniform(0, 1)
        j = min(n, i + len(c))
        out[i:j, 0] += c[: j - i] * np.cos(pan * np.pi / 2)
        out[i:j, 1] += c[: j - i] * np.sin(pan * np.pi / 2)
    return out


def walla(n: int, rng, layers: int = 3, semitones: float = 3.0) -> np.ndarray | None:
    """Real people, when the recording is there: several stretches of it, pitched up into excitement."""
    if not WALLA.exists():
        return None
    x, sr = sf.read(str(WALLA), dtype="float32", always_2d=True)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    out = np.zeros((n, 2), dtype=np.float32)
    for k in range(layers):
        rate = sr / SR * 2 ** ((semitones + rng.uniform(-1.5, 1.5)) / 12)
        need = int(n * rate) + 2
        start = int(rng.integers(0, len(x) - need - 1))
        seg = x[start : start + need]
        pos = np.arange(n) * rate
        i = pos.astype(int)
        frac = (pos - i)[:, None].astype(np.float32)
        y = seg[i] * (1 - frac) + seg[i + 1] * frac
        out += y[:, ::-1] if k % 2 else y
    sos = signal.butter(2, [350, 6000], "bandpass", fs=SR, output="sos")
    out = signal.sosfilt(sos, out, axis=0).astype(np.float32)
    return out / (np.sqrt((out**2).mean()) + 1e-9) * 0.1


def cheer(seconds: float, *, peak_at: float, hold: float, decay: float, seed: int = 5, people: int = 220, whistles: int = 9, clapping: float = 0.6, excitement: float = 1.0) -> np.ndarray:
    """
    A crowd erupting: silence, a rise to `peak_at` seconds, `hold` seconds of full voice, then
    `decay` seconds of settling. Stereo, unnormalized, before any hall.
    """
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    env = envelope(n, peak_at, hold, decay, curve=2.2)
    out = roar(n, rng) * (env**1.2)[:, None] * 0.9 * excitement

    real = walla(n, rng)
    if real is not None:
        out += real * env[:, None] * 2.2

    voices = np.zeros((n, 2), dtype=np.float32)
    kinds = ["woo"] * 5 + ["yeah"] * 3 + ["aah"] * 4
    # People join in as the cheer rises and drop out as it settles.
    cdf = np.cumsum(env**1.5)
    cdf /= cdf[-1]
    for _ in range(int(people * excitement)):
        v = shout(rng, kinds[rng.integers(len(kinds))])
        i = int(np.searchsorted(cdf, rng.random())) - len(v) // 3
        i = max(0, min(n - len(v) - 1, i))
        # Most are far away: quieter and duller. A few are close.
        dist = rng.uniform(0.15, 1.0) ** 1.5
        v = signal.sosfilt(signal.butter(1, 1500 + 6000 * dist, "lowpass", fs=SR, output="sos"), v).astype(np.float32) * dist
        pan = rng.uniform(0, 1)
        voices[i : i + len(v), 0] += v * np.cos(pan * np.pi / 2)
        voices[i : i + len(v), 1] += v * np.sin(pan * np.pi / 2)
    # Single voices belong to the height of the cheer; the settling is left to the mass.
    out += voices * (env**1.5)[:, None] * 0.1

    for _ in range(whistles):
        w = whistle(rng)
        i = int(np.searchsorted(cdf, rng.uniform(0.1, 0.9)))
        i = max(0, min(n - len(w) - 1, i))
        pan = rng.uniform(0.1, 0.9)
        g = rng.uniform(0.02, 0.06)
        out[i : i + len(w), 0] += w * g * np.cos(pan * np.pi / 2)
        out[i : i + len(w), 1] += w * g * np.sin(pan * np.pi / 2)

    if clapping > 0:
        claps = applause(n, rng, 420 * envelope(n, peak_at * 1.3, hold, decay * 1.1, curve=1.6) * clapping)
        out += claps * 0.16
    return out


def arena(x: np.ndarray, seed: int = 9) -> np.ndarray:
    """Open-air space: a slap off the far side and a short diffuse wash, no long hall."""
    rng = np.random.default_rng(seed)
    n = int(SR * 0.9)
    t = np.arange(n) / SR
    ir = rng.standard_normal((n, 2)) * np.exp(-6.9 * t / 0.8)[:, None] * (1 - np.exp(-t / 0.02))[:, None]
    ir = signal.sosfilt(signal.butter(1, 5000, "lowpass", fs=SR, output="sos"), ir, axis=0)
    ir /= np.sqrt((ir**2).sum())
    wet = signal.fftconvolve(x, ir, axes=0)[: len(x)]
    slap = np.zeros_like(x)
    d = int(0.13 * SR)
    slap[d:] = x[:-d, ::-1] * 0.22
    slap = signal.sosfilt(signal.butter(1, 3500, "lowpass", fs=SR, output="sos"), slap, axis=0)
    return (x + wet * db(-9) + slap).astype(np.float32)
