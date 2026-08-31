"""Teacher actions that must leave a trace in `activity_log`.

The school console can only show what a school is DOING if the doing is
recorded. `record_activity` is called by hand at each mutation, so
coverage is whatever someone remembered — and the actions below were all
silent, which made a school mid-onboarding read as an idle one.

Two of these are load-bearing beyond the feed:

- **Integrity rulings.** A teacher deciding whether a student was
  dishonest is the most consequential judgment in the product. It was
  stamped on the check row, so it was recoverable — but only if you knew
  to go looking, and it could never appear in a timeline.
- **Deletes.** A section delete discards student work and a course delete
  takes the class with it. Those must be recorded BEFORE the row goes,
  or the entry is unreadable afterwards.

These tests assert the trace exists and carries no student identity
beyond an id — `activity_log` is a compliance surface with an explicit
keep-it-small contract.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.database import get_session_factory
from api.models.activity_log import ActivityLog
from tests.conftest import auth_headers as _auth

pytestmark = pytest.mark.asyncio


async def _actions() -> list[ActivityLog]:
    async with get_session_factory()() as s:
        return list((await s.execute(
            select(ActivityLog).order_by(ActivityLog.performed_at.asc())
        )).scalars().all())


async def _clear() -> None:
    async with get_session_factory()() as s:
        for row in (await s.execute(select(ActivityLog))).scalars().all():
            await s.delete(row)
        await s.commit()


async def _own_course(world: dict[str, Any]) -> uuid.UUID:
    """Link the fixture teacher to the course and return its id.

    The shared `world` fixture creates no CourseTeacher row, and every
    teacher course endpoint authorizes through it. Done here rather than
    in the fixture: a dozen other modules depend on `world`, and widening
    its permissions could quietly weaken an authorization assertion
    somewhere else. Same approach as tests/test_question_edits.py.
    """
    from api.models.course import Course, CourseTeacher
    from api.models.question_bank import QuestionBankItem

    async with get_session_factory()() as s:
        course_id = (await s.execute(
            select(QuestionBankItem.course_id).where(
                QuestionBankItem.id == uuid.UUID(str(world["primary_id"])),
            )
        )).scalar_one()
        exists = (await s.execute(
            select(CourseTeacher).where(
                CourseTeacher.course_id == course_id,
                CourseTeacher.teacher_id == world["teacher_id"],
            )
        )).scalar_one_or_none()
        if exists is None:
            s.add(CourseTeacher(
                course_id=course_id, teacher_id=world["teacher_id"],
            ))
        course = (await s.execute(
            select(Course).where(Course.id == course_id)
        )).scalar_one()
        if getattr(course, "teacher_id", None) is None:
            course.teacher_id = world["teacher_id"]
        await s.commit()
        return course_id


async def _course_id(world: dict[str, Any]) -> uuid.UUID:
    from api.models.question_bank import QuestionBankItem

    async with get_session_factory()() as s:
        return (await s.execute(
            select(QuestionBankItem.course_id).where(
                QuestionBankItem.id == uuid.UUID(str(world["primary_id"])),
            )
        )).scalar_one()


async def test_creating_a_section_is_recorded(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """Opening a class period is often a school's first real action. It
    was written to stdout as an AUDIT line — real, but not queryable, so
    no timeline could ever show it."""
    await _clear()
    course_id = await _own_course(world)
    r = await client.post(
        f"/v1/teacher/courses/{course_id}/sections",
        headers=_auth(world["teacher_token"]), json={"name": "Period 7"},
    )
    assert r.status_code == 201, r.text

    rows = [a for a in await _actions() if a.action == "section.create"]
    assert len(rows) == 1
    assert rows[0].action_metadata["name"] == "Period 7"
    assert rows[0].actor_role == "teacher"
    # Without a target the entry cannot be linked back to the section it
    # is about, which is most of what makes a feed row useful.
    assert str(rows[0].target_id) == r.json()["id"]


async def test_deleting_a_section_is_recorded_with_its_name(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """A section delete discards every submission in it. Recording after
    the delete would still read a live `section.name`, because the session
    factory sets `expire_on_commit=False` — so what this pins is the record
    being made at all and carrying a readable name, not the ordering."""
    course_id = await _own_course(world)
    created = await client.post(
        f"/v1/teacher/courses/{course_id}/sections",
        headers=_auth(world["teacher_token"]), json={"name": "Doomed"},
    )
    assert created.status_code == 201, created.text
    section_id = created.json()["id"]
    await _clear()

    r = await client.delete(
        f"/v1/teacher/courses/{course_id}/sections/{section_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text

    rows = [a for a in await _actions() if a.action == "section.delete"]
    assert len(rows) == 1
    # The entry has to name the class a human would recognise; an id alone
    # is unreadable once the row it points at is gone.
    assert rows[0].action_metadata["name"] == "Doomed"


async def test_deleting_a_course_is_recorded_with_its_name(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """A course delete takes the whole class with it — sections, roster,
    assignments, student work. It is the most destructive thing a teacher
    can do here, so it has to leave an entry, and the entry has to name
    the class: the course row is gone, so an id alone resolves to
    nothing anyone can read."""
    created = await client.post(
        "/v1/teacher/courses",
        headers=_auth(world["teacher_token"]),
        json={"name": "Doomed Class", "subject": "math", "grade_level": 9},
    )
    assert created.status_code in (200, 201), created.text
    course_id = created.json()["id"]
    await _clear()

    r = await client.delete(
        f"/v1/teacher/courses/{course_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text

    rows = [a for a in await _actions() if a.action == "course.delete"]
    assert len(rows) == 1
    assert rows[0].action_metadata["name"] == "Doomed Class"
    assert str(rows[0].target_id) == course_id
    # The class is genuinely gone — this is not a soft delete, which is
    # exactly why the entry is the only remaining record of it.
    gone = await client.get(
        f"/v1/teacher/courses/{course_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert gone.status_code == 404, gone.text


async def test_an_integrity_ruling_is_recorded(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """A teacher deciding whether a student was dishonest is the most
    consequential judgment in the product. It was stamped on the check
    row and nowhere else, so it could never appear in a timeline.

    The AI's disposition rides along because the interesting cases are
    the disagreements — the agent flagged it, the teacher cleared it.
    Without both halves the entry cannot show one.
    """
    from api.models.assignment import Submission
    from api.models.integrity_check import IntegrityCheckSubmission
    from api.models.section_enrollment import SectionEnrollment

    await _own_course(world)
    async with get_session_factory()() as s:
        section_id = (await s.execute(
            select(SectionEnrollment.section_id).where(
                SectionEnrollment.student_id == world["student_id"],
            )
        )).scalars().first()
        assert section_id is not None, "world fixture should enroll the student"
        sub = Submission(
            assignment_id=world["assignment_id"],
            student_id=world["student_id"],
            section_id=section_id,
            status="submitted",
        )
        s.add(sub)
        await s.flush()
        submission_id = sub.id
        # The agent flagged it; the teacher is about to disagree.
        s.add(IntegrityCheckSubmission(
            submission_id=submission_id,
            status="complete",
            disposition="flag_for_review",
        ))
        await s.commit()

    await _clear()
    r = await client.post(
        f"/v1/teacher/integrity/submissions/{submission_id}/resolve",
        headers=_auth(world["teacher_token"]),
        json={"resolution": "cleared"},
    )
    assert r.status_code == 204, r.text

    rows = [a for a in await _actions() if a.action == "integrity.resolve"]
    assert len(rows) == 1
    assert rows[0].action_metadata["resolution"] == "cleared"
    # Both halves of the disagreement, which is the point.
    assert rows[0].action_metadata["ai_disposition"] == "flag_for_review"
    assert str(rows[0].target_id) == str(submission_id)
    # Compliance contract: an id identifies the student, never a name or
    # an email, and never a word of their actual work.
    assert "name" not in rows[0].action_metadata
    assert "email" not in rows[0].action_metadata


async def test_creating_a_course_is_recorded(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    await _clear()
    r = await client.post(
        "/v1/teacher/courses",
        headers=_auth(world["teacher_token"]),
        json={"name": "Geometry", "subject": "math"},
    )
    assert r.status_code == 201, r.text

    rows = [a for a in await _actions() if a.action == "course.create"]
    assert len(rows) == 1
    assert rows[0].action_metadata["name"] == "Geometry"


async def test_a_roster_removal_records_an_id_and_no_identity(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """`activity_log` is a compliance surface with a keep-it-SMALL
    contract. A roster change does not need a student's name or email to
    be legible, and putting them there would degrade a surface other
    people depend on."""
    from api.models.section_enrollment import SectionEnrollment

    course_id = await _own_course(world)
    async with get_session_factory()() as s:
        enrollment = (await s.execute(
            select(SectionEnrollment).where(
                SectionEnrollment.course_id == course_id,
            ).limit(1)
        )).scalar_one_or_none()
    if enrollment is None:
        pytest.skip("fixture has no enrollment to remove")

    await _clear()
    r = await client.delete(
        f"/v1/teacher/courses/{course_id}/sections/{enrollment.section_id}"
        f"/students/{enrollment.student_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text

    rows = [a for a in await _actions() if a.action == "section.remove_student"]
    assert len(rows) == 1
    meta = rows[0].action_metadata
    assert meta == {"student_id": str(enrollment.student_id)}
    assert "email" not in str(meta) and "name" not in meta


async def test_inviting_a_new_student_is_recorded(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """The onboarding path that was silent.

    `section.enroll_student` only fires when the invited email ALREADY has
    an account. For a brand-new student the flow is invite -> claim, and
    the claim is a student action that deliberately stays out of this log.
    Without recording the invite, a school onboarding thirty new students
    produced zero roster activity — the exact idle-school reading this
    instrumentation exists to prevent.
    """
    course_id = await _own_course(world)
    created = await client.post(
        f"/v1/teacher/courses/{course_id}/sections",
        headers=_auth(world["teacher_token"]), json={"name": "Period 9"},
    )
    assert created.status_code == 201, created.text
    section_id = created.json()["id"]
    await _clear()

    r = await client.post(
        f"/v1/teacher/courses/{course_id}/sections/{section_id}/invites",
        headers=_auth(world["teacher_token"]),
        json={"email": "brand.new.student@example.com"},
    )
    assert r.status_code in (200, 201), r.text

    rows = [a for a in await _actions() if a.action == "section.invite_student"]
    assert len(rows) == 1
    # No email. An invitee's address is not needed to make the entry
    # legible, and this table is a compliance surface.
    assert "brand.new.student" not in str(rows[0].action_metadata)


async def test_enrolling_an_existing_student_records_an_id_and_nothing_else(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """Inviting an email that already has an account enrolls immediately,
    and this is the only new payload assembled from a live `User` row —
    every neighbouring field on it (name, email) is exactly what this
    table must never carry. Asserted as an equality, not a membership
    test: a leak is something being ADDED, which `in` cannot catch."""
    from api.core.auth import hash_password
    from api.models.user import User

    course_id = await _own_course(world)
    created = await client.post(
        f"/v1/teacher/courses/{course_id}/sections",
        headers=_auth(world["teacher_token"]), json={"name": "Period 11"},
    )
    assert created.status_code == 201, created.text
    section_id = created.json()["id"]

    email = f"existing{uuid.uuid4().hex[:8]}@example.com"
    async with get_session_factory()() as s:
        student = User(
            email=email, password_hash=hash_password("x"), grade_level=9,
            role="student", name="Enrolled Student", is_active=True,
            failed_login_attempts=0, mfa_enabled=False,
        )
        s.add(student)
        await s.commit()
        student_id = student.id

    await _clear()
    r = await client.post(
        f"/v1/teacher/courses/{course_id}/sections/{section_id}/invites",
        headers=_auth(world["teacher_token"]), json={"email": email},
    )
    assert r.status_code in (200, 201), r.text
    assert r.json()["status"] == "enrolled"

    rows = [a for a in await _actions() if a.action == "section.enroll_student"]
    assert len(rows) == 1
    assert rows[0].action_metadata == {"student_id": str(student_id)}
    assert str(rows[0].target_id) == section_id


async def test_resending_an_invite_does_not_log_a_second_student(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """Re-inviting a still-pending email refreshes its token rather than
    creating a second invite, and only a genuinely new one is worth a
    line. This is the whole reason `_create_or_refresh_invite` reports
    whether it created: without it, one teacher clicking a button twice
    reads as two students onboarded, which is precisely the false signal
    this instrumentation exists to avoid."""
    course_id = await _own_course(world)
    created = await client.post(
        f"/v1/teacher/courses/{course_id}/sections",
        headers=_auth(world["teacher_token"]), json={"name": "Period 12"},
    )
    assert created.status_code == 201, created.text
    section_id = created.json()["id"]
    email = f"resend{uuid.uuid4().hex[:8]}@example.com"
    url = f"/v1/teacher/courses/{course_id}/sections/{section_id}/invites"

    await _clear()
    first = await client.post(
        url, headers=_auth(world["teacher_token"]), json={"email": email},
    )
    assert first.status_code in (200, 201), first.text
    assert len([a for a in await _actions()
                if a.action == "section.invite_student"]) == 1

    # Same email, still pending: a refresh, not a new invite.
    again = await client.post(
        url, headers=_auth(world["teacher_token"]), json={"email": email},
    )
    assert again.status_code in (200, 201), again.text

    rows = [a for a in await _actions() if a.action == "section.invite_student"]
    assert len(rows) == 1, "a resend is not a second student onboarded"


# ── The audit row must never break the action ────────────────────────
#
# `record_activity` swallows its own errors precisely so a logging
# failure cannot fail a teacher's request. But on the two paths where the
# audit row needs its OWN commit — because the action already committed —
# that guarantee has to be reproduced by hand, and getting it wrong is
# not hypothetical: an earlier version of this file wrapped the commit in
# try/except and STILL returned a 500, because `db.rollback()` expires
# every ORM instance in the session and the next line read an expired
# attribute. In async SQLAlchemy that lazy refresh raises MissingGreenlet
# rather than reloading.
#
# The same expiry had silently made both IntegrityError recovery branches
# in this endpoint dead code for as long as they had existed.
#
# CI cannot see any of this: the failure only appears when the audit
# commit fails, which no ordinary run does. These tests force it.


async def _break_activity_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make the audit row fail at COMMIT, the way a real DB error would.

    Patched at the route's own reference, and deliberately fails on flush
    rather than raising immediately — raising inside `record_activity`
    would be swallowed by its own try/except and prove nothing. This
    leaves a poisoned session that only errors when the handler commits.
    """
    import api.routes.teacher_sections as mod

    async def _poison(db: Any, *a: Any, **kw: Any) -> None:
        # Queued, not executed: the ORM flushes this at COMMIT, where the
        # dangling actor FK fails. Executing it here instead would raise
        # inside record_activity, which is a different code path and not
        # the one the wrapper guards.
        db.add(ActivityLog(
            actor_user_id=uuid.uuid4(),   # no such user -> FK violation
            actor_role="teacher",
            action="poison",
            target_type="section",
        ))

    monkeypatch.setattr(mod, "record_activity", _poison)


