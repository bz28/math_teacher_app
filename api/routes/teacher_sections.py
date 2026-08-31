"""Teacher section management — CRUD, roster, join codes, invites."""

import asyncio
import html
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import AfterValidator, BaseModel, EmailStr
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.core.audit_log import record_activity
from api.core.email import send_email
from api.database import get_db
from api.middleware.auth import CurrentUser, get_current_user, require_teacher
from api.middleware.rate_limit import limiter
from api.models.course import Course
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.section_invite import SectionInvite
from api.models.user import User
from api.routes.teacher_courses import get_teacher_course

logger = logging.getLogger(__name__)

router = APIRouter()

JOIN_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
JOIN_CODE_LENGTH = 6
INVITE_EXPIRY_DAYS = 14


def _validate_section_name(v: str) -> str:
    v = v.strip()
    if not v or len(v) > 200:
        raise ValueError("Name must be 1-200 characters")
    return v


def _validate_join_code(v: str) -> str:
    return v.strip().upper()


SectionName = Annotated[str, AfterValidator(_validate_section_name)]
JoinCode = Annotated[str, AfterValidator(_validate_join_code)]


class CreateSectionRequest(BaseModel):
    name: SectionName


class UpdateSectionRequest(BaseModel):
    name: SectionName | None = None
    enrollment_open: bool | None = None


class InviteStudentRequest(BaseModel):
    email: EmailStr


class JoinSectionRequest(BaseModel):
    join_code: JoinCode


async def _generate_unique_join_code(db: AsyncSession) -> str:
    # Tiny race window: another teacher could grab the same code between
    # SELECT and INSERT. With 32^6 ≈ 1B codes it's negligible; the unique
    # index on Section.join_code would surface a 500 the teacher retries.
    for _ in range(5):
        code = "".join(secrets.choice(JOIN_CODE_CHARS) for _ in range(JOIN_CODE_LENGTH))
        if not (await db.execute(select(Section.id).where(Section.join_code == code))).scalar_one_or_none():
            return code
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not generate unique code")


# --- Section CRUD ---


@router.post("/courses/{course_id}/sections", status_code=status.HTTP_201_CREATED)
async def create_section(
    course_id: uuid.UUID, body: CreateSectionRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)
    section = Section(
        course_id=course_id,
        name=body.name,
        join_code=await _generate_unique_join_code(db),
    )
    db.add(section)
    # Opening a class period is often a school's first real action, and
    # it was only ever written to stdout as an AUDIT log line — real, but
    # not queryable, so no timeline could show it.
    await db.flush()
    await record_activity(
        db, current_user, "section.create", "section", section.id,
        {"name": body.name, "course_id": str(course_id)},
    )
    await db.commit()
    await db.refresh(section)
    logger.info(
        "AUDIT: teacher=%s created section=%s in course=%s",
        current_user.user_id, section.id, course_id,
    )
    return {"id": str(section.id), "name": section.name, "join_code": section.join_code}


@router.get("/courses/{course_id}/sections")
async def list_sections(
    course_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)
    # Exclude preview (shadow) students so the count reflects real enrollment.
    enrollment_counts = (
        select(SectionEnrollment.section_id, func.count().label("student_count"))
        .join(User, User.id == SectionEnrollment.student_id)
        .where(User.is_preview.is_(False))
        .group_by(SectionEnrollment.section_id).subquery()
    )
    rows = (await db.execute(
        select(Section, func.coalesce(enrollment_counts.c.student_count, 0).label("student_count"))
        .outerjoin(enrollment_counts, enrollment_counts.c.section_id == Section.id)
        .where(Section.course_id == course_id)
        .order_by(Section.created_at)
    )).all()
    return {"sections": [{
        "id": str(r.Section.id), "name": r.Section.name,
        "student_count": r.student_count,
        "join_code": r.Section.join_code,
        "enrollment_open": r.Section.enrollment_open,
    } for r in rows]}


