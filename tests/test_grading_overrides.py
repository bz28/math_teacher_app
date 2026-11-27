"""Unit tests for the AI-grading override detection + direction math.

The admin "AI Grading Quality" report is only as trustworthy as this
pure layer: what counts as an override, which submissions are excluded,
and whether the direction (too-harsh vs too-generous) has the right sign.
These tests lock the edge cases — no-AI grade, unreadable skip, identical
breakdown, a sub-tolerance nudge, a length mismatch.
"""

from api.services.grading_overrides import (
    OVERRIDE_PERCENT_TOLERANCE,
    ProblemDelta,
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


def test_position_is_the_ais_recorded_problem_position() -> None:
    # The case file anchors on `#p{problem_position}`; a drill-in link
    # must land on the problem the AI recorded, not its list index.
    deltas = compare_grade(
        _ai(
            {**_g("zero", 0), "problem_position": 3},
            {**_g("full", 100), "problem_position": 7},
        ),
        [_g("full", 100), _g("full", 100)],
    )
    assert deltas is not None
    assert [d.position for d in deltas] == [3, 7]


def test_position_falls_back_to_list_place_when_unrecorded() -> None:
    # Missing, null, non-int, bool and non-positive positions all fall
    # back to the entry's 1-based place in the order-preserving list.
    bad = [None, "2", True, 0]
    deltas = compare_grade(
        _ai(_g("zero", 0), *({**_g("zero", 0), "problem_position": b} for b in bad)),
        [_g("full", 100)] * 5,
    )
    assert deltas is not None
    assert [d.position for d in deltas] == [1, 2, 3, 4, 5]


def _t(status: str, percent: float, problem_id: str) -> dict:
    return {**_g(status, percent), "problem_id": problem_id}


def test_teacher_entry_names_the_problem_and_shifted_pairs_are_skipped() -> None:
    # The grader kept a grade for position 9 (not on the assignment) and
    # skipped problem 2, so the teacher list reads p1, p3, then p2's
    # appended zero. Index pairing would compare p9's AI grade with p3's
    # teacher grade and p3's with p2's — and link them to the wrong
    # problem. With the assignment's order, only the true pair counts.
    positions = {"p1": 1, "p2": 2, "p3": 3}
    deltas = compare_grade(
        _ai(
            {**_g("zero", 0), "problem_position": 1},
            {**_g("full", 100), "problem_position": 9},
            {**_g("full", 100), "problem_position": 3},
        ),
        [_t("full", 100, "p1"), _t("full", 100, "p3"), _t("zero", 0, "p2")],
        positions,
    )
    assert deltas is not None
    assert [(d.position, d.ai_status, d.final_status) for d in deltas] == [(1, "zero", "full")]


def test_teacher_position_stands_when_the_ai_recorded_none() -> None:
    deltas = compare_grade(
        _ai(_g("zero", 0), _g("zero", 0)),
        [_t("full", 100, "b"), _t("full", 100, "a")],
        {"a": 4, "b": 6},
    )
    assert deltas is not None
    assert [d.position for d in deltas] == [6, 4]


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
    # Was "balanced", which is what let the console announce "AI grades
    # are well-calibrated" over an empty table. Nothing compared is not a
    # verdict about calibration, and the direction now says so.
    assert summary["direction"] == "unmeasured"


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


# ── A verdict needs evidence ─────────────────────────────────────────


def test_no_overrides_is_unmeasured_not_balanced() -> None:
    """The page said "AI grades are well-calibrated" from an empty set.

    Zero overrides makes the mean delta trivially 0.0, and the old code
    read that as balanced — so the console announced the AI was
    well-calibrated when the truth was that nobody had checked it. On the
    one surface whose job is to be trustworthy, that is the worst
    possible failure: a confident claim with no evidence behind it.
    """
    # Two problems, both graded, neither overridden.
    agreed = [
        ProblemDelta("full", "full", 100.0, 100.0, 0.0, False, 1),
        ProblemDelta("partial", "partial", 60.0, 60.0, 0.0, False, 1),
    ]
    out = summarize(agreed)
    assert out["overridden_problems"] == 0
    assert out["mean_delta"] == 0.0
    assert out["direction"] == "unmeasured"


def test_real_agreement_is_still_balanced() -> None:
    """The guard must not swallow the genuine case. Overrides that cancel
    out ARE evidence of calibration — a teacher raised one problem and
    lowered another by the same amount, and the AI came out even."""
    cancelling = [
        ProblemDelta("partial", "partial", 50.0, 60.0, 10.0, True, 1),
        ProblemDelta("partial", "partial", 60.0, 50.0, -10.0, True, 1),
    ]
    out = summarize(cancelling)
    assert out["overridden_problems"] == 2
    assert out["mean_delta"] == 0.0
    assert out["direction"] == "balanced"
