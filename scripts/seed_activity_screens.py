"""Seed one activity row per instrumented teacher action, by DRIVING THE
REAL ENDPOINTS.

Every row here is written by the handler that ships, not hand-composed —
which matters, because the point of the screenshot this seeds is to prove
the console renders what the handlers ACTUALLY record. A seed that invents
its own metadata proves only that the renderer can render the seed.

The one exception is `integrity.resolve`: its precondition is a submitted
homework with a completed integrity check, which no teacher endpoint
creates. Those two rows are inserted directly and the RESOLVE ITSELF still
goes through the real endpoint — the same split the test suite uses.

## DESTRUCTIVE — read before running

This **deletes every row in `activity_log`** on the database
`DATABASE_URL` points at, so the seeded timeline is the only thing on
screen. `activity_log` is a compliance surface, and in production it is
the audit trail — deleting it there would be unrecoverable. So this
refuses to run unless the database is unmistakably local: a loopback host
AND a database name carrying a dev/test marker. Neither check is clever;
that is the point.

It also leaves behind the course, unit and assignment it created, so the
teacher page has something to show. Re-running is safe and additive:
another course each time, and a fresh timeline.

Usage:  DATABASE_URL=postgresql+asyncpg://…@localhost/mathapp_dev \\
            python -m scripts.seed_activity_screens
"""
from __future__ import annotations

import asyncio
import base64
import sys
import uuid
from urllib.parse import urlparse

from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from api.config import settings
from api.database import get_session_factory
from api.main import app
from api.models.activity_log import ActivityLog
from api.models.assignment import Assignment, Submission
from api.models.integrity_check import IntegrityCheckSubmission
from api.models.user import User

TEACHER_EMAIL = "teacher@veradic.dev"
TEACHER_PASSWORD = "teach"

# A database name must contain one of these to be considered disposable.
LOCAL_DB_MARKERS = ("dev", "test", "local", "quality", "screens", "seed")
LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "::1", "")


def _refuse_unless_local() -> None:
    """Refuse to wipe `activity_log` on anything but an obvious dev box.

    Two independent checks, because either alone is too easy to satisfy by
    accident: a tunnelled production database can be reached on localhost,
    and a dev database can be hosted remotely.
    """
    url = urlparse(settings.database_url.replace("+asyncpg", ""))
    host = (url.hostname or "").lower()
    name = (url.path or "").lstrip("/").lower()

    problems = []
    if host not in LOOPBACK_HOSTS:
        problems.append(f"host {host!r} is not loopback")
    if not any(m in name for m in LOCAL_DB_MARKERS):
        problems.append(
            f"database {name!r} carries no dev marker "
            f"({', '.join(LOCAL_DB_MARKERS)})"
        )
    if problems:
        print(
            "REFUSING TO RUN — this deletes every row in activity_log, which\n"
            "is the audit trail. Target does not look like a dev database:\n"
            + "".join(f"  - {p}\n" for p in problems)
            + f"\n  DATABASE_URL host={host!r} database={name!r}\n",
            file=sys.stderr,
        )
        raise SystemExit(1)
    print(f"target: {name} on {host or 'local socket'} — wiping activity_log\n")

