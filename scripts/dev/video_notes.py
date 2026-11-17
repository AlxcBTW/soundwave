"""Extracts note tiles from a gameplay recording of a five-lane highway (dev tooling).

    python scripts/dev/video_notes.py <video.mp4> <out.json> [--layout violet]

Needs OpenCV in the ML service venv: pip install opencv-python-headless. Geometry constants below
are measured on one 1080p recording; other recordings need them re-measured.

Samples two rows just above the hit pads, following the highway's perspective. A tile crossing
a row is a short burst of its lane's own colour; hit glows and screen effects last longer or have
the wrong colour. The delay between the two rows gives the scroll speed, which projects each
crossing forward to when the tile reaches the pads (the moment it is meant to be played).

`--layout violet` handles a second recording style: a smaller highway whose tiles all share one
violet colour. Tiles there are found as short bursts against each lane's own recent background
(any colour), keeping a tile's leading edge and dropping its paler lower face.
"""

import json
import sys

import cv2
import numpy as np

# Geometry measured on the 1080p recording: pad centres on the hit line and how far each lane
# leans towards the centre per pixel upwards (perspective).
PAD_Y = 870
PAD_X = [680, 822, 968, 1112, 1256]
LEAN = [-0.299, -0.148, 0.0, 0.148, 0.299]
PAD_SPACING = 144
VANISH_SPACING_Y = 482  # where lane spacing has shrunk to ~86 px
ROWS = (540, 580)  # high enough that hit glows never reach it
HUES = [50, 175, 23, 96, 11]  # OpenCV hue (0-180): green, red, yellow, blue, orange
HUE_TOL = 10  # lanes are separated by position, so the hue test can be loose


def lane_x(lane: int, y: int) -> float:
    return PAD_X[lane] - LEAN[lane] * (PAD_Y - y)


def spacing(y: int) -> float:
    k = (PAD_Y - y) / (PAD_Y - VANISH_SPACING_Y)
    return PAD_SPACING + (86 - PAD_SPACING) * k


def white_scores(hsv: np.ndarray, y: int, y0: int) -> list[float]:
    """Overdrive notes are white. Share of white pixels in each lane, minus the whiteness of the gaps
    beside it, so full-width flashes (which whiten the gaps too) don't count."""
    half = int(spacing(y) * 0.35)
    gap_half = int(spacing(y) * 0.08)
    rows = hsv[y - y0 - 3 : y - y0 + 4].astype(np.int16)

    def white(x0: int, x1: int) -> float:
        roi = rows[:, x0:x1].reshape(-1, 3)
        return float(((roi[:, 1] < 70) & (roi[:, 2] > 190)).mean()) if len(roi) else 0.0

    def bright(x0: int, x1: int) -> float:
        roi = rows[:, x0:x1, 2]
        return float(roi.mean()) if roi.size else 0.0

    out = []
    for lane in range(5):
        x = int(lane_x(lane, y))
        lane_w = white(x - half, x + half)
        gaps = []
        dark = []
        for side in (-1, 1):
            gx = int(x + side * spacing(y) / 2)
            gaps.append(white(gx - gap_half, gx + gap_half))
            dark.append(bright(gx - gap_half, gx + gap_half))
        # A tile is a bright bar with dark highway at both ends; streaks run across lane borders.
        if bright(x - half, x + half) - max(dark) < 70:
            out.append(0.0)
            continue
        out.append(max(0.0, lane_w - max(gaps)))
    # Flashes and streaks whiten the whole highway or several lanes at once; tiles don't.
    x0 = int(lane_x(0, y) - spacing(y) / 2)
    x1 = int(lane_x(4, y) + spacing(y) / 2)
    if white(x0, x1) > 0.2 or sum(v > 0.25 for v in out) >= 3:
        return [0.0] * 5
    return out


