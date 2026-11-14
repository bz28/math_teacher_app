"""Cut a homework photo to its sheet of paper, and turn it upright, before
the reader sees it.

A phone photo of a page on a desk spends much of its pixels on the desk:
prod, Nov 2026, a 4064×2286 photo whose page filled 47% of the frame,
lying sideways. Downscaled whole for the reader, its handwriting misread
(x¹² for an x⁸, 3 of 3 reads, even at 2576 px); cut to the paper and
turned upright, the same photo read right. The sideways check missed it
too — the desk drowns out the page's lines of writing — and caught it
on the paper alone.

A crop that cuts off work is far worse than no crop, so this only cuts
when the page is unmistakable: one bright, convex sheet with a crisp edge
against a clearly darker background, its own edges on at least two sides,
covering well under the whole frame, with no writing anywhere outside the
cut. Anything less leaves the photo exactly as it was — on 750 recent prod
photo pages that cut 6 (every one correct, no ink lost) and left 744 alone.
Deterministic and free — no model call.
"""

from __future__ import annotations

import base64
import io
import logging
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image, ImageChops, ImageFilter, ImageOps

from api.core.image_utils import line_ratio, open_bounded

logger = logging.getLogger(__name__)

# Detection runs on a copy this size: plenty to find a sheet of paper,
# and it keeps the work per page to a few milliseconds.
_WORK_EDGE = 640
# A page covering more of the frame than this is already most of the
# photo: cutting the rest buys little and risks a lot.
_MAX_PAGE_FRACTION = 0.75
# Smaller than this, the "page" is more likely a glare or a sticky note.
_MIN_PAGE_FRACTION = 0.12
# Paper and background must differ this much in mean brightness (0-255)
# for the page to count as unmistakable.
_MIN_CONTRAST = 45.0
# The sheet must fill its outline: a page is a convex quadrilateral, so
# its area over its convex hull's is ~1. A shadow edge or a blob of
# merged bright things is not.
_MIN_SOLIDITY = 0.93
# The page's boundary, where it isn't the frame edge, must be a crisp
# step: the median brightness gradient along it at least this. Uneven
# light across a page (a soft shadow) makes a boundary too, but a blurry
# one — that is how a first prototype cut half a sheet of graph paper.
_MIN_EDGE_GRADIENT = 40.0
# Room left around the page, as a fraction of its size per side, so a
# stroke at the very edge of the paper is never shaved.
_PAD = 0.04
# A pixel is ink when it is this much darker than what surrounds it, and
# under this share of its brightness.
_INK_DELTA = 30
_INK_SHARE = 0.75
# On paper-bright ground a faint pencil stroke is enough.
_FAINT_INK_DELTA = 12
# Frame sides a page's outline may run into (see `find_page`).
_MAX_FRAME_SIDES = 2
# Ink outside the cut leaves the photo whole once any one connected mark
# of it is this many working pixels — a pen stroke a few millimetres long
# on a phone photo of a page. Smaller specks are desk texture and noise.
_INK_STROKE = 10


# Turning a page needs both a decisive "sideways" — its rows-to-columns
# line ratio under this, stricter than the 0.4 that only suggests a turn
# to the student — and a decisive sense of which way (`_TURN_SCORE`).
_SIDEWAYS_RATIO = 0.3
# The share of each side of a cut page left out when judging its turn.
_RIM = 0.16
# How lopsided the writing must be before the page is turned (see
# `_which_way`). Measured on 723 real upright pages turned each way:
# of the 844 turns `_SIDEWAYS_RATIO` caught, 0.6 turned 117 back, all the
# right way, and left the rest sideways; 0.5 turned 215 but one page the
# wrong way round (both of its turns).
_TURN_SCORE = 0.6


@dataclass(frozen=True)
class PageCrop:
    """What `find_page` decided for one photo."""

    # Left, top, right, bottom in the photo's pixels; None leaves it whole.
    box: tuple[int, int, int, int] | None
    # Why: "cropped", or the check that left the photo whole.
    reason: str


