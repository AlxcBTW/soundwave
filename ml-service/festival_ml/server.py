"""HTTP API: submit a song, poll the job, receive an AnalysisResult."""

from __future__ import annotations

import tempfile
import threading
import time
import traceback
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from .analysis import analyze, device, drum_stem_wav, engines

MAX_UPLOAD = 400 * 1024 * 1024

app = FastAPI(title="Festival analysis service")
app.add_middleware(
    CORSMiddleware,
    # Local dev servers, the desktop app's webview origins, and local static builds.
    allow_origin_regex=r"^(https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?|tauri://localhost|https?://tauri\.localhost)$",
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

_jobs: dict[str, dict] = {}
# Drum stems wait here until the client downloads them (once), at most STEM_TTL seconds.
_stems: dict[str, tuple[float, bytes]] = {}
STEM_TTL = 600
_lock = threading.Lock()
# One analysis at a time: stem separation is memory hungry.
_worker_lock = threading.Lock()


@app.get("/health")
def health() -> dict:
    return {"ok": True, "engines": engines(), "device": device()}


@app.post("/jobs")
async def create_job(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty upload")
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "file too large")
    suffix = Path(file.filename or "song").suffix[:8] or ".audio"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp.write(data)
    tmp.close()
    job_id = uuid.uuid4().hex
    with _lock:
        _jobs[job_id] = {"state": "queued", "progress": 0.0, "step": "Queued"}
    threading.Thread(target=_run, args=(job_id, Path(tmp.name)), daemon=True).start()
    return {"id": job_id}


@app.get("/jobs/{job_id}/drums.wav")
def get_drum_stem(job_id: str) -> Response:
    with _lock:
        _prune_stems()
        item = _stems.pop(job_id, None)
    if item is None:
        raise HTTPException(404, "no drum stem for this job")
    return Response(content=item[1], media_type="audio/wav")


def _prune_stems() -> None:
    now = time.time()
    for k in [k for k, (t, _) in _stems.items() if now - t > STEM_TTL]:
        _stems.pop(k, None)


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            raise HTTPException(404, "unknown job")
        snapshot = dict(job)
        if job["state"] in ("done", "error"):
            # Results are delivered once; free memory afterwards.
            _jobs.pop(job_id, None)
    return snapshot


def _run(job_id: str, path: Path) -> None:
    def progress(p: float, step: str) -> None:
        with _lock:
            if job_id in _jobs:
                _jobs[job_id].update(state="running", progress=round(p, 3), step=step)

    try:
        with _worker_lock:
            result = analyze(path, progress)
        with _lock:
            wav = drum_stem_wav(result)
            if wav:
                _stems[job_id] = (time.time(), wav)
            result["drumStem"] = bool(wav)
            _jobs[job_id] = {"state": "done", "progress": 1.0, "step": "Done", "result": result}
    except Exception as e:  # noqa: BLE001 - report any failure to the client
        traceback.print_exc()
        with _lock:
            _jobs[job_id] = {"state": "error", "progress": 1.0, "step": "Failed", "error": str(e)}
    finally:
        path.unlink(missing_ok=True)
