"""Where a submission stopped moving.

A submission walks a fixed path: the student uploads photos, Vision
reads them, the student signs off on that read, the AI grades it, the
teacher publishes. Each hop is its own stamp spread across
`submissions` and `submission_grades`, and the question the admin
console actually needs answered is never "what are all the stamps" —
it is *which hop is it stuck on, and is that a bug or the design*.

`stage_for` collapses the stamps into that one word.

The stage that matters most is ``awaiting_confirm``: Vision read the
work, the student was shown it, and they never ruled on it. Nothing
downstream runs — `school_student_practice.confirm_extraction` is what
spawns integrity and enqueues grading — so the submission sits
finished-looking and ungraded forever, and until this module existed
there was no surface that said so.

## Why "no read yet" is two stages, not one

``extraction_off`` and ``awaiting_extraction`` both mean
`extraction IS NULL`, and telling them apart is the whole point.
Extraction is only spawned when the assignment has a downstream
consumer::

    if assignment.integrity_check_enabled or assignment.ai_grading_enabled:
        await enqueue_extraction(submission_id, assignment)

With both toggles off, no Vision call was ever owed and the empty
trace is correct. With either on, one *was* owed and did not land.
Same NULL, opposite meanings: one is the product working, the other is
work still outstanding.

Since the extraction queue landed, ``awaiting_extraction`` no longer
means the work may have been silently lost — there is a row in
``extraction_jobs`` saying it is owed, carrying its attempt count and
its last error. The stage still reads NULL the same way; what changed
is that the answer to "why?" now exists somewhere. Folding them together
reports a bug as a feature on every HW with AI switched off, which is
most of the ones being piloted.

## Ordering

`stage_for` tests furthest-along first and returns on the first hit,
so a submission that reached publication reports ``published`` rather
than re-deriving the hops it already cleared. The one exception to
"furthest wins" is ``flagged``: it is terminal by design (the student
rejected the read, so grading never runs and the teacher marks it by
hand), and it outranks the confirm stamps because the two are mutually
exclusive at the source.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import func

from api.models.assignment import Submission

# Ordered furthest-along → least. Exported so callers that rank or
# group by stage share this order instead of each hardcoding one.
PUBLISHED = "published"
GRADED = "graded"
FLAGGED = "flagged"
CONFIRMED = "confirmed"
AWAITING_CONFIRM = "awaiting_confirm"
AWAITING_EXTRACTION = "awaiting_extraction"
EXTRACTION_OFF = "extraction_off"

STAGE_ORDER = (
    PUBLISHED,
    GRADED,
    FLAGGED,
    CONFIRMED,
    AWAITING_CONFIRM,
    AWAITING_EXTRACTION,
    EXTRACTION_OFF,
)

# The stages where the submission is waiting on something that may
# never come. `confirmed` is excluded on purpose: grading is queued
# durably in `grading_jobs` and may legitimately be waiting for a due
# date, so calling it stalled would flag every assignment that grades
# on schedule.
STALLED_STAGES = frozenset({AWAITING_CONFIRM, AWAITING_EXTRACTION})


def has_content_expr() -> Any:
    """SQL: how many rows the read produced, steps + final answers.

    Zero means Vision ran and found nothing — see `extraction_is_empty`
    for why that is its own outcome rather than a successful read. Lives
    here so the aggregate extraction report and the per-student views
    cannot drift on what "the reader found nothing" means; both import
    this rather than each hand-rolling the expression.
    """
    return func.coalesce(
        func.json_array_length(Submission.extraction["steps"]), 0
    ) + func.coalesce(
        func.json_array_length(Submission.extraction["final_answers"]), 0
    )


def extraction_is_empty(extraction: Any) -> bool:
    """True when Vision ran and came back with nothing at all.

    `extract_student_work` returns
    ``{"steps": [], "final_answers": [], "confidence": 0.0}`` when it
    cannot read the files — that is NOT null, so it passes every "did
    the AI read this" check while representing the reader failing
    totally. The confirm screen's button is unconditional, so a student
    can tap "Looks right" on a screen that says nothing was found, and
    the submission then walks the happy path carrying no work.

    The in-Python twin of `has_content_expr`, for callers that already
    hold the decoded blob.
    """
    if not isinstance(extraction, dict):
        return False
    steps = extraction.get("steps") or []
    finals = extraction.get("final_answers") or []
    return len(steps) == 0 and len(finals) == 0


def stage_for(
    *,
    extraction_present: bool,
    extraction_confirmed_at: datetime | None,
    extraction_flagged_at: datetime | None,
    graded_at: datetime | None,
    grade_published_at: datetime | None,
    integrity_check_enabled: bool,
    ai_grading_enabled: bool,
) -> str:
    """The furthest hop this submission cleared. See module docstring."""
    if grade_published_at is not None:
        return PUBLISHED
    if graded_at is not None:
        return GRADED
    # Terminal, and mutually exclusive with confirmed at the source —
    # tested first so a row carrying both stamps (which the API
    # prevents, but a backfill could mint) reports the one that stops
    # the pipeline.
    if extraction_flagged_at is not None:
        return FLAGGED
    if extraction_confirmed_at is not None:
        return CONFIRMED
    if extraction_present:
        return AWAITING_CONFIRM
    if not (integrity_check_enabled or ai_grading_enabled):
        return EXTRACTION_OFF
    return AWAITING_EXTRACTION


def stage_since(
    stage: str,
    *,
    submitted_at: datetime | None,
    extraction_confirmed_at: datetime | None,
    extraction_flagged_at: datetime | None,
    graded_at: datetime | None,
    grade_published_at: datetime | None,
) -> datetime | None:
    """When the submission entered `stage` — what "stuck for 6 days" counts from.

    The waiting stages fall back to `submitted_at` because nothing
    records when an extraction landed: `Submission` has no
    `extraction_at` column, only the read itself. Dating the wait from
    submission is the honest approximation — it overstates the wait by
    the length of one Vision call (5–15s) and understates nothing.
    """
    stamps = {
        PUBLISHED: grade_published_at,
        GRADED: graded_at,
        FLAGGED: extraction_flagged_at,
        CONFIRMED: extraction_confirmed_at,
    }
    return stamps.get(stage) or submitted_at
