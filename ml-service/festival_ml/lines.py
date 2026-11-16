"""Turns transcribed notes into playable lines. Mirrors src/analysis/pitch/lines.ts."""

from __future__ import annotations

import math
from typing import Callable

BASS_SPLIT = 52
CLUSTER_SEC = 0.05
CLUSTER_GAP = 0.03
LEAD_GAP_SEC = 12.0

Note = dict  # {t, dur, midi, strength, bend?, chord?}


def monophonic(notes: list[Note], score: Callable[[Note], float], min_dur: float = 0.06) -> list[Note]:
    out: list[Note] = []
    for n in sorted(notes, key=lambda n: (n["t"], -score(n))):
        if not out:
            out.append(dict(n))
            continue
        prev = out[-1]
        if n["t"] - prev["t"] < CLUSTER_SEC:
            if score(n) > score(prev):
                out[-1] = dict(n)
            continue
        if n["t"] < prev["t"] + prev["dur"]:
            if score(n) < score(prev) * 0.5:
                continue
            prev["dur"] = n["t"] - prev["t"]
        out.append(dict(n))
    return [n for n in out if n["dur"] >= min_dur]


def clusters(notes: list[Note]) -> list[list[Note]]:
    out: list[list[Note]] = []
    for n in sorted(notes, key=lambda n: (n["t"], n["midi"])):
        if out and n["t"] - out[-1][-1]["t"] < CLUSTER_GAP and n["t"] - out[-1][0]["t"] < CLUSTER_SEC * 2:
            out[-1].append(n)
        else:
            out.append([n])
    return out


def bass_line(notes: list[Note]) -> list[Note]:
    """Lowest pitch class per onset, folded to the octave nearest the recent bass register."""
    low = [n for n in notes if n["midi"] < BASS_SPLIT + 12 and n["strength"] >= 0.12]
    if not low:
        return []
    weighted = sorted((n["midi"], n["strength"] * max(0.05, n["dur"])) for n in low)
    total = sum(w for _, w in weighted)
    acc, ref = 0.0, weighted[-1][0]
    for m, w in weighted:
        acc += w
        if acc >= total / 2:
            ref = m
            break
    recent: list[int] = []
    out: list[Note] = []
    for c in clusters(low):
        lowest = c[0]
        pc = lowest["midi"] % 12
        same = [n for n in c if n["midi"] % 12 == pc]
        midi = lowest["midi"]
        m = pc + 12
        while m < BASS_SPLIT + 12:
            if abs(m - ref) < abs(midi - ref):
                midi = m
            m += 12
        out.append({"t": lowest["t"], "dur": max(n["dur"] for n in same), "midi": midi, "strength": max(n["strength"] for n in same)})
        recent.append(midi)
        recent = recent[-8:]
        ref = sorted(recent)[len(recent) // 2]
    return monophonic(out, lambda n: n["strength"])


def melodic_path(notes: list[Note], score: Callable[[Note], float], floor: float, leap_cost: float) -> list[Note]:
    """Dynamic-programming path through notes: rewards salient notes, penalizes leaps."""
    c = sorted(notes, key=lambda n: (n["t"], -n["midi"]))
    n = len(c)
    best = [0.0] * n
    prev = [-1] * n
    start = 0
    for i in range(n):
        gain = score(c[i]) - floor
        best[i] = gain
        while start < i and c[i]["t"] - c[start]["t"] > 4:
            start += 1
        for j in range(start, i):
            if c[i]["t"] - c[j]["t"] < CLUSTER_SEC:
                continue
            gap = c[i]["t"] - (c[j]["t"] + c[j]["dur"])
            cost = abs(c[i]["midi"] - c[j]["midi"]) / 12 * leap_cost * (0.3 if gap > 0.6 else 1)
            v = best[j] - cost + gain
            if v > best[i]:
                best[i] = v
                prev[i] = j
    used = [False] * n
    chosen: list[Note] = []
    for end in sorted(range(n), key=lambda k: -best[k]):
        if used[end] or best[end] <= 0:
            continue
        k = end
        while k >= 0 and not used[k]:
            used[k] = True
            chosen.append(c[k])
            k = prev[k]
    return monophonic(chosen, score)


def _dur_factor(n: Note) -> float:
    return min(1.4, 0.6 + n["dur"] * 2)


def vocal_line(notes: list[Note]) -> list[Note]:
    """Sung line from an isolated vocal stem: one continuous voice."""
    cands = [n for n in notes if 45 <= n["midi"] <= 86 and n["strength"] >= 0.15]
    return melodic_path(cands, lambda n: n["strength"] * _dur_factor(n), 0.12, 0.5)


def lead_line(notes: list[Note]) -> list[Note]:
    """Instrument line from the 'other' stem: chords stay chords, riffs follow one path."""
    upper = [n for n in notes if n["midi"] >= BASS_SPLIT - 4 and n["strength"] >= 0.15]
    lead: list[Note] = []
    riff: list[Note] = []
    for c in clusters(upper):
        pitches = sorted({n["midi"] for n in c})
        if len(pitches) >= 3 and len({m % 12 for m in pitches}) >= 2:
            durs = sorted(n["dur"] for n in c)
            lead.append({"t": c[0]["t"], "dur": durs[len(durs) // 2], "midi": pitches[-1], "strength": max(n["strength"] for n in c), "chord": pitches})
        else:
            riff.extend(c)
    spans = [(l["t"], l["t"] + l["dur"]) for l in lead]
    free = [n for n in riff if not any(a + CLUSTER_SEC < n["t"] < b - 0.02 for a, b in spans)]
    for r in melodic_path(free, lambda n: n["strength"] * _dur_factor(n), 0.35, 0.6):
        if not any(abs(l["t"] - r["t"]) < CLUSTER_SEC for l in lead):
            lead.append(r)
    lead.sort(key=lambda n: n["t"])
    return lead


def fill_gaps(lead: list[Note], vocals: list[Note], duration: float) -> list[Note]:
    """Long stretches without a lead instrument double the vocal melody."""
    if not vocals:
        return lead
    bounds = [0.0] + [x for n in lead for x in (n["t"], n["t"] + n["dur"])] + [duration]
    out = list(lead)
    for i in range(0, len(bounds) - 1, 2):
        a, b = bounds[i], bounds[i + 1]
        if b - a >= LEAD_GAP_SEC:
            out.extend(dict(v) for v in vocals if a + 0.1 < v["t"] < b - 0.1)
    out.sort(key=lambda n: n["t"])
    for i in range(len(out) - 1):
        if out[i]["t"] + out[i]["dur"] > out[i + 1]["t"]:
            out[i]["dur"] = max(0.03, out[i + 1]["t"] - out[i]["t"])
    return out


def bend_activity(bends: list[float] | None) -> float:
    if not bends or len(bends) < 3:
        return 0.0
    mean = sum(bends) / len(bends)
    return round(math.sqrt(sum((b - mean) ** 2 for b in bends) / len(bends)) / 3, 3)
