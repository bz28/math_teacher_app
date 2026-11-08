"""Shared image / file validation utilities."""

import base64
import ctypes
import io
import logging
import threading
from typing import Any

from PIL import Image, ImageOps

from api.core.constants import MAX_IMAGE_BYTES, MAX_PDF_BYTES

logger = logging.getLogger(__name__)

# Anthropic vision downscales anything past ~1568px on the long edge
# anyway, so we cap there before sending: same legibility, roughly half
# the vision-token cost. Matches the harness judge's _MAX_EDGE.
VISION_MAX_EDGE = 1568

# The smallest homework photo worth reading, by its long edge. Prod,
# Oct 2026: some devices send 320×240 pages; the reader can't make out
# the ink at that size, invents a tidy textbook solution instead, and it
# gets graded full credit. No page in prod between 400 px and a real
# photo read badly for its size (smaller ones were single-problem crops).
# Mirrored in web/src/lib/image-resize.ts MIN_PAGE_LONG_EDGE.
MIN_PAGE_LONG_EDGE = 400


def image_long_edge(raw: bytes) -> int:
    """The long edge of an image in pixels. Reads the header only, and
    refuses an image past `MAX_UPLOAD_PIXELS` like every other open."""
    with _open_bounded(raw) as img:
        return max(img.size)


def validate_and_decode_image(image_base64: str) -> tuple[bytes, str]:
    """Validate and decode a base64-encoded image.

    Returns (raw_bytes, media_type) on success.
    Raises ValueError on invalid data, oversized images, or unsupported formats.
    """
    try:
        raw = base64.b64decode(image_base64)
    except Exception as err:
        raise ValueError("Invalid base64 image data") from err

    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError(
            f"Image too large: {len(raw) / 1024 / 1024:.1f}MB (max 5MB)"
        )

    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        media_type = "image/png"
    elif raw[:2] == b"\xff\xd8":
        media_type = "image/jpeg"
    else:
        raise ValueError("Unsupported image format (only JPEG and PNG are accepted)")

    return raw, media_type


def validate_and_decode_upload(data_base64: str) -> tuple[bytes, str]:
    """Validate and decode a base64-encoded image OR PDF upload.

    Returns (raw_bytes, media_type) where media_type is one of
    image/jpeg, image/png, application/pdf. Raises ValueError on invalid
    base64, oversized payload, or unsupported magic bytes. Magic-byte
    check is intentional defense — clients can't smuggle a non-PDF blob
    by claiming application/pdf in metadata.
    """
    try:
        raw = base64.b64decode(data_base64)
    except Exception as err:
        raise ValueError("Invalid base64 data") from err

    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        media_type = "image/png"
        cap = MAX_IMAGE_BYTES
        cap_label = "5MB"
    elif raw[:2] == b"\xff\xd8":
        media_type = "image/jpeg"
        cap = MAX_IMAGE_BYTES
        cap_label = "5MB"
    elif raw[:5] == b"%PDF-":
        media_type = "application/pdf"
        cap = MAX_PDF_BYTES
        cap_label = "25MB"
    else:
        raise ValueError(
            "Unsupported file format (only JPEG, PNG, and PDF are accepted)"
        )

    if len(raw) > cap:
        raise ValueError(
            f"File too large: {len(raw) / 1024 / 1024:.1f}MB (max {cap_label})"
        )

    return raw, media_type


# Quarter turns a student can apply to a page before turning it in,
# measured clockwise — what the rotate button on the upload screen does.
PAGE_ROTATIONS = (0, 90, 180, 270)

# The long edge the sideways check measures at. Clients send a copy
# about this size, so the check reads the same pixels however large the
# original photo was.
_ORIENTATION_EDGE = 800

# Below this rows-to-columns text-line ratio a page reads as sideways.
# Validated on 341 real student pages (see `page_looks_sideways`).
SIDEWAYS_LINE_RATIO = 0.4

# Pixel ceiling for any upload we decode. The byte caps bound the
# compressed size only — a 160 KB PNG can declare 144 megapixels — so
# this is what bounds memory. Well above a 48 MP phone photo.
MAX_UPLOAD_PIXELS = 50_000_000

