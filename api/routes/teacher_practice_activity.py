"""Teacher practice-activity insights — engagement + struggle signal.

Practice is ungraded by design, so this is deliberately NOT part of the
Grades tab. These reads surface ENGAGEMENT (did the student practice,
how recently, how did it go) and STRUGGLE (which problems/concepts the
class keeps retrying or revealing) — never a score, never a raw answer.

Three endpoints, mounted under the teacher router (so /v1/teacher/...),
matching the path shape of teacher_grades.py:
  GET /courses/{course_id}/sections/{section_id}/students/{student_id}/practice-activity
      → one student's engagement + their personal struggle items
  GET /courses/{course_id}/sections/{section_id}/practice-insights
      → class-level struggle aggregate (anonymous; per bank item)
  GET /courses/{course_id}/sections/{section_id}/student-insights
      → per-student practice rollup for the WHOLE roster (the Student
        Insights tab) — one card per enrolled student with a derived
        engagement status + trend so a teacher sees at a glance who's
        thriving and who's falling behind.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.audit_log import log_student_record_access
from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.practice_activity import (
    MODE_LEARN,
    MODE_PRACTICE,
    OUTCOME_FIRST_TRY,
    OUTCOME_RETRY,
    OUTCOME_REVEALED,
    STRUGGLE_OUTCOMES,
    PracticeActivity,
)
from api.models.question_bank import QuestionBankItem
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from api.routes.teacher_courses import get_teacher_course

router = APIRouter()

# Cap on how many struggle items each read surfaces — a re-teach list,
# not an exhaustive dump.
_TOP_STRUGGLE_ITEMS = 20

# How many struggle concepts the roster rollup surfaces inline per
# student — just the 1-2 they wrestled with most, so a row reads
# "Struggling · quadratics, factoring" not an exhaustive dump.
_TOP_STRUGGLES_INLINE = 2


def _accumulate_struggle(
    struggle_by_item: dict[uuid.UUID, dict[str, int]],
    bank_item_id: uuid.UUID,
    outcome: str | None,
) -> None:
    """Tally one struggle event (retry/revealed) onto a per-item map.
    Shared by every read that builds a struggle signal so the bucket
    shape stays identical."""
    s = struggle_by_item.setdefault(bank_item_id, {"retry": 0, "revealed": 0})
    if outcome == OUTCOME_RETRY:
        s["retry"] += 1
    else:
        s["revealed"] += 1


async def _resolve_titles(
    db: AsyncSession, item_ids: Any,
) -> dict[uuid.UUID, str]:
    """Resolve bank-item titles (the concept labels) in one query for a
    collection of item ids. Empty in → empty out (no DB hit)."""
    ids = set(item_ids)
    if not ids:
        return {}
    return {
        r.id: r.title for r in (await db.execute(
            select(QuestionBankItem.id, QuestionBankItem.title)
            .where(QuestionBankItem.id.in_(ids))
        )).all()
    }


def _rank_struggle_items(
    struggle_by_item: dict[uuid.UUID, dict[str, int]],
    titles: dict[uuid.UUID, str],
) -> list[dict[str, Any]]:
    """Title-attach + sort a struggle map, most-struggled first, capped
    at _TOP_STRUGGLE_ITEMS. Pure — the caller resolves titles, so this
    works both per-student (detail) and folded into the roster loop
    (rollup) without an N+1."""
    items: list[dict[str, Any]] = [
        {
            "bank_item_id": str(item_id),
            "concept": titles.get(item_id, "—"),
            "retry_count": counts["retry"],
            "revealed_count": counts["revealed"],
            "struggle_count": counts["retry"] + counts["revealed"],
        }
        for item_id, counts in struggle_by_item.items()
    ]
    items.sort(key=lambda x: x["struggle_count"], reverse=True)
    return items[:_TOP_STRUGGLE_ITEMS]


@router.get("/courses/{course_id}/sections/{section_id}/students/{student_id}/practice-activity")
async def get_student_practice_activity(
    course_id: uuid.UUID,
    section_id: uuid.UUID,
    student_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One student's practice/learn engagement for the teacher. Practiced
    count, last active, outcome breakdown, and the bank items/concepts
    the student most often retried or revealed (their struggle signal).
    No raw answers, no grade — insight only."""
    course = await get_teacher_course(db, course_id, current_user.user_id)

    # Confirm the section is in this course AND the student is enrolled
    # in it — one query, same gate as teacher_grades.get_student_grades.
    student_row = (await db.execute(
        select(User.id, User.name, Section.name.label("section_name"))
        .join(SectionEnrollment, SectionEnrollment.student_id == User.id)
        .join(Section, Section.id == SectionEnrollment.section_id)
        .where(
            User.id == student_id,
            Section.id == section_id,
            Section.course_id == course_id,
        )
    )).first()
    if not student_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not enrolled in this section",
        )

    # FERPA: a teacher just read one student's practice record. Authz is
    # confirmed above. The helper commits its own row and never raises.
    await log_student_record_access(
        db,
        accessor_user_id=current_user.user_id,
        accessor_role=current_user.role,
        target_student_id=student_id,
        record_type="practice_activity",
        accessor_school_id=course.school_id,
        request=request,
    )

    rows = (await db.execute(
        select(PracticeActivity)
        .where(
            PracticeActivity.student_id == student_id,
            PracticeActivity.section_id == section_id,
        )
        .order_by(PracticeActivity.created_at.desc())
    )).scalars().all()

    breakdown = {
        OUTCOME_FIRST_TRY: 0,
        OUTCOME_RETRY: 0,
        OUTCOME_REVEALED: 0,
        "learn_completed": 0,
    }
    practiced_count = 0
    # Per bank item: count of struggle events (retry/revealed).
    struggle_by_item: dict[uuid.UUID, dict[str, int]] = {}
    last_active = rows[0].created_at if rows else None

    for act in rows:
        if act.mode == MODE_PRACTICE:
            practiced_count += 1
            if act.outcome in breakdown:
                breakdown[act.outcome] += 1
            if act.outcome in STRUGGLE_OUTCOMES:
                _accumulate_struggle(
                    struggle_by_item, act.bank_item_id, act.outcome,
                )
        elif act.mode == MODE_LEARN:
            breakdown["learn_completed"] += 1

    struggle_items = await _attach_titles(db, struggle_by_item)

    return {
        "student": {
            "id": str(student_row.id),
            "name": student_row.name,
            "section_id": str(section_id),
            "section_name": student_row.section_name,
        },
        "practiced_count": practiced_count,
        "learn_walkthroughs": breakdown["learn_completed"],
        "last_active": last_active.isoformat() if last_active else None,
        "outcome_breakdown": breakdown,
        "struggle_items": struggle_items,
    }


