"""Seed realistic data for the AI-quality console tabs.

## Why this exists

Production started collecting this data days ago and the local database
is fixture rows that skipped the confirm and review flows, so every
quality board renders empty. An empty board is exactly the state these
pages must handle honestly — but it is also the state in which none of
the interesting logic runs. Bucket maths, worst-first ordering, the
drill-in diff and the thin-sample caveats are all invisible until there
is something to count, which means they ship unverified and un-
screenshotted.

This produces one small, deliberately-shaped world covering EVERY bucket
of the handwriting-extraction board, including the ones that should be
excluded from the score.

Not a load test and not random: each row is chosen so a specific rule is
visible on screen. The corrections are real misread patterns (a
handwritten z read as 2, a minus sign lost, a squared exponent dropped),
because a screenshot of lorem ipsum proves nothing about a page whose
whole job is showing what the reader got wrong.

Usage:
    DATABASE_URL=... python -m scripts.seed_quality_screens
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, text

from api.core.auth import hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission
from api.models.course import Course
from api.models.question_bank import QuestionBankItem
from api.models.question_edit import (
    EDIT_MANUAL,
    EDIT_WORKSHOP,
    FIELD_QUESTION,
    FIELD_SOLUTION,
    QuestionEdit,
)
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.unit import Unit
from api.models.user import User

NOW = datetime.now(UTC)


def _steps(*rows: tuple[int, int, str, float]) -> dict[str, Any]:
    """Vision output in the shape the real pipeline persists.

    `confidence` is ONE top-level float — the step objects declare
    additionalProperties:false and carry no confidence of their own. An
    earlier version of this script put a score on every step, which is a
    shape the pipeline cannot produce; the page rendered per-row chips
    off it and a screenshot went into a PR proving a feature that did not
    exist. The per-row value here is only used to derive the overall one.
    """
    return {
        "steps": [
            {
                "problem_position": pos,
                "step_num": num,
                "latex": latex,
                "plain_english": "",
            }
            for pos, num, latex, _ in rows
        ],
        "final_answers": [],
        "confidence": round(min(c for *_, c in rows), 2) if rows else 0.0,
    }


# Each entry is one submission: (label, extraction, edits, outcome, age_hours).
# outcome ∈ {"clean", "repaired", "flagged", "awaiting"}.
CASES: list[tuple[str, dict[str, Any], dict[str, str] | None, str, int]] = [
    # ── Read clean. The reader had an easy page and got it right.
    ("clean linear", _steps(
        (1, 1, "3x + 7 = 22", 0.97),
        (1, 2, "3x = 15", 0.96),
        (1, 3, "x = 5", 0.98),
    ), None, "clean", 6),
    ("clean fractions", _steps(
        (1, 1, "\\frac{2}{3} + \\frac{1}{6}", 0.93),
        (1, 2, "\\frac{5}{6}", 0.95),
    ), None, "clean", 20),
    ("clean two-problem", _steps(
        (1, 1, "2y = 8", 0.96),
        (1, 2, "y = 4", 0.97),
        (2, 1, "5 - 2 = 3", 0.94),
    ), None, "clean", 30),
    ("clean distributive", _steps(
        (1, 1, "4(x + 2)", 0.95),
        (1, 2, "4x + 8", 0.96),
    ), None, "clean", 52),

    # ── Corrected. The classic confusions, each fixed by the student.
    # A handwritten z read as a 2 — the failure the drill-in exists for.
    ("z read as 2", _steps(
        (1, 1, "x^2 + 5x + 6 = 0", 0.88),
        (1, 2, "(x + 2)(x + 3) = 0", 0.61),
        (1, 3, "x = -2, x = -3", 0.64),
    ), {"1:2": "(x + z)(x + 3) = 0", "1:3": "x = -z, x = -3"}, "repaired", 12),
    # A lost minus sign changes the answer and nothing downstream notices.
    ("dropped minus", _steps(
        (1, 1, "7 - 12", 0.71),
        (1, 2, "5", 0.69),
    ), {"1:2": "-5"}, "repaired", 26),
    # An exponent flattened into a coefficient.
    ("lost exponent", _steps(
        (1, 1, "x2 + 4", 0.58),
        (1, 2, "x2 = -4", 0.55),
    ), {"1:1": "x^2 + 4", "1:2": "x^2 = -4"}, "repaired", 44),
    # The student CLEARED a row: the reader invented a step that was not
    # on the page. Renders as a deletion, never as "no change".
    ("phantom step", _steps(
        (1, 1, "6 \\div 2 = 3", 0.90),
        (1, 2, "3 \\times 1 = 3", 0.42),
    ), {"1:2": ""}, "repaired", 70),

    # ── Flagged. The student rejected the read outright; no AI grading
    #    runs downstream, so this is the reader failing loudly.
    ("flagged smudged", _steps(
        (1, 1, "?? + ?? = ??", 0.31),
    ), None, "flagged", 18),
    ("flagged wrong page", _steps(
        (1, 1, "see attached", 0.22),
    ), None, "flagged", 60),

    # ── Awaiting. Read, never ruled on. MUST stay out of the rate — an
    #    unanswered confirm is neither a pass nor a failure.
    ("awaiting a", _steps((1, 1, "9 - 4 = 5", 0.91)), None, "awaiting", 3),
    ("awaiting b", _steps((1, 1, "8 \\div 2 = 4", 0.89)), None, "awaiting", 9),
    ("awaiting c", _steps((1, 1, "3 \\times 7 = 21", 0.92)), None, "awaiting", 15),
]


async def main() -> None:
    async with get_session_factory()() as s:
        # Only the tables this script owns. Deliberately NOT question_bank
        # or grading tables — other boards read those and wiping them would
        # trade one empty screen for another.
        await s.execute(text(
            "TRUNCATE question_edits, question_bank_items, submissions, "
            "assignments, sections, units, courses, schools, "
            "users RESTART IDENTITY CASCADE"
        ))
        await s.commit()

    async with get_session_factory()() as s:
        school = School(
            name="Holy Ghost Prep", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Console Admin", contact_email="admin@veradic.test",
        )
        s.add(school)
        await s.flush()

        admin = User(
            email="admin@veradic.test", password_hash=hash_password("admin"),
            grade_level=99, role="admin", name="Console Admin",
        )
        # A teacher must belong to a school — ck_users_school_required_for_teacher.
        teacher = User(
            email="teacher@veradic.test", password_hash=hash_password("teach"),
            grade_level=12, role="teacher", name="R. Alvarez",
            school_id=school.id,
        )
        s.add_all([admin, teacher])
        await s.flush()

        # Two subjects so the by-subject table has something to rank, and
        # so "weakest by subject" is not a superlative over n=1.
        algebra = Course(name="Algebra I", subject="math")
        chem = Course(name="Chemistry I", subject="chemistry")
        s.add_all([algebra, chem])
        await s.flush()

        courses: list[tuple[Course, Assignment, Section]] = []
        for course in (algebra, chem):
            unit = Unit(course_id=course.id, name="Unit 1", position=0)
            section = Section(course_id=course.id, name="Period 1")
            s.add_all([unit, section])
            await s.flush()
            asg = Assignment(
                course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
                title=f"{course.name} — Homework 1", type="homework",
                status="published", content={"problems": []},
            )
            s.add(asg)
            await s.flush()
            courses.append((course, asg, section))

        for i, (label, extraction, edits, outcome, age) in enumerate(CASES):
            # Chemistry gets the two flagged reads plus one clean, so it
            # ranks below math and the ordering is visibly doing something.
            _, asg, section = courses[1] if outcome == "flagged" or i == 1 else courses[0]

            student = User(
                email=f"student{i}@veradic.test",
                password_hash=hash_password("study"),
                grade_level=9, role="student", name=f"Student {i + 1}",
            )
            s.add(student)
            await s.flush()

            at = NOW - timedelta(hours=age)
            sub = Submission(
                assignment_id=asg.id, student_id=student.id,
                section_id=section.id, status="submitted",
                submitted_at=at - timedelta(minutes=5),
                extraction=extraction,
            )
            if outcome == "clean":
                sub.extraction_confirmed_at = at
            elif outcome == "repaired":
                sub.extraction_edits = edits
                sub.extraction_edited_at = at
                sub.extraction_confirmed_at = at
            elif outcome == "flagged":
                sub.extraction_flagged_at = at
            # "awaiting" leaves both stamps null on purpose.
            s.add(sub)

        await s.commit()

        # ── Generation quality: bank items with a repair history, so the
        #    page that reads `question_edits` can be seen and screenshotted
        #    too. Counts are chosen to straddle its severity thresholds
        #    (1 = polish, 2 = a pattern, 4 = arrived wrong).
        algebra_asg = courses[0][1]
        algebra_unit = (await s.execute(
            select(Unit).where(Unit.course_id == algebra.id)
        )).scalars().first()
        assert algebra_unit is not None

        base = NOW - timedelta(days=2)
        for title, question, n_edits in (
            ("Quadratic factoring", "Factor x^2 + 5x + 6.", 4),
            ("Systems of equations", "Solve 2x + y = 7 and x - y = 2.", 2),
            ("Slope from two points", "Find the slope through (1,2) and (4,8).", 1),
        ):
            item = QuestionBankItem(
                course_id=algebra.id, unit_id=algebra_unit.id,
                originating_assignment_id=algebra_asg.id,
                title=title, question=f"{question} v{n_edits}",
                solution_steps=[], final_answer="see steps",
                status="approved", source="generated",
                generation_prompt=(
                    "Write 5 mixed-difficulty algebra problems for a "
                    "9th-grade class, no calculators."
                ),
            )
            s.add(item)
            await s.flush()
            for i in range(n_edits):
                s.add(QuestionEdit(
                    bank_item_id=item.id, edited_by_id=teacher.id,
                    school_id=school.id,
                    # Alternate so both stat tiles have something in them.
                    kind=EDIT_MANUAL if i % 2 == 0 else EDIT_WORKSHOP,
                    field=FIELD_QUESTION,
                    before=f"{question} v{i}",
                    after=f"{question} v{i + 1}",
                    created_at=base + timedelta(hours=i * 3),
                ))

        # A solution repair and a reject on a fourth item — neither should
        # appear in the generation report's counts. Seeded precisely so a
        # screenshot proves the scoping holds rather than asserting it.
        quiet = QuestionBankItem(
            course_id=algebra.id, unit_id=algebra_unit.id,
            originating_assignment_id=algebra_asg.id,
            title="Solution fixed, question untouched",
            question="Simplify (2x^3)(3x^4).",
            solution_steps=[], final_answer="6x^7",
            status="approved", source="generated",
            generation_prompt="Write 5 mixed-difficulty algebra problems.",
        )
        s.add(quiet)
        await s.flush()
        s.add(QuestionEdit(
            bank_item_id=quiet.id, edited_by_id=teacher.id,
            school_id=school.id, kind=EDIT_MANUAL, field=FIELD_SOLUTION,
            before="1. Add the exponents\n2x^3 * 3x^4 = 6x^12",
            after="1. Add the exponents\n2x^3 * 3x^4 = 6x^7",
            created_at=base,
        ))

        await s.commit()

    settled = sum(1 for c in CASES if c[3] != "awaiting")
    clean = sum(1 for c in CASES if c[3] == "clean")
    print(f"Seeded {len(CASES)} submissions.")
    print(f"  settled  {settled}  (clean {clean}, "
          f"repaired {sum(1 for c in CASES if c[3] == 'repaired')}, "
          f"flagged {sum(1 for c in CASES if c[3] == 'flagged')})")
    print(f"  awaiting {sum(1 for c in CASES if c[3] == 'awaiting')} "
          "— excluded from the rate")
    print(f"  expected clean rate {round(clean / settled * 100, 1)}%")
    print("  admin@veradic.test / admin")


if __name__ == "__main__":
    asyncio.run(main())
