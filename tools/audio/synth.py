"""
Synthesized instruments for the hybrid side of the menu theme: a bass, pads, plucks, a lead and
a light drum kit. Everything is band-limited (single-cycle tables built from harmonics), so
nothing aliases, and everything returns stereo float32 at the orchestra's sample rate.
"""
from __future__ import annotations

import numpy as np
from scipy import signal

from orchestra import SR, db

TABLE = 4096


def hz(note: float) -> float:
    return 440.0 * 2 ** ((note - 69) / 12)


def table(f0: float, cutoff: float, slope: float = 1.0, order: int = 2, odd_only: bool = False) -> np.ndarray:
    """One cycle of a sawtooth (or square-ish, with odd harmonics only) seen through a low-pass."""
    k = np.arange(1, int(min(SR * 0.45, 16000) / f0) + 1)
    amp = 1.0 / k**slope / np.sqrt(1 + (k * f0 / cutoff) ** (2 * order))
    if odd_only:
        amp[1::2] = 0
    spec = np.zeros(TABLE // 2 + 1, dtype=complex)
    spec[k[k < TABLE // 2]] = -1j * amp[k < TABLE // 2]
    t = np.fft.irfft(spec, TABLE)
    return (t / np.abs(t).max()).astype(np.float32)


def osc(tab: np.ndarray, freq: np.ndarray | float, n: int, phase: float = 0.0) -> np.ndarray:
    """Read a table at `freq` (Hz, scalar or per sample)."""
    f = np.full(n, freq) if np.isscalar(freq) else freq
    pos = (phase + np.cumsum(f) / SR) % 1.0 * TABLE
    i = pos.astype(np.int64)
    frac = (pos - i).astype(np.float32)
    return tab[i % TABLE] * (1 - frac) + tab[(i + 1) % TABLE] * frac


def adsr(n: int, attack: float, release: float, hold: float | None = None) -> np.ndarray:
    """Gain curve for a held note of n samples in all: rise, hold, cosine release at the end."""
    a, r = max(1, int(attack * SR)), max(1, int(release * SR))
    env = np.ones(n, dtype=np.float32)
    env[: min(a, n)] = np.linspace(0, 1, a, dtype=np.float32)[: min(a, n)] ** 1.5
    r = min(r, n)
    env[-r:] *= np.cos(np.linspace(0, np.pi / 2, r, dtype=np.float32)) ** 2
    return env


def stereo(mono: np.ndarray, pan: float = 0.0) -> np.ndarray:
    ang = (pan + 1) * np.pi / 4
    return np.stack([mono * np.cos(ang), mono * np.sin(ang)], axis=1).astype(np.float32) * np.sqrt(2)


def pad(note: float, dur: float, vel: float, rng, *, cutoff: float = 2400, voices: int = 7, detune: float = 13.0, attack: float = 0.45, release: float = 1.1) -> np.ndarray:
    """A wide, slow pad: several slightly detuned saws spread across the stereo field."""
    n = int((dur + release) * SR)
    f0 = hz(note)
    tab = table(f0, cutoff, order=2)
    out = np.zeros((n, 2), dtype=np.float32)
    for v in range(voices):
        spread = (v / (voices - 1) * 2 - 1) if voices > 1 else 0.0
        cents = spread * detune + rng.uniform(-2, 2)
        # Each voice drifts a little, so the chorus never settles into a regular beat.
        drift = 1 + 0.0012 * np.sin(2 * np.pi * rng.uniform(0.1, 0.35) * np.arange(n) / SR + rng.uniform(0, 6))
        out += stereo(osc(tab, f0 * 2 ** (cents / 1200) * drift, n, rng.random()), spread * 0.9)
    out *= (adsr(n, attack, release) * vel / np.sqrt(voices))[:, None]
    return out


def bass(note: float, dur: float, vel: float, *, cutoff: float = 320, attack: float = 0.008, release: float = 0.07, drive: float = 1.6) -> np.ndarray:
    """Round and warm: a sine an octave of weight under a dull saw, pushed gently into saturation."""
    n = int((dur + release) * SR)
    f0 = hz(note)
    t = np.arange(n) / SR
    body = osc(table(f0, cutoff, order=3), f0, n) * 0.7 + np.sin(2 * np.pi * f0 * t).astype(np.float32) * 0.9
    body += osc(table(f0 * 2, cutoff * 1.5, order=3), f0 * 2, n) * 0.3  # an octave up, so it reads on small speakers
    body += np.sin(np.pi * f0 * t).astype(np.float32) * 0.5  # and an octave down, for the floor
    body = np.tanh(body * drive) / np.tanh(drive)
    return stereo(body * adsr(n, attack, release) * vel)


def pluck(note: float, vel: float, *, bright: float = 5200, dull: float = 700, decay: float = 0.4, tone_decay: float = 0.09) -> np.ndarray:
    """A plucked synth string: bright at the attack, closing quickly to a soft body."""
    n = int(decay * 3.2 * SR)
    f0 = hz(note)
    t = np.arange(n) / SR
    a, b = osc(table(f0, bright), f0, n), osc(table(f0, dull, order=3), f0, n)
    mix = np.exp(-t / tone_decay).astype(np.float32)
    x = (a * mix + b * (1 - mix)) * np.exp(-t / decay).astype(np.float32)
    x[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR), dtype=np.float32)
    return stereo(x * vel)


def lead(note: float, dur: float, vel: float, rng, *, cutoff: float = 3200, attack: float = 0.025, release: float = 0.16) -> np.ndarray:
    """A singing lead: three voices, a little hollow, with vibrato that arrives late like a player's."""
    n = int((dur + release) * SR)
    f0 = hz(note)
    t = np.arange(n) / SR
    vib = 1 + 0.006 * np.clip((t - 0.22) / 0.3, 0, 1) * np.sin(2 * np.pi * 5.4 * t)
    saw, hollow = table(f0, cutoff), table(f0, cutoff * 0.8, odd_only=True)
    out = np.zeros((n, 2), dtype=np.float32)
    for cents, pan in ((-7, -0.35), (0, 0.0), (7, 0.35)):
        f = f0 * 2 ** (cents / 1200) * vib
        out += stereo(osc(saw, f, n, rng.random()) * 0.6 + osc(hollow, f, n, rng.random()) * 0.5, pan)
    return out * (adsr(n, attack, release) * vel / 1.7)[:, None]


def _noise(n: int, rng) -> np.ndarray:
    return rng.standard_normal(n).astype(np.float32)


def kick(vel: float = 1.0, *, low: float = 47, sweep: float = 120, length: float = 0.42) -> np.ndarray:
    n = int(length * SR)
    t = np.arange(n) / SR
    f = low + sweep * np.exp(-t / 0.032)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.15)
    x += np.exp(-t / 0.004) * 0.25 * np.sin(2 * np.pi * 1800 * t)  # the beater
    x = np.tanh(x * 1.8) / np.tanh(1.8)
    x[-int(0.02 * SR) :] *= np.linspace(1, 0, int(0.02 * SR))
    return stereo(x.astype(np.float32) * vel)


def clap(rng, vel: float = 1.0) -> np.ndarray:
    """Several hands not quite together, then the room."""
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    env = np.zeros(n)
    for d in (0.0, 0.009, 0.019, 0.03):
        m = t >= d
        env[m] += np.exp(-(t[m] - d) / 0.007)
    env += 0.5 * np.exp(-np.maximum(t - 0.03, 0) / 0.09) * (t >= 0.03)
    out = np.zeros((n, 2), dtype=np.float32)
    sos = signal.butter(2, [850, 3800], "bandpass", fs=SR, output="sos")
    for ch in range(2):
        out[:, ch] = signal.sosfilt(sos, _noise(n, rng)) * env
    return out * vel * 0.9


def hat(rng, vel: float = 1.0, open_: bool = False) -> np.ndarray:
    n = int((0.28 if open_ else 0.07) * SR)
    t = np.arange(n) / SR
    x = signal.sosfilt(signal.butter(3, 6800, "highpass", fs=SR, output="sos"), _noise(n, rng))
    x *= np.exp(-t / (0.085 if open_ else 0.016))
    return stereo(x.astype(np.float32) * vel * 0.5, rng.uniform(-0.25, 0.25))


def shaker(rng, vel: float = 1.0) -> np.ndarray:
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    x = signal.sosfilt(signal.butter(2, [4200, 9500], "bandpass", fs=SR, output="sos"), _noise(n, rng))
    x *= np.minimum(t / 0.012, 1) * np.exp(-np.maximum(t - 0.012, 0) / 0.022)
    return stereo(x.astype(np.float32) * vel * 0.5, rng.uniform(0.2, 0.5))


def riser(dur: float, rng, *, start: float = 250, end: float = 9000) -> np.ndarray:
    """Noise opening upward: the breath before a section lands."""
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    out = np.zeros((n, 2), dtype=np.float32)
    block = 2048
    for ch in range(2):
        x = _noise(n + block, rng)
        y = np.zeros(n + block, dtype=np.float32)
        zi = None
        for i in range(0, n, block):
            fc = start * (end / start) ** t[min(i, n - 1)]
            sos = signal.butter(2, [fc / 1.5, min(fc * 1.5, SR * 0.45)], "bandpass", fs=SR, output="sos")
            if zi is None:
                zi = signal.sosfilt_zi(sos) * 0
            y[i : i + block], zi = signal.sosfilt(sos, x[i : i + block], zi=zi)
        out[:, ch] = y[:n]
    return out * (t**2.2)[:, None].astype(np.float32) * 0.5


def boom(vel: float = 1.0, *, top: float = 82, bottom: float = 36, length: float = 1.6) -> np.ndarray:
    """A low drop under a downbeat, felt more than heard."""
    n = int(length * SR)
    t = np.arange(n) / SR
    f = bottom + (top - bottom) * np.exp(-t / 0.28)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.42) * (1 - np.exp(-t / 0.004))
    return stereo(x.astype(np.float32) * vel)


