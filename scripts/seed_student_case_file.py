"""Seed a student whose work stopped at every stage, and screenshot the
two surfaces that now say so.

Standalone (not a durable test) — drives an already-running stack:
    dashboard :5173 (override with DASH_BASE), API :8000

    .venv/bin/python -m scripts.seed_student_case_file

The point of the seed is the submission that got a clean Vision read and
was never confirmed. Confirming is what spawns the integrity check and
enqueues grading, so that submission is finished-looking and permanently
ungraded — and on every pre-existing surface it renders identically to a
healthy one. A local database will not contain that case by accident,
and a screenshot of an empty funnel proves nothing.

Writes docs/design/student-case-file-*.png.
"""

from __future__ import annotations

import asyncio
import base64
import io
import os
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from PIL import Image, ImageDraw
from sqlalchemy.engine import make_url

from api.config import settings
from api.core.auth import create_access_token, hash_password
from api.core.llm_client import LLMMode
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.course import Course, CourseTeacher
from api.models.grading_job import GradingJob
from api.models.llm_call import LLMCall
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from tests.harness.browser import HarnessBrowser

DASH_BASE = os.environ.get("DASH_BASE", "http://localhost:5173").rstrip("/")
OUT_DIR = Path(__file__).resolve().parents[1] / "docs" / "design"

ADMIN_ACCESS_KEY = "admin_access_token"
ADMIN_REFRESH_KEY = "admin_refresh_token"

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "postgres", "db", ""}

NOW = datetime.now(UTC)

# The pipeline's real ordering, expressed once. A submission is uploaded,
# Vision reads it seconds later, the student rules on that read, and only
# then can it be graded and published.
#
# These exist because writing the rule as a prose comment on ONE seeded
# submission let the other three drift into stamping a confirm before the
# read that confirm is about — an order the product cannot produce, which
# then silently exercised the negative-gap fallback in the lifecycle strip
# that real data never reaches. Derive the stamps; don't retype them.
READ_AFTER_SUBMIT = timedelta(seconds=11)
RULED_AFTER_READ = timedelta(minutes=3)

# One due date for every seeded assignment, so the grading jobs'
# `scheduled_for` can be bound to the same value `enqueue_submission`
# would have read off the assignment.
DUE_AT = NOW - timedelta(days=1)


def submitted(days_ago: int) -> datetime:
    return NOW - timedelta(days=days_ago)


def read_at(days_ago: int) -> datetime:
    return submitted(days_ago) + READ_AFTER_SUBMIT


def ruled_at(days_ago: int) -> datetime:
    return read_at(days_ago) + RULED_AFTER_READ


def assert_local_database() -> None:
    """Refuse to run against anything but a local database.

    This script writes users and submissions and mints an admin JWT from
    whatever DATABASE_URL and jwt_secret the environment carries. Fine
    pointed at a dev box, emphatically not fine anywhere else.
    """
    host = (make_url(settings.database_url).host or "").lower()
    if host not in _LOCAL_HOSTS:
        raise SystemExit(
            f"Refusing to run: DATABASE_URL points at {host!r}, not a local "
            "database. This script seeds data and mints an admin token."
        )


def handwriting_png() -> str:
    """A stand-in for the photographed page, base64 like the real column.

    Drawn rather than shipped as a fixture so the repo carries no image
    blob for a screenshot script. It only has to prove the photo lane
    renders at the right size beside the transcription.
    """
    img = Image.new("RGB", (620, 460), "#fbfaf6")
    d = ImageDraw.Draw(img)
    for y in range(60, 460, 44):
        d.line([(28, y), (592, y)], fill="#dfe6ef", width=1)
    lines = [
        "1)  2x + 5 = 17",
        "     2x = 12",
        "     x = 6",
        "2)  3(y - 4) = 9",
        "     y - 4 = 3",
        "     y = 7",
    ]
    for i, text in enumerate(lines):
        d.text((44, 30 + i * 44), text, fill="#1f2a3a")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def read_for(problem_count: int = 2) -> dict:
    """A Vision read shaped like the real one: steps tagged to problems,
    one final answer each, one overall confidence."""
    steps = []
    for p in range(1, problem_count + 1):
        for n, latex in enumerate(["2x = 12", "x = 6"], start=1):
            steps.append({
                "problem_position": p,
                "step_num": n,
                "latex": latex if p == 1 else latex.replace("x", "y"),
                "plain_english": None,
            })
    return {
        "steps": steps,
        "final_answers": [
            {"problem_position": p, "answer_latex": "6" if p == 1 else "7",
             "answer_plain": None}
            for p in range(1, problem_count + 1)
        ],
        "confidence": 0.91,
    }