# A turned page is re-encoded; match typical phone JPEG quality so the
# stored page isn't bigger than the one the student sent.
_ROTATED_JPEG_QUALITY = 85


def _open_bounded(raw: bytes) -> Image.Image:
    """Open image bytes, refusing anything past `MAX_UPLOAD_PIXELS`
    before a single pixel is decoded (Image.open only reads the header)."""
    img = Image.open(io.BytesIO(raw))
    w, h = img.size
    if w * h > MAX_UPLOAD_PIXELS:
        img.close()
        raise ValueError(f"Image too large: {w}x{h} pixels")
    return img


def rotate_upload(data_base64: str, media_type: str, rotation: int) -> str:
    """Store a page the way the student turned it on the upload screen.

    Bakes the EXIF flag in first — the preview the student rotated is the
    EXIF-applied image — then turns it `rotation` degrees clockwise and
    re-encodes in the same format, so everything that later shows or
    reads the page (the AI reader, the teacher's photo view, the student's
    confirm screen) gets it upright with no rotation logic of its own.
    Rotation 0 returns the input untouched, byte for byte. A PDF turns
    every page (`rotate_pdf`).

    The result stays under `MAX_IMAGE_BYTES` — re-encoding can grow a
    file, so an over-cap result is scaled down until it fits — and keeps
    the photo's colour profile. Raises ValueError for an image it can't
    or won't decode.
    """
    if rotation == 0:
        return data_base64
    if media_type == "application/pdf":
        return rotate_pdf(data_base64, rotation)
    if not media_type.startswith("image/"):
        return data_base64
    with _open_bounded(base64.b64decode(data_base64)) as opened:
        icc = opened.info.get("icc_profile")
        # PIL's rotate() is counter-clockwise; quarter turns are exact.
        img = ImageOps.exif_transpose(opened).rotate(-rotation, expand=True)
    if media_type != "image/png" and img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    while True:
        buf = io.BytesIO()
        if media_type == "image/png":
            img.save(buf, format="PNG", icc_profile=icc)
        else:
            img.save(buf, format="JPEG", quality=_ROTATED_JPEG_QUALITY, icc_profile=icc)
        if buf.tell() <= MAX_IMAGE_BYTES or min(img.size) < 600:
            return base64.b64encode(buf.getvalue()).decode("ascii")
        img = img.resize(
            (int(img.width * 0.85), int(img.height * 0.85)), Image.Resampling.LANCZOS,
        )


def _profile_spread(profile: list[float]) -> float:
    """Spread of an ink profile after removing its slow trend.

    Lines of writing turn a profile taken across them into a comb —
    dense line, blank gap, dense line — which survives the high-pass;
    a profile taken along the lines is flat by comparison.
    """
    window = 31
    half = window // 2
    n = len(profile)
    detrended = []
    for i in range(n):
        lo, hi = max(0, i - half), min(n, i + half + 1)
        # Zero-padded moving average, matching the validated reference.
        detrended.append(profile[i] - sum(profile[lo:hi]) / window)
    core = detrended[20:-20] if n > 40 else detrended
    if not core:
        return 0.0
    mean = sum(core) / len(core)
    return float((sum((v - mean) ** 2 for v in core) / len(core)) ** 0.5)


def page_looks_sideways(data_base64: str) -> bool:
    """Free, no-model check: does this photo's writing run up and down?

    Compares how strongly ink bunches into rows versus columns. Upright
    handwriting forms rows (lines of text), so the row profile is spiky
    and the column profile flat; a page lying on its side inverts that.
    It can't tell which way a sideways page is turned — the student picks
    the direction — and it only suggests: nothing is rotated on its word.

    On 341 real pages (21 hand-labelled sideways) it caught 17 of the 21
    and flagged 1 upright page. Returns False for anything it can't read.
    """
    try:
        with _open_bounded(base64.b64decode(data_base64)) as opened:
            # JPEGs decode straight at reduced scale — cheap however large
            # the upload. Other formats ignore this.
            opened.draft("L", (_ORIENTATION_EDGE * 2, _ORIENTATION_EDGE * 2))
            gray = ImageOps.grayscale(ImageOps.exif_transpose(opened))
    except Exception:
        return False
    return _image_looks_sideways(gray)


