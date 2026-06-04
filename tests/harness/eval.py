"""Evaluation — the two-tier signal on each generated figure.

Tier 1 (free, deterministic): the probe's own objective checks (renders,
consistent, well-formed) plus the page-level facts captured by the browser
(figure overflow, console errors).

Tier 2 (sampled, cheap): an LLM judge looks at the rendered card screenshot
and scores it against the probe's rubric. Runs via call_claude_vision on
Haiku, so it is cassette-cached like every other LLM call — $0 on replay.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass, field

from api.core.llm_client import MODEL_HAIKU, LLMMode, call_claude_vision
from api.core.llm_schemas import ToolSchema
from tests.harness.types import CardCapture, JudgeRubric


@dataclass
class JudgeScore:
    scores: dict[str, int] = field(default_factory=dict)
    rationale: str = ""

    @property
    def mean(self) -> float:
        return round(sum(self.scores.values()) / len(self.scores), 2) if self.scores else 0.0


def _build_judge_schema(dimensions: list[str]) -> ToolSchema:
    """A forced-tool schema with an integer 1-5 per rubric dimension plus a
    short rationale, so the judge returns structured, parseable scores."""
    props: dict[str, object] = {
        dim: {
            "type": "integer",
            "minimum": 1,
            "maximum": 5,
            "description": f"score 1-5 for {dim}",
        }
        for dim in dimensions
    }
    props["rationale"] = {
        "type": "string",
        "description": "one sentence citing the biggest issue, or 'no issues'",
    }
    return {
        "name": "score_figure",
        "description": "Score a rendered geometry figure card.",
        "input_schema": {
            "type": "object",
            "properties": props,
            "required": [*dimensions, "rationale"],
        },
    }


async def judge_card(capture: CardCapture, rubric: JudgeRubric) -> JudgeScore | None:
    """Score one card screenshot with the Haiku vision judge. Returns None
    when there's no image to judge."""
    if capture.png is None:
        return None
    b64 = base64.b64encode(capture.png).decode("ascii")
    user_content = [
        {
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": b64},
        },
        {
            "type": "text",
            "text": (
                f"{rubric.instructions}\n\n"
                f"Question text shown on the card:\n{capture.problem_text or '(none)'}"
            ),
        },
    ]
    result = await call_claude_vision(
        user_content,
        LLMMode.JUDGE,
        tool_schema=_build_judge_schema(rubric.dimensions),
        model=MODEL_HAIKU,
        max_tokens=512,
    )
    scores: dict[str, int] = {}
    for dim in rubric.dimensions:
        value = result.get(dim)
        if isinstance(value, (int, float, str)):
            try:
                scores[dim] = int(value)
            except (TypeError, ValueError):
                pass
    rationale = str(result.get("rationale", ""))
    return JudgeScore(scores=scores, rationale=rationale)
