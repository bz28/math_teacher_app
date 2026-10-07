"""Seed a realistic graded class and screenshot the Student Insights tab.

Standalone (not a durable test) — drives a running stack:

    WEB_BASE=http://localhost:3001 .venv/bin/python -m scripts.seed_insights_screens

Set BEFORE_WEB to a stack still running the old code to also capture
insights-before-*.png from the same seeded class.

Seeds a new teacher + Algebra I course with two periods and three
homeworks graded the way a real term looks: mostly approved, some
published-only, a couple of AI drafts still to approve, one unreadable
upload, students who skipped work, and understanding-check reasons on
the misses. Deterministic (fixed RNG seed). Prints the teacher login
URL pieces and writes shots to docs/design/insights-*.png.
"""

from __future__ import annotations

import asyncio
import math
import os
import random
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.course import Course, CourseTeacher
from api.models.integrity_check import IntegrityCheckProblem, IntegrityCheckSubmission
from api.models.question_bank import QuestionBankItem
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.harness.browser import HarnessBrowser

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3001").rstrip("/")
# Optional: a second stack still on the old code, for before/after shots.
BEFORE_WEB = os.environ.get("BEFORE_WEB", "").rstrip("/")
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "design"

# (title, days until due — negative is past, [(question, difficulty)])
HOMEWORKS: list[tuple[str, int, list[tuple[str, float]]]] = [
    ("HW 4 · Linear equations", -16, [
        ("Solve $3x + 7 = 22$.", -1.5),
        ("Solve $5(x - 2) = 3x + 4$.", -0.5),
        ("Write the equation of the line through $(1, 3)$ and $(4, 9)$.", 0.2),
        ("Solve $\\frac{x}{3} - 2 = \\frac{x}{4}$.", 0.6),
        ("A plan costs \\$12 plus \\$0.15 per text. Write and solve for 200 texts.", 0.0),
    ]),
    ("HW 5 · Systems of equations", -9, [
        ("Solve $y = 2x + 1$ and $y = -x + 7$.", -1.0),
        ("Solve by elimination: $2x + 3y = 12$, $x - 3y = -3$.", 0.0),
        ("Solve by substitution: $x + y = 10$, $2x - y = 2$.", -0.4),
        ("How many solutions does $2x + 4y = 8$, $x + 2y = 5$ have?", 0.9),
        ("Tickets cost \\$5 and \\$8; 40 sold for \\$254. How many of each?", 0.7),
    ]),
    ("HW 6 · Quadratics", -2, [
        ("Solve $x^2 - 5x + 6 = 0$ by factoring.", -1.2),
        ("Find the vertex of $y = x^2 - 4x + 1$.", 0.3),
        ("Solve $2x^2 + 3x - 2 = 0$ with the quadratic formula.", 0.8),
        ("How many real solutions does $x^2 + 2x + 5 = 0$ have? Use the discriminant.", 1.6),
        ("Write $y = x^2 + 6x + 5$ in vertex form.", 0.5),
    ]),
]

PERIOD_3 = [
    "Maya Chen", "Jordan Taylor", "Ana Patel", "Leo Kim", "Sam Wright", "Priya Shah",
    "Ethan Brooks", "Olivia Diaz", "Noah Rivera", "Ava Nguyen", "Lucas Martin", "Mia Lopez",
    "Ben Carter", "Zoe Adams", "Isaac Moore", "Chloe Hall", "Owen Price", "Lily Ward",
    "Mateo Cruz", "Grace Bell", "Henry Ross", "Sofia Gray", "Caleb Reed", "Nora Hayes",
]
PERIOD_1 = ["Ella Fox", "Max Long", "Ruby Kent", "Theo Park", "Iris Lane", "Jack Moss", "Ivy Cole", "Finn Webb"]

PERCENT = {"full": 100, "partial": 50, "zero": 0}
KINDS = ["conceptual_gap"] * 5 + ["procedural_slip"] * 3 + ["blank"]