def _image_looks_sideways(img: Image.Image) -> bool:
    """`page_looks_sideways` on an already-open, upright-as-stored image."""
    from PIL import ImageChops, ImageFilter

    try:
        gray = ImageOps.grayscale(img)
        gray.thumbnail((_ORIENTATION_EDGE, _ORIENTATION_EDGE))
        blurred = gray.filter(ImageFilter.BoxBlur(15))
        # Ink = pixels clearly darker than their neighbourhood, which
        # ignores shadows and uneven lighting across the page.
        ink = ImageChops.subtract(blurred, gray).point(
            lambda v: 1 if v > 12 else 0,
        ).convert("F")
        w, h = ink.size
        # Box-resizing to one pixel wide/tall averages each row/column.
        rows = [float(v) for v in ink.resize((1, h), Image.Resampling.BOX).get_flattened_data()]  # type: ignore[arg-type]
        cols = [float(v) for v in ink.resize((w, 1), Image.Resampling.BOX).get_flattened_data()]  # type: ignore[arg-type]
    except Exception:
        return False
    col_spread = _profile_spread(cols)
    if col_spread <= 1e-6:
        return False
    return _profile_spread(rows) / col_spread < SIDEWAYS_LINE_RATIO


def preprocess_image_for_vision(data_base64: str, media_type: str) -> str:
    """Bake in EXIF orientation and downscale before a vision call.

    Phone cameras record a portrait/landscape shot in the sensor's native
    orientation and store the intended rotation as an EXIF *flag* rather
    than rotating the pixels. Vision models read raw pixels and ignore the
    flag, so an un-transposed phone photo arrives sideways. `exif_transpose`
    rewrites the pixels to match the flag, then we cap the long edge at
    `VISION_MAX_EDGE`.

    Only `image/*` is transformed; PDFs and unknown media types are returned
    unchanged (the document path must not be re-encoded as a flat image).
    On any decode/transform error the input base64 is returned untouched so
    a quirky-but-valid image still reaches the model.

    Returns the re-encoded base64 string (same media_type / format).
    """
    if not media_type.startswith("image/"):
        return data_base64
    try:
        raw = base64.b64decode(data_base64)
        with Image.open(io.BytesIO(raw)) as opened:
            img = ImageOps.exif_transpose(opened)
            if max(img.size) > VISION_MAX_EDGE:
                img.thumbnail(
                    (VISION_MAX_EDGE, VISION_MAX_EDGE),
                    Image.Resampling.LANCZOS,
                )
            fmt = "PNG" if media_type == "image/png" else "JPEG"
            # JPEG can't hold an alpha channel / palette — flatten first so
            # the save doesn't raise and silently fall through to the raw
            # (still mis-oriented) image.
            if fmt == "JPEG" and img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format=fmt)
            return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return data_base64


def crop_region_for_vision(
    data_base64: str, media_type: str, bbox: dict[str, Any], *, margin: float = 0.35,
    min_frac: float = 0.22, upscale_to: int = 1200,
) -> str | None:
    """Crop a normalized `bbox` (fractions of the ORIENTED page) out of the
    original photo and hand it back enlarged, for a second look at a
    small drawing. The full-page pass downsizes a phone photo to
    `VISION_MAX_EDGE`, which turns a 2-inch sketch into a thumbnail the
    model can't read — it then fills the gap from the algebra beside it.

    `margin` pads the box (the model's boxes are rough), `min_frac`
    guarantees a usable window even when it under-reports the size, and
    the crop is upscaled so strokes have pixels. Returns None for
    non-images or an unusable box; the caller then keeps the unverified
    inventory.
    """
    if not media_type.startswith("image/"):
        return None
    try:
        x0, y0, x1, y1 = (float(bbox[k]) for k in ("x0", "y0", "x1", "y1"))
    except (KeyError, TypeError, ValueError):
        return None
    if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
        return None
    try:
        raw = base64.b64decode(data_base64)
        with Image.open(io.BytesIO(raw)) as opened:
            img = ImageOps.exif_transpose(opened)
            w, h = img.size
            bw, bh = max(x1 - x0, min_frac), max(y1 - y0, min_frac)
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            bw, bh = bw * (1 + margin), bh * (1 + margin)
            left = int(max(0.0, cx - bw / 2) * w)
            top = int(max(0.0, cy - bh / 2) * h)
            right = int(min(1.0, cx + bw / 2) * w)
            bottom = int(min(1.0, cy + bh / 2) * h)
            if right - left < 16 or bottom - top < 16:
                return None
            crop = img.crop((left, top, right, bottom))
            if max(crop.size) < upscale_to:
                scale = upscale_to / max(crop.size)
                crop = crop.resize(
                    (int(crop.width * scale), int(crop.height * scale)), Image.Resampling.LANCZOS,
                )
            if crop.mode not in ("RGB", "L"):
                crop = crop.convert("RGB")
            buf = io.BytesIO()
            crop.save(buf, format="JPEG", quality=90)
            return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return None


