---
version: 1
slug: "src-ui-app-tsx"
primary_target: "src/ui/App.tsx"
related_targets: ["src/ui/LibraryScreen.tsx","src/ui/SongDetail.tsx","src/ui/SettingsScreen.tsx","src/ui/ResultsScreen.tsx","src/ui/PlayScreen.tsx","src/ui/styles.css"]
---

# Game frontend (menus, song page, settings, results, HUD)

Scope: every screen in src/ui (Library, Song, Settings, Pause, Calibration, Results, Toasts, controller hints) plus the play HUD chrome. The 3D highway renderer and the developer chart debugger are out of scope except for inheriting tokens.

Mode: Operate. Players pick a song, choose part and difficulty, play, and read results, at a desk (keyboard or controller) or from a couch at TV distance.

Constraints: fully operable by keyboard, controller and mouse; legible at TV distance; nothing competes with the highway during play; no imitation of any existing commercial rhythm game; product name is a working title.

## Direction contract

THESIS: The menus are a stage between songs: every choice is a lit riser you step onto. Refuses the category default of a dark dashboard of rounded cards with one neon accent.

OWN-WORLD: Deep indigo house-lights ground with a violet haze field; magenta for the action that starts music, cyan for the spotlight (focus only), a lit white-edged fill for selection, the five lane colours as part and difficulty data. Archivo set condensed, black, leaning italic for display and numerals; Archivo normal width for UI text. Slabs lean forward with the type (skewed backgrounds), squared, no pills except tiny tags.

STORY: A player sees their own covers as the setlist, picks one, sees parts and difficulties as risers with their best score, presses one big Play, and gets a results reveal that counts up.

FIRST VIEWPORT: Library: wordmark left, Add songs (magenta) and Settings right in one header line; below, a setlist grid of large covers, titles set condensed under each, analysis state as a slim lit bar; the add tile last. Song: cover and listen column left, title block, part risers, difficulty risers with pips and best, Play riser at the bottom of the right column.

FORM: Pinned by the user (proposal approved in conversation), which beats the roll; the roll ran afterwards for provenance only. A working game menu shell with the spotlight-focus signature move: the focused control lifts and a cyan light falls on it (cyan means focus and nothing else), and a lit selection slab slides to the chosen item. seed:c0f6ea4f521701a4

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
