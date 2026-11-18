"""Pencil-on-lined-paper homework photos for the demo-school seed.

`render_pages(hand, header, problems, seed)` draws a student's turn-in as
JPEG "photos" of a notebook page: ruled paper with a red margin, the
student's work in graphite with per-glyph wobble, a slight tilt, uneven
light and sensor grain. The same LaTeX the script stores as the reader's
transcript is what gets drawn, so the photo, the reading and the grade
always say the same thing.

Only the LaTeX subset the seed writes is understood: \\frac, \\sqrt,
^{...} / ^\\circ, \\text{...}, trig names, Greek theta/pi and a few
relations. Fonts are OFL-licensed handwriting faces bundled under
scripts/assets/handwriting/ (licence files alongside). θ is drawn by
hand — none of the faces has it.
"""

from __future__ import annotations

import io
import math
import random
import re
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

FONT_DIR = Path(__file__).resolve().parent / "assets" / "handwriting"
FALLBACK_FONT = "Kalam-Light.ttf"

# One face per student, so five turn-ins don't look like one hand.
HANDS = {
    "fake_1": "Kalam-Light.ttf",
    "fake_2": "PatrickHand-Regular.ttf",
    "fake_3": "IndieFlower-Regular.ttf",
    "fake_4": "ShadowsIntoLight.ttf",
    "fake_5": "Handlee-Regular.ttf",
}
# Faces differ in x-height; these sizes make them read alike on the rule.
_HAND_SIZE = {
    "Kalam-Light.ttf": 58,
    "PatrickHand-Regular.ttf": 62,
    "IndieFlower-Regular.ttf": 58,
    "ShadowsIntoLight.ttf": 62,
    "Handlee-Regular.ttf": 54,
}

PAGE_W, PAGE_H = 1700, 2200
RULE_GAP = 74
FIRST_RULE = 250
MARGIN_X = 210
CONTENT_X = 310
LABEL_X = 236

# ── LaTeX subset → layout nodes ─────────────────────────────────────

_SYMBOLS = {
    "theta": "θ", "pi": "π", "approx": "≈", "cdot": "·", "pm": "±", "le": "≤", "leq": "≤",
    "ge": "≥", "geq": "≥", "Rightarrow": "⇒", "to": "→", "infty": "∞", "circ": "°",
    "sin": "sin", "cos": "cos", "tan": "tan", "csc": "csc", "sec": "sec", "cot": "cot",
    "quad": "   ", "qquad": "     ", ",": " ", ";": " ", "!": "", " ": " ", "{": "{", "}": "}",
    "%": "%", "neq": "≠", "times": "×", "div": "÷", "degree": "°",
}
_DROP = {"left", "right", "displaystyle", "big", "Big", "mathrm", ","}


@dataclass
class Node:
    kind: str  # "t" text | "frac" | "sqrt" | "sup"
    text: str = ""
    a: list[Node] = field(default_factory=list)
    b: list[Node] = field(default_factory=list)


def _group(src: str, i: int) -> tuple[str, int]:
    """The brace group starting at src[i] (or the single char there)."""
    while i < len(src) and src[i] == " ":
        i += 1
    if i >= len(src):
        return "", i
    if src[i] != "{":
        if src[i] == "\\":
            m = re.match(r"\\([A-Za-z]+|.)", src[i:])
            assert m
            return m.group(0), i + len(m.group(0))
        return src[i], i + 1
    depth, j = 0, i
    while j < len(src):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return src[i + 1:j], j + 1
        j += 1
    return src[i + 1:], len(src)


