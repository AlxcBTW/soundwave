---
version: 1
slug: "src-ui-app-tsx"
primary_target: "src/ui/App.tsx"
related_targets: ["src/ui/HomeScreen.tsx","src/ui/LibraryScreen.tsx","src/ui/LobbyScreen.tsx","src/ui/SettingsScreen.tsx","src/ui/ResultsScreen.tsx","src/ui/PlayScreen.tsx","src/ui/styles.css"]
---

# Game frontend (menus, setlist flow, settings, results, HUD, touch)

Scope: every screen in src/ui (Home, Music library, Song details, Ready up, Play with Pause, Results, Set summary, Settings, Calibration, Toasts, action bar) plus the play HUD and the touch play controls. The developer chart debugger is out of scope except for inheriting tokens.

Mode: Operate. Players build a setlist of up to four of their own songs, pick a part and difficulty, play the set back to back and read results, with a keyboard and mouse, a controller from the couch, or a touchscreen down to phone size.

Constraints: every screen fully operable by mouse, keyboard, controller and touch, with the interface switching variant on the last input used; legible at TV distance and on a phone; nothing competes with the highway during play; no copy of any existing commercial rhythm game's assets, palette, type or naming; product name is a working title.

## Direction contract

THESIS: The menus are the night sky over an open-air stage: rounded violet panels float over the live stage, and one aurora-coloured ring travels from control to control as the player moves. Refuses the category default of a flat dark dashboard with a neon accent and a static focus outline.

OWN-WORLD: Layered violet night (deep indigo ground rising through saturated violet), panels as solid rounded violet sheets with a lit top edge. Hot pink acts, aurora mint is focus and nothing else, a pale lavender fill with dark ink marks the selection, gold is earned, the five lane colours stay data. Archivo at wide width, black, italic and uppercase for titles and numbers; Archivo normal width upright for reading.

STORY: A player picks a set tile, fills four numbered slots from a searchable list of their own covers, chooses part and difficulty, holds Ready up, plays the songs back to back and gets a counted-up result per song and a set total.

FIRST VIEWPORT: Home: wordmark left, Add songs and Settings right; a row of set tiles with cover mosaics (Your setlist widest), an action bar along the bottom whose hints change with the input in use. Library: rows of covers left, the highlighted song and four numbered setlist slots right, Ready up as the one pink action in the bar.

FORM: Pinned by the user in conversation (new look in the spirit of supplied references, full setlist flow), which beats the roll; the roll ran for provenance only. Signature interaction: the travelling aurora focus ring, with hints, targets and layouts that change variant with the input in use. seed: none (unavailable)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
