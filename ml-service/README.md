# Festival analysis service (reference)

The game does this work itself now (see "How analysis works" in the main README) and no longer connects to this service. It is kept as the reference the in-app stem separation is checked against, and its environment runs `tools/analysis/export_stem_model.py` and the offline tooling in `scripts/dev/`.

A local HTTP service that makes charts more accurate by working on separated stems:

1. **Demucs** (htdemucs) splits the song into drums, bass, vocals and other instruments. On an NVIDIA GPU this takes a few seconds per song.
2. **Basic Pitch** transcribes the bass, vocal and instrument stems separately, so each part follows exactly one instrument. Lead keeps chords as chords.
3. The service returns those lines plus the separated stems. The app keeps the stems for preview on the song page. The app then runs its own beat tracking on the full mix and drum detection on the clean drum stem.


## Setup

```bash
cd ml-service
python -m venv .venv
.venv/Scripts/activate        # Windows (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
```

That is enough for a basic service: librosa signal processing, no stems.

For stem separation, install the full stack:

```bash
# PyTorch with CUDA (pick the CUDA build for your driver; drop --index-url for CPU only)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements-full.txt
# Basic Pitch pins TensorFlow, which has no build for newer Pythons. Without it, Basic Pitch runs
# its bundled ONNX model through onnxruntime.
pip install --no-deps basic-pitch==0.4.0
```

The first analysis downloads the Demucs model weights (about 80 MB) into the torch cache.

## Run

```bash
python -m festival_ml --port 8765
```

`http://127.0.0.1:8765/health` shows which engines were found and whether the GPU is used.

## Degrades gracefully

| Installed | Stems | Melody |
|---|---|---|
| core only | librosa HPSS | librosa pYIN |
| + demucs | Demucs htdemucs | librosa pYIN on stems |
| + basic-pitch | as above | Basic Pitch on each stem |

## API

- `GET /health` → `{ ok, engines: { demucs, basicPitch }, device }`
- `POST /jobs` (multipart `file`) → `{ id }`
- `GET /jobs/{id}` → `{ state: queued|running|done|error, progress, step, result?, error? }`. The result includes `bass`, `lead` (with `chord` voicings) and `vocals` lines, and `stems`, the names of the separated stems available for download.
- `GET /jobs/{id}/stems/{name}.wav` → one separated stem (`drums`, `bass`, `vocals` or `other`; mono, 16-bit, 22.05 kHz). Stems are kept for 10 minutes after the job finishes.

The service only listens on localhost and accepts browser requests from local origins and the desktop app.
