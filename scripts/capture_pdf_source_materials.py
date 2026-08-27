"""Evidence for the PDF source-material fix.

Standalone (not a durable test) — drives the running stack:
    web :3001, API :8000

    .venv/bin/python -m scripts.capture_pdf_source_materials

Builds a real 3-page PDF lesson on the topics the reporting teacher
actually uploaded (functions, domain/range, difference quotient), files
it under a unit named "Trig/Precalculus" — her real unit name, which is
what the old code fell back to — then captures:

  1. the PDF rendering in the materials preview modal (the UI change), and
  2. a REAL generation run grounded in that PDF, proving the problems
     come back on the PDF's topics instead of trig.

Writes to docs/design/shots-pdf-{preview,generated}.png.
"""

from __future__ import annotations

import asyncio
import base64
import io
import os
import uuid
from pathlib import Path

from PIL import Image, ImageDraw

from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.core.question_bank_generation import _run_generation
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import Course, CourseTeacher, Document
from api.models.question_bank import QuestionBankGenerationJob, QuestionBankItem
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School
from api.models.unit import Unit
from api.models.user import User
from tests.harness.browser import HarnessBrowser

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3001").rstrip("/")
OUT_DIR = Path(__file__).resolve().parents[1] / "docs" / "design"

# The lesson content the teacher actually uploaded — deliberately with NO
# trigonometry, so a generated trig problem proves the PDF was ignored
# and an on-topic problem proves it was read.
PAGES = [
    [
        "Pre-Calculus - Unit 1",
        "Functions, Domain and Range",
        "",
        "A relation is a function when every input x maps to",
        "exactly one output f(x).",
        "",
        "Vertical line test: if any vertical line meets the graph",
        "more than once, the relation is NOT a function.",
        "",
        "Example 1.  f(x) = sqrt(x - 4)",
        "   Domain: x - 4 >= 0, so x >= 4, i.e. [4, inf)",
        "   Range:  f(x) >= 0, i.e. [0, inf)",
    ],
    [
        "Domain restrictions",
        "",
        "Two things force a restriction:",
        "  1. a denominator may not be zero",
        "  2. an even root may not take a negative value",
        "",
        "Example 2.  g(x) = (x + 3) / (x^2 - 9)",
        "   x^2 - 9 = 0  =>  x = 3 or x = -3",
        "   Domain: all reals except x = 3 and x = -3",
        "",
        "Example 3.  h(x) = 1 / sqrt(5 - x)",
        "   Need 5 - x > 0  =>  x < 5",
        "   Domain: (-inf, 5)",
    ],
    [
        "The Difference Quotient",
        "",
        "        f(x + h) - f(x)",
        "        ----------------- ,   h =/= 0",
        "                h",
        "",
        "Example 4.  f(x) = x^2 + 2x",
        "   f(x + h) = (x + h)^2 + 2(x + h)",
        "            = x^2 + 2xh + h^2 + 2x + 2h",
        "   Difference quotient = (2xh + h^2 + 2h) / h",
        "                       = 2x + h + 2",
        "",
        "Practice: find the difference quotient for f(x) = 3x^2 - x.",
    ],
]


def _build_pdf() -> bytes:
    """A real, legible multi-page PDF — Claude reads it as a document."""
    images = []
    for lines in PAGES:
        img = Image.new("RGB", (1275, 1650), "white")
        d = ImageDraw.Draw(img)
        y = 110
        for i, line in enumerate(lines):
            # First line of each page reads as the heading.
            d.text((110, y), line, fill="black")
            y += 46 if i == 0 else 38
        images.append(img)
    buf = io.BytesIO()
    images[0].save(buf, format="PDF", save_all=True, append_images=images[1:])
    return buf.getvalue()


