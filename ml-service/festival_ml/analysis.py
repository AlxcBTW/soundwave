"""Song analysis producing the game's AnalysisResult JSON (see src/analysis/types.ts)."""

from __future__ import annotations

import importlib.util
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import librosa
import numpy as np
import scipy.signal as sps
import soundfile as sf

from .lines import bass_line, bend_activity, fill_gaps, lead_line, vocal_line

ANALYSIS_VERSION = 2
SR = 22050
HOP = 512
BASS_SPLIT = 50

Progress = Callable[[float, str], None]


def engines() -> dict[str, bool]:
    return {
        "demucs": importlib.util.find_spec("demucs") is not None,
        "basicPitch": importlib.util.find_spec("basic_pitch") is not None,
    }


def device() -> str:
    if importlib.util.find_spec("torch") is None:
        return "cpu"
    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"


@dataclass
class Stems:
    mix: np.ndarray
    drums: np.ndarray
    bass: np.ndarray
    melodic: np.ndarray  # vocals + other
    vocals: np.ndarray | None  # sung stem (only with stem separation)
    other: np.ndarray | None  # instruments without bass, drums and vocals
    harmonic: np.ndarray  # bass + other (for chords)
    separated: bool


def r3(x: float) -> float:
    return round(float(x), 3)


# --------------------------------------------------------------------------- stems


def separate(path: Path, progress: Progress) -> Stems:
    if engines()["demucs"]:
        try:
            return _demucs(path, progress)
        except Exception as e:  # noqa: BLE001 - fall back to HPSS on any model failure
            progress(0.1, f"demucs failed ({e}); using HPSS")
    y, _ = librosa.load(str(path), sr=SR, mono=True)
    progress(0.1, "Separating")
    harm, perc = librosa.effects.hpss(y)
    low = _lowpass(harm, 250)
    return Stems(mix=y, drums=perc, bass=low, melodic=harm - low, harmonic=harm, separated=False, vocals=None, other=None)


def _demucs(path: Path, progress: Progress) -> Stems:
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    progress(0.05, "Loading stem model")
    model = get_model("htdemucs")
    model.eval()
    dev = device()
    # Load with librosa (soundfile) instead of Demucs' ffmpeg-based reader, so ffmpeg isn't needed.
    y, _ = librosa.load(str(path), sr=model.samplerate, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y])
    wav = torch.from_numpy(np.ascontiguousarray(y[: model.audio_channels], dtype=np.float32))
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / (ref.std() + 1e-8)
    progress(0.1, "Separating stems")
    with torch.no_grad():
        out = apply_model(model, wav[None], device=dev, progress=False, split=True, overlap=0.25)[0]
    out = out * (ref.std() + 1e-8) + ref.mean()
    names = model.sources  # ['drums', 'bass', 'other', 'vocals']

    def stem(name: str) -> np.ndarray:
        s = out[names.index(name)].mean(0).cpu().numpy()
        return librosa.resample(s, orig_sr=model.samplerate, target_sr=SR)

    drums, bass, other, vocals = stem("drums"), stem("bass"), stem("other"), stem("vocals")
    mix = drums + bass + other + vocals
    return Stems(mix=mix, drums=drums, bass=bass, melodic=other + vocals, harmonic=other + bass, separated=True, vocals=vocals, other=other)


def _lowpass(y: np.ndarray, hz: float) -> np.ndarray:
    sos = sps.butter(4, hz, btype="low", fs=SR, output="sos")
    return sps.sosfiltfilt(sos, y).astype(np.float32)


def _band(y: np.ndarray, lo: float, hi: float) -> np.ndarray:
    sos = sps.butter(4, [lo, min(hi, SR / 2 - 100)], btype="band", fs=SR, output="sos")
    return sps.sosfiltfilt(sos, y).astype(np.float32)


# --------------------------------------------------------------------------- rhythm

DRUM_BANDS = {"kick": (30, 150, 0.1), "snare": (180, 2500, 0.08), "hat": (5000, 10500, 0.06)}