def echo(x: np.ndarray, seconds: float, feedback: float = 0.38, mix: float = 0.4, tone: float = 3200, tail: float = 3.0) -> np.ndarray:
    """A ping-pong delay: each repeat crosses to the other side and loses some top."""
    d = int(seconds * SR)
    out = np.concatenate([x, np.zeros((int(tail * SR), 2), dtype=np.float32)])
    sos = signal.butter(1, tone, "lowpass", fs=SR, output="sos")
    rep = x
    g = mix
    k = 1
    while g > 0.01 and k * d < len(out):
        rep = signal.sosfilt(sos, rep[:, ::-1], axis=0).astype(np.float32)
        m = min(len(rep), len(out) - k * d)
        out[k * d : k * d + m] += rep[:m] * g
        g *= feedback
        k += 1
    return out


def duck(n: int, times: list[float], depth_db: float = 5.0, hold: float = 0.03, release: float = 0.2) -> np.ndarray:
    """A gain curve that dips at each time and recovers: the pad and bass breathing around the kick."""
    g = np.ones(n, dtype=np.float32)
    m = int((hold + release * 4) * SR)
    t = np.arange(m) / SR
    dip = 1 - (1 - db(-depth_db)) * np.where(t < hold, 1.0, np.exp(-(t - hold) / release))
    for when in times:
        i = int(when * SR)
        if 0 <= i < n:
            j = min(n, i + m)
            g[i:j] = np.minimum(g[i:j], dip[: j - i])
    return g
