"""Seed a realistically DENSE school and capture every logged-in surface.

Standalone (not a durable test) — drives the running stack:
    web :3001, API :8000

    .venv/bin/python -m scripts.seed_design_audit_world

## Why density matters here

This exists for a design audit, and an audit run against a near-empty
world is worse than no audit: every screen looks calm, hierarchy
problems never surface, and long-roster layouts are never exercised.
Empty states are ONE case, not the case.

So this seeds a term that looks like a real teacher's: three courses,
five sections, twenty-eight students, and homework spread across every
state the UI has to render — not yet due, due today, overdue, some
submitted, some graded and awaiting approval, some approved, some
never turned in. Grades vary so the class-at-a-glance has a real
distribution rather than a wall of identical rows.

Writes shots to <out>/logged-in/{teacher,student}-*.png.
"""

from __future__ import annotations

import asyncio
import base64
import os
import random
import sys
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
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.harness.browser import HarnessBrowser

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3001").rstrip("/")

# Deterministic: an audit that shuffles between runs can't be compared
# against itself after a fix.
RNG = random.Random(20260802)

FIRST = [
    "Ava", "Noah", "Mia", "Liam", "Zoe", "Ethan", "Maya", "Lucas", "Iris",
    "Owen", "Nina", "Diego", "Sofia", "Jonah", "Priya", "Malik", "Elena",
    "Caleb", "Yuki", "Omar", "Hana", "Theo", "Lena", "Andre", "Ruby",
    "Kai", "Nora", "Sam",
]
LAST = [
    "Alvarez", "Brooks", "Chen", "Diaz", "Ellis", "Fisher", "Gupta",
    "Hayes", "Ibrahim", "Jensen", "Kowalski", "Lopez", "Mensah", "Novak",
    "Okafor", "Park", "Quinn", "Reyes", "Silva", "Tran", "Ueda", "Vega",
    "Walsh", "Xu", "Yates", "Zhang", "Adler", "Bauer",
]

PROBLEMS = [
    ("Solve for x:  2x + 7 = 23", "x = 8"),
    ("Solve for x:  5(x - 3) = 2x + 6", "x = 7"),
    ("A line passes through (2, 5) and (6, 13). Find its slope.", "m = 2"),
    ("Factor completely:  x^2 - 9x + 20", "(x - 4)(x - 5)"),
    ("Solve the system:  y = 2x + 1,  y = -x + 7", "(2, 5)"),
    ("Simplify:  (3x^2)(4x^5)", "12x^7"),
]


def _page_svg(text_lines: list[str]) -> dict[str, str]:
    """A 'photographed' notebook page so galleries have real content."""
    rows = "".join(
        f"<text x='34' y='{70 + i * 52}' font-size='27' "
        f"font-family='Georgia,serif' fill='#243b6b'>{line}</text>"
        for i, line in enumerate(text_lines)
    )
    svg = (
        "<svg xmlns='http://www.w3.org/2000/svg' width='440' height='330'>"
        "<rect width='440' height='330' fill='#fffdf7'/>"
        + "".join(
            f"<line x1='0' y1='{y}' x2='440' y2='{y}' stroke='#e6e0d2'/>"
            for y in range(44, 330, 52)
        )
        + rows
        + "</svg>"
    )
    return {
        "data": base64.b64encode(svg.encode()).decode(),
        "media_type": "image/svg+xml",
    }


def _grade_entry(pid, status, percent, feedback):
    return {
        "problem_id": str(pid),
        "score_status": status,
        "percent": float(percent),
        "feedback": feedback,
    }


async def _problems(s, course, unit, assignment, count):
    items = []
    for i in range(count):
        q, ans = PROBLEMS[i % len(PROBLEMS)]
        it = QuestionBankItem(
            course_id=course.id, unit_id=unit.id,
            originating_assignment_id=assignment.id,
            title=f"Problem {i + 1}", question=q, final_answer=ans,
            difficulty=("easy", "medium", "hard")[i % 3],
            format="frq", status="approved",
        )
        items.append(it)
        s.add(it)
    await s.flush()
    pids = [it.id for it in items]
    assignment.content = {"problem_ids": [str(p) for p in pids]}
    return pids


