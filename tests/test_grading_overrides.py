"""Unit tests for the AI-grading override detection + direction math.

The admin "AI Grading Quality" report is only as trustworthy as this
pure layer: what counts as an override, which submissions are excluded,
and whether the direction (too-harsh vs too-generous) has the right sign.
These tests lock the edge cases — no-AI grade, unreadable skip, identical
breakdown, a sub-tolerance nudge, a length mismatch.
"""

from api.services.grading_overrides import (
    OVERRIDE_PERCENT_TOLERANCE,
    compare_grade,
    normalize_percent,
    status_matrix,
    summarize,
)


def _ai(*grades: dict) -> dict:
    """Build an ai_breakdown blob ({"grades": [...]}) from status/percent."""
    return {"grades": list(grades)}


def _g(status: str, percent: float) -> dict:
    return {"score_status": status, "percent": percent}


# ── normalize_percent ──────────────────────────────────────────────


def test_normalize_pins_full_and_zero_by_status() -> None:
    # A stale/unclamped percent on a full/zero grade is ignored.
    assert normalize_percent("full", 73) == 100.0
    assert normalize_percent("zero", 50) == 0.0


def test_normalize_clamps_partial_to_1_99() -> None:
    assert normalize_percent("partial", 60) == 60.0
    assert normalize_percent("partial", 0) == 1.0
    assert normalize_percent("partial", 120) == 99.0


def test_normalize_rejects_garbage() -> None:
    assert normalize_percent("partial", "abc") is None
    assert normalize_percent("mystery", 50) is None
    assert normalize_percent("partial", None) is None


# ── compare_grade: exclusion cases ─────────────────────────────────


def test_no_ai_breakdown_is_excluded() -> None:
    # A manual-only / unreadable-skip grade has no AI snapshot to override.
    assert compare_grade(None, [_g("full", 100)]) is None
    assert compare_grade({}, [_g("full", 100)]) is None
    assert compare_grade({"grades": []}, [_g("full", 100)]) is None


def test_no_teacher_breakdown_is_excluded() -> None:
    assert compare_grade(_ai(_g("full", 100)), None) is None


def test_length_mismatch_is_excluded() -> None:
    # Un-alignable — we never index across mismatched lists.
    assert compare_grade(_ai(_g("full", 100)), [_g("full", 100), _g("zero", 0)]) is None


# ── compare_grade: override detection ──────────────────────────────


def test_identical_breakdown_is_not_an_override() -> None:
    deltas = compare_grade(
        _ai(_g("full", 100), _g("partial", 60), _g("zero", 0)),
        [_g("full", 100), _g("partial", 60), _g("zero", 0)],
    )
    assert deltas is not None
    assert all(not d.is_override for d in deltas)
    assert summarize(deltas)["override_rate"] == 0.0


def test_status_change_is_an_override() -> None:
    # AI said zero, teacher raised to partial — AI too harsh on this one.
    deltas = compare_grade(_ai(_g("zero", 0)), [_g("partial", 50)])
    assert deltas is not None
    d = deltas[0]
    assert d.is_override
    assert d.delta == 50.0  # teacher raised


def test_sub_tolerance_percent_nudge_is_not_an_override() -> None:
    deltas = compare_grade(
        _ai(_g("partial", 60)),
        [_g("partial", 60 + OVERRIDE_PERCENT_TOLERANCE)],
    )
    assert deltas is not None
    assert not deltas[0].is_override


def test_percent_change_beyond_tolerance_is_an_override() -> None:
    deltas = compare_grade(_ai(_g("partial", 60)), [_g("partial", 80)])
    assert deltas is not None
    assert deltas[0].is_override
    assert deltas[0].delta == 20.0


# ── direction math ─────────────────────────────────────────────────


def test_direction_too_harsh_when_teacher_raises() -> None:
    # Across two problems the teacher raised both → AI runs too harsh.
    deltas = compare_grade(
        _ai(_g("zero", 0), _g("partial", 40)),
        [_g("partial", 50), _g("full", 100)],
    )
    summary = summarize(deltas or [])
    assert summary["direction"] == "too_harsh"
    assert summary["mean_delta"] > 0
    assert summary["raised"] == 2
    assert summary["lowered"] == 0


def test_direction_too_generous_when_teacher_lowers() -> None:
    deltas = compare_grade(
        _ai(_g("full", 100), _g("full", 100)),
        [_g("partial", 50), _g("zero", 0)],
    )
    summary = summarize(deltas or [])
    assert summary["direction"] == "too_generous"
    assert summary["mean_delta"] < 0
    assert summary["lowered"] == 2


def test_direction_balanced_when_offsetting() -> None:
    # One raised by 30, one lowered by 30 → net mean delta 0.
    deltas = compare_grade(
        _ai(_g("partial", 50), _g("partial", 50)),
        [_g("partial", 80), _g("partial", 20)],
    )
    summary = summarize(deltas or [])
    assert summary["direction"] == "balanced"
    assert summary["mean_delta"] == 0.0
    assert summary["overridden_problems"] == 2
    assert summary["raised"] == 1
    assert summary["lowered"] == 1


def test_override_rate_and_magnitude() -> None:
    # 1 of 2 problems changed (by 40 points).
    deltas = compare_grade(
        _ai(_g("full", 100), _g("partial", 50)),
        [_g("full", 100), _g("partial", 90)],
    )
    summary = summarize(deltas or [])
    assert summary["graded_problems"] == 2
    assert summary["overridden_problems"] == 1
    assert summary["override_rate"] == 50.0
    assert summary["mean_override_magnitude"] == 40.0


def test_empty_summary_is_safe() -> None:
    summary = summarize([])
    assert summary["graded_problems"] == 0
    assert summary["override_rate"] == 0.0
    assert summary["direction"] == "balanced"


# ── status matrix ──────────────────────────────────────────────────


def test_status_matrix_counts_transitions() -> None:
    deltas = compare_grade(
        _ai(_g("zero", 0), _g("zero", 0), _g("full", 100)),
        [_g("partial", 50), _g("partial", 50), _g("full", 100)],
    )
    matrix = status_matrix(deltas or [])
    # 9 cells, stable order.
    assert len(matrix) == 9
    cell = {(c["from"], c["to"]): c["count"] for c in matrix}
    assert cell[("zero", "partial")] == 2  # the two raised
    assert cell[("full", "full")] == 1  # agreement, on-diagonal
    changes = {(c["from"], c["to"]) for c in matrix if c["is_change"]}
    assert ("zero", "partial") in changes
    assert ("full", "full") not in changes
