"""Screenshot the late policy surfaces, end to end on the real web app.

Seeds one class with three homeworks, one per late policy, and turn-ins at
known lateness (no AI calls — grades are written straight onto the rows
through the same `set_final_score` every writer uses), then drives the app:

  student-closed-{desktop,phone}  a "Closed after due date" homework past due
  student-dashboard               the Closed row on the dashboard
  student-penalty-graded          a published grade with its late line
  student-penalty-upload          the per-day policy's past-due warning
  teacher-penalty                 review page: the late line + Waive control
  teacher-penalty-waived          after Waive
  teacher-policy-picker           the policy options and their hint
  blast-none-ontime / none-late   review page under `none` (no penalty line)
  blast-student-none-upload       the unchanged `none` past-due upload panel
  blast-gradebook                 the class gradebook
  gradebook-penalty-hover         a published late grade's hover card

    WEB_BASE=http://localhost:3061 .venv/bin/python -m scripts.capture_late_policy

Writes docs/design/late-policy-*.png.
"""

from __future__ import annotations

import asyncio
import base64
import os
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.core.homework_points import assignment_points, weighted_percent
from api.core.late_policy import set_final_score, submission_penalty
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.course import Course, CourseTeacher
from api.models.question_bank import QuestionBankItem
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.harness.browser import HarnessBrowser

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3061").rstrip("/")
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "design"
DESKTOP = {"width": 1280, "height": 900}
PHONE = {"width": 390, "height": 844}

SPECS = [
    ("Solve for x:  $2x + 3 = 11$", "$x = 4$"),
    ("Simplify:  $3(x - 4) + 5$", "$3x - 7$"),
    ("Solve for x:  $5x - 7 = 18$", "$x = 5$"),
]
STUDENTS = ["Alex Kim", "Sam Ortiz", "Jordan Lee", "Riley Shah"]


def _page_file() -> dict[str, str]:
    svg = (
        "<svg xmlns='http://www.w3.org/2000/svg' width='400' height='520'>"
        "<rect width='400' height='520' fill='#fffdf7'/>"
        "<text x='30' y='60' font-size='24' fill='#243b6b'>1) 2x + 3 = 11,  x = 4</text>"
        "<text x='30' y='190' font-size='24' fill='#243b6b'>2) 3x - 12 + 5 = 3x - 7</text>"
        "<text x='30' y='320' font-size='24' fill='#243b6b'>3) 5x = 25,  x = 6</text>"
        "</svg>"
    )
    return {"data": base64.b64encode(svg.encode()).decode(), "media_type": "image/svg+xml"}