def lane_scores(hsv: np.ndarray, y: int, y0: int) -> list[float]:
    """Share of each lane's strip at row y with that lane's colour (`hsv` starts at row y0)."""
    out = []
    half = int(spacing(y) * 0.35)
    for lane in range(5):
        x = int(lane_x(lane, y))
        roi = hsv[y - y0 - 3 : y - y0 + 4, x - half : x + half].reshape(-1, 3).astype(np.int16)
        dh = np.abs(roi[:, 0] - HUES[lane])
        dh = np.minimum(dh, 180 - dh)
        hit = (dh <= HUE_TOL) & (roi[:, 1] > 90) & (roi[:, 2] > 130)
        out.append(float(hit.mean()))
    return out


def peaks(score: np.ndarray, fps: float) -> list[int]:
    """Short bursts: well above the local median, local maximum, at least 70 ms apart."""
    out = []
    win = 10
    for i in range(win, len(score) - win):
        base = np.median(score[i - win : i + win + 1])
        if score[i] - base < 0.15 or score[i] < score[i - 1] or score[i] < score[i + 1]:
            continue
        if out and i - out[-1] < 0.07 * fps:
            if score[i] > score[out[-1]]:
                out[-1] = i
            continue
        out.append(i)
    return out


# Second recording style (854x480, 30 fps): pad centres on the hit line and lane centres where
# the highway meets the horizon.
VIOLET = {"pad_y": 396, "pad_x": [303, 366, 431, 494, 557], "top_y": 210, "top_x": [364.6, 399.8, 435.0, 470.2, 505.4], "rows": (300, 330)}


def violet_main(path: str, out_path: str) -> None:
    g = VIOLET

    def lx(lane: int, y: int) -> float:
        k = (g["pad_y"] - y) / (g["pad_y"] - g["top_y"])
        return g["pad_x"][lane] + (g["top_x"][lane] - g["pad_x"][lane]) * k

    def half(y: int) -> int:
        k = (g["pad_y"] - y) / (g["pad_y"] - g["top_y"])
        return max(3, int((63.5 + (35.2 - 63.5) * k) * 0.3))

    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    bgr = {r: [] for r in g["rows"]}
    hsv = {r: [] for r in g["rows"]}
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        for r in g["rows"]:
            band = frame[r - 2 : r + 3]
            rois = [band[:, int(lx(l, r)) - half(r) : int(lx(l, r)) + half(r)] for l in range(5)]
            bgr[r].append([roi.reshape(-1, 3).astype(np.float32).mean(0) for roi in rois])
            hsv[r].append([cv2.cvtColor(roi, cv2.COLOR_BGR2HSV).reshape(-1, 3).astype(np.float32).mean(0) for roi in rois])

    def crossings(r: int) -> list[list[float]]:
        m = np.array(bgr[r])
        hs = np.array(hsv[r])
        dev = np.zeros(m.shape[:2])
        for i in range(len(m)):
            a, b = max(0, i - 6), min(len(m), i + 7)
            dev[i] = np.abs(m[i] - np.median(m[a:b], axis=0)).mean(axis=1) / 255
        out = []
        for lane in range(5):
            d = dev[:, lane]
            kept: list[tuple[int, float]] = []
            for i in range(1, len(d) - 1):
                if d[i] < 0.06 or d[i] < d[i - 1] or d[i] < d[i + 1]:
                    continue
                h, sat, _ = hs[i, lane]
                prev = kept[-1][0] if kept else -99
                # A tile's lower face follows its leading edge a few frames later: bluish, or much
                # paler than the edge before it.
                if 2 <= i - prev <= 5 and (h < 134.5 or sat < 115 and hs[prev, lane][1] > sat + 40):
                    continue
                # Sub-frame time from a parabola through the peak.
                den = d[i - 1] - 2 * d[i] + d[i + 1]
                frac = 0.5 * (d[i - 1] - d[i + 1]) / den if den else 0.0
                kept.append((i, i + max(-0.5, min(0.5, frac))))
            out.append([f for _, f in kept])
        return out

    up, low = crossings(g["rows"][0]), crossings(g["rows"][1])
    delays = []
    for lane in range(5):
        for fb in low[lane]:
            prev = [fa for fa in up[lane] if 0 < fb - fa < 0.5 * fps]
            if prev:
                delays.append((fb - max(prev)) / fps)
    dt = float(np.median(delays)) if delays else 0.1
    to_pad = dt * (g["pad_y"] - g["rows"][1]) / (g["rows"][1] - g["rows"][0])
    notes = sorted(({"t": round(f / fps + to_pad, 4), "lane": lane} for lane in range(5) for f in low[lane]), key=lambda n: (n["t"], n["lane"]))
    with open(out_path, "w") as fh:
        json.dump({"fps": fps, "rowDelay": dt, "toPad": to_pad, "notes": notes}, fh, indent=0)
    print(f"{len(notes)} notes, row delay {dt * 1000:.1f} ms, pad lead {to_pad * 1000:.1f} ms")
    for lane in range(5):
        print("lane", lane, len(low[lane]), "notes")