# Enough pixels for a hand-drawn graph to survive the crop-and-enlarge
# (crop_region_for_vision), a little above what a phone photo of the same
# page carries after VISION_MAX_EDGE.
_PDF_RENDER_LONG_EDGE = 2400
# A homework upload is a few pages; past this, a "PDF" is not homework.
_PDF_MAX_PAGES = 30
_PDF_LOCK = threading.Lock()


def pdf_pages_as_images(data_base64: str, *, complete: bool = False) -> list[str]:
    """Each page of a PDF as a base64 JPEG, in order, cut to the page's
    content (`_page_view`). These are what the reader reads — all under
    the file's one page number — and what a drawing is cropped from, so
    a drawing's bbox means the same thing to both.
    Empty when the PDF can't be read. Otherwise a PDF past
    `_PDF_MAX_PAGES`, or one with a page that won't render, gives the
    pages it could — or, with `complete`, nothing: the reader then sends
    the PDF itself rather than silently lose a page of work.
    pdfium isn't thread-safe, so renders take `_PDF_LOCK` (callers run
    this off the event loop)."""
    import pypdfium2 as pdfium  # imported here: only PDF uploads need it
    import pypdfium2.raw as pdfium_c

    with _PDF_LOCK:
        return _render_pdf(pdfium, pdfium_c, data_base64, complete=complete)


# Browser print chrome (the date, title, URL and page number Chrome,
# Firefox and Gmail print) sits in this outer sliver of a page's height.
# A student's own typed header or page number sits further in (Google
# Docs puts one half an inch down), so it is kept.
_PDF_CHROME_BAND = 0.03
# A white shape covering this much of the page is its paper: Google Docs
# and browser prints paint one under everything.
_PDF_PAPER_COVERAGE = 0.95
# Room around the content so a stroke at its edge isn't shaved off.
_PDF_CROP_PAD = 6.0


