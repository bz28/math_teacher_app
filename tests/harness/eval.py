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

from api.core.llm_client import MODEL_HAIKU, LLMMode, call_claude_json, call_claude_vision
from api.core.llm_schemas import ToolSchema
from tests.harness.cassette import CassetteMissError
from tests.harness.types import CardCapture, GeneratedItem, JudgeRubric, JudgeScore


def _build_judge_schema(
    dimensions: list[str], *, name: str, description: str,
) -> ToolSchema:
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
        "name": name,
        "description": description,
        "input_schema": {
            "type": "object",
            "properties": props,
            "required": [*dimensions, "rationale"],
        },
    }


def _parse_scores(result: dict[str, object], dimensions: list[str]) -> JudgeScore:
    """Coerce a judge tool-call result into a JudgeScore (ints per dimension +
    rationale), tolerating a model that returns a number as a string."""
    scores: dict[str, int] = {}
    for dim in dimensions:
        value = result.get(dim)
        if isinstance(value, (int, float, str)):
            try:
                scores[dim] = int(value)
            except (TypeError, ValueError):
                pass
    return JudgeScore(scores=scores, rationale=str(result.get("rationale", "")))


async def judge_card(
    capture: CardCapture, rubric: JudgeRubric, *, probe_name: str,
) -> JudgeScore | None:
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
    try:
        result = await call_claude_vision(
            user_content,
            LLMMode.JUDGE,
            tool_schema=_build_judge_schema(
                rubric.dimensions,
                name="score_figure",
                description="Score a rendered geometry figure card.",
            ),
            model=MODEL_HAIKU,
            max_tokens=512,
            # Pin the cassette key to the card's identity, not the screenshot
            # bytes (which jitter across runs), so replay is reproducible.
            # Namespace by probe so two probes' card #0 can't collide on the
            # same cassette.
            call_metadata={
                "harness_cassette_key": (
                    f"judge:{probe_name}:{capture.item_index}:{capture.kind}"
                ),
            },
        )
    except CassetteMissError:
        # Judge cassettes are a local cache (gitignored). On a fresh checkout
        # in replay mode there's nothing to replay — the judge is advisory, so
        # skip it rather than failing the run.
        return None
    return _parse_scores(result, rubric.dimensions)


# Dimensions the text judge scores a generated problem on. Distinct from the
# vision judge's figure dimensions — these are about the MATH, not the drawing.
CORRECTNESS_DIMENSIONS = ["well_posed", "answer_correct", "steps_valid"]

_CORRECTNESS_INSTRUCTIONS = (
    "You are a meticulous math teacher grading an AI-generated practice "
    "problem. Independently SOLVE the problem yourself, then score it 1-5 "
    "(5 = perfect):\n"
    "- well_posed: is the problem unambiguous and solvable as written, with "
    "all information needed and none contradictory?\n"
    "- answer_correct: does the stated final answer match the answer YOU get "
    "when you solve it? (5 = exactly correct, 1 = wrong)\n"
    "- steps_valid: do the solution steps follow logically and arrive at the "
    "stated answer without errors or skipped justification?\n"
    "Give a one-sentence rationale naming the biggest issue, or 'no issues'."
)


async def judge_correctness(
    item: GeneratedItem, index: int, *, probe_name: str,
) -> JudgeScore | None:
    """Text judge: does the generated problem hold up mathematically? Hands the
    question + stated answer + solution steps to Haiku, which re-solves and
    scores correctness. Cassette-keyed on the item's position (stable across
    replays), namespaced by probe. Returns None on a replay cache miss."""
    steps = item.raw.get("solution_steps") or []
    step_text = "\n".join(
        f"{i + 1}. {s.get('title', '')}: {s.get('description', '')}".strip()
        for i, s in enumerate(steps)
        if isinstance(s, dict)
    )
    user_message = (
        f"{_CORRECTNESS_INSTRUCTIONS}\n\n"
        f"PROBLEM:\n{item.problem_text or '(none)'}\n\n"
        f"STATED FINAL ANSWER:\n{item.raw.get('final_answer') or '(none)'}\n\n"
        f"SOLUTION STEPS:\n{step_text or '(none)'}"
    )
    try:
        result = await call_claude_json(
            "You grade AI-generated math problems for correctness.",
            user_message,
            LLMMode.JUDGE,
            tool_schema=_build_judge_schema(
                CORRECTNESS_DIMENSIONS,
                name="score_correctness",
                description="Score an AI-generated math problem's correctness.",
            ),
            model=MODEL_HAIKU,
            max_tokens=512,
            call_metadata={
                "harness_cassette_key": f"correctness:{probe_name}:{index}",
            },
        )
    except CassetteMissError:
        return None
    return _parse_scores(result, CORRECTNESS_DIMENSIONS)