def main() -> None:
    if "--layout" in sys.argv and sys.argv[sys.argv.index("--layout") + 1] == "violet":
        return violet_main(sys.argv[1], sys.argv[2])
    cap = cv2.VideoCapture(sys.argv[1])
    fps = cap.get(cv2.CAP_PROP_FPS)
    scores = {r: [] for r in ROWS}
    whites = {r: [] for r in ROWS}
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        y0 = min(ROWS) - 8
        hsv = cv2.cvtColor(frame[y0 : max(ROWS) + 8], cv2.COLOR_BGR2HSV)
        for r in ROWS:
            scores[r].append(lane_scores(hsv, r, y0))
            whites[r].append(white_scores(hsv, r, y0))
    a = np.array(scores[ROWS[0]])
    b = np.array(scores[ROWS[1]])
    crossings = {r: [peaks(s[:, lane], fps) for lane in range(5)] for r, s in ((ROWS[0], a), (ROWS[1], b))}
    # Scroll speed: pair each lower-row crossing with the closest earlier upper-row crossing.
    delays = []
    for lane in range(5):
        for fb in crossings[ROWS[1]][lane]:
            prev = [fa for fa in crossings[ROWS[0]][lane] if 0 < fb - fa < 0.5 * fps]
            if prev:
                delays.append((fb - max(prev)) / fps)
    dt = float(np.median(delays)) if delays else 0.05
    to_pad = dt * (PAD_Y - ROWS[1]) / (ROWS[1] - ROWS[0])

    # Overdrive tiles are white. Screen glows and streaks are white too, so a white burst only
    # counts when it scrolls like a tile: it crossed the upper row one row-delay earlier, it is
    # never in both rows at once (tiles are shorter than the row distance), and it isn't the edge
    # glow that lights both outer lanes together.
    wa = np.array(whites[ROWS[0]])
    wb = np.array(whites[ROWS[1]])
    lag = dt * fps
    for lane in range(5):
        upper = peaks(wa[:, lane], fps)
        for f in peaks(wb[:, lane], fps):
            if wa[f, lane] > 0.2:
                continue
            if not any(abs(f - fa - lag) <= 1.5 for fa in upper):
                continue
            if wb[f, 0] > 0.2 and wb[f, 4] > 0.2 and wb[f, 1:4].max() < 0.2:
                continue
            if any(abs(f - fc) < 0.07 * fps for fc in crossings[ROWS[1]][lane]):
                continue
            crossings[ROWS[1]][lane].append(f)
        crossings[ROWS[1]][lane].sort()
    notes = sorted(
        ({"t": round(f / fps + to_pad, 4), "lane": lane} for lane in range(5) for f in crossings[ROWS[1]][lane]),
        key=lambda n: (n["t"], n["lane"]),
    )
    with open(sys.argv[2], "w") as fh:
        json.dump({"fps": fps, "rowDelay": dt, "toPad": to_pad, "notes": notes}, fh, indent=0)
    print(f"{len(notes)} notes, row delay {dt * 1000:.1f} ms, pad lead {to_pad * 1000:.1f} ms")
    for lane in range(5):
        print("lane", lane, len(crossings[ROWS[1]][lane]), "notes")


if __name__ == "__main__":
    main()