async def seed() -> dict:
    suffix = uuid.uuid4().hex[:6]
    now = datetime.now(UTC)

    async with get_session_factory()() as s:
        school = School(
            name="Lincoln High School", kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="Dana Reyes", contact_email=f"dana_{suffix}@lincoln.k12.us",
        )
        s.add(school)
        await s.flush()

        teacher = User(
            email=f"rivera_{suffix}@lincoln.k12.us",
            password_hash=hash_password("x"), grade_level=12,
            role="teacher", name="Ms. Rivera", school_id=school.id,
            # Mark the first-run tours seen. Without this every capture
            # is a screenshot of the welcome overlay rather than the
            # page underneath — the audit would be reviewing the modal.
            tours_seen=["teacher", "student", "personal"],
        )
        s.add(teacher)
        await s.flush()

        # Three courses — a real teacher's load, and enough for the course
        # list to need hierarchy rather than being a single card.
        course_specs = [
            ("Algebra I", ["Period 1", "Period 3"], "Linear Equations"),
            ("Algebra II", ["Period 4"], "Quadratics"),
            ("Geometry", ["Period 6", "Period 7"], "Triangles"),
        ]

        made: list[dict] = []
        roster_n = 0
        focus_student = None

        for c_i, (cname, section_names, unit_name) in enumerate(course_specs):
            course = Course(name=cname, subject="math", school_id=school.id)
            s.add(course)
            await s.flush()
            s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
            unit = Unit(course_id=course.id, name=unit_name, position=0)
            s.add(unit)
            await s.flush()

            for sec_i, sec_name in enumerate(section_names):
                section = Section(course_id=course.id, name=sec_name)
                s.add(section)
                await s.flush()

                students = []
                # Uneven rosters — real classes aren't all the same size.
                size = (9, 6, 5, 4, 4)[(c_i * 2 + sec_i) % 5]
                for _ in range(size):
                    fn = FIRST[roster_n % len(FIRST)]
                    ln = LAST[roster_n % len(LAST)]
                    roster_n += 1
                    stu = User(
                        email=f"s{roster_n}_{suffix}@lincoln.k12.us",
                        password_hash=hash_password("x"), grade_level=9,
                        role="student", name=f"{fn} {ln}", school_id=school.id,
                        tours_seen=["student", "personal"],
                    )
                    s.add(stu)
                    await s.flush()
                    s.add(SectionEnrollment(
                        section_id=section.id, course_id=course.id,
                        student_id=stu.id,
                    ))
                    students.append(stu)

                if focus_student is None:
                    focus_student = students[0]

                made.append({
                    "course": course, "unit": unit, "section": section,
                    "students": students,
                })

        # ── Homework across every state the UI must render ──
        #
        # not-yet-due / due-today / overdue, and within the graded ones a
        # spread of scores so the class view has a real distribution
        # instead of a uniform wall.
        hw_specs = [
            ("Unit 1 Review", now + timedelta(days=4), "published", "none"),
            ("Two-Step Equations", now + timedelta(hours=6), "published", "partial"),
            ("Slope & Intercepts", now - timedelta(days=1), "published", "graded"),
            ("Factoring Practice", now - timedelta(days=6), "published", "approved"),
        ]

        focus_ids: dict[str, str] = {}

        for grp_i, grp in enumerate(made):
            course, unit, section = grp["course"], grp["unit"], grp["section"]
            students = grp["students"]

            for hw_i, (title, due, status, state) in enumerate(hw_specs):
                # Keep the far sections lighter so not every screen is max
                # density — real terms are uneven.
                if grp_i > 2 and hw_i > 1:
                    continue

                hw = Assignment(
                    course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
                    title=title, type="homework", status=status,
                    due_at=due.replace(minute=30, second=0, microsecond=0),
                )
                s.add(hw)
                await s.flush()
                s.add(AssignmentSection(assignment_id=hw.id, section_id=section.id))
                pids = await _problems(s, course, unit, hw, 6)

                if grp_i == 0 and hw_i == 2:
                    focus_ids["course_id"] = str(course.id)
                    focus_ids["section_id"] = str(section.id)
                    focus_ids["graded_hw_id"] = str(hw.id)
                if grp_i == 0 and hw_i == 0:
                    focus_ids["upcoming_hw_id"] = str(hw.id)

                if state == "none":
                    continue

                # Who turned it in. Not everyone — "missing" is a state the
                # teacher view exists to surface.
                turned_in = students if state != "partial" else students[: max(1, len(students) - 3)]

                for st_i, stu in enumerate(turned_in):
                    sub = Submission(
                        assignment_id=hw.id, student_id=stu.id, section_id=section.id,
                        status="submitted",
                        files=[_page_svg(["2x + 7 = 23", "2x = 16", "x = 8"])],
                        submitted_at=due - timedelta(hours=RNG.randint(1, 30)),
                    )
                    s.add(sub)
                    await s.flush()

                    if state in ("graded", "approved"):
                        # A real distribution: mostly fine, a tail that needs
                        # the teacher. This is what the product claims to
                        # surface, so the audit has to see it.
                        pct = RNG.choice(
                            [100, 100, 95, 92, 88, 83, 79, 72, 64, 55, 41]
                        )
                        breakdown = []
                        for p_i, pid in enumerate(pids):
                            ok = p_i < round(len(pids) * pct / 100)
                            breakdown.append(_grade_entry(
                                pid,
                                "correct" if ok else "incorrect",
                                100.0 if ok else 0.0,
                                "Clean work — the setup and the arithmetic both hold."
                                if ok else
                                "The setup is right, but the sign flips when you divide. "
                                "Check the step where you move 7 across.",
                            ))
                        # final_score is a PERCENT 0-100 by convention
                        # (api/routes/school_student_practice.py:561),
                        # not a point count — seeding points rendered a
                        # 6/6 submission as "6%" in alarm red on the
                        # student's dashboard.
                        grade = SubmissionGrade(
                            submission_id=sub.id,
                            ai_score=float(pct), final_score=float(pct),
                            breakdown=breakdown,
                            ai_breakdown={
                                "summary": (
                                    "Solid grasp of the two-step pattern. The "
                                    "errors cluster on sign handling, not on "
                                    "the method."
                                ),
                            },
                            graded_at=now - timedelta(hours=RNG.randint(2, 40)),
                        )
                        if state == "approved":
                            grade.grade_published_at = now - timedelta(hours=1)
                            grade.published_final_score = float(pct)
                            grade.published_breakdown = breakdown
                        s.add(grade)

        # Refresh tokens are DB-backed rows, so they are minted before
        # the commit that persists them.
        teacher_refresh = await create_refresh_token(s, teacher.id)
        student_refresh = await create_refresh_token(s, focus_student.id)

        await s.commit()

        return {
            "teacher_token": create_access_token(str(teacher.id), "teacher"),
            "teacher_refresh": teacher_refresh,
            "student_token": create_access_token(str(focus_student.id), "student"),
            "student_refresh": student_refresh,
            **focus_ids,
        }


