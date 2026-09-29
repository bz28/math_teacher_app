"""Unit tests for image_utils — validators + Anthropic content-block builder."""

import base64
import io

import pytest
from PIL import Image

from api.core.constants import MAX_IMAGE_BYTES, MAX_PDF_BYTES
from api.core.image_utils import (
    VISION_MAX_EDGE,
    page_looks_sideways,
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

    def test_pdf_is_left_alone(self) -> None:
        b64 = _b64(_PDF_HEADER + b"pdf")
        assert rotate_upload(b64, "application/pdf", 90) == b64


# ── page_looks_sideways (the free "looks sideways" nudge) ─────────────


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
