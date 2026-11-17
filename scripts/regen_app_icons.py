"""Regenerate Veradic's raster icons from the "Balanced" mark.

The mark is an equals sign: a clean top bar (the answer) over a hand-drawn
bottom bar (the student's own reasoning). Its geometry mirrors
web/src/lib/brand-mark.ts (64-unit grid); change the two together.

Outputs:
  mobile/assets/  icon, splash, Android adaptive layers, monochrome, favicon
  web/src/app/favicon.ico  (16, 32, 48)

Run from the repo root: python scripts/regen_app_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "mobile" / "assets"
FAVICON_ICO = REPO / "web" / "src" / "app" / "favicon.ico"

BOARD = (20, 100, 74)      # #14644A
CHALK = (246, 248, 240)    # #F6F8F0
SUN = (255, 206, 58)       # #FFCE3A
INK = (22, 36, 29)         # #16241D
GREEN = (15, 107, 76)      # #0F6B4C
PAPER = (255, 255, 255)

SS = 4  # supersample factor

# Mark geometry on the 64 grid (web/src/lib/brand-mark.ts).
TOP = [(13, 24), (51, 24)]
BOTTOM = [  # two cubic segments: C then S (reflected first control point)
    ((13, 41), (19.5, 38.8), (24.5, 42.4), (31, 40.8)),
    ((31, 40.8), (37.5, 39.2), (43.5, 38.9), (51, 40.6)),
]
STROKE = 8.5
CENTER_Y = 32.6  # optical centre of the mark's ink


def _cubic(p0, p1, p2, p3, n=80):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def _stroke(draw, pts, width, fill):
    """A round-capped stroke: discs along a densely sampled path."""
    r = width / 2
    dense = []
    for a, b in zip(pts, pts[1:]):
        steps = max(1, int(((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5 / (r / 4)))
        for i in range(steps):
            t = i / steps
            dense.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    dense.append(pts[-1])
    for x, y in dense:
        draw.ellipse((x - r, y - r, x + r, y + r), fill=fill)


def draw_mark(size, top_color, bottom_color, scale=0.8, bg=None, radius=0.0):
    """RGBA image of the mark centred in a square of `size` px.

    `scale` is the mark's size relative to the 64 grid filling the square
    (0.8 matches the web tile). `bg` paints a (rounded, if `radius` > 0)
    background square.
    """
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if bg is not None:
        d.rounded_rectangle((0, 0, S - 1, S - 1), radius=round(radius * S), fill=bg + (255,))
    k = S / 64 * scale

    def m(p):  # grid -> pixels, centred like the SVG transform
        return (S / 2 + (p[0] - 32) * k, S / 2 + (p[1] - CENTER_Y) * k)

    _stroke(d, [m(p) for p in TOP], STROKE * k, top_color + (255,))
    bottom = []
    for seg in BOTTOM:
        bottom += _cubic(*[m(p) for p in seg])
    _stroke(d, bottom, STROKE * k, bottom_color + (255,))
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    # iOS app icon: full-bleed board green (iOS masks the corners).
    draw_mark(1024, CHALK, SUN, scale=0.62, bg=BOARD).convert("RGB").save(OUT / "icon.png", optimize=True)
    # Splash: the mark on white, ink + green.
    draw_mark(1024, INK, GREEN, scale=0.5, bg=PAPER).convert("RGB").save(OUT / "splash-icon.png", optimize=True)
    # Android adaptive: foreground inside the 66% safe zone, solid background.
    draw_mark(512, CHALK, SUN, scale=0.5).save(OUT / "android-icon-foreground.png", optimize=True)
    Image.new("RGBA", (512, 512), BOARD + (255,)).save(OUT / "android-icon-background.png", optimize=True)
    # Themed (monochrome) icon: one colour, Android tints it.
    draw_mark(432, (255, 255, 255), (255, 255, 255), scale=0.5).save(OUT / "android-icon-monochrome.png", optimize=True)
    # Expo web favicon.
    draw_mark(48, CHALK, SUN, bg=BOARD, radius=14 / 64).save(OUT / "favicon.png", optimize=True)
    # Website favicon.ico (browsers that skip icon.svg).
    big = draw_mark(256, CHALK, SUN, bg=BOARD, radius=14 / 64)
    big.save(FAVICON_ICO, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])


if __name__ == "__main__":
    main()
