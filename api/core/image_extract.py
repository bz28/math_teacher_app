"""Extract problems from images using Claude Vision."""

import logging

from api.core.image_utils import (
    preprocess_image_for_vision,
    to_content_block,
    validate_and_decode_image,
)
from api.core.llm_client import LLMMode, call_claude_vision
from api.core.llm_schemas import IMAGE_EXTRACT_SCHEMA
from api.core.prompts import load_prompt
from api.core.subjects import Subject, get_config

logger = logging.getLogger(__name__)

_EXTRACT_TEMPLATE = load_prompt("image_extract")


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
    _, media_type = validate_and_decode_image(image_base64)
    # EXIF-orient + downscale before Vision reads it (phone photos arrive
    # sideways otherwise).
    image_base64 = preprocess_image_for_vision(image_base64, media_type)

    user_content: list[dict[str, object]] = [
        to_content_block(media_type, image_base64),
        {
            "type": "text",
            "text": _build_extract_prompt(subject),
        },
    ]

    result = await call_claude_vision(
        user_content, mode=LLMMode.IMAGE_EXTRACT,
        tool_schema=IMAGE_EXTRACT_SCHEMA, user_id=user_id,
        prompt_ids=("image_extract",),
    )

    problems = result.get("problems", [])
    confidence = result.get("confidence", "medium")

    if not isinstance(problems, list):
        raise ValueError("Invalid extraction result format")

    # Clamp confidence to valid values
    if confidence not in ("high", "medium", "low"):
        confidence = "medium"

    return {"problems": problems, "confidence": confidence}
