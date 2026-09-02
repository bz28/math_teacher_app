"""Screenshot the publish dialog's count of a sibling-section rehearsal.

Publishing is homework-wide, so pressing Publish from Period 4 also
releases the teacher's own test-run submission sitting in Period 3. The
dialog therefore has to describe her rehearsal the same way it describes
a student's work — including the approved/unapproved split.

It didn't. The loader incremented `otherPending` for a sibling rehearsal
but not `otherPendingReviewed`, and `unreviewedToPublishTotal` is derived
by subtraction, so an APPROVED rehearsal was counted as unapproved:

  before   "1 grade you haven't approved will be published."
  after    (no such warning — she approved it)

Standalone (not a durable test) — drives a running stack:

    NEXT_PUBLIC_API_URL=http://localhost:8010/v1 \
    WEB_BASE=http://localhost:3131 .venv/bin/python -m scripts.capture_preview_publish_dialog

Writes docs/design/preview-publish-dialog-<SHOT_LABEL>.png.
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

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3131").rstrip("/")
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "design"
LABEL = os.environ.get("SHOT_LABEL", "after")


def _entry(pid, percent):
    return {
        "problem_id": str(pid),
        "score_status": "full" if percent == 100 else "partial",
        "percent": float(percent),
        "confidence": 0.95,
        "feedback": "Looks right.",
        "deductions": None,
        "student_answer": "…",
    }


async def seed() -> dict[str, str]:
    async with get_session_factory()() as s:
        suffix = uuid.uuid4().hex[:6]
        school = School(
            name="Lincoln High", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Demo", contact_email=f"pvd_{suffix}@t.com",
        )
        s.add(school)
        await s.flush()
        teacher = User(
            email=f"pvd_teacher_{suffix}@t.com",
            password_hash=hash_password("x"), grade_level=12, role="teacher",
            name="Ms. Rivera", school_id=school.id,
        )
        s.add(teacher)
        await s.flush()
        shadow = User(
            email=f"pvd_shadow_{suffix}@t.com",
            password_hash=hash_password("x"), grade_level=12, role="student",
            name="Ms. Rivera (preview)", school_id=school.id,
            is_preview=True, preview_owner_id=teacher.id,
        )
        s.add(shadow)
        await s.flush()

        course = Course(name="Trig / Pre-Calc", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Unit Circle", position=0)
        s.add(unit)
        await s.flush()
        # Period 3 holds her rehearsal; we open Period 4, so the rehearsal
        # is a SIBLING-section row — the branch the fix rewrote.
        section_a = Section(course_id=course.id, name="Period 3")
        section_b = Section(course_id=course.id, name="Period 4")
        s.add_all([section_a, section_b])
        await s.flush()
        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="Unit Circle Practice", type="homework", status="published",
            content={"problem_ids": []},
        )
        s.add(assignment)
        await s.flush()

        specs = [
            (r"Evaluate $\sin(\pi/6)$", r"$1/2$"),
            (r"Evaluate $\cos(\pi/3)$", r"$1/2$"),
        ]
        items = []
        for i, (q, ans) in enumerate(specs):
            it = QuestionBankItem(
                course_id=course.id, unit_id=unit.id,
                originating_assignment_id=assignment.id,
                title=f"P{i + 1}", question=q, final_answer=ans,
                difficulty="medium", format="frq", status="approved",
            )
            items.append(it)
            s.add(it)
        await s.flush()
        pids = [it.id for it in items]
        assignment.content = {"problem_ids": [str(p) for p in pids]}
        s.add_all([
            AssignmentSection(assignment_id=assignment.id, section_id=section_a.id,
                              published_at=datetime.now(UTC)),
            AssignmentSection(assignment_id=assignment.id, section_id=section_b.id,
                              published_at=datetime.now(UTC)),
        ])
        now = datetime.now(UTC)

        async def _submission(user, section, score, reviewed):
            sub = Submission(
                assignment_id=assignment.id, student_id=user.id,
                section_id=section.id, status="submitted",
                extraction={"steps": []},
                extraction_confirmed_at=now - timedelta(hours=1),
                submitted_at=now - timedelta(hours=2),
            )
            s.add(sub)
            await s.flush()
            bd = [_entry(p, score) for p in pids]
            g = SubmissionGrade(
                submission_id=sub.id, ai_score=score, final_score=score,
                breakdown=bd, graded_at=now - timedelta(minutes=50),
            )
            if reviewed:
                g.reviewed_by = teacher.id
                g.reviewed_at = now - timedelta(minutes=31)
            s.add(g)

        # Her rehearsal in Period 3: graded and APPROVED, not yet released.
        s.add(SectionEnrollment(section_id=section_a.id, course_id=course.id,
                                student_id=shadow.id))
        await _submission(shadow, section_a, 100, reviewed=True)

        # Period 4 — one real student, also graded and approved, so the
        # only thing that could make the dialog say "unapproved" is her
        # rehearsal being miscounted.
        student = User(
            email=f"pvd_student_{suffix}@school.edu",
            password_hash=hash_password("x"), grade_level=12,
            role="student", name="Jordan Lee",
        )
        s.add(student)
        await s.flush()
        s.add(SectionEnrollment(section_id=section_b.id, course_id=course.id,
                                student_id=student.id))
        await _submission(student, section_b, 92, reviewed=True)

        refresh = await create_refresh_token(s, teacher.id)
        await s.commit()
        return {
            "course_id": str(course.id),
            "assignment_id": str(assignment.id),
            "section_b": str(section_b.id),
            "access": create_access_token(str(teacher.id), "teacher"),
            "refresh": refresh,
        }


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Seeding preview-publish world …")
    w = await seed()
    url = (
        f"{WEB_BASE}/school/teacher/courses/{w['course_id']}"
        f"/homework/{w['assignment_id']}/sections/{w['section_b']}/review"
    )
    print(f"URL: {url}")
    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["access"], w["refresh"]) as page:
            errors: list[str] = []
            page.on("console",
                    lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.set_viewport_size({"width": 1440, "height": 1200})
            await page.goto(url, wait_until="networkidle", timeout=60000)
            await page.wait_for_timeout(2500)

            btn = page.get_by_role("button", name="Publish", exact=False).first
            await btn.scroll_into_view_if_needed()
            print(f"button: {await btn.inner_text()}")
            await btn.click()
            await page.wait_for_timeout(1500)

            out = OUT_DIR / f"preview-publish-dialog-{LABEL}.png"
            await page.screenshot(path=str(out))
            print(f"  -> {out}")
            body = await page.inner_text("body")
            for line in body.splitlines():
                low = line.lower()
                if "approve" in low or "publish" in low or "other section" in low:
                    print(f"   | {line.strip()}")
            print(f"console errors: {errors}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
