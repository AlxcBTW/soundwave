# Models

The neural models the game uses are kept in this repository, not fetched from package registries at install time.

| Model | Where | What it is | Terms |
|---|---|---|---|
| Stem separation | `models/htdemucs/htdemucs-v1.onnx` (90 MB) | Demucs `htdemucs` (Défossez, Rouard, Massa; Meta), exported to ONNX by `tools/analysis/export_stem_model.py` with the transform left to the game and the weights stored as float16. | The Demucs code is MIT. Its authors state that the licence of the weights is not clear, because part of the training music was only cleared for research. |
| Note transcription | `public/models/basic-pitch/nmp.onnx` (0.2 MB) | Spotify's Basic Pitch as ONNX, as shipped in the `basic-pitch` 0.4.0 Python package (`saved_models/icassp_2022/nmp.onnx`). | Apache-2.0 |
| Note transcription, TensorFlow.js | `models/basic-pitch-tfjs/` (0.9 MB) | The same network as shipped in `@spotify/basic-pitch` 1.0.1, used only by the offline tooling in `scripts/dev/`. | Apache-2.0 |

The transcription model is served with the game (the ONNX file; the TensorFlow.js copy is not served). The stem model is too large for that: the game downloads it once, on first launch, from this folder on GitHub, read at a fixed commit. `src/analysis/separation/model.ts` holds that commit and the size and SHA-256 the download is checked against.

After re-exporting the stem model, commit it, then give it a new id in `src/analysis/separation/model.ts` along with the new commit, size and SHA-256 (a game already installed keeps reading the file it knows).
