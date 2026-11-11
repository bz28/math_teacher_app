"""Unit tests for image_utils — validators + Anthropic content-block builder."""

import base64
import io

import pytest
from PIL import Image

from api.core.constants import MAX_IMAGE_BYTES, MAX_PDF_BYTES
from api.core.image_utils import (
    VISION_MAX_EDGE,
    page_looks_sideways,
    pdf_page_checks,
    pdf_pages_as_images,
    pdf_scan_long_edges,
    preprocess_image_for_vision,
    rotate_upload,
    to_content_block,
    validate_and_decode_image,
    validate_and_decode_upload,
)

# Magic-byte prefixes for each accepted format. Each is a tiny payload
# that starts with the signature bytes; what comes after the signature
# is irrelevant for magic-byte detection.
_PNG_HEADER = b"\x89PNG\r\n\x1a\n"
_JPEG_HEADER = b"\xff\xd8\xff\xe0\x00\x10JFIF"
_PDF_HEADER = b"%PDF-1.4\n%\xc7\xec\x8f\xa2\n"


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


# ── validate_and_decode_upload ───────────────────────────────────────


class TestValidateAndDecodeUpload:
    def test_accepts_png(self) -> None:
        raw, media_type = validate_and_decode_upload(_b64(_PNG_HEADER + b"payload"))
        assert media_type == "image/png"
        assert raw.startswith(_PNG_HEADER)

    def test_accepts_jpeg(self) -> None:
        raw, media_type = validate_and_decode_upload(_b64(_JPEG_HEADER + b"payload"))
        assert media_type == "image/jpeg"
        assert raw.startswith(b"\xff\xd8")

    def test_accepts_pdf(self) -> None:
        raw, media_type = validate_and_decode_upload(_b64(_PDF_HEADER + b"payload"))
        assert media_type == "application/pdf"
        assert raw.startswith(b"%PDF-")

    def test_rejects_invalid_base64(self) -> None:
        with pytest.raises(ValueError, match="Invalid base64"):
            # b64 strict mode tolerates a lot, but a leading null byte
            # in non-validate mode still raises Incorrect padding etc.
            # Pass an explicitly-invalid string.
            validate_and_decode_upload("!!!not-base64!!!")

    def test_rejects_unsupported_format(self) -> None:
        with pytest.raises(ValueError, match="Unsupported file format"):
            validate_and_decode_upload(_b64(b"GIF89a" + b"payload"))

    def test_rejects_oversized_image(self) -> None:
        # Build a JPEG-magic blob just over the 5MB image cap.
        oversized = _JPEG_HEADER + b"\x00" * (MAX_IMAGE_BYTES - len(_JPEG_HEADER) + 1)
        with pytest.raises(ValueError, match="File too large"):
            validate_and_decode_upload(_b64(oversized))

    def test_rejects_oversized_pdf(self) -> None:
        # PDFs are allowed up to 25MB; one byte over should fail. Build
        # the smallest blob that crosses the cap.
        oversized = _PDF_HEADER + b"\x00" * (MAX_PDF_BYTES - len(_PDF_HEADER) + 1)
        with pytest.raises(ValueError, match="File too large"):
            validate_and_decode_upload(_b64(oversized))

    def test_image_under_cap_accepted(self) -> None:
        # An image just under the 5MB cap should pass. Sanity-check
        # that the cap branches off media_type, not raw size alone.
        big = _PNG_HEADER + b"\x00" * (MAX_IMAGE_BYTES - len(_PNG_HEADER))
        raw, media_type = validate_and_decode_upload(_b64(big))
        assert media_type == "image/png"
        assert len(raw) == MAX_IMAGE_BYTES

    def test_pdf_above_image_cap_accepted(self) -> None:
        # A PDF between the image cap (5MB) and PDF cap (25MB) is the
        # entire reason for the per-format cap split — confirm it works.
        big = _PDF_HEADER + b"\x00" * (MAX_IMAGE_BYTES + 1024 - len(_PDF_HEADER))
        raw, media_type = validate_and_decode_upload(_b64(big))
        assert media_type == "application/pdf"
        assert len(raw) > MAX_IMAGE_BYTES

    def test_magic_byte_spoof_rejected(self) -> None:
        # A blob that's neither image nor PDF must fail with "unsupported
        # format" — a client can't smuggle a non-PDF blob through by
        # claiming it's a PDF, because we re-check magic bytes here.
        bogus = b"this-is-not-a-pdf-or-image-at-all"
        with pytest.raises(ValueError, match="Unsupported file format"):
            validate_and_decode_upload(_b64(bogus))


