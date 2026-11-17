"""
The main-menu theme: an orchestral piece in B minor, 38 bars at 100 BPM, written to loop.

    python tools/audio/theme.py            -> public/audio/menu-theme.ogg
    python tools/audio/theme.py --stems    also prints how loud each group is in each section

The form: a two-bar opening hit and vamp, the theme on a solo horn (A), again with celli and
horns as the orchestra builds (B), the full orchestra (C), a second, major-key theme (D), and
four quiet bars that swell back into the opening hit (E).
"""
from __future__ import annotations

import sys

import numpy as np

from orchestra import OUT, SR, Mix, Orchestra, Seat, db, hall_ir, highpass, level_ride, limit, lufs, midi, shelf, write
from scipy import signal

BPM = 100
BEAT = 60 / BPM
BARS = 38
LOOP = BARS * 4 * BEAT
PRE = 1.0  # room before bar 1 for notes that start early; folded onto the end of the loop

V, A, B, C, D, E = 0, 2, 10, 18, 26, 34  # first bar of each section

# root, third, fifth as pitch classes
CHORDS = {"Bm": (11, 2, 6), "G": (7, 11, 2), "D": (2, 6, 9), "A": (9, 1, 4), "Em": (4, 7, 11), "F#": (6, 10, 1)}
THEME_PROG = ["Bm", "G", "D", "A", "Bm", "G", "Em", "F#"]
PROG = ["Bm", "Bm"] + THEME_PROG * 3 + ["G", "A", "Bm", "D", "G", "A", "D", "A"] + ["Bm", "G", "Em", "F#"]
assert len(PROG) == BARS

# The theme, at trumpet pitch: (note, beats) per bar.
THEME = [
    [("B3", 1.5), ("D4", 0.5), ("F#4", 2)],
    [("G4", 1.5), ("F#4", 0.5), ("D4", 2)],
    [("D4", 1.5), ("F#4", 0.5), ("A4", 2)],
    [("C#5", 1.5), ("B4", 0.5), ("A4", 1), ("E4", 1)],
    [("B4", 3), ("A4", 0.5), ("B4", 0.5)],
    [("D5", 1.5), ("C#5", 0.5), ("B4", 2)],
    [("G4", 1), ("B4", 1), ("E5", 2)],
    [("F#5", 2), ("C#5", 1), ("A#4", 1)],
]
# The second theme, over G A Bm D G A D A.
THEME2 = [
    [("B4", 2), ("D5", 1), ("G5", 1)],
    [("A5", 1.5), ("G5", 0.5), ("E5", 2)],
    [("F#5", 2), ("D5", 1), ("B4", 1)],
    [("A4", 1), ("D5", 1), ("F#5", 2)],
    [("G5", 2), ("F#5", 1), ("E5", 1)],
    [("E5", 1.5), ("C#5", 0.5), ("A5", 2)],
    [("F#5", 1), ("A5", 3)],
    [("G5", 1), ("F#5", 1), ("E5", 2)],
]
# What the horns play under it.
COUNTER = [
    [("B3", 2), ("D4", 2)],
    [("C#4", 2), ("E4", 2)],
    [("D4", 2), ("F#4", 2)],
    [("F#4", 4)],
    [("B3", 2), ("D4", 2)],
    [("C#4", 2), ("E4", 2)],
    [("F#4", 4)],
    [("E4", 4)],
]
ECHO = [[("B2", 1.5), ("D3", 0.5), ("F#3", 2)], [("G3", 1.5), ("F#3", 0.5), ("D3", 2)]]

SEATS = {
    "vln1": Seat(-0.5, wet=0.38, voices=2),
    "vln2": Seat(-0.22, wet=0.36, voices=2),
    "vla": Seat(0.2, wet=0.36, voices=2),
    "vc": Seat(0.42, wet=0.34, voices=2),
    "cb": Seat(0.6, wet=0.3, voices=3, width=0.6),
    "harp": Seat(-0.62, wet=0.42, width=0.6),
    "hn": Seat(-0.3, wet=0.58, voices=4, width=0.7),
    "hn1": Seat(-0.3, gain_db=3.5, wet=0.62, width=0.7),
    "tpt": Seat(0.18, wet=0.5, voices=3, width=0.6),
    "tbn": Seat(0.38, wet=0.5, voices=2, width=0.7),
    "tba": Seat(0.5, wet=0.45, width=0.6),
    "timp": Seat(-0.08, wet=0.55, width=0.8),
    "perc": Seat(0.05, wet=0.55, width=0.9),
    "snare": Seat(0.12, wet=0.5, width=0.7),
    "cym": Seat(-0.15, wet=0.5),
    "glock": Seat(-0.4, wet=0.5, width=0.5),
}

