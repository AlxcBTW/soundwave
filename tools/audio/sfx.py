"""
The interface sounds, played by the same orchestra as the menu theme and in its key (B minor /
D major), so a press never clashes with the music underneath.

    python tools/audio/sfx.py            -> public/audio/sfx/*.ogg
    python tools/audio/sfx.py launch     only the named sounds

Each file is levelled to its place in LEVELS, so the game plays them all at the same gain.
"""
from __future__ import annotations

import sys

import numpy as np
from scipy import signal

import crowd
import synth
from orchestra import OUT, SR, Mix, Orchestra, Seat, _k_weight, db, hall_ir, highpass, limit, lowpass, midi, mixdown, sample, shelf, write

PERC = "Percussion/"
V1 = "VSCO 1 Percussion/"

# Loudest tenth of a second of each sound (dB, K-weighted). The launch is simply as loud as it goes.
LEVELS = {
    "move": -25.0,
    "count": -31.0,
    "tab": -19.5,
    "toggle-on": -19.5,
    "toggle-off": -20.5,
    "select": -16.5,
    "back": -17.5,
    "pause": -16.5,
    "resume": -16.5,
    "error": -15.0,
    "add": -15.5,
    "hold": -15.0,
    "star": -15.5,
    "best": -11.0,
    "applause": -15.5,
    "cheer": -12.5,
    "finale": -13.5,
}

CENTRE = Seat(0.0, wet=0.22, width=0.5)
LEFT = Seat(-0.25, wet=0.25, width=0.5)
RIGHT = Seat(0.25, wet=0.25, width=0.5)
LOW = Seat(0.1, wet=0.15, width=0.4)

o = Orchestra(seed=21)
ROOM = hall_ir(0.9, predelay=0.006, seed=3)
HALL = hall_ir(2.4, seed=7)
STAGE = hall_ir(1.3, predelay=0.01, seed=5)


def pluck(mix: Mix, seat: Seat, inst: str, art: str, note: int | str, vel: float, t: float, decay: float | None = None, skip: int = 0, gain: float = 1.0):
    """A one-shot, optionally damped: `decay` is the time (s) it takes to fall away by 60 dB."""
    n = midi(note) if isinstance(note, str) else note
    x = o.render(inst, art, n, vel, skip=skip)
    if decay is not None:
        m = min(len(x), int(decay * 1.2 * SR))
        x = x[:m] * np.exp(-6.9 * np.arange(m) / (decay * SR))[:, None].astype(np.float32)
    mix.add(x * gain, t, seat)


def held(mix: Mix, seat: Seat, inst: str, art: str, note: int | str, vel: float, t: float, dur: float, **kw):
    o.play(mix, seat, inst, art, midi(note) if isinstance(note, str) else note, vel, t, dur, **kw)


def loudest(x: np.ndarray) -> float:
    y = (_k_weight(x.astype(np.float64)) ** 2).sum(axis=1)
    k = int(0.1 * SR)
    if len(y) <= k:
        return float(-0.691 + 10 * np.log10(y.sum() / k + 1e-12))
    c = np.concatenate(([0.0], np.cumsum(y)))
    return float(-0.691 + 10 * np.log10((c[k:] - c[:-k]).max() / k + 1e-12))


def finish(name: str, x: np.ndarray, level: float | None, *, fade_out: float = 0.04, floor_db: float = -66.0):
    """Trim the silence, level the sound and write it."""
    env = np.abs(x).max(axis=1)
    peak = env.max()
    live = np.nonzero(env > peak * db(floor_db))[0]
    x = x[: live[-1] + 1].copy()
    f = min(len(x), int(fade_out * SR))
    x[-f:] *= (np.linspace(1, 0, f, dtype=np.float32) ** 2)[:, None]
    if level is None:
        x = x * (db(-1.0) / np.abs(x).max())
    else:
        x = x * db(level - loudest(x))
        if np.abs(x).max() > db(-1.0):
            x = limit(x, ceiling_db=-1.0, lookahead=0.002, release=0.05)
    write(OUT / "sfx" / f"{name}.ogg", x.astype(np.float32), quality=0.7)
    print(f"{name:12s} {len(x) / SR:5.2f} s  loudest {loudest(x):6.1f}  peak {20 * np.log10(np.abs(x).max()):5.1f} dBFS")


