"""Seed the design doc's class and screenshot the insights → practice loop.

Standalone, $0 — drives a running stack and never calls a model:

    WEB_BASE=http://localhost:3211 SHOTS=insights OUT=after \\
        .venv/bin/python -m scripts.capture_insights_reteach

Seeds Lincoln High School: Ms. Rivera's Algebra I, Period 1 (25 students)
and Period 3 (8). "Elimination Method" is graded the way the design doc
describes: Period 1 all approved, 16 of 22 short of full credit on #3 for
three written reasons; Period 3 still has AI drafts to approve. A draft
practice set made from it waits on 3 versions; an older homework's set is
live, and 11 of Period 1's students practiced it.

With WRITE_REASONS=1 (the default) it runs the real reasons pass
(`reteach_reasons.refresh_reteach_reasons`) with the model call replaced
by a stand-in that groups the notes by their wording, so the stored rows
are the writer's own. Set WRITE_REASONS=0 against a stack on code that
predates the table.

SHOTS is a comma list of: insights (the tab, Period 1), reason (the
first reason opened to its students), live (the older homework, whose
set is live, for the tray's practiced count), review (the draft set's
review queue, first version beside its original). Shots land in
docs/design/insights-reteach-<shot>-<OUT>.png.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.course import Course, CourseTeacher
from api.models.practice_activity import PracticeActivity
from api.models.question_bank import QuestionBankItem
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.harness.browser import HarnessBrowser

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3211").rstrip("/")
SHOTS = [s for s in os.environ.get("SHOTS", "insights").split(",") if s]
OUT = os.environ.get("OUT", "after")
WRITE_REASONS = os.environ.get("WRITE_REASONS", "1") == "1"
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "design"

FIRST = ["Maya", "Jordan", "Ana", "Leo", "Sam", "Priya", "Ethan", "Olivia", "Noah", "Ava", "Lucas", "Mia",
         "Ben", "Zoe", "Isaac", "Chloe", "Owen", "Lily", "Mateo", "Grace", "Henry", "Sofia", "Caleb",
         "Nora", "Ella", "Max", "Ruby", "Theo", "Iris", "Jack", "Ivy", "Finn", "Rosa"]
LAST = ["Chen", "Taylor", "Patel", "Kim", "Wright", "Shah", "Brooks", "Diaz", "Rivera", "Nguyen", "Martin"]

ELIMINATION = [
    "Solve by elimination: $x + y = 10$, $x - y = 4$.",
    "Solve by elimination: $2x + y = 9$, $x - y = 3$.",
    "Solve by elimination: $3x + 2y = 16$, $x - 2y = 0$.",
    "Solve by elimination: $4x - 3y = 1$, $2x + 3y = 11$.",
    "A system has no solution. What is true of its lines?",
]
SUBSTITUTION = [
    "Solve by substitution: $x + y = 12$, $x - y = 2$.",
    "Solve by substitution: $y = 2x$, $x + y = 9$.",
    "Solve by substitution: $2x + y = 11$, $x - y = 1$.",
]

# (note the student read, deduction, points off) — #3's three reasons.
STOPPED = ("You found x = 4 but never solved for y.", "Stopped after finding x", 40)
SUBTRACTED = ("Subtracting the equations didn't cancel y; add them instead.", "Subtracted instead of added", 60)
SLIP = ("3(4) + 2y = 16 gives y = 2, not y = 3.", "Arithmetic slip after eliminating", 20)
LABELS = {
    STOPPED[1]: "Found x = 4, then stopped before finding y",
    SUBTRACTED[1]: "Subtracted the equations, so y didn't cancel",
    SLIP[1]: "Arithmetic slip after eliminating",
}


def _entry(pid: str, percent: float, why: tuple[str, str, int] | None = None) -> dict[str, Any]:
    status = "full" if percent >= 100 else ("zero" if percent <= 0 else "partial")
    return {
        "problem_id": pid, "score_status": status, "percent": float(percent),
        "feedback": why[0] if why else "Clear, complete work.",
        "deductions": [{"points_off": float(why[2]), "reason": why[1], "step_ref": None}] if why else [],
    }


async def seed() -> dict[str, Any]:
    now = datetime.now(UTC)
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        school = School(name="Lincoln High School", kind=SCHOOL_KIND_INDIVIDUAL,
                        contact_name="Demo", contact_email=f"lincoln_{tag}@t.com")
        s.add(school)
        await s.flush()
        teacher = User(email=f"rivera_{tag}@t.com", password_hash=hash_password("x"), grade_level=12,
                       role="teacher", name="Ms. Rivera", school_id=school.id)
        course = Course(name="Algebra I", subject="math", school_id=school.id)
        s.add_all([teacher, course])
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Systems of Equations", position=0)
        p1, p3 = Section(course_id=course.id, name="Period 1"), Section(course_id=course.id, name="Period 3")
        s.add_all([unit, p1, p3])
        await s.flush()

        roster: dict[str, list[User]] = {"p1": [], "p3": []}
        for i in range(33):
            key, sec = ("p1", p1) if i < 25 else ("p3", p3)
            u = User(email=f"s{i}_{tag}@t.com", password_hash=hash_password("x"), grade_level=9,
                     role="student", name=f"{FIRST[i]} {LAST[i % len(LAST)]}", school_id=school.id)
            s.add(u)
            await s.flush()
            s.add(SectionEnrollment(section_id=sec.id, course_id=course.id, student_id=u.id,
                                    enrolled_at=now - timedelta(days=40)))
            roster[key].append(u)

        async def homework(title: str, due_days: int, questions: list[str]) -> tuple[Assignment, list[str]]:
            due = now - timedelta(days=due_days)
            hw = Assignment(course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id, title=title,
                            type="homework", status="published", due_at=due, content={"problem_ids": []})
            s.add(hw)
            await s.flush()
            items = [QuestionBankItem(course_id=course.id, unit_id=unit.id, originating_assignment_id=hw.id,
                                      title=q[:60], question=q, final_answer="(4, 2)" if "16" in q else "—",
                                      status="approved", source="generated") for q in questions]
            s.add_all(items)
            await s.flush()
            hw.content = {"problem_ids": [str(i.id) for i in items]}
            for sec in (p1, p3):
                s.add(AssignmentSection(assignment_id=hw.id, section_id=sec.id, published_at=due - timedelta(days=5)))
            return hw, [str(i.id) for i in items]

        async def grade(hw: Assignment, u: User, sec: Section, bd: list[dict[str, Any]], *, approved: bool) -> None:
            sub = Submission(assignment_id=hw.id, student_id=u.id, section_id=sec.id, status="submitted",
                             submitted_at=now - timedelta(days=3), extraction_confirmed_at=now - timedelta(days=3))
            s.add(sub)
            await s.flush()
            score = round(sum(e["percent"] for e in bd) / len(bd), 1)
            s.add(SubmissionGrade(submission_id=sub.id, breakdown=bd, ai_score=score, final_score=score,
                                  graded_at=now - timedelta(days=2),
                                  reviewed_at=now - timedelta(days=1) if approved else None))

        subst, subst_ids = await homework("Solving by Substitution", 9, SUBSTITUTION)
        elim, elim_ids = await homework("Elimination Method", 2, ELIMINATION)

        # Elimination, Period 1: 22 of 25 turned in, all approved.
        reasons_3 = [STOPPED] * 7 + [SUBTRACTED] * 5 + [SLIP] * 4
        for i, u in enumerate(roster["p1"][:22]):
            why = reasons_3[i] if i < len(reasons_3) else None
            bd = [
                _entry(elim_ids[0], 100),
                _entry(elim_ids[1], 75, ("Check the sign on y.", "Sign error", 25)) if i % 6 == 0 else
                _entry(elim_ids[1], 100),
                _entry(elim_ids[2], 100 - why[2], why) if why else _entry(elim_ids[2], 100),
                _entry(elim_ids[3], 50, ("Multiplied only one side.", "Scaled one side only", 50)) if i % 4 == 0 else
                _entry(elim_ids[3], 100),
                _entry(elim_ids[4], 100),
            ]
            await grade(elim, u, p1, bd, approved=True)
        # Period 3: 8 of 8 turned in, 5 still AI drafts.
        for i, u in enumerate(roster["p3"]):
            bd = [_entry(pid, 100 if (i + j) % 3 else 50, None if (i + j) % 3 else STOPPED)
                  for j, pid in enumerate(elim_ids)]
            await grade(elim, u, p3, bd, approved=i < 3)
        # Substitution, both periods: approved, mostly full credit.
        for key, sec in (("p1", p1), ("p3", p3)):
            for i, u in enumerate(roster[key]):
                await grade(subst, u, sec, [_entry(pid, 100 if (i + j) % 5 else 75, None if (i + j) % 5 else SLIP)
                                            for j, pid in enumerate(subst_ids)], approved=True)

        async def practice_set(src: Assignment, src_ids: list[str], status: str, version_status: str,
                               questions: list[tuple[int, str]]) -> Assignment:
            ps = Assignment(course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
                            title=f"[Practice] {src.title}", type="practice", status=status,
                            source_homework_id=src.id, content={"problem_ids": []})
            s.add(ps)
            await s.flush()
            s.add(AssignmentSection(assignment_id=ps.id, section_id=p1.id,
                                    published_at=now - timedelta(days=4) if status == "published" else None))
            for pos, q in questions:
                s.add(QuestionBankItem(course_id=course.id, unit_id=unit.id, originating_assignment_id=ps.id,
                                       parent_question_id=uuid.UUID(src_ids[pos]), title=q[:60], question=q,
                                       final_answer="—", status=version_status, source="practice"))
            await s.flush()
            return ps

        live = await practice_set(subst, subst_ids, "published", "approved",
                                  [(0, "Solve by substitution: $x + y = 14$, $x - y = 4$."),
                                   (1, "Solve by substitution: $y = 3x$, $x + y = 8$."),
                                   (2, "Solve by substitution: $3x + y = 13$, $x - y = 3$.")])
        draft = await practice_set(elim, elim_ids, "draft", "pending",
                           [(2, "Solve by elimination: $2x + 3y = 13$, $x - 3y = -4$."),
                            (2, "Solve by elimination: $5x + 2y = 24$, $x - 2y = 0$."),
                            (2, "Solve by elimination: $3x + 4y = 18$, $x - 4y = -2$.")])
        versions = (await s.execute(
            QuestionBankItem.__table__.select().where(QuestionBankItem.originating_assignment_id == live.id)
        )).all()
        for i, u in enumerate(roster["p1"][:11]):
            for v in versions[: 3 - i % 3]:
                s.add(PracticeActivity(student_id=u.id, section_id=p1.id, practice_assignment_id=live.id,
                                       bank_item_id=v.id, mode="practice",
                                       outcome="first_try" if i % 2 else "retry"))
        refresh = await create_refresh_token(s, teacher.id)
        await s.commit()
        return {"course": str(course.id), "p1": str(p1.id), "elim": str(elim.id), "live": str(live.id),
                "draft": str(draft.id),
                "access": create_access_token(str(teacher.id), "teacher"), "refresh": refresh}


async def write_reasons() -> None:
    """The real reasons pass, with a stand-in for the model that groups
    the notes by the deduction each one carries."""
    from api.core import reteach_reasons as rr

    async def stand_in(system: str, user_message: str, mode: str, **_: Any) -> dict[str, Any]:
        groups: dict[str, list[int]] = {}
        for line in user_message.splitlines():
            if not line.startswith("["):
                continue
            n = int(line[1:line.index("]")])
            for deduction, label in LABELS.items():
                if deduction in line:
                    groups.setdefault(label, []).append(n)
        return {"reasons": [{"label": k, "students": v} for k, v in groups.items()]}

    rr.call_claude_json = stand_in  # type: ignore[assignment]
    print("  reasons pass:", await rr.refresh_reteach_reasons(limit=1000))


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    w = await seed()
    if WRITE_REASONS:
        await write_reasons()
    insights = f"/school/teacher/courses/{w['course']}?tab=insights"
    print(f"  insights: {WEB_BASE}{insights}")
    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["access"], w["refresh"]) as page:
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.set_viewport_size({"width": 1440, "height": 900})
            if "insights" in SHOTS:
                await page.goto(f"{WEB_BASE}{insights}", wait_until="networkidle", timeout=90000)
                await page.get_by_role("button", name="Period 1").click(timeout=60000)
                await page.get_by_text("Based on 22 of 25 graded").wait_for(timeout=60000)
                await page.mouse.move(1, 1)
                await page.wait_for_timeout(800)
                await page.screenshot(path=str(OUT_DIR / f"insights-reteach-insights-{OUT}.png"), full_page=True)
            if "reason" in SHOTS:
                await page.get_by_role("button", name="Found x = 4").click()
                await page.get_by_role("link", name="Maya Chen").wait_for(timeout=10000)
                await page.mouse.move(1, 1)
                await page.wait_for_timeout(400)
                await page.screenshot(path=str(OUT_DIR / f"insights-reteach-reason-{OUT}.png"), full_page=True)
            if "live" in SHOTS:
                await page.select_option("#insights-homework", label="Solving by Substitution")
                await page.get_by_text("[Practice] Solving by Substitution").first.wait_for(timeout=30000)
                await page.mouse.move(1, 1)
                await page.wait_for_timeout(600)
                await page.screenshot(path=str(OUT_DIR / f"insights-reteach-live-{OUT}.png"), full_page=True)
            if "review" in SHOTS:
                review = f"/school/teacher/courses/{w['course']}/homework/{w['draft']}/review"
                await page.goto(f"{WEB_BASE}{review}", wait_until="networkidle", timeout=90000)
                await page.get_by_text("[Practice] Elimination Method").first.wait_for(timeout=60000)
                await page.get_by_text("Solve by elimination").first.wait_for(timeout=60000)
                await page.mouse.move(1, 1)
                await page.wait_for_timeout(800)
                await page.screenshot(path=str(OUT_DIR / f"insights-reteach-review-{OUT}.png"), full_page=True)
            print(f"  page errors: {len(errors)}")
            for e in errors[:10]:
                print(f"    ! {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
