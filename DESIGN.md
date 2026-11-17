---
name: Festival (working title)
description: A rhythm game that charts your own music; its menus are a lit stage between songs.
colors:
  ground: "#0a0720"
  haze: "#2b1a6b"
  slab: "#1b1446"
  slab-raised: "#251b5c"
  slab-line: "rgba(176, 156, 255, 0.24)"
  slab-lit: "#3a2d86"
  ink: "#f5f2ff"
  ink-2: "#c4bbef"
  ink-3: "#958cc8"
  magenta: "#ff2e8b"
  magenta-2: "#ff6aac"
  cyan: "#33e7ff"
  gold: "#ffd23d"
  danger: "#ff4d66"
  lane-0: "#3ddc5a"
  lane-1: "#ff3b4e"
  lane-2: "#ffd23d"
  lane-3: "#3a8bff"
  lane-4: "#ff8a1f"
  overdrive: "#bfe6ff"
typography:
  display:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "clamp(1.9rem, 2.6vw, 2.8rem)"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "0.01em"
    fontVariation: "'wdth' 62"
  headline:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "clamp(2.4rem, 5vw, 5rem)"
    fontWeight: 900
    lineHeight: 0.92
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 68"
  title:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "clamp(2rem, 3vw, 3rem)"
    fontWeight: 900
    lineHeight: 1
    fontVariation: "'wdth' 68"
  score:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "clamp(3.4rem, 8vw, 6rem)"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontFeature: "'tnum'"
    fontVariation: "'wdth' 68"
  button:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 850
    letterSpacing: "0.02em"
    fontVariation: "'wdth' 68"
  label:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 800
    letterSpacing: "0.08em"
    fontVariation: "'wdth' 68"
  subhead:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "clamp(1.05rem, 1.4vw, 1.4rem)"
    fontWeight: 600
    fontVariation: "'wdth' 100"
  body:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.45
    fontVariation: "'wdth' 100"
  body-strong:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    fontVariation: "'wdth' 100"
rounded:
  none: "0px"
  tag: "3px"
  cover: "4px"
  round: "50%"
spacing:
  xs: "0.4rem"
  sm: "0.6rem"
  md: "1rem"
  lg: "1.4rem"
  xl: "1.8rem"
  gutter: "clamp(1rem, 3vw, 3rem)"
components:
  button-secondary:
    backgroundColor: "{colors.slab}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.none}"
    padding: "0.55rem 1.4rem"
    height: "2.75rem"
  button-secondary-hover:
    backgroundColor: "{colors.slab-raised}"
    textColor: "{colors.ink}"
  button-primary:
    backgroundColor: "{colors.magenta}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.none}"
    padding: "0.55rem 1.4rem"
    height: "2.75rem"
  button-primary-hover:
    backgroundColor: "{colors.magenta-2}"
    textColor: "{colors.ink}"
  button-primary-big:
    backgroundColor: "{colors.magenta}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0.75rem 2.4rem"
    height: "3.6rem"
  button-small:
    backgroundColor: "{colors.slab}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0.35rem 1rem"
    height: "2.4rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.none}"
    padding: "0.55rem 1.4rem"
  button-ghost-hover:
    backgroundColor: "rgba(255, 255, 255, 0.06)"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0.35rem 1rem"
  riser-part:
    backgroundColor: "{colors.slab}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0.8rem 0.6rem"
    height: "5.6rem"
  riser-difficulty:
    backgroundColor: "{colors.slab}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0.55rem 1.4rem"
    height: "3.6rem"
  selection-slab:
    backgroundColor: "{colors.slab-lit}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
  tab:
    backgroundColor: "{colors.slab}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.none}"
    padding: "0.55rem 1.3rem"
  tab-selected:
    backgroundColor: "{colors.slab-lit}"
    textColor: "{colors.ink}"
  segment:
    backgroundColor: "{colors.slab}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.none}"
    padding: "0.5rem 1.1rem"
  segment-selected:
    backgroundColor: "{colors.slab-lit}"
    textColor: "{colors.ink}"
  keycap:
    backgroundColor: "{colors.slab}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 1rem"
    height: "3rem"
    width: "3.4rem"
  text-input:
    backgroundColor: "{colors.slab}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tag}"
    padding: "0.55rem 0.7rem"
  pill:
    backgroundColor: "rgba(196, 187, 239, 0.12)"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.tag}"
    padding: "0.15rem 0.55rem"
  tag-new-best:
    backgroundColor: "{colors.magenta}"
    textColor: "#ffffff"
    rounded: "{rounded.tag}"
    padding: "0.25rem 0.8rem"
  tag-full-combo:
    backgroundColor: "{colors.gold}"
    textColor: "#2a1d00"
    rounded: "{rounded.tag}"
    padding: "0.25rem 0.8rem"
  song-cover:
    backgroundColor: "{colors.slab}"
    rounded: "{rounded.cover}"
  toast:
    backgroundColor: "{colors.slab-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0.8rem 1rem"
  hud-multiplier:
    backgroundColor: "rgba(10, 7, 32, 0.66)"
    textColor: "{colors.ink}"
    rounded: "{rounded.round}"
    size: "110px"
