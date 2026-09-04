"""Tests for `api.core.submission_stage` — the rule that says where a
submission stopped moving.

No database: the rule is pure, it is the risky part of the student case
file (a seven-branch ordering that two endpoints and one page depend
on), and it deserves tests that run in milliseconds and pin the
ordering explicitly.

The case that motivated the module is
`test_read_landed_but_student_never_ruled` — a student who submitted,
got a Vision read, and never pressed Confirm. Nothing downstream runs
for them, and before this the console had no word for it.
"""

from datetime import UTC, datetime

from api.core.submission_stage import (
    AWAITING_CONFIRM,
    AWAITING_EXTRACTION,
    CONFIRMED,
    EXTRACTION_OFF,
    FLAGGED,
    GRADED,
    PUBLISHED,
    STAGE_ORDER,
    extraction_is_empty,
    stage_for,
    stage_since,
)

T0 = datetime(2026, 1, 1, tzinfo=UTC)
T1 = datetime(2026, 1, 2, tzinfo=UTC)
T2 = datetime(2026, 1, 3, tzinfo=UTC)


def _stage(**over: object) -> str:
    """`stage_for` with a healthy mid-pipeline default, overridden per case."""
    base: dict[str, object] = {
        "extraction_present": False,
        "extraction_confirmed_at": None,
        "extraction_flagged_at": None,
        "graded_at": None,
        "grade_published_at": None,
        "integrity_check_enabled": True,
        "ai_grading_enabled": True,
    }
    base.update(over)
    return stage_for(**base)  # type: ignore[arg-type]


def test_read_landed_but_student_never_ruled() -> None:
    """The headline case: Vision read it, the student never signed off.

    Neither confirm stamp is set, so integrity and grading were never
    spawned. The submission looks handed-in and will never be graded.
    """
    assert _stage(extraction_present=True) == AWAITING_CONFIRM


def test_no_read_owed_when_both_toggles_off() -> None:
    """Both AI toggles off — no Vision call was ever spawned, so an
    empty trace is the product working, not a defect."""
    assert _stage(
        integrity_check_enabled=False, ai_grading_enabled=False,
    ) == EXTRACTION_OFF


def test_read_owed_but_missing_is_not_the_same_as_off() -> None:
    """One toggle on and no extraction means a read was owed and did
    not land. Same NULL as `extraction_off`, opposite meaning — this
    is the distinction the whole module exists to make."""
    assert _stage(integrity_check_enabled=True, ai_grading_enabled=False) == (
        AWAITING_EXTRACTION
    )
    assert _stage(integrity_check_enabled=False, ai_grading_enabled=True) == (
        AWAITING_EXTRACTION
    )


def test_confirmed_and_flagged_are_distinct_outcomes() -> None:
    assert _stage(
        extraction_present=True, extraction_confirmed_at=T1,
    ) == CONFIRMED
    assert _stage(
        extraction_present=True, extraction_flagged_at=T1,
    ) == FLAGGED


def test_flagged_outranks_confirmed_when_both_are_stamped() -> None:
    """The API keeps these mutually exclusive, but a backfill could
    mint a row with both. Flagged is terminal — it is what stops the
    pipeline — so it must win rather than reporting the happy path."""
    assert _stage(
        extraction_present=True,
        extraction_confirmed_at=T1,
        extraction_flagged_at=T2,
    ) == FLAGGED


def test_furthest_hop_wins() -> None:
    """A published submission reports `published`, not the hops it
    already cleared."""
    assert _stage(
        extraction_present=True,
        extraction_confirmed_at=T0,
        graded_at=T1,
    ) == GRADED
    assert _stage(
        extraction_present=True,
        extraction_confirmed_at=T0,
        graded_at=T1,
        grade_published_at=T2,
    ) == PUBLISHED


def test_grade_outranks_flag() -> None:
    """A teacher can hand-grade a flagged submission. Once they have,
    the interesting fact is the grade, not the rejected read."""
    assert _stage(
        extraction_present=True, extraction_flagged_at=T0, graded_at=T1,
    ) == GRADED


def test_every_stage_is_reachable_and_ordered() -> None:
    """STAGE_ORDER is the contract the funnel and the UI both read; a
    stage added to one without the other is the bug this catches."""
    reachable = {
        _stage(extraction_present=True, grade_published_at=T2),
        _stage(extraction_present=True, graded_at=T1),
        _stage(extraction_present=True, extraction_flagged_at=T1),
        _stage(extraction_present=True, extraction_confirmed_at=T1),
        _stage(extraction_present=True),
        _stage(),
        _stage(integrity_check_enabled=False, ai_grading_enabled=False),
    }
    assert reachable == set(STAGE_ORDER)
    assert len(STAGE_ORDER) == len(set(STAGE_ORDER))


def test_stage_since_uses_the_stamp_for_settled_stages() -> None:
    assert stage_since(
        PUBLISHED, submitted_at=T0, extraction_confirmed_at=T1,
        extraction_flagged_at=None, graded_at=T1, grade_published_at=T2,
    ) == T2
    assert stage_since(
        CONFIRMED, submitted_at=T0, extraction_confirmed_at=T1,
        extraction_flagged_at=None, graded_at=None, grade_published_at=None,
    ) == T1


def test_stage_since_falls_back_to_submitted_for_waiting_stages() -> None:
    """Nothing records when an extraction landed, so "stuck for 6 days"
    counts from submission — the honest approximation."""
    for stage in (AWAITING_CONFIRM, AWAITING_EXTRACTION, EXTRACTION_OFF):
        assert stage_since(
            stage, submitted_at=T0, extraction_confirmed_at=None,
            extraction_flagged_at=None, graded_at=None,
            grade_published_at=None,
        ) == T0


def test_stage_since_falls_back_when_the_stamp_is_missing() -> None:
    """A `graded` row whose `graded_at` is null (hand-written history)
    still needs a date to age from rather than rendering blank."""
    assert stage_since(
        GRADED, submitted_at=T0, extraction_confirmed_at=None,
        extraction_flagged_at=None, graded_at=None, grade_published_at=None,
    ) == T0


def test_extraction_is_empty_only_for_a_read_that_found_nothing() -> None:
    assert extraction_is_empty({"steps": [], "final_answers": []}) is True
    assert extraction_is_empty(
        {"steps": [], "final_answers": [], "confidence": 0.0}
    ) is True
    assert extraction_is_empty({"steps": [{"step_num": 1}]}) is False
    assert extraction_is_empty(
        {"steps": [], "final_answers": [{"problem_position": 1}]}
    ) is False
    # Null is "no read yet", which is a different finding — the caller
    # must not be able to confuse it with "the reader found nothing".
    assert extraction_is_empty(None) is False