TINY_PNG = base64.b64encode(base64.b64decode(
    b"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8"
    b"/x8AAusB9YpO3vQAAAAASUVORK5CYII="
)).decode()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def main() -> None:
    _refuse_unless_local()

    async with get_session_factory()() as s:
        await s.execute(delete(ActivityLog))
        await s.commit()
        # Ordered, so the same student is borrowed on every run. Without it
        # the choice is whatever Postgres returns first, which makes the
        # seeded ids — and therefore the screenshots — differ run to run.
        student = (await s.execute(
            select(User).where(User.role == "student")
            .order_by(User.email.asc()).limit(1)
        )).scalar_one()
        student_id, student_email = student.id, student.email

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        login = await c.post("/v1/auth/login", json={
            "email": TEACHER_EMAIL, "password": TEACHER_PASSWORD,
        })
        login.raise_for_status()
        token = login.json()["access_token"]
        h = _auth(token)

        # ── course.create
        course = await c.post("/v1/teacher/courses", headers=h, json={
            "name": "Algebra I — Period 4", "subject": "math", "grade_level": 9,
        })
        course.raise_for_status()
        course_id = course.json()["id"]

        # ── section.create
        section = await c.post(
            f"/v1/teacher/courses/{course_id}/sections", headers=h,
            json={"name": "Period 4"},
        )
        section.raise_for_status()
        section_id = section.json()["id"]

        # ── section.invite_student (no account yet)
        r = await c.post(
            f"/v1/teacher/courses/{course_id}/sections/{section_id}/invites",
            headers=h, json={"email": f"newcomer{uuid.uuid4().hex[:6]}@example.com"},
        )
        r.raise_for_status()

        # ── section.enroll_student (email already has an account)
        r = await c.post(
            f"/v1/teacher/courses/{course_id}/sections/{section_id}/invites",
            headers=h, json={"email": student_email},
        )
        r.raise_for_status()

        # ── document.upload (needs a unit to hang off)
        unit = await c.post(
            f"/v1/teacher/courses/{course_id}/units", headers=h,
            json={"name": "Chapter 3 — Linear Equations"},
        )
        unit.raise_for_status()
        doc = await c.post(
            f"/v1/teacher/courses/{course_id}/documents", headers=h, json={
                "file_base64": TINY_PNG,
                "filename": "chapter-3-linear-equations.png",
                "unit_id": unit.json()["id"],
            },
        )
        doc.raise_for_status()
        document_id = doc.json()["id"]

        # ── integrity.resolve — precondition seeded, ruling is real.
        async with get_session_factory()() as s:
            assignment = Assignment(
                course_id=uuid.UUID(course_id), title="Homework 5",
                teacher_id=(await s.execute(
                    select(User.id).where(User.email == TEACHER_EMAIL)
                )).scalar_one(),
                type="homework", status="published", unit_ids=[],
            )
            s.add(assignment)
            await s.flush()
            submission = Submission(
                assignment_id=assignment.id, student_id=student_id,
                section_id=uuid.UUID(section_id), status="submitted",
            )
            s.add(submission)
            await s.flush()
            submission_id = submission.id
            s.add(IntegrityCheckSubmission(
                submission_id=submission_id, status="complete",
                disposition="flag_for_review",
            ))
            await s.commit()

        r = await c.post(
            f"/v1/teacher/integrity/submissions/{submission_id}/resolve",
            headers=h, json={"resolution": "cleared"},
        )
        r.raise_for_status()

        # ── section.remove_student
        r = await c.delete(
            f"/v1/teacher/courses/{course_id}/sections/{section_id}"
            f"/students/{student_id}",
            headers=h,
        )
        r.raise_for_status()

        # ── document.delete
        r = await c.delete(
            f"/v1/teacher/courses/{course_id}/documents/{document_id}", headers=h,
        )
        r.raise_for_status()

        # ── section.delete
        r = await c.delete(
            f"/v1/teacher/courses/{course_id}/sections/{section_id}", headers=h,
        )
        r.raise_for_status()

        # ── course.delete — a SECOND course, so the one above survives for
        #    the screenshot rather than cascading its own rows away.
        doomed = await c.post("/v1/teacher/courses", headers=h, json={
            "name": "Geometry — retired section", "subject": "math",
            "grade_level": 10,
        })
        doomed.raise_for_status()
        r = await c.delete(f"/v1/teacher/courses/{doomed.json()['id']}", headers=h)
        r.raise_for_status()

    async with get_session_factory()() as s:
        rows = list((await s.execute(
            select(ActivityLog).order_by(ActivityLog.performed_at.asc())
        )).scalars().all())

    print(f"{len(rows)} activity rows, written by the real handlers:\n")
    for r_ in rows:
        print(f"  {r_.action:<28} target={r_.target_type:<11} "
              f"school={'set' if r_.school_id else 'NULL':<4} {r_.action_metadata}")
    actions = {r_.action for r_ in rows}
    expected = {
        "course.create", "course.delete", "section.create", "section.delete",
        "section.enroll_student", "section.invite_student",
        "section.remove_student", "document.upload", "document.delete",
        "integrity.resolve",
    }
    missing = expected - actions
    print("\nmissing:", ", ".join(sorted(missing)) if missing else "none — all 10 present")


if __name__ == "__main__":
    asyncio.run(main())