---

# Design System: Festival (working title)

## Overview

**Creative North Star: "The Stage Between Songs"**

The menus are the stage a player stands on between songs. The house lights are down to a deep indigo, a violet haze rises from the bottom of the screen, and every choice is a riser: a squared slab that leans forward with the type. The control that has focus is the one under the spotlight: it lifts a few pixels and a cyan light falls onto it. What the player has chosen is lit from inside and carries a white edge underneath, and when the choice changes that lit slab travels to the new item instead of blinking. The player's own cover art is the setlist and carries most of the colour on the library screen; the interface around it stays dark and inky so the covers and the single magenta action read first.

The type does the shouting. Archivo is set condensed, black and leaning italic for everything that is display, a control name or a number, and at normal width and upright for everything a player reads as a sentence. Nothing is rounded except the cover art corners (barely), tiny tags, and the round multiplier disc in the HUD. Density is couch-first: one primary column of decisions, large targets, and type sized in rem off a root that grows with the window so the same layout reads at a desk and from across a room.

Motion and feedback are physical but brief. Screens slide in from the side the player is heading, entrances stagger by tens of milliseconds, starting a song sweeps three stage-light bands across the screen, and every move and press has a sound and, on a controller, a matching rumble pulse. During play the menu world steps back: the HUD is quiet chrome around the highway, and nothing in it animates for decoration.

**Key Characteristics:**
- Deep indigo ground with a violet haze field; ink tinted from the ground, never pure grey.
- Squared slabs skewed forward by one shared lean angle (-9deg), matching the italic type.
- Three light roles that never trade places: magenta acts, cyan focuses, a lit white-edged slab marks the selection.
- Lane colours are data (part, difficulty, key binding, multiplier level), not decoration.
- Condensed black italic Archivo for display, controls and numbers; normal-width upright Archivo for reading.
- Rem sizing off a clamped root (16px to 26px) so the whole interface scales for TV distance.
- Every interaction has sound; on a controller it also has a pulse. Reduced motion keeps state changes and drops travel.

## Colors

A night-stage palette: indigo house lights and inked slabs, three saturated lights with fixed jobs, and five lane colours that carry game data.

### Primary
- **Stage Magenta** (magenta): the one forward action on a screen and anything that makes music play: Play (song page), Resume (pause), the live preview button while it plays, Add songs (library), Continue (results). Also the seek and slider fill, the song progress bar in the HUD, the wordmark's glow, the countdown glow, the toast edge and the "New best" tag. Hover lifts it to **Pink Light** (magenta-2), which also tints the setlist count and the file-drop outline.

