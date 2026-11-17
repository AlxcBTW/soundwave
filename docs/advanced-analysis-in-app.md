# Moving the advanced analysis into the app: findings and recommendation

Research only, 17 November 2026. No product code was changed. The scripts behind the measurements are in the shared notes folder under `advanced-analysis-experiments/`.

> **Status, same day:** the recommended route is built (see "How analysis works" in the README). What was decided differently from this report: there is no fast mode and no fallback, so every song is separated into stems and phones do not analyze songs; the model downloads automatically on first launch, for now from Intel's published copy (171 MB), while the repository's own 90 MB export waits in `models/htdemucs/` for the repository to become readable without signing in. Measured in the finished app on the same machine: 20 s to separate a 245 s song on WebGPU, plus 39 s for Basic Pitch on the three stems, which is now the slowest step. Not yet checked: the desktop app's own web view.

## Summary

- The only thing the service adds that the app cannot do itself is **stem separation** (Demucs). The app already ships the transcription model and already rebuilds the lines, beats, drums and chords itself.
- **Desktop: recommended route is to run the separation model in the web view with ONNX Runtime Web**, WebGPU first and WASM as the fallback. I exported the model and ran it this way: output matches PyTorch, and one 7.8 s segment takes about 0.2 s on WebGPU, so roughly 10 s per 4-minute song on this machine.
- **Web app: partly.** Desktop browsers with WebGPU: yes, with the same code. Browsers without WebGPU: possible but slow (minutes per song). Phones: not realistic today; they keep the existing in-app analysis.
- **Two things need your decision before any work starts**: the licence of the Demucs weights is unclear (their author says so), and the model is a 90 MB file that has to be either bundled or downloaded.
- **The smaller alternative, SCNet, was tested (section f)**: clear licence and a 13 MB file, but worse vocal charts on the one song with a reference, no faster on CPU, and about nine times slower on WebGPU.

## (a) What the advanced analysis does today

`ml-service/` is a FastAPI server on `127.0.0.1:8765`. The game uploads the decoded song as WAV (`POST /jobs`), polls once a second (`GET /jobs/{id}`), then downloads four stems (`GET /jobs/{id}/stems/{name}.wav`, mono 16-bit 22.05 kHz). `GET /health` reports which engines are installed and whether CUDA is used.

Per song the service:

1. Separates four stems (drums, bass, other, vocals) with Demucs `htdemucs`: one model, 42.0 million parameters, processing 7.8 s stereo segments at 44.1 kHz with 25 % overlap (42 segments for a 4-minute song).
2. Runs Basic Pitch on the bass, vocal and other stems (its 230 KB ONNX model, through onnxruntime on the CPU).
3. Computes beats, drum hits, chords, key and sections with librosa, and builds bass, lead and vocal lines (`lines.py`).

What the game uses of that (`src/analysis/manager.ts`, `src/analysis/pipeline.ts`): the four stems and the raw per-stem notes (`stemNotes`). With those it rebuilds all three lines itself (`pitch/stemLines.ts`), detects drums on the drum stem, and always computes beats, chords, key and sections itself. The service's step 3 is discarded, apart from its lines being a fallback when a stem has no notes; `pitch/lines.ts` already holds the same logic.

So in-app advanced analysis needs two things: **the separation model, and the existing in-app Basic Pitch transcriber (TF.js, already shipped, 0.9 MB) run on three stems instead of once on the mix.**

### Models and licences

| Item | Size | Licence |
|---|---|---|
| Demucs `htdemucs` weights (`955717e8.safetensors`) | 84.0 MB, stored as float16 | **Unclear.** The code is MIT. The author's README says the licence of the weights "is not clear" because the training data included research-only material; in 2022 he wrote they are "provided only for scientific purposes"; the MIT tag was removed from the official Hugging Face page on 2026-08-31. Copies tagged MIT elsewhere are self-assigned. (Read, not legal advice.) |
| Basic Pitch model | 0.23 MB (ONNX), 0.9 MB (TF.js) | Apache-2.0, already shipped in the app |

### Python dependencies (as installed)

Python 3.14.6; torch 2.11.0+cu128, demucs 4.1.0, basic-pitch 0.4.0 (installed without its TensorFlow pin), onnxruntime 1.32.0 (CPU), librosa 1.0.1, scipy 1.18.1, numba 0.68.1, fastapi 0.163.1, uvicorn 0.54.0. The virtual environment is **4.96 GB**, of which torch with CUDA is 4.2 GB.

### Run time, measured