async def seed() -> dict[str, str]:
    tag = uuid.uuid4().hex[:6]
    pdf_b64 = base64.b64encode(_build_pdf()).decode()

    async with get_session_factory()() as s:
        school = School(
            name=f"Riverside High {tag}", kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="Admin", contact_email=f"admin_{tag}@riverside.edu",
        )
        s.add(school)
        await s.flush()
        teacher = User(
            email=f"teacher_{tag}@riverside.edu", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Ms. Alvarez", school_id=school.id,
        )
        s.add(teacher)
        await s.flush()
        course = Course(name="Pre-Calculus", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        # Her real unit name — the string the old code generated from.
        unit = Unit(course_id=course.id, name="Trig/Precalculus", position=0)
        s.add(unit)
        await s.flush()
        doc = Document(
            course_id=course.id, teacher_id=teacher.id, unit_id=unit.id,
            filename="Unit 1 - Functions, Domain, Difference Quotient.pdf",
            file_type="application/pdf",
            file_size=len(base64.b64decode(pdf_b64)), image_data=pdf_b64,
        )
        s.add(doc)
        await s.flush()
        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="Unit 1 Homework", type="homework", status="draft",
            content={"problems": []}, document_ids=[str(doc.id)],
        )
        s.add(assignment)
        await s.flush()
        refresh = await create_refresh_token(s, teacher.id)
        await s.commit()
        return {
            "course_id": str(course.id), "unit_id": str(unit.id),
            "doc_id": str(doc.id), "assignment_id": str(assignment.id),
            "teacher_id": str(teacher.id),
            "access": create_access_token(str(teacher.id), "teacher"),
            "refresh": refresh,
        }


async def generate(w: dict[str, str]) -> list[str]:
    """Run the REAL generation grounded in the PDF. Returns problem texts."""
    async with get_session_factory()() as s:
        job = QuestionBankGenerationJob(
            course_id=uuid.UUID(w["course_id"]), unit_id=uuid.UUID(w["unit_id"]),
            originating_assignment_id=uuid.UUID(w["assignment_id"]),
            created_by_id=uuid.UUID(w["teacher_id"]), status="queued",
            requested_count=4, difficulty="mixed",
            source_doc_ids=[w["doc_id"]],
        )
        s.add(job)
        await s.commit()
        await s.refresh(job)
        await _run_generation(s, job)
        await s.commit()

    async with get_session_factory()() as s:
        from sqlalchemy import select
        rows = (await s.execute(
            select(QuestionBankItem.question)
            .where(QuestionBankItem.course_id == uuid.UUID(w["course_id"]))
        )).scalars().all()
        return list(rows)


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Seeding Pre-Calculus world with a real PDF lesson …")
    w = await seed()
    materials = f"/school/teacher/courses/{w['course_id']}?tab=materials"
    print(f"  materials: {WEB_BASE}{materials}")

    print("Running REAL generation grounded in the PDF …")
    problems = await generate(w)
    print(f"  got {len(problems)} problems")
    for p in problems:
        print(f"   - {p[:100]}")

    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["access"], w["refresh"]) as page:
            errors: list[str] = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.set_viewport_size({"width": 1440, "height": 1200})
            await page.goto(f"{WEB_BASE}{materials}", wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(1500)

            # Open the PDF preview via the card's "View" affordance.
            await page.get_by_label("Preview Unit 1 - Functions, Domain, Difference Quotient.pdf").click()
            await page.wait_for_timeout(2500)
            out = OUT_DIR / "shots-pdf-preview.png"
            await page.screenshot(path=str(out))
            print(f"  -> {out}")

            if errors:
                print("  CONSOLE ERRORS:")
                for e in errors[:10]:
                    print(f"    {e}")
            else:
                print("  no console errors")

    # Write the generated problems next to the shot so the PR can show
    # what the model produced from the PDF.
    (OUT_DIR / "shots-pdf-generated.txt").write_text(
        "\n\n".join(f"{i + 1}. {p}" for i, p in enumerate(problems))
    )
    print(f"  -> {OUT_DIR / 'shots-pdf-generated.txt'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