# How loud each group may get at its loudest, relative to the trumpets (dB). Stems are levelled
# to these after rendering, so the balance does not depend on how hot each sample was recorded.
BALANCE = {
    "trumpets": 0.0,
    "horns": -1.5,
    "strings_hi": -2.5,
    "strings_ost": -7.5,
    "strings_lo": -4.5,
    "lowbrass": -4.0,
    "timpani": -4.5,
    "drums": -4.5,
    "metal": -8.5,
    "harp": -8.0,
    "mallets": -11.0,
}

PERC = "Percussion/"
V1 = "VSCO 1 Percussion/"


def at(bar: float, beat: float = 0.0) -> float:
    return PRE + (bar * 4 + beat) * BEAT


def near(pc: int, ref: int) -> int:
    """The note with pitch class `pc` closest to `ref`."""
    n = ref - ((ref - pc) % 12)
    return n if ref - n <= 6 else n + 12


class Score:
    def __init__(self):
        self.o = Orchestra(seed=3)
        self.rng = np.random.default_rng(11)
        self.stems = {name: Mix(PRE + LOOP) for name in BALANCE}

    # -- helpers

    def note(self, stem: str, seat: str, inst: str, art: str, note: int, vel: float, t: float, dur: float | None = None, **kw):
        self.o.play(self.stems[stem], SEATS[seat], inst, art, note, min(1.0, vel), t, dur, **kw)

    def short(self, stem: str, seat: str, inst: str, art: str, note: int, vel: float, t: float):
        """A short note, played by a person: never quite on the grid or at the same strength."""
        self.note(stem, seat, inst, art, note, vel * self.rng.uniform(0.92, 1.06), t + self.rng.normal(0, 0.004))

    def hit(self, stem: str, seat: str, rel: str, t: float, level: float, **kw):
        self.o.hit(self.stems[stem], SEATS[seat], rel, t, level, **kw)

    def line(self, stem: str, seat: str, inst: str, bars: list, start: int, vel: float, *, transpose: int = 0, marcato: str | None = None, advance: float = 0.0, release: float = 0.22, attack: float = 0.0, dyn: tuple[float, float] = (1.0, 1.0)):
        """A melody. `dyn` scales the velocity from the first bar to the last."""
        for i, bar in enumerate(bars):
            pos = 0.0
            k = dyn[0] + (dyn[1] - dyn[0]) * i / max(1, len(bars) - 1)
            for name, beats in bar:
                n = midi(name) + transpose
                t = at(start + i, pos) - advance
                # Long notes swell a little; short ones lean into the next.
                shape = (0.86, 1.0, 0.92) if beats >= 2 else (0.95, 1.0)
                v = vel * k * (1.04 if pos == 0 else 1.0)
                self.note(stem, seat, inst, "sus", n, v, t, beats * BEAT + 0.04, release=release, attack=attack, shape=shape)
                if marcato:
                    self.short(stem, seat, inst, marcato, n, v * 0.8, t + advance * 0.5)
                pos += beats

    def tones(self, bar: int) -> tuple[int, int, int]:
        return CHORDS[PROG[bar]]

    # -- the parts

    def ostinato(self):
        """The pulse under everything: a galloping figure on the chord, violas first."""
        accents = [1.0, 0, 0.62, 0.76, 0.88, 0, 0.6, 0.72]

        def level(bar: float) -> tuple[float, float]:
            # (violas, second violins an octave up)
            if bar < 1:
                return 0, 0
            if bar < B:
                return 0.36 + 0.1 * (bar - 1) / (B - 1), 0
            if bar < C:
                k = (bar - B) / (C - B)
                return 0.45 + 0.3 * k, (0.4 + 0.35 * (bar - 14) / 4) if bar >= 14 else 0
            if bar < D + 7:
                return 0.82, 0.82
            if bar < E:
                return 0.6, 0.55
            return 0.3 + (0.25 if bar >= 37 else 0), 0

        for bar in range(BARS):
            r, t, f = self.tones(bar)
            root = near(r, 59)
            third = root + (t - r) % 12
            low = root - (r - f) % 12
            cell = [root, None, low, root, third, None, low, third]
            for half in range(2):
                for i, n in enumerate(cell):
                    if n is None:
                        continue
                    when = at(bar, half * 2 + i * 0.25)
                    va, vn = level(bar + (half * 2 + i * 0.25) / 4)
                    if va:
                        self.short("strings_ost", "vla", "violas", "spic", n, va * accents[i], when)
                    if vn:
                        self.short("strings_ost", "vln2", "violins", "spic", n + 12, vn * accents[i], when)

    def low_strings(self):
        for bar in range(BARS):
            r, _, f = self.tones(bar)
            root = near(r, 45)
            bass = root - 12
            full = C <= bar < E
            vel = 0.46 if bar < B else 0.55 if bar < C else 0.8 if full else 0.42
            if bar >= 36:
                vel = 0.4 + 0.2 * (bar - 36)
            swell = (0.9, 1.0, 0.85)
            self.note("strings_lo", "cb", "basses", "sus", bass, vel, at(bar) - 0.03, 4 * BEAT, release=0.3, attack=0.05, shape=swell)
            if not (B <= bar < C):  # the celli carry the theme in B
                self.note("strings_lo", "vc", "celli", "sus", root, vel, at(bar) - 0.04, 4 * BEAT, release=0.3, attack=0.05, shape=swell)
                if not full:
                    self.note("strings_lo", "vc", "celli", "sus", root + (f - r) % 12, vel * 0.85, at(bar) - 0.04, 4 * BEAT, release=0.3, attack=0.06, shape=swell)
            if full:
                last = bar == E - 1
                for e in range(8):  # driving eighths on the root
                    v = (0.85 if e % 2 == 0 else 0.62) * (1 - 0.06 * e if last else 1)
                    self.short("strings_lo", "vc", "celli", "spic", root, v, at(bar, e * 0.5))
            if 14 <= bar < E:
                for q in range(4):
                    self.short("strings_lo", "cb", "basses", "spic", bass, (0.5 + 0.08 * (bar - 14)) if bar < C else 0.8, at(bar, q))

    def harp(self):
        def arp(bar: int, vel: float):
            r, t, f = self.tones(bar)
            root = near(r, 47)
            up = [root, root + (f - r) % 12, root + 12, root + 12 + (t - r) % 12, root + 12 + (f - r) % 12]
            for e, k in enumerate([0, 1, 2, 3, 4, 3, 2, 1]):
                self.short("harp", "harp", "harp", "pluck", up[k], vel * (1.0 if e % 4 == 0 else 0.82), at(bar, e * 0.5))

        for bar in range(1, C):
            arp(bar, 0.5 if bar < B else 0.6)
        for bar in range(E, BARS):
            arp(bar, 0.5)
        # Glissandi into the big downbeats: up the scale in the last beat of the bar before.
        for target in (C, D, BARS):
            scale = [2, 4, 6, 7, 9, 11, 13] if target == D else [2, 4, 6, 7, 9, 10, 13]  # D major, or B harmonic minor
            notes = [48 + 12 * o + s for o in range(3) for s in scale][2:19]
            for i, n in enumerate(notes):
                self.note("harp", "harp", "harp", "pluck", n, 0.45 + 0.4 * i / len(notes), at(target) - BEAT * 1.1 * (1 - i / len(notes)))

    def themes(self):
        # A: one horn, alone.
        self.line("horns", "hn1", "horn", THEME, A, 0.56, transpose=-12, attack=0.03, dyn=(0.95, 1.08))
        # B: celli and two horns, growing.
        self.line("strings_lo", "vc", "celli", THEME, B, 0.72, transpose=-12, advance=0.04, attack=0.04, dyn=(0.9, 1.15))
        self.line("horns", "hn", "horn", THEME, B, 0.62, transpose=-12, attack=0.02, dyn=(0.85, 1.15))
        # C: everyone. Trumpets on top, horns an octave under, violins an octave over.
        self.line("trumpets", "tpt", "trumpet", THEME, C, 0.92, marcato="stac", attack=0.01)
        self.line("horns", "hn", "horn", THEME, C, 0.92, transpose=-12, marcato="stac")
        self.line("strings_hi", "vln1", "violins", THEME, C, 0.9, transpose=12, advance=0.045, attack=0.03)
        self.line("strings_hi", "vla", "violas", THEME, C, 0.85, advance=0.045, attack=0.03)
        # D: the second theme, trumpets and violins together, horns answering underneath.
        self.line("trumpets", "tpt", "trumpet", THEME2, D, 0.95, marcato="stac", attack=0.01)
        self.line("strings_hi", "vln1", "violins", THEME2, D, 0.92, advance=0.045, attack=0.03)
        self.line("strings_hi", "vla", "violas", THEME2, D, 0.85, transpose=-12, advance=0.045, attack=0.03)
        self.line("horns", "hn", "horn", COUNTER, D, 0.9, marcato="stac")
        for i, bar in enumerate(THEME2):  # a glockenspiel glints on top
            pos = 0.0
            for name, beats in bar:
                self.short("mallets", "glock", "glock", "hit", midi(name) + 12, 0.6, at(D + i, pos))
                pos += beats
        # E: the horn remembers how it started.
        self.line("horns", "hn1", "horn", ECHO, E, 0.46, attack=0.04)

    def high_strings(self):
        """Violins above the texture: a held shimmer in A, tremolo through the build, a quiet close."""

        def pair(bar: int) -> tuple[int, int]:
            r, t, f = self.tones(bar)
            top = near(f, 78)
            return near(t, top - 4), top

        for bar in range(A + 4, B):  # enter halfway through A
            for n in pair(bar):
                self.note("strings_hi", "vln1", "violins", "sus", n, 0.3, at(bar) - 0.05, 4 * BEAT, release=0.35, attack=0.25, shape=(0.8, 1.0, 0.9))
        for bar in range(B, C):
            k = (bar - B) / (C - B)
            for n in pair(bar):
                self.note("strings_hi", "vln1", "violins", "trem", n, 0.35 + 0.45 * k, at(bar) - 0.03, 4 * BEAT, release=0.3, attack=0.08, shape=(0.8, 1.0, 1.05 if bar < C - 1 else 1.5))
        for bar in range(E, BARS):
            vel = 0.34 if bar < 36 else 0.45 + 0.2 * (bar - 36)
            art = "trem" if bar == BARS - 1 else "sus"
            for n in pair(bar):
                self.note("strings_hi", "vln1", "violins", art, n, vel, at(bar) - 0.05, 4 * BEAT, release=0.35, attack=0.2, shape=(0.85, 1.0, 1.6) if bar == BARS - 1 else (0.9, 1.0, 0.9))
            r, _, _ = self.tones(bar)
            self.note("strings_hi", "vla", "violas", "sus", near(r, 62), vel, at(bar) - 0.05, 4 * BEAT, release=0.35, attack=0.2)

    def low_brass(self):
        def chord(bar: int, vel: float, beats: float = 4, shape=(1.0, 0.9, 0.82), stab: bool = True, tuba: bool = True, start: float = 0.0):
            r, t, f = self.tones(bar)
            root = near(r, 45)
            top = root + 12 + (t - r) % 12
            voicing = [root, root + (f - r) % 12, top if top <= 65 else top - 12]
            for n in voicing:
                self.note("lowbrass", "tbn", "trombone", "sus", n, vel, at(bar, start), beats * BEAT, release=0.25, shape=shape)
                if stab:
                    self.short("lowbrass", "tbn", "trombone", "stac", n, vel * 0.85, at(bar, start))
            if tuba:
                self.note("lowbrass", "tba", "tuba", "sus", root - 12, vel, at(bar, start), beats * BEAT, release=0.25, shape=shape)

        chord(0, 0.85, beats=6, shape=(1.0, 0.55, 0.3))  # the opening hit, dying away
        for bar in range(14, C):
            chord(bar, 0.35 + 0.08 * (bar - 14), stab=False, tuba=bar >= 16, shape=(0.85, 1.0, 1.0 if bar < C - 1 else 1.5))
        for bar in range(C, E):
            arrive = bar == D + 6
            fall = bar == E - 1
            chord(bar, 0.95 if arrive else 0.82, shape=(1.0, 0.85, 0.4) if fall else (1.0, 0.92, 0.9))
        chord(BARS - 1, 0.5, beats=4, stab=False, shape=(0.25, 0.5, 1.3))  # swelling back to the top
        # Trumpets and horns join the two big crescendos on the dominant.
        for bar in (C - 1, BARS - 1):
            for n in ("F#4", "A#4", "C#5"):
                self.note("trumpets", "tpt", "trumpet", "sus", midi(n), 0.5, at(bar, 2), 2 * BEAT, release=0.12, attack=0.1, shape=(0.2, 0.5, 1.05))
            if bar == BARS - 1:
                for n in ("F#3", "C#4"):
                    self.note("horns", "hn", "horn", "sus", midi(n), 0.6, at(bar), 4 * BEAT, release=0.12, attack=0.15, shape=(0.2, 0.5, 1.2))
        # The opening hit also has horns in it.
        for n in ("B2", "F#3"):
            self.note("horns", "hn", "horn", "sus", midi(n), 0.75, at(0), 5 * BEAT, release=0.3, shape=(1.0, 0.5, 0.25))

    def timpani(self):
        drum = {"Bm": 47, "G": 43, "D": 50, "A": 45, "Em": 52, "F#": 54}

        def roll(bar: float, beats: float, note: int, vel: float, shape):
            self.note("timpani", "timp", "timpani", "roll", note, vel, at(bar), beats * BEAT, release=0.12, attack=0.06, shape=shape)

        self.note("timpani", "timp", "timpani", "hit", 47, 0.95, at(0))
        for bar in range(B, C):
            k = (bar - B) / (C - B)
            n = drum[PROG[bar]]
            self.short("timpani", "timp", "timpani", "hit", n, 0.35 + 0.3 * k, at(bar))
            if bar >= 14:
                self.short("timpani", "timp", "timpani", "hit", n, 0.3 + 0.3 * k, at(bar, 2))
        for bar in range(C, E):
            n = drum[PROG[bar]]
            if bar in (D + 6, D + 7):
                continue  # the arrival is a roll, below
            for beat, v in ((0, 0.92), (1.5, 0.5), (2.5, 0.58), (3, 0.62), (3.5, 0.7)):
                self.short("timpani", "timp", "timpani", "hit", n, v, at(bar, beat))
        roll(C - 1, 4, 54, 0.8, (0.2, 0.45, 1.0))
        roll(D - 1, 2, 54, 0.9, (0.4, 1.0))
        self.note("timpani", "timp", "timpani", "hit", 50, 0.95, at(D + 6))
        roll(D + 6, 6, 50, 0.9, (1.0, 0.8, 0.85, 0.55))
        self.short("timpani", "timp", "timpani", "hit", 45, 0.6, at(D + 7, 2))
        roll(BARS - 1.5, 6, 54, 0.85, (0.12, 0.3, 0.6, 1.0))

    def percussion(self):
        bd = lambda t, level: self.hit("drums", "perc", V1 + "drums/bass/bdrum_fff_1.wav", t - 0.07, level, length=4.0, fade=1.5)
        mallet = lambda t, level, k=1: self.hit("drums", "perc", V1 + f"drums/other/ethnic/giant/mallet/EthnicLargeMallet_hit_ff_{k}.wav", t - 0.02, level)
        sticks = lambda t, level, k="f_1": self.hit("drums", "perc", V1 + f"drums/other/ethnic/giant/sticks/EthnicLargeSticks_hit_{k}.wav", t - 0.02, level)
        crash = lambda t, level, k="fff_loose": self.hit("metal", "cym", V1 + f"varMetal/Cymbals/clash/crash_hit_{k}.wav", t - 0.08, level)
        swell = lambda t, level, k="Median": self.hit("metal", "cym", PERC + f"susCymb1-cresc-{k}_v1.wav", t, level, peak_at=True)
        gong = lambda t, level, k="f": self.hit("metal", "cym", PERC + f"gongHit_{k}.wav", t - 0.08, level, length=14, fade=6)
        snare_roll = lambda t, beats, level: self.o.hit(self.stems["drums"], SEATS["snare"], PERC + "Snare2-rollSN_v3_rr1_Sum.wav", t, level, length=beats * BEAT, fade=0.08)

        # The opening hit (and, as the loop comes round, the end of the last crescendo).
        bd(at(0), 0.9)
        mallet(at(0), 0.75)
        crash(at(0), 0.4, "ff_loose")
        gong(at(0), 0.28, "mf")

        # Into C: cymbal swell, snare roll, then the full kit.
        swell(at(C), 0.4)
        swell(at(D), 0.45)
        swell(at(BARS), 0.5)
        swell(at(C + 4), 0.25, "Short")
        swell(at(D + 6), 0.4, "Short")
        for bar, beats in ((C - 1, 4), (D - 1, 2), (BARS - 1, 4)):
            start = at(bar + 1) - beats * BEAT
            x_level = 0.3
            # A roll that grows: the same roll three times over, each entry louder.
            for i in range(3):
                snare_roll(start + i * beats * BEAT / 3, beats / 3 + 0.3, x_level * (0.35 + 0.33 * i))
            for i in range(4):  # and four strokes that push into the downbeat
                sticks(at(bar + 1) - (4 - i) * 0.25 * BEAT, 0.3 + 0.12 * i, "f_2" if i % 2 else "f_1")

        for bar in range(C, E):
            big = (bar - C) % 4 == 0
            arrive = bar == D + 6
            last = bar == E - 1
            bd(at(bar), 0.95 if arrive else 0.85 if big else 0.55)
            if big or arrive:
                crash(at(bar), 0.6 if bar in (C, D) or arrive else 0.4, "fff_loose" if bar in (C, D) or arrive else "ff_loose")
            if bar in (C, D) or arrive:
                gong(at(bar), 0.45 if arrive else 0.3, "fff" if arrive else "f")
            if last:
                mallet(at(bar), 0.5)
                continue
            mallet(at(bar), 0.7, 1 + bar % 2)
            sticks(at(bar, 1.5), 0.3, "mf_1")
            mallet(at(bar, 2.5), 0.5, 2 - bar % 2)
            if bar % 2:
                sticks(at(bar, 3.5), 0.34, "f_2")
            if (bar - C) % 4 == 3 and bar != D - 1:
                for i in range(4):
                    sticks(at(bar, 3 + i * 0.25), 0.26 + 0.1 * i, "f_2" if i % 2 else "f_1")

        # A marching snare under the second theme.
        march = [(0, "f_1", 0.3), (0.5, "p_1", 0.12), (1, "mp_1", 0.2), (1.25, "p_2", 0.1), (1.5, "p_3", 0.13), (2, "f_2", 0.28), (2.5, "p_4", 0.12), (3, "mp_1", 0.2), (3.25, "p_1", 0.1), (3.5, "p_2", 0.14), (3.75, "p_3", 0.12)]
        for bar in range(D, D + 6):
            for beat, k, level in march:
                self.o.hit(self.stems["drums"], SEATS["snare"], V1 + f"drums/snare/drum3_marching/snare3_{k}.wav", at(bar, beat) - 0.05 + self.rng.normal(0, 0.003), level * self.rng.uniform(0.9, 1.1))

        # Tubular bells on the second theme's downbeats, glockenspiel in the quiet bars.
        for bar in (D, D + 2, D + 4, D + 6):
            r, _, _ = self.tones(bar)
            self.note("mallets", "glock", "bells", "hit", near(r, 67), 0.8, at(bar), 5.0, release=2.0)
        for bar, beat, n in ((E, 2, "F#6"), (E + 1, 0, "B5"), (E + 1, 2, "D6"), (E + 2, 0, "E6"), (E + 2, 2, "G5"), (E + 3, 0, "F#5")):
            self.short("mallets", "glock", "glock", "hit", midi(n), 0.4, at(bar, beat))

    def opening(self):
        """The strings' share of the opening hit: a struck low octave and a tremolo that fades."""
        for n in (35, 47):
            self.short("strings_lo", "cb" if n < 40 else "vc", "basses" if n < 40 else "celli", "spic", n, 0.95, at(0))
        for n in (midi("B4"), midi("F#5")):
            self.note("strings_hi", "vln1", "violins", "trem", n, 0.75, at(0), 6 * BEAT, release=0.5, attack=0.01, shape=(1.0, 0.45, 0.2))

    def write_all(self):
        self.ostinato()
        self.low_strings()
        self.harp()
        self.themes()
        self.high_strings()
        self.low_brass()
        self.timpani()
        self.percussion()
        self.opening()