def find_page(img: Image.Image) -> PageCrop:
    """Where to cut `img` (upright as stored, EXIF already applied) so
    that only its sheet of paper is left, or no cut at all."""
    w0, h0 = img.size
    scale = _WORK_EDGE / max(w0, h0)
    if scale >= 1:
        return PageCrop(None, "small")
    small = img.convert("L").resize(
        (max(1, round(w0 * scale)), max(1, round(h0 * scale))), Image.Resampling.BOX,
    )
    gray = np.asarray(small, dtype=np.uint8)
    h, w = gray.shape
    k = max(3, (w + h) // 120) | 1
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    # The photo with its ink lifted out (a grey-level close erases dark
    # strokes thinner than the kernel): paper, shadow and background, so
    # writing can't pass for the page's edge below.
    blank = cv2.morphologyEx(blur, cv2.MORPH_CLOSE, kernel)

    # Paper is the bright class of the photo's two. Close fills the ink
    # in; open drops bright specks and thin strays.
    _, bright = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, kernel)
    bright = cv2.morphologyEx(bright, cv2.MORPH_OPEN, kernel)

    n, labels, stats, _ = cv2.connectedComponentsWithStats(bright, connectivity=8)
    if n < 2:
        return PageCrop(None, "no_page")
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    contours, _ = cv2.findContours(
        (labels == biggest).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE,
    )
    outline = max(contours, key=cv2.contourArea)
    page = np.zeros_like(gray)
    cv2.drawContours(page, [outline], -1, 1, thickness=cv2.FILLED)
    page_mask = page.astype(bool)

    area = float(page_mask.sum())
    fraction = area / (w * h)
    if fraction > _MAX_PAGE_FRACTION:
        return PageCrop(None, "fills_frame")
    if fraction < _MIN_PAGE_FRACTION:
        return PageCrop(None, "too_small")

    hull_area = cv2.contourArea(cv2.convexHull(outline))
    if hull_area <= 0 or area / hull_area < _MIN_SOLIDITY:
        return PageCrop(None, "not_a_sheet")

    inside = float(blank[page_mask].mean())
    outside = float(blank[~page_mask].mean())
    if inside - outside < _MIN_CONTRAST:
        return PageCrop(None, "low_contrast")

    # A sheet lying in the photo has its own edges on at least two sides.
    # A bright region running into three or four sides of the frame is
    # the lit part of a page that fills it, cut off by a shadow.
    pts = outline.reshape(-1, 2)
    touches = sum((
        bool((pts[:, 0] <= 2).any()), bool((pts[:, 0] >= w - 3).any()),
        bool((pts[:, 1] <= 2).any()), bool((pts[:, 1] >= h - 3).any()),
    ))
    if touches > _MAX_FRAME_SIDES:
        return PageCrop(None, "touches_frame")

    # The boundary must be a crisp step where it isn't the frame's edge.
    interior = (pts[:, 0] > 2) & (pts[:, 0] < w - 3) & (pts[:, 1] > 2) & (pts[:, 1] < h - 3)
    if interior.sum() < 20:
        return PageCrop(None, "no_boundary")
    gx = cv2.Sobel(blank, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(blank, cv2.CV_32F, 0, 1, ksize=3)
    # The strongest gradient within a pixel of the traced outline: the
    # trace sits on the bright side of the step, not on it.
    grad = cv2.dilate(cv2.magnitude(gx, gy), np.ones((3, 3), np.uint8))
    sharpness = float(np.median(grad[pts[interior, 1], pts[interior, 0]])) / 4  # Sobel 3×3 gain
    if sharpness < _MIN_EDGE_GRADIENT:
        return PageCrop(None, "soft_boundary")

    x, y, bw, bh = cv2.boundingRect(outline)
    pad_x, pad_y = max(2, round(bw * _PAD)), max(2, round(bh * _PAD))
    left, top = max(0, x - pad_x), max(0, y - pad_y)
    right, bottom = min(w, x + bw + pad_x), min(h, y + bh + pad_y)
    if (right - left) * (bottom - top) > _MAX_PAGE_FRACTION * w * h:
        return PageCrop(None, "fills_frame")

    # Nothing that looks like writing anywhere outside the cut, so a
    # second sheet, a worksheet half out of shot or writing in a shadow
    # keep the photo whole. Ink is a pixel darker than the median around
    # it: on anything paper-bright by even a faint pencil's margin;
    # elsewhere by a pen's — a margin and a share of the brightness, so it
    # holds in shadow — where desk grain would otherwise pass for it.
    ink = _ink(gray, bright, kernel)
    ink[top:bottom, left:right] = 0
    # The median runs off the frame at its edge, where a bright object
    # leaving the shot reads as a dark mark beside it.
    rim = k // 2 + 1
    ink[:rim], ink[-rim:], ink[:, :rim], ink[:, -rim:] = 0, 0, 0, 0
    # Isolated dark specks are texture and noise; a stroke is a connected
    # run of them.
    _, _, blobs, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    if (blobs[1:, cv2.CC_STAT_AREA] >= _INK_STROKE).any():
        return PageCrop(None, "ink_outside")

    inv = 1 / scale
    box = (
        int(left * inv), int(top * inv),
        min(w0, int(np.ceil(right * inv))), min(h0, int(np.ceil(bottom * inv))),
    )
    return PageCrop(box, "cropped")


def _ink(gray: np.ndarray, bright: np.ndarray, kernel: np.ndarray) -> np.ndarray:
    """Thin dark marks in the working image (see the end of `find_page`)."""
    surround = cv2.medianBlur(gray, 2 * kernel.shape[0] + 1).astype(np.int16)
    darker = surround - gray
    on_paper = cv2.erode(bright, kernel).astype(bool) & (darker > _FAINT_INK_DELTA)
    elsewhere = (darker > _INK_DELTA) & (gray < surround * _INK_SHARE)
    ink: np.ndarray = (on_paper | elsewhere).astype(np.uint8)
    return ink


def reader_page(img: Image.Image) -> Image.Image:
    """The photo as the reader should see it: cut to the sheet of paper and
    turned upright when that is certain (`find_page`, `upright_turn`),
    otherwise `img` itself. `img` has its EXIF orientation applied.

    Deterministic, so anything that crops by the reader's coordinates
    (its drawing boxes, `crop_region_for_vision`) finds the same page."""
    box = find_page(img).box
    if box is None:
        return img
    page = img.crop(box)
    turn = upright_turn(page)
    # PIL turns counter-clockwise; quarter turns are exact.
    return page.rotate(-turn, expand=True) if turn else page


def crop_page_to_paper(data_base64: str, media_type: str) -> str:
    """`reader_page` for an upload: an image cut to its paper and turned
    upright, re-encoded in its own format. Anything else — a PDF, a page
    already all paper, an image that won't decode — comes back untouched,
    byte for byte."""
    if not media_type.startswith("image/"):
        return data_base64
    try:
        with open_bounded(base64.b64decode(data_base64)) as opened:
            img = ImageOps.exif_transpose(opened)
            page = reader_page(img)
            if page is img:
                return data_base64
            if media_type != "image/png" and page.mode not in ("RGB", "L"):
                page = page.convert("RGB")
            buf = io.BytesIO()
            if media_type == "image/png":
                page.save(buf, format="PNG")
            else:
                # Near-lossless: the reader downsizes it next anyway.
                page.save(buf, format="JPEG", quality=95)
            return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:  # noqa: BLE001 — a page we can't cut is read whole
        logger.warning("page crop failed; reading the photo whole", exc_info=True)
        return data_base64


def upright_turn(page: Image.Image) -> int:
    """Clockwise quarter turn (0, 90 or 270) that sets a page cut to its
    paper upright — only when it is clearly on its side (`line_ratio`) and
    clearly one way round (`_which_way`); 0 otherwise. Upside-down pages
    aren't detected: their lines still run across."""
    # Judged on the page's interior: its rim holds the crop's padding, the
    # paper's own edges, a notebook's spiral and punched holes — straight
    # rows of "ink" that say nothing about the writing (prod, Nov 2026: a
    # sideways notebook page read as upright until its rim was left out).
    w, h = page.size
    interior = page.crop((
        round(w * _RIM), round(h * _RIM), round(w * (1 - _RIM)), round(h * (1 - _RIM)),
    ))
    ratio = line_ratio(interior)
    if ratio is None or ratio >= _SIDEWAYS_RATIO:
        return 0
    score = _which_way(interior.rotate(-90, expand=True))
    if score > _TURN_SCORE:
        return 90
    if score < -_TURN_SCORE:
        return 270
    return 0


def _which_way(page: Image.Image) -> float:
    """How strongly a page's writing says it is upright (> 0) rather than
    upside down (< 0). Three habits of a written page, each a fraction of
    its ink, summed: more ink on the left half than the right (lines start
    at the margin and run out ragged), more on the top half than the
    bottom (work starts at the top), and line starts lined up tighter than
    line ends. None is reliable alone — each is right on 64–75% of real
    pages — but together, past `_TURN_SCORE`, they are rarely wrong."""
    gray = ImageOps.grayscale(page)
    gray.thumbnail((800, 800))
    blurred = gray.filter(ImageFilter.BoxBlur(15))
    ink = np.asarray(ImageChops.subtract(blurred, gray), dtype=np.int16) > 12
    h, w = ink.shape
    # The outer sliver is the paper's edge and the crop's padding.
    ink = ink[int(h * 0.03):int(h * 0.97), int(w * 0.03):int(w * 0.97)]
    h, w = ink.shape
    total = int(ink.sum())
    if total == 0:
        return 0.0
    left_right = (int(ink[:, : w // 2].sum()) - int(ink[:, w // 2:].sum())) / total
    top_bottom = (int(ink[: h // 2].sum()) - int(ink[h // 2:].sum())) / total
    lines = ink[ink.sum(axis=1) > 3]
    if len(lines) < 20:
        return left_right + top_bottom
    starts = np.argmax(lines, axis=1)
    ends = w - 1 - np.argmax(lines[:, ::-1], axis=1)

    def spread(v: np.ndarray) -> float:
        return float(np.percentile(v, 75) - np.percentile(v, 25))

    aligned = (spread(ends) - spread(starts)) / float(w)
    return left_right + top_bottom + aligned