def room(mix: Mix, tail: float = 0.8, wet_db: float = -6.0) -> np.ndarray:
    return mixdown(mix, ROOM, wet_db=wet_db, tail=tail)


# ---------------------------------------------------------------- the small sounds


def move(k: int) -> np.ndarray:
    # A fingertip on a string: one soft, damped note. Three takes of it, so repeats do not machine-gun.
    m = Mix(0.3)
    pluck(m, CENTRE, "harp", "pluck", "A5", 0.5, 0.0, decay=0.11, skip=k)
    pluck(m, CENTRE, "violins", "pizz", "A5", 0.4, 0.002, decay=0.07, skip=k, gain=0.5)
    return highpass(room(m, 0.25, -10), 350)


def select() -> np.ndarray:
    m = Mix(0.8)
    pluck(m, LEFT, "harp", "pluck", "D5", 0.7, 0.0, decay=0.5)
    pluck(m, RIGHT, "harp", "pluck", "A5", 0.75, 0.06, decay=0.7)
    pluck(m, RIGHT, "glock", "hit", "A6", 0.6, 0.06, decay=0.5, gain=0.45)
    pluck(m, LOW, "celli", "pizz", "D3", 0.6, 0.0, decay=0.35, gain=0.8)
    return room(m, 0.7)


def back() -> np.ndarray:
    m = Mix(0.8)
    pluck(m, RIGHT, "harp", "pluck", "A5", 0.6, 0.0, decay=0.3)
    pluck(m, LEFT, "harp", "pluck", "D5", 0.6, 0.06, decay=0.5)
    pluck(m, LOW, "celli", "pizz", "A2", 0.5, 0.06, decay=0.3, gain=0.8)
    return lowpass(room(m, 0.6), 6500)


def tab() -> np.ndarray:
    # A page turning: four strings brushed upwards.
    m = Mix(0.6)
    for i, n in enumerate(("D5", "E5", "F#5", "A5")):
        pluck(m, Seat(-0.3 + 0.2 * i, wet=0.25, width=0.5), "harp", "pluck", n, 0.4 + 0.08 * i, i * 0.024, decay=0.28)
    o.hit(m, CENTRE, PERC + "susCymb1-hit_pp_rr1.wav", 0.0, 0.05, length=0.3, fade=0.25)
    return room(m, 0.5)


def toggle(on: bool) -> np.ndarray:
    m = Mix(0.6)
    a, b = ("B5", "F#6") if on else ("F#6", "B5")
    pluck(m, CENTRE, "glock", "hit", a, 0.6, 0.0, decay=0.25, gain=0.8)
    pluck(m, CENTRE, "glock", "hit", b, 0.65, 0.055, decay=0.4 if on else 0.25)
    pluck(m, CENTRE, "harp", "pluck", midi(b) - 12, 0.5, 0.055, decay=0.3, gain=0.7)
    return room(m, 0.5)


def pause() -> np.ndarray:
    # The music stops: two plucked steps down onto a soft drum.
    m = Mix(0.9)
    pluck(m, LEFT, "celli", "pizz", "F#3", 0.6, 0.0, decay=0.3)
    pluck(m, RIGHT, "celli", "pizz", "B2", 0.65, 0.075, decay=0.5)
    pluck(m, LOW, "basses", "pizz", "B1", 0.5, 0.075, decay=0.5)
    pluck(m, CENTRE, "timpani", "hit", 47, 0.3, 0.075, decay=0.45, gain=0.6)
    return room(m, 0.6)


def resume() -> np.ndarray:
    m = Mix(0.8)
    pluck(m, RIGHT, "celli", "pizz", "B2", 0.6, 0.0, decay=0.3)
    pluck(m, LEFT, "celli", "pizz", "F#3", 0.65, 0.065, decay=0.4)
    pluck(m, LEFT, "harp", "pluck", "B4", 0.55, 0.065, decay=0.4)
    pluck(m, RIGHT, "harp", "pluck", "F#5", 0.6, 0.12, decay=0.5)
    return room(m, 0.6)


def error() -> np.ndarray:
    # Two dull knocks a tritone apart: clearly wrong, never harsh.
    m = Mix(0.9)
    for t in (0.0, 0.15):
        pluck(m, LOW, "basses", "pizz", "F2", 0.7, t, decay=0.22)
        pluck(m, CENTRE, "celli", "pizz", "B2", 0.7, t, decay=0.2)
        pluck(m, LOW, "tuba", "stac", "F2", 0.5, t, decay=0.16, gain=0.7)
        pluck(m, CENTRE, "timpani", "hit", 47, 0.3, t, decay=0.12, gain=0.5)
    return lowpass(room(m, 0.45, -9), 5000)