def detect_drums(drums: np.ndarray) -> list[dict]:
    hits: list[dict] = []
    curves = {}
    for kind, (lo, hi, wait) in DRUM_BANDS.items():
        band = _band(drums, lo, hi)
        env = librosa.onset.onset_strength(y=band, sr=SR, hop_length=HOP)
        env = env / (np.percentile(env, 99) + 1e-9)
        curves[kind] = env
        frames = librosa.onset.onset_detect(
            onset_envelope=env, sr=SR, hop_length=HOP, backtrack=False, wait=int(wait * SR / HOP), delta=0.12, units="frames"
        )
        # Backtrack on the band-limited signal for sample-accurate attacks.
        times = librosa.onset.onset_backtrack(frames, env) if len(frames) else frames
        for f, b in zip(frames, times):
            strength = float(min(1.0, env[f]))
            if strength < 0.15:
                continue
            hits.append({"t": float(librosa.frames_to_time(b, sr=SR, hop_length=HOP)), "kind": kind, "strength": strength, "f": int(f)})
    # Drop band leakage: snare that is mostly kick, hats that are mostly snare.
    def near(kind: str, f: int) -> bool:
        return any(h["kind"] == kind and abs(h["f"] - f) <= 1 for h in hits)

    out = []
    for h in hits:
        f = h["f"]
        if h["kind"] == "snare" and near("kick", f) and curves["kick"][f] > curves["snare"][f] * 1.3:
            continue
        if h["kind"] == "hat" and near("snare", f) and curves["hat"][f] < curves["snare"][f] * 1.1:
            continue
        out.append({"t": r3(h["t"]), "kind": h["kind"], "strength": r3(h["strength"])})
    out.sort(key=lambda h: h["t"])
    return out


def track_beats(mix: np.ndarray, drums: np.ndarray, duration: float) -> tuple[float, list[float]]:
    env = librosa.onset.onset_strength(y=drums if np.abs(drums).max() > 1e-4 else mix, sr=SR, hop_length=HOP)
    tempo, frames = librosa.beat.beat_track(onset_envelope=env, sr=SR, hop_length=HOP, units="frames", tightness=100)
    tempo = float(np.atleast_1d(tempo)[0])
    beats = librosa.frames_to_time(frames, sr=SR, hop_length=HOP).tolist()
    if len(beats) >= 2:
        # Extend the grid at constant tempo to cover the whole song.
        d0 = float(np.median(np.diff(beats[:9])))
        d1 = float(np.median(np.diff(beats[-9:])))
        pre = []
        t = beats[0] - d0
        while t >= 0:
            pre.insert(0, t)
            t -= d0
        post = []
        t = beats[-1] + d1
        while t <= duration:
            post.append(t)
            t += d1
        beats = pre + beats + post
    return tempo, [r3(b) for b in beats]


# --------------------------------------------------------------------------- harmony

def _templates() -> list[tuple[int, bool, np.ndarray]]:
    out = []
    for r in range(12):
        for minor in (False, True):
            v = np.zeros(12)
            v[r] = 1
            v[(r + (3 if minor else 4)) % 12] = 0.8
            v[(r + 7) % 12] = 0.9
            out.append((r, minor, v / np.linalg.norm(v)))
    return out


TEMPLATES = _templates()
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def harmony(harm: np.ndarray, beats: list[float]) -> tuple[list[dict], dict, np.ndarray]:
    chroma = librosa.feature.chroma_cqt(y=harm, sr=SR, hop_length=HOP)
    bf = librosa.time_to_frames(beats, sr=SR, hop_length=HOP)
    bc = librosa.util.sync(chroma, bf, aggregate=np.mean)
    bc = bc[:, : len(beats)]
    bc = bc / (np.linalg.norm(bc, axis=0, keepdims=True) + 1e-9)
    labels = []
    for i in range(bc.shape[1]):
        scores = [float(t[2] @ bc[:, i]) for t in TEMPLATES]
        labels.append(int(np.argmax(scores)))
    # Mode filter over three beats.
    smooth = [labels[i - 1] if 0 < i < len(labels) - 1 and labels[i - 1] == labels[i + 1] else labels[i] for i in range(len(labels))]
    events = []
    for i, t in enumerate(beats[: len(smooth)]):
        dist = 1.0 if i == 0 else 1 - float(bc[:, i] @ bc[:, i - 1])
        changed = i == 0 or smooth[i] != smooth[i - 1]
        if changed or dist > 0.25:
            r, minor, _ = TEMPLATES[smooth[i]]
            events.append({"t": r3(t), "root": r, "minor": minor, "strength": r3(min(1.0, (0.5 if changed else 0) + dist))})
    total = bc.sum(axis=1)
    best = max(((np.corrcoef(np.roll(total, -s), p)[0, 1], s, m) for s in range(12) for m, p in ((False, MAJOR), (True, MINOR))))
    key = {"tonic": int(best[1]), "minor": bool(best[2])}
    return events, key, bc


