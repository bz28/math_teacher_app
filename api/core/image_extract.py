"""Extract math problems from images using Claude Vision."""

import base64
import json
import logging
import time

from anthropic import AsyncAnthropic

from api.config import settings

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-20250514"
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5MB after decode

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


async def extract_problems_from_image(image_base64: str) -> dict:
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

    client = AsyncAnthropic(api_key=settings.claude_api_key)

    start = time.monotonic()
    response = await client.messages.create(
        model=MODEL,
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
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
                        "text": EXTRACT_PROMPT,
                    },
                ],
            }
        ],
    )
    elapsed = time.monotonic() - start

    # Parse response
    text = response.content[0].text
    input_tokens = response.usage.input_tokens
    output_tokens = response.usage.output_tokens

    logger.info(
        "image_extract: %.1fs, %d in / %d out tokens",
        elapsed,
        input_tokens,
        output_tokens,
    )

    # Extract JSON from response (handle markdown code blocks)
    if "```" in text:
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()

    try:
        result = json.loads(text)
    except json.JSONDecodeError as err:
        logger.error("Failed to parse extraction response: %s", text)
        raise ValueError("Failed to parse extracted problems") from err

    problems = result.get("problems", [])
    confidence = result.get("confidence", "medium")

    if not isinstance(problems, list):
        raise ValueError("Invalid extraction result format")

    return {"problems": problems, "confidence": confidence}
