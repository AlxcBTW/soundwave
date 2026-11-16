"""Finds the time offset between a reference stem (on a chart's timeline) and our audio.

    python scripts/dev/align.py <reference.wav|opus> <our-stem.wav> [out.json]

Cross-correlates log-energy envelopes globally, then re-checks the offset in windows across the
song to detect drift or edits (e.g. a music-video intro). Positive offset = our audio is later:
our_time = chart_time + offset.
"""

import json
import sys

import librosa
import numpy as np

SR = 11025
HOP = 110  # ~10 ms


def envelope(path: str) -> np.ndarray:
    y, _ = librosa.load(path, sr=SR, mono=True)
    rms = librosa.feature.rms(y=y, frame_length=512, hop_length=HOP)[0]
    env = np.log1p(rms / (np.percentile(rms, 95) + 1e-9) * 20)
    return env - env.mean()


def xcorr_lag(a: np.ndarray, b: np.ndarray, max_lag: int) -> tuple[int, float]:
    """Lag (frames) maximizing correlation of b shifted against a: b[t + lag] ~ a[t]."""
    n = len(a) + len(b)
    size = 1 << (n - 1).bit_length()
    fa = np.fft.rfft(a, size)
    fb = np.fft.rfft(b, size)
    corr = np.fft.irfft(np.conj(fa) * fb, size)
    lags = np.concatenate([np.arange(0, max_lag + 1), np.arange(-max_lag, 0)])
    vals = np.concatenate([corr[: max_lag + 1], corr[-max_lag:]])
    best = int(np.argmax(vals))
    norm = np.sqrt((a**2).sum() * (b**2).sum()) + 1e-9
    return int(lags[best]), float(vals[best] / norm)


def main() -> None:
    ref, ours = envelope(sys.argv[1]), envelope(sys.argv[2])
    fps = SR / HOP
    lag, score = xcorr_lag(ref, ours, int(30 * fps))
    offset = lag / fps
    windows = []
    win = int(20 * fps)
    for start in range(0, len(ref) - win, win // 2):
        a = ref[start : start + win]
        if np.abs(a).sum() < 1e-3 or a.std() < 0.05:
            continue
        lo = start + lag - int(2 * fps)
        if lo < 0 or lo + win + int(4 * fps) > len(ours):
            continue
        b = ours[lo : lo + win + int(4 * fps)]
        # Local search within ±2 s of the global offset.
        best, best_v = 0, -1e9
        for d in range(0, int(4 * fps)):
            v = float(np.dot(a, b[d : d + win]))
            if v > best_v:
                best, best_v = d, v
        local = (lo + best - start) / fps
        windows.append({"chart_time": round(start / fps, 1), "offset": round(local, 3)})
    result = {"offset": round(offset, 3), "score": round(score, 3), "windows": windows}
    if len(sys.argv) > 3:
        with open(sys.argv[3], "w") as f:
            json.dump(result, f, indent=1)
    print(json.dumps({"offset": result["offset"], "score": result["score"]}))
    offs = [w["offset"] for w in windows]
    if offs:
        print("window offsets: min", min(offs), "max", max(offs), "median", float(np.median(offs)))
        print(" ".join(f"{w['chart_time']}:{w['offset']}" for w in windows))


if __name__ == "__main__":
    main()
