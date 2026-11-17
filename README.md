# festival

A rhythm game for your own music. Drop in a song (MP3, WAV, FLAC, OGG, M4A). The game analyzes its percussive, melodic and harmonic content and generates **Lead**, **Bass**, **Drums** and **Vocals** charts at four difficulties:

| Difficulty | Lanes | Feel |
|---|---|---|
| Easy | 4 | quarter notes, chord roots, no chords |
| Medium | 4 | eighth notes, close two-note chords |
| Hard | 4 | sixteenths, two-note chords |
| Expert | 5 | literal transcription, three-note chords |

You play them on a 3D note highway with the keyboard or a controller, in front of a live 3D festival stage that follows the music: a band, a crowd of thousands, beams, screens and pyro (with a light 2D backdrop as the fallback). Features: sustains, streak multiplier (up to ×4), overdrive phrases (Space doubles the multiplier), Perfect/Great/Good timing, star rating, best scores, tap calibration and key rebinding.

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

## The 3D stage

The stage is built in Blender and drawn by the game's own renderer (`src/render/aurora`). Two scripts regenerate everything the repository ships in `public/stage/aurora`:

```
blender -b --factory-startup -P tools/stage/aurora/build_venue.py -- --out public/stage/aurora
blender -b --factory-startup -P tools/stage/aurora/build_figures.py -- --out public/stage/aurora
```

`build_venue.py` makes the stage geometry, its baked contact shading and the positions the game needs (cameras, fixtures, band marks, pyro); add `--save some.blend` to open the result in Blender. `build_figures.py` makes the project's own band and crowd: jointed figures with animation loops that are posed in the script and timed to the beat.

During development, `/#stage?preset=high&shot=hero&level=0.9` shows the stage alone with a simulated song.

### Optional: downloaded characters

The game can use rigged characters with motion-captured animation in place of its own figures. They are not part of this repository, because their licence allows shipping them inside a game but not passing them on. To use them on your machine:

1. Download the files named at the top of `tools/stage/aurora/build_people.py` from [Mixamo](https://www.mixamo.com/) as FBX into `local-audio/mixamo/`: the band members with their animation and skin, the crowd characters in T-pose, the crowd animations without skin.
2. Run `blender -b --factory-startup -P tools/stage/aurora/build_people.py`.

The script reduces the crowd characters to a few hundred triangles, bakes their textures into vertex colours, retargets the crowd animations onto each of them and writes the result to `public/stage/aurora/local/`, which git ignores. When that folder exists the game loads it instead of the default figures, in development and in builds made from that checkout. Check the characters' current terms before you distribute such a build.

Both scripts write the same format: plain meshes whose vertices carry up to four joints and weights, and a small texture of joint matrices per animation frame, which the game uses to animate thousands of instances in a vertex shader.

## Licence

Copyright 2026 DavidNiessen. The source code and the project's own art (stage model, figures, animation loops, app icon) are licensed under the [Apache License 2.0](LICENSE); see [NOTICE](NOTICE).

Third-party parts keep their own licences:

| Part | Licence |
|---|---|
| three.js, React, fft.js, music-metadata | MIT |
| idb, lucide-react | ISC |
| Basic Pitch (code and model), Tauri | Apache-2.0 (Tauri also MIT) |
| Archivo typeface | SIL Open Font License 1.1 |
| Optional analysis service: FastAPI, librosa, Demucs and others | their own licences; see `ml-service/requirements*.txt` |

The optional analysis service downloads Demucs's pretrained models when it first runs; they are not part of this repository and have their own terms. Songs you import stay on your machine.