Machine: Ryzen 7 7800X3D (8 cores), 64 GB, RTX 4090 (in use by other apps at 40 to 70 % during the runs). Song: `local-audio/alive.flac`, 245 s.

| Stage | GPU (CUDA) | CPU, 8 threads | CPU, 4 threads |
|---|---|---|---|
| Separation | 6.0 s first run, 3.1 s warm | 55 s | 87 s (partly disturbed by another job) |
| Basic Pitch, three stems | 6.7 s | 7.2 s | 9.0 s |
| librosa steps (discarded by the game) | 3.8 s | 7.8 s | 4.7 s |
| Whole process incl. start-up | 24 s | 78 s | 105 s |

Peak memory of the process: 2.6 to 2.9 GiB. GPU memory allocated by PyTorch: 0.54 GiB.

## What I tested for the in-app routes

All measured here unless marked as read.

- **Export to ONNX works.** With the STFT and inverse STFT left outside the graph, `torch.onnx.export` (torch 2.11, both the new and the legacy exporter) produces a 171 to 174 MB file using only ordinary operators. ONNX Runtime on the CPU matches PyTorch to 77 dB on a segment. Over the whole song the stems match to 45 to 71 dB; my test handled the final segment more simply than Demucs does, which I assume explains the gap but did not confirm.
- **The file can be halved.** Storing the weights as float16 (as the original does) and computing in float32 gives **90.4 MB** with the same output.
- **Native CPU speed equals PyTorch**: 53.6 s for the song with ONNX Runtime 1.32 (51.5 s model, 2.0 s STFT). Peak memory about 2.5 GiB while a segment runs, about 290 MiB between segments.
- **DirectML gave wrong results.** With the last DirectML build of ONNX Runtime (1.24.4; DirectML is in maintenance), the new-exporter file fails to load, and the legacy file runs fast (5.3 s for the song) but outputs garbage (values up to 100,000, at every optimisation level). Not root-caused.
- **WebGPU in the browser works and is correct.** ONNX Runtime Web 1.31.1 in the desktop app's Chromium browser pane, on the RTX 4090: session ready in 0.8 to 1.6 s, first segment 1.0 to 2.5 s, then **0.19 to 0.25 s per segment**, matching the native CPU output to 74 to 85 dB, also with the 90 MB file. That is about 8 to 11 s of model time per song, plus the STFT in JavaScript (not measured).
- **WASM in the browser is about 20 times slower than WebGPU**: 4.6 s per segment with 4 threads (no gain from 8), 12.2 s with one thread. Per song: about 3.2 minutes threaded, 8.5 minutes single-threaded, on this fast desktop CPU.

Not tested: the app's own web view (WebView2), any integrated, AMD or Intel GPU, memory use in the browser, Basic Pitch run three times in-app, macOS and Linux.

## (b) Desktop options

| | A. Bundle the Python service as a sidecar | B. Native in Rust (`ort` crate) | C. In the web view (ONNX Runtime Web) |
|---|---|---|---|
| To build | Freeze the service (PyInstaller), start and stop it from Rust, per-platform builds | STFT, inverse STFT and segment logic in Rust; commands with progress; stems passed to the web view | The same logic in TypeScript in a worker; model loading and caching |
| Installer today: 9.6 MB | CPU only: torch alone is 129 MB packed, 484 MB unpacked; whole bundle roughly 300 to 400 MB packed (estimate, not built). With CUDA: over 4 GB, above the 2 GB installer limit, so a multi-GB first-run download | +22 MB runtime, +90 MB model (or downloaded) | +about 29 MB WASM runtime before compression, +90 MB model (or downloaded) |
| Speed per 4-min song | As today: 6 s GPU (NVIDIA only), 55 to 90 s CPU | CPU 54 s (8 cores). GPU unresolved: DirectML wrong, CUDA needs about 1 GB of NVIDIA libraries (read), native WebGPU provider experimental (read) | WebGPU about 10 s here; WASM 3 to 9 minutes |
| Platforms | Three separate frozen builds | Windows, macOS, Linux on CPU | Windows: WebGPU expected (WebView2 follows Edge; not verified in the app). macOS: WebGPU only from macOS 26, with an open memory bug in Safari's engine with this runtime (read), so WASM. Linux: no WebGPU in WebKitGTK (read), so WASM |
| Serves the web app too | No | No | Yes, same code |
| Main risks | Size, antivirus false positives, orphaned processes on Windows, slow start | GPU on Windows has no working path yet; logic written twice if the web app follows | The WebGPU provider is still labelled experimental; slow without a usable GPU; unknown speed on integrated graphics |

