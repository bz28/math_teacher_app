"""Admin "Handwriting extraction quality" report.

Scores `image_extract` — the Vision call that reads a photo of a
student's handwritten work. If it misreads, every grade downstream is
wrong, so this is the earliest place a defect can be caught.

## Why this needs no new recording

Uniquely among the quality reports, the signal was already being stored
in full, and by the one person who knows the right answer for certain:
the student who wrote the page. The post-submit confirm screen asks
"does this match what you wrote?", and `submissions` keeps the whole
answer:

- ``extraction``             — what the AI read (preserved for audit)
- ``extraction_edits``       — the student's per-row corrections
- ``extraction_edited_at``   — whether they changed anything
- ``extraction_confirmed_at``— they signed off
- ``extraction_flagged_at``  — they hit "Reader got something wrong"

Confirmed and flagged are mutually exclusive and gate everything
downstream (integrity sampling and AI grading both wait on them), so
they are load-bearing already — this report just reads them.

## Buckets

- CLEAN     confirmed, nothing edited — read right first time
- REPAIRED  confirmed after fixing rows — `extraction_edits` is the diff
- FLAGGED   the student rejected the read outright
- EMPTY     the read returned no steps and no answers at all
- AWAITING  neither stamp — still on the confirm screen, EXCLUDED from
            the rate, because an unanswered confirm is not a verdict

The rate is CLEAN / settled. Awaiting is reported next to it rather than
folded in: a large awaiting count is its own finding (students abandoning
the confirm step), not a quality score.

EMPTY exists because the confirm button is unconditional. A student can
tap "Looks right" on a screen that says the reader found nothing, and
that submission would otherwise land in the CLEAN numerator — the worst
possible read scored as a success.

Below ``THIN_SAMPLE`` settled reads the response sets ``thin`` and the UI
must caveat rather than colour the percentage. A rate over three
submissions is noise, and this page's only job is to be trustworthy.

## Student work — a deliberate exception, not a default

The list is aggregate and carries no student identity. The single-
submission drill-in DOES return the submitted image, because reading the
handwriting against what the AI made of it is the entire diagnostic —
you cannot debug a misread without seeing the strokes.

``admin_grading_quality`` states the opposite policy for its own drill-in
("never an individual student's identity or their written work"), so this
is a documented divergence rather than an oversight, and it is narrowed
in three ways: one submission at a time, never in bulk (`files` holds
base64 inline, so a list would run to megabytes), and **every read is
written to the student-record access log** — the same FERPA
disclosure-tracking that covers teacher reads of a student's grades. An
admin reading any student's work across every school is a wider
disclosure than a teacher reading their own, so it is logged at least as
carefully.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import Integer, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.audit_log import log_student_record_access
from api.core.extraction_edits import _final_key, _step_key
from api.core.submission_stage import (
    extraction_is_empty,
    has_content_expr,
    stage_for,
)
from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.course import Course
from api.models.user import User
from api.routes.admin_helpers import time_range

router = APIRouter()

# The moment the student ruled on the read. Drives the window filter and
# the trend, so a submission is dated by when it was JUDGED, not when it
# was uploaded — the same choice grading quality makes with reviewed_at.
_RULED_AT = func.coalesce(
    Submission.extraction_confirmed_at, Submission.extraction_flagged_at
)

_CLEAN = "clean"
_REPAIRED = "repaired"
_FLAGGED = "flagged"
_EMPTY = "empty"
_BUCKETS = (_CLEAN, _REPAIRED, _FLAGGED, _EMPTY)

# Below this many settled reads the percentage is noise. Same floor the
# grading report uses (GradingQuality.tsx THIN_SAMPLE), so the two pages
# agree on what "too few to trust" means rather than each inventing one.
THIN_SAMPLE = 30

# An extraction that found nothing. `extract_student_work` returns
# {"steps": [], "final_answers": [], "confidence": 0.0} when it cannot
# read the files at all, and the pipeline persists that — it is NOT null,
# so it passes every "did the AI read this" filter. The confirm screen's
# button is unconditional, so a student can (and does) tap "Looks right"
# on a screen that says "We couldn't read any work from your photos".
#
# Without this branch the worst possible read lands in the CLEAN
# numerator and inflates the headline. It is the reader failing totally,
# so it is counted as its own outcome, not as a success.
#
# Shared with the per-student views via `submission_stage`, so this page
# and the student case file cannot drift on what "found nothing" means.
_HAS_CONTENT = has_content_expr()


def _bucket_expr() -> Any:
    """SQL CASE mapping a submission to its bucket.

    Order is severity, worst first. Flagged and empty are both tested
    before the confirm stamps, because a row that carries a confirmation
    AND evidence of total failure must be counted as the failure — the
    student clicking through a blank read does not make it a good read.
    """
    return case(
        (Submission.extraction_flagged_at.is_not(None), _FLAGGED),
        (_HAS_CONTENT == 0, _EMPTY),
        (
            Submission.extraction_edited_at.is_not(None),
            _REPAIRED,
        ),
        else_=_CLEAN,
    )


def _rate(clean: int, settled: int) -> float:
    return round(clean / settled * 100, 1) if settled else 0.0


@router.get("/extraction-quality")
async def extraction_quality(
    hours: int = Query(default=2160, ge=1, le=87600),
    subject: str | None = Query(default=None),
    bucket: str | None = Query(
        default=None, description="clean | repaired | flagged | empty",
    ),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    since = time_range(hours)

    def _joined(stmt: Any) -> Any:
        # select_from is explicit because the aggregate selects below name
        # no Submission column, and SQLAlchemy cannot infer the left side
        # of the join from `func.count()` alone.
        return (
            stmt.select_from(Submission)
            .join(Assignment, Assignment.id == Submission.assignment_id)
            .join(Course, Course.id == Assignment.course_id)
        )

    settled_filters = [
        Submission.extraction.is_not(None),
        _RULED_AT.is_not(None),
        _RULED_AT >= since,
    ]
    if subject:
        settled_filters.append(Course.subject == subject)

    # ── The board. Counted in one pass so the buckets can never disagree
    #    with each other the way two independent queries could drift.
    b = _bucket_expr()
    counts = (await db.execute(
        _joined(
            select(
                func.count().label("settled"),
                func.sum(case((b == _CLEAN, 1), else_=0)).label("clean"),
                func.sum(case((b == _REPAIRED, 1), else_=0)).label("repaired"),
                func.sum(case((b == _FLAGGED, 1), else_=0)).label("flagged"),
                func.sum(case((b == _EMPTY, 1), else_=0)).label("empty"),
            )
        ).where(*settled_filters)
    )).one()

    settled = counts.settled or 0
    clean = int(counts.clean or 0)
    repaired = int(counts.repaired or 0)
    flagged = int(counts.flagged or 0)
    empty = int(counts.empty or 0)

    # ── Awaiting: the AI read it, the student never ruled. Excluded from
    #    the rate but reported, because a big number here means students
    #    are abandoning the confirm step — a different problem, and one
    #    that would otherwise hide as a small denominator.
    awaiting_filters = [
        Submission.extraction.is_not(None),
        Submission.extraction_confirmed_at.is_(None),
        Submission.extraction_flagged_at.is_(None),
        Submission.submitted_at >= since,
    ]
    if subject:
        awaiting_filters.append(Course.subject == subject)
    awaiting = (await db.execute(
        _joined(select(func.count())).where(*awaiting_filters)
    )).scalar_one() or 0

    # ── Trend by day.
    day = func.date_trunc("day", _RULED_AT)
    trend_rows = (await db.execute(
        _joined(
            select(
                day.label("day"),
                func.count().label("settled"),
                func.sum(case((b == _CLEAN, 1), else_=0)).label("clean"),
            )
        )
        .where(*settled_filters)
        .group_by(day)
        .order_by(day)
    )).all()
    trend = [
        {
            "day": r.day.date().isoformat(),
            "settled": r.settled or 0,
            "clean_rate": _rate(int(r.clean or 0), r.settled or 0),
        }
        for r in trend_rows
    ]

    # ── By subject, worst-first — where the reader struggles most.
    subject_rows = (await db.execute(
        _joined(
            select(
                Course.subject.label("subject"),
                func.count().label("settled"),
                func.sum(case((b == _CLEAN, 1), else_=0)).label("clean"),
                func.sum(case((b == _FLAGGED, 1), else_=0)).label("flagged"),
            )
        )
        .where(*settled_filters)
        .group_by(Course.subject)
    )).all()
    by_subject = sorted(
        (
            {
                "subject": r.subject or "unknown",
                "settled": r.settled or 0,
                "clean": int(r.clean or 0),
                "flagged": int(r.flagged or 0),
                "clean_rate": _rate(int(r.clean or 0), r.settled or 0),
                "thin": (r.settled or 0) < THIN_SAMPLE,
            }
            for r in subject_rows
        ),
        # Worst first. The sample-size term only breaks exact ties — it
        # does NOT stop 0% at n=1 outranking 40% at n=500, and an earlier
        # comment here claimed otherwise. Rows carry `thin` so the UI can
        # de-emphasise them; the honest fix is a visible caveat, not a
        # sort key pretending to be one.
        key=lambda s: (float(s["clean_rate"]), -int(s["settled"])),
    )

    # ── The list. Repairs first: a clean read has nothing to debug, so
    #    the rows worth opening belong on top regardless of recency.
    list_filters = list(settled_filters)
    if bucket:
        if bucket not in _BUCKETS:
            # Silently ignoring an unknown value returns the UNFILTERED
            # list, which reads as "no such cases exist" — the opposite
            # of the truth, on a page whose job is to be trustworthy.
            raise HTTPException(
                status_code=400,
                detail=f"bucket must be one of: {', '.join(_BUCKETS)}",
            )
        list_filters.append(b == bucket)

    list_total = (await db.execute(
        _joined(select(func.count())).where(*list_filters)
    )).scalar_one() or 0

    rows = (await db.execute(
        _joined(
            select(
                Submission.id,
                Course.name.label("course"),
                Course.subject,
                b.label("bucket"),
                _RULED_AT.label("ruled_at"),
                Submission.extraction,
                Submission.extraction_edits,
            )
        )
        .where(*list_filters)
        .order_by(
            # flagged (0) → repaired (1) → clean (2)
            case(
                (b == _FLAGGED, 0), (b == _EMPTY, 1), (b == _REPAIRED, 2),
                else_=3,
            ).cast(Integer),
            _RULED_AT.desc(),
            # Unique final key so OFFSET paging is stable. `_RULED_AT` ties
            # freely across submissions ruled in one transaction; without a
            # total order, tied rows may sort differently per query and a
            # page can repeat or skip one. (It can't be NULL here —
            # `settled_filters` already excludes those — so the tie, not
            # nullability, is the reason.)
            Submission.id,
        )
        .offset(offset)
        .limit(limit)
    )).all()

    return {
        "summary": {
            "settled": settled,
            "clean": clean,
            "repaired": repaired,
            "flagged": flagged,
            "empty": empty,
            "awaiting": awaiting,
            "clean_rate": _rate(clean, settled),
            # Below this the percentage is noise, and the UI must say so
            # rather than paint a colour on it. Mirrors the grading
            # report's own floor so the two pages agree on what "too few
            # to trust" means.
            "thin": settled < THIN_SAMPLE,
        },
        "trend": trend,
        "by_subject": by_subject,
        "cases": [
            {
                "submission_id": str(r.id),
                "course": r.course or "Untitled course",
                "subject": r.subject or "unknown",
                "bucket": r.bucket,
                "ruled_at": r.ruled_at.isoformat() if r.ruled_at else None,
                "corrected_rows": len(r.extraction_edits or {}),
                "steps_read": _step_count(r.extraction),
            }
            for r in rows
        ],
        "total_count": list_total,
    }


def _step_count(extraction: Any) -> int:
    if not isinstance(extraction, dict):
        return 0
    steps = extraction.get("steps")
    return len(steps) if isinstance(steps, list) else 0


def _read_text(primary: Any, fallback: Any) -> tuple[str | None, bool]:
    """What the AI transcribed for one row, and whether it is LaTeX.

    Vision routes a transcription to `latex` when the student wrote
    maths and to the prose field when it narrates instead, so a row
    carries one or the other. Reading a single field would blank out
    half the table.

    Returns `(text, is_latex)` rather than just the text, because the
    caller needs to know WHICH field won. This used to collapse both
    into a string, and the dashboard then printed maths rows as raw
    markup — `y = \\frac{2}{5}x + \\frac{17}{5}` instead of the
    typeset fraction the student was shown.

    That is not cosmetic on this screen. Its whole job is spotting a
    misread by eye against the photo beside it, and on 2026-09-04 the
    one real error in a 52-step submission was a 2 read as a 3 inside
    exactly such a fraction. Comparing raw markup to handwriting is the
    hard version of the task the screen exists to make easy.

    The flag is on the ROW, not sniffed from the text downstream:
    guessing "does this look like LaTeX?" from backslashes would
    misfire on prose that legitimately contains one.
    """
    if primary is not None and str(primary).strip():
        return str(primary).strip(), True
    if fallback is not None and str(fallback).strip():
        return str(fallback).strip(), False
    return None, False


@router.get("/extraction-quality/{submission_id}")
async def extraction_detail(
    submission_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One submission: the photo, what the AI read, and what the student
    said it should have said — row by row.

    This is the only surface where a misread can actually be diagnosed.
    A count tells you the reader is struggling; only the strokes beside
    the transcription tell you *how*.

    Also the case-file body for `/submissions/{id}/trace`, which is why
    the response carries the student's identity and the assignment's two
    AI toggles alongside the read. The trace's job is to explain a
    submission's whole life, and the most common thing it has to explain
    is an EMPTY call list — for which the toggles are the answer roughly
    as often as a failure is. See `api.core.submission_stage`.
    """
    row = (await db.execute(
        select(
            Submission,
            Course.name,
            Course.subject,
            Assignment.title.label("assignment_title"),
            Assignment.type.label("assignment_type"),
            Assignment.integrity_check_enabled,
            Assignment.ai_grading_enabled,
            User.name.label("student_name"),
        )
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .join(Course, Course.id == Assignment.course_id)
        .outerjoin(User, User.id == Submission.student_id)
        .where(Submission.id == submission_id)
    )).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    sub = row.Submission
    course_name, subject = row.name, row.subject

    # The FERPA log for this read is deliberately at the END of the
    # handler — see the note above the call, and `admin_students._log_read`.

    edits: dict[str, Any] = sub.extraction_edits or {}
    # A single float for the whole read — Vision does not score individual
    # rows, and the step/final objects forbid extra properties. An earlier
    # draft read a per-row `confidence` that never existed, so every chip
    # was silently None.
    overall_confidence = (
        sub.extraction.get("confidence")
        if isinstance(sub.extraction, dict) else None
    )

    # Pair each extracted row with the student's correction. The keys are
    # built with the SAME helpers the overlay uses, not hand-rolled here:
    # they reject non-int positions (and bools, which are ints in Python),
    # so a hand-built f-string would silently mint keys that never match
    # and report every corrected row as untouched.
    #
    # Vision writes a step's transcription to `latex` when the student
    # wrote maths and `plain_english` when it narrates instead, so the
    # read is whichever one carries content — reading only one field
    # would show half the rows blank.
    rows_out: list[dict[str, Any]] = []
    extraction = sub.extraction if isinstance(sub.extraction, dict) else {}

    for i, step in enumerate(extraction.get("steps") or []):
        if not isinstance(step, dict):
            continue
        key = _step_key(step.get("problem_position"), step.get("step_num"))
        # Vision may return problem_position=null when it cannot confidently
        # attribute a step to a problem. Those rows have no edit key — the
        # student could not have corrected them — but they must still be
        # SHOWN: an unattributable step is often the interesting misread,
        # and dropping it made the list's "rows read" count disagree with
        # the modal that opened from it.
        unattributed = key is None
        corrected = None if key is None else edits.get(key)
        step_read, step_is_latex = _read_text(
            step.get("latex"), step.get("plain_english"),
        )
        rows_out.append({
            "key": key or f"unattributed:{i}",
            "problem_position": step.get("problem_position"),
            "step_num": step.get("step_num"),
            "kind": "step",
            "unattributed": unattributed,
            "ai_read": step_read,
            # The student edits the LaTeX SOURCE when a row has one (see
            # the confirm view), so their correction is LaTeX exactly
            # when the AI read was — one flag covers both columns.
            "is_latex": step_is_latex,
            "student_said": corrected,
            # An empty-string edit means the student CLEARED the row — the
            # overlay drops it entirely. That is a deletion, and rendering
            # it as "" would read as "no change" on the very screen built
            # to show what changed.
            "deleted": key is not None and key in edits
            and not (corrected or "").strip(),
            "changed": key is not None and key in edits,
        })

    # final_answers is a LIST of {problem_position, answer_latex, ...},
    # not a map keyed by position.
    for i, fa in enumerate(extraction.get("final_answers") or []):
        if not isinstance(fa, dict):
            continue
        key = _final_key(fa.get("problem_position"))
        # Same two guards the steps loop applies, and for the same
        # reason. `unattributed` was computed and then dropped from the
        # dict, so the renderer read it as false and printed "— same —"
        # — asserting the student saw and agreed with a row Vision could
        # not place and they were therefore never shown. A null `key`
        # also collided in React's list keys when two answers were
        # unplaceable.
        unattributed = key is None
        corrected = None if key is None else edits.get(key)
        fa_read, fa_is_latex = _read_text(
            fa.get("answer_latex"), fa.get("answer_plain"),
        )
        rows_out.append({
            "key": key or f"unattributed-final:{i}",
            "problem_position": fa.get("problem_position"),
            "step_num": None,
            "kind": "final_answer",
            "unattributed": unattributed,
            # answer_plain, NOT answer_text — the latter exists nowhere in
            # the schema, so every prose answer rendered "nothing read".
            "ai_read": fa_read,
            "is_latex": fa_is_latex,
            "student_said": corrected,
            "deleted": key is not None and key in edits
            and not (corrected or "").strip(),
            "changed": key is not None and key in edits,
        })

    # Order by PROBLEM, then step — Vision does not emit steps in problem
    # order, and until this sort existed the page rendered the raw array.
    # On the 2026-09-04 Holy Ghost submission that array opened at
    # problem 3, so a reviewer scrolling from the top saw P3-P10 and
    # reasonably concluded P1 and P2 had not been read at all. They had;
    # they were buried mid-list among 62 rows.
    #
    # The student's confirm view has grouped and sorted by
    # problem_position all along. Two screens showing the same extraction
    # in different orders is its own bug: the one built for diagnosing a
    # misread was the incoherent one.
    #
    # Unattributed rows sort last, matching the student view. They have
    # no position to sort by, and leading with rows nobody could place
    # buries the ones a reviewer came for.
    rows_out.sort(
        key=lambda r: (
            r["problem_position"] is None,
            r["problem_position"] or 0,
            # A final answer belongs after the steps that reach it.
            r["kind"] == "final_answer",
            r["step_num"] if r["step_num"] is not None else 0,
        )
    )

    # The grade stamps decide the stage, and a submission that was never
    # graded has no row here at all — so absence is expected and `.first()`
    # returning None is the normal path, not an error.
    grade = (await db.execute(
        select(SubmissionGrade.graded_at, SubmissionGrade.grade_published_at)
        .where(SubmissionGrade.submission_id == sub.id)
    )).first()

    stage = stage_for(
        extraction_present=sub.extraction is not None,
        extraction_confirmed_at=sub.extraction_confirmed_at,
        extraction_flagged_at=sub.extraction_flagged_at,
        graded_at=grade.graded_at if grade else None,
        grade_published_at=grade.grade_published_at if grade else None,
        integrity_check_enabled=row.integrity_check_enabled,
        ai_grading_enabled=row.ai_grading_enabled,
    )

    payload = {
        "submission_id": str(sub.id),
        "student_id": str(sub.student_id),
        "student_name": row.student_name,
        "assignment_title": row.assignment_title,
        "assignment_type": row.assignment_type,
        "course": course_name or "Untitled course",
        "subject": subject or "unknown",
        "bucket": (
            _FLAGGED if sub.extraction_flagged_at is not None
            else _REPAIRED if sub.extraction_edited_at is not None
            else _CLEAN if sub.extraction_confirmed_at is not None
            else "awaiting"
        ),
        "stage": stage,
        # The three facts that turn an empty LLM-call list from a dead
        # end into a diagnosis: whether a read was ever owed, whether one
        # landed, and whether there were photos to read in the first
        # place. Rendered as a sentence by the trace page.
        "integrity_check_enabled": row.integrity_check_enabled,
        "ai_grading_enabled": row.ai_grading_enabled,
        "extraction_present": sub.extraction is not None,
        "extraction_empty": extraction_is_empty(sub.extraction),
        "files_count": len(sub.files or []),
        "edited_at": (
            sub.extraction_edited_at.isoformat()
            if sub.extraction_edited_at else None
        ),
        "submitted_at": sub.submitted_at.isoformat() if sub.submitted_at else None,
        "confirmed_at": (
            sub.extraction_confirmed_at.isoformat()
            if sub.extraction_confirmed_at else None
        ),
        "flagged_at": (
            sub.extraction_flagged_at.isoformat()
            if sub.extraction_flagged_at else None
        ),
        # One score for the whole read — Vision does not rate individual
        # rows, so this is reported once rather than faked per row.
        "confidence": overall_confidence,
        "rows": rows_out,
        # The strokes themselves. Base64 inline, one submission only —
        # see the module docstring on why this is never returned in bulk.
        "files": sub.files or [],
    }

    # This response carries a photograph of a student's own handwriting.
    # Every other read of a student record in this codebase is logged for
    # FERPA disclosure-tracking, and an admin reading any student's work
    # across every school is a wider disclosure than a teacher reading
    # their own — so it is logged the same way. See the module docstring
    # for why the image is returned at all.
    #
    # LAST, after every `sub.*` attribute is materialized above. The
    # helper swallows its own exceptions but recovers with
    # `db.rollback()`, which expires the whole identity map
    # (`expire_on_commit=False` does not cover a rollback) — so a failed
    # audit insert followed by any further ORM read raises MissingGreenlet
    # and 500s an authorized request. `admin_students._log_read` carries
    # the full note.
    await log_student_record_access(
        db,
        accessor_user_id=current_user.user_id,
        accessor_role=current_user.role,
        target_student_id=sub.student_id,
        record_type="extraction_quality_drill_in",
        record_id=sub.id,
        request=request,
    )
    return payload
