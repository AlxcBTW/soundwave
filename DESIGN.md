---
name: Festival (working title)
description: A rhythm game that charts your own music; its menus are the night sky over an open-air stage.
colors:
  night: "#0e0828"
  deep: "#1a0f4c"
  panel: "rgb(34 20 106 / 0.9)"
  panel-solid: "#22146a"
  raised: "rgb(54 34 152 / 0.92)"
  row: "rgb(66 44 176 / 0.5)"
  row-hi: "rgb(88 62 214 / 0.72)"
  well: "rgb(12 7 40 / 0.62)"
  line: "rgb(196 180 255 / 0.2)"
  violet: "#5b3ee0"
  ink: "#f6f3ff"
  ink-2: "#d2c9fa"
  ink-3: "#aba1e6"
  pink: "#ff4d9d"
  pink-2: "#ff7ab8"
  pink-ink: "#2c0421"
  mint: "#5df2d6"
  lit: "#efeaff"
  lit-ink: "#1d1263"
  gold: "#ffd23d"
  danger: "#ff5a72"
  ok: "#62e89a"
  lane-0: "#3ddc5a"
  lane-1: "#ff3b4e"
  lane-2: "#ffd23d"
  lane-3: "#3a8bff"
  lane-4: "#ff8a1f"
  overdrive: "#bfe6ff"
typography:
  display:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "clamp(1.7rem, 3.4vw, 3rem)"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 112"
  page-title:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "clamp(1.6rem, 2.9vw, 2.7rem)"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 112"
  wordmark:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "clamp(1.6rem, 2.6vw, 2.5rem)"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 112"
  tile-title:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "clamp(1.15rem, 1.7vw, 1.6rem)"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 112"
  panel-title:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 112"
  score:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "clamp(3rem, 7.4vw, 5.6rem)"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontFeature: "'tnum'"
    fontVariation: "'wdth' 112"
  stat:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "1.6rem"
    fontWeight: 900
    lineHeight: 1
    fontFeature: "'tnum'"
    fontVariation: "'wdth' 112"
  control:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 850
    letterSpacing: "0.01em"
    fontVariation: "'wdth' 100"
  label:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 800
    letterSpacing: "0.07em"
    fontVariation: "'wdth' 100"
  item-title:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 800
    lineHeight: 1.2
    fontVariation: "'wdth' 100"
  body:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.35
    fontVariation: "'wdth' 100"
  pill:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 800
    letterSpacing: "0.04em"
    fontVariation: "'wdth' 100"
  caption:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 800
    letterSpacing: "0.05em"
    fontVariation: "'wdth' 100"
rounded:
  s: "0.45rem"
  m: "0.75rem"
  l: "1.1rem"
  well: "1.05rem"
  hud: "12px"
  round: "50%"
spacing:
  list-gap: "0.4rem"
  control-gap: "0.6rem"
  panel-pad: "0.9rem"
  panel-pad-lg: "1.1rem"
  column-gap: "clamp(0.9rem, 2vw, 2rem)"
  gutter: "clamp(0.9rem, 3.2vw, 3.5rem)"
  target: "2.75rem"
  target-touch: "3rem"
  bar: "4.1rem"
  bar-touch: "4.5rem"
