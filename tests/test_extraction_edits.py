"""Unit tests for the student-edit overlay helper.

Covers the pure-function behavior of api.core.extraction_edits:
- Apply edits replaces text and clears the matching latex/answer_latex.
- Empty-string edits drop the row entirely (deletion semantics).
- Stale or fabricated keys are dropped on validate.
- Original extraction is never mutated (the function returns a new dict).
"""

from __future__ import annotations

import pytest

from api.core.extraction_edits import (
    apply_extraction_edits,
    validate_edits_against_extraction,
)


@pytest.fixture
def extraction() -> dict:
    return {
        "steps": [
            {"step_num": 1, "problem_position": 1, "latex": "x=5", "plain_english": "x equals five"},
            {"step_num": 2, "problem_position": 1, "latex": "y=10", "plain_english": ""},
            {"step_num": 1, "problem_position": 2, "latex": "", "plain_english": "let n be the number"},
            # Unattributed scratchwork — no problem_position
            {"step_num": 99, "problem_position": None, "latex": "", "plain_english": "scratch"},
        ],
        "final_answers": [
            # Math answer: Vision populates answer_latex, narration in plain.
            {"problem_position": 1, "answer_latex": "5", "answer_plain": "five"},
            # Text answer (e.g. word problem) — Vision populates only plain.
            {"problem_position": 2, "answer_latex": "", "answer_plain": "16 apples"},
        ],
        "confidence": 0.9,
    }


def test_apply_edits_routes_math_step_to_latex(extraction):
    # Step 1:1 has populated `latex`, so the student's edit replaces
    # the latex source — not the plain-English narration. This keeps
    # the student-facing display rendering as math after edit and
    # avoids putting student-typed text into the field meant for
    # AI-written descriptions.
    edits = {"1:1": "x = 5/2"}
    out = apply_extraction_edits(extraction, edits)
    assert out is not None
    edited = out["steps"][0]
    assert edited["latex"] == "x = 5/2"
    assert edited["plain_english"] == ""
    # Other steps unchanged
    assert out["steps"][1] == extraction["steps"][1]


def test_apply_edits_routes_text_step_to_plain_english(extraction):
    # Step 2:1 has empty `latex` and only `plain_english` (the "let n
    # be the number" pattern Vision uses for non-math prose). The
    # edit replaces plain_english because that's the source field.
    edits = {"2:1": "let n be the number of apples"}
    out = apply_extraction_edits(extraction, edits)
    assert out is not None
    edited = next(
        s for s in out["steps"]
        if s["problem_position"] == 2 and s["step_num"] == 1
    )
    assert edited["plain_english"] == "let n be the number of apples"
    assert edited["latex"] == ""


def test_apply_edits_routes_math_final_answer_to_latex(extraction):
    # Final answer 1 has populated answer_latex — edit replaces it.
    out = apply_extraction_edits(extraction, {"1:final": "5/2"})
    assert out is not None
    fa = out["final_answers"][0]
    assert fa["answer_latex"] == "5/2"
    assert fa["answer_plain"] == ""


def test_apply_edits_routes_text_final_answer_to_plain(extraction):
    # Final answer 2 has empty answer_latex — edit replaces plain.
    out = apply_extraction_edits(extraction, {"2:final": "16 apples"})
    assert out is not None
    fa = out["final_answers"][1]
    assert fa["answer_plain"] == "16 apples"
    assert fa["answer_latex"] == ""


def test_empty_edit_deletes_step(extraction):
    out = apply_extraction_edits(extraction, {"1:1": ""})
    assert out is not None
    # First step (1:1) is dropped; the rest remain.
    assert all(
        not (s.get("problem_position") == 1 and s.get("step_num") == 1)
        for s in out["steps"]
    )
    assert len(out["steps"]) == len(extraction["steps"]) - 1


def test_empty_edit_deletes_final_answer(extraction):
    out = apply_extraction_edits(extraction, {"1:final": "   "})
    assert out is not None
    # Only problem 2's final answer remains.
    assert len(out["final_answers"]) == 1
    assert out["final_answers"][0]["problem_position"] == 2


def test_no_edits_returns_original_shape(extraction):
    out = apply_extraction_edits(extraction, None)
    assert out is extraction
    out = apply_extraction_edits(extraction, {})
    assert out is extraction


def test_apply_does_not_mutate_input(extraction):
    snapshot = {
        "steps": [dict(s) for s in extraction["steps"]],
        "final_answers": [dict(fa) for fa in extraction["final_answers"]],
    }
    apply_extraction_edits(extraction, {"1:1": "edited", "2:final": "16"})
    assert [dict(s) for s in extraction["steps"]] == snapshot["steps"]
    assert [dict(fa) for fa in extraction["final_answers"]] == snapshot["final_answers"]


def test_validate_drops_stale_keys(extraction):
    edits = {
        "1:1": "good",
        "1:99": "no such step",
        "5:final": "no such problem",
        "garbage-key": "ignored",
    }
    sanitized = validate_edits_against_extraction(extraction, edits)
    assert sanitized == {"1:1": "good"}


def test_validate_strips_whitespace(extraction):
    sanitized = validate_edits_against_extraction(extraction, {"1:1": "  x=2  "})
    assert sanitized == {"1:1": "x=2"}


def test_validate_drops_non_string_values(extraction):
    sanitized = validate_edits_against_extraction(extraction, {"1:1": 42})
    assert sanitized == {}


def test_apply_with_none_extraction():
    assert apply_extraction_edits(None, {"1:1": "x"}) is None


def test_apply_silently_drops_bad_keys(extraction):
    # Defense in depth: the confirm endpoint already validates, but
    # apply must not crash on a stale key (e.g. extraction shape changed
    # after edit was stored — pre-launch this can't happen, but the
    # helper shouldn't trust its inputs).
    out = apply_extraction_edits(extraction, {"99:99": "x", "1:1": "fixed"})
    assert out is not None
    # Step 1:1 has latex in the fixture, so the edit lands in latex.
    assert out["steps"][0]["latex"] == "fixed"
