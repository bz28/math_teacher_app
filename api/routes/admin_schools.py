"""Admin school management endpoints."""

import asyncio
import html
import logging
import secrets
import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.core.email import send_email
from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.activity_log import ActivityLog
from api.models.assignment import Submission, SubmissionGrade
from api.models.course import Course, CourseTeacher
from api.models.llm_call import LLMCall
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.teacher_invite import TeacherInvite
from api.models.user import User
from api.routes.admin_helpers import activity_last_action_sq

logger = logging.getLogger(__name__)

router = APIRouter()

INVITE_EXPIRY_DAYS = 14


# ── Schemas ──────────────────────────────────────────────────────────────────


class CreateSchoolRequest(BaseModel):
    name: str
    city: str | None = None
    state: str | None = None
    contact_name: str
    contact_email: EmailStr
    notes: str | None = None


class UpdateSchoolRequest(BaseModel):
    name: str | None = None
    city: str | None = None
    state: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    is_active: bool | None = None
    notes: str | None = None


class InviteTeacherRequest(BaseModel):
    email: EmailStr


# ── Schools CRUD ─────────────────────────────────────────────────────────────


@router.get("/schools")
async def list_schools(
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    now = datetime.now(UTC)
    cost_30d_start = now - timedelta(days=30)
    cost_60d_start = now - timedelta(days=60)
    submissions_7d_start = now - timedelta(days=7)
    failed_24h_start = now - timedelta(hours=24)

    # Teacher count per school
    teacher_counts = (
        select(User.school_id, func.count().label("teacher_count"))
        .where(User.school_id.isnot(None), User.role == "teacher")
        .group_by(User.school_id)
        .subquery()
    )

    # Distinct enrolled-student count per school. Mirrors the roster
    # query on /schools/{id}/students (SectionEnrollment → Course), so
    # the list's "Students" column matches the detail page's roster
    # total. Distinct because a student can enroll across several of
    # the school's sections/teachers.
    student_counts = (
        select(
            Course.school_id,
            func.count(func.distinct(SectionEnrollment.student_id)).label("student_count"),
        )
        .join(Course, Course.id == SectionEnrollment.course_id)
        .where(Course.school_id.isnot(None))
        .group_by(Course.school_id)
        .subquery()
    )

    # Submissions in the last 7 days per school — the "are they actually
    # using it" usage pulse (Submission → Section → Course), distinct
    # from the recency-only last_activity signal.
    submissions_7d_q = (
        select(
            Course.school_id,
            func.count().label("submissions_7d"),
        )
        .select_from(Submission)
        .join(Section, Section.id == Submission.section_id)
        .join(Course, Course.id == Section.course_id)
        .where(
            Course.school_id.isnot(None),
            Submission.submitted_at >= submissions_7d_start,
        )
        .group_by(Course.school_id)
        .subquery()
    )

    # Failed AI calls in the last 24h per school — the health "danger
    # dot". Same denormalized LLMCall.school_id used for cost.
    failed_24h_q = (
        select(
            LLMCall.school_id,
            func.count().label("failed_24h"),
        )
        .where(
            LLMCall.school_id.isnot(None),
            LLMCall.success.is_(False),
            LLMCall.created_at >= failed_24h_start,
        )
        .group_by(LLMCall.school_id)
        .subquery()
    )

    # Cost in the last 30 days per school. LLMCall.school_id is the
    # denormalized column populated when a submission is processed —
    # exactly what we want for "what is each school costing us".
    cost_30d_q = (
        select(
            LLMCall.school_id,
            func.coalesce(func.sum(LLMCall.cost_usd), 0.0).label("cost_30d"),
        )
        .where(
            LLMCall.school_id.isnot(None),
            LLMCall.created_at >= cost_30d_start,
        )
        .group_by(LLMCall.school_id)
        .subquery()
    )

    # Cost in the previous 30-day window so the frontend can show a
    # trend delta. Same shape; just shifted back.
    cost_prev_30d_q = (
        select(
            LLMCall.school_id,
            func.coalesce(func.sum(LLMCall.cost_usd), 0.0).label("cost_prev_30d"),
        )
        .where(
            LLMCall.school_id.isnot(None),
            LLMCall.created_at >= cost_60d_start,
            LLMCall.created_at < cost_30d_start,
        )
        .group_by(LLMCall.school_id)
        .subquery()
    )

    # Last student-submission timestamp per school — the "is this
    # deal warm or stale?" signal. We go Submission → Section →
    # Course → school_id so a school with zero submissions returns
    # NULL (which the frontend renders as "no activity yet").
    last_activity_q = (
        select(
            Course.school_id,
            func.max(Submission.submitted_at).label("last_activity_at"),
        )
        .join(Section, Section.id == Submission.section_id)
        .join(Course, Course.id == Section.course_id)
        .where(Course.school_id.isnot(None))
        .group_by(Course.school_id)
        .subquery()
    )

    # Last logged ActivityLog action per school — all-time to match the
    # (unwindowed) submission recency above. Folds teacher writes with
    # no student submission (grade/publish) into the school's activity.
    school_activity = activity_last_action_sq(ActivityLog.school_id)

    # Filter out kind='individual' schools — those are synthetic
    # personal containers auto-created for indie teachers (one per
    # teacher). They aren't real partner schools and would otherwise
    # explode this list with every solo signup.
    rows = (await db.execute(
        select(
            School,
            func.coalesce(teacher_counts.c.teacher_count, 0).label("teacher_count"),
            func.coalesce(student_counts.c.student_count, 0).label("student_count"),
            func.coalesce(cost_30d_q.c.cost_30d, 0.0).label("cost_30d"),
            func.coalesce(cost_prev_30d_q.c.cost_prev_30d, 0.0).label("cost_prev_30d"),
            func.coalesce(submissions_7d_q.c.submissions_7d, 0).label("submissions_7d"),
            func.coalesce(failed_24h_q.c.failed_24h, 0).label("failed_calls_24h"),
            last_activity_q.c.last_activity_at,
            func.greatest(
                last_activity_q.c.last_activity_at, school_activity.c.last_action_at
            ).label("last_active_at"),
        )
        .outerjoin(teacher_counts, teacher_counts.c.school_id == School.id)
        .outerjoin(student_counts, student_counts.c.school_id == School.id)
        .outerjoin(cost_30d_q, cost_30d_q.c.school_id == School.id)
        .outerjoin(cost_prev_30d_q, cost_prev_30d_q.c.school_id == School.id)
        .outerjoin(submissions_7d_q, submissions_7d_q.c.school_id == School.id)
        .outerjoin(failed_24h_q, failed_24h_q.c.school_id == School.id)
        .outerjoin(last_activity_q, last_activity_q.c.school_id == School.id)
        .outerjoin(school_activity, school_activity.c.gid == School.id)
        .where(School.kind == SCHOOL_KIND_INSTITUTIONAL)
        .order_by(School.created_at.desc())
    )).all()

    return {
        "schools": [
            {
                "id": str(s.id),
                "name": s.name,
                "city": s.city,
                "state": s.state,
                "contact_name": s.contact_name,
                "contact_email": s.contact_email,
                "is_active": s.is_active,
                "teacher_count": int(tc),
                "student_count": int(sc),
                "cost_30d": round(c30, 4),
                "cost_prev_30d": round(c60, 4),
                "submissions_7d": int(sub7),
                "failed_calls_24h": int(f24),
                "last_activity_at": la.isoformat() if la else None,
                # Unified recency: max(last submission, last ActivityLog
                # action). Prefer this over `last_activity_at` for
                # active/stale/dormant — it catches a school whose only
                # recent activity is a teacher grading/publishing (no
                # student submission). `last_activity_at` is kept for
                # the parallel Schools-tab PR mid-migration.
                "last_active_at": laa.isoformat() if laa else None,
                "notes": s.notes,
                "created_at": s.created_at.isoformat(),
                "updated_at": s.updated_at.isoformat() if s.updated_at else None,
                "updated_by": s.updated_by_name,
            }
            for s, tc, sc, c30, c60, sub7, f24, la, laa in rows
        ]
    }


@router.post("/schools")
async def create_school(
    body: CreateSchoolRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    # Prevent duplicate schools by contact email
    existing = (await db.execute(
        select(School).where(School.contact_email == body.contact_email.lower())
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A school with this contact email already exists: {existing.name}",
        )

    school = School(
        name=body.name,
        city=body.city,
        state=body.state,
        contact_name=body.contact_name,
        contact_email=body.contact_email,
        notes=body.notes,
        updated_by_id=current_user.user_id,
        updated_by_name=current_user.name,
    )
    db.add(school)
    await db.commit()
    await db.refresh(school)
    logger.info("AUDIT: admin=%s created school=%s (%s)", current_user.user_id, school.id, school.name)
    return {"id": str(school.id), "status": "ok"}


@router.get("/schools/{school_id}")
async def get_school(
    school_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """School deep page: the teacher → section → student hierarchy.

    The unit is teacher→class, not a flat school-wide roster. We return
    every teacher, their sections (class periods), and each section's
    enrolled students — with cost rolled up to the level where it's
    unambiguously attributable:

      * Per-submission AI (Vision extraction + integrity + AI grading,
        and grading of assigned practice) is attributable via
        LLMCall.submission_id → submission → section, so it rolls up to
        the **section**.
      * A teacher's authoring/generation spend has no submission, so it
        can't be pinned to one section — it stays at the **teacher**
        level (LLMCall.user_id = teacher, submission_id IS NULL).

    All aggregation is done with grouped subqueries assembled in Python
    (no per-teacher / per-section follow-up queries), so a large school
    still resolves in a fixed number of round trips.
    """
    school = (await db.execute(select(School).where(School.id == school_id))).scalar_one_or_none()
    if not school:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="School not found")

    since_30d = datetime.now(UTC) - timedelta(days=30)

    # ── Teachers + their generation (non-submission) spend ──────────
    # Per-submission calls roll up to sections below (via submission_id),
    # so a teacher's own bucket filters submission_id IS NULL to avoid
    # double-counting a grading call that happens to carry the teacher's
    # user_id. What's left is authoring/generation + misc tooling.
    gen_stats_sq = (
        select(
            LLMCall.user_id.label("user_id"),
            func.count().label("gen_calls"),
            func.coalesce(func.sum(LLMCall.cost_usd), 0).label("gen_cost"),
        )
        .where(
            LLMCall.created_at >= since_30d,
            LLMCall.user_id.isnot(None),
            LLMCall.submission_id.is_(None),
        )
        .group_by(LLMCall.user_id)
        .subquery()
    )
    teacher_rows = (await db.execute(
        select(
            User.id,
            User.name,
            User.email,
            User.created_at,
            User.is_active,
            func.coalesce(gen_stats_sq.c.gen_calls, 0).label("gen_calls"),
            func.coalesce(gen_stats_sq.c.gen_cost, 0).label("gen_cost"),
        )
        .outerjoin(gen_stats_sq, gen_stats_sq.c.user_id == User.id)
        .where(User.school_id == school.id, User.role == "teacher")
        .order_by(User.name)
    )).all()

    # ── Sections of the school, keyed to their owner teacher ────────
    # Outer-joined to CourseTeacher(owner) so a section whose course has
    # no owner row (a data anomaly — the create flow always attaches one)
    # still surfaces rather than silently dropping its students; it lands
    # in the "unassigned" bucket below instead.
    section_rows = (await db.execute(
        select(
            Section.id,
            Section.name,
            Course.name.label("course_name"),
            CourseTeacher.teacher_id,
        )
        .join(Course, Course.id == Section.course_id)
        .outerjoin(
            CourseTeacher,
            and_(
                CourseTeacher.course_id == Course.id,
                CourseTeacher.role == "owner",
            ),
        )
        .where(Course.school_id == school.id)
        .order_by(Section.name)
    )).all()

    # ── Per-section aggregates (all grouped by section_id) ──────────
    # Enrolled student count.
    enroll_rows = (await db.execute(
        select(
            SectionEnrollment.section_id,
            func.count(func.distinct(SectionEnrollment.student_id)).label("cnt"),
        )
        .join(Course, Course.id == SectionEnrollment.course_id)
        .where(Course.school_id == school.id)
        .group_by(SectionEnrollment.section_id)
    )).all()
    student_count = {r.section_id: int(r.cnt) for r in enroll_rows}

    # Distinct submitters + last submission timestamp.
    sub_rows = (await db.execute(
        select(
            Submission.section_id,
            func.count(func.distinct(Submission.student_id)).label("submitters"),
            func.max(Submission.submitted_at).label("last_at"),
        )
        .join(Section, Section.id == Submission.section_id)
        .join(Course, Course.id == Section.course_id)
        .where(Course.school_id == school.id)
        .group_by(Submission.section_id)
    )).all()
    submitted_count = {r.section_id: int(r.submitters) for r in sub_rows}
    section_last = {r.section_id: r.last_at for r in sub_rows}

    # Rolled-up per-submission cost (extraction + integrity + grading),
    # attributed via submission_id → submission → section.
    cost_rows = (await db.execute(
        select(
            Submission.section_id,
            func.coalesce(func.sum(LLMCall.cost_usd), 0).label("cost"),
        )
        .join(Submission, Submission.id == LLMCall.submission_id)
        .join(Section, Section.id == Submission.section_id)
        .join(Course, Course.id == Section.course_id)
        .where(Course.school_id == school.id, LLMCall.created_at >= since_30d)
        .group_by(Submission.section_id)
    )).all()
    section_cost = {r.section_id: float(r.cost) for r in cost_rows}

    # ── Per-section student drill (enrollment + submission + grade) ──
    # One row per (section, student): a student in several sections
    # appears under each. Aggregates are keyed on (section_id,
    # student_id) so the per-section submission/grade context is exact.
    enrolled_rows = (await db.execute(
        select(
            SectionEnrollment.section_id,
            User.id,
            User.name,
            User.email,
            User.grade_level,
            # Drives the row's Deactivate/Reactivate label. Without it
            # the button reads "Deactivate" for someone already
            # deactivated, and the page offers no way back.
            User.is_active,
        )
        .join(User, User.id == SectionEnrollment.student_id)
        .join(Course, Course.id == SectionEnrollment.course_id)
        .where(Course.school_id == school.id)
        .order_by(User.name)
    )).all()

    stu_sub_rows = (await db.execute(
        select(
            Submission.section_id,
            Submission.student_id,
            func.count().label("subs"),
            func.max(Submission.submitted_at).label("last_at"),
        )
        .join(Section, Section.id == Submission.section_id)
        .join(Course, Course.id == Section.course_id)
        .where(Course.school_id == school.id)
        .group_by(Submission.section_id, Submission.student_id)
    )).all()
    stu_sub = {
        (r.section_id, r.student_id): (int(r.subs), r.last_at)
        for r in stu_sub_rows
    }

    stu_grade_rows = (await db.execute(
        select(
            Submission.section_id,
            Submission.student_id,
            func.avg(SubmissionGrade.final_score).label("avg_score"),
            func.count(SubmissionGrade.final_score).label("graded"),
        )
        .join(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .join(Section, Section.id == Submission.section_id)
        .join(Course, Course.id == Section.course_id)
        .where(
            Course.school_id == school.id,
            SubmissionGrade.final_score.isnot(None),
        )
        .group_by(Submission.section_id, Submission.student_id)
    )).all()
    stu_grade = {
        (r.section_id, r.student_id): (float(r.avg_score), int(r.graded))
        for r in stu_grade_rows
    }

    students_by_section: dict[uuid.UUID, list[dict[str, Any]]] = defaultdict(list)
    for er in enrolled_rows:
        subs, stu_last = stu_sub.get((er.section_id, er.id), (0, None))
        avg_score, graded = stu_grade.get((er.section_id, er.id), (None, 0))
        students_by_section[er.section_id].append({
            "id": str(er.id),
            "name": er.name,
            "email": er.email,
            "grade_level": er.grade_level,
            "is_active": er.is_active,
            "submission_count": subs,
            "graded_count": graded,
            "avg_score": round(avg_score, 1) if avg_score is not None else None,
            "last_activity_at": stu_last.isoformat() if stu_last else None,
        })

    # ── Assemble the nested teacher → section → student tree ────────
    # A section whose owner isn't one of the school's current teachers
    # (no owner row, or owner reassigned to another school) can't hang
    # off a teacher card — route it to an "unassigned" bucket so its
    # students still show rather than vanishing.
    teacher_ids = {t.id for t in teacher_rows}
    sections_by_teacher: dict[uuid.UUID, list[dict[str, Any]]] = defaultdict(list)
    unassigned_sections: list[dict[str, Any]] = []
    for sr in section_rows:
        sec_last = section_last.get(sr.id)
        section = {
            "id": str(sr.id),
            "name": sr.name,
            "course_name": sr.course_name,
            "student_count": student_count.get(sr.id, 0),
            "submitted_count": submitted_count.get(sr.id, 0),
            "cost_30d": round(section_cost.get(sr.id, 0.0), 4),
            "last_activity_at": sec_last.isoformat() if sec_last else None,
            "students": students_by_section.get(sr.id, []),
        }
        if sr.teacher_id in teacher_ids:
            sections_by_teacher[sr.teacher_id].append(section)
        else:
            unassigned_sections.append(section)

    teachers = [
        {
            "id": str(t.id),
            "name": t.name,
            "email": t.email,
            "joined_at": t.created_at.isoformat(),
            "is_active": t.is_active,
            "gen_cost_30d": round(float(t.gen_cost), 6),
            "gen_call_count_30d": int(t.gen_calls),
            "sections": sections_by_teacher.get(t.id, []),
        }
        for t in teacher_rows
    ]

    # Pending invites
    invites = (await db.execute(
        select(TeacherInvite)
        .where(TeacherInvite.school_id == school.id, TeacherInvite.status == "pending")
        .order_by(TeacherInvite.created_at.desc())
    )).scalars().all()

    return {
        "id": str(school.id),
        "name": school.name,
        "city": school.city,
        "state": school.state,
        "contact_name": school.contact_name,
        "contact_email": school.contact_email,
        "is_active": school.is_active,
        "notes": school.notes,
        "created_at": school.created_at.isoformat(),
        "teachers": teachers,
        "unassigned_sections": unassigned_sections,
        "pending_invites": [
            {
                "id": str(i.id),
                "email": i.email,
                "expires_at": i.expires_at.isoformat(),
                "created_at": i.created_at.isoformat(),
            }
            for i in invites
        ],
    }


@router.patch("/schools/{school_id}")
async def update_school(
    school_id: uuid.UUID,
    body: UpdateSchoolRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    school = (await db.execute(select(School).where(School.id == school_id))).scalar_one_or_none()
    if not school:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="School not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(school, field, value)
    school.updated_by_id = current_user.user_id
    school.updated_by_name = current_user.name
    await db.commit()
    logger.info("AUDIT: admin=%s updated school=%s", current_user.user_id, school_id)
    return {"status": "ok"}


@router.delete("/schools/{school_id}")
async def delete_school(
    school_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    school = (await db.execute(select(School).where(School.id == school_id))).scalar_one_or_none()
    if not school:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="School not found")

    school_name = school.name

    # Count affected records for the response
    teacher_count = (await db.execute(
        select(func.count()).select_from(User).where(User.school_id == school.id, User.role == "teacher")
    )).scalar() or 0
    invite_count = (await db.execute(
        select(func.count()).select_from(TeacherInvite).where(
            TeacherInvite.school_id == school.id, TeacherInvite.status == "pending"
        )
    )).scalar() or 0

    await db.delete(school)
    await db.commit()

    logger.info(
        "AUDIT: admin=%s deleted school=%s (%s), teachers_unlinked=%d, invites_deleted=%d",
        current_user.user_id, school_id, school_name, teacher_count, invite_count,
    )
    return {
        "status": "ok",
        "teachers_unlinked": teacher_count,
        "invites_deleted": invite_count,
    }


# ── Teacher Invites ──────────────────────────────────────────────────────────


@router.post("/schools/{school_id}/invite")
async def invite_teacher(
    school_id: uuid.UUID,
    body: InviteTeacherRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    school = (await db.execute(select(School).where(School.id == school_id))).scalar_one_or_none()
    if not school:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="School not found")
    if not school.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="School is deactivated")

    # Check if email already has a pending invite for this school
    existing = (await db.execute(
        select(TeacherInvite).where(
            TeacherInvite.school_id == school.id,
            TeacherInvite.email == body.email.lower(),
            TeacherInvite.status == "pending",
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pending invite already exists for this email")

    # Check if a user with this email is already a teacher at this school
    existing_teacher = (await db.execute(
        select(User).where(User.email == body.email.lower(), User.school_id == school.id, User.role == "teacher")
    )).scalar_one_or_none()
    if existing_teacher:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User is already a teacher at this school")

    token = secrets.token_urlsafe(32)
    invite = TeacherInvite(
        school_id=school.id,
        email=body.email.lower(),
        invited_by=current_user.user_id,
        token=token,
        expires_at=datetime.now(UTC) + timedelta(days=INVITE_EXPIRY_DAYS),
    )
    db.add(invite)
    await db.commit()

    invite_url = f"{settings.frontend_url}/register?invite={token}"
    logger.info(
        "AUDIT: admin=%s invited teacher email=%s to school=%s (%s), invite_id=%s",
        current_user.user_id, body.email, school_id, school.name, invite.id,
    )

    # Fire-and-forget invite email to teacher. Escape the school name,
    # which is admin-entered free text, before dropping it into HTML.
    safe_school = html.escape(school.name, quote=True)
    asyncio.create_task(send_email(
        to=[body.email.lower()],
        subject=f"You've been invited to join {school.name} on Veradic AI",
        html=(
            f"<h2>You're invited!</h2>"
            f"<p><strong>{safe_school}</strong> has invited you to join Veradic AI as a teacher.</p>"
            f"<p>Click the link below to create your account:</p>"
            f'<p><a href="{invite_url}" style="display:inline-block;padding:12px 24px;'
            f'background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;'
            f'font-weight:600;">Accept Invite</a></p>'
            f"<p style=\"color:#64748b;font-size:13px;\">This invite expires in {INVITE_EXPIRY_DAYS} days.</p>"
        ),
    ))

    return {"status": "ok", "invite_url": invite_url}


@router.delete("/schools/{school_id}/invites/{invite_id}")
async def cancel_invite(
    school_id: uuid.UUID,
    invite_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    invite = (await db.execute(
        select(TeacherInvite).where(TeacherInvite.id == invite_id, TeacherInvite.school_id == school_id)
    )).scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")

    invite.status = "expired"
    await db.commit()
    logger.info("AUDIT: admin=%s cancelled invite=%s", current_user.user_id, invite_id)
    return {"status": "ok"}
