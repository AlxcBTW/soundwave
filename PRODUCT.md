# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Desktop-first: shipped as a Tauri desktop app (Windows first) whose UI is a web view; the same build also runs in a desktop browser.

## Users

Rhythm-game players who want to play along to their own music collection. The game is headed for a public release, so first-time players arriving with no context are a primary audience, alongside returning players building up a library.

They play in three settings, all of which must work: at a desk with a keyboard, at a desk with a controller, and from a couch with a controller on a TV several metres away.

## Product Purpose

Players import their own songs (MP3, WAV, FLAC, OGG, M4A) and the game analyzes each one into playable charts. Each song gets four parts (Lead, Bass, Drums, Vocals) at four difficulties (Easy, Medium and Hard on four lanes, Expert on five). Players play those charts on a scrolling note highway, scoring timed hits with streaks, a multiplier and overdrive phrases.

Success: any song a player owns turns into a chart that feels like playing the instrument, and the loop of picking a song, playing and improving feels quick and rewarding.

## Positioning

The game charts the player's own music. There is no fixed setlist: every song comes from the player's library and is analyzed locally, with optional stem separation from a local analysis service for more accurate charts.

## Operating Context

- Import by file picker or drag and drop; analysis runs in the background with progress per song and can take a minute or more per song.
- A song page offers stem previews (instrument, bass, drums, vocals), part and difficulty choice, best scores, re-analysis, a chart debug view and removal.
- Play: countdown, highway with lanes and hit pads, score, stars, multiplier, overdrive meter, break countdowns for long gaps, pause with resume/restart/quit, results with grades, accuracy, streak and stars.
- Settings: General (note speed, volume, audio offset and tap calibration), Keyboard bindings, Controller (detected controllers, glyph style, bindings, rumble), Analysis (local service).
- Input: keyboard and game controllers (Xbox, PlayStation 4 and 5, Switch and others), including full menu navigation by controller with confirm/back conventions per controller family; rumble and DualSense haptics.

## Capabilities and Constraints

- Everything must be fully operable by keyboard alone and by controller alone; mouse is optional.
- Must read from a couch at TV distance as well as at a desk.
- Audio playback is the core of the experience; UI motion must never compete with the gameplay highway or cost frame time during play.
- The product name is open: "Festival" is a working title and the design must not depend on it.
- The game must not name, imitate or recreate any existing commercial rhythm game, in look, copy, assets or layouts.
- The settings layout is tabbed; the screen set is Library, Song, Play (with Pause), Results, Settings, plus a developer chart-debug screen.

## Evidence on Hand

- A generated demo track ships in the app; all other content is the player's own music with embedded cover art when available (generated letter covers otherwise).
- No testimonials, press, customers or download numbers exist; none may be invented.

## Product Principles

1. Your music, playable in minutes: importing and starting a song should take as few steps as possible.
2. Any input, any distance: every screen works by keyboard, controller and mouse, at a desk and from the couch.
3. The highway is sacred: during play nothing distracts from reading notes.
4. Honest feedback: analysis progress, failures and fallbacks are always visible.
5. Feels like playing: timing, feedback and rumble make hits feel physical.

## Accessibility & Inclusion

- Full keyboard-only and controller-only operation with clearly visible focus.
- Large, high-contrast text legible at TV distance.
- Respect reduced-motion preferences for non-essential animation.
- Sound is muted in automated testing; all states must also be understandable without audio.