def parse(src: str) -> list[Node]:
    out: list[Node] = []
    buf: list[str] = []

    def flush() -> None:
        if buf:
            out.append(Node("t", "".join(buf)))
            buf.clear()

    i = 0
    while i < len(src):
        c = src[i]
        if c == "\\":
            m = re.match(r"\\([A-Za-z]+|.)", src[i:])
            assert m
            name = m.group(1)
            i += len(m.group(0))
            if name in ("frac", "dfrac", "tfrac"):
                num, i = _group(src, i)
                den, i = _group(src, i)
                flush()
                out.append(Node("frac", a=parse(num), b=parse(den)))
            elif name == "sqrt":
                body, i = _group(src, i)
                flush()
                out.append(Node("sqrt", a=parse(body)))
            elif name in ("text", "textrm", "mathrm"):
                body, i = _group(src, i)
                buf.append(body)
            elif name in _SYMBOLS:
                buf.append(_SYMBOLS[name])
            elif name in _DROP:
                pass
            else:
                buf.append(name)
        elif c == "^":
            body, i = _group(src, i + 1)
            if body in ("\\circ", "{\\circ}", "o"):
                buf.append("°")
            elif body == "2":
                buf.append("²")
            else:
                flush()
                out.append(Node("sup", a=parse(body)))
        elif c in "{}":
            i += 1
        else:
            buf.append(c)
            i += 1
    flush()
    return out


_SUPERSCRIPT_SRC = "-0123456789"
_SUPERSCRIPT = str.maketrans(_SUPERSCRIPT_SRC, "⁻⁰¹²³⁴⁵⁶⁷⁸⁹")


def _wrap(x: str) -> str:
    return x if len(x) <= 2 or x.isalnum() else f"({x})"


def to_plain(src: str) -> str:
    """The reader's plain-English line for a LaTeX step: the same maths as
    text, fractions written a/b."""
    def flat(nodes: list[Node]) -> str:
        s = []
        for n in nodes:
            if n.kind == "t":
                s.append(n.text)
            elif n.kind == "frac":
                num, den = flat(n.a), flat(n.b)
                s.append(f"{_wrap(num)}/{_wrap(den)}")
            elif n.kind == "sqrt":
                s.append(f"√({flat(n.a)})" if len(flat(n.a)) > 1 else f"√{flat(n.a)}")
            elif n.kind == "sup":
                sup = flat(n.a)
                s.append(sup.translate(_SUPERSCRIPT) if set(sup) <= set(_SUPERSCRIPT_SRC) else f"^{sup}")
        return "".join(s)

    return re.sub(r"\s+", " ", flat(parse(src))).strip()


# ── Glyphs ───────────────────────────────────────────────────────────


@cache
def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_DIR / name), size)


@cache
def _has_glyph(name: str, ch: str) -> bool:
    """Whether the face draws `ch` itself rather than its missing-glyph box."""
    f = _font(name, 40)

    def drawn(c: str) -> bytes:
        img = Image.new("L", (90, 90), 0)
        ImageDraw.Draw(img).text((10, 10), c, font=f, fill=255)
        return img.tobytes()

    return drawn(ch) != drawn("\ue000")


