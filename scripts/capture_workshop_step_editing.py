"""Screenshot Workshop solution-step add / delete / reorder.

Seeds a school world with two pending generated problems on a draft HW —
one whose automatic solve failed (no steps, "(solution failed …)" final
answer) and one with three steps, the middle carrying a figure — plus an
approved practice set for the student-side blast-radius shot. Then
drives the real review page (WorkshopModal, queue mode).

Standalone (not a durable test) — drives a running worktree stack:

    NEXT_PUBLIC_API_URL=http://localhost:8230/v1 \\
    WEB_BASE=http://localhost:3230 API_BASE=http://localhost:8230/v1 \\
    .venv/bin/python -m scripts.capture_workshop_step_editing [before|after]

`before` captures only the surfaces that exist on main (run it with the
main-branch Workshop checked out). Writes docs/design/workshop-steps-*.png.
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

import httpx

from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.core.constants import SOLUTION_FAILED_SENTINEL
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection
from api.models.course import Course, CourseTeacher
from api.models.question_bank import QuestionBankItem
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.harness.browser import HarnessBrowser

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3230").rstrip("/")
API_BASE = os.environ.get("API_BASE", "http://localhost:8230/v1").rstrip("/")
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "design"

# Right triangle with the altitude from C dropped to AB — the step figure.
ALTITUDE_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 150" '
    'preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" '
    'stroke-width="2">'
    '<polygon points="20,130 200,130 70,30"/>'
    '<line x1="70" y1="30" x2="70" y2="130" stroke-dasharray="5 4"/>'
    '<polyline points="70,118 82,118 82,130" stroke-width="1.5"/>'
    '<g fill="currentColor" stroke="none" font-size="14" font-family="serif">'
    '<text x="6" y="146">A</text><text x="202" y="146">B</text>'
    '<text x="64" y="22">C</text><text x="74" y="146">D</text></g></svg>'
)

STEPS = [
    {
        "title": "Find the hypotenuse",
        "description": r"$AB = \sqrt{6^2 + 8^2} = 10$",
    },
    {
        "title": "Drop the altitude from $C$",
        "description": r"Let $D$ be the foot of the altitude from $C$ to $AB$.",
        "figure_spec": {"kind": "seeded-for-screenshot"},
        "figure_svg": ALTITUDE_SVG,
    },
    {
        "title": "Use two expressions for the area",
        "description": r"$\tfrac12 \cdot 6 \cdot 8 = \tfrac12 \cdot 10 \cdot CD$, so $CD = 4.8$",
    },
]


async def seed() -> dict[str, str]:
    async with get_session_factory()() as s:
        suffix = uuid.uuid4().hex[:6]
        school = School(
            name="Lincoln High", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Demo", contact_email=f"demo_{suffix}@t.com",
        )
        s.add(school)
        await s.flush()
        teacher = User(
            email=f"steps_teacher_{suffix}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Ms. Rivera", school_id=school.id,
        )
        student = User(
            email=f"steps_student_{suffix}@t.com", password_hash=hash_password("x"),
            grade_level=9, role="student", name="Maya Chen", school_id=school.id,
        )
        s.add_all([teacher, student])
        await s.flush()
        course = Course(name="Geometry", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Right Triangles", position=0)
        section = Section(course_id=course.id, name="Period 2")
        s.add_all([unit, section])
        await s.flush()
        s.add(SectionEnrollment(section_id=section.id, course_id=course.id, student_id=student.id))

        hw = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="Right Triangles HW", type="homework", status="draft",
            content={"problem_ids": []},
        )
        practice = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="Altitude practice", type="practice", status="published",
            content={"problem_ids": []},
        )
        s.add_all([hw, practice])
        await s.flush()

        failed = QuestionBankItem(
            course_id=course.id, unit_id=unit.id, originating_assignment_id=hw.id,
            title="Ladder against a wall",
            question=(
                "A 13 ft ladder leans against a wall with its foot 5 ft from the "
                "wall. How high up the wall does the ladder reach?"
            ),
            solution_steps=None, final_answer=SOLUTION_FAILED_SENTINEL,
            difficulty="easy", format="frq", status="pending", source="generated",
        )
        s.add(failed)
        await s.flush()
        stepped = QuestionBankItem(
            course_id=course.id, unit_id=unit.id, originating_assignment_id=hw.id,
            title="Altitude to the hypotenuse",
            question=(
                r"Right triangle $ABC$ has legs $AC = 6$ and $BC = 8$. Find the "
                r"length of the altitude from $C$ to the hypotenuse $AB$."
            ),
            solution_steps=STEPS, final_answer="$4.8$",
            difficulty="medium", format="frq", status="pending", source="generated",
        )
        s.add(stepped)
        practice_item = QuestionBankItem(
            course_id=course.id, unit_id=unit.id, originating_assignment_id=practice.id,
            title="Altitude practice 1",
            question=(
                r"Right triangle $ABC$ has legs $AC = 6$ and $BC = 8$. Find the "
                r"length of the altitude from $C$ to the hypotenuse $AB$."
            ),
            solution_steps=STEPS, final_answer="$4.8$", distractors=[],
            difficulty="medium", format="frq", status="approved", source="practice",
        )
        s.add(practice_item)
        await s.flush()
        s.add(AssignmentSection(
            assignment_id=practice.id, section_id=section.id,
            published_at=datetime.now(UTC),
        ))
        t_refresh = await create_refresh_token(s, teacher.id)
        s_refresh = await create_refresh_token(s, student.id)
        await s.commit()
        return {
            "course_id": str(course.id),
            "hw_id": str(hw.id),
            "practice_id": str(practice.id),
            "stepped_id": str(stepped.id),
            "failed_id": str(failed.id),
            "practice_item_id": str(practice_item.id),
            "t_access": create_access_token(str(teacher.id), "teacher"),
            "t_refresh": t_refresh,
            "s_access": create_access_token(str(student.id), "student"),
            "s_refresh": s_refresh,
        }


async def main(mode: str) -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    w = await seed()
    review = f"{WEB_BASE}/school/teacher/courses/{w['course_id']}/homework/{w['hw_id']}/review"
    errors: list[str] = []

    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["t_access"], w["t_refresh"]) as page:
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.set_viewport_size({"width": 1440, "height": 1500})

            async def shot(label: str, locator=None) -> None:
                out = OUT_DIR / f"workshop-steps-{mode}-{label}.png"
                if locator is not None:
                    await locator.screenshot(path=str(out))
                else:
                    await page.screenshot(path=str(out), full_page=False)
                print(f"  -> {out}")

            async def open_item(title: str) -> None:
                await page.goto(review, wait_until="networkidle", timeout=60000)
                await page.wait_for_timeout(1500)
                for _ in range(3):
                    if await page.get_by_text(title, exact=True).count():
                        return
                    await page.get_by_role("button", name="Skip", exact=False).first.click()
                    await page.wait_for_timeout(600)
                raise RuntimeError(f"never reached {title}")

            left = page.locator("div.overflow-y-auto").first

            async def show_solution() -> None:
                toggle = page.get_by_role("button", name="Show solution", exact=False)
                if await toggle.count():
                    await toggle.first.click()
                    await page.wait_for_timeout(500)

            # ── Stepped item: solution section with the controls ──
            await open_item("Altitude to the hypotenuse")
            await show_solution()
            await shot("list", left)
            if mode == "before":
                await open_item("Ladder against a wall")
                await show_solution()
                await shot("empty", left)
                return 0

            # Hover a card so the control cluster shows at full strength.
            await page.get_by_role("button", name="Move step 2 up").hover()
            await page.wait_for_timeout(300)
            await shot("list-hover", left)

            # Reorder: the figure step moves up; figure must travel with it.
            await page.get_by_role("button", name="Move step 2 up").click()
            await page.wait_for_timeout(1200)
            await shot("after-reorder", left)
            async with httpx.AsyncClient() as c:
                r = await c.get(
                    f"{API_BASE}/teacher/courses/{w['course_id']}/question-bank",
                    params={"status_filter": "pending", "assignment_id": w["hw_id"]},
                    headers={"Authorization": f"Bearer {w['t_access']}"},
                )
                items = {i["id"]: i for i in r.json()["items"]}
                steps = items[w["stepped_id"]]["solution_steps"]
                print("  reorder persisted:", [st["title"] for st in steps])
                assert steps[0].get("figure_svg") == ALTITUDE_SVG, "figure lost on reorder"
                assert steps[0].get("figure_spec") == STEPS[1]["figure_spec"]

            # Delete confirm (inline).
            await page.get_by_role("button", name="Delete step 3").click()
            await page.wait_for_timeout(400)
            await shot("delete-confirm", left)
            await page.get_by_role("button", name="Delete", exact=True).click()
            await page.wait_for_timeout(1200)
            await shot("after-delete", page.locator("body"))

            # ── Failed-solve item: empty state + in-progress add ──
            await open_item("Ladder against a wall")
            await shot("empty", left)
            await page.get_by_role("button", name="Add the first step").click()
            await page.wait_for_timeout(300)
            await page.get_by_label("Step 1 title").fill("Set up the Pythagorean theorem")
            await page.get_by_label("Step 1 explanation").fill(
                r"The ladder is the hypotenuse: $5^2 + h^2 = 13^2$"
            )
            await shot("adding", left)
            await page.get_by_role("button", name="Add step 1").click()
            await page.wait_for_timeout(1200)
            # Type the final answer into the (blank) failed-solve field.
            await page.get_by_text("Click to add the final answer").click()
            await page.keyboard.type("12 ft")
            await page.keyboard.press("Enter")
            await page.wait_for_timeout(1200)
            await shot("failed-fixed", left)

        # ── Student blast radius: practice Learn walkthrough of an edited item ──
        async with httpx.AsyncClient() as c:
            reordered = [STEPS[1], STEPS[0], STEPS[2]]
            r = await c.patch(
                f"{API_BASE}/teacher/question-bank/{w['practice_item_id']}",
                json={"solution_steps": reordered},
                headers={"Authorization": f"Bearer {w['t_access']}"},
            )
            r.raise_for_status()
        async with browser.authed_page(w["s_access"], w["s_refresh"]) as page:
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.set_viewport_size({"width": 1280, "height": 1100})
            await page.goto(
                f"{WEB_BASE}/school/student/courses/{w['course_id']}/practice/{w['practice_id']}",
                wait_until="networkidle", timeout=60000,
            )
            await page.wait_for_timeout(1500)
            names = await page.get_by_role("button").all_inner_texts()
            print("  student buttons:", names)
            learn = page.get_by_role("button", name="Learn", exact=False)
            if await learn.count():
                await learn.first.click()
                await page.wait_for_timeout(1200)
            names = await page.get_by_role("button").all_inner_texts()
            print("  student buttons (learn):", names)
            out = OUT_DIR / "workshop-steps-after-student-learn.png"
            await page.screenshot(path=str(out), full_page=True)
            print(f"  -> {out}")

    print(f"  console errors: {len(errors)}")
    for e in errors[:12]:
        print(f"    ! {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "after")))
