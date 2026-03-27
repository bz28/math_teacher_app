"""Shared image validation utilities."""

import base64

MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5MB after decode


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
