"""Shared image / file validation utilities."""

import base64
import io
from typing import Any

from PIL import Image, ImageOps

from api.core.constants import (
    MAX_IMAGE_BYTES,
    MAX_PDF_BYTES,
    VISION_OUTPUT_GROWTH_CEILING,
)

# Anthropic vision downscales anything past ~1568px on the long edge
# anyway, so we cap there before sending: same legibility, roughly half
# the vision-token cost. Matches the harness judge's _MAX_EDGE.
VISION_MAX_EDGE = 1568

# Shrink-to-fit, applied once the quality ladder has failed to bring a
# re-encode within VISION_OUTPUT_GROWTH_CEILING of its source size. Each
# step takes 12% off the long edge, which is ~23% of the area, so eight
# steps can remove ~87% — enough for the ceiling to be reachable rather
# than merely usually reached.
#
# The floor was 900px and the attempts 4, on the reasoning that an image
# that small "cannot threaten the request budget anyway". That was the
# same anti-correlation assumption that had already been wrong twice,
# and it was wrong again: a sub-floor image skipped enforcement
# entirely and grew up to 2.7x (a 900px q10 noisy JPEG), so nine of them
# beside a PDF filling the cap assembled 32.9MB against a 31MB budget —
# a fully legal submission refused as unreadable after acceptance.
#
# 320px is now a legibility floor and nothing else. Nothing is allowed
# to depend on the floor being unreachable — measured across the
# pathological cases, convergence takes 2-4 shrinks and lands between
# roughly 300 and 700px, so the smallest of those reaches the floor and
# breaks out still over the ceiling. That is safe on its own terms (an
# image that small cannot threaten the budget, asserted directly by
# test_small_images_are_not_exempt_from_the_growth_ceiling) rather than
# because the floor is never touched.
_SHRINK_STEP = 0.88
_SHRINK_ATTEMPTS = 8
_SHRINK_FLOOR_EDGE = 320

# Keys Pillow will carry from a decoded image's `.info` back into the
# re-encoded file, and which can describe the photographer or the
# capture device rather than the picture. Everything else in `.info` is
# dropped by the save anyway.
#
# `icc_profile` is in here despite being colour data. It is an
# arbitrary-length blob whose `desc` tag routinely names the scanner or
# camera model, and Pillow only carries it back on the PNG path
# (`PngImagePlugin._save` reads it from `im.info`; `JpegImagePlugin`
# reads it from `encoderinfo` only). So keeping it would have meant a
# PNG scan naming its flatbed while the identical JPEG did not — an
# inconsistency, not a decision. Colour rendering of a handwriting
# photo does not depend on it.
_METADATA_INFO_KEYS = frozenset({"comment", "exif", "xmp", "icc_profile"})

