"""Extract problems from images using Claude Vision."""

import base64
import logging

from api.core.llm_client import LLMMode, call_claude_vision
from api.core.subjects import Subject, get_config

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5MB after decode

_EXTRACT_TEMPLATE = """Extract all {problems_noun} from this image.

Rules:
- Return each problem as plain text (not LaTeX)
- If problems are numbered, strip the number prefix (e.g. "1." or "a)")
- For word problems, include the full text
- Only include {problems_noun} — ignore instructions, headers, or unrelated text
- If you cannot read something clearly, skip it rather than guessing

Return valid JSON in this exact format:
{{"problems": ["problem 1", "problem 2", ...], "confidence": "high"}}

Set confidence to:
- "high" if the image is clear and you're confident in all extractions
- "medium" if some parts are unclear but most problems are readable
- "low" if the image is blurry, cut off, or hard to read
"""


def _build_extract_prompt(subject: str) -> str:
    cfg = get_config(subject)
    return _EXTRACT_TEMPLATE.format(problems_noun=cfg["problems_noun"])


async def extract_problems_from_image(
    image_base64: str,
    *,
    user_id: str | None = None,
    subject: str = Subject.MATH,
) -> dict[str, object]:
    """Extract problems from a base64-encoded image.

    Returns dict with 'problems' (list[str]) and 'confidence' (str).
    """
    # Validate image size
    try:
        raw = base64.b64decode(image_base64)
    except Exception as err:
        raise ValueError("Invalid base64 image data") from err

    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError(
            f"Image too large: {len(raw) / 1024 / 1024:.1f}MB (max 5MB)"
        )

    # Detect media type from magic bytes
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        media_type = "image/png"
    elif raw[:2] == b"\xff\xd8":
        media_type = "image/jpeg"
    else:
        raise ValueError("Unsupported image format (only JPEG and PNG are accepted)")

    user_content: list[dict[str, object]] = [
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": image_base64,
            },
        },
        {
            "type": "text",
            "text": _build_extract_prompt(subject),
        },
    ]

    result = await call_claude_vision(user_content, mode=LLMMode.IMAGE_EXTRACT, user_id=user_id)

    problems = result.get("problems", [])
    confidence = result.get("confidence", "medium")

    if not isinstance(problems, list):
        raise ValueError("Invalid extraction result format")

    # Clamp confidence to valid values
    if confidence not in ("high", "medium", "low"):
        confidence = "medium"

    return {"problems": problems, "confidence": confidence}
