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
            {"problem_position": 1, "answer_latex": "5", "answer_plain": "five"},
            {"problem_position": 2, "answer_latex": "16", "answer_plain": ""},
        ],
        "confidence": 0.9,
    }


def test_apply_edits_replaces_step_text_and_clears_latex(extraction):
    edits = {"1:1": "x = 5/2"}
    out = apply_extraction_edits(extraction, edits)
    assert out is not None
    edited = out["steps"][0]
    assert edited["plain_english"] == "x = 5/2"
    assert edited["latex"] == ""
    # Other steps unchanged
    assert out["steps"][1] == extraction["steps"][1]


def test_apply_edits_replaces_final_answer_and_clears_latex(extraction):
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
    assert out["steps"][0]["plain_english"] == "fixed"