class Pen:
    """Writes onto an ink mask (L, 255 = full graphite) with a hand's
    small irregularities: baseline drift, per-glyph tilt and size."""

    def __init__(self, ink: Image.Image, hand: str, rng: random.Random) -> None:
        self.ink = ink
        self.hand = hand
        self.size = _HAND_SIZE.get(hand, 46)
        self.rng = rng
        self.draw = ImageDraw.Draw(ink)
        self.pressure = 1.0
        self.slope = 0.0
        self.line_x0 = 0.0

    def _face(self, ch: str) -> str:
        return self.hand if _has_glyph(self.hand, ch) else FALLBACK_FONT

    def stroke(self, pts: list[tuple[float, float]], width: float) -> None:
        jit = [(x + self.rng.uniform(-0.8, 0.8), y + self.rng.uniform(-0.8, 0.8)) for x, y in pts]
        self.draw.line(jit, fill=int(245 * self.pressure), width=max(2, round(width)), joint="curve")

    def text_width(self, text: str, scale: float = 1.0) -> float:
        w = 0.0
        for ch in text:
            if ch == "θ":
                w += self.size * scale * 0.5
            elif ch == " ":
                w += self.size * scale * 0.3
            else:
                f = _font(self._face(ch), max(8, round(self.size * scale)))
                w += f.getlength(ch) * 0.97
        return w

    def glyph(self, ch: str, x: float, base: float, scale: float = 1.0) -> float:
        size = self.size * scale
        if ch == " ":
            return x + size * 0.3
        if ch == "θ":
            return self._theta(x, base + (x - self.line_x0) * self.slope, size)
        base += (x - self.line_x0) * self.slope
        jitter = self.rng.uniform(0.95, 1.05)
        f = _font(self._face(ch), max(8, round(size * jitter)))
        ascent, descent = f.getmetrics()
        w = f.getlength(ch)
        pad = int(size * 0.4)
        tile = Image.new("L", (int(w) + 2 * pad, ascent + descent + 2 * pad), 0)
        ImageDraw.Draw(tile).text((pad, pad), ch, font=f, fill=int(250 * self.pressure))
        tile = tile.rotate(self.rng.uniform(-4, 4), resample=Image.Resampling.BICUBIC)
        dx = self.rng.uniform(-1.2, 1.2)
        dy = self.rng.uniform(-1.5, 1.5)
        ox, oy = int(x - pad + dx), int(base - ascent - pad + dy)
        region = self.ink.crop((ox, oy, ox + tile.width, oy + tile.height))
        self.ink.paste(ImageChops.lighter(region, tile), (ox, oy))
        return x + w * 0.97

    def _theta(self, x: float, base: float, size: float) -> float:
        """A hand-drawn θ: a narrow loop with a bar through it."""
        w, h = size * 0.36, size * 0.62
        cx, cy = x + w / 2 + size * 0.06, base - h / 2
        pts = []
        start = self.rng.uniform(0, math.pi)
        for k in range(42):
            t = start + 2 * math.pi * k / 40
            pts.append((cx + (w / 2) * math.cos(t), cy + (h / 2) * math.sin(t)))
        self.stroke(pts, size * 0.055)
        self.stroke([(cx - w / 2 + 2, cy + self.rng.uniform(-2, 2)), (cx + w / 2 - 2, cy + self.rng.uniform(-2, 2))],
                    size * 0.05)
        return x + size * 0.5

    def run(self, text: str, x: float, base: float, scale: float = 1.0) -> float:
        for ch in text:
            x = self.glyph(ch, x, base, scale)
        return x


def _measure(pen: Pen, nodes: list[Node], scale: float) -> float:
    w = 0.0
    for n in nodes:
        if n.kind == "t":
            w += pen.text_width(n.text, scale)
        elif n.kind == "frac":
            w += max(_measure(pen, n.a, scale * 0.84), _measure(pen, n.b, scale * 0.84)) + pen.size * scale * 0.3
        elif n.kind == "sqrt":
            w += _measure(pen, n.a, scale) + pen.size * scale * 0.55
        elif n.kind == "sup":
            w += _measure(pen, n.a, scale * 0.6)
    return w


def _draw_nodes(pen: Pen, nodes: list[Node], x: float, base: float, scale: float = 1.0) -> float:
    size = pen.size * scale
    for n in nodes:
        if n.kind == "t":
            x = pen.run(n.text, x, base, scale)
        elif n.kind == "frac":
            s2 = scale * 0.84
            wn, wd = _measure(pen, n.a, s2), _measure(pen, n.b, s2)
            w = max(wn, wd) + size * 0.16
            bar_y = base - size * 0.3 + (x - pen.line_x0) * pen.slope + pen.rng.uniform(-1.5, 1.5)
            drift = (x - pen.line_x0) * pen.slope
            _draw_nodes(pen, n.a, x + (w - wn) / 2 + size * 0.06, bar_y - size * 0.1 - drift, s2)
            pen.stroke([(x + size * 0.04, bar_y), (x + w + size * 0.04, bar_y + pen.rng.uniform(-2, 2))], size * 0.05)
            _draw_nodes(pen, n.b, x + (w - wd) / 2 + size * 0.06, bar_y + size * 0.72 - drift, s2)
            x += w + size * 0.18
        elif n.kind == "sqrt":
            wb = _measure(pen, n.a, scale)
            top = base - size * 0.86
            pen.stroke([(x, base - size * 0.32), (x + size * 0.12, base - size * 0.38),
                        (x + size * 0.24, base + size * 0.04), (x + size * 0.4, top),
                        (x + size * 0.48 + wb, top + pen.rng.uniform(-2, 2))], size * 0.05)
            x = _draw_nodes(pen, n.a, x + size * 0.45, base, scale) + size * 0.08
        elif n.kind == "sup":
            x = _draw_nodes(pen, n.a, x, base - size * 0.42, scale * 0.6)
    return x