# ---------------------------------------------------------------- mix


def short_term(x: np.ndarray, seconds: float = 3.0) -> np.ndarray:
    """Loudness over a sliding window, one value every half second (dB, K-weighted)."""
    from orchestra import _k_weight

    y = (_k_weight(x.astype(np.float64)) ** 2).sum(axis=1)
    win, hop = int(seconds * SR), SR // 2
    c = np.concatenate(([0.0], np.cumsum(y)))
    starts = np.arange(0, max(1, len(y) - win), hop)
    return -0.691 + 10 * np.log10((c[starts + win] - c[starts]) / win + 1e-12)


def fold(x: np.ndarray) -> np.ndarray:
    """Wrap everything outside the loop back into it: the tail onto the start, the lead-in onto the end."""
    pre, n = int(PRE * SR), int(round(LOOP * SR))
    out = x[pre : pre + n].copy()
    tail = x[pre + n :]
    while len(tail):
        out[: len(tail[:n])] += tail[:n]
        tail = tail[n:]
    out[n - pre :] += x[:pre]
    return out


def main():
    score = Score()
    score.write_all()
    stems = score.stems

    # Level each group to its place in the balance.
    peak = {k: float(short_term(m.dry).max()) for k, m in stems.items()}
    ref = peak["trumpets"]
    gains = {k: db(ref + BALANCE[k] - peak[k]) for k in stems}
    dry = sum(m.dry * gains[k] for k, m in stems.items())
    send = sum(m.send * gains[k] for k, m in stems.items())

    if "--stems" in sys.argv:
        names = [("V", V, A), ("A", A, B), ("B", B, C), ("C", C, D), ("D", D, E), ("E", E, BARS)]
        print("section loudness per group (LUFS before mastering):")
        print(" " * 12 + "".join(f"{n:>8s}" for n, _, _ in names))
        for k, m in stems.items():
            row = [lufs((m.dry * gains[k])[int(at(a) * SR) : int(at(b) * SR)]) for _, a, b in names]
            print(f"{k:12s}" + "".join(f"{v:8.1f}" for v in row))
        row = [lufs(dry[int(at(a) * SR) : int(at(b) * SR)]) for _, a, b in names]
        print(f"{'all':12s}" + "".join(f"{v:8.1f}" for v in row))

    wet = signal.fftconvolve(send, hall_ir(2.3), axes=0)[: len(dry)].astype(np.float32)
    loop = fold(dry + wet * db(-4.0))

    # Master three laps and keep the middle one, so the processing is seamless too.
    lap = len(loop)
    x = np.concatenate([loop, loop, loop])
    x = highpass(x, 28)
    x = shelf(x, 90, 3.5, high=False)  # weight under the drums and basses
    x = shelf(x, 6000, 3.0)  # air: the samples are close and a little dark
    x = level_ride(x, amount=0.3, window=3.0)
    x *= db(-17.0 - lufs(x[lap : 2 * lap]))
    x = limit(x, ceiling_db=-1.0)
    out = x[lap : 2 * lap]
    print(f"menu theme: {len(out) / SR:.2f} s, {lufs(out):.1f} LUFS, peak {20 * np.log10(np.abs(out).max()):.1f} dBFS")
    write(OUT / "menu-theme.ogg", out, quality=0.6)
    if "--wav" in sys.argv:
        import soundfile as sf

        sf.write(str(OUT.parents[1] / "local-audio" / "menu-theme.wav"), out, SR, subtype="PCM_24")


if __name__ == "__main__":
    main()
