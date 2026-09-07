"""Shared image / file validation utilities."""

import base64
import io
from typing import Any

from PIL import Image, ImageOps

from api.core.constants import MAX_IMAGE_BYTES, MAX_PDF_BYTES

# Anthropic vision downscales anything past ~1568px on the long edge
# anyway, so we cap there before sending: same legibility, roughly half
# the vision-token cost. Matches the harness judge's _MAX_EDGE.
VISION_MAX_EDGE = 1568

# Modes safe to forward without a normalising re-encode. CMYK is
# excluded on purpose (Adobe APP14 inversion); so is anything
# multi-frame, checked separately.
_PASSTHROUGH_SAFE_MODES = frozenset({"RGB", "RGBA", "L", "LA", "P"})

# How much inflation is tolerated before trading quality for bytes.
# Descending the ladder costs real fidelity on faint pencil, so a small
# overage is cheaper to simply accept than to compress away.
_LADDER_TRIGGER_RATIO = 1.05

# Retry ladder, used only when the default save came out materially
# LARGER than the source — which happens when the source came from a
# stronger encoder than PIL's defaults. Each step is tried in order and
# the smallest result wins. The JPEG floor is 70: extraction accuracy on
# handwriting is this system's core function, and an image the model
# reads worse is a bad trade for bytes we are not short of.
_DENSE_SAVE_LADDER: dict[str, tuple[dict[str, Any], ...]] = {
    "PNG": ({"compress_level": 9, "optimize": True},),
    "JPEG": (
        {"quality": 82, "optimize": True},
        {"quality": 70, "optimize": True},
    ),
}


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


def preprocess_image_for_vision(data_base64: str, media_type: str) -> str:
    """Bake in EXIF orientation and downscale before a vision call.

    Phone cameras record a portrait/landscape shot in the sensor's native
    orientation and store the intended rotation as an EXIF *flag* rather
    than rotating the pixels. Vision models read raw pixels and ignore the
    flag, so an un-transposed phone photo arrives sideways. `exif_transpose`
    rewrites the pixels to match the flag, then we cap the long edge at
    `VISION_MAX_EDGE`.

    An image that needs NEITHER rotation nor downscaling is returned
    untouched. Re-encoding it can only inflate it: PIL's defaults (PNG
    `compress_level=6` with no filter search, JPEG `quality=75`) are
    weaker than what scanners and phone cameras typically emit, and the
    save never compares itself against the input. Measured growth on a
    pass-through save was +37% for grayscale line art, +16% for an RGB
    worksheet, +0.5% for a realistic full-page scan. Those bytes get
    paid twice — once against Anthropic's per-request budget, once in
    vision tokens — for an image identical to the one we already had.

    Only `image/*` is transformed; PDFs and unknown media types are returned
    unchanged (the document path must not be re-encoded as a flat image).
    On any decode/transform error the input base64 is returned untouched so
    a quirky-but-valid image still reaches the model.

    Returns base64 of the same media_type / format.
    """
    if not media_type.startswith("image/"):
        return data_base64
    try:
        raw = base64.b64decode(data_base64)
        with Image.open(io.BytesIO(raw)) as opened:
            # Skip the re-encode only when it would provably change
            # nothing. Three things make that non-trivial:
            #
            #  - EXIF. Re-encoding strips it (`img.save` is never handed
            #    an `exif=`), so the save is also our only scrubbing
            #    step. Forwarding a phone photo untouched would ship
            #    camera make, model, timestamp and GPS to a third-party
            #    processor, for photographs taken by minors. Any EXIF at
            #    all — orientation included — means re-encode, which
            #    subsumes the "does it need rotating" question.
            #  - Mode. CMYK JPEGs carry an Adobe inversion marker that
            #    not every decoder honours; the save normalised them.
            #  - Frames. APNG / MPO bursts were flattened to frame one.
            #
            # The early return is a byte optimisation and must not change
            # what the model receives, nor what leaves alongside it.
            if (
                opened.mode in _PASSTHROUGH_SAFE_MODES
                and getattr(opened, "n_frames", 1) == 1
                and not opened.getexif()
                and max(opened.size) <= VISION_MAX_EDGE
            ):
                return data_base64
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
            # A rotated image still has to be re-encoded, and PIL's
            # defaults land bigger than a source written by a stronger
            # encoder — measured up to +35% against a low-quality JPEG.
            # Walk the ladder until we're back under the source size,
            # keeping the smallest. Growth here is spent twice: against
            # Anthropic's request budget and in vision tokens.
            # Only descend when the inflation is worth paying for. The
            # ladder trades image quality for bytes, and a rung costs
            # real fidelity on faint pencil — so gate it on MAGNITUDE,
            # not on sign. Without this, a 0.9% overage (a few KB against
            # a budget with megabytes of slack) drove a student's
            # handwriting down a quality step for nothing.
            for options in _DENSE_SAVE_LADDER[fmt]:
                if len(buf.getvalue()) <= len(raw) * _LADDER_TRIGGER_RATIO:
                    break
                retry = io.BytesIO()
                img.save(retry, format=fmt, **options)
                if len(retry.getvalue()) < len(buf.getvalue()):
                    buf = retry
            return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return data_base64


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
