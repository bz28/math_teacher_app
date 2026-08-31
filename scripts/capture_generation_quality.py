"""Seed a realistic generation-quality world and screenshot the page.

NOTE: the page now leads with a board over every settled generated
question (clean / repaired / redone / rejected), not a list ranked by
repair count. This script still seeds the repair histories that back the
drill-in; the ranking it describes below no longer drives the page.

Standalone (not a durable test) — drives the running stack:
    dashboard :5173, API :8000

    .venv/bin/python -m scripts.capture_generation_quality

Seeds three questions with different repair histories, because the
page's whole claim is that it RANKS by how much a teacher had to fight a
question — a single seeded row would prove nothing about the ordering.

Writes to docs/design/shots-generation-quality-{list,detail}.png.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import text

from api.core.auth import hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import Course
from api.models.question_bank import QuestionBankItem
from api.models.question_edit import (
    EDIT_MANUAL,
    EDIT_WORKSHOP,
    FIELD_QUESTION,
    QuestionEdit,
)
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School
from api.models.unit import Unit
from api.models.user import User
from tests.harness.browser import HarnessBrowser

WEB_BASE = "http://localhost:5173"
OUT_DIR = Path(__file__).resolve().parents[1] / "docs" / "design"

# Three questions a teacher fought to different degrees. The product
# prompt is real — this is what the generator is actually asked for.
#
# Every step must be a GENUINE change from the one before it. The
# recorder refuses to log a no-op edit, so a seeded before == after
# is a state the product cannot actually produce — and a screenshot
# showing a "repair" where nothing changed would undercut the exact
# claim this page makes.
GEN_PROMPT = (
    "Write 5 quadratic-equation problems for a mixed-ability Algebra 1 "
    "class. Vary the solving method (factoring, completing the square, "
    "quadratic formula). Keep the numbers clean."
)

WORLD = [
    (
        "Product rule with a log",
        "Differentiate f(x) = 3x^2 ln(x).",
        [
            (EDIT_MANUAL, "Differentiate f(x) = 3x^2 ln(x). Show your working."),
            (
                EDIT_MANUAL,
                "Differentiate f(x) = 3x^2 ln(x). Show each step of your "
                "working.",
            ),
            (
                EDIT_WORKSHOP,
                "Differentiate f(x) = 3x^2 ln(x). Show each step and state "
                "the domain of the derivative.",
            ),
            (
                EDIT_MANUAL,
                "Differentiate f(x) = 3x^2 ln(x) using the product rule. "
                "Show each step and state the domain of the derivative.",
            ),
        ],
    ),
    (
        "Factoring a quadratic",
        "Solve x^2 - 5x + 6 = 0.",
        [
            (EDIT_MANUAL, "Solve x^2 - 5x + 6 = 0 for x."),
            (EDIT_WORKSHOP, "Solve x^2 - 5x + 6 = 0 by factoring. Show the factors."),
        ],
    ),
    (
        "Uniform acceleration",
        "A car accelerates from rest to 24 m/s in 6 s. Find the distance.",
        [
            (
                EDIT_MANUAL,
                "A car accelerates uniformly from rest to 24 m/s in 6 s. "
                "Find the distance travelled.",
            ),
        ],
    ),
]


async def seed() -> dict[str, str]:
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE question_edits, question_bank_items, assignments, "
            "units, courses, schools, sessions, users RESTART IDENTITY CASCADE"
        ))
        admin = User(
            email="ops@veradicai.com", password_hash=hash_password("x"),
            grade_level=99, role="admin", name="Operator",
        )
        school = School(
            name="Lincoln High", kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="Dana Osei", contact_email="dana@lincoln.edu",
        )
        s.add_all([admin, school])
        await s.flush()
        teacher = User(
            email="rivera@lincoln.edu", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Ms Rivera",
            school_id=school.id,
        )
        course = Course(name="Algebra 1", subject="math")
        s.add_all([teacher, course])
        await s.flush()
        unit = Unit(course_id=course.id, name="Quadratics", position=0)
        s.add(unit)
        await s.flush()
        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="HW 4", type="homework", status="published",
            content={"problem_ids": []},
        )
        s.add(assignment)
        await s.flush()

        base = datetime.now(UTC) - timedelta(days=3)
        for title, original, edits in WORLD:
            item = QuestionBankItem(
                course_id=course.id, unit_id=unit.id,
                originating_assignment_id=assignment.id,
                title=title, question=edits[-1][1] if edits else original,
                solution_steps=[], final_answer="see key",
                status="approved", source="generated",
                generation_prompt=GEN_PROMPT,
            )
            s.add(item)
            await s.flush()
            prev = original
            for i, (kind, after) in enumerate(edits):
                s.add(QuestionEdit(
                    bank_item_id=item.id, edited_by_id=teacher.id,
                    school_id=school.id, kind=kind,
                    field=FIELD_QUESTION,
                    before=prev, after=after,
                    created_at=base + timedelta(hours=i * 5),
                ))
                prev = after

        # Signing in through the form means no tokens are needed here.
        await s.flush()
        await s.commit()
        return {"admin_email": "ops@veradicai.com"}


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Seeding generation-quality world …")
    await seed()

    errors: list[str] = []
    async with HarnessBrowser(WEB_BASE) as browser:
        # Sign in through the real form. `authed_page` seeds the WEB
        # app's localStorage keys; the console uses its own
        # (`admin_access_token`), so token injection silently lands on
        # the login screen — which is exactly what the first capture
        # attempt produced.
        async with browser.plain_page() as page:
            page.on(
                "console",
                lambda m: errors.append(m.text) if m.type == "error" else None,
            )
            await page.goto(f"{WEB_BASE}/login")
            await page.get_by_placeholder("Email").fill("ops@veradicai.com")
            await page.get_by_placeholder("Password").fill("x")
            await page.get_by_role("button", name="Sign in").click()
            await page.wait_for_load_state("networkidle")
            await page.goto(f"{WEB_BASE}/generation-quality")
            await page.wait_for_load_state("networkidle")
            await page.set_viewport_size({"width": 1440, "height": 1000})
            out = OUT_DIR / "shots-generation-quality-list.png"
            await page.screenshot(path=str(out), full_page=False)
            print(f"  -> {out}")

            # Drill into the worst offender — the repair trail is the
            # reason the page exists, so it has to be in the evidence.
            await page.get_by_text("Product rule with a log").first.click()
            await page.wait_for_timeout(600)
            out2 = OUT_DIR / "shots-generation-quality-detail.png"
            await page.screenshot(path=str(out2), full_page=False)
            print(f"  -> {out2}")

    print(f"  console errors: {len(errors)}")
    for e in errors[:5]:
        print(f"    {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
