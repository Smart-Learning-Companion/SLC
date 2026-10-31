"""Screen OCR: image bytes -> text. Runs fully on the device (RapidOCR + ONNX).

Contract used by the ML service: ocr_image(bytes) -> str.
ocr_image_ex(bytes) -> OcrOutput also returns the mean confidence and the line count.
Indentation is rebuilt from box positions, because OCR itself returns plain lines.
Test on a screenshot, from services/ml:  python -m context.ocr /tmp/frame.jpg
"""

import os
import re
import statistics
import threading
from dataclasses import dataclass

import cv2
import numpy as np

MAX_SIDE = 2000  # screenshots larger than this (longest side) are scaled down
PREPROCESS = os.environ.get("SLC_OCR_PREPROCESS", "none")  # "none" or "invert-dark"

# The OCR sometimes returns full-width forms of ASCII punctuation (， （ ）). Map them back.
_FULLWIDTH = {c: c - 0xFEE0 for c in range(0xFF01, 0xFF5F)}

_engine = None
_lock = (
    threading.Lock()
)  # one OCR run at a time; the engine is not documented as thread-safe


@dataclass
class OcrOutput:
    text: str
    confidence: float  # mean of the per-line scores, 0..1
    lines: int  # number of text boxes found


def _get_engine():
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import (
            RapidOCR,
        )  # imported late so the service starts fast

        _engine = RapidOCR()
    return _engine


def _decode(data: bytes):
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return None
    h, w = img.shape[:2]
    scale = MAX_SIDE / max(h, w)
    if scale < 1:
        img = cv2.resize(
            img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA
        )
    if (
        PREPROCESS == "invert-dark" and float(img.mean()) < 110
    ):  # dark theme -> dark text on light
        img = cv2.bitwise_not(img)
    return img


def _char_width(pieces) -> float:
    """One character's width. Code is monospace, so this is stable.

    Box width / text length is inflated for short boxes (padding) and for boxes where the OCR
    dropped spaces, so take the lower quartile of the longer boxes instead of the median.
    """
    long_ones = sorted(
        (p["x1"] - p["x0"]) / len(p["text"]) for p in pieces if len(p["text"]) >= 8
    )
    if len(long_ones) >= 3:
        return max(long_ones[len(long_ones) // 4], 1.0)
    return max(
        statistics.median((p["x1"] - p["x0"]) / len(p["text"]) for p in pieces), 1.0
    )


def _snap_indents(offsets, unit_px):
    """Indent widths (in characters) from pixel offsets. Snap to 4 or 2 when the code clearly uses it."""
    chars = [o / unit_px for o in offsets]
    for step in (4, 2):
        if all(abs(c / step - round(c / step)) * step <= 0.75 for c in chars):
            return [round(c / step) * step for c in chars]
    return [round(c) for c in chars]


def layout_text(items) -> str:
    """Rebuild lines, blank lines and indentation from OCR boxes.

    items: [(box, text, score)], box = four (x, y) corners. Pure function, easy to test.
    """
    pieces = []
    for box, text, _score in items:
        text = text.strip().translate(_FULLWIDTH)
        if not text:
            continue
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        pieces.append(
            {
                "text": text,
                "x0": min(xs),
                "x1": max(xs),
                "yc": (min(ys) + max(ys)) / 2,
                "h": max(ys) - min(ys),
            }
        )
    if not pieces:
        return ""

    char_w = _char_width(pieces)
    height = max(statistics.median(p["h"] for p in pieces), 1.0)

    # Group boxes into rows by vertical position.
    pieces.sort(key=lambda p: p["yc"])
    rows, row = [], [pieces[0]]
    for p in pieces[1:]:
        if abs(p["yc"] - sum(q["yc"] for q in row) / len(row)) <= 0.5 * height:
            row.append(p)
        else:
            rows.append(row)
            row = [p]
    rows.append(row)
    for r in rows:
        r.sort(key=lambda p: p["x0"])

    # Editor line numbers form a gutter: short first boxes, then a clear gap. If most rows have
    # one, drop every short box in that column (this also removes misread numbers like "W").
    gutter = [
        r[0]["x1"]
        for r in rows
        if len(r) > 1
        and len(r[0]["text"]) <= 4
        and r[1]["x0"] - r[0]["x1"] >= 1.5 * char_w
    ]
    gutter_x1 = (
        statistics.median(gutter) if len(gutter) >= max(2, 0.4 * len(rows)) else None
    )

    lines = []  # (left x, text, row y)
    for r in rows:
        if gutter_x1 is not None:
            while (
                r and len(r[0]["text"]) <= 4 and r[0]["x1"] <= gutter_x1 + 0.5 * char_w
            ):
                r = r[1:]
            if not r:
                continue
        text = r[0]["text"]
        for prev, cur in zip(r, r[1:]):
            gap = cur["x0"] - prev["x1"]
            text += " " * min(max(1, round(gap / char_w)), 6) + cur["text"]
        lines.append((r[0]["x0"], text, sum(p["yc"] for p in r) / len(r)))
    if not lines:
        return ""

    base = min(x for x, _, _ in lines)
    indents = _snap_indents([x - base for x, _, _ in lines], char_w)
    out, prev_y = [], None
    for (_x, text, y), indent in zip(lines, indents):
        if prev_y is not None and y - prev_y > 1.8 * height:
            out.append("")  # a visible gap between lines is a blank line in the code
        out.append(" " * min(max(indent, 0), 60) + text)
        prev_y = y
    return "\n".join(line.rstrip() for line in out).strip("\n")


def ocr_image_ex(data: bytes) -> OcrOutput:
    img = _decode(data)
    if img is None:
        return OcrOutput("", 0.0, 0)
    with _lock:
        result, _elapsed = _get_engine()(img)
    if not result:
        return OcrOutput("", 0.0, 0)
    confidence = sum(float(r[2]) for r in result) / len(result)  # scores can be strings
    return OcrOutput(layout_text(result), confidence, len(result))


def ocr_image(data: bytes) -> str:
    return ocr_image_ex(data).text


def warm_up() -> None:
    """Load the models and run one tiny image, so the first real request is fast."""
    with _lock:
        _get_engine()(np.full((64, 256, 3), 255, np.uint8))


if __name__ == "__main__":
    import sys
    import time

    image = open(sys.argv[1], "rb").read()
    warm_up()
    t0 = time.perf_counter()
    out = ocr_image_ex(image)
    print(
        f"{time.perf_counter() - t0:.2f}s, {out.lines} boxes, confidence {out.confidence:.2f}\n"
    )
    print(out.text)