async def seed() -> dict[str, Any]:
    suffix = uuid.uuid4().hex[:6]
    now = datetime.now(UTC)
    async with get_session_factory()() as s:
        school = School(
            name="Lincoln High", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Demo", contact_email=f"late_{suffix}@t.com",
        )
        s.add(school)
        await s.flush()
        teacher = User(
            email=f"late_teacher_{suffix}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Ms. Rivera", school_id=school.id,
        )
        s.add(teacher)
        await s.flush()
        course = Course(name="Algebra I", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Linear Equations", position=0)
        s.add(unit)
        await s.flush()
        section = Section(course_id=course.id, name="Period 3")
        s.add(section)
        await s.flush()

        students = []
        for name in STUDENTS:
            u = User(
                email=f"{name.split()[0].lower()}_{suffix}@school.edu",
                password_hash=hash_password("x"), grade_level=9,
                role="student", name=name, school_id=school.id,
            )
            s.add(u)
            students.append(u)
        await s.flush()
        for u in students:
            s.add(SectionEnrollment(section_id=section.id, course_id=course.id, student_id=u.id))

        async def homework(title: str, policy: str, due: datetime) -> Assignment:
            hw = Assignment(
                course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
                title=title, type="homework", status="published", late_policy=policy,
                content={"problem_ids": []}, due_at=due,
                integrity_check_enabled=False, ai_grading_enabled=False,
            )
            s.add(hw)
            await s.flush()
            items = []
            for i, (q, ans) in enumerate(SPECS):
                it = QuestionBankItem(
                    course_id=course.id, unit_id=unit.id, originating_assignment_id=hw.id,
                    title=f"P{i + 1}", question=q, final_answer=ans,
                    difficulty="medium", format="frq", status="approved",
                )
                s.add(it)
                items.append(it)
            await s.flush()
            hw.content = {"problem_ids": [str(it.id) for it in items]}
            s.add(AssignmentSection(assignment_id=hw.id, section_id=section.id, published_at=now - timedelta(days=9)))
            return hw

        closed_hw = await homework("Systems of Equations", "no_credit", now - timedelta(days=1, hours=3))
        penalty_hw = await homework("Linear Equations Practice", "penalty_per_day", now - timedelta(days=3))
        none_hw = await homework("Slope and Intercepts", "none", now - timedelta(days=5))

        async def turn_in(
            hw: Assignment, u: User, late_by: timedelta, percents: list[float], *, publish: bool,
        ) -> Submission:
            assert hw.due_at is not None
            sub = Submission(
                assignment_id=hw.id, student_id=u.id, section_id=section.id, status="submitted",
                files=[_page_file()], submitted_at=hw.due_at + late_by, is_late=late_by > timedelta(0),
                extraction_confirmed_at=hw.due_at + late_by,
            )
            s.add(sub)
            await s.flush()
            pids = hw.content["problem_ids"] if hw.content else []
            breakdown = [
                {"problem_id": pid, "score_status": "full" if p == 100 else "zero" if p == 0 else "partial",
                 "percent": p, "feedback": None, "deductions": None}
                for pid, p in zip(pids, percents, strict=True)
            ]
            g = SubmissionGrade(
                submission_id=sub.id, breakdown=breakdown, graded_at=now,
                reviewed_at=now, reviewed_by=teacher.id, late_penalty_waived=False,
            )
            raw = weighted_percent(((e["problem_id"], e["percent"]) for e in breakdown), assignment_points(hw))
            set_final_score(g, raw, submission_penalty(hw, sub, hw.due_at))
            if publish:
                g.published_final_score = g.final_score
                g.published_late_penalty = g.late_penalty
                g.published_breakdown = breakdown
                g.grade_published_at = now
            s.add(g)
            return sub

        alex, sam, jordan, riley = students
        # Per-day policy: Alex two days late (−20), Sam on time, Jordan
        # late and published (the student's view of the line).
        await turn_in(penalty_hw, alex, timedelta(days=1, hours=4), [100, 100, 50], publish=False)
        await turn_in(penalty_hw, sam, -timedelta(hours=2), [100, 50, 100], publish=False)
        await turn_in(penalty_hw, jordan, timedelta(hours=5), [100, 100, 100], publish=True)
        # `none`: Alex on time, Sam three days late — no penalty either way.
        await turn_in(none_hw, alex, -timedelta(hours=1), [100, 100, 0], publish=True)
        await turn_in(none_hw, sam, timedelta(days=2, hours=1), [100, 50, 100], publish=True)
        # Riley turned nothing in anywhere: the closed one is closed, the
        # per-day one is still open (late), `none` is open (late).
        await s.flush()

        tokens: dict[str, dict[str, str]] = {}
        for u in students:
            tokens[u.name.split()[0].lower()] = {
                "id": str(u.id),
                "access": create_access_token(str(u.id), "student"),
                "refresh": await create_refresh_token(s, u.id),
            }
        teacher_refresh = await create_refresh_token(s, teacher.id)
        await s.commit()
    return {
        "course_id": str(course.id), "section_id": str(section.id),
        "closed_hw": str(closed_hw.id), "penalty_hw": str(penalty_hw.id), "none_hw": str(none_hw.id),
        "teacher_access": create_access_token(str(teacher.id), "teacher"),
        "teacher_refresh": teacher_refresh, "students": tokens,
    }


async def _shot(page: Any, name: str, *, full: bool = False) -> None:
    out = OUT_DIR / f"late-policy-{name}.png"
    await page.screenshot(path=str(out), full_page=full)
    print(f"  -> {out}")


async def _student_hw(browser: HarnessBrowser, w: dict[str, Any], who: str, hw: str, name: str,
                      size: dict[str, int], wait_text: str, *, bottom: bool = True) -> None:
    st = w["students"][who]
    async with browser.authed_page(st["access"], st["refresh"]) as page:
        await page.set_viewport_size(size)
        await page.goto(f"{WEB_BASE}/school/student/courses/{w['course_id']}/homework/{w[hw]}",
                        wait_until="networkidle", timeout=60000)
        await page.get_by_text(wait_text).first.wait_for(timeout=30000)
        if bottom:
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await page.wait_for_timeout(700)
        await _shot(page, name)


async def _teacher_review(browser: HarnessBrowser, w: dict[str, Any], hw: str, who: str, name: str,
                          *, waive: bool = False) -> None:
    url = (
        f"{WEB_BASE}/school/teacher/courses/{w['course_id']}/homework/{w[hw]}"
        f"/sections/{w['section_id']}/review?student={w['students'][who]['id']}"
    )
    async with browser.authed_page(w["teacher_access"], w["teacher_refresh"]) as page:
        await page.set_viewport_size({"width": 1440, "height": 1000})
        await page.goto(url, wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(2000)
        await _shot(page, name)
        if waive:
            await page.get_by_role("button", name="Waive penalty").click()
            await page.get_by_role("button", name="Restore penalty").wait_for(timeout=15000)
            await page.wait_for_timeout(500)
            await _shot(page, f"{name}-waived")


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Seeding late-policy world …")
    w = await seed()
    async with HarnessBrowser(WEB_BASE) as browser:
        # Student: closed.
        await _student_hw(browser, w, "riley", "closed_hw", "student-closed-desktop", DESKTOP,
                          "This homework is closed")
        await _student_hw(browser, w, "riley", "closed_hw", "student-closed-phone", PHONE,
                          "This homework is closed")
        st = w["students"]["riley"]
        async with browser.authed_page(st["access"], st["refresh"]) as page:
            await page.set_viewport_size(DESKTOP)
            await page.goto(f"{WEB_BASE}/school/student", wait_until="networkidle", timeout=60000)
            await page.get_by_text("Closed without a turn-in").wait_for(timeout=30000)
            # First visit offers the product tour; decline it.
            skip = page.get_by_role("button", name="Skip for now")
            if await skip.count():
                await skip.click()
            await page.wait_for_timeout(900)
            await _shot(page, "student-dashboard")
            await page.goto(f"{WEB_BASE}/school/student/courses/{w['course_id']}",
                            wait_until="networkidle", timeout=60000)
            await page.get_by_text("Closed", exact=True).first.wait_for(timeout=30000)
            await page.wait_for_timeout(700)
            await _shot(page, "student-homework-list")
        # Student: per-day policy.
        await _student_hw(browser, w, "riley", "penalty_hw", "student-penalty-upload", DESKTOP,
                          "each day late takes 10% off")
        await _student_hw(browser, w, "jordan", "penalty_hw", "student-penalty-graded", DESKTOP,
                          "for turning it in late", bottom=False)
        # Teacher: the penalty line and waiver.
        await _teacher_review(browser, w, "penalty_hw", "alex", "teacher-penalty", waive=True)
        async with browser.authed_page(w["teacher_access"], w["teacher_refresh"]) as page:
            await page.set_viewport_size({"width": 1440, "height": 1000})
            await page.goto(f"{WEB_BASE}/school/teacher/courses/{w['course_id']}/homework/{w['penalty_hw']}",
                            wait_until="networkidle", timeout=60000)
            # Configuration is a collapsed accordion on a published homework.
            await page.get_by_role("button", name="Configuration").first.click(timeout=30000)
            hint = page.get_by_text("Late work takes 10% off the score").first
            await hint.wait_for(timeout=30000)
            await hint.evaluate("el => el.scrollIntoView({block: 'center'})")
            await page.wait_for_timeout(700)
            await _shot(page, "teacher-policy-picker")
        # Blast radius.
        await _teacher_review(browser, w, "none_hw", "alex", "blast-none-ontime")
        await _teacher_review(browser, w, "none_hw", "sam", "blast-none-late")
        await _teacher_review(browser, w, "penalty_hw", "sam", "blast-penalty-ontime")
        await _student_hw(browser, w, "riley", "none_hw", "blast-student-none-upload", DESKTOP,
                          "marked late so your teacher knows")
        async with browser.authed_page(w["teacher_access"], w["teacher_refresh"]) as page:
            await page.set_viewport_size({"width": 1440, "height": 900})
            await page.goto(f"{WEB_BASE}/school/teacher/courses/{w['course_id']}?tab=grades",
                            wait_until="networkidle", timeout=60000)
            await page.wait_for_timeout(2500)
            await _shot(page, "blast-gradebook")
            # Hover Jordan's published late grade: "you gave" is her score
            # before the penalty, and the cut is its own line.
            cell = page.locator('a[aria-label*="for turning it in late"]').first
            await cell.hover(timeout=30000)
            await page.wait_for_timeout(700)
            await _shot(page, "gradebook-penalty-hover")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