def _score(rng: random.Random, skill: float, difficulty: float) -> str:
    p = 1 / (1 + math.exp(-(skill - difficulty) * 1.4))
    r = rng.random()
    return "full" if r < p else ("partial" if r < p + (1 - p) * 0.35 else "zero")


async def seed() -> dict[str, Any]:
    rng = random.Random(7)
    now = datetime.now(UTC)
    async with get_session_factory()() as s:
        suffix = uuid.uuid4().hex[:6]
        school = School(name="Lincoln High", kind=SCHOOL_KIND_INDIVIDUAL,
                        contact_name="Demo", contact_email=f"insights_{suffix}@t.com")
        s.add(school)
        await s.flush()
        teacher = User(email=f"insights_teacher_{suffix}@t.com", password_hash=hash_password("x"),
                       grade_level=12, role="teacher", name="Ms. Rivera", school_id=school.id)
        course = Course(name="Algebra I", subject="math", school_id=school.id)
        s.add_all([teacher, course])
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Algebra I", position=0)
        p1 = Section(course_id=course.id, name="Period 1")
        p3 = Section(course_id=course.id, name="Period 3")
        s.add_all([unit, p1, p3])
        await s.flush()

        students: list[tuple[User, Section, float]] = []
        for names, sec in ((PERIOD_3, p3), (PERIOD_1, p1)):
            for name in names:
                u = User(email=f"{name.split()[0].lower()}_{suffix}@t.com", password_hash=hash_password("x"),
                         grade_level=9, role="student", name=name, school_id=school.id)
                s.add(u)
                await s.flush()
                s.add(SectionEnrollment(section_id=sec.id, course_id=course.id, student_id=u.id,
                                        enrolled_at=now - timedelta(days=40)))
                students.append((u, sec, rng.gauss(1.1, 0.7)))

        # Scripted stories the watch list should catch (Period 3):
        skipped = {"Sam Wright", "Henry Ross"}      # skipped HW 4 and HW 5
        slipping = {"Jordan Taylor"}                # strong, then a sharp drop on HW 6
        for title, due_days, problems in HOMEWORKS:
            due = now + timedelta(days=due_days)
            hw = Assignment(course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id, title=title,
                            type="homework", status="published", due_at=due, content={"problem_ids": []})
            s.add(hw)
            await s.flush()
            items = [QuestionBankItem(course_id=course.id, unit_id=unit.id, originating_assignment_id=hw.id,
                                      title=q[:60], question=q, final_answer="—", status="approved",
                                      source="generated") for q, _ in problems]
            s.add_all(items)
            await s.flush()
            hw.content = {"problem_ids": [str(i.id) for i in items]}
            for sec in (p1, p3):
                s.add(AssignmentSection(assignment_id=hw.id, section_id=sec.id, published_at=due - timedelta(days=6)))
            latest = due_days == -2

            for idx, (u, sec, skill) in enumerate(students):
                if u.name in skipped and not latest:
                    continue
                if latest and u.name == "Caleb Reed":
                    continue  # not turned in yet
                eff = skill - 2.2 if (latest and u.name in slipping) else skill + (1.5 if u.name in slipping else 0)
                statuses = [_score(rng, eff, d) for _, d in problems]
                bd = [{"problem_id": str(i.id), "score_status": st, "percent": PERCENT[st], "feedback": None}
                      for i, st in zip(items, statuses)]
                sub = Submission(assignment_id=hw.id, student_id=u.id, section_id=sec.id, status="submitted",
                                 submitted_at=due - timedelta(hours=rng.randint(2, 40)))
                s.add(sub)
                await s.flush()
                score = round(sum(PERCENT[st] for st in statuses) / len(statuses), 1)
                grade: dict[str, Any] = {"breakdown": bd, "ai_score": score, "final_score": score, "graded_at": now}
                if latest and u.name in {"Zoe Adams", "Owen Price"}:
                    pass  # AI draft the teacher hasn't approved yet
                elif latest and u.name == "Lily Ward":
                    grade = {"ai_grading_status": "skipped_unreadable", "graded_at": now}
                elif due_days == -16:
                    grade |= {"grade_published_at": due + timedelta(days=2), "published_breakdown": bd,
                              "published_final_score": score}
                else:
                    grade |= {"reviewed_at": now - timedelta(days=1)}
                s.add(SubmissionGrade(submission_id=sub.id, **grade))

                if latest and "breakdown" in grade:
                    chk = IntegrityCheckSubmission(submission_id=sub.id, status="complete",
                                                   disposition="needs_practice" if idx % 7 == 0 else "pass")
                    s.add(chk)
                    await s.flush()
                    for pos, (item, st) in enumerate(zip(items, statuses)):
                        if st == "zero" and rng.random() < 0.85:
                            s.add(IntegrityCheckProblem(integrity_check_submission_id=chk.id, bank_item_id=item.id,
                                                        sample_position=pos + 1, status="diagnosis_only",
                                                        diagnosis_kind=rng.choice(KINDS)))
                    probe = next((i for i, st in zip(items, statuses) if st == "full"), None)
                    if probe is not None and chk.disposition != "pass":
                        s.add(IntegrityCheckProblem(integrity_check_submission_id=chk.id, bank_item_id=probe.id,
                                                    sample_position=0, status="verdict_submitted"))
        refresh = await create_refresh_token(s, teacher.id)
        await s.commit()
        return {
            "course_id": str(course.id), "section_id": str(p3.id), "hw_id": str(hw.id),
            "access": create_access_token(str(teacher.id), "teacher"), "refresh": refresh,
        }


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    w = await seed()
    insights = f"/school/teacher/courses/{w['course_id']}?tab=insights"
    review = f"/school/teacher/courses/{w['course_id']}/homework/{w['hw_id']}/sections/{w['section_id']}/review"
    print(f"  insights: {WEB_BASE}{insights}\n  review:   {WEB_BASE}{review}")
    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["access"], w["refresh"]) as page:
            errors: list[str] = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            for width, label in ((1280, "desktop"), (390, "mobile")):
                await page.set_viewport_size({"width": width, "height": 900})
                await page.goto(f"{WEB_BASE}{insights}", wait_until="networkidle", timeout=45000)
                await page.get_by_role("button", name="Student Insights").first.click()
                await page.get_by_role("button", name="Period 3").click()
                await page.get_by_text("Students to watch").wait_for(timeout=20000)
                await page.get_by_text("Period 3 lost the most").wait_for(timeout=20000)
                await page.mouse.move(1, 1)
                await page.wait_for_timeout(600)
                await page.screenshot(path=str(OUT_DIR / f"insights-{label}.png"), full_page=True)
            await page.set_viewport_size({"width": 1280, "height": 900})
            await page.goto(f"{WEB_BASE}{review}", wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(1500)
            await page.screenshot(path=str(OUT_DIR / "insights-grading-page.png"))
            print(f"  console errors: {len(errors)}")
            for e in errors[:10]:
                print(f"    ! {e}")
    if BEFORE_WEB:
        async with HarnessBrowser(BEFORE_WEB) as browser:
            async with browser.authed_page(w["access"], w["refresh"]) as page:
                await page.set_viewport_size({"width": 1280, "height": 900})
                await page.goto(f"{BEFORE_WEB}{insights}", wait_until="networkidle", timeout=45000)
                await page.get_by_role("button", name="Student Insights").first.click()
                await page.wait_for_timeout(1500)
                await page.screenshot(path=str(OUT_DIR / "insights-before-tab.png"))
                await page.goto(f"{BEFORE_WEB}{review}", wait_until="networkidle", timeout=45000)
                await page.wait_for_timeout(1500)
                await page.screenshot(path=str(OUT_DIR / "insights-before-grading-page.png"))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