async def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/design/audit")
    (out / "logged-in").mkdir(parents=True, exist_ok=True)

    print("Seeding a dense term …")
    ids = await seed()
    print(f"  course={ids.get('course_id')} hw={ids.get('graded_hw_id')}")

    c = ids.get("course_id")
    hw = ids.get("graded_hw_id")
    sec = ids.get("section_id")

    teacher_routes = [
        ("teacher-home", "/school/teacher"),
        ("teacher-course", f"/school/teacher/courses/{c}"),
        ("teacher-homework", f"/school/teacher/courses/{c}/homework/{hw}"),
        ("teacher-review", f"/school/teacher/courses/{c}/homework/{hw}/review"),
        ("teacher-section-review",
         f"/school/teacher/courses/{c}/homework/{hw}/sections/{sec}/review"),
    ]
    student_routes = [
        ("student-home", "/school/student"),
        ("student-course", f"/school/student/courses/{c}"),
        ("student-grades", "/school/student/grades"),
        ("student-practice-history", "/school/student/practice-history"),
    ]

    results = []
    async with HarnessBrowser(WEB_BASE) as browser:
        for role, token, refresh, routes in (
            ("teacher", ids["teacher_token"], ids["teacher_refresh"], teacher_routes),
            ("student", ids["student_token"], ids["student_refresh"], student_routes),
        ):
            for vp, w, h in (("desktop", 1440, 900), ("mobile", 390, 844)):
                async with browser.authed_page(token, refresh) as page:
                    await page.set_viewport_size({"width": w, "height": h})
                    for name, path in routes:
                        errs: list[str] = []
                        page.on(
                            "console",
                            lambda m: errs.append(m.text[:110]) if m.type == "error" else None,
                        )
                        try:
                            await page.goto(
                                f"{WEB_BASE}{path}", wait_until="networkidle", timeout=45000,
                            )
                            await page.wait_for_timeout(1100)
                            ov = await page.evaluate(
                                "() => document.documentElement.scrollWidth"
                                " - document.documentElement.clientWidth"
                            )
                            await page.screenshot(
                                path=str(out / "logged-in" / f"{vp}-{name}.png"),
                                full_page=True,
                            )
                            results.append(
                                f"{vp:8} {name:24} overflow={ov:>4}px errors={len(errs)}"
                                + (f"  !! {errs[0]}" if errs else "")
                            )
                        except Exception as e:  # noqa: BLE001
                            results.append(f"{vp:8} {name:24} FAILED {str(e)[:80]}")
            _ = role

    print("\n".join(results))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