def add() -> np.ndarray:
    # A song joins the library: a harp runs up the chord and a bell answers.
    m = Mix(1.4)
    for i, n in enumerate(("D4", "A4", "D5", "F#5", "A5")):
        pluck(m, Seat(-0.35 + 0.15 * i, wet=0.28, width=0.5), "harp", "pluck", n, 0.5 + 0.06 * i, i * 0.045, decay=0.9)
    pluck(m, RIGHT, "glock", "hit", "D6", 0.6, 0.2, decay=0.8, gain=0.6)
    pluck(m, RIGHT, "glock", "hit", "A6", 0.6, 0.26, decay=0.9, gain=0.6)
    o.hit(m, LEFT, PERC + "Triangle3-Hit_v2_rr1_Sum.wav", 0.2, 0.06, length=1.0, fade=0.8)
    return room(m, 1.0)


def star(k: int) -> np.ndarray:
    # Each star rings one step higher up the D major chord; the fifth gets a shower of bells.
    note = ("D5", "F#5", "A5", "D6", "F#6")[k]
    m = Mix(2.2)
    pluck(m, CENTRE, "glock", "hit", midi(note) + 12, 0.7, 0.0, decay=1.4)
    pluck(m, LEFT, "harp", "pluck", note, 0.75, 0.0, decay=0.9)
    pluck(m, RIGHT, "harp", "pluck", midi(note) - 12, 0.6, 0.0, decay=0.7, gain=0.7)
    o.hit(m, RIGHT, PERC + f"Triangle3-Hit_v2_rr{1 + k % 2}_Sum.wav", 0.0, 0.07, length=1.4, fade=1.2)
    if k == 4:
        o.hit(m, CENTRE, PERC + "BellTree_Stroke3_v1_Sum.wav", 0.02, 0.3, length=2.0, fade=1.5)
        for i, n in enumerate(("A5", "D6", "F#6", "A6")):
            pluck(m, Seat(-0.3 + 0.2 * i, wet=0.3, width=0.5), "harp", "pluck", n, 0.5, 0.05 + i * 0.04, decay=0.8, gain=0.7)
    return room(m, 1.2, -5)


def count() -> np.ndarray:
    # The score counting up: the lightest possible tick.
    x = sample(V1 + "varWood/claves_pp1.wav")[: int(0.05 * SR)].copy()
    x *= np.exp(-6.9 * np.arange(len(x)) / (0.04 * SR))[:, None].astype(np.float32)
    return highpass(x, 1200)


def best() -> np.ndarray:
    # A new best score: a three-note brass call up to a held D major chord.
    tpt = Seat(0.15, wet=0.45, voices=3, width=0.6)
    hn = Seat(-0.3, wet=0.5, voices=3, width=0.7)
    tbn = Seat(0.35, wet=0.45, voices=2, width=0.7)
    m = Mix(3.2)
    step = 0.115
    for i, n in enumerate(("A4", "D5", "F#5")):
        o.play(m, tpt, "trumpet", "stac", midi(n), 0.85, i * step)
        o.play(m, hn, "horn", "stac", midi(n) - 12, 0.8, i * step)
    t = 3 * step
    for n in ("A4", "D5", "F#5", "A5"):
        held(m, tpt, "trumpet", "sus", n, 0.9, t, 1.1, release=0.35, shape=(1.0, 0.85, 0.9, 0.6))
    o.play(m, tpt, "trumpet", "stac", midi("A5"), 0.9, t)
    for n in ("D4", "F#4", "A3"):
        held(m, hn, "horn", "sus", n, 0.85, t, 1.1, release=0.35, shape=(1.0, 0.85, 0.9, 0.6))
    for n in ("D3", "A3"):
        held(m, tbn, "trombone", "sus", n, 0.8, t, 1.1, release=0.35, shape=(1.0, 0.85, 0.9, 0.6))
        o.play(m, tbn, "trombone", "stac", midi(n), 0.8, t)
    held(m, Seat(0.5, wet=0.4), "tuba", "sus", "D2", 0.75, t, 1.1, release=0.35)
    o.play(m, Seat(-0.05, wet=0.5), "timpani", "hit", 50, 0.9, t)
    o.hit(m, Seat(-0.15, wet=0.5), V1 + "varMetal/Cymbals/clash/crash_hit_ff_loose.wav", t - 0.1, 0.3, length=2.4, fade=1.8)
    for i, n in enumerate(("D5", "F#5", "A5", "D6", "F#6", "A6")):
        pluck(m, Seat(-0.6, wet=0.4, width=0.5), "harp", "pluck", n, 0.6, t - 0.12 + i * 0.02, decay=1.0, gain=0.7)
    pluck(m, Seat(-0.4, wet=0.5), "glock", "hit", "D7", 0.7, t, decay=1.5, gain=0.5)
    return mixdown(m, HALL, wet_db=-6.0, tail=2.0)