### Secondary
- **Spotlight Cyan** (cyan): focus, and nothing else, in the menus. It appears as the focused slab's 1px border and inset ring, its glow, the radial spotlight above it, the outline around a focused cover, slider and checkbox focus outlines, and the text caret. The HUD has no focus, so it borrows cyan for one job only: the break-countdown ring (which turns gold on the final bar).

### Tertiary
- **Encore Gold** (gold): earned results. Lit stars, the "Full combo" tag, the final-bar break ring.
- **Warning Red** (danger): destructive confirmation only (the "Delete song" button after Remove is pressed). Error text uses a softened pink-red (#ff9aaa) so long messages stay readable.

### Neutral
- **House Lights** (ground): the page background behind every screen.
- **Violet Haze** (haze): the radial field rising from below the menus (120% by 80% ellipse at 50% 115%, fading out by 60%).
- **Slab** (slab): the resting fill of every button, riser, tab, keycap, checkbox and text field.
- **Raised Slab** (slab-raised): hover fill, toast background, scrollbar thumb.
- **Slab Edge** (slab-line): 1px hairline on slabs, dividers between result stats, dashed outline of the add tile.
- **Lit Slab** (slab-lit): the selected item's fill; always paired with a white edge.
- **Ink** (ink): primary text, the selection underline, slider thumbs, analysis progress fill.
- **Ink 2** (ink-2): secondary text, unselected tab and segment labels, section labels, artist names.
- **Ink 3** (ink-3): tertiary text, stat captions, disabled labels.

### Lane colours (data)
- **Lane 0 Green, Lane 1 Red, Lane 2 Yellow, Lane 3 Blue, Lane 4 Orange** (lane-0 to lane-4): the five note lanes left to right. They also colour key and button bindings (4px underline on keycaps), the HUD lane-key underlines, difficulty pips (Easy green, Medium yellow, Hard orange, Expert red), and multiplier levels (x2 blue, x3 green, x4 orange).
- **Overdrive Ice** (overdrive): the overdrive meter, its ready pulse and the x6/x8 multiplier ring.

### Named Rules
**The Three Lights Rule.** Magenta acts, cyan focuses, a lit slab selects. Cyan never fills, never marks a choice and never decorates in a menu; a selected item is never magenta; focus and selection on the same item show both (lit slab plus cyan ring).

**The One Magenta Rule.** Each screen has at most one magenta button at rest, and it is the step forward (usually the one that starts music). Everything else is a slab or a ghost.

**The Lanes Are Data Rule.** A lane colour always means a lane, a difficulty level or a multiplier level. Never use one as a brand accent or a decorative stripe.

## Typography

**Display Font:** Archivo Variable (with Archivo, system-ui, sans-serif), self-hosted from `@fontsource-variable/archivo` with its width axis, upright and italic.
**Body Font:** the same family at normal width.

**Character:** one family, two voices. Condensed (68%, 62% for the wordmark and generated covers), weight 850 to 900, italic and uppercase is the stage voice for titles, controls and numbers; normal width (100%), upright, mixed case is the reading voice for artists, hints, setting names and errors.

### Hierarchy
- **Display** (900, clamp(1.9rem, 2.6vw, 2.8rem), 62% width): the wordmark only, with a magenta glow behind it. The name is a working title; nothing depends on it.
- **Headline** (900, clamp(2.4rem, 5vw, 5rem), line-height 0.92, balanced wrap): the song title on the song page.
- **Title** (900, clamp(2rem, 3vw, 3rem) to clamp(3rem, 6vw, 4.6rem)): page titles, the results title, "Paused" and "Calibrate".
- **Score** (900, clamp(3.4rem, 8vw, 6rem), tabular): the results score, which counts up over 1.3s with an exponential ease-out. Stat values are 1.8rem/900.
- **Button / control** (850, 1rem; small 1rem; big 1.35rem; uppercase, 68% width, italic): every button, riser, tab and keycap. Difficulty names are 1.35rem/900.
- **Label** (800, 1rem, 0.08em tracking, uppercase, condensed italic): section labels (Part, Difficulty, Listen), the setlist heading, stat captions, pills and tags.
- **Subhead** (600, clamp(1.05rem, 1.4vw, 1.4rem), normal width): the artist line on the song page.
- **Body** (400 to 700, 1rem, line-height 1.45, max 62ch, normal width, upright): hints, errors, setting names (700), lane and note counts.

Numbers that change (scores, times, counts, setting values) use tabular figures.

### Named Rules
**The Two Voices Rule.** If it is a name, a control or a number, set it condensed, black, italic and uppercase. If a player reads it as a sentence, set it at normal width, upright and in sentence case. Never set a sentence in the stage voice.

**The Couch Floor Rule.** The root size is `clamp(16px, 0.62vw + 7px, 26px)` and every menu size is in rem, so the whole interface grows with the window for TV distance. Labels, hints, pills, tags, metadata and small buttons are 1rem or larger.

## Layout

Menus are a single centred stage capped at 1440px wide (settings at 980px), with a horizontal gutter of clamp(1rem, 3vw, 3rem) and a bottom pad of clamp(6rem, 13vh, 11rem) so the last row clears the controller hint strip. Each screen opens with a topbar line: the wordmark or a ghost Back button on the left, actions on the right.

- **Library:** an auto-fill grid of square covers, `minmax(clamp(11rem, 15vw, 15rem), 1fr)`, gap clamp(1rem, 1.6vw, 1.8rem). Title (two lines max), artist, length and status sit under each cover; the "Add your music" tile is always last.
- **Song:** two columns, cover and Listen on the left (`minmax(15rem, 0.8fr)`, sticky), decisions on the right (`minmax(0, 1.4fr)`): title block, four part risers in a row, four difficulty risers stacked, then the big Play and the quiet ghost actions.
- **Settings:** tabs in one row with the controller's shoulder-button glyphs either side; each setting is a three-column grid (11rem label, control, 5rem value).
- **Results, Pause, Calibration:** centred single column (results up to 52rem; pause card 22rem).

Responsive: at 900px the song page collapses to one column with a 9rem cover beside the Listen controls, difficulty risers stack name over lane count, and result stats go to two columns. At 600px settings become one column and part risers go two by two. Spacing steps are 0.4, 0.6, 1, 1.4 and 1.8rem; slabs in a group sit 0.5 to 0.8rem apart.

Controller hints (Select, Back with the platform's own button glyphs) sit fixed at the bottom left whenever the last input was a controller, and never during play.

### HUD
The HUD is sized in px (with vw clamps) because it sits over the highway's own geometry, not over the rem-scaled menu. Song title and a thin skewed magenta progress bar sit top centre; score and stars bottom left at 4% inset; multiplier disc, streak and the skewed overdrive meter bottom right; hit feedback pops at 42% height and drifts up; a break countdown ring appears at 34% height during long gaps. Lane key labels sit under the hit pads with a lane-coloured underline (or the controller glyph with no underline). A hold-and-release note ends in a release marker: a lighter tile at the tail's end with an upright, translucent five-sided pointer standing on it (brighter rim, softer core, gently breathing until judged); a release on time bursts white sparks and pops "<grade> RELEASE", a missed one dims the marker.

## Elevation & Depth

Depth comes from light, not from stacked cards. Surfaces are flat dark slabs on a dark ground; what lifts is the thing under the spotlight. Focus raises a control 3px (covers 6px) and lays a cyan glow beneath it; the selection slab sits on a soft dark drop. Cover art carries a long, deep shadow so it reads as a printed sleeve on the stage. Overlays (pause, calibration) dim the stage to 72% and blur it 6px.

### Shadow Vocabulary
- **Spotlight glow** (`box-shadow: 0 10px 24px -8px rgba(51, 231, 255, 0.55), inset 0 0 0 1px var(--cyan)`): under any focused slab. On a magenta button it becomes a magenta glow with a 2px cyan inset ring.
- **Spotlight cone** (`radial-gradient(50% 60% at 50% 0%, rgba(51, 231, 255, 0.44), transparent 75%)`): the light falling on the focused control from above, fading in over 0.3s.
- **Selection drop** (`inset 0 -4px 0 var(--ink), 0 14px 30px -16px rgba(0, 0, 0, 0.8)`): the lit slab's white underline and its shadow.
- **Primary base** (`inset 0 -3px 0 rgba(0, 0, 0, 0.22)`): the darker lip under a magenta button.
- **Sleeve** (`0 16px 30px -18px rgba(0, 0, 0, 0.9)`, song page `0 30px 50px -24px`): cover art.
- **Toast** (`0 16px 30px -14px rgba(0, 0, 0, 0.8)`).
- **Gameplay glow** (`0 0 18px` to `0 0 30px` in the lane or overdrive colour): multiplier ring and overdrive meter only.

### Named Rules
**The Spotlight Rule.** Nothing lifts at rest. A control rises and glows only because it has focus (keyboard, controller) or, for covers, because the pointer is on it.

## Shapes

Squared and leaning. Every control background is a rectangle skewed by `skewX(var(--lean))` with `--lean: -9deg`, drawn on a pseudo-element so the label itself stays upright inside its italic face. The same lean is applied to slider thumbs, checkboxes, difficulty pips, the HUD progress bar, the overdrive meter, the cover sheen, the travelling selection and the launch wipe bands, so every moving or interactive shape tilts the same way as the type.

Corners are 0 on slabs. Small exceptions: tags, pills and the text field (3px), cover art (4px), the calibration dot and the HUD multiplier disc (fully round). Generated covers for songs without art are two flat colour fields split on the 52% diagonal, with the song's initial set huge in the 62% width black italic.

## Components

### Buttons
Stage-built and confident: a skewed slab under an upright uppercase italic label with a 2.25-stroke icon.
- **Shape:** squared slab, skewed -9deg, 1px slab edge; heights 2.4rem (small), 2.75rem (default), 3.6rem (big).
- **Primary:** magenta slab, no edge, darker 3px lip underneath; hover goes to Pink Light. One per screen.
- **Default:** slab fill; hover raises to Raised Slab.
- **Ghost:** no slab at rest, Ink 2 label; hover shows a 6% white wash. Used for Back and the quiet song actions (Re-analyze, Debug chart, Remove).
- **Live:** a preview button that is playing turns magenta and swaps its play icon for stop.
- **Danger:** red slab, only after a first Remove press, paired with a ghost "Keep".
- **Focus:** lifts 3px, cyan edge and inset ring, cyan glow and spotlight cone. **Active:** drops 1px and scales to 0.98.
- **Disabled:** muted slab (55% opacity fill, 12% edge), Ink 3 label, no lift; a disabled primary keeps a dark wine fill (#4a2347).

### Risers (part and difficulty choice)
The signature choice control. Part risers are a row of four tall slabs, icon over name. Difficulty risers are wide slabs: four skewed pips lit in the difficulty's lane colour, the name, lane and note count, and the best stars and score (or "Not played") at the right. The group is a radio group with one travelling selection.

### Travelling selection
A single lit slab per group (Lit Slab fill, 28% white edge, 4px Ink underline) that slides to the chosen item over 0.42s on the shared ease-out, resizing as it goes. The chosen item drops its own slab so only the travelling one shows. Used by part risers, difficulty risers and settings tabs. Segment buttons (glyph style, rumble strength) show the same lit fill and underline statically.

### Tabs
Uppercase condensed slabs in a row; unselected labels are Ink 2, the selected one is Ink on the travelling lit slab. The controller's shoulder-button glyphs flank the row. Switching plays a swish and pulses the controller on the side it moved toward.

### Song cards
A square cover in a 4px frame with the title, artist and length beneath, entering in a 40ms stagger (rise and scale from 0.96). Hover lifts 4px; focus lifts 6px with a 3px cyan outline 4px off the cover and the spotlight cone above. A white sheen band sweeps across the cover on hover or focus. Analysis shows as a thin lit Ink bar under the card, not a pill; only problems ("Not analyzed", "Analysis failed") get a pill. The add tile is a dashed-outline square with a plus.

### Inputs
- **Sliders:** 6px flat track, magenta fill to the value, a 14 by 22px skewed Ink thumb; focus is a 2px cyan outline 6px off.
- **Checkboxes:** a skewed 1.25rem square slab; checked fills Ink with a dark tick; focus is a cyan outline.
- **Text field:** slab fill, slab edge, 3px corners, cyan caret, 2px cyan outline on focus.
- **Keycaps:** slab with a 4px underline in the bound lane's colour; while listening for a key it pulses magenta.

### Pills and tags
Small uppercase condensed labels at 1rem with 3px corners: neutral (ink wash), ready (green wash), error (red wash). Results tags are solid: magenta "New best", gold "Full combo" with dark text.

### Toasts
Raised Slab cards at bottom right, 3px magenta left edge, rising in over 0.35s, dismissed on press or after 6s. Each one plays the error sound and an error pulse.

### Overlays
Pause and Calibration dim the play screen (72% with 6px blur) and present a left-aligned stack of full-width buttons under a huge italic title; Resume is the magenta one and has initial focus.

### Results reveal
Title and part/difficulty, then five stars that spin and scale in one by one (140ms apart), each ringing a bell a major third higher; the score counts up with ticking clicks; tags fade in at 1.2s; the eight stats rise in from 0.85s, 45ms apart. Continue is magenta and has focus.

### HUD
Quiet chrome around the highway: condensed italic tabular numerals with dark text shadows, stars that light gold as earned, a multiplier disc whose ring takes the lane colour of its level, a skewed overdrive meter in Overdrive Ice that pulses when ready, hit feedback words tinted per judgement (perfect warm white, great pale cyan, good lavender, miss pink-red), and a break ring that drains with a big number counting bars down, bouncing on each bar and turning gold on the last.

### Motion
- **Ease:** `cubic-bezier(0.16, 1, 0.3, 1)` (--ease-out) for almost everything.
- **Screen direction:** going deeper (setlist to song to results) enters from the right (4rem, 4px blur); going back enters from the left; first entry rises 1.2rem with 6px blur; 0.5s. The background stays put.
- **Song page entrance:** cover slides in from the left with a slight tilt (0.7s), title clears from a blur (0.6s), then risers step up one by one (40ms apart) and the actions last at 0.48s.
- **Launch wipe:** pressing Play sweeps three skewed full-screen bands (magenta, lit slab, ground) across in 0.55s, staggered 60ms, holds at least 620ms while the song loads, then sweeps out to the right in 0.5s on a fast-in curve. It plays with the "launch" sound (one bright slam, then the crowd) and a long sweep pulse.
- **Reduced motion:** every entrance, stagger, sheen, bounce and travel is removed; state changes stay. The launch wipe becomes a plain fade of the ground band. The results score appears at its final value.

### Sound and rumble
The menus have a cinematic theme: a 96-second loop in B minor at 100 BPM. It comes in from nothing, with no opening hit: the first time, two bars rise out of silence before the tune starts (a separate file, played once, that hands over to the loop). Big drums and low strings drive straight eighth notes, snares and short, high violins run in sixteenths over them, and above that the harmony and the melody move slowly in long held notes: the energy is in the rhythm, and the tune never hurries. The five eight-bar sections differ in how many players are in (horns as the orchestra arrives, then violins, a second theme with trumpets, an interlude that builds back, everyone), and the last bar ebbs so the loop returns to the quiet opening. It plays behind every menu at its own volume and fades out for a song preview, the calibration clicks, the launch and the song. After a short interruption it fades back in where it left off; after a song it starts again from the top. The menu backdrop moves with it.

Every interface sound is a short recording of the same orchestra in the theme's key (B minor / D major), so a press never clashes with the music underneath. The sounds have their own volume, separate from the music and the songs. Pulses play only on the controller in use, scaled by the player's rumble setting; a keyboard or mouse player feels nothing.
- **Move** (focus change or pointer entering a control): one soft damped harp note, in three takes that rotate; light centred pulse (22ms). Rate-limited so held directions do not pile up.
- **Select:** two harp notes rising a fifth with a glockenspiel on top and a plucked cello under them; medium pulse (45ms).
- **Back** (Back buttons, Escape, Cancel): the same fifth falling, darker; pulse leaning left.
- **Tab:** four harp strings brushed upwards; pulse on the side moved toward.
- **Toggle on / off:** two glockenspiel notes up or down, with the select or back pulse.
- **Launch** (Play, Play again): a confirm, not a fanfare. One tight, bright slam the instant the button goes down (damped bass drum, a giant drum, a whip crack, an anvil and choked cymbals, brass and strings on a short open fifth), a run of bells out of it, and the crowd answering and settling within about four seconds; full-strength sweep (480ms).
- **Results:** the crowd answers first, with a cheer for three stars or more and applause otherwise. Each star rings a step higher up the D major chord (glockenspiel, harp, triangle; the fifth adds a bell tree), a wood tick counts the score, and a new best gets a brass fanfare.
- **Add / pause / resume / error:** a harp run up the chord with bells on import, two plucked steps down onto a soft drum on pause and back up on resume, two dull low knocks a tritone apart with a thud pulse for errors.
During a song only the pause menu makes menu sounds.

The theme and the sounds are rendered by `tools/audio` (see the README); new sounds belong there, levelled against the others, and not as synthesized tones in the app.

## Do's and Don'ts

### Do:
- **Do** draw every control background as a squared slab skewed by `var(--lean)` (-9deg), with the label upright inside.
- **Do** keep exactly three light roles: magenta for the forward or music-starting action, cyan for focus, a lit slab with a white 4px underline for selection.
- **Do** show focus with the spotlight: 3px lift, cyan edge and ring, cyan glow, and the radial cone from above, for keyboard and controller focus alike.
- **Do** move selection with one travelling lit slab per group (0.42s, --ease-out) rather than toggling each item's fill.
- **Do** use lane colours only to mean lane, difficulty or multiplier level.
- **Do** size menu type in rem off the clamped root, and keep labels, hints, pills and small buttons at 1rem or larger.
- **Do** set names, controls and numbers condensed, black, italic and uppercase; set sentences at normal width, upright.
- **Do** give every new control a sound through the shared interface sound handler (`data-sfx` for back, tab, launch or none) and its matching controller pulse.
- **Do** guard every new entrance, stagger or travel with `prefers-reduced-motion: reduce`, keeping the state change.
- **Do** keep the HUD in px over the highway geometry and keep it still except for gameplay feedback.

### Don't:
- **Don't** use cyan for anything in the menus except focus: no cyan fills, edges, badges, status or decoration.
- **Don't** put more than one magenta button on a screen at rest, and don't mark a selected item in magenta.
- **Don't** round slabs or use pill-shaped buttons; only tags, pills, the text field (3px), covers (4px) and the HUD disc have corners.
- **Don't** use a lane colour as a brand accent or a decorative stripe.
- **Don't** set sentences in the condensed italic stage voice, or controls in the upright reading voice.
- **Don't** animate anything in the HUD for decoration, or let menu motion run during play.
- **Don't** depend on the product name; the wordmark is a working title.
- **Don't** name, imitate or recreate any existing commercial rhythm game in look, copy, assets or layout.
