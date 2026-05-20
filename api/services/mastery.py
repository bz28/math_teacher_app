"""Mastery state machine + helpers for the school-student Mastery Loop.

Single source of truth for *how* a student's persistent mastery state
on a teacher-authored bank item evolves. The truth table:

  starting state →  event             →  ending state
  ────────────────────────────────────────────────────
  any                walkthrough_opened   walked_through  (if not yet
                                          mastered/missed/attempted)
  not_started        answer_correct       mastered
  not_started        answer_wrong         missed
  walked_through     answer_correct       attempted
  walked_through     answer_wrong         attempted
  missed             answer_correct       attempted
  missed             answer_wrong         missed (unchanged)
  attempted          answer_correct       attempted (unchanged)
  attempted          answer_wrong         attempted (unchanged)
  mastered           *                    mastered  (never demoted)

Mastery is *first-try cold*: the student answered correctly on their
first attempt with no walkthrough ever opened on that problem. Once
earned, mastery is permanent — re-attempts don't downgrade it, even
if the student gets it wrong later. (V1 product decision; revisit if
mastery decay becomes useful.)

The state machine is implemented as a pure function over a row's
atomic columns plus an event, returning the new column values. This
makes it trivially testable without a DB and reusable from any caller
(endpoint, batch script, future cron).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from api.models.student_problem_mastery import (
    STATE_ATTEMPTED,
    STATE_MASTERED,
    STATE_MISSED,
    STATE_NOT_STARTED,
    STATE_WALKED_THROUGH,
)

Event = Literal["walkthrough_opened", "answer_correct", "answer_wrong"]


@dataclass(frozen=True)
class MasterySnapshot:
    """The subset of student_problem_mastery columns the state machine
    reads + writes. Endpoint code loads a row, builds this from the
    columns, applies an event, and writes the new values back."""

    state: str
    attempts: int
    walkthrough_opened_at: datetime | None
    first_attempt_at: datetime | None
    first_attempt_was_correct: bool | None
    last_attempt_at: datetime | None
    last_correct_at: datetime | None

    @classmethod
    def initial(cls) -> MasterySnapshot:
        """The implicit state of a (student, bank_item) that has never
        been touched. Endpoints compose this when no row exists, run
        the transition, and INSERT if the result actually changes."""
        return cls(
            state=STATE_NOT_STARTED,
            attempts=0,
            walkthrough_opened_at=None,
            first_attempt_at=None,
            first_attempt_was_correct=None,
            last_attempt_at=None,
            last_correct_at=None,
        )


def apply_event(
    snap: MasterySnapshot,
    event: Event,
    now: datetime,
) -> MasterySnapshot:
    """Return a new snapshot reflecting `event` applied at `now`.

    Always returns a fresh snapshot. Callers persist the result; the
    function does no I/O.
    """
    if event == "walkthrough_opened":
        return _on_walkthrough(snap, now)
    if event == "answer_correct":
        return _on_answer(snap, correct=True, now=now)
    if event == "answer_wrong":
        return _on_answer(snap, correct=False, now=now)
    raise ValueError(f"unknown mastery event: {event!r}")


def _on_walkthrough(snap: MasterySnapshot, now: datetime) -> MasterySnapshot:
    """Opening the walkthrough is observable for the rest of the
    problem's life: it permanently disqualifies first-try-cold
    mastery on a not-yet-touched row. Idempotent — re-opening a
    walkthrough already opened is a no-op on the timestamp."""
    walkthrough_opened_at = snap.walkthrough_opened_at or now

    # Don't demote a mastered row — a curious student opening the
    # walkthrough later is exploring, not failing.
    if snap.state == STATE_MASTERED:
        return _replace(snap, walkthrough_opened_at=walkthrough_opened_at)

    # not_started → walked_through. Any state that already reflects
    # an attempt (missed / attempted) is preserved; the walkthrough
    # flag just gets stamped.
    new_state = (
        STATE_WALKED_THROUGH
        if snap.state == STATE_NOT_STARTED
        else snap.state
    )
    return _replace(
        snap,
        state=new_state,
        walkthrough_opened_at=walkthrough_opened_at,
    )


def _on_answer(
    snap: MasterySnapshot, *, correct: bool, now: datetime,
) -> MasterySnapshot:
    """An answer attempt. Increments `attempts`, stamps last_*,
    captures first_attempt_* exactly once, and folds the result into
    the state field per the truth table in the module docstring."""
    # Mastered is sticky — record the attempt + last_correct_at if
    # the student returns and answers again, but never demote.
    if snap.state == STATE_MASTERED:
        return _replace(
            snap,
            attempts=snap.attempts + 1,
            last_attempt_at=now,
            last_correct_at=now if correct else snap.last_correct_at,
        )

    is_first_attempt = snap.first_attempt_at is None
    first_attempt_at = snap.first_attempt_at or now
    first_attempt_was_correct = (
        correct if is_first_attempt else snap.first_attempt_was_correct
    )

    new_state = _next_state_for_answer(snap, correct=correct)

    return _replace(
        snap,
        state=new_state,
        attempts=snap.attempts + 1,
        first_attempt_at=first_attempt_at,
        first_attempt_was_correct=first_attempt_was_correct,
        last_attempt_at=now,
        last_correct_at=now if correct else snap.last_correct_at,
    )


def _next_state_for_answer(snap: MasterySnapshot, *, correct: bool) -> str:
    """The state-only branch of the answer transition. Keeps the
    column updates and the categorical decision in separate places
    so the rule table reads cleanly."""
    walked = snap.walkthrough_opened_at is not None

    if correct:
        # The mastery line: cold first try, correct → MASTERED. The
        # `walked` check is defensive in case a concurrent walkthrough
        # update slipped in between the state read and this branch —
        # state==NOT_STARTED alone should imply no walkthrough, but
        # belt-and-suspenders keeps the invariant honest.
        if snap.state == STATE_NOT_STARTED and not walked:
            return STATE_MASTERED
        # Any other correct answer (after walkthrough, after a miss,
        # repeated correct) — durably "attempted." We don't promote
        # to mastered once the first attempt has come and gone.
        return STATE_ATTEMPTED

    # Wrong answer paths. The state field already encodes the prior
    # history we need — walkthrough flag is irrelevant for wrong:
    #   not_started → MISSED (no walkthrough possible here)
    #   walked_through → ATTEMPTED (walked then tried wrong)
    #   missed → MISSED (re-miss is still missed)
    #   attempted → ATTEMPTED (no downgrade)
    if snap.state == STATE_NOT_STARTED:
        return STATE_MISSED
    if snap.state == STATE_WALKED_THROUGH:
        return STATE_ATTEMPTED
    return snap.state


def _replace(snap: MasterySnapshot, **changes: object) -> MasterySnapshot:
    """Tiny wrapper around dataclasses.replace to avoid the import in
    every transition helper."""
    from dataclasses import replace

    return replace(snap, **changes)  # type: ignore[arg-type]
