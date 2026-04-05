"""Extract problems from images using Claude Vision."""

import logging

from api.core.image_utils import validate_and_decode_image
from api.core.llm_client import LLMMode, call_claude_vision
from api.core.llm_schemas import IMAGE_EXTRACT_SCHEMA
from api.core.subjects import Subject, get_config

logger = logging.getLogger(__name__)

_EXTRACT_TEMPLATE = """Extract all {problems_noun} from this image.

Rules:
- For mathematical expressions, use LaTeX with $ delimiters for inline math
  and $$ for display math. Examples:
  - Inline: "Solve $x^2 + 2x + 1 = 0$"
  - Matrix: "Find the determinant of $\\begin{{pmatrix}} 1 & 2 \\\\ 3 & 4 \\end{{pmatrix}}$"
  - Fraction: "Evaluate $\\frac{{d}}{{dx}} x^3$"
- For word problems, include the full text with any math in $ delimiters
- Only include {problems_noun} — ignore instructions, headers, or unrelated text
- If the image includes a diagram, figure, graph, geometric shape, molecular structure,
  circuit, or any visual element, describe it in detail in brackets at the end of the
  problem text. Include: every shape, label, measurement, angle, direction, connection,
  position, and spatial relationship. Be detailed enough that someone could recreate
  the diagram from the description alone.
  e.g. "[Right triangle ABC: vertex A at top-left, B at bottom-left, C at bottom-right.
  Side AB (vertical) = 3cm, side BC (horizontal) = 4cm, hypotenuse AC labeled 'c'.
  Right angle marker at B.]"
- For graphs, describe the axes, scale, and any plotted points or curves in detail
- If you cannot read something clearly, skip it rather than guessing

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
    _, media_type = validate_and_decode_image(image_base64)

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

    result = await call_claude_vision(
        user_content, mode=LLMMode.IMAGE_EXTRACT,
        tool_schema=IMAGE_EXTRACT_SCHEMA, user_id=user_id,
    )

    problems = result.get("problems", [])
    confidence = result.get("confidence", "medium")

    if not isinstance(problems, list):
        raise ValueError("Invalid extraction result format")

    # Clamp confidence to valid values
    if confidence not in ("high", "medium", "low"):
        confidence = "medium"

    return {"problems": problems, "confidence": confidence}
