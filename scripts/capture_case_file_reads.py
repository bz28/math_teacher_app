"""Seed one submission shaped like a real scanned-PDF homework, and
screenshot the two admin surfaces that render its read.

Standalone (not a durable test) — drives an already-running stack:
    dashboard :5173 (override with DASH_BASE), API behind it

    .venv/bin/python -m scripts.capture_case_file_reads
    DASH_BASE=http://localhost:5182 SHOT_PREFIX=before \\
        .venv/bin/python -m scripts.capture_case_file_reads

The shape is the one that broke in production: the student uploaded
multi-page PDFs rather than photos, and Vision wrote its prose answers
as LaTeX (`\\text{...}`). The case file drew the PDFs as broken <img>
icons and printed the LaTeX source. A photo is included too, so the
image lane is shown still working beside the PDF lane.

Writes docs/design/<prefix>-case-file-reads-{trace,modal}.png.
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
from playwright.async_api import ConsoleMessage
from sqlalchemy.engine import make_url

from api.config import settings
from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission
from api.models.course import Course, CourseTeacher
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from tests.harness.browser import HarnessBrowser

DASH_BASE = os.environ.get("DASH_BASE", "http://localhost:5173").rstrip("/")
SHOT_PREFIX = os.environ.get("SHOT_PREFIX", "after")
OUT_DIR = Path(__file__).resolve().parents[1] / "docs" / "design"

ADMIN_ACCESS_KEY = "admin_access_token"
ADMIN_REFRESH_KEY = "admin_refresh_token"
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "postgres", "db", ""}

NOW = datetime.now(UTC)


def assert_local_database() -> None:
    """This script writes rows and mints an admin JWT — local only."""
    host = (make_url(settings.database_url).host or "").lower()
    if host not in _LOCAL_HOSTS:
        raise SystemExit(
            f"Refusing to run: DATABASE_URL points at {host!r}, not a local "
            "database. This script seeds data and mints an admin token."
        )


def _page(lines: list[str]) -> Image.Image:
    """One ruled sheet of 'handwriting' — drawn, so the repo carries no blob."""
    img = Image.new("RGB", (850, 1100), "#fbfaf6")
    d = ImageDraw.Draw(img)
    for y in range(90, 1100, 48):
        d.line([(40, y), (810, y)], fill="#dfe6ef", width=1)
    for i, text in enumerate(lines):
        d.text((60, 58 + i * 48), text, fill="#1f2a3a")
    return img


def scanned_pdf(*pages: list[str]) -> str:
    """A multi-page image PDF — what a phone scanner app produces."""
    imgs = [_page(p) for p in pages]
    buf = io.BytesIO()
    imgs[0].save(buf, format="PDF", save_all=True, append_images=imgs[1:])
    return base64.b64encode(buf.getvalue()).decode("ascii")


def photo() -> str:
    buf = io.BytesIO()
    _page(["3)  m<1 + m<2 = 180", "     m<1 = 180 - m<2"]).save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode("ascii")


READ = {
    "steps": [
        # Prose, as Vision actually writes it: LaTeX-wrapped text.
        {"problem_position": 1, "step_num": 1, "plain_english": None,
         "latex": r"\text{a - The square root of consecutive odd integers "
                  r"results in odd products.}"},
        {"problem_position": 1, "step_num": 2, "plain_english": None,
         "latex": r"\text{b - True, deductive proof is required because "
                  r"inductive reasoning cannot cover all infinite cases.}"},
        # Real maths.
        {"problem_position": 2, "step_num": 1, "plain_english": None,
         "latex": r"m\angle 1 + m\angle 2 = 180^\circ"},
        {"problem_position": 2, "step_num": 2, "plain_english": None,
         "latex": r"m\angle 1 = \frac{180^\circ - 40^\circ}{2}"},
        # Maths with a prose tail — stays typeset as one expression.
        {"problem_position": 2, "step_num": 3, "plain_english": None,
         "latex": r"m\angle 1 = m\angle 3 \text{ (vertical angles)}"},
        # A row Vision narrated instead of transcribing.
        {"problem_position": 3, "step_num": 1, "latex": None,
         "plain_english": "Drew a two-column proof table with five rows."},
    ],
    "final_answers": [
        {"problem_position": 2, "answer_latex": r"m\angle 1 = 70^\circ",
         "answer_plain": None},
    ],
    "confidence": 0.88,
}


async def seed() -> tuple[str, str]:
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        admin = User(
            email=f"cfr_admin_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="admin", name="Case File Admin",
        )
        school = School(
            name="Lincoln High", kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="Demo", contact_email=f"cfr_{tag}@s.com",
        )
        s.add_all([admin, school])
        await s.flush()
        teacher = User(
            email=f"cfr_teacher_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Dana Whitfield", school_id=school.id,
        )
        student = User(
            email=f"cfr_student_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=10, role="student", name="Sam Rivera", school_id=school.id,
        )
        s.add_all([teacher, student])
        await s.flush()
        course = Course(name="Geometry", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        section = Section(course_id=course.id, name="Period 2")
        s.add(section)
        await s.flush()
        s.add(SectionEnrollment(
            section_id=section.id, course_id=course.id, student_id=student.id,
        ))
        asg = Assignment(
            course_id=course.id, unit_ids=[], teacher_id=teacher.id,
            title="Reasoning and Proof Review", type="homework", status="published",
            integrity_check_enabled=True, ai_grading_enabled=True,
        )
        s.add(asg)
        await s.flush()
        sub = Submission(
            assignment_id=asg.id, student_id=student.id, section_id=section.id,
            status="submitted",
            files=[
                {"data": scanned_pdf(
                    ["1a)  The square root of consecutive odd",
                     "      integers results in odd products."],
                    ["1b)  True, deductive proof is required because",
                     "      inductive reasoning cannot cover all cases."],
                 ), "media_type": "application/pdf", "filename": "scan.pdf"},
                {"data": photo(), "media_type": "image/jpeg", "filename": "p3.jpg"},
            ],
            extraction=READ,
            # The student corrected one maths row — a LaTeX edit, which must
            # be typeset like the read it replaces.
            extraction_edits={"2:2": r"m\angle 1 = \frac{180^\circ - 30^\circ}{2}"},
            extraction_edited_at=NOW - timedelta(minutes=2),
            extraction_confirmed_at=NOW - timedelta(minutes=2),
            submitted_at=NOW - timedelta(minutes=5),
        )
        s.add(sub)
        await s.commit()
        return str(sub.id), create_access_token(str(admin.id), "admin")


async def main() -> None:
    assert_local_database()
    sub_id, token = await seed()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    async with HarnessBrowser(DASH_BASE) as hb:
        async with hb.authed_page(
            token, token, access_key=ADMIN_ACCESS_KEY, refresh_key=ADMIN_REFRESH_KEY,
        ) as page:
            errors: list[str] = []

            def on_console(msg: ConsoleMessage) -> None:
                if msg.type == "error":
                    errors.append(msg.text)

            page.on("console", on_console)
            await page.set_viewport_size({"width": 1440, "height": 1000})

            await page.goto(f"{DASH_BASE}/submissions/{sub_id}/trace", wait_until="networkidle")
            await page.wait_for_timeout(2500)  # pdf.js rasterises after load
            section = page.locator(".xq-detail").first
            out = OUT_DIR / f"{SHOT_PREFIX}-case-file-reads-trace.png"
            await section.screenshot(path=str(out))
            print(f"✓ {out.relative_to(OUT_DIR.parents[1])}")

            await page.goto(f"{DASH_BASE}/extraction-quality", wait_until="networkidle")
            await page.wait_for_timeout(1200)
            # The board lists reads by course, worst first; the seeded read
            # was corrected, and it is the only Geometry one.
            await page.locator('select:has(option[value="repaired"])').select_option("repaired")
            await page.wait_for_timeout(1200)
            await page.get_by_text("Geometry").first.click()
            await page.wait_for_timeout(2500)
            out = OUT_DIR / f"{SHOT_PREFIX}-case-file-reads-modal.png"
            await page.screenshot(path=str(out))
            print(f"✓ {out.relative_to(OUT_DIR.parents[1])}")
            print("console errors:", errors or "none")


if __name__ == "__main__":
    asyncio.run(main())