def hold() -> np.ndarray:
    """
    The Ready up button filling under a held press (0.65 s): a charge-up. A plucked cello marks the
    press; a timpani roll and tremolo violins swell on the key note underneath; a harp runs up two
    octaves, quicker as it climbs, with bells on its top notes; air opens upward and a cymbal
    swells into the end. It stops short of an arrival, because the launch is the arrival. Let go
    early and the game fades it out where it is.
    """
    length = 0.74
    m = Mix(length + 0.4)
    held(m, Seat(-0.08, wet=0.35), "timpani", "roll", 47, 0.9, 0.0, length, attack=0.04, release=0.08, shape=(0.3, 0.55, 1.0))
    for n, seat in (("B4", Seat(-0.4, wet=0.3, voices=2)), ("F#5", Seat(0.3, wet=0.3, voices=2))):
        held(m, seat, "violins", "trem", n, 0.85, 0.0, length, attack=0.05, release=0.08, shape=(0.25, 0.6, 1.0))
    pluck(m, LOW, "celli", "pizz", "B2", 0.85, 0.0, decay=0.32, gain=1.5)
    pluck(m, LOW, "basses", "pizz", "B1", 0.8, 0.0, decay=0.3, gain=1.0)

    notes = ("B3", "D4", "F#4", "A4", "B4", "D5", "E5", "F#5", "A5", "B5", "D6", "F#6", "A6", "B6")
    # Each step a little shorter than the last, so the run gathers speed toward the top.
    gaps = np.geomspace(0.074, 0.027, len(notes) - 1)
    t = 0.0
    for i, n in enumerate(notes):
        k = i / (len(notes) - 1)
        pluck(m, Seat(-0.45 + 0.9 * k, wet=0.25, width=0.5), "harp", "pluck", n, 0.7 + 0.25 * k, t, decay=0.24 + 0.14 * k, gain=2.4 - 1.3 * k)
        if k > 0.55:
            pluck(m, Seat(0.45 - 0.9 * k, wet=0.3, width=0.5), "glock", "hit", n, 0.55 + 0.2 * k, t, decay=0.35, gain=0.4)
        if i < len(gaps):
            t += float(gaps[i])
    o.hit(m, Seat(0.0, wet=0.3), PERC + "susCymb1-hit_pp_rr1.wav", 0.0, 0.3, length=0.7, fade=0.6, reverse=True)

    x = highpass(room(m, 0.3, -8), 60)[: int(length * SR)]
    # Air opening upward under the players, growing with them.
    air = synth.riser(length, np.random.default_rng(9), start=320, end=6800)[: len(x)]
    air *= (np.linspace(0, 1, len(air), dtype=np.float32) ** 1.6)[:, None]
    x[: len(air)] += air * (np.abs(x).max() / max(float(np.abs(air).max()), 1e-6)) * 0.22
    # One swell over the whole of it.
    return x * np.linspace(0.65, 1.0, len(x), dtype=np.float32)[:, None]

# ---------------------------------------------------------------- the launch


def sheen(seconds: float = 0.5, seed: int = 4) -> np.ndarray:
    """Steel being drawn: a cluster of high, slightly rising partials that die away fast."""
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2), dtype=np.float32)
    for _ in range(16):
        f = rng.uniform(2600, 9800) * (1 + rng.uniform(0.01, 0.05) * (1 - np.exp(-t / 0.08)))
        x = np.sin(2 * np.pi * np.cumsum(f) / SR + rng.uniform(0, 6)) * np.exp(-t / rng.uniform(0.06, 0.22))
        out += synth.stereo(x.astype(np.float32) * rng.uniform(0.3, 1.0), rng.uniform(-0.8, 0.8))
    out *= (1 - np.exp(-t / 0.002))[:, None].astype(np.float32)
    return out / np.abs(out).max()


