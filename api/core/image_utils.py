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

# EXIF tag 0x0112 — the orientation flag `ImageOps.exif_transpose` acts on.
_EXIF_ORIENTATION_TAG = 0x0112

# EXIF orientations `ImageOps.exif_transpose` actually transforms.
# Everything else (1, 0, out-of-range) leaves the pixels alone.
_TRANSPOSABLE_ORIENTATIONS = frozenset(range(2, 9))

# Modes safe to forward without a normalising re-encode. CMYK is
# excluded on purpose (Adobe APP14 inversion); so is anything
# multi-frame, checked separately.
_PASSTHROUGH_SAFE_MODES = frozenset({"RGB", "RGBA", "L", "LA", "P"})

# Retry ladder, used only when the default save came out LARGER than the
# source — which happens when the source came from a stronger encoder
# than PIL's defaults. Each step is tried in order and the smallest
# result wins. The JPEG floor is 60: below that, compression artefacts
# start eating faint pencil strokes, and an image the model can't read
# is worse than one that costs a few KB more.
_DENSE_SAVE_LADDER: dict[str, tuple[dict[str, Any], ...]] = {
    "PNG": ({"compress_level": 9, "optimize": True},),
    "JPEG": (
        {"quality": 82, "optimize": True},
        {"quality": 70, "optimize": True},
        {"quality": 60, "optimize": True},
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
            # `exif_transpose` only acts on orientations 2-8; 1, 0 and
            # out-of-range values are no-ops there, so testing for
            # "absent or 1" would re-encode an Orientation=0 image (some
            # Android stacks and EXIF strippers write it) for nothing.
            orientation = opened.getexif().get(_EXIF_ORIENTATION_TAG)
            needs_rotate = orientation in _TRANSPOSABLE_ORIENTATIONS
            # Modes/formats the save path used to normalise: CMYK JPEGs
            # carry an Adobe inversion marker that not every decoder
            # honours, and multi-frame files (APNG, MPO bursts) were
            # silently flattened to frame one. Keep re-encoding those
            # rather than newly forwarding them untouched — this early
            # return is an optimisation and must not change what the
            # model receives.
            safe_to_skip = (
                opened.mode in _PASSTHROUGH_SAFE_MODES
                and getattr(opened, "n_frames", 1) == 1
            )
            if not needs_rotate and safe_to_skip and max(opened.size) <= VISION_MAX_EDGE:
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
            for options in _DENSE_SAVE_LADDER[fmt]:
                if len(buf.getvalue()) <= len(raw):
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
