# Festival analysis service (optional)

A local HTTP service that analyzes songs more accurately than the in-app analyzer. It separates stems with Demucs (drums, bass, vocals, other) and transcribes notes per stem with Basic Pitch. It returns the same `AnalysisResult` JSON as the in-app analyzer, so charts are generated the same way.

The game works without it. When the service is enabled in **Settings → Analysis service** and reachable, new analyses use it. If it is unavailable, the game falls back to in-app analysis.

## Setup

```bash
cd ml-service
python -m venv .venv
.venv/Scripts/activate        # Windows (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt          # core: librosa-based analysis
pip install -r requirements-full.txt     # optional: Demucs + Basic Pitch (large; a GPU helps)
```

## Run

```bash
python -m festival_ml --port 8765
```

Check it with `http://127.0.0.1:8765/health`, which shows which optional engines were found.

## Degrades gracefully

| Installed | Stems | Melody |
|---|---|---|
| core only | librosa HPSS | librosa pYIN |
| + demucs | Demucs htdemucs | librosa pYIN on stems |
| + basic-pitch | as above | Basic Pitch on stems |

## API

- `GET /health` → `{ ok, engines: { demucs, basicPitch }, device }`
- `POST /jobs` (multipart `file`) → `{ id }`
- `GET /jobs/{id}` → `{ state: queued|running|done|error, progress, step, result?, error? }`

The service only listens on localhost and accepts browser requests from local origins and the desktop app.