# --------------------------------------------------------------------------- melody

def _basic_pitch(y: np.ndarray) -> list[dict]:
    from basic_pitch.inference import predict

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        sf.write(tmp.name, y, SR)
        path = tmp.name
    try:
        _, _, events = predict(path, onset_threshold=0.45, frame_threshold=0.3, minimum_note_length=90, multiple_pitch_bends=False)
    finally:
        Path(path).unlink(missing_ok=True)
    if not events:
        return []
    amp = max(e[3] for e in events) or 1
    return [
        {"t": float(e[0]), "dur": float(e[1] - e[0]), "midi": int(e[2]), "strength": float(min(1, e[3] / amp)), "bend": bend_activity(list(e[4]) if len(e) > 4 and e[4] is not None else None)}
        for e in events
    ]


def _pyin(y: np.ndarray, fmin: float, fmax: float) -> list[dict]:
    f0, voiced, prob = librosa.pyin(y, fmin=fmin, fmax=fmax, sr=SR, hop_length=HOP, frame_length=2048)
    midi = np.where(voiced, np.round(librosa.hz_to_midi(np.nan_to_num(f0, nan=1.0))), 0).astype(int)
    midi = sps.medfilt(midi, 5)
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    ref = np.percentile(rms, 95) + 1e-9
    fps = SR / HOP
    notes, start, cur = [], -1, 0
    for f, m in enumerate(list(midi) + [0]):
        if m != cur or m == 0:
            if start >= 0 and cur > 0 and f - start >= 3:
                notes.append({"t": start / fps, "dur": (f - start) / fps, "midi": int(cur), "strength": float(min(1, rms[start:f].mean() / ref))})
            start, cur = (f, m) if m > 0 else (-1, 0)
    return notes


def melody(stems: Stems, progress: Progress, duration: float) -> tuple[list[dict], list[dict], list[dict], str, dict]:
    """Bass, lead (instrument incl. chords) and vocal lines. Stems make each line clean."""
    use_bp = engines()["basicPitch"]
    progress(0.55, "Transcribing bass")
    bass_notes = _basic_pitch(stems.bass) if use_bp else _pyin(stems.bass, 30, 260)
    if stems.separated:
        progress(0.65, "Transcribing vocals")
        vocal_notes = _basic_pitch(stems.vocals) if use_bp else _pyin(stems.vocals, 80, 1100)
        progress(0.75, "Transcribing instruments")
        other_notes = _basic_pitch(stems.other) if use_bp else _pyin(stems.other, 100, 1400)
        vocals = vocal_line(vocal_notes)
        lead = fill_gaps(lead_line(other_notes), vocals, duration)
    else:
        progress(0.7, "Transcribing melody")
        melodic = _basic_pitch(stems.melodic) if use_bp else _pyin(stems.melodic, 130, 1050)
        lead = lead_line(melodic)
        vocals = vocal_line(melodic)
    bass = bass_line(bass_notes)

    def rn(n: dict) -> dict:
        out = {"t": r3(n["t"]), "dur": r3(n["dur"]), "midi": int(n["midi"]), "strength": r3(n["strength"])}
        if n.get("bend"):
            out["bend"] = r3(n["bend"])
        if n.get("chord"):
            out["chord"] = [int(m) for m in n["chord"]]
        return out

    # Raw per-stem notes let the app re-time them against the attacks it hears in each stem.
    raw = (
        {"bass": [rn(n) for n in bass_notes], "vocals": [rn(n) for n in vocal_notes], "other": [rn(n) for n in other_notes]}
        if stems.separated
        else {}
    )
    return [rn(n) for n in bass], [rn(n) for n in lead], [rn(n) for n in vocals], "ml", raw


# --------------------------------------------------------------------------- structure

