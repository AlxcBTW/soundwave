"""
A small offline orchestra: a sampler over recorded instrument samples, a hall and a mastering
chain. theme.py and sfx.py use it to render the game's music and interface sounds.

The samples are the Versilian Studios Chamber Orchestra 2 Community Edition (CC0,
https://github.com/sgossner/VSCO-2-CE). They are not part of this repository: check the
library out into local-audio/samples/vsco2ce (see "Music and sound" in the README). Only the rendered
files in public/audio are committed.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

SR = 48000
ROOT = Path(__file__).resolve().parents[2]
SAMPLES = ROOT / "local-audio" / "samples" / "vsco2ce"
INDEX = ROOT / "local-audio" / "samples" / "vsco2ce-index.json"
OUT = ROOT / "public" / "audio"

# instrument -> articulation -> (folder, lowest and highest pitch to expect, as MIDI notes)
PITCHED: dict[str, dict[str, tuple[str, int, int]]] = {
    "violins": {
        "sus": ("Strings/Violin Section/susVib", 55, 100),
        "spic": ("Strings/Violin Section/Spic", 55, 100),
        "trem": ("Strings/Violin Section/Trem", 55, 100),
        "pizz": ("Strings/Violin Section/Pizz", 55, 100),
    },
    "violas": {
        "sus": ("Strings/Viola Section/susvib", 48, 88),
        "spic": ("Strings/Viola Section/spic", 48, 88),
    },
    "celli": {
        "sus": ("Strings/Cello Section/susvib", 36, 76),
        "spic": ("Strings/Cello Section/spic", 36, 76),
        "pizz": ("Strings/Cello Section/pizzT", 36, 76),
    },
    "basses": {
        "sus": ("Strings/Solo Contrabass/SusVib", 24, 62),
        "spic": ("Strings/Solo Contrabass/Spic", 24, 62),
        "pizz": ("Strings/Solo Contrabass/Pizz", 24, 62),
    },
    "harp": {"pluck": ("Strings/Harp", 24, 103)},
    "horn": {"sus": ("Brass/F Horn/sus", 31, 79), "stac": ("Brass/F Horn/stac", 31, 79)},
    "trumpet": {"sus": ("Brass/Trumpet/sus", 52, 86), "stac": ("Brass/Trumpet/stac", 52, 86)},
    "trombone": {"sus": ("Brass/Tenor Trombone/sus", 34, 74), "stac": ("Brass/Tenor Trombone/stac", 34, 74)},
    "tuba": {"sus": ("Brass/Tuba/sus", 22, 62), "stac": ("Brass/Tuba/stac", 22, 62)},
    "glock": {"hit": ("Percussion/Glock", 72, 110)},
    "timpani": {"hit": ("Percussion/Timpani", 36, 62), "roll": ("Percussion/Timpani/Rolls", 36, 62)},
    "bells": {"hit": ("Percussion", 55, 90)},  # tubular bells: TB_hit_*.wav
}

NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
DYN = {"pppp": 0.05, "ppp": 0.1, "pp": 0.2, "p": 0.32, "mp": 0.45, "mf": 0.58, "f": 0.72, "ff": 0.86, "fff": 1.0}


def midi(name: str) -> int:
    """'F#4' -> 66 (C4 = 60)."""
    m = re.fullmatch(r"([A-G])(#|b)?(-?\d)", name)
    assert m, name
    return NOTE[m[1]] + (1 if m[2] == "#" else -1 if m[2] == "b" else 0) + 12 * (int(m[3]) + 1)


def db(x: float) -> float:
    return 10 ** (x / 20)


# ---------------------------------------------------------------- sample index


def _read(path: Path) -> tuple[np.ndarray, int]:
    x, sr = sf.read(str(path), dtype="float32", always_2d=True)
    return x, sr


def _onset(x: np.ndarray, sr: int, floor_db: float = -42) -> int:
    """First sample that rises above `floor_db` relative to the peak, backed off 3 ms."""
    env = np.abs(x).max(axis=1)
    peak = env.max()
    if peak <= 0:
        return 0
    i = int(np.argmax(env > peak * db(floor_db)))
    return max(0, i - int(sr * 0.003))


def _yin(frame: np.ndarray, sr: int, fmin: float, fmax: float) -> tuple[float, float]:
    """Fundamental (Hz) of one frame and how periodic it is (0 = perfectly)."""
    tmax = min(int(sr / fmin), len(frame) // 2 - 1)
    tmin = max(2, int(sr / fmax))
    f = frame.astype(np.float64)
    n = len(f)
    # Difference function through an FFT autocorrelation: for each lag, the squared difference
    # over every pair the frame holds, per pair (so longer lags are not favoured).
    spec = np.fft.rfft(f, 2 * n)
    acf = np.fft.irfft(spec * np.conj(spec))[: tmax + 1]
    sq = np.concatenate(([0.0], np.cumsum(f * f)))
    lags = np.arange(tmax + 1)
    d = (sq[n - lags] + (sq[n] - sq[lags]) - 2 * acf) / (n - lags)
    d = np.maximum(d, 0)
    cm = np.ones_like(d)
    run = np.cumsum(d[1:])
    cm[1:] = d[1:] * np.arange(1, tmax + 1) / np.maximum(run, 1e-12)
    seg = cm[tmin:tmax]
    below = np.where(seg < 0.15)[0]
    if len(below):
        t = below[0]
        while t + 1 < len(seg) and seg[t + 1] < seg[t]:
            t += 1
    else:
        t = int(np.argmin(seg))
    t += tmin
    if 1 <= t < tmax:
        a, b, c = cm[t - 1], cm[t], cm[t + 1]
        den = a - 2 * b + c
        off = 0.5 * (a - c) / den if abs(den) > 1e-12 else 0.0
    else:
        off = 0.0
    return sr / (t + off), float(cm[t])


def detect_pitch(x: np.ndarray, sr: int, lo: int, hi: int, decaying: bool) -> float | None:
    """Median MIDI pitch (fractional) of the steady part of a sample."""
    mono = x.mean(axis=1)
    start = _onset(x, sr)
    fmin = 440 * 2 ** ((lo - 69 - 3) / 12)
    fmax = 440 * 2 ** ((hi - 69 + 3) / 12)
    n = int(2 ** np.ceil(np.log2(sr / fmin * 4)))
    body = mono[start:]
    if decaying:
        a, b = int(sr * 0.04), int(sr * 0.9)
    else:
        a, b = int(len(body) * 0.2), int(len(body) * 0.7)
    b = min(b, len(body) - n)
    if b <= a:
        a, b = 0, max(1, len(body) - n)
    if len(body) < n:
        return None
    found = []
    for i in np.linspace(a, b, 9).astype(int):
        f, q = _yin(body[i : i + n], sr, fmin, fmax)
        if q < 0.35:
            found.append(69 + 12 * np.log2(f / 440))
    return float(np.median(found)) if len(found) >= 3 else None


def _parse(name: str) -> tuple[int | None, float, int]:
    """Note, dynamic (0..1) and round-robin number from a sample file name."""
    stem = name.rsplit(".", 1)[0]
    note = None
    m = re.search(r"(?:^|_)([A-G]#?)(-?\d)(?=_|$)", stem)
    if m:
        note = midi(m[1] + m[2])
    dyn = 0.6
    m = re.search(r"_v(\d)", stem)
    if m:
        dyn = {1: 0.3, 2: 0.55, 3: 0.75, 4: 0.9, 5: 1.0}.get(int(m[1]), 0.6)
    else:
        m = re.search(r"_(p{1,4}|mp|mf|f{1,3})(?=_|$)", stem)
        if m:
            dyn = DYN[m[1]]
    rr = 1
    m = re.search(r"(?i)rr(\d)", stem) or re.search(r"_(\d)(?:_[A-Za-z]+)?$", stem)
    if m:
        rr = int(m[1])
    return note, dyn, rr


def build_index() -> dict:
    """Scan the library once: measured pitch, level and length of every pitched sample."""
    index: dict = {}
    drums: dict[str, float] = {}
    for inst, arts in PITCHED.items():
        index[inst] = {}
        for art, (folder, lo, hi) in arts.items():
            rows = []
            files = sorted((SAMPLES / folder).glob("*.wav"))
            if inst == "bells":
                files = [f for f in files if f.name.startswith("TB_hit")]
            decaying = art in ("pluck", "hit", "pizz", "spic", "stac")
            for f in files:
                x, sr = _read(f)
                named, dyn, rr = _parse(f.name)
                got = detect_pitch(x, sr, lo, hi, decaying)
                rows.append({"file": f.relative_to(SAMPLES).as_posix(), "named": named, "pitch": got, "dyn": dyn, "rr": rr, "len": round(len(x) / sr, 3), "peak": round(float(np.abs(x).max()), 4)})
            if inst == "timpani":
                # Kettledrums carry no note in their names, and their partials imply a fundamental an
                # octave below the note heard. Rolls measure poorly, so each drum gets the pitch of
                # its single strokes.
                number = lambda r: re.search(r"Timpani(\d)", r["file"])[1]
                if art == "hit":
                    for k in {number(r) for r in rows}:
                        drums[k] = float(np.median([r["pitch"] for r in rows if number(r) == k and r["pitch"] is not None])) + 12
                for r in rows:
                    r["pitch"] = drums.get(number(r))
            # File names disagree about octaves between instruments: trust the measured pitch
            # for the octave and (when it is sure) the tuning, the name for the note.
            offs = [round((r["pitch"] - r["named"]) / 12) for r in rows if r["pitch"] is not None and r["named"] is not None]
            octave = int(np.median(offs)) * 12 if offs else 0
            for r in rows:
                if r["named"] is not None:
                    nominal = r["named"] + octave
                    cents = (r["pitch"] - nominal) * 100 if r["pitch"] is not None else 0.0
                    r["note"] = nominal + (cents / 100 if abs(cents) < 45 else 0.0)
                    r["cents"] = round(cents, 1) if r["pitch"] is not None else None
                else:
                    r["note"] = r["pitch"]
            index[inst][art] = [r for r in rows if r["note"] is not None]
    INDEX.write_text(json.dumps(index, indent=1))
    return index


def load_index() -> dict:
    if not SAMPLES.exists():
        raise SystemExit(f"Sample library not found at {SAMPLES}. See \"Music and sound\" in the README.")
    return json.loads(INDEX.read_text()) if INDEX.exists() else build_index()


# ---------------------------------------------------------------- sampler

_cache: dict[str, np.ndarray] = {}


def sample(rel: str) -> np.ndarray:
    """A sample as float32 stereo at SR, trimmed to its onset."""
    if rel not in _cache:
        x, sr = _read(SAMPLES / rel)
        if x.shape[1] == 1:
            x = np.repeat(x, 2, axis=1)
        x = x[_onset(x, sr) :, :2]
        if sr != SR:
            fr = Fraction(SR, sr)
            x = signal.resample_poly(x, fr.numerator, fr.denominator, axis=0).astype(np.float32)
        _cache[rel] = x
    return _cache[rel]


def repitch(x: np.ndarray, semitones: float) -> np.ndarray:
    """Tape-style pitch change (length changes with it)."""
    if abs(semitones) < 0.005:
        return x
    fr = Fraction(2 ** (-semitones / 12)).limit_denominator(240)
    return signal.resample_poly(x, fr.numerator, fr.denominator, axis=0).astype(np.float32)


def _loop_to(x: np.ndarray, n: int) -> np.ndarray:
    """Extend a sustained sample to n samples by cross-fading back into its steady part."""
    if len(x) >= n:
        return x[:n]
    a, b = int(len(x) * 0.3), int(len(x) * 0.8)
    xf = min(int(SR * 0.35), (b - a) // 2)
    fade = np.linspace(0, 1, xf, dtype=np.float32)[:, None]
    out = [x[:b]]
    have = b
    while have < n:
        seg = x[a:b].copy()
        tail = out[-1][-xf:]
        seg[:xf] = seg[:xf] * np.sqrt(fade) + tail * np.sqrt(1 - fade)
        out[-1] = out[-1][:-xf]
        out.append(seg)
        have += len(seg) - xf
    return np.concatenate(out)[:n]


@dataclass
class Seat:
    """Where an instrument sits: pan (-1 left .. 1 right), level and how much hall it gets."""

    pan: float = 0.0
    gain_db: float = 0.0
    wet: float = 0.35
    width: float = 1.0
    #: Extra voices from neighbouring samples, to turn one player into a section.
    voices: int = 1
    #: Low-pass (Hz) for instruments at the back of the stage; 0 = none.
    dark: float = 0.0


class Mix:
    """A stereo mix bus with a hall send. Times are in seconds."""

    def __init__(self, seconds: float):
        self.n = int(seconds * SR)
        self.dry = np.zeros((self.n + SR * 8, 2), dtype=np.float32)
        self.send = np.zeros_like(self.dry)

    def add(self, x: np.ndarray, t: float, seat: Seat, gain: float = 1.0):
        i = int(round(t * SR))
        if i < 0:
            x, i = x[-i:], 0
        x = x[: len(self.dry) - i]
        if not len(x):
            return
        g = gain * db(seat.gain_db)
        # Narrow the recording, then place it with an equal-power pan.
        mid, side = (x[:, 0] + x[:, 1]) * 0.5, (x[:, 0] - x[:, 1]) * 0.5 * seat.width
        ang = (seat.pan + 1) * np.pi / 4
        left = (mid + side) * np.cos(ang) * np.sqrt(2)
        right = (mid - side) * np.sin(ang) * np.sqrt(2)
        y = np.stack([left, right], axis=1) * g
        self.dry[i : i + len(y)] += y * (1 - seat.wet * 0.5)
        self.send[i : i + len(y)] += y * seat.wet


class Orchestra:
    def __init__(self, seed: int = 1):
        self.index = load_index()
        self.rng = np.random.default_rng(seed)
        self._rr: dict[tuple, int] = {}

    def _pick(self, inst: str, art: str, note: float, vel: float, skip: int = 0) -> dict:
        rows = self.index[inst][art]
        # Nearest pitches first; among those the closest dynamic layer; then rotate round robins.
        pitches = sorted({round(r["note"]) for r in rows}, key=lambda p: (abs(p - note), p))
        # Extra voices borrow neighbouring samples, but only ones close enough to keep their timbre.
        close = [p for p in pitches if abs(p - note) <= 5.5] or pitches[:1]
        target = close[skip % len(close)]
        near = [r for r in rows if round(r["note"]) == target]
        dyns = sorted({r["dyn"] for r in near}, key=lambda d: abs(d - vel))
        layer = [r for r in near if r["dyn"] == dyns[0]]
        key = (inst, art, target, dyns[0])
        k = self._rr.get(key, 0)
        self._rr[key] = k + 1
        return layer[k % len(layer)]

    def render(self, inst: str, art: str, note: float, vel: float, dur: float | None = None, *, attack: float = 0.0, release: float = 0.25, skip: int = 0, detune: float = 0.0, shape: tuple[float, ...] | None = None) -> np.ndarray:
        """
        One note as stereo audio. `dur` (s) holds a sustained articulation and then releases it;
        None plays a one-shot to its natural end. `shape` is a gain curve across the held part
        (evenly spaced points, e.g. (0.5, 1) for a crescendo).
        """
        r = self._pick(inst, art, note, vel, skip)
        x = repitch(sample(r["file"]), note - r["note"] + detune / 100)
        # Level: flatten the library's own differences a little, then follow the velocity.
        x = x * (0.5 / max(r["peak"], 0.05)) ** 0.5 * (0.25 + 0.75 * vel**1.3)
        if dur is not None:
            n = int((dur + release) * SR)
            x = _loop_to(x, n).copy()
            rel = int(release * SR)
            x[-rel:] *= (np.cos(np.linspace(0, np.pi, rel, dtype=np.float32)) * 0.5 + 0.5)[:, None] ** 1.5
            if shape is not None:
                held = len(x) - rel
                curve = np.interp(np.linspace(0, 1, held), np.linspace(0, 1, len(shape)), shape).astype(np.float32)
                x[:held] *= curve[:, None]
                x[held:] *= curve[-1]
        else:
            x = x.copy()
        if attack > 0:
            a = min(int(attack * SR), len(x))
            x[:a] *= np.linspace(0, 1, a, dtype=np.float32)[:, None] ** 1.5
        return x

    def play(self, mix: Mix, seat: Seat, inst: str, art: str, note: float, vel: float, t: float, dur: float | None = None, **kw):
        """Render a note onto the mix, as a section when the seat asks for several voices."""
        for v in range(seat.voices):
            if v == 0:
                mix.add(self.render(inst, art, note, vel, dur, **kw), t, seat)
            else:
                # Another player: a neighbouring sample tuned to the same note, a touch late,
                # a few cents off and seated a little to the side.
                spread = Seat(pan=float(np.clip(seat.pan + (0.12 if v % 2 else -0.12) * ((v + 1) // 2), -1, 1)), gain_db=seat.gain_db - 2.5, wet=seat.wet, width=seat.width)
                x = self.render(inst, art, note, vel, dur, skip=v, detune=float(self.rng.uniform(-7, 7)), **kw)
                mix.add(x, t + float(self.rng.uniform(0.004, 0.022)), spread)

    def hit(self, mix: Mix, seat: Seat, rel: str, t: float, level: float = 0.5, *, pitch: float = 0.0, length: float | None = None, fade: float = 0.3, reverse: bool = False, peak_at: bool = False) -> float:
        """
        An unpitched sample by file name (relative to the library), its peak brought to `level`.
        `peak_at` lines the loudest moment up with `t` instead of the start (for crescendo rolls).
        Returns its length in seconds.
        """
        x = sample(rel)
        if pitch:
            x = repitch(x, pitch)
        x = x * (level / max(float(np.abs(x).max()), 1e-6))
        if peak_at:
            k = int(SR * 0.05)
            env = np.convolve(np.abs(x).max(axis=1) ** 2, np.ones(k) / k, "same")
            t -= float(np.argmax(env)) / SR
        if length is not None and len(x) > int(length * SR):
            x = x[: int(length * SR)].copy()
            f = min(int(fade * SR), len(x))
            x[-f:] *= np.linspace(1, 0, f, dtype=np.float32)[:, None] ** 2
        if reverse:
            x = x[::-1]
        mix.add(x, t, seat)
        return len(x) / SR


# ---------------------------------------------------------------- hall and mastering


def hall_ir(rt60: float = 2.2, predelay: float = 0.018, seed: int = 7) -> np.ndarray:
    """
    A concert-hall impulse response made from shaped noise: early reflections off the walls,
    then a dense tail that decays faster in the highs and holds on longer in the low mids.
    """
    rng = np.random.default_rng(seed)
    n = int(SR * rt60 * 1.6)
    t = np.arange(n) / SR
    tail = np.zeros((n, 2))
    bands = [(0, 180, 1.05), (180, 500, 1.15), (500, 1400, 1.0), (1400, 3500, 0.8), (3500, 7000, 0.55), (7000, 14000, 0.32)]
    for lo, hi, k in bands:
        noise = rng.standard_normal((n, 2))
        if lo == 0:
            sos = signal.butter(2, hi, "lowpass", fs=SR, output="sos")
        else:
            sos = signal.butter(2, [lo, hi], "bandpass", fs=SR, output="sos")
        band = signal.sosfilt(sos, noise, axis=0)
        band /= np.sqrt((band**2).mean()) + 1e-12
        tail += band * np.exp(-6.908 * t / (rt60 * k))[:, None] * (0.6 if lo == 0 else 1.0)
    tail *= (1 - np.exp(-t / 0.035))[:, None]  # the tail builds up, it does not start at full density
    ir = np.zeros((n + int(SR * 0.2), 2))
    p = int(predelay * SR)
    ir[p : p + n] += tail * 0.5
    for k in range(14):
        d = p + int(rng.uniform(0.006, 0.085) * SR)
        g = rng.uniform(0.25, 0.7) * (1 - k / 22)
        side = rng.uniform(0.15, 0.85)
        ir[d, 0] += g * np.cos(side * np.pi / 2) * rng.choice([-1, 1])
        ir[d, 1] += g * np.sin(side * np.pi / 2) * rng.choice([-1, 1])
    ir = signal.sosfilt(signal.butter(1, 12000, "lowpass", fs=SR, output="sos"), ir, axis=0)
    ir /= np.sqrt((ir**2).sum())
    return ir.astype(np.float32)


def mixdown(mix: Mix, ir: np.ndarray, wet_db: float = -3.0, tail: float = 4.0) -> np.ndarray:
    """Dry bus plus the hall, as long as the piece and `tail` seconds of ring-out."""
    wet = signal.fftconvolve(mix.send, ir, axes=0)[: len(mix.dry)]
    out = mix.dry + wet.astype(np.float32) * db(wet_db)
    return out[: mix.n + int(tail * SR)]


def _k_weight(x: np.ndarray) -> np.ndarray:
    # ITU-R BS.1770 pre-filter at 48 kHz: high shelf, then high-pass.
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    return signal.lfilter(b2, a2, signal.lfilter(b1, a1, x, axis=0), axis=0)


def lufs(x: np.ndarray) -> float:
    """Integrated loudness (BS.1770, gated)."""
    y = _k_weight(x.astype(np.float64))
    win, hop = int(0.4 * SR), int(0.1 * SR)
    if len(y) < win:
        return float(-0.691 + 10 * np.log10((y**2).mean(axis=0).sum() + 1e-12))
    sq = np.concatenate([np.zeros((1, y.shape[1])), np.cumsum(y**2, axis=0)])
    starts = np.arange(0, len(y) - win + 1, hop)
    z = ((sq[starts + win] - sq[starts]) / win).sum(axis=1)
    loud = -0.691 + 10 * np.log10(z + 1e-12)
    z = z[loud > -70]
    if not len(z):
        return -70.0
    rel = -0.691 + 10 * np.log10(z.mean()) - 10
    z2 = z[(-0.691 + 10 * np.log10(z + 1e-12)) > rel]
    return float(-0.691 + 10 * np.log10((z2 if len(z2) else z).mean()))


def level_ride(x: np.ndarray, amount: float = 0.35, window: float = 2.0) -> np.ndarray:
    """Narrow the dynamic range the way an engineer rides a fader: slowly, without pumping."""
    mono = np.sqrt((x.astype(np.float64) ** 2).mean(axis=1))
    k = int(window * SR)
    kern = np.hanning(k)
    kern /= kern.sum()
    env = np.sqrt(np.maximum(signal.fftconvolve(mono**2, kern, mode="same"), 1e-10))
    ref = np.sqrt((env**2).mean())
    gain = (ref / env) ** amount
    return (x * np.clip(gain, db(-9), db(9))[:, None]).astype(np.float32)


def limit(x: np.ndarray, ceiling_db: float = -1.0, lookahead: float = 0.005, release: float = 0.12) -> np.ndarray:
    """Look-ahead peak limiter."""
    ceil = db(ceiling_db)
    peak = np.abs(x).max(axis=1)
    look = int(lookahead * SR)
    # The gain needed now is set by the loudest sample in the look-ahead window.
    from scipy.ndimage import maximum_filter1d, uniform_filter1d

    need = maximum_filter1d(peak, size=2 * look + 1, mode="nearest")
    gain = np.minimum(1.0, ceil / np.maximum(need, 1e-9))
    # Fast attack is already in the window; smooth the recovery.
    rel = np.exp(-1 / (release * SR))
    out = np.empty_like(gain)
    g = 1.0
    for i in range(len(gain)):
        g = gain[i] if gain[i] < g else rel * g + (1 - rel) * gain[i]
        out[i] = g
    out = uniform_filter1d(out, size=look, mode="nearest")
    y = x * np.minimum(out, gain)[:, None]
    return np.clip(y, -ceil, ceil).astype(np.float32)


def highpass(x: np.ndarray, hz: float, order: int = 2) -> np.ndarray:
    return signal.sosfilt(signal.butter(order, hz, "highpass", fs=SR, output="sos"), x, axis=0).astype(np.float32)


def lowpass(x: np.ndarray, hz: float, order: int = 2) -> np.ndarray:
    return signal.sosfilt(signal.butter(order, hz, "lowpass", fs=SR, output="sos"), x, axis=0).astype(np.float32)


def shelf(x: np.ndarray, hz: float, gain_db: float, high: bool = True) -> np.ndarray:
    """First-order-ish shelf: the band above (or below) `hz` scaled by `gain_db`."""
    band = highpass(x, hz, 1) if high else lowpass(x, hz, 1)
    return (x + band * (db(gain_db) - 1)).astype(np.float32)


def fade(x: np.ndarray, fade_in: float = 0.0, fade_out: float = 0.0) -> np.ndarray:
    x = x.copy()
    a, b = int(fade_in * SR), int(fade_out * SR)
    if a:
        x[:a] *= np.linspace(0, 1, a, dtype=np.float32)[:, None]
    if b:
        x[-b:] *= (np.linspace(1, 0, b, dtype=np.float32) ** 2)[:, None]
    return x


def write(path: Path, x: np.ndarray, quality: float = 0.6):
    """Ogg Vorbis (sample-exact, so loops stay seamless), plus a WAV next to it when asked."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with sf.SoundFile(str(path), "w", samplerate=SR, channels=x.shape[1], format="OGG", subtype="VORBIS", compression_level=1 - quality) as f:
        for i in range(0, len(x), SR):  # libsndfile's Vorbis writer dislikes very large blocks
            f.write(x[i : i + SR])
