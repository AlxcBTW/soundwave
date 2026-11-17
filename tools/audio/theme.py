"""
The main-menu theme: a cinematic piece in B minor, 40 bars at 100 BPM, written to loop.

    python tools/audio/theme.py            -> public/audio/menu-theme.ogg
    python tools/audio/theme.py --stems    also prints how loud each group is in each section

How it is built: big drums and low strings drive straight eighth notes, a line of snares and
short, high violins run in sixteenths over them, a round bass pulses underneath, and above all
of that the harmony and the melody move slowly, in long held notes. The energy is in the
rhythm; the tune never hurries.

The form, eight bars each: the theme on horns as the orchestra comes in from nothing (1), the
theme with violins (2), a second theme in the major with trumpets (3), an interlude where one
horn sings over held strings and the drums build back (4), and the theme with everyone (5),
which ebbs in its last bar so the loop comes round to the quiet opening.
"""
from __future__ import annotations

import sys

import numpy as np
from scipy import signal

import synth
from orchestra import OUT, SR, Mix, Orchestra, Seat, _k_weight, db, hall_ir, highpass, level_ride, limit, lufs, midi, shelf, write

BPM = 100
BEAT = 60 / BPM
BARS = 40
LOOP = BARS * 4 * BEAT
PRE = 1.0  # room before bar 1 for notes that start early; folded onto the end of the loop

S1, S2, S3, S4, S5 = 0, 8, 16, 24, 32  # first bar of each section

# root, third, fifth as pitch classes
CHORDS = {"Bm": (11, 2, 6), "G": (7, 11, 2), "D": (2, 6, 9), "A": (9, 1, 4), "Em": (4, 7, 11)}
THEME_PROG = ["Bm", "Bm", "G", "G", "D", "D", "A", "A"]
PROG = THEME_PROG * 2 + ["D", "D", "A", "A", "Bm", "Bm", "G", "A"] + ["Em", "Em", "Bm", "Bm", "G", "G", "A", "A"] + THEME_PROG
assert len(PROG) == BARS

# The theme, at trumpet pitch: (note, beats) per bar. Long notes, mostly by step and third.
THEME = [
    [("B3", 2), ("D4", 2)],
    [("F#4", 4)],
    [("G4", 3), ("F#4", 1)],
    [("D4", 4)],
    [("D4", 2), ("F#4", 2)],
    [("A4", 4)],
    [("A4", 3), ("G4", 1)],
    [("E4", 4)],
]
# The second theme, over D D A A Bm Bm G A.
SECOND = [
    [("F#4", 2), ("A4", 2)],
    [("D5", 4)],
    [("C#5", 3), ("B4", 1)],
    [("A4", 4)],
    [("B4", 2), ("D5", 2)],
    [("F#5", 4)],
    [("D5", 2), ("B4", 2)],
    [("C#5", 4)],
]
# The interlude, at horn pitch, over Em Em Bm Bm G G A A.
INTERLUDE = [
    [("G3", 4)],
    [("B3", 4)],
    [("B3", 2), ("D4", 2)],
    [("F#3", 4)],
    [("G3", 2), ("B3", 2)],
    [("D4", 4)],
    [("C#4", 3), ("B3", 1)],
    [("A3", 2), ("C#4", 2)],
]

