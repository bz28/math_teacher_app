"""Truth-table tests for the Mastery Loop state machine.

Pure unit tests — no DB, no HTTP. The full set of meaningful
trajectories a student can walk through a single problem on:

  cold_correct, cold_wrong_then_correct, cold_wrong_then_walk_then_correct,
  walk_then_correct, walk_then_wrong_then_correct, attempted_idempotent,
  mastered_sticky, walkthrough_idempotent.

Each test starts from `MasterySnapshot.initial()` and applies events
one by one, asserting state + key column transitions. The intent is
that anything that changes the truth table will fail one of these.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from api.models.student_problem_mastery import (
    STATE_ATTEMPTED,
    STATE_MASTERED,
    STATE_MISSED,
    STATE_NOT_STARTED,
    STATE_WALKED_THROUGH,
)
from api.services.mastery import MasterySnapshot, apply_event

T0 = datetime(2026, 5, 20, 12, 0, 0, tzinfo=UTC)


def at(seconds: int) -> datetime:
    return T0 + timedelta(seconds=seconds)


def test_cold_correct_is_mastered() -> None:
    """The defining mastery path: first interaction is a correct
    answer, no walkthrough."""
    snap = MasterySnapshot.initial()
    after = apply_event(snap, "answer_correct", at(0))

    assert after.state == STATE_MASTERED
    assert after.attempts == 1
    assert after.first_attempt_was_correct is True
    assert after.first_attempt_at == at(0)
    assert after.last_correct_at == at(0)
    assert after.walkthrough_opened_at is None


def test_cold_wrong_is_missed() -> None:
    snap = MasterySnapshot.initial()
    after = apply_event(snap, "answer_wrong", at(0))

    assert after.state == STATE_MISSED
    assert after.attempts == 1
    assert after.first_attempt_was_correct is False
    assert after.last_correct_at is None


def test_cold_wrong_then_correct_lands_attempted_not_mastered() -> None:
    """Wrong, then correct — first attempt is gone, can't be mastered."""
    snap = MasterySnapshot.initial()
    s1 = apply_event(snap, "answer_wrong", at(0))
    s2 = apply_event(s1, "answer_correct", at(60))

    assert s2.state == STATE_ATTEMPTED
    assert s2.attempts == 2
    assert s2.first_attempt_was_correct is False
    assert s2.last_correct_at == at(60)


def test_walkthrough_first_then_correct_lands_attempted_not_mastered() -> None:
    """Opening the walkthrough first permanently disqualifies the
    mastery line, even on a correct answer."""
    snap = MasterySnapshot.initial()
    s1 = apply_event(snap, "walkthrough_opened", at(0))

    assert s1.state == STATE_WALKED_THROUGH
    assert s1.walkthrough_opened_at == at(0)

    s2 = apply_event(s1, "answer_correct", at(30))
    assert s2.state == STATE_ATTEMPTED
    assert s2.attempts == 1
    assert s2.first_attempt_was_correct is True


def test_walkthrough_then_wrong_then_correct_is_attempted() -> None:
    snap = MasterySnapshot.initial()
    s1 = apply_event(snap, "walkthrough_opened", at(0))
    s2 = apply_event(s1, "answer_wrong", at(10))
    assert s2.state == STATE_ATTEMPTED
    s3 = apply_event(s2, "answer_correct", at(20))
    assert s3.state == STATE_ATTEMPTED
    assert s3.attempts == 2
    assert s3.last_correct_at == at(20)


def test_mastered_is_sticky_even_on_subsequent_wrong() -> None:
    """A student returning later and missing the problem doesn't
    lose mastery — once cold-correct, always mastered."""
    snap = MasterySnapshot.initial()
    s1 = apply_event(snap, "answer_correct", at(0))
    assert s1.state == STATE_MASTERED

    s2 = apply_event(s1, "answer_wrong", at(86400))
    assert s2.state == STATE_MASTERED
    assert s2.attempts == 2
    # last_correct_at unchanged on the wrong follow-up.
    assert s2.last_correct_at == at(0)
    # last_attempt_at advances.
    assert s2.last_attempt_at == at(86400)


def test_mastered_walkthrough_just_stamps_timestamp() -> None:
    """A mastered student peeking at the walkthrough out of curiosity
    is not failure — record the timestamp, don't demote."""
    snap = MasterySnapshot.initial()
    s1 = apply_event(snap, "answer_correct", at(0))
    s2 = apply_event(s1, "walkthrough_opened", at(60))
    assert s2.state == STATE_MASTERED
    assert s2.walkthrough_opened_at == at(60)


def test_walkthrough_is_idempotent() -> None:
    """Re-opening a walkthrough already opened doesn't move the
    timestamp forward and doesn't change state."""
    snap = MasterySnapshot.initial()
    s1 = apply_event(snap, "walkthrough_opened", at(0))
    s2 = apply_event(s1, "walkthrough_opened", at(60))
    assert s2.state == STATE_WALKED_THROUGH
    assert s2.walkthrough_opened_at == at(0)  # NOT at(60)


def test_attempted_is_a_stable_resting_state() -> None:
    """Once attempted, subsequent answers don't push the state
    around — only timestamps + attempts update."""
    snap = MasterySnapshot.initial()
    s1 = apply_event(snap, "answer_wrong", at(0))
    s2 = apply_event(s1, "answer_correct", at(10))
    assert s2.state == STATE_ATTEMPTED

    # Re-miss after correct stays attempted.
    s3 = apply_event(s2, "answer_wrong", at(20))
    assert s3.state == STATE_ATTEMPTED
    # Re-correct stays attempted.
    s4 = apply_event(s3, "answer_correct", at(30))
    assert s4.state == STATE_ATTEMPTED
    assert s4.attempts == 4


def test_first_attempt_columns_freeze_after_first_event() -> None:
    """first_attempt_at + first_attempt_was_correct must be set
    once and never overwritten — they encode the mastery line."""
    snap = MasterySnapshot.initial()
    s1 = apply_event(snap, "answer_wrong", at(0))
    s2 = apply_event(s1, "answer_correct", at(60))
    s3 = apply_event(s2, "answer_correct", at(120))

    assert s1.first_attempt_at == at(0)
    assert s1.first_attempt_was_correct is False
    assert s2.first_attempt_at == at(0)
    assert s2.first_attempt_was_correct is False
    assert s3.first_attempt_at == at(0)
    assert s3.first_attempt_was_correct is False


def test_initial_snapshot_is_not_started() -> None:
    snap = MasterySnapshot.initial()
    assert snap.state == STATE_NOT_STARTED
    assert snap.attempts == 0
    assert snap.walkthrough_opened_at is None
    assert snap.first_attempt_at is None
    assert snap.last_attempt_at is None