def _page_view(page: Any, pdfium_c: Any) -> tuple[tuple[float, float, float, float], float]:
    """How to render one PDF page for a vision call: what to cut off it
    (pdfium's `crop` — left, bottom, right, top points of the page as
    displayed, after /Rotate) and at what scale.

    Sent whole, a PDF page is rasterized by the API at a fixed ~1.2 MP
    whatever it holds, and a phone photo printed to PDF fills only part
    of it: Google Docs and browser prints set it on a Letter sheet with
    margins (~60% of the page), Gmail adds a header and footer. The work
    then reaches the reader far smaller than the same photo uploaded on
    its own (prod, Nov 2026: a 4096 px collage printed from Gmail read
    3π/4 as 3π/2). So the render is cut to the page's content — every
    object except chrome text and the paper — at the reader's render
    size; a page that is only pictures goes no finer than the densest
    picture's own pixels. Any doubt renders the whole page."""
    width, height = page.get_width(), page.get_height()
    whole = ((0.0, 0.0, 0.0, 0.0), _PDF_RENDER_LONG_EDGE / max(width, height, 1))
    try:
        # The box pdfium displays (crop ∩ media, inherited ones included) —
        # `get_cropbox` misses a box set on the parent pages node.
        cl, cb, cr, ct = page.get_bbox()
        band = _PDF_CHROME_BAND * (ct - cb)
        box: list[float] | None = None
        only_pictures = True
        px_per_pt = 0.0
        # Annotations (ink a student added in an iPad app without
        # flattening) are rendered but aren't page objects: their rects
        # count as content. Links draw nothing.
        for rect in _annotation_rects(page, pdfium_c):
            left, bottom, right, top = max(rect[0], cl), max(rect[1], cb), min(rect[2], cr), min(rect[3], ct)
            if right > left and top > bottom:
                box = _union(box, (left, bottom, right, top))
                only_pictures = False
        # Top level only: a nested object's bounds are in its form's space.
        for obj in page.get_objects(max_depth=0):
            ol, ob, orr, ot = obj.get_bounds()
            left, bottom, right, top = max(ol, cl), max(ob, cb), min(orr, cr), min(ot, ct)
            if right <= left or top <= bottom:
                continue  # off the page
            if obj.type == pdfium_c.FPDF_PAGEOBJ_TEXT and (bottom >= ct - band or top <= cb + band):
                continue  # print chrome
            if obj.type == pdfium_c.FPDF_PAGEOBJ_PATH and _is_paper(
                obj, pdfium_c, (right - left) * (top - bottom), (cr - cl) * (ct - cb)
            ):
                continue
            box = _union(box, (left, bottom, right, top))
            if obj.type == pdfium_c.FPDF_PAGEOBJ_IMAGE:
                px_w, px_h = obj.get_px_size()
                px_per_pt = max(px_per_pt, max(px_w, px_h) / max(orr - ol, ot - ob, 1e-6))
            else:
                only_pictures = False
        if box is None:
            return whole
        left, bottom = max(cl, box[0] - _PDF_CROP_PAD), max(cb, box[1] - _PDF_CROP_PAD)
        right, top = min(cr, box[2] + _PDF_CROP_PAD), min(ct, box[3] + _PDF_CROP_PAD)
        if right - left < 1 or top - bottom < 1:
            return whole
        # Cut from each side of the unrotated page; /Rotate turns the
        # page clockwise, so each side moves one place per quarter turn.
        cut = (left - cl, bottom - cb, cr - right, ct - top)
        turns = (page.get_rotation() // 90) % 4
        shown = tuple(cut[(i + turns) % 4] for i in range(4))
        scale = _PDF_RENDER_LONG_EDGE / max(right - left, top - bottom, 1)
        if only_pictures and px_per_pt > 0:
            scale = min(scale, px_per_pt)
        return (shown[0], shown[1], shown[2], shown[3]), scale
    except Exception:  # noqa: BLE001 — a page we can't measure is sent whole
        logger.warning("pdf view: couldn't measure a page, rendering it whole", exc_info=True)
        return whole


def _union(box: list[float] | None, rect: tuple[float, float, float, float]) -> list[float]:
    if box is None:
        return list(rect)
    return [min(box[0], rect[0]), min(box[1], rect[1]), max(box[2], rect[2]), max(box[3], rect[3])]


def _annotation_rects(page: Any, pdfium_c: Any) -> list[tuple[float, float, float, float]]:
    out: list[tuple[float, float, float, float]] = []
    for i in range(pdfium_c.FPDFPage_GetAnnotCount(page.raw)):
        annot = pdfium_c.FPDFPage_GetAnnot(page.raw, i)
        if not annot:
            continue
        try:
            rect = pdfium_c.FS_RECTF()
            if pdfium_c.FPDFAnnot_GetSubtype(annot) != pdfium_c.FPDF_ANNOT_LINK and pdfium_c.FPDFAnnot_GetRect(
                annot, rect
            ):
                out.append((rect.left, min(rect.bottom, rect.top), rect.right, max(rect.bottom, rect.top)))
        finally:
            pdfium_c.FPDFPage_CloseAnnot(annot)
    return out


def _is_paper(obj: Any, pdfium_c: Any, area: float, page_area: float) -> bool:
    """A white, unstroked shape covering the page: a frame drawn round
    the page is kept."""
    if area < _PDF_PAPER_COVERAGE * page_area:
        return False
    mode, stroke = ctypes.c_int(), ctypes.c_int()
    if not pdfium_c.FPDFPath_GetDrawMode(obj.raw, mode, stroke) or stroke.value:
        return False
    r, g, b, a = (ctypes.c_uint() for _ in range(4))
    if not pdfium_c.FPDFPageObj_GetFillColor(obj.raw, r, g, b, a):
        return False
    return (r.value, g.value, b.value) == (255, 255, 255)


def _render_pdf(pdfium: Any, pdfium_c: Any, data_base64: str, *, complete: bool) -> list[str]:
    try:
        pdf = pdfium.PdfDocument(base64.b64decode(data_base64))
    except Exception:  # noqa: BLE001 — an unreadable PDF has no pages to crop
        logger.warning("pdf render: unreadable PDF, no pages")
        return []
    pages = len(pdf)
    if pages > _PDF_MAX_PAGES:
        if complete:
            logger.warning("pdf render: %d pages, past the %d cap: not rendered", pages, _PDF_MAX_PAGES)
            pdf.close()
            return []
        logger.warning("pdf render: %d pages, rendering the first %d", pages, _PDF_MAX_PAGES)
    out: list[str] = []
    try:
        for i in range(min(len(pdf), _PDF_MAX_PAGES)):
            page = pdf[i]
            crop, scale = _page_view(page, pdfium_c)
            img = page.render(scale=scale, crop=crop).to_pil().convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=90)
            out.append(base64.b64encode(buf.getvalue()).decode("ascii"))
    except Exception:  # noqa: BLE001 — keep the pages that rendered, unless all are needed
        logger.warning("pdf render: stopped after %d of %d pages", len(out), pages, exc_info=True)
        if complete:
            out = []
    finally:
        pdf.close()
    return out