async def seed() -> dict[str, str]:
    tag = uuid.uuid4().hex[:6]
    photo = handwriting_png()
    async with get_session_factory()() as s:
        admin = User(
            email=f"cf_admin_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="admin", name="Case File Admin",
        )
        school = School(
            name="Lincoln High", kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="Demo", contact_email=f"cf_{tag}@s.com",
        )
        s.add_all([admin, school])
        await s.flush()

        teacher = User(
            email=f"cf_teacher_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Dana Whitfield",
            school_id=school.id,
        )
        student = User(
            email=f"cf_student_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=9, role="student", name="Maya Chen",
            school_id=school.id,
        )
        s.add_all([teacher, student])
        await s.flush()

        course = Course(
            name="Algebra I", subject="math", school_id=school.id,
        )
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(
            course_id=course.id, teacher_id=teacher.id, role="owner",
        ))
        section = Section(course_id=course.id, name="Period 3")
        s.add(section)
        await s.flush()
        s.add(SectionEnrollment(
            section_id=section.id, course_id=course.id, student_id=student.id,
        ))

        async def hw(title: str, *, ai: bool = True) -> Assignment:
            a = Assignment(
                course_id=course.id, unit_ids=[], teacher_id=teacher.id,
                title=title, type="homework", status="published",
                integrity_check_enabled=ai, ai_grading_enabled=ai,
                due_at=DUE_AT,
            )
            s.add(a)
            await s.flush()
            return a

        def sub(a: Assignment, days_ago: int, **kw: object) -> Submission:
            row = Submission(
                assignment_id=a.id, student_id=student.id,
                section_id=section.id, status="submitted",
                files=[{"data": photo, "media_type": "image/jpeg",
                        "filename": "page1.jpg"}],
                submitted_at=NOW - timedelta(days=days_ago),
                **kw,  # type: ignore[arg-type]
            )
            s.add(row)
            return row

        # THE case: read landed, student never ruled. Six days and
        # counting, and nothing downstream will ever fire.
        stuck = sub(await hw("Two-Step Equations"), 6, extraction=read_for())

        # Published — the happy path, for contrast.
        done = sub(
            await hw("Fraction Operations"), 12,
            extraction=read_for(),
            extraction_confirmed_at=ruled_at(12),
        )
        # Graded, not yet published, and the teacher moved the score.
        graded = sub(
            await hw("Graphing Linear Functions"), 8,
            extraction=read_for(),
            extraction_confirmed_at=ruled_at(8),
        )
        # Student corrected the read, then confirmed — grading queued.
        repaired = sub(
            await hw("Systems of Equations"), 3,
            extraction=read_for(),
            extraction_edits={"1:2": "x = 8"},
            extraction_edited_at=ruled_at(3),
            extraction_confirmed_at=ruled_at(3),
        )
        # Student rejected the read outright — teacher grades by hand.
        flagged = sub(
            await hw("Word Problems"), 4,
            extraction=read_for(),
            extraction_flagged_at=ruled_at(4),
        )
        # A read was owed and never arrived.
        sub(await hw("Inequalities"), 2)
        # Both toggles off — the empty trace here is correct.
        sub(await hw("Exit Ticket", ai=False), 5)
        await s.flush()

        s.add_all([
            SubmissionGrade(
                submission_id=done.id, ai_score=88.0, final_score=88.0,
                graded_at=NOW - timedelta(days=11),
                grade_published_at=NOW - timedelta(days=10),
                published_final_score=88.0,
            ),
            SubmissionGrade(
                submission_id=graded.id, ai_score=72.0, final_score=90.0,
                graded_at=NOW - timedelta(days=7),
            ),
        ])
        # The grading queue, as `enqueue_submission` actually writes it.
        #
        # `scheduled_for` is set to the assignment's `due_at`, never left
        # NULL when the assignment has one — NULL means "no due date,
        # wait for a teacher" (see the GradingJob docstring), so a NULL
        # here alongside a due date asserts the opposite of the row it
        # points at. And confirming an AI-graded submission enqueues a
        # job unconditionally, so the two that carry an ai_score must
        # carry a finished job too; a published submission with no
        # grading job on record is not a state the drain can leave
        # behind.
        for target, job_status in (
            (repaired, "queued"), (done, "done"), (graded, "done"),
        ):
            s.add(GradingJob(
                submission_id=target.id,
                assignment_id=target.assignment_id,
                status=job_status,
                scheduled_for=DUE_AT,
                attempts=1 if job_status == "done" else 0,
            ))

        # The read that produced each stored extraction.
        #
        # EVERY submission carrying an `extraction` gets one, because a
        # stored read implies the call that produced it:
        # `extract_student_work` logs INTEGRITY_EXTRACT with the
        # submission_id and returns the value the pipeline persists. A
        # fixture with an extraction and no call is a state production
        # cannot reach — and seeding only the happy path that way hid a
        # header bug through five review rounds of screenshots, because
        # the stalled submission being photographed had no calls and so
        # took a branch real data never takes.
        #
        # The mode is INTEGRITY_EXTRACT, not IMAGE_EXTRACT: that is what
        # the pipeline logs, and it is the only vision mode carrying a
        # submission_id.
        for target, days in (
            (stuck, 6), (done, 12), (graded, 8), (repaired, 3), (flagged, 4),
        ):
            s.add(LLMCall(
                user_id=student.id,
                submission_id=target.id,
                function=LLMMode.INTEGRITY_EXTRACT,
                model="claude-sonnet-4-5",
                input_tokens=2400, output_tokens=310,
                latency_ms=8200.0, cost_usd=0.0121,
                success=True, retry_count=0,
                created_at=read_at(days),
            ))

        # And the grading call behind every ai_score, for the same
        # reason: `grade_submission_with_ai` logs AI_GRADING with the
        # submission_id, and nothing prunes `llm_calls` — so a scored
        # submission with no grading call is another state production
        # cannot reach. Without these the "healthy" reference screenshot
        # showed a published, 88%-AI-graded submission whose whole
        # timeline was a single Vision call: no Grading stage, no stage
        # jump pills, and wall time falling to its one-call "—" branch.
        # The multi-stage timeline that trace exists to demonstrate was
        # the one thing the picture of it did not contain.
        #
        # `repaired` gets none on purpose — its grading job is still
        # queued — and `flagged` gets none because a rejected read never
        # reaches the grader.
        for target, graded_days in ((done, 11), (graded, 7)):
            s.add(LLMCall(
                user_id=student.id,
                submission_id=target.id,
                function=LLMMode.AI_GRADING,
                model="claude-sonnet-4-5",
                input_tokens=3100, output_tokens=640,
                latency_ms=11400.0, cost_usd=0.0203,
                success=True, retry_count=0,
                created_at=submitted(graded_days),
            ))
        await s.commit()

        return {
            "admin": create_access_token(str(admin.id), "admin"),
            "student_id": str(student.id),
            "stuck_id": str(stuck.id),
            "healthy_id": str(done.id),
        }