# ── validate_and_decode_image (existing helper, sanity coverage) ─────


class TestValidateAndDecodeImageStillRejectsPdf:
    """Strict-image callers (e.g. teacher avatar uploads) must NOT
    silently accept a PDF now that the upload validator does."""

    def test_rejects_pdf(self) -> None:
        with pytest.raises(ValueError, match="Unsupported image format"):
            validate_and_decode_image(_b64(_PDF_HEADER + b"payload"))


# ── to_content_block ─────────────────────────────────────────────────


class TestToContentBlock:
    def test_jpeg_emits_image_block(self) -> None:
        block = to_content_block("image/jpeg", "AAAA")
        assert block == {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": "AAAA",
            },
        }

    def test_png_emits_image_block(self) -> None:
        block = to_content_block("image/png", "AAAA")
        assert block["type"] == "image"
        assert block["source"]["media_type"] == "image/png"

    def test_pdf_emits_document_block(self) -> None:
        block = to_content_block("application/pdf", "AAAA")
        assert block == {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": "AAAA",
            },
        }

    def test_unknown_media_type_raises(self) -> None:
        with pytest.raises(ValueError, match="Unsupported media type"):
            to_content_block("application/octet-stream", "AAAA")


# ── preprocess_image_for_vision (EXIF orientation + downscale) ────────


def _encode(img: Image.Image, fmt: str, **save: object) -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt, **save)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _decode_size(b64: str) -> tuple[int, int]:
    raw = base64.b64decode(b64)
    with Image.open(io.BytesIO(raw)) as img:
        return img.size