**Recommendation: C**, with the fallback order WebGPU, then threaded WASM (with a time warning), then the existing in-app analysis. It is the only route where the GPU result was both fast and correct in my tests, it adds the least to the installer, and it is the same code the web app needs. If WASM proves too slow on machines without WebGPU, a CPU-only native path (B without any GPU work) can be added later using the same model file. A is not worth it: it is the largest download and helps neither the web app nor non-NVIDIA GPUs.

## (c) Web app: partly

- **Desktop browsers with WebGPU** (Chrome and Edge; Firefox on Windows and Apple-silicon Macs; Safari 26): yes, same engine as the desktop app. WebGPU needs no special hosting headers.
- **Without WebGPU**: WASM works but needs cross-origin isolation for threads (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`). Cloudflare Pages, Netlify and Vercel can set these; GitHub Pages cannot (a service-worker workaround exists). Expect several minutes per song.
- **Phones: no, for now.** A segment needs about 2.5 GiB at peak natively; iPhones reliably give a page a few hundred MB (read); the WebGPU builds of the runtime currently crash Safari on iOS 26 through runaway memory (read, open bug); one published figure is 5 to 10 s per segment on an iPhone 15 Pro (read), so 4 to 7 minutes per song. I found no report of a successful run on a phone.
- **Model download and caching**: 90 MB once, stored in Cache Storage or the origin private file system; the runtime accepts the bytes directly. Chromium allows this easily. Safari deletes site storage after 7 days without a visit unless the site is on the home screen (read).
- **Fallback**: anything that cannot run it (no WebGPU and no isolation, too little memory, a phone, a failed download) uses today's in-app analysis, exactly as when the service is unreachable now.

A smaller model does not change the phone answer: SCNet (13 to 43 MB, weights explicitly MIT according to its author) was tested afterwards and is no faster and nearly as memory-hungry as Demucs. See section (f).

## (d) Work for the recommended route

Rough sizes for one developer; about two weeks in total.

1. **Spike in the real app (0.5 to 1 day)**: confirm WebGPU inside the Tauri web view on Windows, measure an integrated GPU, measure memory, time Basic Pitch on three stems. Stop here if any of these fails.
2. **Model asset (1 day)**: export script in `tools/`, float16 storage, checksum, bundling or download with progress, caching, removal.
3. **Separation engine in a worker (2 to 3 days)**: 44.1 kHz stereo input, normalisation, segmenting with overlap and Demucs's padding, STFT and inverse STFT (extending `src/analysis/dsp/stft.ts`), ONNX Runtime Web session, progress, cancel. A test that compares the stems against PyTorch reference output.
4. **Transcription on stems (0.5 to 1 day)**: run the existing transcriber on bass, vocals and other to produce `stemNotes`.
5. **Wiring (1 day)**: an in-app analyzer in place of `mlAnalyzer` that fills the same `Assist` structure; stems stored as today.
6. **Settings and messages (1 day)**: replace the service toggle and address with one switch, model state, which device is used, expected time, fallback notices.
7. **Tauri and hosting (0.5 day)**: isolation headers (`app.security.headers`, Vite `server.headers`) for threaded WASM, runtime files copied by `scripts/copy-models.mjs`.
8. **Cleanup (0.5 day)**: README, licence notes, and keep or remove `ml-service/`.

## (e) Decisions that are yours

1. **Weights licence.** Today the user's own Python install fetches the weights; in-app, the project would distribute them (bundled or from a host you control). Accept that, keep stem separation as an opt-in download with its terms shown, or switch to SCNet and accept what section (f) found: worse vocal charts on the one song with a reference, and about nine times slower on WebGPU?
2. **Bundle or download.** Installer of about 110 MB with everything inside, or about 20 MB plus a 90 MB download on first use (which needs a host)?
3. **Minimum hardware.** Is the feature offered on CPU-only machines at 3 to 10 minutes per song, or only where WebGPU is available?
4. **Phones.** Recommended: off, with the existing analysis. Agree?
5. **Web hosting.** Where is the web build served, and can it send the two isolation headers?
6. **macOS and Linux.** Both would run on WASM for now. Is that acceptable, or does the native CPU path become part of the first version?
7. **The Python service.** Keep it as a developer reference tool or remove it once the in-app route works?

## (f) Would the smaller model (SCNet) cost accuracy?

Tested after the main research. Short answer: **yes on vocals, no on drums and lead, and it was better on bass, on the one song where there is something to score against. It brings no speed or memory advantage, only a smaller download and a clear licence.**

Setup: the official SCNet code and checkpoint (10.6 million parameters, 42.4 MB, hash checked against the published one), 11 s segments with 50 % overlap. Both models' stems went through the same Basic Pitch step and the game's own pipeline (`npm run dev:analyze` with `ANALYSIS=hybrid`). Four songs: `alive`, `rivers`, `layall` and `sna`. A fifth, `givenchy.mp3`, had disappeared from `local-audio/` by the time its turn came.

### Against a human-made chart (one song, `sna`)

Scored with the existing `scripts/dev/compare.dev.ts`. Demucs was run twice because its random time shift makes results vary between runs.

| Expert chart, onset F1 | Demucs run 1 | Demucs run 2 | SCNet |
|---|---|---|---|
| Vocals (within 100 ms) | 74 % | 74 % | **65 %** |
| Vocals precision | 61 % | 61 % | **49 %** |
| Lead | 66 % | 66 % | 66 % |
| Bass | 58 % | 56 % | **69 %** |
| Drums | 93 % | 93 % | 93 % |

The vocal loss has a visible cause. That song's reference comes with the true isolated vocal track. In the stretches where nobody sings, SCNet's vocal stem still carries sound at −12 dB relative to the sung parts; Demucs's is at −33 dB. The transcriber turns that leak into notes: 492 vocal notes against 390, for 252 in the reference.

### Against each other (four songs)

Share of note onsets the two analyses agree on (lines within 50 ms, drums within 30 ms). The first number is a second Demucs run against the first, which is the noise floor; the second is SCNet against Demucs.

| Song | Vocals | Lead | Bass | Kick | Snare | Hat |
|---|---|---|---|---|---|---|
| alive | 92 / 67 | 85 / 48 | 88 / 64 | 97 / 91 | 99 / 93 | 99 / 92 |
| rivers | 92 / 75 | 98 / 87 | 99 / 98 | 99 / 84 | 99 / 96 | 98 / 73 |
| layall | 95 / 76 | 94 / 78 | 95 / 89 | 98 / 89 | 98 / 88 | 100 / 98 |
| sna | 97 / 81 | 92 / 68 | 88 / 70 | 95 / 90 | 98 / 93 | 98 / 82 |

SCNet's charts differ from Demucs's on every song by clearly more than Demucs differs from itself. Different is not the same as worse: only `sna` has a reference, and there the difference went against SCNet on vocals and for it on bass. The line-building thresholds in `src/analysis/pitch/stemLines.ts` were tuned on Demucs stems, so some of the gap may be tuning.

### Cost (same song and machine as above)

| | Demucs | SCNet |
|---|---|---|
| Model file | 90 MB | 12.9 MB (published 8-bit ONNX) or 42.4 MB |
| PyTorch, GPU | 3 to 6 s | 7 to 9 s |
| PyTorch, CPU 8 threads | 55 s | 57 s |
| ONNX Runtime, CPU, one segment | 1.3 s per 7.8 s | 1.5 s per 11 s |
| Peak memory, CPU, one segment | 2.5 GiB | 1.8 GiB |
| Browser WebGPU, one segment | 0.2 s per 7.8 s | **2.0 s per 11 s** |
| Browser WASM, 4 threads, one segment | 4.6 s per 7.8 s | 5.0 s per 11 s |

SCNet's recurrent layers do not run on the WebGPU provider and fall back to the CPU, so the GPU route that makes Demucs take about 10 s per song takes about 90 s with SCNet.

### What this means

- Stay with Demucs for quality and speed if its weights licence is acceptable.
- SCNet is the fallback if it is not. Expect noisier vocal charts until the vocal line-building is re-tuned, and analysis that takes one to two minutes even with a GPU.
- It does not make phones viable.

Limits of this test: one song with a reference chart; chart quality was measured with the full-precision checkpoint and speed with the published 8-bit file (its page reports the two score within 0.01 dB of each other); the larger SCNet variant (better published scores, same licence) was not tried; SCNet ran without the random-shift trick its authors use, which they say adds up to 0.2 dB.

Side finding: with Demucs, two analyses of the same song already disagree on 1 to 15 % of line onsets, and on two of the four songs many bass notes landed an octave apart (same note name 98 to 100 %, same octave 50 and 73 %). The in-app version should use a fixed shift so a song always charts the same way.

The compared stems and analyses are in `local-audio/cmp_<song>_demucs.*` and `local-audio/cmp_<song>_scnet.*` (478 MB, safe to delete).