async def _attach_titles(
    db: AsyncSession, struggle_by_item: dict[uuid.UUID, dict[str, int]],
) -> list[dict[str, Any]]:
    """Resolve bank-item titles (the concept label) for a struggle map
    and return it as a list sorted by total struggle events desc,
    capped at _TOP_STRUGGLE_ITEMS."""
    if not struggle_by_item:
        return []
    titles = await _resolve_titles(db, struggle_by_item.keys())
    return _rank_struggle_items(struggle_by_item, titles)


@router.get("/courses/{course_id}/sections/{section_id}/practice-insights")
async def get_section_practice_insights(
    course_id: uuid.UUID,
    section_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Class-level struggle aggregate for one section: per bank item, how
    many distinct students struggled (retried/revealed) vs how many
    practiced it. Aggregate/anonymous — names the concept to re-teach,
    not the student."""
    await get_teacher_course(db, course_id, current_user.user_id)

    # The section must belong to this course. 404 (not 403) so we don't
    # confirm the existence of a section in someone else's course.
    section_ok = (await db.execute(
        select(Section.id).where(
            Section.id == section_id, Section.course_id == course_id,
        )
    )).scalar_one_or_none()
    if section_ok is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Section not found",
        )

    # Per bank item: distinct students who practiced it, and distinct
    # students who struggled on it. Two grouped queries (one filtered to
    # struggle outcomes) merged in Python — keeps each query simple.
    #
    # Every count on this panel joins User to exclude preview shadows: a
    # teacher rehearsing her own material is not a student who
    # practiced. They have to agree, because the panel renders
    # "N students active" directly above rows reading "X of Y
    # struggled" — filtering one and not the others is how you get a
    # header that contradicts the list under it.
    practiced_rows = (await db.execute(
        select(
            PracticeActivity.bank_item_id,
            func.count(func.distinct(PracticeActivity.student_id)).label("students"),
        )
        .join(User, User.id == PracticeActivity.student_id)
        .where(
            PracticeActivity.section_id == section_id,
            PracticeActivity.mode == MODE_PRACTICE,
            User.is_preview.is_(False),
        )
        .group_by(PracticeActivity.bank_item_id)
    )).all()
    practiced_by_item = {r.bank_item_id: int(r.students) for r in practiced_rows}

    struggle_rows = (await db.execute(
        select(
            PracticeActivity.bank_item_id,
            func.count(func.distinct(PracticeActivity.student_id)).label("students"),
            func.count().label("events"),
        )
        .join(User, User.id == PracticeActivity.student_id)
        .where(
            PracticeActivity.section_id == section_id,
            PracticeActivity.mode == MODE_PRACTICE,
            PracticeActivity.outcome.in_(STRUGGLE_OUTCOMES),
            User.is_preview.is_(False),
        )
        .group_by(PracticeActivity.bank_item_id)
    )).all()
    struggle_by_item = {
        r.bank_item_id: (int(r.students), int(r.events)) for r in struggle_rows
    }

    item_ids = set(practiced_by_item) | set(struggle_by_item)
    titles = {
        r.id: r.title for r in (await db.execute(
            select(QuestionBankItem.id, QuestionBankItem.title)
            .where(QuestionBankItem.id.in_(item_ids))
        )).all()
    } if item_ids else {}

    items = []
    for item_id in item_ids:
        students_struggled, struggle_events = struggle_by_item.get(item_id, (0, 0))
        items.append({
            "bank_item_id": str(item_id),
            "concept": titles.get(item_id, "—"),
            "students_practiced": practiced_by_item.get(item_id, 0),
            "students_struggled": students_struggled,
            "struggle_events": struggle_events,
        })
    # Most-struggled first — that's the re-teach priority list.
    items.sort(
        key=lambda x: (x["students_struggled"], x["struggle_events"]), reverse=True,
    )

    return {
        "section_id": str(section_id),
        "students_active": int((await db.execute(
            select(func.count(func.distinct(PracticeActivity.student_id)))
            .join(User, User.id == PracticeActivity.student_id)
            .where(
                PracticeActivity.section_id == section_id,
                User.is_preview.is_(False),
            )
        )).scalar() or 0),
        "items": items,
    }


# ── Student Insights (whole-roster per-student rollup) ──
#
# Thresholds are deliberately named + commented because the frontend
# renders both a status chip AND a "how this is measured" key — the
# rule has to be explainable to a teacher, not a black box. Tune here;
# the key copy on the client should mirror these numbers.

# Engagement floor. Below this many practiced problems we don't have
# enough signal to judge quality — the student needs a nudge to do more,
# not a "struggling" label off two unlucky problems.
_MIN_PRACTICE_FOR_SIGNAL = 3
# "Engaged" volume — a thriving student has actually put in reps, not
# just gone 2-for-2 and stopped.
_ENGAGED_MIN_PRACTICE = 5
# Recency: no practice in this many days reads as "needs a nudge" even
# if their historical first-try rate was fine.
_STALE_AFTER_DAYS = 14
# Quality bands on first-try rate (first_try / practiced).
_THRIVING_FIRST_TRY = 0.80   # ≥ → mastering it first attempt
_STRUGGLING_FIRST_TRY = 0.50  # < → missing more than half on first try
# Reveal pressure: leaning on the worked solution this often is a
# struggle signal on its own, even when first-try rate sits above the
# floor (e.g. they retry into a reveal rather than getting it cold).
_STRUGGLING_REVEAL_RATE = 0.40

# Trend: split a student's practice rows (oldest→newest) into a recent
# window vs everything before it and compare first-try rate.
# Need enough rows that the recent third is ≥2 problems, otherwise the
# comparison is noise → trend is null ("not enough data yet").
_TREND_MIN_PRACTICE = 6
# How much the first-try rate must move to call it a direction rather
# than steady. 15 points clears normal problem-to-problem variance.
_TREND_DELTA = 0.15

StudentStatus = Literal[
    "thriving", "on_track", "needs_nudge", "struggling", "no_activity",
]
StudentTrend = Literal["improving", "slipping", "steady"]


def _derive_status(
    *,
    practiced_count: int,
    learn_walkthroughs: int,
    first_try_rate: float | None,
    revealed_count: int,
    last_active: datetime | None,
    now: datetime,
) -> StudentStatus:
    """Map a student's coarse practice signals to one engagement status.

    Order matters — each branch assumes the ones above it didn't fire:
      1. no_activity  — never practiced or did a Learn walkthrough.
      2. needs_nudge  — engaged but thin or stale: too few practiced
                        problems to judge, or nothing recent.
      3. struggling   — enough practice, but low first-try rate or heavy
                        reliance on revealing the solution.
      4. thriving     — engaged volume AND a high first-try rate.
      5. on_track     — the healthy middle (default).
    """
    if practiced_count == 0 and learn_walkthroughs == 0:
        return "no_activity"

    stale = (
        last_active is None
        or (now - last_active) > timedelta(days=_STALE_AFTER_DAYS)
    )
    if practiced_count < _MIN_PRACTICE_FOR_SIGNAL or stale:
        return "needs_nudge"

    # practiced_count ≥ _MIN_PRACTICE_FOR_SIGNAL here, so first_try_rate
    # is not None and the reveal ratio is well-defined.
    reveal_rate = revealed_count / practiced_count
    if (first_try_rate is not None and first_try_rate < _STRUGGLING_FIRST_TRY) \
            or reveal_rate >= _STRUGGLING_REVEAL_RATE:
        return "struggling"

    if (
        practiced_count >= _ENGAGED_MIN_PRACTICE
        and first_try_rate is not None
        and first_try_rate >= _THRIVING_FIRST_TRY
    ):
        return "thriving"

    return "on_track"


def _derive_trend(first_try_flags: list[bool]) -> StudentTrend | None:
    """Compare recent vs earlier first-try success for one student.

    `first_try_flags` is the student's practice rows in chronological
    order (oldest→newest), each True iff that problem was first-try.
    Splits off the most-recent third as the "recent" window and compares
    its first-try rate to the earlier rows. Returns None when there isn't
    enough data to compare.
    """
    n = len(first_try_flags)
    if n < _TREND_MIN_PRACTICE:
        return None
    # Recent window = last third (rounded up); earlier = the remainder.
    recent_size = -(-n // 3)  # ceil(n/3)
    earlier = first_try_flags[: n - recent_size]
    recent = first_try_flags[n - recent_size:]
    if not earlier or not recent:
        return None
    earlier_rate = sum(earlier) / len(earlier)
    recent_rate = sum(recent) / len(recent)
    delta = recent_rate - earlier_rate
    if delta >= _TREND_DELTA:
        return "improving"
    if delta <= -_TREND_DELTA:
        return "slipping"
    return "steady"


class StudentInsight(BaseModel):
    """One roster card for the Student Insights tab. Coarse engagement +
    struggle signals only — no scores, no raw answers, no grades."""

    student_id: str
    name: str
    practiced_count: int
    learn_walkthroughs: int
    last_active: datetime | None
    first_try_rate: float | None
    retry_count: int
    revealed_count: int
    trend: StudentTrend | None
    status: StudentStatus
    # The 1-2 concepts this student wrestled with most (by retry/reveal
    # frequency). Empty when there isn't enough practice signal to judge
    # (< _MIN_PRACTICE_FOR_SIGNAL) or they had no struggles — so the
    # roster only surfaces it where it's actionable.
    top_struggles: list[str]


class SectionStudentInsightsResponse(BaseModel):
    section_id: str
    students: list[StudentInsight]


@router.get("/courses/{course_id}/sections/{section_id}/student-insights")
async def get_section_student_insights(
    course_id: uuid.UUID,
    section_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> SectionStudentInsightsResponse:
    """Per-student practice/learn rollup for every enrolled student in a
    section — the Student Insights tab. One card per student (including
    students with zero activity, so the teacher sees the whole roster),
    each carrying coarse engagement counts plus a derived status + trend.

    Read-only INSIGHT, same contract as the other practice reads: no
    scores, no raw answers, no grades — just who's thriving and who's
    falling behind, and why, in terms a teacher can explain.

    Two queries, no N+1: the enrollment roster, and one grouped pull of
    the section's PracticeActivity rows merged with the roster in Python.
    """
    course = await get_teacher_course(db, course_id, current_user.user_id)

    # The section must belong to this course. 404 (not 403) so we don't
    # confirm the existence of a section in someone else's course.
    section_ok = (await db.execute(
        select(Section.id).where(
            Section.id == section_id, Section.course_id == course_id,
        )
    )).scalar_one_or_none()
    if section_ok is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Section not found",
        )

    # FERPA: this is a roster-level read of many students' practice
    # records at once. A per-student row would mean one commit per
    # enrolled student for a single aggregate page load; instead we log
    # one roster-scoped access keyed to the section (record_id), with no
    # single target_student_id, which is the honest description of what
    # the teacher did. Authz is confirmed above; the helper never raises.
    await log_student_record_access(
        db,
        accessor_user_id=current_user.user_id,
        accessor_role=current_user.role,
        target_student_id=None,
        record_type="practice_insights_roster",
        record_id=section_id,
        accessor_school_id=course.school_id,
        request=request,
    )

    # Roster: every enrolled student, name included, ordered for a
    # stable page. Drives the "whole roster" guarantee — students with
    # zero activity still get a card. Preview shadows are enrolled like
    # anyone else, so they're filtered here too — a teacher shouldn't
    # find herself on her own roster (matches teacher_sections.py).
    roster = (await db.execute(
        select(User.id, User.name)
        .join(SectionEnrollment, SectionEnrollment.student_id == User.id)
        .where(
            SectionEnrollment.section_id == section_id,
            User.is_preview.is_(False),
        )
        .order_by(User.name.asc())
    )).all()

    # All practice/learn rows for the section in one shot, oldest→newest
    # so each student's first_try flag list is already chronological for
    # the trend split. Merged with the roster in Python — no per-student
    # query.
    rows = (await db.execute(
        select(
            PracticeActivity.student_id,
            PracticeActivity.mode,
            PracticeActivity.outcome,
            PracticeActivity.bank_item_id,
            PracticeActivity.created_at,
        )
        .where(PracticeActivity.section_id == section_id)
        .order_by(PracticeActivity.created_at.asc())
    )).all()

    # Per-student accumulator.
    agg: dict[uuid.UUID, dict[str, Any]] = {}

    def _bucket(student_id: uuid.UUID) -> dict[str, Any]:
        b = agg.get(student_id)
        if b is None:
            b = {
                "practiced_count": 0,
                "first_try_count": 0,
                "retry_count": 0,
                "revealed_count": 0,
                "learn_walkthroughs": 0,
                "last_active": None,
                "first_try_flags": [],  # chronological, practice rows only
                # Per bank item: this student's retry/reveal tally — the
                # same shape the detail endpoint builds, so the inline
                # top-struggle concepts reuse _rank_struggle_items.
                "struggle_by_item": {},
            }
            agg[student_id] = b
        return b

    for sid, mode, outcome, bank_item_id, created_at in rows:
        b = _bucket(sid)
        # last_active spans every activity (practice and learn).
        if b["last_active"] is None or created_at > b["last_active"]:
            b["last_active"] = created_at
        if mode == MODE_PRACTICE:
            b["practiced_count"] += 1
            if outcome == OUTCOME_FIRST_TRY:
                b["first_try_count"] += 1
                b["first_try_flags"].append(True)
            else:
                b["first_try_flags"].append(False)
                if outcome == OUTCOME_RETRY:
                    b["retry_count"] += 1
                elif outcome == OUTCOME_REVEALED:
                    b["revealed_count"] += 1
            if outcome in STRUGGLE_OUTCOMES:
                _accumulate_struggle(b["struggle_by_item"], bank_item_id, outcome)
        elif mode == MODE_LEARN:
            b["learn_walkthroughs"] += 1

    # Resolve every struggled-on concept title in ONE query across the
    # whole roster, then rank per student in Python — keeps the rollup at
    # three queries total (roster, activity, titles), no per-student N+1.
    all_struggle_ids: set[uuid.UUID] = set()
    for bucket in agg.values():
        all_struggle_ids |= bucket["struggle_by_item"].keys()
    titles = await _resolve_titles(db, all_struggle_ids)

    now = datetime.now(UTC)
    students: list[StudentInsight] = []
    for student_id, name in roster:
        acc = agg.get(student_id)
        if acc is None:
            # Enrolled but never practiced — a real roster card.
            students.append(StudentInsight(
                student_id=str(student_id),
                name=name,
                practiced_count=0,
                learn_walkthroughs=0,
                last_active=None,
                first_try_rate=None,
                retry_count=0,
                revealed_count=0,
                trend=None,
                status="no_activity",
                top_struggles=[],
            ))
            continue

        practiced = acc["practiced_count"]
        first_try_rate = (
            round(acc["first_try_count"] / practiced, 3) if practiced else None
        )
        # Engagement-floor gate: only surface struggle concepts once
        # there's enough practice to trust the signal — below the floor a
        # "struggle" is noise off a couple unlucky problems.
        top_struggles: list[str] = []
        if practiced >= _MIN_PRACTICE_FOR_SIGNAL and acc["struggle_by_item"]:
            top_struggles = [
                item["concept"]
                for item in _rank_struggle_items(acc["struggle_by_item"], titles)[
                    :_TOP_STRUGGLES_INLINE
                ]
                if item["concept"] != "—"
            ]
        students.append(StudentInsight(
            student_id=str(student_id),
            name=name,
            practiced_count=practiced,
            learn_walkthroughs=acc["learn_walkthroughs"],
            last_active=acc["last_active"],
            first_try_rate=first_try_rate,
            retry_count=acc["retry_count"],
            revealed_count=acc["revealed_count"],
            trend=_derive_trend(acc["first_try_flags"]),
            status=_derive_status(
                practiced_count=practiced,
                learn_walkthroughs=acc["learn_walkthroughs"],
                first_try_rate=first_try_rate,
                revealed_count=acc["revealed_count"],
                last_active=acc["last_active"],
                now=now,
            ),
            top_struggles=top_struggles,
        ))

    return SectionStudentInsightsResponse(
        section_id=str(section_id),
        students=students,
    )
