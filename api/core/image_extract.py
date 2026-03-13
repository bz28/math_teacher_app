"""Extract math problems from images using Claude Vision."""

import base64
import json
import logging
import re
import time
from typing import Any

from api.config import settings
from api.core.cost_tracker import cost_tracker as _cost_tracker
from api.core.llm_client import get_client
from api.core.llm_logging import fire_and_forget_persist

logger = logging.getLogger(__name__)

MODEL = settings.llm_model_sonnet
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5MB after decode

# Sonnet pricing for cost tracking
COST_PER_INPUT_TOKEN = 3.0 / 1_000_000
COST_PER_OUTPUT_TOKEN = 15.0 / 1_000_000

EXTRACT_PROMPT = """Extract all math problems from this image.

Rules:
- Return each problem as plain text (not LaTeX)
- If problems are numbered, strip the number prefix (e.g. "1." or "a)")
- For word problems, include the full text
- Only include math problems — ignore instructions, headers, or non-math text
- If you cannot read something clearly, skip it rather than guessing

Return valid JSON in this exact format:
{"problems": ["problem 1", "problem 2", ...], "confidence": "high"}

Set confidence to:
- "high" if the image is clear and you're confident in all extractions
- "medium" if some parts are unclear but most problems are readable
- "low" if the image is blurry, cut off, or hard to read
"""


async def extract_problems_from_image(image_base64: str) -> dict[str, Any]:
    """Extract math problems from a base64-encoded image.

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
        media_type = "image/jpeg"  # default fallback

    _cost_tracker.check_limit()
    client = get_client()

    start = time.monotonic()
    response = await client.messages.create(
        model=MODEL,
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {  # type: ignore[list-item]
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_base64,
                        },
                    },
                    {
                        "type": "text",
                        "text": EXTRACT_PROMPT,
                    },
                ],
            }
        ],
    )
    elapsed = time.monotonic() - start

    # Parse response
    text = response.content[0].text  # type: ignore[union-attr]
    input_tokens = response.usage.input_tokens
    output_tokens = response.usage.output_tokens

    logger.info(
        "image_extract: %.1fs, %d in / %d out tokens",
        elapsed,
        input_tokens,
        output_tokens,
    )
    logger.info("image_extract raw response: %s", text)

    # Extract JSON from response (handle markdown code blocks)
    code_block = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if code_block:
        text = code_block.group(1).strip()

    try:
        result = json.loads(text)
    except json.JSONDecodeError as err:
        logger.error("Failed to parse extraction response: %s", text)
        raise ValueError("Failed to parse extracted problems") from err

    problems = result.get("problems", [])
    confidence = result.get("confidence", "medium")

    if not isinstance(problems, list):
        raise ValueError("Invalid extraction result format")

    # Clamp confidence to valid values
    if confidence not in ("high", "medium", "low"):
        confidence = "medium"

    # Log to llm_calls table for dashboard monitoring
    latency_ms = elapsed * 1000
    cost = (input_tokens * COST_PER_INPUT_TOKEN) + (
        output_tokens * COST_PER_OUTPUT_TOKEN
    )
    _cost_tracker.add(cost)
    fire_and_forget_persist(
        model=MODEL,
        function="image_extract",
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        latency_ms=latency_ms,
        cost_usd=round(cost, 6),
        output_text=text,
    )

    return {"problems": problems, "confidence": confidence}
