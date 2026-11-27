"""Whose LLM call is it? One rule, used by every admin number.

A call counts for a PERSON when they made it (`user_id`), OR it ran on a
submission they handed in, OR it ran on a submission to homework they set
(`submission → assignment.teacher_id`). The three arms cover students and
teachers alike: a student's arms are "made it" and "their submission"; a
teacher's are "made it" and "their homework". Grading and integrity calls
are billed to the student whose request they serve, so a teacher's number
is their own calls plus their students' work on their homework.

A call counts for a SCHOOL by the `school_id` stamped on it when it ran
(blank = "Internal": admin/system calls and pre-backfill rows) — never by
where its user sits today.

A call from the submission pipeline whose submission is gone
(`submission_id` NULL — the FK is ON DELETE SET NULL) is a "deleted
submission" call. It stays with the student who made it (`user_id`) and
its stamped school; it is never re-attributed to anyone else.

Two shapes of the same rule:

* `calls_of(user_id)` — a WHERE clause for one person's calls.
* `call_owners(*where)` — (call_id, owner_id) pairs for grouped rollups
  (a cost per teacher, per user). A call appears once per owner, so
  summing per owner never double counts, and the owners of one call can
  be several people (the student and their teacher).
"""

import uuid
from typing import Any

from sqlalchemy import ColumnElement, and_, or_, select, union
from sqlalchemy.sql.selectable import Subquery

from api.core.llm_client import LLMMode
from api.models.assignment import Assignment, Submission
from api.models.llm_call import LLMCall

# Functions that run on a student's submission and carry its id. A row of
# one of these with no submission_id lost its submission to a delete.
SUBMISSION_FUNCTIONS: frozenset[str] = frozenset({
    LLMMode.AI_GRADING,
    LLMMode.DRAWING_CHECK,
    LLMMode.INTEGRITY_EXTRACT,
    LLMMode.INTEGRITY_AGENT,
    LLMMode.INTEGRITY_ANSWER_EQUIVALENCE,
    LLMMode.INTEGRITY_DIAGNOSE_WRONG,
})


def is_deleted_submission_call(function: str, submission_id: object) -> bool:
    """The row-level form of `deleted_submission_calls()`."""
    return submission_id is None and function in SUBMISSION_FUNCTIONS


def deleted_submission_calls() -> ColumnElement[bool]:
    return and_(
        LLMCall.submission_id.is_(None),
        LLMCall.function.in_(SUBMISSION_FUNCTIONS),
    )


def calls_of(user_id: uuid.UUID | str) -> ColumnElement[bool]:
    """Calls that count for one person (student or teacher)."""
    their_submissions = select(Submission.id).where(Submission.student_id == user_id)
    their_homework = (
        select(Submission.id)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .where(Assignment.teacher_id == user_id)
    )
    return or_(
        LLMCall.user_id == user_id,
        LLMCall.submission_id.in_(their_submissions),
        LLMCall.submission_id.in_(their_homework),
    )


def call_owners(*where: Any) -> Subquery:
    """(call_id, owner_id) for every call matching `where`, once per owner.

    `union` (not union all) collapses a call that reaches the same person
    by two arms — a teacher who ran a call on a submission to their own
    homework is one owner, not two.
    """
    made = select(LLMCall.id.label("call_id"), LLMCall.user_id.label("owner_id")).where(
        LLMCall.user_id.isnot(None), *where,
    )
    handed_in = (
        select(LLMCall.id, Submission.student_id)
        .join(Submission, Submission.id == LLMCall.submission_id)
        .where(*where)
    )
    set_by = (
        select(LLMCall.id, Assignment.teacher_id)
        .join(Submission, Submission.id == LLMCall.submission_id)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .where(*where)
    )
    return union(made, handed_in, set_by).subquery("call_owners")


def school_calls(school_id: uuid.UUID | str | None) -> ColumnElement[bool]:
    """Calls that count for a school; None = the Internal bucket."""
    if school_id is None:
        return LLMCall.school_id.is_(None)
    return LLMCall.school_id == school_id
