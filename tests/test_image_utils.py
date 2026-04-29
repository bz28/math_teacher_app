"""Unit tests for image_utils — validators + Anthropic content-block builder."""

import base64

import pytest

from api.core.constants import MAX_IMAGE_BYTES, MAX_PDF_BYTES
from api.core.image_utils import (
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