components:
  button:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.m}"
    padding: "0.4rem 1.15rem"
    height: "{spacing.target}"
  button-hover:
    backgroundColor: "#4a31c4"
    textColor: "{colors.ink}"
  button-disabled:
    backgroundColor: "rgb(54 34 152 / 0.4)"
    textColor: "rgb(171 161 230 / 0.75)"
  button-primary:
    backgroundColor: "{colors.pink}"
    textColor: "{colors.pink-ink}"
    typography: "{typography.control}"
    rounded: "{rounded.m}"
    padding: "0.4rem 1.6rem"
    height: "{spacing.target}"
  button-primary-hover:
    backgroundColor: "{colors.pink-2}"
    textColor: "{colors.pink-ink}"
  button-primary-disabled:
    backgroundColor: "#5a2a5c"
    textColor: "#d3a9c6"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.m}"
    padding: "0.4rem 1.15rem"
  button-quiet-hover:
    backgroundColor: "rgb(255 255 255 / 0.1)"
    textColor: "{colors.ink}"
  button-small:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.m}"
    padding: "0.3rem 0.95rem"
    height: "2.4rem"
  button-live:
    backgroundColor: "{colors.pink}"
    textColor: "{colors.pink-ink}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#2a0410"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.round}"
    size: "{spacing.target}"
  icon-button-hover:
    backgroundColor: "rgb(255 255 255 / 0.12)"
    textColor: "{colors.ink}"
  hold-button:
    backgroundColor: "{colors.pink}"
    textColor: "{colors.pink-ink}"
    rounded: "{rounded.m}"
    height: "4.6rem"
  hold-button-fill:
    backgroundColor: "#ffc4e0"
  keycap-hint:
    backgroundColor: "{colors.lit}"
    textColor: "{colors.lit-ink}"
    rounded: "0.35em"
    padding: "0 0.4em"
    height: "1.6em"
  keycap-hint-on-primary:
    backgroundColor: "{colors.pink-ink}"
    textColor: "#ffd3e8"
  selection:
    backgroundColor: "{colors.lit}"
    textColor: "{colors.lit-ink}"
    rounded: "{rounded.m}"
  choice-well:
    backgroundColor: "{colors.well}"
    rounded: "{rounded.well}"
    padding: "0.3rem"
  choice:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.m}"
    padding: "0.4rem 0.3rem"
    height: "{spacing.target}"
  choice-part:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.m}"
    height: "4.8rem"
  choice-difficulty:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.m}"
    height: "3.6rem"
  choice-selected:
    backgroundColor: "{colors.lit}"
    textColor: "{colors.lit-ink}"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.control}"
    rounded: "{rounded.m}"
    padding: "0 0.85rem"
    height: "{spacing.target}"
  tab-selected:
    backgroundColor: "{colors.lit}"
    textColor: "{colors.lit-ink}"
  tile:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.l}"
  tile-focus:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.l}"
    padding: "{spacing.panel-pad}"
  dialog:
    backgroundColor: "{colors.panel-solid}"
    textColor: "{colors.ink}"
    rounded: "{rounded.l}"
  song-row:
    backgroundColor: "{colors.row}"
    textColor: "{colors.ink}"
    typography: "{typography.item-title}"
    rounded: "{rounded.m}"
    padding: "0.45rem calc(2.75rem + 0.35rem) 0.45rem 0.45rem"
    height: "4rem"
  song-row-focus:
    backgroundColor: "{colors.row-hi}"
    textColor: "{colors.ink}"
  song-row-picked:
    backgroundColor: "rgb(96 70 226 / 0.78)"
    textColor: "{colors.ink}"
  slot:
    backgroundColor: "{colors.row}"
    textColor: "{colors.ink}"
    rounded: "{rounded.m}"
    padding: "0.35rem 0.7rem 0.35rem 0.5rem"
    height: "3.5rem"
  slot-empty:
    backgroundColor: "transparent"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.m}"
  slot-badge:
    backgroundColor: "{colors.lit}"
    textColor: "{colors.lit-ink}"
    rounded: "{rounded.round}"
    size: "2rem"
  search-field:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ink}"
    rounded: "{rounded.m}"
    padding: "0 0.5rem 0 0.9rem"
    height: "{spacing.target}"
  text-input:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ink}"
    rounded: "{rounded.s}"
    padding: "0.4rem 0.7rem"
    height: "2.5rem"
  setting-row-active:
    backgroundColor: "{colors.row}"
    textColor: "{colors.ink}"
    rounded: "{rounded.m}"
    padding: "0.35rem 0.5rem 0.35rem 0.9rem"
    height: "3.5rem"
  setting-row-focus:
    backgroundColor: "{colors.row-hi}"
    textColor: "{colors.ink}"
  value-bar:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ink}"
    rounded: "{rounded.s}"
    height: "2.3rem"
  value-bar-fill:
    backgroundColor: "{colors.violet}"
  stepper:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.round}"
    size: "2.4rem"
  option:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.s}"
    padding: "0.55rem 0.9rem"
  option-selected:
    backgroundColor: "{colors.lit}"
    textColor: "{colors.lit-ink}"
  keycap:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.s}"
    padding: "0 0.8rem"
    height: "{spacing.target}"
    width: "3rem"
  keycap-listening:
    backgroundColor: "{colors.pink}"
    textColor: "{colors.pink-ink}"
  pill:
    backgroundColor: "rgb(210 201 250 / 0.16)"
    textColor: "{colors.ink-2}"
    typography: "{typography.pill}"
    rounded: "{rounded.s}"
    padding: "0.2rem 0.6rem"
  pill-ready:
    backgroundColor: "rgb(98 232 154 / 0.18)"
    textColor: "#a4f7c4"
  pill-error:
    backgroundColor: "rgb(255 90 114 / 0.2)"
    textColor: "#ffb1bd"
  tag-new-best:
    backgroundColor: "{colors.pink}"
    textColor: "{colors.pink-ink}"
    rounded: "{rounded.s}"
    padding: "0.2rem 0.6rem"
  tag-full-combo:
    backgroundColor: "{colors.gold}"
    textColor: "#2a1d00"
    rounded: "{rounded.s}"
    padding: "0.2rem 0.6rem"
  stat-cell:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ink}"
    typography: "{typography.stat}"
    rounded: "{rounded.m}"
    padding: "0.7rem 0.8rem"
  cover:
    backgroundColor: "{colors.deep}"
    rounded: "{rounded.s}"
  toast:
    backgroundColor: "#4a1a52"
    textColor: "{colors.ink}"
    rounded: "{rounded.m}"
    padding: "0.8rem 1rem"
  hud-panel:
    backgroundColor: "rgb(16 9 50 / 0.76)"
    textColor: "{colors.ink}"
    rounded: "{rounded.hud}"
    padding: "clamp(6px, 0.6vw, 12px) clamp(12px, 1vw, 20px)"
  hud-dial:
    backgroundColor: "rgb(16 9 50 / 0.76)"
    textColor: "{colors.ink}"
    rounded: "{rounded.round}"
    size: "clamp(62px, 5.4vw, 104px)"
  hud-star:
    backgroundColor: "rgb(16 9 50 / 0.76)"
    rounded: "{rounded.round}"
    size: "clamp(34px, 3vw, 58px)"
  hud-lane-key:
    backgroundColor: "rgb(0 0 0 / 0.62)"
    textColor: "{colors.ink}"
    rounded: "5px"
    padding: "0 0.45em"
    height: "1.75em"
---

# Design System: Festival (working title)

## Overview

**Creative North Star: "The Night Sky Over the Stage"**

The menus are the night sky over an open-air stage. The live 3D stage idles behind every screen, a veil of deep indigo and violet lies over it with a faint band of aurora light across the top, and the interface floats in front as rounded violet sheets. One aurora-mint ring is the player's place on the screen: it travels from control to control as they move with the keyboard or a controller, taking each control's size and corner radius as it lands. What the player has chosen is a pale lavender sheet with dark ink on it, and when the choice changes that sheet slides to the new item. Hot pink is the single step forward on a screen. Gold is only ever something the player earned. The player's own cover art carries most of the colour; the panels stay violet so the covers and the one pink action read first.

