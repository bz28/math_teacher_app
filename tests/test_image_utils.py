"""Unit tests for image_utils — validators + Anthropic content-block builder."""

import base64
import io

import pytest
from PIL import Image

from api.core.constants import MAX_IMAGE_BYTES, MAX_PDF_BYTES
from api.core.image_utils import (
    VISION_MAX_EDGE,
    preprocess_image_for_vision,
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