def launch() -> np.ndarray:
    """
    Starting a song, in the manner of a fighting game's "ready" confirm: no wind-up to speak
    of, one tight, bright slam that lands the instant the button goes down, a glint of bells
    after it, and the crowd answering.
    """
    hit_at = 0.085
    total = 4.8
    m = Mix(total)
    front = Seat(0.0, wet=0.3, width=0.7)
    cym = Seat(-0.12, wet=0.35)
    vln = Seat(-0.45, wet=0.32, voices=2)
    vla = Seat(0.2, wet=0.32, voices=2)
    vc = Seat(0.42, wet=0.3, voices=2)
    cb = Seat(0.6, wet=0.28, voices=2, width=0.6)
    hn = Seat(-0.3, wet=0.4, voices=3, width=0.7)
    tpt = Seat(0.18, wet=0.38, voices=3, width=0.6)
    tbn = Seat(0.38, wet=0.38, voices=2, width=0.7)

    # The draw: a cymbal played backwards for the blink before the hit.
    o.hit(m, cym, V1 + "varMetal/Cymbals/clash/crash_hit_ff_tight.wav", 0.0, 0.3, length=hit_at, fade=hit_at * 0.9, reverse=True)

    # The slam. Low: damped bass drum, a giant drum, timpani. Middle: a whip crack, a rimshot and
    # the brass and strings on a short open fifth. Top: an anvil, two choked cymbals, bells.
    t = hit_at
    o.hit(m, front, V1 + "drums/bass/bdrum_muted_fff_1.wav", t - 0.07, 1.0, length=0.9, fade=0.5)
    o.hit(m, Seat(-0.2, wet=0.3), V1 + "drums/other/ethnic/giant/mallet/EthnicLargeMallet_hit_ff_1.wav", t - 0.02, 0.9)
    o.play(m, Seat(-0.08, wet=0.4), "timpani", "hit", 47, 1.0, t)
    o.hit(m, front, V1 + "varWood/slapstick1.wav", t - 0.004, 0.75, length=0.5, fade=0.3)
    o.hit(m, Seat(0.1, wet=0.3), V1 + "drums/snare/drum3_marching/snare3_rimshot_ff_1.wav", t - 0.045, 0.6)
    o.hit(m, Seat(0.1, wet=0.3), PERC + "timpsnaretenor_fff.wav", t - 0.06, 0.4)
    o.hit(m, Seat(0.25, wet=0.35), PERC + "Anvil_Hit1_v3_Sum.wav", t - 0.004, 0.45, length=1.1, fade=0.8)
    o.hit(m, cym, PERC + "cymbal-crashshort_v1.wav", t - 0.004, 0.6)
    o.hit(m, Seat(0.2, wet=0.35), V1 + "varMetal/Cymbals/clash/crash_hit_ff_verytight.wav", t - 0.04, 0.5, length=1.6, fade=1.2)
    for n in ("B1", "B2", "F#3"):
        o.play(m, tbn, "trombone", "stac", max(midi(n), 34), 1.0, t)
    o.play(m, Seat(0.5, wet=0.35), "tuba", "stac", midi("B1"), 1.0, t)
    for n in ("B2", "F#3", "B3"):
        o.play(m, hn, "horn", "stac", midi(n), 1.0, t)
    for n in ("B3", "F#4", "B4", "F#5"):
        o.play(m, tpt, "trumpet", "stac", midi(n), 1.0, t)
    for n in ("B4", "F#5", "B5"):
        o.play(m, vln, "violins", "spic", midi(n), 1.0, t)
    for n in ("B3", "F#4"):
        o.play(m, vla, "violas", "spic", midi(n), 1.0, t)
    o.play(m, vc, "celli", "spic", midi("B2"), 1.0, t)
    o.play(m, cb, "basses", "spic", midi("B1"), 1.0, t)

    # The glint: bells running up out of the hit.
    o.hit(m, Seat(-0.3, wet=0.4), PERC + "BellTree_Stroke3_v1_Sum.wav", t, 0.3, length=1.6, fade=1.2)
    for i, n in enumerate(("B5", "D6", "F#6", "B6")):
        when = t + 0.06 + i * 0.042
        pluck(m, Seat(-0.3 + 0.2 * i, wet=0.4, width=0.5), "glock", "hit", n, 0.75, when, decay=0.9, gain=0.55)
        pluck(m, Seat(0.3 - 0.2 * i, wet=0.4, width=0.5), "harp", "pluck", midi(n) - 12, 0.7, when, decay=0.7, gain=0.6)

    x = mixdown(m, STAGE, wet_db=-7.0, tail=0.0)
    level = float(np.abs(x).max())
    i = int(t * SR)

    # A synthesized kick for the punch in the chest, a short drop under it, and the sheen of steel.
    for extra, gain in ((synth.kick(1.0, low=50, sweep=170, length=0.5), 0.8), (synth.boom(1.0, top=95, bottom=44, length=0.7), 0.35), (sheen(), 0.3)):
        x[i : i + len(extra)] += extra[: len(x) - i] * gain * level

    # The crowd, answering at once and settling quickly: the hit is the point.
    people = crowd.arena(crowd.cheer(total, peak_at=hit_at + 0.5, hold=0.9, decay=2.9, seed=5, people=200, whistles=7, clapping=0.5))[: len(x)]
    hit_level = float(np.sqrt((x[i : i + SR // 4] ** 2).mean()))
    crowd_level = float(np.sqrt((people[int(1.0 * SR) : int(1.8 * SR)] ** 2).mean()))
    x[: len(people)] += people * (hit_level / crowd_level) * db(-13.0)

    x = shelf(highpass(x, 28), 3500, 2.0)
    x = x * (db(2.5) / np.abs(x).max())  # into the limiter: a slam should be dense
    return limit(x, ceiling_db=-1.0, lookahead=0.003, release=0.09)


def results_crowd(big: bool) -> np.ndarray:
    """The end of a song: a proper cheer for a good run, warm applause otherwise."""
    if big:
        x = crowd.cheer(6.6, peak_at=0.55, hold=1.7, decay=4.2, seed=12, people=240, whistles=8, clapping=0.9)
    else:
        x = crowd.cheer(5.0, peak_at=0.5, hold=1.1, decay=3.2, seed=14, people=45, whistles=1, clapping=1.4, excitement=0.45)
    return highpass(crowd.arena(x), 120)


def finale_crowd() -> np.ndarray:
    """
    The end of a song, while the stage fires off its finale: the whole crowd clapping and cheering
    for about four seconds, up at once and held, then down quickly as the result comes up.
    """
    # Real people: recordings of applause and cheering, when they are there. A synthesized crowd
    # of this size has no distinct hands in it and comes out as wind.
    x = crowd.recorded_ovation(4.9)
    if x is None:
        x = crowd.ovation(4.9, peak_at=0.25, hold=3.4, decay=1.15)
    # Less of the diffuse wash than a cheer gets: it would smear the claps back into noise.
    return highpass(crowd.arena(x, wet_db=-16.0), 120)


SOUNDS = {
    "move-1": lambda: move(0),
    "move-2": lambda: move(1),
    "move-3": lambda: move(2),
    "select": select,
    "back": back,
    "tab": tab,
    "toggle-on": lambda: toggle(True),
    "toggle-off": lambda: toggle(False),
    "pause": pause,
    "resume": resume,
    "error": error,
    "add": add,
    "hold": hold,
    **{f"star-{k + 1}": (lambda k=k: star(k)) for k in range(5)},
    "count": count,
    "best": best,
    "launch": launch,
    "cheer": lambda: results_crowd(True),
    "applause": lambda: results_crowd(False),
    "finale": finale_crowd,
}


def main():
    only = [a for a in sys.argv[1:] if not a.startswith("-")]
    for name, make in SOUNDS.items():
        if only and not any(name.startswith(a) for a in only):
            continue
        x = make()
        family = name.rsplit("-", 1)[0] if name[-1].isdigit() else name
        finish(name, x, LEVELS.get(family), fade_out=0.6 if family in ("launch", "cheer", "applause", "finale") else 0.04)
        if "--wav" in sys.argv:
            import soundfile as sf

            from orchestra import ROOT

            (ROOT / "local-audio" / "sfx").mkdir(exist_ok=True)
            y, _ = sf.read(str(OUT / "sfx" / f"{name}.ogg"))
            sf.write(str(ROOT / "local-audio" / "sfx" / f"{name}.wav"), y, SR)


if __name__ == "__main__":
    main()