The type does the shouting. Archivo is set wide, black, leaning and uppercase for titles, tile names and numbers; at normal width, leaning and uppercase for control labels; and at normal width and upright for everything a player reads as a sentence. Everything is rounded: three radii for sheets and controls, full circles for icon buttons, badges and the HUD's dials. Sizes are in rem off a root that grows with the window and is multiplied by the player's own interface-size setting, so the same layout reads on a phone, at a desk and from across a room.

The interface is built for four inputs and shows the one in use. The root element carries `data-input` (mouse, keyboard, pad or touch), set from the last input the player used, and the interface changes variant with it: keycaps or controller symbols as hints, hover or the travelling ring, larger targets under a finger. During play the menu world steps back: the HUD is quiet chrome around the highway, and nothing in it moves for decoration.

**Key Characteristics:**
- Layered violet night: indigo ground, a violet glow rising from below, the live stage behind a veil, an aurora band across the top.
- Rounded violet sheets (0.45, 0.75 and 1.1rem radii) with no borders and no shadow at rest.
- Four light roles that never trade places: pink acts, mint is the focus ring, lavender with dark ink is the selection, gold is earned.
- One focus ring and one selection sheet per group, and both travel instead of blinking.
- Lane colours are data (lane, difficulty, multiplier level, key binding), not decoration.
- One family, three registers: wide black italic uppercase, normal-width italic uppercase for controls, normal-width upright for reading.
- Variants by last input: hints, hover, focus ring, target size and play layout all follow `data-input`.
- Every interaction has a sound; on a controller it also has a pulse. `data-motion='reduced'` keeps state changes and drops travel.

## Colors

A violet night with four lights that have fixed jobs, and five lane colours that carry game data.

### Primary
- **Hot Pink** (pink): the one forward action on a screen or dialog: Ready up in the library's action bar, the hold-to-start button, Add to setlist in the song sheet, Resume on pause, Next song and Done on results. Also anything that is sounding or listening right now: a preview button while it plays, a key binding while it waits for a press, the calibration dot on the beat. And progress through audio: the seek fill and the HUD's song progress bar. It glows behind the wordmark and the countdown numbers, fills the "New best" tag and is the first sheet of the launch wipe. Text on pink is **Pink Ink** (pink-ink), never white.
- **Pink Light** (pink-2): the hover state of a pink button, the set position in the HUD title ("2/4"), the toast icon and the dashed outline of the file-drop target.

### Secondary
- **Aurora Mint** (mint): focus. It is the 3px ring that travels between controls for keyboard and controller players, with a soft mint glow beneath it, and the text caret in the search and text fields. As atmosphere it appears once, faintly (20% alpha), as the aurora band in the sky behind the panels. The HUD has no focus, so it borrows mint for one job: the break-countdown ring, which turns gold on the final bar.

