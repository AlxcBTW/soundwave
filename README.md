# festival

A rhythm game for your own music. Drop in a song (MP3, WAV, FLAC, OGG, M4A). The game analyzes its percussive, melodic and harmonic content and generates **Drums**, **Bass** and **Lead** charts at four difficulties:

| Difficulty | Lanes | Feel |
|---|---|---|
| Easy | 4 | quarter notes, no chords |
| Medium | 4 | eighth notes, occasional 2-note chords |
| Hard | 4 | denser eighths, more chords and sustains |
| Expert | 5 | sixteenths, 3-note chords |

You play them on a 3D note highway with the keyboard, in front of a music-reactive 2D stage backdrop. Features: sustains, streak multiplier (up to ×4), overdrive phrases (Space doubles the multiplier), Perfect/Great/Good timing, star rating, best scores, tap calibration and key rebinding.

It runs in the browser and as a desktop app (Tauri).

## Quick start (browser)

```bash
npm install
npm run dev
```

Open http://localhost:5173. A built-in demo track is always available.

Default keys are `D F J K` (plus `L` on Expert), `Space` for overdrive and `Esc` to pause. All of them can be changed in Settings.

## Desktop app

The desktop app needs the [Tauri prerequisites](https://tauri.app/start/prerequisites/): Rust (rustup), the MSVC C++ build tools and WebView2 (on Windows).

```bash
npm run tauri dev      # run the desktop app
npm run tauri build    # build an installer (NSIS/MSI on Windows)
```

## Production web build

```bash
npm run build          # outputs static files to dist/
npm run preview
```

## How analysis works

Analysis runs in a Web Worker in both the browser and the desktop app:

1. **Spectrum** – STFT (2048/512 at 22.05 kHz).
2. **Harmonic/percussive separation** – median-filter HPSS.
3. **Rhythm** – band-balanced onset envelope, tempo by an autocorrelation comb, dynamic-programming beat tracking. The grid is then calibrated against the detected drum attacks.
4. **Drums** – kick/snare/hat onsets from band-limited flux of the percussive part, refined to the attack in the time domain.
5. **Harmony** – chroma, chord changes, key.
6. **Melody** – [Basic Pitch](https://github.com/spotify/basic-pitch) (TF.js, WebGL) transcribes notes, which are split into bass and lead lines. A harmonic-salience pitch tracker is the fallback.
7. **Structure** – sections and energy drive note density and overdrive placement.

Charts are generated deterministically from the analysis (`src/chart/generator.ts`): grid quantization, per-difficulty density budgets, drum-kit lane layout, pitch-contour lane mapping, chords, sustains and overdrive phrases.

### Optional ML service

`ml-service/` is a local Python service. It adds Demucs stem separation and per-stem transcription, which give more accurate charts. Enable it under **Settings → Analysis service**. If it is not running, the game falls back to in-app analysis. See [ml-service/README.md](ml-service/README.md).

## Tests

```bash
npm test
```

Unit tests cover:

- tempo, beat and drum timing on synthetic audio;
- HPSS;
- bass and lead pitch extraction;
- chart invariants: lanes, gaps, chords, sustains, determinism, density by difficulty;
- judging, scoring and overdrive.
