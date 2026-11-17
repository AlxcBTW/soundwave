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
from orchestra import OUT, SR, Mix, Orchestra, Seat, _k_weight, db, hall_ir, highpass, limit, lowpass, midi, mixdown, sample, write

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
    "star": -15.5,
    "best": -11.0,
    "applause": -15.5,
    "cheer": -12.5,
}

CENTRE = Seat(0.0, wet=0.22, width=0.5)
LEFT = Seat(-0.25, wet=0.25, width=0.5)
RIGHT = Seat(0.25, wet=0.25, width=0.5)
LOW = Seat(0.1, wet=0.15, width=0.4)

o = Orchestra(seed=21)
ROOM = hall_ir(0.9, predelay=0.006, seed=3)
HALL = hall_ir(2.4, seed=7)


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


# ---------------------------------------------------------------- the launch


def launch() -> np.ndarray:
    """
    Starting a song: half a second of everything rushing upward, one enormous downbeat, and
    the crowd going up as it rings out.
    """
    hit_at = 0.62  # the wipe has closed over the screen by now
    total = 7.4
    m = Mix(total)
    back_row = Seat(0.0, wet=0.55, width=0.9)
    cym = Seat(-0.15, wet=0.5)
    vln = Seat(-0.45, wet=0.4, voices=2)
    vc = Seat(0.42, wet=0.36, voices=2)
    cb = Seat(0.6, wet=0.32, voices=3, width=0.6)
    hn = Seat(-0.3, wet=0.55, voices=4, width=0.7)
    tpt = Seat(0.18, wet=0.5, voices=3, width=0.6)
    tbn = Seat(0.38, wet=0.5, voices=3, width=0.7)

    # The rush: a cymbal played backwards, rolls on timpani and snare, tremolo strings, a harp run.
    o.hit(m, cym, V1 + "varMetal/Cymbals/clash/crash_hit_ff_loose.wav", 0.0, 0.5, length=hit_at, fade=hit_at * 0.9, reverse=True)
    held(m, Seat(-0.08, wet=0.5), "timpani", "roll", 54, 0.9, 0.0, hit_at - 0.03, release=0.04, attack=0.1, shape=(0.1, 0.4, 1.0))
    roll = sample(PERC + "Snare2-rollSN_v3_rr1_Sum.wav")[: int(hit_at * SR)].copy()
    roll *= (np.linspace(0.05, 1, len(roll), dtype=np.float32) ** 2)[:, None]
    m.add(roll * (0.3 / np.abs(roll).max()), 0.0, Seat(0.12, wet=0.45))
    for n in ("F#5", "A#5", "C#6"):
        held(m, vln, "violins", "trem", n, 0.8, 0.0, hit_at - 0.04, release=0.05, attack=0.15, shape=(0.1, 0.45, 1.15))
    held(m, vc, "celli", "sus", "F#2", 0.8, 0.0, hit_at - 0.04, release=0.05, attack=0.15, shape=(0.2, 0.5, 1.1))
    run = [47 + s + 12 * k for k in range(3) for s in (0, 2, 3, 5, 7, 8, 11)][3:19]
    for i, n in enumerate(run):
        pluck(m, Seat(-0.6, wet=0.4, width=0.5), "harp", "pluck", n, 0.5 + 0.4 * i / len(run), 0.14 + (hit_at - 0.16) * i / len(run), decay=0.8)

    # The downbeat: every drum on the stage, low brass and horns on an open fifth, trumpets on top.
    t = hit_at
    o.hit(m, back_row, V1 + "drums/bass/bdrum_fff_2.wav", t - 0.07, 1.0, length=4.5, fade=2.0)
    o.hit(m, back_row, V1 + "drums/bass/bdrum3_fff_1.wav", t - 0.07, 0.7, pitch=-4, length=4.5, fade=2.0)
    o.hit(m, Seat(-0.3, wet=0.5), V1 + "drums/other/ethnic/giant/mallet/EthnicLargeMallet_hit_ff_1.wav", t - 0.02, 0.9)
    o.hit(m, Seat(0.3, wet=0.5), V1 + "drums/other/ethnic/giant/mallet/EthnicLargeMallet_hit_ff_2.wav", t - 0.008, 0.8, pitch=-2)
    o.hit(m, Seat(0.1, wet=0.45), PERC + "timpsnaretenor_fff.wav", t - 0.06, 0.45)
    o.play(m, Seat(-0.08, wet=0.55), "timpani", "hit", 47, 1.0, t)
    o.play(m, Seat(-0.08, wet=0.55), "timpani", "hit", 54, 0.9, t + 0.004)
    o.hit(m, cym, V1 + "varMetal/Cymbals/clash/crash_hit_fff_loose.wav", t - 0.1, 0.8, length=6.0, fade=3.5)
    o.hit(m, Seat(0.2, wet=0.5), PERC + "cymbal-crash1_ff_rr1.wav", t - 0.03, 0.5, length=6.0, fade=4.0)
    o.hit(m, cym, PERC + "gongHit_fff.wav", t - 0.15, 0.5, length=6.5, fade=5.0)
    ring = (1.0, 0.8, 0.55, 0.3)
    for n in ("B1", "B2", "F#3", "B3"):
        held(m, tbn, "trombone", "sus", max(midi(n), 34), 1.0, t, 1.5, release=0.6, shape=ring)
        o.play(m, tbn, "trombone", "stac", max(midi(n), 34), 1.0, t)
    held(m, Seat(0.5, wet=0.45), "tuba", "sus", "B1", 1.0, t, 1.5, release=0.6, shape=ring)
    for n in ("B2", "F#3", "B3"):
        held(m, hn, "horn", "sus", n, 1.0, t, 1.5, release=0.6, shape=ring)
        o.play(m, hn, "horn", "stac", midi(n), 1.0, t)
    for n in ("B3", "F#4", "B4", "F#5"):
        held(m, tpt, "trumpet", "sus", n, 1.0, t, 1.3, release=0.5, shape=ring)
        o.play(m, tpt, "trumpet", "stac", midi(n), 1.0, t)
    for n in ("B4", "F#5", "B5"):
        o.play(m, vln, "violins", "spic", midi(n), 1.0, t)
        held(m, vln, "violins", "trem", n, 0.9, t, 2.2, release=0.9, shape=(1.0, 0.6, 0.35, 0.15))
    o.play(m, vc, "celli", "spic", midi("B2"), 1.0, t)
    o.play(m, cb, "basses", "spic", midi("B1"), 1.0, t)
    held(m, cb, "basses", "sus", "B1", 0.9, t, 1.8, release=0.8, shape=ring)

    x = mixdown(m, HALL, wet_db=-4.0, tail=0.0)

    # Under it, felt more than heard: a sine that drops as the drum head settles.
    n = int(1.1 * SR)
    f = 68 * np.exp(-np.arange(n) / (0.35 * SR)) + 36
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-np.arange(n) / (0.32 * SR)) * (1 - np.exp(-np.arange(n) / (0.004 * SR)))
    i = int(t * SR)
    x[i : i + n] += (sub * 0.5 * np.abs(x).max())[:, None].astype(np.float32)

    # The crowd: already stirring before the hit, at full voice a second after it.
    people = crowd.arena(crowd.cheer(total, peak_at=hit_at + 0.95, hold=1.9, decay=3.6, seed=5, people=260, whistles=10, clapping=0.55))
    people = people[: len(x)]
    orchestra_peak = float(np.sqrt((x[i : i + SR // 2] ** 2).mean()))
    crowd_level = float(np.sqrt((people[int(2.0 * SR) : int(3.0 * SR)] ** 2).mean()))
    x[: len(people)] += people * (orchestra_peak / crowd_level) * db(-10.5)

    x = highpass(x, 26)
    x = x * (db(1.5) / np.abs(x).max())  # lean into the limiter a little: this one should feel huge
    return limit(x, ceiling_db=-1.0, lookahead=0.004, release=0.18)


def results_crowd(big: bool) -> np.ndarray:
    """The end of a song: a proper cheer for a good run, warm applause otherwise."""
    if big:
        x = crowd.cheer(6.6, peak_at=0.55, hold=1.7, decay=4.2, seed=12, people=240, whistles=8, clapping=0.9)
    else:
        x = crowd.cheer(5.0, peak_at=0.5, hold=1.1, decay=3.2, seed=14, people=45, whistles=1, clapping=1.4, excitement=0.45)
    return highpass(crowd.arena(x), 120)


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
    **{f"star-{k + 1}": (lambda k=k: star(k)) for k in range(5)},
    "count": count,
    "best": best,
    "launch": launch,
    "cheer": lambda: results_crowd(True),
    "applause": lambda: results_crowd(False),
}


def main():
    only = [a for a in sys.argv[1:] if not a.startswith("-")]
    for name, make in SOUNDS.items():
        if only and not any(name.startswith(a) for a in only):
            continue
        x = make()
        family = name.rsplit("-", 1)[0] if name[-1].isdigit() else name
        finish(name, x, LEVELS.get(family), fade_out=0.6 if family in ("launch", "cheer", "applause") else 0.04)
        if "--wav" in sys.argv:
            import soundfile as sf

            from orchestra import ROOT

            (ROOT / "local-audio" / "sfx").mkdir(exist_ok=True)
            y, _ = sf.read(str(OUT / "sfx" / f"{name}.ogg"))
            sf.write(str(ROOT / "local-audio" / "sfx" / f"{name}.wav"), y, SR)


if __name__ == "__main__":
    main()