@router.get("/courses/{course_id}/sections/{section_id}")
async def get_section(
    course_id: uuid.UUID, section_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)
    section = await _get_section_in_course(db, section_id, course_id)
    students = (await db.execute(
        select(User.id, User.name, User.email)
        .join(SectionEnrollment, SectionEnrollment.student_id == User.id)
        .where(SectionEnrollment.section_id == section_id, User.is_preview.is_(False))
        .order_by(User.name)
    )).all()
    invites = (await db.execute(
        select(SectionInvite)
        .where(SectionInvite.section_id == section_id, SectionInvite.status == "pending")
        .order_by(SectionInvite.created_at.desc())
    )).scalars().all()
    return {
        "id": str(section.id), "name": section.name,
        "join_code": section.join_code,
        "enrollment_open": section.enrollment_open,
        "students": [{"id": str(s.id), "name": s.name, "email": s.email} for s in students],
        "pending_invites": [_serialize_invite(i) for i in invites],
    }


@router.delete("/courses/{course_id}/sections/{section_id}")
async def delete_section(
    course_id: uuid.UUID, section_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await get_teacher_course(db, course_id, current_user.user_id)
    section = await _get_section_in_course(db, section_id, course_id)
    # Cascades to enrollments, invites, assignment_sections, and ALL student
    # submissions for assignments in this section. Student accounts survive —
    # only their work in this section is lost.
    #
    # Recorded BEFORE the delete, and the destructiveness is why: this is
    # the one roster action that discards student work, and the name is
    # the only thing that makes the entry readable once the row is gone.
    await record_activity(
        db, current_user, "section.delete", "section", section_id,
        {"name": section.name, "course_id": str(course_id)},
    )
    await db.delete(section)
    await db.commit()
    logger.info(
        "AUDIT: teacher=%s deleted section=%s from course=%s",
        current_user.user_id, section_id, course_id,
    )
    return {"status": "ok"}


@router.patch("/courses/{course_id}/sections/{section_id}")
async def update_section(
    course_id: uuid.UUID, section_id: uuid.UUID, body: UpdateSectionRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await get_teacher_course(db, course_id, current_user.user_id)
    section = await _get_section_in_course(db, section_id, course_id)
    if body.name is not None:
        section.name = body.name
    if body.enrollment_open is not None:
        section.enrollment_open = body.enrollment_open
    await db.commit()
    if body.name is not None:
        logger.info(
            "AUDIT: teacher=%s renamed section=%s",
            current_user.user_id, section_id,
        )
    if body.enrollment_open is not None:
        logger.info(
            "AUDIT: teacher=%s set enrollment_open=%s on section=%s",
            current_user.user_id, body.enrollment_open, section_id,
        )
    return {"status": "ok"}


# --- Roster (invite + remove) ---


@router.post("/courses/{course_id}/sections/{section_id}/invites")
async def invite_student(
    course_id: uuid.UUID, section_id: uuid.UUID, body: InviteStudentRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Invite a student to a section by email.

    If a user with that email already exists, enroll them immediately (no
    email sent). Otherwise create (or refresh) a pending invite and send
    an email with a claim link. Resending an already-pending invite is
    idempotent: we refresh the token + expiry and send a fresh email.
    """
    course = await get_teacher_course(db, course_id, current_user.user_id)
    section = await _get_section_in_course(db, section_id, course_id)
    email = body.email.lower()

    existing_user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if existing_user is not None:
        # Read the ids we need OUT of the ORM now, into plain locals.
        #
        # `db.rollback()` expires every instance in the session, so any
        # attribute read after one triggers a lazy refresh — which is IO,
        # and in async that raises MissingGreenlet rather than reloading.
        # Both IntegrityError recovery branches below run after a
        # rollback, so every one of them was dead code: the losing side of
        # a race 500'd on the first `existing_user.id` it touched instead
        # of recovering. Same for the audit-failure path, which is why
        # wrapping that commit did not actually stop a landed enrollment
        # from returning a 500.
        student_id = existing_user.id
        already_enrolled = (await db.execute(
            select(SectionEnrollment.id).where(
                SectionEnrollment.section_id == section_id,
                SectionEnrollment.student_id == student_id,
            )
        )).scalar_one_or_none() is not None
        if already_enrolled:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Student already in section")
        # Block if the student is in a different section of this same course.
        other_section_name = (await db.execute(
            select(Section.name)
            .join(SectionEnrollment, SectionEnrollment.section_id == Section.id)
            .where(
                SectionEnrollment.student_id == student_id,
                SectionEnrollment.course_id == course_id,
            )
        )).scalar_one_or_none()
        if other_section_name:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Student is already enrolled in {other_section_name} for this class.",
            )
        db.add(SectionEnrollment(
            section_id=section_id,
            course_id=course_id,
            student_id=student_id,
        ))
        _stamp_school_id(existing_user, course)
        # Did THIS request create the enrollment? Only the winner of a race
        # should log one — see the rollback branch below.
        this_request_enrolled = True
        try:
            await db.commit()
        except IntegrityError:
            # Raced with another invite. Two constraints can fire:
            # - uq_section_student: another invite enrolled them into THIS
            #   section. Student is where we want them — treat as success.
            # - uq_section_enrollments_student_course: another invite
            #   enrolled them into a DIFFERENT section of the same course.
            #   Surface the same 409 the pre-check would have raised so the
            #   audit + response don't lie about which section won.
            await db.rollback()
            # Our INSERT was rolled back, so whatever is there now was
            # written by the request we raced. We report success (the
            # student is where the teacher wanted them) but must not log
            # a second enrollment for one enrollment — the winner already
            # logged it.
            this_request_enrolled = False
            landed_in_requested_section = (await db.execute(
                select(SectionEnrollment.id).where(
                    SectionEnrollment.section_id == section_id,
                    SectionEnrollment.student_id == student_id,
                )
            )).scalar_one_or_none() is not None
            if not landed_in_requested_section:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Student is already enrolled in another section of this class.",
                ) from None
        if this_request_enrolled:
            # Recorded after the enrollment's own commit, so this needs a
            # commit of its own — wrapped, because the enrollment has
            # ALREADY landed and an audit-row failure must not turn a
            # successful enrollment into a 500. Same contract
            # `record_activity` and `log_student_record_access` both hold.
            await record_activity(
                db, current_user, "section.enroll_student", "section", section_id,
                {"student_id": str(student_id)},
            )
            try:
                await db.commit()
            except Exception:
                await db.rollback()
                logger.exception(
                    "could not commit enrollment activity for section=%s",
                    section_id,
                )
        logger.info(
            "AUDIT: teacher=%s enrolled existing user=%s into section=%s",
            current_user.user_id, student_id, section_id,
        )
        return {"status": "enrolled", "student_id": str(student_id)}

    # Inviting is the TEACHER's action, and for a student who does not yet
    # have an account it is the only one — the enrollment itself happens
    # later, when the student claims the invite, which is a student action
    # and deliberately stays out of this log. Without recording the invite,
    # a school onboarding thirty new students produced zero roster
    # activity: exactly the "idle school" reading this exists to prevent.
    #
    # No email in the metadata. The activity log is a compliance surface
    # and an invitee's address is not needed to make the entry legible.
    # NOT inside the try below. `record_activity` opens a nested
    # transaction, and SQLAlchemy flushes the session when it takes that
    # savepoint — which would push the pending invite INSERT out early,
    # in the OUTER transaction with no savepoint protecting it. On a race
    # the unique-index violation then fires INSIDE record_activity, which
    # swallows it and logs an unrelated message, leaving the session
    # unusable so the IntegrityError handler below never runs and the
    # request 500s with a misleading trail.
    # Captured BEFORE the try, because the IntegrityError branch below
    # rolls back — and a rollback expires EVERY instance in the session,
    # not just the ones it wrote. `invite` survives only because it is
    # explicitly refreshed afterwards; `section` and `course` are not,
    # so reading their names later is a lazy load, i.e. IO, i.e.
    # MissingGreenlet in async. An earlier version of this fix hoisted
    # these above the AUDIT rollback but not this one, which left the
    # same 500 thirty lines further up.
    invite_section_name = section.name
    invite_course_name = course.name

    is_new_invite = False
    try:
        # Only a genuinely NEW invite is worth a line. The helper is
        # idempotent — re-inviting a still-pending email refreshes the
        # token — and logging that as a fresh invite would let one email
        # clicked twice read as two students onboarded. The helper reports
        # which it did, so no second SELECT (which was racy both ways).
        invite, created = await _create_or_refresh_invite(
            db, section_id, email, current_user.user_id,
        )
        await db.commit()
        is_new_invite = created
    except IntegrityError:
        # Raced with another invite. The partial unique index on
        # (section_id, email) WHERE status='pending' ensures exactly
        # one pending row wins; re-read it and continue as if we were
        # the refresher.
        await db.rollback()
        invite = (await db.execute(
            select(SectionInvite).where(
                SectionInvite.section_id == section_id,
                SectionInvite.email == email,
                SectionInvite.status == "pending",
            )
        )).scalar_one()
    await db.refresh(invite)

    # `invite` is safe to read here — it was just refreshed — but read it
    # out now anyway, because the audit commit below can also roll back.
    # The section and course names were captured before the try.
    invite_payload = _serialize_invite(invite)
    invite_token = invite.token
    invite_id = invite.id

    if is_new_invite:
        # After the invite's own commit, so this needs its own — and the
        # invite has already landed, so an audit-row failure must not turn
        # it into a 500.
        await record_activity(
            db, current_user, "section.invite_student", "section", section_id,
            {"course_id": str(course_id)},
        )
        try:
            await db.commit()
        except Exception:
            await db.rollback()
            logger.exception(
                "could not commit invite activity for section=%s", section_id,
            )

    _send_invite_email(
        email=email,
        token=invite_token,
        section_name=invite_section_name,
        course_name=invite_course_name,
        teacher_name=current_user.name,
    )
    logger.info(
        "AUDIT: teacher=%s invited email=%s to section=%s, invite=%s",
        current_user.user_id, email, section_id, invite_id,
    )
    return {
        "status": "invited",
        "invite": invite_payload,
    }


@router.get("/courses/{course_id}/sections/{section_id}/invites")
async def list_invites(
    course_id: uuid.UUID, section_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)
    await _get_section_in_course(db, section_id, course_id)
    invites = (await db.execute(
        select(SectionInvite)
        .where(SectionInvite.section_id == section_id, SectionInvite.status == "pending")
        .order_by(SectionInvite.created_at.desc())
    )).scalars().all()
    return {"invites": [_serialize_invite(i) for i in invites]}


@router.delete("/courses/{course_id}/sections/{section_id}/invites/{invite_id}")
async def revoke_invite(
    course_id: uuid.UUID, section_id: uuid.UUID, invite_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await get_teacher_course(db, course_id, current_user.user_id)
    await _get_section_in_course(db, section_id, course_id)
    invite = (await db.execute(
        select(SectionInvite).where(
            SectionInvite.id == invite_id, SectionInvite.section_id == section_id)
    )).scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")
    if invite.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Invite is {invite.status}")
    invite.status = "revoked"
    await db.commit()
    logger.info("AUDIT: teacher=%s revoked invite=%s", current_user.user_id, invite_id)
    return {"status": "ok"}


@router.post("/courses/{course_id}/sections/{section_id}/invites/{invite_id}/resend")
async def resend_invite(
    course_id: uuid.UUID, section_id: uuid.UUID, invite_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    course = await get_teacher_course(db, course_id, current_user.user_id)
    section = await _get_section_in_course(db, section_id, course_id)
    invite = (await db.execute(
        select(SectionInvite).where(
            SectionInvite.id == invite_id, SectionInvite.section_id == section_id)
    )).scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")
    if invite.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Invite is {invite.status}")
    invite.token = secrets.token_urlsafe(32)
    invite.expires_at = datetime.now(UTC) + timedelta(days=INVITE_EXPIRY_DAYS)
    await db.commit()
    await db.refresh(invite)

    _send_invite_email(
        email=invite.email,
        token=invite.token,
        section_name=section.name,
        course_name=course.name,
        teacher_name=current_user.name,
    )
    logger.info("AUDIT: teacher=%s resent invite=%s", current_user.user_id, invite_id)
    return {"status": "ok", "invite": _serialize_invite(invite)}


@router.delete("/courses/{course_id}/sections/{section_id}/students/{student_id}")
async def remove_student(
    course_id: uuid.UUID, section_id: uuid.UUID, student_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await get_teacher_course(db, course_id, current_user.user_id)
    # IDOR guard: confirm the section actually belongs to the course in
    # the URL — without this, a teacher of course A could remove students
    # from course B by guessing section_ids since the DELETE filter only
    # used section_id + student_id.
    section = (await db.execute(
        select(Section).where(Section.id == section_id, Section.course_id == course_id)
    )).scalar_one_or_none()
    if not section:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Section not found in this course")
    deleted = await db.execute(
        delete(SectionEnrollment).where(
            SectionEnrollment.section_id == section_id, SectionEnrollment.student_id == student_id)
    )
    if deleted.rowcount == 0:  # type: ignore[attr-defined]
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not in section")
    # Ids only — no name, no email. The activity log is a compliance
    # surface with a keep-it-small contract, and a roster change does not
    # need to carry a student's identity to be legible.
    await record_activity(
        db, current_user, "section.remove_student", "section", section_id,
        {"student_id": str(student_id)},
    )
    await db.commit()
    logger.info(
        "AUDIT: teacher=%s removed student=%s from section=%s",
        current_user.user_id, student_id, section_id,
    )
    return {"status": "ok"}


# --- Join codes ---


@router.post("/courses/{course_id}/sections/{section_id}/join-code")
async def generate_join_code(
    course_id: uuid.UUID, section_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)
    section = await _get_section_in_course(db, section_id, course_id)
    section.join_code = await _generate_unique_join_code(db)
    await db.commit()
    logger.info(
        "AUDIT: teacher=%s rotated join_code on section=%s",
        current_user.user_id, section_id,
    )
    return {"join_code": section.join_code}


@router.post("/join")
@limiter.limit("10/minute")
async def join_section(
    request: Request,
    body: JoinSectionRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Any authenticated user can join a section by code."""
    section = (await db.execute(
        select(Section).where(Section.join_code == body.join_code)
    )).scalar_one_or_none()
    if not section:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid join code")
    # Scope, deliberate and load-bearing: closing enrollment shuts the
    # JOIN CODE only. A code is a broadcast channel — it leaks to group
    # chats and whiteboards, and shutting it is the whole point. The
    # teacher's own routes in stay open (sending an invite, a student
    # redeeming one at /auth/register or /auth/invite/section/claim, and
    # adding an already-registered student below at invite_student),
    # because each is addressed to one student and already has its own
    # revoke. `test_closed_enrollment_still_honours_email_invites` and
    # `test_closed_enrollment_still_admits_an_invited_existing_student`
    # pin this — if you decide closure should be absolute, those are the
    # tests to change, and there are four call sites, not two.
    if not section.enrollment_open:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This class is closed to new students right now. "
                   "Ask your teacher to reopen it or send you an invite.",
        )
    already_in_section = (await db.execute(
        select(SectionEnrollment.id).where(
            SectionEnrollment.section_id == section.id,
            SectionEnrollment.student_id == current_user.user_id,
        )
    )).scalar_one_or_none() is not None
    if already_in_section:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already in this section")
    # One enrollment per (student, course) — a student who's already in
    # another section of this course can't join a second one. Gives a
    # cleaner error than hitting the DB unique constraint.
    other_section_name = (await db.execute(
        select(Section.name)
        .join(SectionEnrollment, SectionEnrollment.section_id == Section.id)
        .where(
            SectionEnrollment.student_id == current_user.user_id,
            SectionEnrollment.course_id == section.course_id,
        )
    )).scalar_one_or_none()
    if other_section_name:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You're already enrolled in {other_section_name} for this class.",
        )
    db.add(SectionEnrollment(
        section_id=section.id,
        course_id=section.course_id,
        student_id=current_user.user_id,
    ))

    # Stamp school_id on the joining user (if not already set) so the
    # frontend role gate routes them to /school/student. Never overwrite
    # an existing school_id — that would silently move them between schools.
    user = (await db.execute(
        select(User).where(User.id == current_user.user_id)
    )).scalar_one_or_none()
    course = (await db.execute(
        select(Course).where(Course.id == section.course_id)
    )).scalar_one_or_none()
    if user is not None and course is not None:
        _stamp_school_id(user, course)

    await db.commit()
    return {"status": "ok", "section_id": str(section.id)}


# --- Helpers ---


async def _get_section_in_course(db: AsyncSession, section_id: uuid.UUID, course_id: uuid.UUID) -> Section:
    section = (await db.execute(
        select(Section).where(Section.id == section_id, Section.course_id == course_id)
    )).scalar_one_or_none()
    if not section:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Section not found")
    return section


async def _create_or_refresh_invite(
    db: AsyncSession, section_id: uuid.UUID, email: str, invited_by: uuid.UUID,
) -> tuple[SectionInvite, bool]:
    """Create a new pending invite or refresh an existing one.

    Returns (invite, created). The flag exists so the caller can tell a
    genuinely new invite from an idempotent resend without running its
    own second SELECT — which was racy in both directions: a concurrent
    accept between the two queries made a new invite log nothing, and a
    concurrent create made a refresh log as new.
    """
    existing_invite = (await db.execute(
        select(SectionInvite).where(
            SectionInvite.section_id == section_id,
            SectionInvite.email == email,
            SectionInvite.status == "pending",
        )
    )).scalar_one_or_none()
    expires = datetime.now(UTC) + timedelta(days=INVITE_EXPIRY_DAYS)
    if existing_invite:
        existing_invite.token = secrets.token_urlsafe(32)
        existing_invite.expires_at = expires
        existing_invite.invited_by = invited_by
        return existing_invite, False
    invite = SectionInvite(
        section_id=section_id,
        email=email,
        invited_by=invited_by,
        token=secrets.token_urlsafe(32),
        expires_at=expires,
    )
    db.add(invite)
    return invite, True


def _stamp_school_id(user: User, course: Course) -> None:
    """If the user isn't already linked to a school, link them to the course's
    school. Same semantics as join_section: never overwrite an existing school.

    Post-bp1000059 every course has a school (institutional or
    individual), so the only branch worth keeping is the "don't
    clobber an existing link" guard.
    """
    if user.school_id is None:
        user.school_id = course.school_id


def _serialize_invite(invite: SectionInvite) -> dict[str, Any]:
    return {
        "id": str(invite.id),
        "email": invite.email,
        "status": invite.status,
        "expires_at": invite.expires_at.isoformat(),
        "created_at": invite.created_at.isoformat(),
    }


def _send_invite_email(
    *, email: str, token: str, section_name: str, course_name: str, teacher_name: str,
) -> None:
    # Escape anything teacher/course/section-controlled before dropping
    # it into an HTML string. Token is generated by secrets.token_urlsafe,
    # so it's already safe for a URL attribute.
    safe_teacher = html.escape(teacher_name, quote=True)
    safe_course = html.escape(course_name, quote=True)
    safe_section = html.escape(section_name, quote=True)
    invite_url = f"{settings.frontend_url}/invite/section?token={token}"
    body_html = (
        f"<h2>You're invited!</h2>"
        f"<p><strong>{safe_teacher}</strong> invited you to join "
        f"<strong>{safe_course}</strong> — {safe_section} on Veradic AI.</p>"
        f"<p>Click the link below to accept the invite. If you don't have "
        f"an account yet, you'll be able to create one.</p>"
        f'<p><a href="{invite_url}" style="display:inline-block;padding:12px 24px;'
        f'background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;'
        f'font-weight:600;">Accept Invite</a></p>'
        f'<p style="color:#64748b;font-size:13px;">This invite expires in {INVITE_EXPIRY_DAYS} days.</p>'
    )
    async def _send_with_logging() -> None:
        try:
            await send_email(
                to=[email],
                subject=f"You're invited to join {course_name} on Veradic AI",
                html=body_html,
            )
        except Exception:
            logger.exception("Failed to send invite email to %s", email)

    asyncio.create_task(_send_with_logging())