SEATS = {
    "vln": Seat(-0.45, wet=0.45, voices=2),
    "vln2": Seat(-0.2, wet=0.42, voices=2),
    "vla": Seat(0.2, wet=0.42, voices=2),
    "vc": Seat(0.42, wet=0.36, voices=2),
    "cb": Seat(0.6, wet=0.3, voices=3, width=0.6),
    "harp": Seat(-0.6, wet=0.45, width=0.6),
    "hn": Seat(-0.3, wet=0.6, voices=4, width=0.7),
    "hn1": Seat(-0.3, gain_db=2.0, wet=0.62, width=0.7),
    "tpt": Seat(0.18, wet=0.52, voices=3, width=0.6),
    "tbn": Seat(0.38, wet=0.5, voices=2, width=0.7),
    "tba": Seat(0.5, wet=0.45, width=0.6),
    "timp": Seat(-0.08, wet=0.5, width=0.8),
    "drumL": Seat(-0.35, wet=0.3, width=0.8),
    "drumR": Seat(0.35, wet=0.3, width=0.8),
    "perc": Seat(0.0, wet=0.34, width=0.9),
    "snare": Seat(0.08, wet=0.32, width=0.7),
    "cym": Seat(-0.15, wet=0.5),
    "glock": Seat(-0.4, wet=0.5, width=0.5),
    "pad": Seat(0.0, wet=0.45),
    "bass": Seat(0.0, wet=0.0, width=0.0),
    "fx": Seat(0.0, wet=0.4),
}

# How loud each group may get at its loudest, relative to the melody brass (dB). Stems are
# levelled to these after rendering, so the balance does not depend on how hot anything was.
BALANCE = {
    "brass": 0.0,
    "strings": -1.0,
    "chords": -3.5,
    "lowbrass": -4.5,
    "pad": -7.0,
    "pulse": -6.0,
    "ostinato": -4.0,
    "bass": -2.5,
    "drums": -1.0,
    "snares": -6.5,
    "sub": -6.5,
    "timpani": -8.0,
    "metal": -10.0,
    "mallets": -13.0,
    "harp": -13.0,
    "fx": -12.0,
}

PERC = "Percussion/"
V1 = "VSCO 1 Percussion/"
GIANT = V1 + "drums/other/ethnic/giant/"

#: Where the eighths lean: three, three and two.
ACCENT = [1.0, 0.45, 0.5, 0.88, 0.45, 0.5, 0.8, 0.55]


def at(bar: float, beat: float = 0.0) -> float:
    return PRE + (bar * 4 + beat) * BEAT


def near(pc: int, ref: int) -> int:
    """The note with pitch class `pc` closest to `ref`."""
    n = ref - ((ref - pc) % 12)
    return n if ref - n <= 6 else n + 12


def force(bar: float) -> float:
    """How hard everyone is playing, 0..1: in from nothing at the top, and back up through the interlude."""
    if bar < S2:
        return 0.3 + 0.3 * bar / 8
    if bar < S3:
        return 0.85
    if bar < S4:
        return 1.0
    if bar < S4 + 4:
        return 0.3
    if bar < S5:
        return 0.45 + 0.1 * (bar - S4 - 4)
    return 1.0


def calm(bar: float) -> bool:
    """The first half of the interlude: no drums, no pulse."""
    return S4 <= bar < S4 + 4


def ebb(bar: int, eighth: float) -> float:
    """The last bar of the loop lets go, so the quiet opening follows naturally."""
    return 1 - 0.6 * eighth / 8 if bar == BARS - 1 else 1.0


