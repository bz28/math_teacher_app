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
