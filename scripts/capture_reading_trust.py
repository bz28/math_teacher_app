"""Screenshot the unvouched-reading strip on the teacher review page.

The strip fires on one fact: the student never confirmed the reading the
teacher is grading from. Two submissions are seeded so the shot shows the
strip AND its negative case — a confirmed reading, where it must not
appear. An earlier version of this feature also keyed off the reader's own
confidence score; that was removed after measurement (the score does not
separate good readings from bad), so there is no low-confidence state left
to capture.

Standalone (not a durable test) — drives the running worktree stack:

    NEXT_PUBLIC_API_URL=http://localhost:8001/v1 \
    WEB_BASE=http://localhost:3001 .venv/bin/python -m scripts.capture_reading_trust

Writes docs/design/reading-trust-*.png.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.database import get_session_factory
from api.models.assignment import (
    Assignment,
    AssignmentSection,
    Submission,
    SubmissionGrade,
)
from api.models.course import Course, CourseTeacher
from api.models.question_bank import QuestionBankItem
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.harness.browser import HarnessBrowser

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3001").rstrip("/")
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "design"
RUBRIC = {"full_credit": "Award full credit for a correct final answer."}

# The read-back the teacher grades from. Deliberately the prod failure:
# the worksheet asked about y = sqrt(x), the student answered with y = x,
# and a reading nobody checked is exactly where that goes unnoticed.
EXTRACTION = {
    "confidence": 0.62,
    "steps": [
        {"problem_position": 1, "latex": r"y = x",
         "plain_english": "Student wrote y = x for part (a)"},
        {"problem_position": 1, "latex": r"D: (-\infty, \infty)",
         "plain_english": "Domain as all real numbers"},
        {"problem_position": 1, "latex": r"R: (-\infty, \infty)",
         "plain_english": "Range as all real numbers"},
    ],
    "final_answers": [
        {"problem_position": 1, "answer_latex": r"D: (-\infty,\infty),\ R: (-\infty,\infty)",
         "answer_plain": "Domain and range both all reals"},
    ],
    "visual_work": [],
}


def _entry(pid, percent):
    return {
        "problem_id": str(pid),
        "score_status": "full" if percent == 100 else "partial",
        "percent": float(percent),
        "confidence": 0.95,
    }


def _ai(pos, percent):
    return {
        "problem_position": pos,
        "score_status": "full" if percent == 100 else "partial",
        "percent": float(percent),
        "confidence": 0.95,
        "reasoning": "Matches the expected domain and range.",
    }


async def seed() -> dict[str, str]:
    async with get_session_factory()() as s:
        suffix = uuid.uuid4().hex[:6]
        school = School(
            name="Lincoln High", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Demo", contact_email=f"trust_{suffix}@t.com",
        )
        s.add(school)
        await s.flush()
        teacher = User(
            email=f"trust_teacher_{suffix}@t.com",
            password_hash=hash_password("x"), grade_level=12, role="teacher",
            name="Ms. Rivera", school_id=school.id,
        )
        s.add(teacher)
        await s.flush()
        course = Course(name="Algebra II", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Parent Functions", position=0)
        s.add(unit)
        await s.flush()
        section = Section(course_id=course.id, name="Period 3")
        s.add(section)
        await s.flush()
        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="Parent Functions", type="homework", status="published",
            content={"problem_ids": []}, rubric=RUBRIC,
        )
        s.add(assignment)
        await s.flush()

        item = QuestionBankItem(
            course_id=course.id, unit_id=unit.id,
            originating_assignment_id=assignment.id, title="P1",
            question=(
                "State the domain and range of each parent function using "
                r"interval notation. (a) $y = \sqrt{x}$  (b) $y = \frac{1}{x}$"
            ),
            final_answer=r"(a) $D: [0,\infty),\ R: [0,\infty)$",
            difficulty="medium", format="frq", status="approved",
        )
        s.add(item)
        await s.flush()
        assignment.content = {"problem_ids": [str(item.id)]}
        s.add(AssignmentSection(
            assignment_id=assignment.id, section_id=section.id,
            published_at=datetime.now(UTC),
        ))

        now = datetime.now(UTC)
        ids: dict[str, str] = {}
        # (name, did the student confirm the reading?)
        for name, confirmed in (("Maya Chen", False), ("Aisha Patel", True)):
            u = User(
                email=f"{name.split()[0].lower()}_{suffix}@school.edu",
                password_hash=hash_password("x"), grade_level=10,
                role="student", name=name,
            )
            s.add(u)
            await s.flush()
            s.add(SectionEnrollment(
                section_id=section.id, course_id=course.id, student_id=u.id,
            ))
            sub = Submission(
                assignment_id=assignment.id, student_id=u.id,
                section_id=section.id, status="submitted",
                extraction=EXTRACTION,
                extraction_confirmed_at=(
                    now - timedelta(hours=1) if confirmed else None
                ),
                submitted_at=now - timedelta(hours=2),
            )
            s.add(sub)
            await s.flush()
            s.add(SubmissionGrade(
                submission_id=sub.id, ai_score=100.0, final_score=100.0,
                ai_breakdown={"grades": [_ai(1, 100)]},
                breakdown=[_entry(item.id, 100)],
                graded_at=now - timedelta(minutes=50), rubric_snapshot=RUBRIC,
            ))
            ids[name.split()[0].lower()] = str(u.id)

        refresh = await create_refresh_token(s, teacher.id)
        await s.commit()
        return {
            "course_id": str(course.id),
            "assignment_id": str(assignment.id),
            "section_id": str(section.id),
            "access": create_access_token(str(teacher.id), "teacher"),
            "refresh": refresh,
            **ids,
        }


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Seeding reading-trust world …")
    w = await seed()

    def url(student_id: str) -> str:
        return (
            f"{WEB_BASE}/school/teacher/courses/{w['course_id']}"
            f"/homework/{w['assignment_id']}/sections/{w['section_id']}"
            f"/review?student={student_id}"
        )

    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["access"], w["refresh"]) as page:
            errors: list[str] = []
            page.on("console",
                    lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.set_viewport_size({"width": 1440, "height": 1400})

            async def shot(label: str, height: int = 900) -> None:
                out = OUT_DIR / f"reading-trust-{label}.png"
                await page.screenshot(
                    path=str(out),
                    clip={"x": 0, "y": 0, "width": 1440, "height": height},
                )
                print(f"  -> {out}")

            await page.goto(url(w["maya"]), wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(1600)
            await shot("unconfirmed")

            # Negative case: the student signed off, so no strip at all.
            await page.goto(url(w["aisha"]), wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(1600)
            await shot("confirmed-no-strip")

            if errors:
                print("\nCONSOLE ERRORS:")
                for e in errors[:10]:
                    print(f"  {e}")
                return 1
            print("\nno console errors")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