### Tertiary
- **Lavender Light** (lit) with **Lavender Ink** (lit-ink): the selection. The sheet that slides behind the chosen part, difficulty or settings tab; the chosen option in the settings detail pane; the numbered badge on a song that is in the setlist. The same pair makes the keycap hints, so a key reads as a printed cap.
- **Encore Gold** (gold): earned results. Lit stars everywhere, the ring that fills toward the next star in the HUD, the "Full combo" tag, the full-combo tick and underline in best-score tables, the star total on the set summary, the final-bar break ring.
- **Warning Red** (danger): destructive confirmation only (the "Delete song and scores" button after Remove is pressed). Error text uses a softened pink-red (#ffa3b4) and warnings a soft amber (#ffc98a) so sentences stay readable.
- **Ready Green** (ok): the "Connected" status pill, as an 18% wash with pale green text.

### Neutral
- **Night** (night): the page ground behind everything, and the last sheet of the launch wipe.
- **Deep Night** (deep): the backing of covers and cover mosaics while art loads.
- **Panel Violet** (panel): every resting sheet: set tiles, the song card, the setlist, set cards, the ready panel, result panels, the settings detail card. 90% opaque, so the stage is just felt behind it.
- **Solid Panel** (panel-solid): dialogs and sheets that sit over a blurred screen.
- **Raised Violet** (raised): the resting fill of buttons and key-binding caps, and a set tile under focus or the pointer. Under the pointer a button goes one step brighter (#4a31c4).
- **Row** (row) and **Lit Row** (row-hi): list rows at rest and under focus or the pointer: songs, setlist slots, the highlighted settings row. A song that is in the setlist sits between the two (rgb(96 70 226 / 0.78)).
- **Well** (well): recessed places: the search and text fields, the troughs that hold part, difficulty and tab choices, the value bar track, result stat cells, empty best-score cells.
- **Hairline** (line): the only stroke. 1px dividers inside a panel and 2px dashed outlines for empty slots and "add" targets.
- **Signal Violet** (violet): the fill of a settings value bar, and the middle sheet of the launch wipe.
- **Ink** (ink): primary text, slider thumbs, lit tick marks, analysis progress fill.
- **Ink 2** (ink-2): secondary text: artists, captions, unselected choices and tabs, section labels, quiet buttons.
- **Ink 3** (ink-3): tertiary text: slot numbers, counts, stat captions, placeholders.

### Lane colours (data)
- **Lane 0 Green, Lane 1 Red, Lane 2 Yellow, Lane 3 Blue, Lane 4 Orange** (lane-0 to lane-4): the five note lanes left to right: tiles, strike targets, and the light a lane gives off along its length when it is played. They also colour the 3 to 4px underline on a bound key (settings caps, the lane keys on Ready up and under the highway), difficulty pips (Easy green, Medium yellow, Hard orange, Expert red) and multiplier levels on the HUD dial (x2 blue, x3 green, x4 orange). Lane 2 Yellow and Encore Gold are the same value; context tells them apart.
- **Overdrive Ice** (overdrive): the overdrive meter, its ready pulse, the x6 and x8 dial ring and the "Overdrive ready" call-out.

### Named Rules
**The One Ring Rule.** Mint is focus. In a menu it never fills a control, marks a choice, labels a status or decorates; it is the travelling ring, the caret, and the one faint aurora band in the sky.

**The One Pink Rule.** A screen or dialog has at most one pink button at rest, and it is the step forward. Everything else is violet or quiet. A selected item is never pink.

**The Lavender Rule.** A choice is shown by a pale lavender sheet with dark ink, never by pink, mint or an outline. Focus and selection on the same item show both: the lavender sheet with the mint ring around it.

**The Lanes Are Data Rule.** A lane colour always means a lane, a difficulty level or a multiplier level. Never use one as a brand accent or a decorative stripe.

## Typography

**Display Font:** Archivo Variable (with Archivo, system-ui, sans-serif), self-hosted with its width axis, upright and italic.
**Body Font:** the same family at normal width.

**Character:** one family, three registers. The stage voice (112% width, weight 900, italic, uppercase, -0.01em tracking, line-height 1) is for titles, tile names and numbers. Control labels (normal width, weight 850, italic, uppercase) are for buttons, tabs and option names. The reading voice (normal width, upright, weight 500 to 800, mixed case) is for song names, artists, setting names, help text and errors.

### Hierarchy
- **Display** (900, clamp(1.7rem, 3.4vw, 3rem), 112% width, balanced wrap): "Set complete", "Paused" (clamp(2.2rem, 5vw, 3rem)), "Calibrate", the song title on results (clamp(1.4rem, 2.6vw, 2.4rem)) and in the song sheet (clamp(1.4rem, 2.2vw, 2.1rem)).
- **Page title** (900, clamp(1.6rem, 2.9vw, 2.7rem)): one per screen: "Pick a set", "Music library", "Ready up", "Settings".
- **Wordmark** (900, clamp(1.6rem, 2.6vw, 2.5rem), pink glow behind): the product name on Home only. The name is a working title; nothing depends on it.
- **Tile and panel titles** (900; tiles clamp(1.15rem, 1.7vw, 1.6rem), panels 1.25rem, settings section headings 1.15rem, the highlighted song 1.2rem).
- **Score** (900, clamp(3rem, 7.4vw, 5.6rem), tabular, not uppercased): the results score and the set total, which count up. Stat values are 1.6rem; the hold button's label is 1.3rem.
- **Control label** (850, 1rem, 0.01em tracking, italic, uppercase, normal width): every button, action, tab and option name.
- **Label** (800, 0.95rem, 0.07em tracking, uppercase, upright, Ink 2): names a group of controls inside a panel: Part, Difficulty, Listen, Best scores, Next up.
- **Item title** (800, 1.05rem, line-height 1.2, one line with ellipsis): song names in rows, slots and set cards. Setting names are 1.05rem/700.
- **Body** (500, 1rem, line-height 1.35; help and errors line-height 1.45, max 62ch): artists (0.95rem), help text, hints, errors.
- **Pill and caption** (800, uppercase; pills and tags 0.85rem with 0.04em tracking, stat captions and table heads 0.82rem with 0.05em): status and stat names. These are the smallest text in the interface.

Numbers that change (scores, times, counts, setting values) use tabular figures.

### Named Rules
**The Three Registers Rule.** A title or a number is wide, black, italic and uppercase. A control label is normal width, italic and uppercase. Anything read as a sentence, and every song and artist name, is normal width, upright and in its own case. Never set a sentence in the stage voice.

**The Root Scale Rule.** The root size is `clamp(16px, 0.62vw + 7px, 26px)` multiplied by the player's interface-size setting (`--ui-scale`, 85% to 130%). Every menu size is in rem, so the whole interface grows with the window and with the player's choice. Only the HUD is in px.

## Layout

Each menu screen is a page: a column capped at 104rem, with a horizontal gutter of clamp(0.9rem, 3.2vw, 3.5rem) plus the device's safe areas, a head line (title on the left, a count or status beside it), and a body that scrolls inside itself. The bottom 4.1rem (4.5rem on touch, 3.5rem on short screens) belongs to the action bar.

**Action bar.** What the current screen or dialog can do sits along the bottom edge over a fade to dark: Back on the left, the other actions and the one pink action on the right. Each action shows the hint for the input in use: a keycap for keyboard and mouse, the controller's own symbol for a controller (with a passive "Select" hint beside Back), nothing for touch, where the icon shows instead. A dialog's actions replace its screen's while it is open. There is no bar during a song.

- **Home:** the wordmark, "Pick a set", and a row of set tiles up to 30rem tall. "Your setlist" comes first and is the widest (flex 1.4, up to 40rem); suggested sets follow. Each tile is a mosaic of up to four covers over a title, a caption and a count. An "Add your music" tile with a dashed blank appears while the library is empty.
- **Music library:** a toolbar (search field up to 34rem, Sort, Add songs), then two columns, `minmax(0, 1.55fr) minmax(19rem, 1fr)`. Left: the song list, 4rem rows of cover, title, artist, best stars, length and a slot badge. Right: a card for the highlighted song with its best result per part, and the setlist panel with four numbered slots.
- **Song details:** a sheet at the right edge, up to 36rem wide and full height: cover and title, Add to or Remove from setlist, Listen (song and stems with a seek bar), a best-scores table of parts by difficulties, and quiet management actions under a hairline.
- **Ready up:** two columns, `minmax(0, 1.25fr) minmax(21rem, 1fr)`. Left: the set as numbered cards with note counts and bests. Right: one panel with Part (four choices, icon over name), Difficulty (four choices, pips over name), the lane count with the bound keys, and the hold-to-start button.
- **Settings:** the title with a row of seven icon tabs at the right of the head; only the selected tab shows its name. Body in two columns, `minmax(0, 1.4fr) minmax(18rem, 1fr)`: sections of rows on the left (name, then a control up to 24rem wide), a detail card for the highlighted row on the right.
- **Results:** two panels side by side, capped at 78rem and centred: cover, title, stars, score and tags on the left; a three-column grid of stat cells and "Next up" on the right. **Set summary:** one column up to 56rem: "Set complete", the total score and star count, then the set as cards.
- **Pause, Calibration:** a centred card up to 24rem wide over the dimmed, blurred screen, with full-width buttons stacked under a display title.

Spacing is a small set of steps: 0.4rem between rows in a list, 0.6rem between controls, 0.9 to 1.1rem of padding inside a panel, clamp(0.9rem, 2vw, 2rem) between columns.

**Responsive.** At 900px wide the side panes fold: the library's setlist becomes a dock above the action bar (its name and count, then four square cover slots with their numbers), the highlighted-song card goes away, the settings detail pane goes away and the highlighted row shows its help text in place, and Ready up and Results become one column. At 640px Home's tiles stack as rows (cover left, words right), the toolbar buttons and the bar's secondary actions shrink to icons while the pink action keeps its words and stretches, dialogs become sheets that rise from the foot of the screen, setting rows stack name over control, and the hold button sticks to the foot of the ready panel. Below 560px of height (a phone on its side) the chrome tightens and, when the screen is wider than 640px, Ready up and Results stay side by side.

**Input variants.** Touch raises the target size from 2.75rem to 3rem and brings small buttons, step arrows and the search clear button up to 2.75rem; step arrows and the per-row details button are always visible. Hover styles apply only when `data-input` is mouse. The focus ring shows only for keyboard and controller.

### HUD
The HUD is sized in px (with vw clamps) because it sits over the highway's own geometry, which it reads from `--hw-x`, `--hw-y`, `--hw-w` and `--lane-w`. On a wide screen the strike line sits 77.5% down and spans about 43% of the width. Top centre: position in the set, song and artist over a 4px pink progress bar. Bottom left: five star discs, the next one ringed in gold by progress toward it, over a panel with the part name and the score. Under the strike line, centred on the highway: the overdrive meter, as wide as the lanes, and below it the multiplier dial. Under each lane: its key on a dark chip with a lane-coloured underline, or the controller symbol alone. Hit feedback pops to the left of the strike line. The break countdown ring sits at 34% height. A round pause button sits top right for mouse and touch players.

On touch the lanes themselves are the controls. The deck runs to the foot of the screen (strike line at 99.2%), the strike targets become finger-sized rounded squares outlined in the lane colour, and a tap anywhere along a lane plays it, following the deck's perspective. The chrome moves up and to the sides: score and stars top left, pause and the dial top right, progress as a strip across the very top, feedback in the middle at 25% height, and overdrive as a 68px round button at 42% height on the side the player chose.

## Elevation & Depth

Depth comes from layers of night, not from shadows. From back to front: the indigo ground with a violet glow rising from below, the live stage, a veil that darkens it (thinner on Ready up, Results and the summary so the stage shows more), then the panels. Panels are flat violet sheets with no border and no shadow at rest; they separate from the night by fill alone, and rows and wells separate from panels the same way. (The direction called for a lit top edge on panels; the build does not draw one.) The few shadows mark things that sit above a screen: the focus ring's glow, the selection sheet, dialogs and toasts. Overlays dim the screen to 74% and blur it 8px.

### Shadow Vocabulary
- **Ring glow** (`outline: 3px solid var(--mint); outline-offset: 3px; box-shadow: 0 12px 28px -4px rgb(93 242 214 / 0.42)`): the travelling focus ring.
- **Selection sheet** (`box-shadow: 0 8px 18px -8px rgb(0 0 0 / 0.6)`): under the lavender selection.
- **Dialog** (`box-shadow: 0 30px 60px -20px rgb(0 0 0 / 0.7)`): sheets and cards over the dimmed screen.
- **Toast** (`box-shadow: 0 16px 30px -14px rgb(0 0 0 / 0.8)`).
- **Lane underline** (`box-shadow: inset 0 -3px 0 var(--lane)`, 4px on settings caps): the lane colour of a bound key. The same inset in gold marks a full combo in the best-scores table.
- **Text glow** (wordmark `0 0.08em 0.5em rgb(255 77 157 / 0.55)`, countdown `0 0 40px var(--pink)`): the only glows in the menus.
- **Gameplay glow** (`0 0 14px` to `0 0 26px` in Overdrive Ice; `drop-shadow(0 0 8px)` on the break ring): the overdrive meter when ready or active, and the break ring.

### Named Rules
**The Flat Sheets Rule.** Nothing has a shadow at rest. A panel is a fill; a row is a lighter fill; a well is a darker one. Shadow is reserved for the ring, the selection, and things that float over a screen.

**The Lit State Rule.** Focus is the ring plus the control's own lit state: a row brightens to Lit Row, a set tile rises 0.4rem and brightens to Raised Violet. Under the mouse the control shows the same lit state without the ring.

## Shapes

Rounded and upright. Three radii do almost everything: 0.45rem for covers, pills, tags, caps, fields and option rows; 0.75rem for buttons, rows, slots, choices, tabs and stat cells; 1.1rem for panels, tiles, dialogs and set cards. A trough that holds choices is 0.3rem rounder than what it holds (1.05rem), so the selection sheet nests inside it. Icon buttons, step arrows, slot badges, pips, slider thumbs, the calibration pad and the HUD's star discs, dial, pause and touch overdrive buttons are full circles. A dialog sheet rounds only the corners that face the screen.

There are no borders on filled shapes. The only strokes are 1px hairline dividers and the 2px dashed outline that means "empty, something goes here" (empty slots, the add row, the add tile, the drop target). Icons are line icons at one stroke weight (2.25).

Cover mosaics tile up to four covers into one square (one fills it, two split it, three give the first a full column). A song without art gets a generated cover: two flat colour fields split on the 52% diagonal, with the song's initial set huge in the stage voice.

The lean of the italic type is the only slant; shapes themselves are never skewed.

## Components

### Buttons
Rounded violet blocks under a leaning uppercase label, with a line icon or an input hint in front.
- **Shape:** 0.75rem radius, at least 2.75rem tall (3rem on touch), padding 0.4rem 1.15rem. Small is 2.4rem (2.75rem on touch). Wide fills its row and aligns left.
- **Default:** Raised Violet with Ink.
- **Primary:** Hot Pink with Pink Ink; one per screen or dialog.
- **Quiet:** no fill, Ink 2 label; used for management actions in the song sheet.
- **Live:** a preview button that is playing turns pink and swaps its play icon for stop.
- **Danger:** Warning Red with dark text, only after a first Remove press, beside a quiet "Keep".
- **Hover (mouse only):** one step brighter (#4a31c4; Pink Light on primary; a 10% white wash on quiet).
- **Pressed:** scales to 0.96.
- **Disabled:** 40% Raised Violet with dimmed Ink 3; a disabled primary is a dull plum (#5a2a5c).
- **Icon buttons:** round, 2.75rem, Ink 2, no fill at rest; a 12% white wash under the mouse; scale to 0.9 when pressed.

### Hints
A hint says how to reach a control from the input in use. Keyboard and mouse: a small Lavender keycap (0.8rem, weight 800, upright, 0.35em radius); on a pink button the cap is Pink Ink with pale pink text. Controller: the controller's own button symbol in the chosen style. Touch: none. In the action bar a hint replaces the action's icon.

### Focus ring
One element for the whole interface. Each frame it reads the focused control's box and corner radius and moves to it: a 3px mint outline 3px off the control with a mint glow beneath. Between controls it glides in 200ms; arriving from nowhere or onto a new screen it fades in on the spot (0.16s). It shows only when the last input was the keyboard or a controller. The focused control also carries `.is-focus` for its own lit state. A control can opt out with `data-ring="none"` (the dialog container, the calibration pad).

### Travelling selection
One Lavender sheet per group (0.75rem radius, soft drop) that slides to the chosen item over 0.36s, resizing as it goes; the first placement appears in place. The chosen item's label turns Lavender Ink. Used by the part choices, the difficulty choices and the settings tabs, each inside a Well trough with 0.3rem of padding. The settings detail pane shows its chosen option with the same fill, placed statically.

### Choices (part and difficulty)
Radio groups in a trough of four equal columns. Part: icon over name, 4.8rem tall, the icon growing to 1.12 when chosen, with a 1 to 4 keycap in the corner for keyboard and mouse. Difficulty: four round pips lit to the level in its lane colour over the name, 3.6rem tall; Q and E or the shoulder buttons step through it, hinted beside the label. Unchosen labels are Ink 2.

### Hold to start
The pink button that starts a set asks to be held: a paler pink (#ffc4e0) fills it from the left over 650ms while a pointer, Enter, Space or the controller's confirm button is down, and it fires when full; letting go early drains it. It carries the part and difficulty as its label (1.3rem stage voice) and one line beneath that says what to do or why it cannot start. Activated without a press (assistive technology) it fires at once. If nothing starts, it empties after 2.6s and can be held again. On phones it sticks to the foot of the ready panel.

### Set tiles
Panel Violet sheets with a 1.1rem radius: a cover mosaic filling the top, then title, caption and count. They rise in one after another (55ms apart). Under focus or the mouse a tile lifts 0.4rem and brightens; pressed it scales to 0.98. On phones tiles are rows and do not lift.

### Song rows and setlist slots
- **Song row:** Row fill, 0.75rem radius, 4rem tall: a 3.1rem cover, title over artist, then best stars or analysis state, length and a 2rem round badge. The badge shows a plus when the song can be added and becomes a Lavender disc with the slot number, popping in, when it is in the set; the row itself brightens. Pressing a ready row adds or removes it; a row that is not ready opens its details. Analysis shows as a 3px Ink bar along the row's foot and a percentage, not a pill; only problems ("Not analyzed", "Analysis failed") get a pill. A round details button sits inside the row at its right end, shown under the mouse and always on touch.
- **Slot:** a numbered row (number, 2.7rem cover, title over artist, a small x) that slides in from the left when filled; pressing it removes the song. Empty slots are dashed outlines reading "Pick a song" or "Empty". In the phone dock a slot is a square cover with its number in the corner.
- **Add row:** a dashed row at the end of the list with a plus on a Raised Violet square.

### Settings rows
Every row is one focus stop: name on the left, control on the right. The highlighted row takes the Row fill (Lit Row under focus) and its name turns Ink.
- **Choice:** round step arrows either side of the value's name, with one tick per option beneath and the current tick lit in Ink. Left and right change the value; pressing the row cycles it. The arrows show only on the highlighted row (always on touch).
- **Value bar:** a Well track at least 2.3rem tall, filled from the left in Signal Violet with the value printed on top; drag it, use the arrows, or press left and right.
- **Bindings:** caps in Raised Violet with a 4px underline in the lane's colour; a cap that is listening turns pink and pulses. Fixed bindings are dimmed.
- **Action and text rows:** a small button, or a Well text field with a mint caret and a status pill beside it.
- **Detail pane (wide screens):** a panel naming the highlighted setting, explaining it, and listing a choice's options (each with its own help) to pick directly, or a slider's value and range. On narrow screens the same help text opens inside the highlighted row.

### Tabs
Seven icon tabs in a Well trough; only the selected tab shows its name, on the travelling Lavender sheet. Q and E on a keyboard or the shoulder buttons on a controller switch tabs, hinted at either end of the row; focus follows onto the new tab's first setting, and the list enters from the side the player moved toward. On phones the row scrolls and keeps the chosen tab in view.

### Fields
- **Search:** a Well field with a search icon, a "/" keycap hint for keyboard and mouse, and a round clear button once there is text; it darkens while focused. Esc clears it first, then leaves it.
- **Seek bar:** a 6px track filled in pink to the position, with a round Ink thumb (1.1rem, 1.5rem on touch); the whole height of the control takes the pointer.

### Pills, tags, stars and pips
Pills and tags are small uppercase labels (0.85rem, 0.45rem radius): a neutral lavender wash, a green wash for ready, a red wash for errors. Results tags are solid: pink "New best", gold "Full combo" with dark text. Stars are five drawn outlines, filled gold when earned. Pips are four 0.6rem dots lit to the difficulty's level in its lane colour.

### Dialogs
A dialog dims and blurs the screen, takes focus and directional navigation, keeps Tab inside, and closes on Esc, the controller's back button, its round close button or a press outside; focus returns where it was. The **sheet** variant sits at the right edge on wide screens and rises from the foot on phones. The **card** variant is centred (pause, calibration). Calibration shows a 9rem round pad with a dot that turns pink on every other click, and a tap count.

### Toasts
Plum cards (#4a1a52, 0.75rem radius) with a Pink Light alert icon, stacked at the bottom right above the action bar (full width on phones), rising in over 0.35s, dismissed on press or after 6s. Each one plays the error sound and an error pulse.

### Results
Two panels. The first holds the cover and title, five stars that spin and scale in one by one (140ms apart), the score counting up, and tags fading in at 1.2s. The second holds up to nine Well stat cells (value over caption, the miss count in soft red) rising in 45ms apart, and the next song under a hairline. The set summary lists every song as a card with its tags, stars and score; a skipped song is dimmed.

### Highway
A solid violet deck in perspective, a shade lighter toward the far end and fading out there, with hairlines between lanes, neighbouring lanes a breath apart in tone, lit violet rails along both edges and a lit lip across the front. Beat lines cross it faintly; bar lines are thicker.
- **Tiles:** rounded pills with a bright rim, a top face in the lane's colour and a short white gloss line. A missed tile dims to 28%.
- **Strike targets:** a thin pill outline per lane in its colour, dark inside. On touch they are finger-sized rounded squares set a little toward the player.
- **Lane light:** a lane that is played, by key, button or touch, lights up along its length in its own colour, brightest at the player's end, and its target glows; a hit adds a flash and a burst of sparks.
- **Holds:** a glowing tail behind the tile, wider while held. A hold-and-release note ends in a release marker: a lighter tile with an upright, translucent five-sided pointer standing on it, gently breathing until judged; a release on time bursts white sparks and pops "<grade> RELEASE", a missed one dims the marker.
- **Overdrive:** phrase notes are ice white; while overdrive lasts every tile turns light blue and glows, the rails turn blue, and a soft glow lies along the outside of both edges.

### HUD
Quiet chrome on translucent indigo (rgb(16 9 50 / 0.76)): stage-voice tabular numerals, star discs that turn violet with a gold star as each is earned, a dial whose ring takes the colour of its multiplier level and fills with the streak toward the next one, and an overdrive meter in Overdrive Ice that glows and pulses when it can be used and is itself the button that starts it. Hit feedback words are tinted per judgement (perfect warm white, great pale cyan, good lavender, miss pink-red, overdrive ice). The break ring drains with a big number counting bars down, bouncing on each bar and turning gold on the last. The countdown before a song is three huge numbers with a pink glow.

### Motion
- **Ease:** `cubic-bezier(0.16, 1, 0.3, 1)` (`--ease`) for entrances and travel; `cubic-bezier(0.7, 0, 0.84, 0)` (`--ease-in`) for leaving.
- **Screen direction:** going deeper (Home, library, Ready up, results, summary) enters from the right (3rem, fading in over 0.45s); going back enters from the left. The stage behind stays put. Settings tabs do the same inside the list (0.35s).
- **Entrances:** tiles, set cards and song rows rise in 0.9rem with a short stagger (55ms, 60ms and 22ms apart); action-bar buttons rise in over 0.3s; a filled slot slides in from the left; a slot badge pops from 0.4 scale; a changed setting value rises in 0.3rem.
- **Dialogs:** the dim fades in over 0.22s; a side sheet slides in 3rem over 0.34s, a phone sheet rises 2.5rem, a card rises and scales from 0.96 over 0.3s; all leave in 0.18s.
- **Press:** everything pressable scales down briefly (buttons 0.96, tiles 0.98, rows 0.99, choices 0.95, icon buttons 0.9, step arrows 0.85).
- **Launch wipe:** starting a song opens three sheets of light (pink, violet, night) as circles from the foot of the screen in 0.55s, 60ms apart; they hold at least 620ms while the song loads, then close upward in 0.5s, in reverse order.
- **Reduced motion:** `data-motion='reduced'` on the root (the player's setting, or the system preference when the setting is left on System) cuts every animation and transition to nothing: screens, sheets, the ring and the selection change in place, tiles do not lift, and scores appear at their final value. Hit feedback and the break ring's draining stay; the ring's bounces go, and the countdown numbers fade without scaling.

### Sound and rumble
The menus have a cinematic theme: a 96-second loop in B minor at 100 BPM. It comes in from nothing, with no opening hit: the first time, two bars rise out of silence before the tune starts (a separate file, played once, that hands over to the loop). Big drums and low strings drive straight eighth notes, snares and short, high violins run in sixteenths over them, and above that the harmony and the melody move slowly in long held notes: the energy is in the rhythm, and the tune never hurries. The five eight-bar sections differ in how many players are in (horns as the orchestra arrives, then violins, a second theme with trumpets, an interlude that builds back, everyone), and the last bar ebbs so the loop returns to the quiet opening. It plays behind every menu at its own volume and fades out for a song preview, the calibration clicks, the launch and the song. After a short interruption it fades back in where it left off; after a song it starts again from the top. The menu backdrop moves with it.

Every interface sound is a short recording of the same orchestra in the theme's key (B minor / D major), so a press never clashes with the music underneath. The sounds have their own volume, separate from the music and the songs. Pulses play only on the controller in use, scaled by the player's rumble setting; a keyboard, mouse or touch player feels nothing.
- **Move** (focus change or pointer entering a control): one soft damped harp note, in three takes that rotate; light centred pulse (22ms). Rate-limited so held directions do not pile up.
- **Select:** two harp notes rising a fifth with a glockenspiel on top and a plucked cello under them; medium pulse (45ms).
- **Back** (Back in the action bar, Esc, the controller's back button, Close, Cancel, Keep, taking a song out of a slot, leaving a set): the same fifth falling, darker; pulse leaning left.
- **Tab** (settings tabs by press, Q and E or the shoulder buttons; stepping the difficulty on Ready up the same way): four harp strings brushed upwards; pulse on the side moved toward.
- **Next / previous choice** (a settings row stepped right or left): two glockenspiel notes up or down.
- **Launch** (the Ready up button filling, Play again and Next song on results, Play the set again on the summary): a confirm, not a fanfare. One tight, bright slam the instant the button goes down (damped bass drum, a giant drum, a whip crack, an anvil and choked cymbals, brass and strings on a short open fifth), a run of bells out of it, and the crowd answering and settling within about four seconds; full-strength sweep (480ms).
- **Results:** the crowd answers first, with a cheer for three stars or more and applause otherwise. Each star rings a step higher up the D major chord (glockenspiel, harp, triangle; the fifth adds a bell tree), a wood tick counts the score, and a new best gets a brass fanfare. The set summary gets the crowd again.
- **Add / pause / resume / error:** a harp run up the chord with bells on import, two plucked steps down onto a soft drum on pause and back up on resume, two dull low knocks a tritone apart with a thud pulse for errors.
During a song only the pause menu makes menu sounds.

Sounds are wired in one place: a shared handler gives every button, tab and row its move and select sound, and a control picks another with `data-sfx` (back, tab, launch, or none when it makes its own). The theme and the sounds are rendered by `tools/audio` (see the README); new sounds belong there, levelled against the others, and not as synthesized tones in the app.

## Do's and Don'ts

### Do:
- **Do** build surfaces as flat rounded violet sheets: Panel Violet at 1.1rem for panels and tiles, Row at 0.75rem for list rows, Well for recessed troughs and fields.
- **Do** keep the four light roles: pink for the one forward action, mint for the focus ring, a lavender sheet with dark ink for the selection, gold for what was earned.
- **Do** let focus be the one travelling ring plus the control's own lit state, and show it only for keyboard and controller players.
- **Do** move selection with one travelling lavender sheet per group (0.36s, `--ease`) rather than toggling each item's fill.
- **Do** use lane colours only to mean lane, difficulty or multiplier level.
- **Do** put a screen's actions in the action bar with a key and, where it makes sense, a controller button, and let the hint follow `data-input`: keycap, controller symbol, or none on touch.
- **Do** gate hover styles behind `data-input='mouse'` and raise targets to at least 2.75rem under `data-input='touch'`.
- **Do** size menus in rem off the clamped root, and the HUD in px over the highway's geometry.
- **Do** set titles and numbers wide, black, italic and uppercase; control labels at normal width, italic and uppercase; sentences and song names at normal width and upright.
- **Do** give every new control a sound through the shared handler (`data-sfx` for back, tab, launch or none) and its matching controller pulse.
- **Do** make every new entrance, stagger or travel respect `data-motion='reduced'`, keeping the state change.
- **Do** keep the HUD still except for gameplay feedback.

### Don't:
- **Don't** use mint for anything in the menus except the focus ring and the caret: no mint fills, borders, badges, status or decoration.
- **Don't** put more than one pink button on a screen or dialog at rest, and don't mark a selected item in pink.
- **Don't** put borders or resting shadows on panels, rows or buttons; the only strokes are hairline dividers and dashed "empty" outlines.
- **Don't** skew or square off shapes; the italic type is the only slant.
- **Don't** use a lane colour as a brand accent or a decorative stripe.
- **Don't** set sentences or song names in the stage voice, or controls in the upright reading voice.
- **Don't** show hover effects, key hints or the focus ring to a touch player.
- **Don't** animate anything in the HUD for decoration, or let menu motion run during play.
- **Don't** depend on the product name; "Festival" is a working title and the wordmark is replaceable.
- **Don't** name, imitate or recreate any existing commercial rhythm game in look, copy, assets or layout.