# A PDF page counts as a scan (a photo saved as a PDF) only when pictures
# cover at least this much of it AND it has no text and no vector paths.
# Typed text and tablet handwriting (vector strokes, often over a small
# raster "paper" background) are sharp at any size, so there is no pixel
# size to hold them to.
_PDF_SCAN_COVERAGE = 0.5


def pdf_scan_long_edges(data_base64: str) -> list[int | None]:
    """Per PDF page, in order: the long edge, in pixels, of the photo the
    page was made from — the same number `image_long_edge` gives for a
    photo uploaded on its own — or None for a page that isn't a scan.

    Measured from the embedded picture's own pixels, not a render: a
    render's size says nothing about the ink's — a 320×240 photo saved as
    a PDF can render big and be just as unreadable.
    Empty when the PDF can't be read."""
    import pypdfium2 as pdfium
    import pypdfium2.raw as pdfium_c

    with _PDF_LOCK:
        try:
            pdf = pdfium.PdfDocument(base64.b64decode(data_base64))
        except Exception:  # noqa: BLE001 — an unreadable PDF has no pages to measure
            return []
        out: list[int | None] = []
        try:
            for i in range(min(len(pdf), _PDF_MAX_PAGES)):
                out.append(_scan_long_edge(pdf[i], pdfium_c))
        except Exception:  # noqa: BLE001 — a page that won't load isn't refused
            logger.warning("pdf measure: stopped after %d of %d pages", len(out), len(pdf), exc_info=True)
        finally:
            pdf.close()
        return out


def _scan_long_edge(page: Any, pdfium_c: Any) -> int | None:
    # Every doubt lets the page through: this can refuse a turn-in.
    try:
        page_w, page_h = page.get_size()
        # Any text or vector drawing, at any depth, means the page carries
        # content sharper than its pictures — not a scan.
        drawn = (pdfium_c.FPDF_PAGEOBJ_TEXT, pdfium_c.FPDF_PAGEOBJ_PATH)
        if next(iter(page.get_objects(filter=drawn)), None) is not None:
            return None
        covered = 0.0
        px_per_pt = 0.0
        # Top level only: a picture nested in a form is positioned in the
        # form's space, so its bounds would mislead.
        for obj in page.get_objects(filter=(pdfium_c.FPDF_PAGEOBJ_IMAGE,), max_depth=0):
            left, bottom, right, top = obj.get_bounds()
            if right <= left or top <= bottom:
                continue
            covered += (right - left) * (top - bottom)
            px_w, px_h = obj.get_px_size()
            px_per_pt = max(px_per_pt, max(px_w, px_h) / max(right - left, top - bottom))
    except Exception:  # noqa: BLE001 — a page we can't measure isn't refused
        return None
    if page_w <= 0 or page_h <= 0 or covered < _PDF_SCAN_COVERAGE * page_w * page_h:
        return None
    # The whole page at the picture's own density, so a scan saved as a
    # few strips measures the same as one picture.
    return round(px_per_pt * float(max(page_w, page_h)))