async def test_an_audit_failure_does_not_break_an_enrollment(
    world: dict[str, Any], client: AsyncClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The enrollment has already committed by the time the audit row is
    written. A failure there must not turn a landed enrollment into a 500
    — the teacher would see an error for work that actually succeeded."""
    from api.models.section_enrollment import SectionEnrollment
    from api.models.user import User

    course_id = await _own_course(world)
    created = await client.post(
        f"/v1/teacher/courses/{course_id}/sections",
        headers=_auth(world["teacher_token"]), json={"name": "Audit fail A"},
    )
    assert created.status_code == 201, created.text
    section_id = created.json()["id"]

    # An email that already has an account takes the enroll-immediately
    # path. A FRESH student, because the fixture's own student is already
    # in a section of this course and would 409 before reaching the audit.
    from api.core.auth import hash_password

    student_email = f"audit{uuid.uuid4().hex[:8]}@example.com"
    async with get_session_factory()() as s:
        student = User(
            email=student_email, password_hash=hash_password("x"),
            grade_level=9, role="student", name="Audit Student",
            is_active=True, failed_login_attempts=0, mfa_enabled=False,
        )
        s.add(student)
        await s.commit()
        student_id = student.id

    await _break_activity_commit(monkeypatch)
    r = await client.post(
        f"/v1/teacher/courses/{course_id}/sections/{section_id}/invites",
        headers=_auth(world["teacher_token"]), json={"email": student_email},
    )

    # The whole point: the action succeeded, so the response must say so.
    assert r.status_code in (200, 201), r.text

    async with get_session_factory()() as s:
        landed = (await s.execute(
            select(SectionEnrollment.id).where(
                SectionEnrollment.section_id == uuid.UUID(section_id),
                SectionEnrollment.student_id == student_id,
            )
        )).scalar_one_or_none()
    assert landed is not None, "enrollment must survive an audit failure"


async def test_an_audit_failure_does_not_break_an_invite(
    world: dict[str, Any], client: AsyncClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Same contract on the invite path, which also commits before its
    audit row and then reads ORM attributes to send the email."""
    from api.models.section_invite import SectionInvite

    course_id = await _own_course(world)
    created = await client.post(
        f"/v1/teacher/courses/{course_id}/sections",
        headers=_auth(world["teacher_token"]), json={"name": "Audit fail B"},
    )
    assert created.status_code == 201, created.text
    section_id = created.json()["id"]

    await _break_activity_commit(monkeypatch)
    r = await client.post(
        f"/v1/teacher/courses/{course_id}/sections/{section_id}/invites",
        headers=_auth(world["teacher_token"]),
        json={"email": "audit.fail.invite@example.com"},
    )
    assert r.status_code in (200, 201), r.text
    # The response still carries the invite it created — proving nothing
    # downstream tripped over an expired ORM attribute.
    assert r.json()["invite"]["email"] == "audit.fail.invite@example.com"

    async with get_session_factory()() as s:
        invite = (await s.execute(
            select(SectionInvite).where(
                SectionInvite.section_id == uuid.UUID(section_id),
            )
        )).scalar_one_or_none()
    assert invite is not None, "invite must survive an audit failure"


# ── The race branches ────────────────────────────────────────────────
#
# These are where every serious defect in this endpoint has lived, and
# they had no coverage — which is exactly why a reproducible 500 survived
# six review rounds and six green CI runs.
#
# The failure mode is always the same: `db.rollback()` expires EVERY
# instance in the session, so any ORM attribute read afterwards is a lazy
# load — IO — which in async raises MissingGreenlet instead of reloading.
# Both recovery branches were dead code for exactly this reason, for as
# long as they had existed.
#
# The race is simulated rather than threaded, and WHERE the competing row
# lands is the whole game. Committing it before the request runs does not
# reproduce anything: the handler's own pre-check SELECT finds it and
# returns early, so the recovery branch never executes and the test passes
# with the defect fully present. Both tests below therefore inject the
# competing row from inside the handler's own call stack — after its
# SELECT, before its INSERT — which is the only arrangement that makes its
# commit raise IntegrityError and drive the branch.


async def test_a_losing_invite_race_still_succeeds(
    world: dict[str, Any], client: AsyncClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two teachers invite the same new email. The loser's INSERT is
    rolled back; it must still return the winning invite rather than 500
    on an expired `section.name` while sending the email."""
    from api.models.section_invite import SectionInvite

    course_id = await _own_course(world)
    created = await client.post(
        f"/v1/teacher/courses/{course_id}/sections",
        headers=_auth(world["teacher_token"]), json={"name": "Race A"},
    )
    assert created.status_code == 201, created.text
    section_id = created.json()["id"]
    email = f"race{uuid.uuid4().hex[:8]}@example.com"

    # The competing invite has to land AFTER this request's SELECT finds
    # nothing and BEFORE its INSERT — otherwise the handler simply
    # refreshes the existing row and the recovery branch never runs. An
    # earlier version of this test committed it up front and passed even
    # with the defect present, which is worse than no test at all.
    import api.routes.teacher_sections as mod

    real = mod._create_or_refresh_invite

    async def _racing(db: Any, sec_id: Any, mail: str, by: Any) -> Any:
        result = await real(db, sec_id, mail, by)   # SELECT ran, INSERT queued
        async with get_session_factory()() as other:
            other.add(SectionInvite(
                section_id=sec_id, email=mail, invited_by=by,
                token=uuid.uuid4().hex,
                expires_at=datetime.now(UTC) + timedelta(days=14),
                status="pending",
            ))
            await other.commit()                    # the other request wins
        return result

    monkeypatch.setattr(mod, "_create_or_refresh_invite", _racing)

    r = await client.post(
        f"/v1/teacher/courses/{course_id}/sections/{section_id}/invites",
        headers=_auth(world["teacher_token"]), json={"email": email},
    )
    # The student is invited — that is what the teacher asked for.
    assert r.status_code in (200, 201), r.text
    assert r.json()["invite"]["email"] == email
    # The winner logged the invite; the loser created nothing and must
    # not claim it did. Without this, `is_new_invite` could be set before
    # the commit that decides the race and nothing would notice.
    logged = [a for a in await _actions() if a.action == "section.invite_student"]
    assert len(logged) == 0, "the loser must not log an invite it didn't create"


async def test_a_losing_enrollment_race_still_succeeds(
    world: dict[str, Any], client: AsyncClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two teachers invite the same EXISTING user into the same section.
    The loser's INSERT is rolled back; it must still report success — the
    student is where the teacher wanted them — without 500ing on an
    expired `existing_user.id`, and without logging a second enrollment
    for one enrollment."""
    from sqlalchemy.ext.asyncio import AsyncSession

    from api.core.auth import hash_password
    from api.models.section_enrollment import SectionEnrollment
    from api.models.user import User

    course_id = await _own_course(world)
    created = await client.post(
        f"/v1/teacher/courses/{course_id}/sections",
        headers=_auth(world["teacher_token"]), json={"name": "Race B"},
    )
    assert created.status_code == 201, created.text
    section_id = created.json()["id"]

    email = f"raceuser{uuid.uuid4().hex[:8]}@example.com"
    async with get_session_factory()() as s:
        student = User(
            email=email, password_hash=hash_password("x"), grade_level=9,
            role="student", name="Race Student", is_active=True,
            failed_login_attempts=0, mfa_enabled=False,
        )
        s.add(student)
        await s.commit()
        student_id = student.id

    # The competing enrollment has to land after the handler's
    # `already_enrolled` SELECT and before its INSERT reaches the database.
    # The handler stages its row with `db.add` and only flushes at
    # `commit()`, so commit is the seam — but the request commits more than
    # once, and injecting at the first one lands the row before the
    # pre-check, which then returns a clean 409 and never runs the branch
    # (an earlier version of this test committed it up front and failed the
    # same way, except silently, by asserting 409 was acceptable).
    #
    # So arm on `_stamp_school_id`: the handler calls it between `db.add`
    # and `db.commit()`, which makes the very next commit the enrollment's.
    import api.routes.teacher_sections as mod

    real_stamp = mod._stamp_school_id
    real_commit = AsyncSession.commit
    armed = False
    raced = False

    def _arming_stamp(user: Any, course: Any) -> None:
        nonlocal armed
        armed = True
        real_stamp(user, course)

    async def _racing_commit(self: Any) -> None:
        nonlocal armed, raced
        if armed and not raced:
            # Cleared FIRST: the competing session's commit re-enters here.
            armed = False
            raced = True
            async with get_session_factory()() as other:
                other.add(SectionEnrollment(
                    section_id=uuid.UUID(section_id),
                    course_id=course_id,
                    student_id=student_id,
                ))
                await other.commit()
        await real_commit(self)

    monkeypatch.setattr(mod, "_stamp_school_id", _arming_stamp)
    monkeypatch.setattr(AsyncSession, "commit", _racing_commit)

    await _clear()
    r = await client.post(
        f"/v1/teacher/courses/{course_id}/sections/{section_id}/invites",
        headers=_auth(world["teacher_token"]), json={"email": email},
    )
    monkeypatch.undo()

    assert raced, "the competing row never landed — the race was not exercised"
    # The student is in the section the teacher asked for, so the teacher
    # sees success, not the 500 the expired-attribute read used to produce.
    assert r.status_code in (200, 201), r.text

    async with get_session_factory()() as s:
        rows_in_db = (await s.execute(
            select(SectionEnrollment.id).where(
                SectionEnrollment.section_id == uuid.UUID(section_id),
                SectionEnrollment.student_id == student_id,
            )
        )).scalars().all()
    assert len(rows_in_db) == 1, "one enrollment, not two"

    logged = [a for a in await _actions() if a.action == "section.enroll_student"]
    assert len(logged) == 0, "the loser must not log an enrollment it didn't make"