async def shoot(hb: HarnessBrowser, token: str, path: str, name: str) -> None:
    async with hb.authed_page(
        token, token,
        access_key=ADMIN_ACCESS_KEY, refresh_key=ADMIN_REFRESH_KEY,
    ) as page:
        errors: list[str] = []
        page.on(
            "console",
            lambda m: errors.append(m.text) if m.type == "error" else None,
        )
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.set_viewport_size({"width": 1440, "height": 1200})
        await page.goto(f"{DASH_BASE}{path}", wait_until="networkidle")
        # Both pages render off a second fetch that resolves after
        # networkidle on a warm dev server; settle or the shot catches
        # the shimmer instead of the rows.
        await page.wait_for_timeout(1500)
        out = OUT_DIR / f"{name}.png"
        await page.screenshot(path=str(out), full_page=True)
        print(f"✓ {out.relative_to(OUT_DIR.parents[1])}")
        print(f"  console errors: {len(errors)}")
        for e in errors[:10]:
            print(f"    ! {e}")


async def main() -> None:
    assert_local_database()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Seeding a student whose work stopped at every stage …")
    w = await seed()
    print(f"  student:  {DASH_BASE}/students/{w['student_id']}")
    print(f"  stuck HW: {DASH_BASE}/submissions/{w['stuck_id']}/trace")

    async with HarnessBrowser(DASH_BASE) as hb:
        await shoot(
            hb, w["admin"], f"/students/{w['student_id']}",
            "student-case-file-detail",
        )
        await shoot(
            hb, w["admin"], f"/submissions/{w['stuck_id']}/trace",
            "student-case-file-trace",
        )
        # The healthy counterpart, with a real Vision call behind it —
        # the shot that proves the lifecycle strip dates its "Reader ran"
        # hop instead of rendering an em dash beside its own timeline.
        await shoot(
            hb, w["admin"], f"/submissions/{w['healthy_id']}/trace",
            "student-case-file-trace-healthy",
        )


if __name__ == "__main__":
    asyncio.run(main())