def rotate_pdf(data_base64: str, rotation: int) -> str:
    """Turn every page of a PDF `rotation` degrees clockwise. Sets each
    page's /Rotate, which every viewer and `pdf_pages_as_images` honour,
    so the content is untouched. Raises ValueError for a PDF it can't read."""
    import pypdfium2 as pdfium

    with _PDF_LOCK:
        try:
            pdf = pdfium.PdfDocument(base64.b64decode(data_base64))
        except Exception as e:
            raise ValueError("Unreadable PDF") from e
        try:
            for i in range(len(pdf)):
                page = pdf[i]
                page.set_rotation((page.get_rotation() + rotation) % 360)
            buf = io.BytesIO()
            pdf.save(buf)
        finally:
            pdf.close()
    return base64.b64encode(buf.getvalue()).decode("ascii")


# The long edge of the PDF page preview the upload screen shows (and
# rotates) in place of a photo.
_PDF_PREVIEW_EDGE = 640


def pdf_page_checks(data_base64: str) -> dict[str, Any]:
    """The upload screen's checks for one PDF, per page as the reader
    sees it: how many pages, which read as sideways (1-based), which are
    scans too small to read, and a small JPEG preview of the first
    sideways page (else page 1) for the student to look at and turn.

    One open of the PDF under `_PDF_LOCK`, rendering each page at the
    sideways check's own resolution (not the reader's 2400 px), so the
    lock grading shares is held briefly. A page that fails to render
    still counts but is never flagged; an unreadable PDF has no pages."""
    import pypdfium2 as pdfium
    import pypdfium2.raw as pdfium_c

    renders: list[Image.Image | None] = []
    edges: list[int | None] = []
    with _PDF_LOCK:
        try:
            pdf = pdfium.PdfDocument(base64.b64decode(data_base64))
        except Exception:  # noqa: BLE001 — an unreadable PDF has no pages to check
            return {"page_count": 0, "sideways_pages": [], "too_small_pages": [], "preview": None}
        try:
            for i in range(min(len(pdf), _PDF_MAX_PAGES)):
                render: Image.Image | None = None
                edge: int | None = None
                try:
                    page = pdf[i]
                    edge = _scan_long_edge(page, pdfium_c)
                    width, height = page.get_size()
                    scale = _ORIENTATION_EDGE / max(width, height, 1)
                    render = page.render(scale=scale).to_pil().convert("RGB")
                except Exception:  # noqa: BLE001 — counted, not flagged
                    logger.warning("pdf check: page %d of %d didn't render", i + 1, len(pdf), exc_info=True)
                renders.append(render)
                edges.append(edge)
        finally:
            pdf.close()
    # Pixel analysis needs no pdfium: outside the lock.
    sideways = [i + 1 for i, img in enumerate(renders) if img is not None and _image_looks_sideways(img)]
    shown = renders[sideways[0] - 1] if sideways else next((r for r in renders if r is not None), None)
    preview = None
    if shown is not None:
        thumb = shown.copy()
        thumb.thumbnail((_PDF_PREVIEW_EDGE, _PDF_PREVIEW_EDGE))
        buf = io.BytesIO()
        thumb.save(buf, format="JPEG", quality=80)
        preview = base64.b64encode(buf.getvalue()).decode("ascii")
    return {
        "page_count": len(renders),
        "sideways_pages": sideways,
        "too_small_pages": [
            i + 1 for i, edge in enumerate(edges) if edge is not None and edge < MIN_PAGE_LONG_EDGE
        ],
        "preview": preview,
    }


def to_content_block(media_type: str, data_base64: str) -> dict[str, Any]:
    """Build the Anthropic content block for a base64 payload.

    Images go as `image` blocks; PDFs go as `document` blocks (Claude
    handles PDF natively as a multi-page document, not via OCR).
    """
    if media_type == "application/pdf":
        block_type = "document"
    elif media_type.startswith("image/"):
        block_type = "image"
    else:
        raise ValueError(f"Unsupported media type for content block: {media_type}")

    return {
        "type": block_type,
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": data_base64,
        },
    }
