"""Stubbed AI helpers for the integrity-checker pipeline.

PR 1 of 6 ships the entire integrity-check pipe — submit → extract →
generate questions → store → score → badge → teacher view — without
any real LLM calls so the state machine can be exercised at $0
cost. PR 4 will replace these three function bodies with real
Vision (extraction) and Sonnet (generation + scoring) calls. Caller
shapes are intentionally what PR 4 will need so nothing else
changes.

Hard rules these stubs encode for PR 4 to honor:
- extract_student_work: returns a dict with `steps` (list) and
  `confidence` (float 0..1). Confidence below a threshold marks the
  problem `skipped_unreadable` upstream.
- generate_questions: returns 2-3 questions, each `{question_text,
  expected_shape, rubric_hint}`. PR 4 generates 2-3 dynamically; the
  stub always returns 2 fixed.
- score_answer: returns `{verdict, reasoning, flags}` where verdict
  is one of good/weak/bad and flags is a list (currently empty for
  the stub; PR 4 will populate `vague`, `contradicts_own_work`, etc.)
"""

from __future__ import annotations

import uuid
from typing import Any


async def extract_student_work(submission_id: uuid.UUID) -> dict[str, Any]:
    """STUB. Returns a hardcoded extraction. PR 4 calls Claude
    Vision against the submitted image."""
    _ = submission_id
    return {
        "steps": [
            {"step_num": 1, "latex": "stub", "plain_english": "stubbed extraction"},
        ],
        "confidence": 0.9,
    }


def generate_questions(
    problem_text: str, extraction: dict[str, Any]
) -> list[dict[str, str]]:
    """STUB. Returns 2 hardcoded follow-ups per problem. PR 4 calls
    Sonnet with the problem text + extraction + a few-shot prompt."""
    _ = problem_text
    _ = extraction
    return [
        {
            "question_text": "What was the first step you took to solve this?",
            "expected_shape": "Brief description of an actual operation, 1-2 sentences",
            "rubric_hint": (
                "Should reference a concrete operation (factor, distribute, "
                "substitute, etc.), not 'I solved it'."
            ),
        },
        {
            "question_text": "Walk me through how you got the final answer.",
            "expected_shape": "1-2 sentences connecting their work to the answer",
            "rubric_hint": (
                "Should mention the last step or transformation, not just "
                "restate the answer."
            ),
        },
    ]


def score_answer(question: dict[str, Any], answer: str) -> dict[str, Any]:
    """STUB. Length-based heuristic — long answers score better. The
    real PR 4 scorer will call Sonnet with (question, expected_shape,
    rubric_hint, student_work, answer) and emit a structured verdict.

    A kid can game this stub by typing nonsense — that's intentional.
    The point in PR 1 is to exercise the state machine, not to
    actually judge understanding.
    """
    _ = question
    n = len(answer.strip())
    if n < 5:
        verdict = "bad"
    elif n < 30:
        verdict = "weak"
    else:
        verdict = "good"
    return {
        "verdict": verdict,
        "reasoning": f"Stub: answer length {n} chars",
        "flags": [],
    }


def rephrase_question(question: dict[str, Any]) -> str:
    """STUB. Returns one alternate phrasing. PR 4 calls Sonnet with
    the original question + a 'simpler please' instruction. The
    response endpoint marks rephrase_used=true so a kid can't loop
    forever."""
    return f"{question['question_text']} (in your own words)"
