# festival

A rhythm game for your own music. Drop in a song (MP3, WAV, FLAC, OGG, M4A). The game analyzes its percussive, melodic and harmonic content and generates **Lead**, **Bass**, **Drums** and **Vocals** charts at four difficulties:

| Difficulty | Lanes | Feel |
|---|---|---|
| Easy | 4 | quarter notes, chord roots, no chords |
| Medium | 4 | eighth notes, close two-note chords |
| Hard | 4 | sixteenths, two-note chords |
| Expert | 5 | literal transcription, three-note chords |

You play them on a 3D note highway with the keyboard or a controller, in front of a music-reactive 2D stage backdrop. Features: sustains, streak multiplier (up to ×4), overdrive phrases (Space doubles the multiplier), Perfect/Great/Good timing, star rating, best scores, tap calibration and key rebinding.

It runs in the browser and as a desktop app (Tauri).

## Quick start (browser)

```bash
npm install
npm run dev
```

Open http://localhost:5173. A built-in demo track is always available.

Default keys are `D F J K` (plus `L` on Expert), `Space` for overdrive and `Esc` to pause. All of them can be changed in Settings.

Controllers (Xbox, PlayStation 4 and 5, Nintendo Switch and most others) work in the menus and in songs. By default the lanes are D-pad left, D-pad right and the left, top and right face buttons (four-lane difficulties skip the top one), the right trigger triggers overdrive and Start/Options/+ pauses. Every lane and overdrive can be rebound to any button, trigger or stick direction in Settings → Controller, where the button glyphs follow the connected controller or can be fixed to one style. Rumble is off, weak or strong. In the desktop app, a PS5 DualSense connected by USB automatically plays each hit on its left or right haptic motor, following the lane.

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
6. **Melody** – [Basic Pitch](https://github.com/spotify/basic-pitch) (TF.js, WebGL) transcribes notes, which are split into the parts a band plays (`src/analysis/pitch/lines.ts`):
   - **Bass**: the lowest line, with octave doublings folded onto one octave.
   - **Lead**: the main instrument. Chords (three or more steady pitches struck together) stay chords; single-note riffs are followed as one melodic path. Long stretches without an instrument double the vocal melody.
   - **Vocals**: the sung line. Sung notes carry pitch bends (vibrato, slides) that synths and keys don't, and a dynamic-programming path keeps the line continuous.
   A harmonic-salience pitch tracker is the fallback.
7. **Structure** – sections and energy drive overdrive placement.

### Charting

Charts follow common five-lane authoring practice (`src/chart/generator.ts`, `src/chart/profiles.ts`):

- **Expert** is a literal transcription: sixteenths, plus triplets where the timing clearly is triplet.
- **Lanes follow the pitch** within each phrase (two bars, or up to a rest). The lowest note goes left and the highest right, the same pitch keeps its lane, and leaps move further than steps. Long runs wrap, and a repeated phrase is charted identically.
- **Chord shapes** come from the interval: adjacent lanes for close voicings, one lane apart for fifths, wider for octaves.
- **Each lower difficulty reduces the one above it:**
  - Hard drops three-note chords and thins very fast notes.
  - Medium keeps eighths and close chords.
  - Easy keeps quarter notes, playing the root of each chord.
- **Drums** use a fixed kit layout (kick left, snare middle, hi-hats right). Hi-hats thin out first on lower difficulties.
- **Overdrive phrases** cover the same musical passages on every difficulty.

To tune analysis or charts on your own files without the UI, see `scripts/dev/analyze.dev.ts` (`npm run dev:analyze`).

### Optional ML service

`ml-service/` is a local Python service. It adds Demucs stem separation and per-stem transcription, which give more accurate charts. Enable it under **Settings → Analysis service**. If it is not running, the game falls back to in-app analysis. Songs analyzed this way keep their stems, and the song page's **Listen** buttons play each one (instruments, bass, drums, vocals) for checking the separation. See [ml-service/README.md](ml-service/README.md).

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