class TestPreprocessImageForVision:
    def test_exif_orientation_baked_in(self) -> None:
        # A wide 24x12 JPEG tagged orientation=6 ("rotate 90° CW") should
        # come back with its pixels physically rotated — dimensions swap
        # to 12x24. This is the load-bearing assertion that
        # exif_transpose actually ran.
        img = Image.new("RGB", (24, 12), "white")
        exif = img.getexif()
        exif[0x0112] = 6  # Orientation tag → rotate 90° CW on display
        tagged = _encode(img, "JPEG", exif=exif)

        # Sanity: the raw tagged image still reads as 24x12 before transpose.
        assert _decode_size(tagged) == (24, 12)

        out = preprocess_image_for_vision(tagged, "image/jpeg")
        assert _decode_size(out) == (12, 24)

    def test_no_exif_is_unrotated(self) -> None:
        # An image with no orientation tag keeps its dimensions.
        img = Image.new("RGB", (40, 20), "white")
        b64 = _encode(img, "JPEG")
        out = preprocess_image_for_vision(b64, "image/jpeg")
        assert _decode_size(out) == (40, 20)

    def test_downscales_long_edge(self) -> None:
        # An oversize image is shrunk so its long edge == VISION_MAX_EDGE,
        # preserving aspect ratio.
        img = Image.new("RGB", (VISION_MAX_EDGE * 2, VISION_MAX_EDGE), "white")
        b64 = _encode(img, "PNG")
        out = preprocess_image_for_vision(b64, "image/png")
        w, h = _decode_size(out)
        assert max(w, h) == VISION_MAX_EDGE
        assert (w, h) == (VISION_MAX_EDGE, VISION_MAX_EDGE // 2)

    def test_small_image_not_upscaled(self) -> None:
        img = Image.new("RGB", (100, 50), "white")
        b64 = _encode(img, "PNG")
        out = preprocess_image_for_vision(b64, "image/png")
        assert _decode_size(out) == (100, 50)

    def test_pdf_passthrough_unchanged(self) -> None:
        # Non-image media types must NOT be routed through Pillow — the
        # document path stays byte-for-byte identical.
        pdf_b64 = base64.b64encode(b"%PDF-1.4\nstuff").decode("ascii")
        assert (
            preprocess_image_for_vision(pdf_b64, "application/pdf") == pdf_b64
        )

    def test_undecodable_input_returned_untouched(self) -> None:
        # A claimed image that isn't actually decodable falls back to the
        # original base64 rather than raising — a quirky-but-valid image
        # still reaches the model.
        junk = base64.b64encode(b"not really a jpeg").decode("ascii")
        assert preprocess_image_for_vision(junk, "image/jpeg") == junk


# ── rotate_upload (the student's rotate button, applied at submit) ────


def _pixel(b64: str, xy: tuple[int, int]) -> tuple[int, ...]:
    with Image.open(io.BytesIO(base64.b64decode(b64))) as img:
        return img.convert("RGB").getpixel(xy)


def _marked(size: tuple[int, int]) -> Image.Image:
    """White image with a solid red block in the top-left corner, so a
    turn can be checked by where the block ends up."""
    img = Image.new("RGB", size, "white")
    for x in range(8):
        for y in range(8):
            img.putpixel((x, y), (255, 0, 0))
    return img


class TestRotateUpload:
    def test_no_turn_keeps_the_bytes(self) -> None:
        b64 = _encode(_marked((40, 20)), "JPEG")
        assert rotate_upload(b64, "image/jpeg", 0) is b64

    def test_quarter_turn_is_clockwise(self) -> None:
        # Clockwise: the top-left corner lands top-right.
        out = rotate_upload(_encode(_marked((40, 20)), "PNG"), "image/png", 90)
        assert _decode_size(out) == (20, 40)
        assert _pixel(out, (16, 3))[0] > 200  # red, top-right
        assert _pixel(out, (3, 3)) == (255, 255, 255)

    def test_turns_the_image_the_student_saw(self) -> None:
        # The preview the student rotated is EXIF-applied. A 40x20 image
        # tagged "rotate 90 CW" displays 20x40; one more clockwise quarter
        # makes it 40x20 again, upside down from the raw pixels.
        img = _marked((40, 20))
        exif = img.getexif()
        exif[0x0112] = 6
        out = rotate_upload(_encode(img, "JPEG", exif=exif), "image/jpeg", 90)
        assert _decode_size(out) == (40, 20)
        assert _pixel(out, (36, 16))[0] > 200  # raw top-left → bottom-right

    def test_a_turned_phone_photo_stays_under_the_cap(self) -> None:
        # Noisy 12 MP photo at phone quality: under the cap as sent, but a
        # high-quality re-encode used to push it to ~7 MB.
        photo = Image.effect_noise((2016, 1512), 80).resize((4032, 3024)).convert("RGB")
        sent = _encode(photo, "JPEG", quality=70)
        assert len(base64.b64decode(sent)) <= MAX_IMAGE_BYTES
        out = rotate_upload(sent, "image/jpeg", 90)
        assert len(base64.b64decode(out)) <= MAX_IMAGE_BYTES
        assert _decode_size(out)[0] < _decode_size(out)[1]  # still turned

    def test_keeps_the_colour_profile(self) -> None:
        from PIL import ImageCms

        icc = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
        out = rotate_upload(
            _encode(_marked((40, 20)), "JPEG", icc_profile=icc), "image/jpeg", 90,
        )
        with Image.open(io.BytesIO(base64.b64decode(out))) as img:
            assert img.info.get("icc_profile") == icc

    def test_refuses_a_decompression_bomb(self) -> None:
        # Tiny on the wire, 144 megapixels decoded.
        bomb = _encode(Image.new("1", (12000, 12000)), "PNG")
        assert len(base64.b64decode(bomb)) < 500_000
        with pytest.raises(ValueError, match="too large"):
            rotate_upload(bomb, "image/png", 90)
        assert page_looks_sideways(bomb) is False

    def test_unturned_pdf_keeps_the_bytes(self) -> None:
        b64 = _b64(_PDF_HEADER + b"pdf")
        assert rotate_upload(b64, "application/pdf", 0) == b64

    def test_quarter_turn_turns_every_pdf_page(self) -> None:
        pdf = pdf_of([_marked((300, 200)), _marked((300, 200))])
        turned = rotate_upload(pdf, "application/pdf", 90)
        pages = [Image.open(io.BytesIO(base64.b64decode(p))) for p in pdf_pages_as_images(turned)]
        assert [p.size[0] < p.size[1] for p in pages] == [True, True]
        # Clockwise, like a photo: the red top-left corner ends top-right.
        assert pages[0].convert("RGB").getpixel((pages[0].width - 5, 5))[1] < 80

    def test_unreadable_pdf_cant_be_turned(self) -> None:
        with pytest.raises(ValueError):
            rotate_upload(_b64(_PDF_HEADER + b"pdf"), "application/pdf", 90)


# ── page_looks_sideways (the free "looks sideways" check) ─────────────


def _page_of_writing() -> Image.Image:
    """A notebook-ish page: rows of short dark strokes (words) with
    blank gaps between lines — the structure the check keys on."""
    import random

    from PIL import ImageDraw

    rnd = random.Random(7)
    img = Image.new("L", (900, 1200), 235)
    draw = ImageDraw.Draw(img)
    for line_y in range(80, 1150, 55):
        x = 60
        while x < 820:
            word = rnd.randint(25, 90)
            for _ in range(word // 3):
                sx = x + rnd.randint(0, word)
                draw.line(
                    (sx, line_y + rnd.randint(0, 6), sx + rnd.randint(-4, 4),
                     line_y + 22 + rnd.randint(-4, 4)),
                    fill=40, width=3,
                )
            x += word + rnd.randint(15, 30)
    return img.convert("RGB")


class TestPageLooksSideways:
    def test_upright_page_is_not_sideways(self) -> None:
        assert page_looks_sideways(_encode(_page_of_writing(), "JPEG")) is False

    @pytest.mark.parametrize("turn", [90, 270])
    def test_page_on_its_side_is_sideways(self, turn: int) -> None:
        page = _page_of_writing().rotate(turn, expand=True)
        assert page_looks_sideways(_encode(page, "JPEG")) is True

    def test_upside_down_is_not_sideways(self) -> None:
        # Lines still run left to right — the check only answers
        # "sideways", which is what the nudge asks about.
        page = _page_of_writing().rotate(180)
        assert page_looks_sideways(_encode(page, "JPEG")) is False

    def test_blank_or_unreadable_is_not_sideways(self) -> None:
        assert page_looks_sideways(_encode(Image.new("RGB", (400, 600), "white"), "PNG")) is False
        assert page_looks_sideways(_b64(b"not an image")) is False


# ── PDF pages get the photo checks ────────────────────────────────────


def pdf_of(pages: list[Image.Image], dpi: float = 72) -> str:
    """A PDF made the way a scanner app makes one: each page a photo."""
    buf = io.BytesIO()
    pages[0].save(buf, format="PDF", save_all=True, append_images=pages[1:], resolution=dpi)
    return _b64(buf.getvalue())


def tablet_pdf(paper: tuple[int, int]) -> str:
    """A page the way a tablet note app exports one: a small raster
    'paper' stretched over a letter page, with the writing as vector
    strokes on top."""
    import pypdfium2 as pdfium
    import pypdfium2.raw as pdfium_c

    pdf = pdfium.PdfDocument(base64.b64decode(pdf_of([Image.new("RGB", paper, "white")], dpi=paper[0] / 8.5)))
    page = pdf[0]
    for line in range(12):
        y = 700.0 - line * 50
        stroke = pdfium_c.FPDFPageObj_CreateNewPath(72.0, y)
        for step in range(1, 20):
            pdfium_c.FPDFPath_LineTo(stroke, 72.0 + step * 20, y + (8 if step % 2 else -8))
        pdfium_c.FPDFPath_SetDrawMode(stroke, 0, True)
        pdfium_c.FPDFPage_InsertObject(page.raw, stroke)
    page.gen_content()
    buf = io.BytesIO()
    pdf.save(buf)
    return _b64(buf.getvalue())


class TestPdfScanLongEdges:
    def test_measures_the_photo_behind_each_page(self) -> None:
        pages = [Image.new("RGB", (1600, 1200), "white"), Image.new("RGB", (320, 240), "white")]
        assert pdf_scan_long_edges(pdf_of(pages)) == [1600, 320]

    def test_a_small_photo_on_a_big_page_is_still_small(self) -> None:
        # 320 px stretched over a 16-inch page renders big, reads no better.
        assert pdf_scan_long_edges(pdf_of([Image.new("RGB", (320, 240))], dpi=20)) == [320]

    def test_a_typed_page_has_no_pixel_size(self) -> None:
        import pypdfium2 as pdfium

        pdf = pdfium.PdfDocument.new()
        pdf.new_page(612, 792)
        buf = io.BytesIO()
        pdf.save(buf)
        assert pdf_scan_long_edges(_b64(buf.getvalue())) == [None]

    def test_a_worksheet_over_a_faint_background_picture_isnt_a_scan(self) -> None:
        # Typed text over a full-page 200 px background: the text is sharp,
        # so the page must not be refused for the picture's size.
        import pypdfium2 as pdfium
        import pypdfium2.raw as pdfium_c

        pdf = pdfium.PdfDocument(base64.b64decode(pdf_of([Image.new("RGB", (200, 260), "white")])))
        page = pdf[0]
        import ctypes

        text = pdfium_c.FPDFPageObj_NewTextObj(pdf.raw, b"Helvetica", 12.0)
        words = ctypes.create_string_buffer("Solve for x".encode("utf-16-le") + b"\0\0")
        pdfium_c.FPDFText_SetText(text, ctypes.cast(words, ctypes.POINTER(pdfium_c.FPDF_WCHAR)))
        pdfium_c.FPDFPage_InsertObject(page.raw, text)
        page.gen_content()
        buf = io.BytesIO()
        pdf.save(buf)
        assert pdf_scan_long_edges(_b64(buf.getvalue())) == [None]

    @pytest.mark.parametrize("paper", [(300, 388), (1, 1)])
    def test_tablet_handwriting_over_a_small_paper_picture_isnt_a_scan(
        self, paper: tuple[int, int],
    ) -> None:
        # Cold review on #957: a tablet app's page is vector strokes over a
        # small raster "paper" stretched across the page. Measured as a scan
        # it came out [388] / [1] and was refused with no way round it.
        assert pdf_scan_long_edges(tablet_pdf(paper)) == [None]

    def test_a_real_small_scan_is_still_measured(self) -> None:
        # No text, no strokes, one small photo filling the page: a scan.
        assert pdf_scan_long_edges(pdf_of([Image.new("RGB", (240, 320), "white")], dpi=30)) == [320]

    def test_unreadable_pdf_has_no_pages(self) -> None:
        assert pdf_scan_long_edges(_b64(_PDF_HEADER + b"pdf")) == []


class TestPdfPageChecks:
    def test_flags_the_sideways_page_and_previews_it(self) -> None:
        page = _page_of_writing()
        checks = pdf_page_checks(pdf_of([page, page.rotate(90, expand=True)]))
        assert checks["page_count"] == 2
        assert checks["total_pages"] == 2
        assert checks["sideways_pages"] == [2]
        assert checks["too_small_pages"] == []
        preview = Image.open(io.BytesIO(base64.b64decode(checks["preview"])))
        assert preview.width > preview.height  # page 2, as it lies

    def test_flags_a_page_too_small_to_read(self) -> None:
        page = _page_of_writing()
        checks = pdf_page_checks(pdf_of([page, page.resize((240, 320))]))
        assert checks["too_small_pages"] == [2]
        assert checks["sideways_pages"] == []
        preview = Image.open(io.BytesIO(base64.b64decode(checks["preview"])))
        assert preview.height == 640  # page 1 when nothing is sideways

    def test_renders_at_the_checks_own_size(self) -> None:
        # The reader's 2400 px would hold the PDF lock ~9x longer for the
        # same answer: the sideways check reads 800 px.
        from api.core.image_utils import _ORIENTATION_EDGE

        assert _ORIENTATION_EDGE == 800
        checks = pdf_page_checks(pdf_of([_page_of_writing()]))
        preview = Image.open(io.BytesIO(base64.b64decode(checks["preview"])))
        assert max(preview.size) == 640

    def test_a_page_that_wont_render_still_counts(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import pypdfium2 as pdfium

        page = _page_of_writing()
        pdf = pdf_of([page, page.rotate(90, expand=True), page.rotate(90, expand=True)])
        real_render = pdfium.PdfPage.render
        calls = {"n": 0}

        def flaky(self: object, *a: object, **k: object) -> object:
            calls["n"] += 1
            if calls["n"] == 2:
                raise RuntimeError("bad page")
            return real_render(self, *a, **k)  # type: ignore[arg-type]

        monkeypatch.setattr(pdfium.PdfPage, "render", flaky)
        checks = pdf_page_checks(pdf)
        # Page 2 is counted but not flagged, so the wording ("Page 3 of
        # this PDF", "only some pages") stays right.
        assert checks["page_count"] == 3
        assert checks["sideways_pages"] == [3]

    def test_unreadable_pdf_reports_nothing(self) -> None:
        assert pdf_page_checks(_b64(_PDF_HEADER + b"pdf")) == {
            "page_count": 0, "total_pages": 0,
            "sideways_pages": [], "too_small_pages": [], "preview": None,
        }

    def test_a_pdf_past_the_check_cap_counts_every_page(self) -> None:
        # The teacher gets the whole PDF, so turn-in must count all of it,
        # while the per-page answers cover only the pages checked.
        from api.core.image_utils import _PDF_MAX_PAGES

        page = _page_of_writing().resize((300, 400))
        pages = [page] * (_PDF_MAX_PAGES - 1) + [page.rotate(90, expand=True)] + [page] * 10
        checks = pdf_page_checks(pdf_of(pages))
        assert checks["total_pages"] == _PDF_MAX_PAGES + 10
        assert checks["page_count"] == _PDF_MAX_PAGES
        assert checks["sideways_pages"] == [_PDF_MAX_PAGES]


# ── pdf_pages_as_images (what the reader and the drawing check see) ──


def _corners(size: tuple[int, int]) -> Image.Image:
    """A photo with a coloured block in each corner, so a crop or a turn
    can be checked by where the blocks land: red top-left, blue
    top-right, green bottom-left, black bottom-right."""
    img = Image.new("RGB", size, "white")
    w, h, s = size[0], size[1], max(size) // 20
    for box, colour in (
        ((0, 0, s, s), (255, 0, 0)),
        ((w - s, 0, w, s), (0, 0, 255)),
        ((0, h - s, s, h), (0, 160, 0)),
        ((w - s, h - s, w, h), (0, 0, 0)),
    ):
        img.paste(colour, box)
    return img


def _add_text(pdf: object, page: object, text: str, x: float, y: float) -> None:
    import ctypes

    import pypdfium2.raw as pdfium_c

    obj = pdfium_c.FPDFPageObj_NewTextObj(pdf.raw, b"Helvetica", 9.0)  # type: ignore[attr-defined]
    wide = ctypes.create_string_buffer((text + "\0").encode("utf-16-le"))
    pdfium_c.FPDFText_SetText(obj, ctypes.cast(wide, ctypes.POINTER(pdfium_c.FPDF_WCHAR)))
    pdfium_c.FPDFPageObj_Transform(obj, 1, 0, 0, 1, x, y)
    pdfium_c.FPDFPage_InsertObject(page.raw, obj)  # type: ignore[attr-defined]


def printed_pdf(
    photo: Image.Image | None,
    *,
    at: tuple[float, float, float, float] = (74, 94, 542, 718),
    texts: tuple[tuple[str, float, float], ...] = (),
    fill: tuple[int, int, int] | None = None,
) -> str:
    """A Letter page the way Google Docs or a browser prints a photo: white
    paper under everything, the photo placed at `at` (left, bottom, right,
    top) with margins round it, and any text (print chrome, a typed line).
    `fill` instead draws a filled shape at `at` — a stand-in for a photo
    painted as a pattern fill, which pdfium shows as a plain path."""
    import pypdfium2 as pdfium
    import pypdfium2.raw as pdfium_c

    pdf = pdfium.PdfDocument.new()
    page = pdf.new_page(612, 792)

    def rect(box: tuple[float, float, float, float], rgb: tuple[int, int, int]) -> None:
        obj = pdfium_c.FPDFPageObj_CreateNewRect(box[0], box[1], box[2] - box[0], box[3] - box[1])
        pdfium_c.FPDFPageObj_SetFillColor(obj, *rgb, 255)
        pdfium_c.FPDFPath_SetDrawMode(obj, pdfium_c.FPDF_FILLMODE_ALTERNATE, False)
        pdfium_c.FPDFPage_InsertObject(page.raw, obj)

    rect((0, 0, 612, 792), (255, 255, 255))
    if photo is not None:
        image = pdfium.PdfImage.new(pdf)
        image.set_bitmap(pdfium.PdfBitmap.from_pil(photo))
        image.set_matrix(pdfium.PdfMatrix().scale(at[2] - at[0], at[3] - at[1]).translate(at[0], at[1]))
        page.insert_obj(image)
    if fill is not None:
        rect(at, fill)
    for text, x, y in texts:
        _add_text(pdf, page, text, x, y)
    page.gen_content()
    buf = io.BytesIO()
    pdf.save(buf)
    pdf.close()
    return _b64(buf.getvalue())


# What Chrome and Gmail print in the page's outer edge.
_CHROME = (("11/6/26, 9:14 PM   Gmail - homework", 20, 782), ("https://mail.google.com/   1/1", 20, 4))


def _image(b64: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")


def _is(rgb: tuple[int, ...], want: tuple[int, int, int]) -> bool:
    return all(abs(a - b) < 60 for a, b in zip(rgb, want, strict=True))


class TestPdfPagesAsImages:
    def test_a_printed_photo_is_cut_out_of_its_margins_at_its_own_resolution(self) -> None:
        [page] = pdf_pages_as_images(printed_pdf(_corners((1500, 2000)), texts=_CHROME))
        img = _image(page)
        # The photo's own pixels plus a hairline of padding — not the 2400 px
        # page, and not the ~60% of a page the photo filled there.
        assert 1500 <= img.width <= 1560 and 2000 <= img.height <= 2060
        assert _is(img.getpixel((40, 40)), (255, 0, 0))
        assert _is(img.getpixel((img.width - 40, 40)), (0, 0, 255))
        assert _is(img.getpixel((40, img.height - 40)), (0, 160, 0))
        assert _is(img.getpixel((img.width - 40, img.height - 40)), (0, 0, 0))

    def test_a_photo_painted_as_a_fill_is_cut_out_of_the_print_chrome(self) -> None:
        # Gmail's print of a photo: one filled shape (pdfium can't see the
        # pattern's picture) between a header and a footer.
        [page] = pdf_pages_as_images(
            printed_pdf(None, at=(42, 210, 582, 750), fill=(120, 120, 120), texts=_CHROME)
        )
        img = _image(page)
        assert max(img.size) == 2400
        assert abs(img.width / img.height - 1) < 0.05  # the 540 × 540 pt shape, not the page
        assert _is(img.getpixel((img.width // 2, img.height // 2)), (120, 120, 120))

    def test_a_typed_page_keeps_all_its_text(self) -> None:
        # A student's own header half an inch down is work, not chrome.
        texts = (("Jane Doe - Period 3", 72, 750), ("1. x = 3", 72, 400), ("page 2", 300, 36))
        [page] = pdf_pages_as_images(printed_pdf(None, texts=texts))
        img = _image(page)
        assert max(img.size) == 2400
        dark = [y for y in range(img.height) if min(img.crop((0, y, img.width, y + 1)).getextrema()[0]) < 100]
        # The header and the footer line are both on the render.
        assert dark[0] < img.height * 0.1 and dark[-1] > img.height * 0.9

    def test_a_blank_page_is_rendered_whole(self) -> None:
        [page] = pdf_pages_as_images(printed_pdf(None))
        assert _image(page).size == (1855, 2400)

    def test_a_full_page_scan_is_the_scan(self) -> None:
        [page] = pdf_pages_as_images(pdf_of([_corners((1200, 1600))]))
        img = _image(page)
        assert img.size == (1200, 1600)
        assert _is(img.getpixel((20, 20)), (255, 0, 0))

    def test_a_turned_pdf_is_cut_the_same_way_then_turned(self) -> None:
        from api.core.image_utils import rotate_pdf

        pdf = printed_pdf(_corners((1500, 2000)), texts=_CHROME)
        [straight] = pdf_pages_as_images(pdf)
        for turn in (90, 180, 270):
            [page] = pdf_pages_as_images(rotate_pdf(pdf, turn))
            img = _image(page)
            want = _image(straight).rotate(-turn, expand=True)
            assert abs(img.width - want.width) <= 2 and abs(img.height - want.height) <= 2, turn
            # The same cut, turned clockwise: every corner block where the
            # turned photo has it (the red top-left ends top-right at 90°).
            for x, y in ((40, 40), (img.width - 40, 40), (40, img.height - 40), (img.width - 40, img.height - 40)):
                assert _is(img.getpixel((x, y)), want.getpixel((x, y))), (turn, x, y)
        quarter = _image(pdf_pages_as_images(rotate_pdf(pdf, 90))[0])
        assert _is(quarter.getpixel((quarter.width - 40, 40)), (255, 0, 0))

    def test_each_page_is_its_own_view(self) -> None:
        import pypdfium2 as pdfium

        photo = pdfium.PdfDocument(base64.b64decode(printed_pdf(_corners((1500, 2000)))))
        typed = pdfium.PdfDocument(base64.b64decode(printed_pdf(None, texts=(("1. x = 3", 72, 400),))))
        photo.import_pages(typed)
        buf = io.BytesIO()
        photo.save(buf)
        pages = [_image(p) for p in pdf_pages_as_images(_b64(buf.getvalue()))]
        assert pages[0].height < 2100 and max(pages[1].size) == 2400


def raw_pdf(content: str, *, pages_node: str = "", page: str = "", extra: tuple[str, ...] = ()) -> str:
    """A one-page PDF written by hand, for page trees pdfium's own writer
    never makes: boxes inherited from the pages node, annotations."""
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [3 0 R] /Count 1 {pages_node} >>",
        f"<< /Type /Page /Parent 2 0 R {page} /Contents 4 0 R >>",
        f"<< /Length {len(content)} >>\nstream\n{content}\nendstream",
        *extra,
    ]
    out, offsets = "%PDF-1.4\n", []
    for i, obj in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{obj}\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF"
    return _b64(out.encode())


# Two black squares far apart: a cut that loses either loses work.
_TWO_SQUARES = "0 0 0 rg 100 100 20 20 re f 400 600 20 20 re f"


def _ink_box(b64: str) -> tuple[int, int, int, int] | None:
    return _image(b64).convert("L").point(lambda v: 255 if v < 128 else 0).getbbox()


class TestPdfCutKeepsTheWork:
    @pytest.mark.parametrize(
        "pages_node",
        ["/MediaBox [0 0 612 792] /CropBox [50 50 562 742]", "/MediaBox [50 50 662 842]"],
    )
    def test_a_box_inherited_from_the_page_tree(self, pages_node: str) -> None:
        [page] = pdf_pages_as_images(raw_pdf(_TWO_SQUARES, pages_node=pages_node))
        img = _image(page)
        # Both squares, at the two far corners, with only the padding round them.
        assert _ink_box(page) == pytest.approx((26, 26, img.width - 26, img.height - 26), abs=3)

    def test_an_unflattened_annotation_is_work(self) -> None:
        drawn = "0 0 0 rg 0 0 100 100 re f"
        annot = "<< /Type /Annot /Subtype /Square /Rect [450 50 550 150] /AP << /N 6 0 R >> >>"
        form = (
            f"<< /Type /XObject /Subtype /Form /BBox [0 0 100 100] /Length {len(drawn)} >>"
            f"\nstream\n{drawn}\nendstream"
        )
        [page] = pdf_pages_as_images(
            raw_pdf(_TWO_SQUARES, page="/MediaBox [0 0 612 792] /Annots [5 0 R]", extra=(annot, form))
        )
        img = _image(page)
        box = _ink_box(page)
        assert box is not None and box[2] > img.width - 40  # the annotation is the right edge

    def test_a_framed_page_keeps_its_frame(self) -> None:
        framed = "1 1 1 rg 0 0 0 RG 10 w 5 5 602 782 re B 0 0 0 rg 300 300 20 20 re f"
        [page] = pdf_pages_as_images(raw_pdf(framed, page="/MediaBox [0 0 612 792]"))
        assert _image(page).size == (1855, 2400)
