"""What puts a submission in front of the teacher outside grading — the
"flagged" count — and which of two kinds it is.

Two different things used to share one red "Flagged":

  check    the understanding check is worth a look: the agent asked for
           review, or the conversation ended without a verdict. This
           raises scrutiny; it never says the student did anything.
  reading  the photo or the reading is the problem: the check couldn't
           read it, the AI couldn't grade it, or the student said the
           reading was wrong. Nothing about the student at all.

A blurry photo must never read as an integrity concern, so the home
queue shows the two apart. `flagged_case` (any kind) stays the one count
the dashboard, the queue, the inbox and the review page's Flagged filter
agree on.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import and_, case, or_

from api.core.integrity_pipeline import UNFINISHED_REASONS
from api.models.assignment import Submission, SubmissionGrade
from api.models.integrity_check import IntegrityCheckSubmission

FLAG_CHECK = "check"
FLAG_READING = "reading"


def flag_kind_case() -> Any:
    """The kind of flag a submission carries (FLAG_CHECK, FLAG_READING),
    or NULL. Needs the outer joins to IntegrityCheckSubmission and
    SubmissionGrade. A check worth a look wins over a reading problem on
    the same work: it's the one the teacher has to read.

    Branches, each as the flagged count has always counted them:
      check   — disposition flag_for_review, unresolved
              — a finished check with no verdict that isn't one the
                student walked away from (turn cap, or an old close with
                no recorded reason: the roster's "Inconclusive"), unresolved
      reading — the check skipped an unreadable photo, unresolved
              — AI grading skipped it (unreadable, or too long to grade
                in one pass) and there's no grade
              — the student flagged the reading as wrong

    A student who didn't finish the check is deliberately NOT here:
    walking away raises scrutiny (the roster says so on that row) but it
    isn't evidence of anything, and integrity never auto-flags. Each
    integrity-check branch requires the check to be unresolved: once a
    teacher marks it reviewed it no longer counts."""
    unresolved = IntegrityCheckSubmission.resolution == "unresolved"
    return case(
        (and_(IntegrityCheckSubmission.disposition == "flag_for_review", unresolved), FLAG_CHECK),
        (
            and_(
                IntegrityCheckSubmission.status == "complete",
                IntegrityCheckSubmission.disposition.is_(None),
                or_(
                    IntegrityCheckSubmission.incomplete_reason.is_(None),
                    IntegrityCheckSubmission.incomplete_reason.notin_(UNFINISHED_REASONS),
                ),
                unresolved,
            ),
            FLAG_CHECK,
        ),
        (and_(IntegrityCheckSubmission.status == "skipped_unreadable", unresolved), FLAG_READING),
        (
            and_(
                SubmissionGrade.ai_grading_status.in_(("skipped_unreadable", "skipped_too_long")),
                SubmissionGrade.final_score.is_(None),
            ),
            FLAG_READING,
        ),
        (Submission.extraction_flagged_at.is_not(None), FLAG_READING),
        else_=None,
    )


def flagged_case() -> Any:
    """1 if the submission is flagged (either kind), else 0 — the one
    "flagged" count. The review page's Flagged filter (`isFlagged` in the
    roster) mirrors it row for row, so the count a teacher clicks and
    the list she lands on agree."""
    return case((flag_kind_case().is_not(None), 1), else_=0)