# One threshold governs both remedies, and it is the ceiling the size
# derivation depends on. There used to be a second, looser one here
# (1.05) meant to spare an image a quality step for a small overage —
# but the shrink below still fired at 1.02, so an image inflating 1.03x
# skipped the gentle q82 rung and took a q70 save PLUS a 12% resolution
# cut instead. The gate did not avoid the quality loss; it relocated it
# and made it worse. With a single threshold the two remedies apply in
# order of harm: re-compress first, resize only if that wasn't enough.
_REMEDY_TRIGGER_RATIO = VISION_OUTPUT_GROWTH_CEILING

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

    EVERY image is re-encoded, deliberately, because the save is also
    the only thing that scrubs metadata: `img.save` is never handed an
    `exif=`/`xmp=`/`pnginfo=`, so whatever the camera or scanner wrote
    is dropped on the way out. These are photographs taken by minors,
    and the destination is a third-party processor.

    There used to be a passthrough here that skipped the re-encode when
    the image needed neither rotation nor downscaling, to save the bytes
    a re-encode can add. It was gated on `getexif()` being empty — and
    that is not a test for "carries no metadata". `Image.getexif()` reads
    only the Exif container; it never sees JPEG APP1-XMP, APP13/IPTC, the
    COM marker, or PNG tEXt/iTXt/zTXt. Scan apps routinely strip the Exif
    IFD while writing GPS and device identity into XMP, so the
    passthrough forwarded a student's coordinates verbatim while its own
    comment claimed to be preventing exactly that.

    Enumerating every container Pillow might not surface is a losing
    game, so the optimisation is gone rather than patched. Its original
    justification is gone too: re-encoding used to be able to inflate an
    image badly (+37% on line art), but the quality ladder and
    shrink-to-fit below now bound output at
    VISION_OUTPUT_GROWTH_CEILING of the input regardless. The cost of
    always re-encoding is CPU, and nothing else.

    Only `image/*` is transformed; PDFs and unknown media types are returned
    unchanged (the document path must not be re-encoded as a flat image).

    An `image/*` that cannot be re-encoded RAISES rather than falling
    back to the input bytes. The fallback used to return them untouched
    so "a quirky-but-valid image still reaches the model" — but since
    the save is the only thing that scrubs metadata, that path shipped
    GPS and device identity verbatim on exactly the inputs least likely
    to be scrutinised. It was the passthrough hole again, wearing an
    `except`.

    Refusing is the better trade in both directions: an image Pillow
    cannot re-encode (truncated upload, decompression bomb) is one
    Vision would likely fail to read anyway, and the caller already has
    a teacher-visible path for work that could not be read, whereas a
    leak has no path back.

    Returns base64 of the same media_type / format.
    Raises ValueError if an image cannot be safely re-encoded.
    """
    if not media_type.startswith("image/"):
        return data_base64
    try:
        raw = base64.b64decode(data_base64)
        with Image.open(io.BytesIO(raw)) as opened:
            img = ImageOps.exif_transpose(opened)
            # The save drops metadata by default because it is never
            # handed `exif=`/`xmp=`/`pnginfo=` — with one exception:
            # Pillow reads `comment` back out of `im.info` and writes it
            # to the JPEG COM marker. So a comment survives a re-encode
            # that strips everything else, and `exif_transpose` carries
            # `.info` across.
            #
            # Enumerating keys is what failed in the old passthrough, but
            # the shape is inverted here and that is what makes it safe:
            # there, a container we forgot was forwarded wholesale;
            # here, the default is to drop, and we name only the few keys
            # that would otherwise be carried BACK. Rendering-relevant
            # entries (icc_profile, transparency, dpi) are deliberately
            # left alone — they are not metadata about the photographer.
            for key in _METADATA_INFO_KEYS:
                img.info.pop(key, None)
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
                if len(buf.getvalue()) <= len(raw) * _REMEDY_TRIGGER_RATIO:
                    break
                retry = io.BytesIO()
                img.save(retry, format=fmt, **options)
                if len(retry.getvalue()) < len(buf.getvalue()):
                    buf = retry
            # Hard ceiling: preprocessing must never hand back MORE bytes
            # than it was given. The ladder alone does not guarantee that
            # — a heavily-noised low-quality JPEG re-encodes 1.4-2.1x
            # larger even at the floor rung, because rotating noise
            # destroys the correlation its original quantisation
            # exploited.
            #
            # Without this ceiling the caller has to *budget* for growth,
            # and no static budget is safe: a legal 10-file submission
            # could assemble past Anthropic's request cap and be refused
            # as unreadable AFTER the server accepted it. Shrinking a
            # little is a far better trade — Anthropic downscales to
            # ~1568px regardless, so a few percent off a rotated page
            # costs nothing the model would have used.
            for _ in range(_SHRINK_ATTEMPTS):
                if len(buf.getvalue()) <= len(raw) * _REMEDY_TRIGGER_RATIO:
                    break
                if max(img.size) <= _SHRINK_FLOOR_EDGE:
                    # Too small to shrink further without hurting
                    # legibility. Such an image is tiny in absolute
                    # terms, so its growth cannot threaten the budget.
                    break
                img = img.resize(
                    (max(1, int(img.width * _SHRINK_STEP)),
                     max(1, int(img.height * _SHRINK_STEP))),
                    Image.Resampling.LANCZOS,
                )
                buf = io.BytesIO()
                img.save(buf, format=fmt, **_DENSE_SAVE_LADDER[fmt][-1])
            return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception as err:
        # Fail closed. See the docstring: returning `data_base64` here
        # would forward unscrubbed metadata on precisely the inputs
        # nobody looks at twice.
        raise ValueError(
            f"Could not re-encode {media_type} for vision: {err}"
        ) from err


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