def downbeats_for(beats: list[float], drums: list[dict], harm_events: list[dict]) -> list[int]:
    kicks = np.array([d["t"] for d in drums if d["kind"] == "kick"])
    kick_str = {d["t"]: d["strength"] for d in drums if d["kind"] == "kick"}
    change = {e["t"]: e["strength"] for e in harm_events}
    accent = []
    for b in beats:
        k = 0.0
        if len(kicks):
            i = int(np.argmin(np.abs(kicks - b)))
            if abs(kicks[i] - b) < 0.05:
                k = kick_str[float(kicks[i])]
        accent.append(k + change.get(b, 0) * 1.2)
    phase = int(np.argmax([np.mean(accent[p::4]) if accent[p::4] else 0 for p in range(4)]))
    return list(range(phase, len(beats), 4))


def sections_for(y: np.ndarray, beats: list[float], downbeats: list[int], duration: float) -> list[dict]:
    bars = [beats[i] for i in downbeats]
    if len(bars) < 8:
        return [{"start": 0, "end": r3(duration), "energy": 0.7}]
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    chroma = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=HOP)
    bf = librosa.time_to_frames(bars, sr=SR, hop_length=HOP)
    feats = librosa.util.sync(np.vstack([chroma, rms[None, :] * 4]), bf, aggregate=np.mean)
    energy = librosa.util.sync(rms[None, :], bf, aggregate=np.mean)[0]
    k = max(2, min(12, int(duration // 25)))
    bounds = librosa.segment.agglomerative(feats, k)
    times = [0.0] + [bars[min(len(bars) - 1, max(0, b - 1))] for b in bounds[1:]] + [duration]
    # Map feature-column boundaries back to bars (sync adds a leading column).
    secs = []
    for a, b in zip(times[:-1], times[1:]):
        if b - a < 2:
            continue
        mask = [(t >= a and t < b) for t in bars]
        e = float(np.mean([energy[i + 1] for i, m in enumerate(mask) if m and i + 1 < len(energy)] or [0]))
        secs.append({"start": r3(a), "end": r3(b), "energy": e})
    lo = min(s["energy"] for s in secs)
    hi = max(s["energy"] for s in secs)
    for s in secs:
        rel = (s["energy"] - lo) / (hi - lo) if hi > lo else 0.7
        s["energy"] = round(0.35 + 0.65 * rel, 2)
    return secs


# --------------------------------------------------------------------------- entry

STEM_NAMES = ("drums", "bass", "vocals", "other")


def stem_wavs(result: dict) -> dict[str, bytes]:
    """Separated stems as WAV bytes (mono, 16-bit, 22.05 kHz), removed from the JSON result."""
    return result.pop("_stem_wavs", {})


def _wav_bytes(y: np.ndarray) -> bytes:
    import io

    buf = io.BytesIO()
    sf.write(buf, np.clip(y, -1, 1), SR, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def analyze(path: Path, progress: Progress) -> dict:
    progress(0.02, "Loading")
    stems = separate(path, progress)
    duration = len(stems.mix) / SR
    progress(0.4, "Finding the beat")
    drums = detect_drums(stems.drums)
    tempo, beats = track_beats(stems.mix, stems.drums, duration)
    progress(0.48, "Reading chords")
    harm_events, key, _ = harmony(stems.harmonic, beats)
    bass, lead, vocals, pitch_source, stem_notes = melody(stems, progress, duration)
    progress(0.9, "Structure")
    downbeats = downbeats_for(beats, drums, harm_events)
    sections = sections_for(stems.mix, beats, downbeats, duration)
    rms = librosa.feature.rms(y=stems.mix, hop_length=HOP)[0]
    rms = rms / (np.percentile(rms, 95) + 1e-9)
    step = int(round(0.1 * SR / HOP))
    energy = [r3(min(1.5, float(v))) for v in rms[::step]]
    progress(1.0, "Done")
    return {
        "version": ANALYSIS_VERSION,
        "source": "ml",
        "duration": r3(duration),
        "tempo": round(tempo, 2),
        "beats": beats,
        "downbeats": downbeats,
        "drums": drums,
        "bass": bass,
        "lead": lead,
        "vocals": vocals,
        "harmony": harm_events,
        "sections": sections,
        "energy": energy,
        "energyHop": step * HOP / SR,
        "key": key,
        "pitchSource": pitch_source,
        "separated": stems.separated,
        "stemNotes": stem_notes,
        # Popped by the server and served separately; never part of the JSON result.
        **(
            {"_stem_wavs": {name: _wav_bytes(getattr(stems, name)) for name in STEM_NAMES}}
            if stems.separated
            else {}
        ),
    }
