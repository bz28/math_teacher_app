"""Regenerate Veradic mobile icons in the editorial green palette.

Mirrors the web SVG at web/src/app/icon.svg:
  background: linear gradient #1F6B47 (top-left) -> #0A3D2A (bottom-right)
  V mark:     white stroke, rounded caps + join, with a white dot at the
              upper-right tip.

Outputs to mobile/assets/, overwriting the existing purple-theme PNGs.
Run from the repo root: python scripts/regen_app_icons.py
"""

from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "mobile" / "assets"

BG_TOP = (31, 107, 71)    # #1F6B47
BG_BOT = (10, 61, 42)     # #0A3D2A
WHITE = (255, 255, 255)
DOT_WHITE = (255, 255, 255, 242)  # ~95% opacity

# Stroke gradient: pure white at top -> very pale mint at bottom.
V_TOP = (255, 255, 255)
V_BOT = (230, 240, 234)   # #E6F0EA

SUPERSAMPLE = 2  # render 2x then downsample for antialiasing


def diag_gradient(size, c1, c2):
    """Diagonal top-left -> bottom-right gradient."""
    W, H = size
    # Build at 1/16 res for speed, then resize. The result is visually
    # indistinguishable from per-pixel because the gradient is smooth.
    sw, sh = max(W // 16, 64), max(H // 16, 64)
    img = Image.new("RGB", (sw, sh))
    px = img.load()
    denom = (sw - 1) + (sh - 1) or 1
    for y in range(sh):
        for x in range(sw):
            t = (x + y) / denom
            r = round(c1[0] + (c2[0] - c1[0]) * t)
            g = round(c1[1] + (c2[1] - c1[1]) * t)
            b = round(c1[2] + (c2[2] - c1[2]) * t)
            px[x, y] = (r, g, b)
    return img.resize((W, H), Image.BICUBIC)


def vertical_gradient(size, c1, c2):
    """Top -> bottom gradient. Returns RGB image."""
    W, H = size
    img = Image.new("RGB", (1, H))
    px = img.load()
    for y in range(H):
        t = y / (H - 1) if H > 1 else 0
        r = round(c1[0] + (c2[0] - c1[0]) * t)
        g = round(c1[1] + (c2[1] - c1[1]) * t)
        b = round(c1[2] + (c2[2] - c1[2]) * t)
        px[0, y] = (r, g, b)
    return img.resize((W, H), Image.BICUBIC)


def draw_v_mark(size, stroke_color_img, scale_box=0.42, stroke_frac=0.105,
                dot_color=DOT_WHITE):
    """Return RGBA layer with the V mark + dot, transparent background.

    The V geometry mirrors web/src/app/icon.svg path:
      M 160 148 L 256 380 L 352 148  (on a 512 grid)
    scaled into the requested (W, H).

    stroke_color_img can be an RGB Image the same size; the V stroke
    samples from it (lets us paint a vertical white->mint gradient on
    the stroke). Pass None for pure white.
    """
    W, H = size
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    # Render at supersampled resolution then shrink for smooth edges.
    SW, SH = W * SUPERSAMPLE, H * SUPERSAMPLE
    big = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    mask = Image.new("L", (SW, SH), 0)
    md = ImageDraw.Draw(mask)

    # Normalize web SVG coords (0..512) to current canvas.
    def n(p):
        return (round(p[0] / 512 * SW), round(p[1] / 512 * SH))

    tl = n((160, 148))
    bot = n((256, 380))
    tr = n((352, 148))
    stroke_w = round(52 / 512 * SW)
    half = stroke_w / 2
    dot_r = round(18 / 512 * SW)

    # Two straight segments forming the V. Rounded caps + join come
    # from drawing filled circles at every endpoint after the lines.
    md.line([tl, bot], fill=255, width=stroke_w)
    md.line([bot, tr], fill=255, width=stroke_w)
    for cx, cy in (tl, bot, tr):
        md.ellipse((cx - half, cy - half, cx + half, cy + half), fill=255)

    # Paint the stroke using stroke_color_img (or solid white).
    if stroke_color_img is not None:
        paint = stroke_color_img.resize((SW, SH), Image.BICUBIC).convert("RGBA")
    else:
        paint = Image.new("RGBA", (SW, SH), WHITE + (255,))
    big.paste(paint, (0, 0), mask)

    # Dot at the upper-right tip, drawn on top of the V stroke.
    dd = ImageDraw.Draw(big)
    dd.ellipse(
        (tr[0] - dot_r, tr[1] - dot_r, tr[0] + dot_r, tr[1] + dot_r),
        fill=dot_color,
    )

    layer = big.resize((W, H), Image.LANCZOS)
    return layer


def make_icon():
    """1024x1024 iOS app icon: green gradient bg + white-mint V + dot."""
    W = H = 1024
    bg = diag_gradient((W, H), BG_TOP, BG_BOT)
    stroke = vertical_gradient((W, H), V_TOP, V_BOT)
    v = draw_v_mark((W, H), stroke)
    out = bg.convert("RGBA")
    out.alpha_composite(v)
    out.convert("RGB").save(OUT / "icon.png", optimize=True)


def make_splash():
    """1024x1024 splash. Original was a colored V on white; keep that
    formula but flip purple -> editorial green. The V uses a vertical
    gradient (deep green at top to lighter at bottom) so it carries the
    same warmth as the launch screen background (#F7F5F0)."""
    W = H = 1024
    stroke = vertical_gradient((W, H), (14, 82, 56), (47, 143, 102))  # #0E5238 -> #2F8F66
    v = draw_v_mark((W, H), stroke, dot_color=(14, 82, 56, 235))
    out = Image.new("RGBA", (W, H), (247, 245, 240, 255))  # #F7F5F0 paper
    out.alpha_composite(v)
    out.convert("RGB").save(OUT / "splash-icon.png", optimize=True)


def make_android_foreground():
    """Android adaptive icon foreground: white V on transparent.
    Android composes this above the background layer with a 25-33%
    safe-zone outset, so the V already sits at ~80% of canvas — same
    proportions the source PNG used."""
    W = H = 512
    stroke = vertical_gradient((W, H), V_TOP, V_BOT)
    v = draw_v_mark((W, H), stroke)
    v.save(OUT / "android-icon-foreground.png", optimize=True)


def make_android_background():
    """Solid green gradient panel that sits behind the foreground V."""
    W = H = 512
    bg = diag_gradient((W, H), BG_TOP, BG_BOT)
    bg.convert("RGBA").save(OUT / "android-icon-background.png", optimize=True)


def make_android_monochrome():
    """Themed-icon silhouette: solid white V on transparent, no dot.
    Android tints this with the user's accent color at runtime."""
    W = H = 432
    SW, SH = W * SUPERSAMPLE, H * SUPERSAMPLE
    mask = Image.new("L", (SW, SH), 0)
    md = ImageDraw.Draw(mask)

    def n(p):
        return (round(p[0] / 512 * SW), round(p[1] / 512 * SH))

    tl, bot, tr = n((160, 148)), n((256, 380)), n((352, 148))
    stroke_w = round(52 / 512 * SW)
    half = stroke_w / 2
    md.line([tl, bot], fill=255, width=stroke_w)
    md.line([bot, tr], fill=255, width=stroke_w)
    for cx, cy in (tl, bot, tr):
        md.ellipse((cx - half, cy - half, cx + half, cy + half), fill=255)

    big = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    white = Image.new("RGBA", (SW, SH), WHITE + (255,))
    big.paste(white, (0, 0), mask)
    big.resize((W, H), Image.LANCZOS).save(OUT / "android-icon-monochrome.png", optimize=True)


def make_favicon():
    """48x48 web favicon: full miniature design."""
    W = H = 48
    bg = diag_gradient((W, H), BG_TOP, BG_BOT)
    stroke = vertical_gradient((W, H), V_TOP, V_BOT)
    v = draw_v_mark((W, H), stroke)
    out = bg.convert("RGBA")
    out.alpha_composite(v)
    out.save(OUT / "favicon.png", optimize=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    make_icon()
    make_splash()
    make_android_foreground()
    make_android_background()
    make_android_monochrome()
    make_favicon()
    print("Wrote 6 icons to", OUT)


if __name__ == "__main__":
    main()