def _has_frac(nodes: list[Node]) -> bool:
    return any(n.kind == "frac" or _has_frac(n.a) or _has_frac(n.b) for n in nodes)


# ── Page ─────────────────────────────────────────────────────────────


@dataclass
class Line:
    """One written line. `latex` for maths; `prose` for words. `crossed`
    lines are struck out (and left out of the reading); `boxed` is the
    answer the student boxed."""

    latex: str = ""
    prose: str = ""
    crossed: bool = False
    boxed: bool = False


@dataclass
class WrittenProblem:
    label: str
    lines: list[Line]


@dataclass
class Placed:
    """Where each problem's lines landed: page index (1-based) per line."""

    pages: dict[tuple[int, int], int] = field(default_factory=dict)


def _paper(rng: random.Random) -> Image.Image:
    page = Image.new("RGB", (PAGE_W, PAGE_H), (250, 249, 243))
    noise = Image.effect_noise((PAGE_W // 4, PAGE_H // 4), 10).resize((PAGE_W, PAGE_H), Image.Resampling.BICUBIC)
    page = Image.composite(page, Image.new("RGB", page.size, (236, 234, 224)), noise.point(lambda v: 150 + v // 3))
    d = ImageDraw.Draw(page)
    for y in range(FIRST_RULE, PAGE_H - 60, RULE_GAP):
        d.line([(0, y), (PAGE_W, y + rng.uniform(-1, 1))], fill=(158, 190, 222), width=2)
    d.line([(MARGIN_X, 0), (MARGIN_X, PAGE_H)], fill=(226, 140, 140), width=3)
    for hy in (PAGE_H * 0.12, PAGE_H * 0.5, PAGE_H * 0.88):
        d.ellipse([58, hy - 31, 122, hy + 33], fill=(205, 202, 192))
        d.ellipse([60, hy - 28, 120, hy + 30], fill=(118, 104, 88))
    return page


def _photo(page: Image.Image, ink: Image.Image, rng: random.Random) -> bytes:
    grain = Image.effect_noise(ink.size, 60).point(lambda v: 150 + v // 2)
    ink = ImageChops.multiply(ink.filter(ImageFilter.GaussianBlur(0.8)), grain)
    graphite = Image.new("RGB", page.size, (46, 48, 56))
    page = Image.composite(graphite, page, ink.point(lambda v: int(v * 0.92)))
    # A phone photo: the page a little tilted on a desk, lit from one side.
    angle = rng.uniform(-1.6, 1.6)
    desk = (118, 104, 88)
    canvas = Image.new("RGB", (PAGE_W + 120, PAGE_H + 140), desk)
    shadow = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(shadow).rectangle([70, 82, 70 + PAGE_W, 82 + PAGE_H], fill=120)
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas = Image.composite(Image.new("RGB", canvas.size, (70, 60, 50)), canvas, shadow)
    canvas.paste(page, (60, 66))
    canvas = canvas.rotate(angle, resample=Image.Resampling.BICUBIC, fillcolor=desk)
    # Rotate a gradient twice the size and keep the middle, so the light
    # falls off smoothly with no fill wedges at the corners.
    light = Image.linear_gradient("L").resize((512, 512))
    light = light.rotate(rng.choice([90, -90, 180, 0]) + rng.uniform(-25, 25), resample=Image.Resampling.BICUBIC)
    light = light.crop((128, 128, 384, 384)).resize(canvas.size, Image.Resampling.BICUBIC)
    light = light.point(lambda v: 222 + v * 33 // 255)
    canvas = ImageChops.multiply(canvas, Image.merge("RGB", (light, light, light.point(lambda v: v - 6))))
    sensor = Image.effect_noise(canvas.size, 6).convert("RGB")
    canvas = ImageChops.add(canvas, sensor, scale=1.0, offset=-128)
    canvas = canvas.filter(ImageFilter.GaussianBlur(0.35))
    canvas = canvas.resize((1500, round(1500 * canvas.height / canvas.width)), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    canvas.save(buf, format="JPEG", quality=84, optimize=True)
    return buf.getvalue()


def render_pages(
    hand_of: str, header: list[str], problems: list[WrittenProblem], seed: int,
) -> tuple[list[bytes], Placed]:
    """Draw the turn-in; returns the JPEG pages and the page each line is on."""
    rng = random.Random(seed)
    hand = HANDS.get(hand_of, FALLBACK_FONT)
    placed = Placed()
    pages: list[bytes] = []

    def new_sheet() -> tuple[Image.Image, Image.Image, Pen]:
        page = _paper(rng)
        ink = Image.new("L", page.size, 0)
        pen = Pen(ink, hand, rng)
        return page, ink, pen

    page, ink, pen = new_sheet()
    # Name / class / homework on the top lines, right-aligned like most kids do.
    y: float = FIRST_RULE - RULE_GAP * 2 - 8
    for text in header:
        w = pen.text_width(text, 0.86)
        pen.run(text, PAGE_W - 120 - w, y, 0.86)
        y += RULE_GAP * 0.9
    row = 1.0
    max_row = (PAGE_H - 140 - FIRST_RULE) // RULE_GAP

    def height(ln: Line) -> float:
        tall = bool(ln.latex) and _has_frac(parse(ln.latex))
        return 1.0 + (0.7 if tall else 0.0) + (0.3 if ln.boxed else 0.0)

    for p_idx, prob in enumerate(problems):
        need = sum(height(ln) for ln in prob.lines) + 1
        if row + need > max_row and row > 1:
            pages.append(_photo(page, ink, rng))
            page, ink, pen = new_sheet()
            row = 0.0
        pen.pressure = rng.uniform(0.82, 1.0)
        for l_idx, ln in enumerate(prob.lines):
            nodes = parse(ln.latex) if ln.latex else [Node("t", ln.prose)]
            tall = _has_frac(nodes)
            # Fractions and boxes take more room than one rule, the way a
            # student's stacked fraction spills over the line above.
            row += height(ln) - 1.0
            pen.slope = rng.uniform(-0.012, 0.008)
            base = FIRST_RULE + row * RULE_GAP - 12 + rng.uniform(-3, 3)
            if l_idx == 0:
                pen.slope, pen.line_x0 = 0.0, LABEL_X
                pen.run(prob.label, LABEL_X, base + 2)
                pen.slope = rng.uniform(-0.012, 0.008)
            x0 = CONTENT_X + rng.uniform(-6, 10) + (20 if l_idx and rng.random() < 0.3 else 0)
            pen.line_x0 = x0
            x1 = _draw_nodes(pen, nodes, x0, base, 0.96 if ln.prose else 1.0)
            if ln.crossed:
                mid = base - pen.size * 0.3
                pen.stroke([(x0 - 6, mid + 3), ((x0 + x1) / 2, mid - 4), (x1 + 8, mid + 2)], 4)
            if ln.boxed:
                end_drift = (x1 - x0) * pen.slope
                top = base - pen.size * (1.2 if tall else 0.88)
                bot = base + pen.size * (0.72 if tall else 0.3)
                pen.stroke([(x0 - 14, top), (x1 + 14, top - 3 + end_drift), (x1 + 16, bot + end_drift),
                            (x0 - 12, bot + 2), (x0 - 14, top - 6)], 3.5)
            placed.pages[(p_idx, l_idx)] = len(pages) + 1
            row += 1
        row += 1
    pages.append(_photo(page, ink, rng))
    return pages, placed