def spans() -> list[tuple[int, int]]:
    """(first bar, bars) for each stretch of one chord inside one section."""
    out, bar = [], 0
    while bar < BARS:
        n = 1
        while bar + n < BARS and PROG[bar + n] == PROG[bar] and (bar + n) % 8 != 0:
            n += 1
        out.append((bar, n))
        bar += n
    return out


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
        self.o.hit(self.stems[stem], SEATS[seat], rel, t + self.rng.normal(0, 0.003), level * self.rng.uniform(0.9, 1.08), **kw)

    def put(self, stem: str, seat: str, x: np.ndarray, t: float, gain: float = 1.0):
        self.stems[stem].add(x, t, SEATS[seat], gain)

    def line(self, stem: str, seat: str, inst: str, bars: list, start: int, vel: float, *, transpose: int = 0, advance: float = 0.0, release: float = 0.35, attack: float = 0.06, dyn: tuple[float, float] = (1.0, 1.0)):
        """A melody, legato: each note overlaps the next. `dyn` scales the velocity from first bar to last."""
        for i, bar in enumerate(bars):
            pos = 0.0
            k = dyn[0] + (dyn[1] - dyn[0]) * i / max(1, len(bars) - 1)
            for name, beats in bar:
                n = midi(name) + transpose
                shape = (0.82, 1.0, 0.9) if beats >= 3 else (0.9, 1.0, 0.95)
                self.note(stem, seat, inst, "sus", n, vel * k, at(start + i, pos) - advance, beats * BEAT + 0.1, release=release, attack=attack, shape=shape)
                pos += beats

    def tones(self, bar: int) -> tuple[int, int, int]:
        return CHORDS[PROG[bar]]

    # -- the engine: eighth notes in the low strings, the bass and the drums

    def pulse(self):
        for bar in range(BARS):
            if calm(bar):
                continue
            f_ = force(bar)
            r, t, f = self.tones(bar)
            root = near(r, 47)
            for e in range(8):
                a = ACCENT[e]
                g = f_ * ebb(bar, e)
                when = at(bar, e * 0.5)
                self.short("pulse", "vc", "celli", "spic", root, g * (0.5 + 0.5 * a), when)
                if a > 0.7:
                    self.short("pulse", "cb", "basses", "spic", root - 12, g * a, when)
                if 0.75 <= f_ < 0.95:  # violas join an octave up, rocking between root and fifth
                    self.short("pulse", "vla", "violas", "spic", root + 12 if e % 2 == 0 else root + (f - r) % 12, g * (0.45 + 0.45 * a), when)
                self.put("bass", "bass", synth.bass(near(r, 42), 0.5 * BEAT * 0.78, (0.55 + 0.4 * a) * (0.6 + 0.4 * g)), when)

    def ostinato(self):
        """Short, high violins in sixteenths, circling the chord: where the urgency comes from."""
        for bar in range(4, BARS):
            f_ = force(bar)
            r, t, f = self.tones(bar)
            top = near(r, 76)
            third, fifth = top + (t - r) % 12, top - (r - f) % 12
            cell = [top, top, fifth, top, third, top, fifth, top]
            for s in range(16):
                a = ACCENT[s // 2] if s % 2 == 0 else 0.4
                vel = f_ * (0.45 + 0.55 * a) * ebb(bar, s / 2)
                when = at(bar, s * 0.25)
                self.short("ostinato", "vln2", "violins", "spic", cell[s % 8], vel, when)
                if f_ >= 0.95:  # violas double it an octave down when everyone is in
                    self.short("ostinato", "vla", "violas", "spic", cell[s % 8] - 12, vel * 0.9, when)

    def snares(self):
        """A line of snare drums in sixteenths, leaning where everyone else leans."""
        hard = [PERC + f"Snare2-HitSN_v7_rr{k}_Sum.wav" for k in (1, 2)]
        soft = [PERC + f"Snare2-HitSN_v5_rr{k}_Sum.wav" for k in (1, 2)]
        for bar in range(BARS):
            f_ = force(bar)
            if f_ < 0.6 or calm(bar):
                continue
            for s in range(16):
                accent = s % 2 == 0 and ACCENT[s // 2] > 0.7
                if not accent and s % 4 == 1 and f_ < 0.95:
                    continue  # gaps in the line until everyone is in
                self.hit("snares", "snare", (hard if accent else soft)[s % 2], at(bar, s * 0.25) - 0.03, f_ * (0.5 if accent else 0.16) * ebb(bar, s / 2))

    def drums(self):
        hand = [GIANT + f"hand/EthnicLargeHand_hit_mp_{k}.wav" for k in (1, 2, 3, 4)]
        loud = [GIANT + f"mallet/EthnicLargeMallet_hit_ff_{k}.wav" for k in (1, 2)]
        mid = GIANT + "mallet/EthnicLargeMallet_hit_mf_1.wav"
        tick = [GIANT + f"sticks/EthnicLargeSticks_hit_{k}.wav" for k in ("mp_1", "p_1", "mf_2")]
        rim = [GIANT + f"EthnicLargeStick_rimshot_{k}.wav" for k in (1, 2, 3)]
        k = 0
        for bar in range(2, BARS):
            if calm(bar):
                continue
            f_ = force(bar)
            last = bar == BARS - 1
            fill = bar % 4 == 3 and f_ >= 0.7 and not last
            for e in range(8):
                if e == 1 and bar % 2 == 1:
                    continue  # a breath after the downbeat, every other bar
                if (fill or last) and e >= 6:
                    continue
                a = ACCENT[e]
                g = f_ * ebb(bar, e)
                when = at(bar, e * 0.5)
                side = "drumL" if (e + bar) % 2 == 0 else "drumR"
                other = "drumR" if side == "drumL" else "drumL"
                k += 1
                if a > 0.7:
                    self.hit("drums", side, loud[k % 2] if f_ >= 0.7 else mid, when - 0.02, g * (0.9 if e == 0 else 0.72))
                    # the depth of a big drum, which the close samples lack: a short drop under each accent
                    self.put("sub", "bass", synth.kick(g * (1.0 if e == 0 else 0.8), low=42, sweep=55, length=0.4), when)
                    self.hit("drums", other, hand[k % 4], when - 0.02, g * 0.32)
                    if f_ >= 0.85:  # and a rimshot across the stage for the crack
                        self.hit("drums", other, rim[k % 3], when - 0.03, g * (0.32 if e == 0 else 0.24))
                else:
                    self.hit("drums", side, hand[k % 4], when - 0.02, g * 0.3)
                self.hit("drums", "perc", tick[k % 3], when - 0.03, g * (0.16 + 0.1 * a))  # the click of wood on the rim
            if fill:  # sixteenths across the last beat, growing
                for i in range(4):
                    when = at(bar, 3 + i * 0.25)
                    self.hit("drums", "drumL" if i % 2 else "drumR", loud[i % 2], when - 0.02, f_ * (0.45 + 0.13 * i))
                    self.hit("drums", "perc", GIANT + f"sticks/EthnicLargeSticks_hit_f_{1 + i % 2}.wav", when - 0.03, f_ * (0.22 + 0.05 * i))
            elif bar % 2 == 1 and f_ >= 0.7 and not last:  # two quick strokes into the next bar
                for i in range(2):
                    self.hit("drums", "drumR" if i else "drumL", loud[i], at(bar, 3.5 + i * 0.25) - 0.02, f_ * (0.45 + 0.12 * i))
            if f_ >= 0.7:  # a concert bass drum under every downbeat, heaviest every fourth
                self.o.hit(self.stems["drums"], SEATS["perc"], V1 + "drums/bass/bdrum_fff_1.wav", at(bar) - 0.07, f_ * (0.9 if bar % 4 == 0 else 0.55), length=3.0, fade=1.5)

    def timpani(self):
        drum = {"Bm": 47, "G": 43, "D": 50, "A": 45, "Em": 52}

        def roll(bar: float, beats: float, note: int, vel: float, shape):
            self.note("timpani", "timp", "timpani", "roll", note, vel, at(bar), beats * BEAT, release=0.12, attack=0.06, shape=shape)

        for bar in range(BARS):
            f_ = force(bar)
            if f_ < 0.7:
                continue
            n = drum[PROG[bar]]
            self.short("timpani", "timp", "timpani", "hit", n, 0.85 * f_, at(bar))
            if f_ >= 0.9:
                self.short("timpani", "timp", "timpani", "hit", n, 0.55, at(bar, 1.5))
                self.short("timpani", "timp", "timpani", "hit", n, 0.6, at(bar, 3))
        roll(S3 - 1, 4, 45, 0.7, (0.2, 0.5, 1.0))
        roll(S5 - 1.5, 6, 45, 0.85, (0.1, 0.3, 0.6, 1.0))

    # -- what is held over it

    def chords(self):
        for bar, n in spans():
            f_ = force(bar)
            r, t, f = self.tones(bar)
            dur = n * 4 * BEAT
            quiet = calm(bar)
            first, last = bar == 0, bar + n == BARS
            swell = (1.0, 0.85, 0.45) if last else (0.8, 1.0, 0.92)
            rise = 1.6 if first else 0.3  # the very first chord comes in from silence
            # strings: violins on the upper two notes, violas the root, celli the fifth below
            top = near(f, 76)
            for seat, inst, note, k in (("vln2", "violins", top, 1.0), ("vln2", "violins", near(t, top - 4), 1.0), ("vla", "violas", near(r, 62), 0.95), ("vc", "celli", near(f, 54), 0.9), ("cb", "basses", near(r, 35), 0.9)):
                self.note("chords", seat, inst, "sus", note, (0.35 + 0.5 * f_) * k, at(bar) - 0.08, dur + 0.15, release=0.5, attack=rise, shape=swell)
            if quiet:  # the interlude adds a high, still line
                self.note("chords", "vln", "violins", "sus", near(r, 83), 0.4, at(bar) - 0.08, dur + 0.15, release=0.6, attack=0.5, shape=swell)
            # the pad underneath glues it together and carries the warmth
            root = near(r, 52)
            for note in (root, root + (f - r) % 12, root + 12, root + 12 + (t - r) % 12):
                self.put("pad", "pad", synth.pad(note, dur, 0.45 + 0.4 * f_, self.rng, cutoff=1300 + 1500 * f_, attack=1.8 if first else 0.5, release=1.3), at(bar) - 0.15)
            if quiet:
                self.put("bass", "bass", synth.bass(near(r, 42), dur - 0.05, 0.6, attack=0.15, release=0.3), at(bar))
            # low brass from the second section on
            if f_ >= 0.7:
                low = near(r, 45)
                third = low + 12 + (t - r) % 12
                for note in (low, low + (f - r) % 12, third if third <= 65 else third - 12):
                    self.note("lowbrass", "tbn", "trombone", "sus", note, 0.3 + 0.55 * f_, at(bar), dur, release=0.4, attack=0.08, shape=swell)
                if f_ >= 0.9:
                    self.note("lowbrass", "tba", "tuba", "sus", low - 12, 0.75, at(bar), dur, release=0.4, attack=0.08, shape=swell)
            # horns hold the harmony when the trumpets have the tune
            if S3 <= bar < S4:
                for note in (near(r, 52), near(t, 57)):
                    self.note("brass", "hn", "horn", "sus", note, 0.7, at(bar), dur, release=0.4, attack=0.08, shape=swell)

    def melody(self):
        # 1: horns, low and warm, violas with them, growing as the orchestra arrives.
        self.line("brass", "hn", "horn", THEME, S1, 0.6, transpose=-12, attack=0.25, dyn=(0.8, 1.1))
        self.line("strings", "vla", "violas", THEME, S1, 0.5, advance=0.05, attack=0.25, dyn=(0.8, 1.1))
        # 2: violins take it an octave up; horns and violas stay underneath.
        self.line("strings", "vln", "violins", THEME, S2, 0.78, transpose=12, advance=0.05)
        self.line("strings", "vla", "violas", THEME, S2, 0.7, advance=0.05)
        self.line("brass", "hn", "horn", THEME, S2, 0.75, transpose=-12)
        # 3: the second theme: trumpets, violins over them, violas with them.
        self.line("brass", "tpt", "trumpet", SECOND, S3, 0.85, attack=0.04)
        self.line("strings", "vln", "violins", SECOND, S3, 0.88, transpose=12, advance=0.05)
        self.line("strings", "vla", "violas", SECOND, S3, 0.8, advance=0.05)
        # 4: one horn, alone over the held strings.
        self.line("brass", "hn1", "horn", INTERLUDE, S4, 0.6, attack=0.08)
        # 5: everyone, easing off towards the end.
        self.line("brass", "tpt", "trumpet", THEME, S5, 0.92, attack=0.04, dyn=(1.0, 0.82))
        self.line("brass", "hn", "horn", THEME, S5, 0.92, transpose=-12, dyn=(1.0, 0.82))
        self.line("strings", "vln", "violins", THEME, S5, 0.92, transpose=12, advance=0.05, dyn=(1.0, 0.82))
        self.line("strings", "vla", "violas", THEME, S5, 0.85, advance=0.05, dyn=(1.0, 0.82))
        for i, bar in enumerate(THEME):  # a glockenspiel touches each new note
            pos = 0.0
            for name, beats in bar:
                self.short("mallets", "glock", "glock", "hit", midi(name) + 24, 0.5, at(S5 + i, pos))
                pos += beats

    def colour(self):
        """Section downbeats and what leads into them."""
        crash = lambda bar, level, k="ff_loose": self.o.hit(self.stems["metal"], SEATS["cym"], V1 + f"varMetal/Cymbals/clash/crash_hit_{k}.wav", at(bar) - 0.08, level)
        swell = lambda bar, level, k="Median": self.o.hit(self.stems["metal"], SEATS["cym"], PERC + f"susCymb1-cresc-{k}_v1.wav", at(bar), level, peak_at=True)
        gong = lambda bar, level, k="mf": self.o.hit(self.stems["metal"], SEATS["cym"], PERC + f"gongHit_{k}.wav", at(bar) - 0.08, level, length=12, fade=6)
        boom = lambda bar, vel: self.put("fx", "fx", synth.boom(vel), at(bar))

        # No downbeat at the top: the piece comes in from nothing. Every later section lands.
        for bar, c, g, b in ((S2, 0.45, 0.0, 0.8), (S3, 0.6, 0.25, 1.0), (S3 + 4, 0.4, 0.0, 0.8), (S4, 0.25, 0.3, 0.9), (S5, 0.65, 0.35, 1.0), (S5 + 4, 0.45, 0.0, 0.8)):
            crash(bar, c, "fff_loose" if c >= 0.5 else "ff_loose")
            if g:
                gong(bar, g, "f" if g >= 0.3 else "mf")
            boom(bar, b)
        swell(S2, 0.25, "Short")
        swell(S3, 0.4)
        swell(S5, 0.5)
        for bar in (S3, S5, S5 + 4):  # iron on the biggest downbeats
            self.o.hit(self.stems["metal"], SEATS["perc"], PERC + "Anvil_Hit1_v3_Sum.wav", at(bar) - 0.03, 0.3)
        # Into the last section: noise opening upward and a snare roll that grows.
        x = synth.riser(2 * 4 * BEAT, self.rng)
        self.put("fx", "fx", x, at(S5) - len(x) / SR)
        for i in range(3):
            self.o.hit(self.stems["drums"], SEATS["snare"], PERC + "Snare2-rollSN_v3_rr1_Sum.wav", at(S5 - 1) + i * 4 * BEAT / 3, 0.25 * (0.35 + 0.33 * i), length=4 * BEAT / 3 + 0.3, fade=0.08)
        # A harp marks each chord of the interlude and runs up into the big entries.
        for bar, n in spans():
            if S4 <= bar < S5:
                r, t, f = self.tones(bar)
                root = near(r, 50)
                for i, note in enumerate((root, root + (f - r) % 12, root + 12, root + 12 + (t - r) % 12, root + 24)):
                    self.short("harp", "harp", "harp", "pluck", note, 0.55, at(bar) + i * 0.09)
        for target in (S3, S5):
            notes = [50 + 12 * o + s for o in range(3) for s in (0, 2, 4, 5, 7, 9, 11)][2:19]  # D major
            for i, note in enumerate(notes):
                self.note("harp", "harp", "harp", "pluck", note, 0.45 + 0.4 * i / len(notes), at(target) - BEAT * 1.1 * (1 - i / len(notes)))

    def write_all(self):
        self.pulse()
        self.ostinato()
        self.drums()
        self.snares()
        self.timpani()
        self.chords()
        self.melody()
        self.colour()


# ---------------------------------------------------------------- mix


def short_term(x: np.ndarray, seconds: float = 3.0) -> np.ndarray:
    """Loudness over a sliding window, one value every half second (dB, K-weighted)."""
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
    ref = peak["brass"]
    gains = {k: db(ref + BALANCE[k] - peak[k]) for k in stems}
    dry = sum(m.dry * gains[k] for k, m in stems.items())
    send = sum(m.send * gains[k] for k, m in stems.items())

    if "--stems" in sys.argv:
        names = [("1", S1, S2), ("2", S2, S3), ("3", S3, S4), ("4", S4, S5), ("5", S5, BARS)]
        print("section loudness per group (LUFS before mastering):")
        print(" " * 12 + "".join(f"{n:>8s}" for n, _, _ in names))
        for k, m in stems.items():
            row = [lufs((m.dry * gains[k])[int(at(a) * SR) : int(at(b) * SR)]) for _, a, b in names]
            print(f"{k:12s}" + "".join(f"{v:8.1f}" for v in row))
        row = [lufs(dry[int(at(a) * SR) : int(at(b) * SR)]) for _, a, b in names]
        print(f"{'all':12s}" + "".join(f"{v:8.1f}" for v in row))
        power = {k: float(((m.dry * gains[k]) ** 2).sum()) for k, m in stems.items()}
        total = sum(power.values())
        share = lambda *ks: sum(power[k] for k in ks) / total
        print(f"share of energy: drums {share('drums', 'timpani', 'sub', 'snares'):.2f}, bass {share('bass'):.2f}, everything else {1 - share('drums', 'timpani', 'sub', 'snares', 'bass'):.2f}")

    wet = signal.fftconvolve(send, hall_ir(2.6), axes=0)[: len(dry)].astype(np.float32)
    loop = fold(dry + wet * db(-4.0))

    # Master three laps and keep the middle one, so the processing is seamless too.
    lap = len(loop)
    x = np.concatenate([loop, loop, loop])
    x = highpass(x, 28)
    x = shelf(x, 1500, 3.0)  # presence: the samples are close and a little dark
    x = shelf(x, 8000, 5.0)  # and air
    x = level_ride(x, amount=0.6, window=4.0)  # menu music: keep the level even
    x *= db(-15.5 - lufs(x[lap : 2 * lap]))
    # The loop breathes at its seam: the last beats fall away and the first two bars rise, so
    # the piece starts gently the first time and every time it comes round.
    smooth = lambda u: u * u * (3 - 2 * u)
    t = np.arange(lap) / SR
    rise, fall, floor = 2 * 4 * BEAT, 3 * BEAT, db(-8.0)
    breath = np.ones(lap)
    breath[t < rise] = floor + (1 - floor) * smooth(t[t < rise] / rise)
    late = t > LOOP - fall
    breath[late] = 1 - (1 - floor) * smooth((t[late] - (LOOP - fall)) / fall)
    x *= np.tile(breath, 3)[:, None].astype(np.float32)
    x = limit(x, ceiling_db=-1.0)
    out = x[lap : 2 * lap]
    print(f"menu theme: {len(out) / SR:.2f} s, {lufs(out):.1f} LUFS, peak {20 * np.log10(np.abs(out).max()):.1f} dBFS")
    write(OUT / "menu-theme.ogg", out, quality=0.6)
    if "--wav" in sys.argv:
        import soundfile as sf

        sf.write(str(OUT.parents[1] / "local-audio" / "menu-theme.wav"), out, SR, subtype="PCM_24")


if __name__ == "__main__":
    main()
